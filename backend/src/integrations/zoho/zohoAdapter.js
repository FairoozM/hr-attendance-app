/**
 * Zoho adapter (facade) for HR weekly reports and future Inventory use.
 * Delegates to the lower-level `zohoInventoryClient` and `zohoConfig`.
 *
 * This is the **primary** integration path; Deluge webhooks are deprecated — see
 * `zohoDelugeWebhookAdapter.deprecated.js` (kept for documentation only).
 *
 * Error `code` values the stack may set (for API / UI mapping):
 * - `ZOHO_NOT_CONFIGURED` — missing OAuth or org in env
 * - `ZOHO_OAUTH_ERROR` — token refresh failed (treat as “auth failed” for operators)
 * - `ZOHO_API_ERROR` — HTTP 4xx/5xx, invalid JSON, or Zoho `code` ≠ 0
 * - `ZOHO_API_TIMEOUT` — request exceeded `ZOHO_API_TIMEOUT_MS`
 * - `ZOHO_API_NETWORK_ERROR` — socket / TLS failure
 *
 * Row validation (malformed business rows) is still `WEBHOOK_INVALID_RESPONSE` in
 * `zohoService` for response-shape backward compatibility; semantically = invalid Zoho data.
 */

const { listAllItems, listItemsForWarehouse, zohoApiRequest, fetchListPaginated } = require('./zohoInventoryClient')
const {
  getSales,
  getPurchases,
  getVendorCredits,
} = require('./weeklyReportZohoTransactions')
const {
  fetchAllBillsRaw,
  clearBillsCache,
  fetchAllVendorCreditsRaw,
  clearVendorCreditsCache,
} = require('./zohoTransactionsCache')
const { readZohoConfig, INVENTORY_V1, orgEnvHint } = require('./zohoConfig')
const { normalizeZohoInventoryItem } = require('./zohoItemFamily')

/**
 * @typedef {object} ZohoNormalizedItem
 * @property {string} item_id - Zoho `item_id` as string ("" if missing)
 * @property {string} sku
 * @property {string} name - `name` on the Zoho item
 * @property {string} family - value of the custom field when `ZOHO_FAMILY_CUSTOMFIELD_ID`
 *   matches a `custom_fields[].customfield_id`; otherwise ""
 */

/**
 * Items are static product-catalog data that rarely changes. Cache them for
 * ZOHO_ITEMS_CACHE_TTL_MS (default 5 min) so that every report request after
 * the first cold load returns items instantly instead of re-scanning 20 pages.
 *
 * Set ZOHO_ITEMS_CACHE_TTL_MS=0 to disable.
 */
const ITEMS_CACHE_TTL_MS =
  process.env.ZOHO_ITEMS_CACHE_TTL_MS !== undefined
    ? Math.max(0, parseInt(process.env.ZOHO_ITEMS_CACHE_TTL_MS, 10) || 0)
    : 5 * 60 * 1000

/** @type {{ items: object[], expiresAt: number } | null} */
let _itemsCache = null

/** @type {Promise<object[]> | null} */
let _itemsFetchInFlight = null

/**
 * All inventory item rows as returned by Zoho (unfiltered, paginated). Raw API objects.
 *
 * Two-layer guard:
 *  1. TTL cache  — serve stale-safe items without hitting Zoho (default 5 min)
 *  2. In-flight dedup — concurrent callers share one Promise so pages are
 *     fetched exactly once even on a cold start
 *
 * @returns {Promise<object[]>}
 */
async function fetchAllItemsRaw() {
  // 1. Warm cache hit
  if (_itemsCache && Date.now() < _itemsCache.expiresAt) {
    if (process.env.DEBUG_ZOHO === '1') {
      console.log('[zoho-items] cache hit — serving from memory')
    }
    return _itemsCache.items
  }

  // 2. In-flight dedup
  if (_itemsFetchInFlight) {
    return _itemsFetchInFlight
  }

  // 3. Cold fetch
  _itemsFetchInFlight = listAllItems()
    .then((items) => {
      if (ITEMS_CACHE_TTL_MS > 0) {
        _itemsCache = { items, expiresAt: Date.now() + ITEMS_CACHE_TTL_MS }
      }
      console.log(
        `[zoho-items] cached ${items.length} items for ${Math.round(ITEMS_CACHE_TTL_MS / 1000)}s`
      )
      return items
    })
    .finally(() => {
      _itemsFetchInFlight = null
    })
  return _itemsFetchInFlight
}

/** Evict the items cache (e.g. after a catalog change). */
function clearItemsCache() {
  _itemsCache = null
}

/**
 * Per-warehouse item cache: short TTL, keyed by warehouse_id string.
 * @type {Map<string, { items: object[], expiresAt: number }>}
 */
const _warehouseItemsCache = new Map()

/**
 * Fetch all items scoped to a single warehouse. Used to compute warehouse-specific
 * `stock_on_hand` for the Damaged warehouse exclusion feature.
 *
 * Zoho returns `warehouse_stock_on_hand` (+ `stock_on_hand` = total) when
 * `warehouse_id` is supplied to the items endpoint.
 *
 * Cached separately from the global `fetchAllItemsRaw` cache.
 *
 * @param {string} warehouseId
 * @returns {Promise<object[]>}
 */
async function fetchItemsRawForWarehouse(warehouseId) {
  const wid = String(warehouseId || '').trim()
  if (!wid) return []
  const hit = _warehouseItemsCache.get(wid)
  if (hit && Date.now() < hit.expiresAt) return hit.items
  const items = await listItemsForWarehouse(wid)
  if (ITEMS_CACHE_TTL_MS > 0) {
    _warehouseItemsCache.set(wid, { items, expiresAt: Date.now() + ITEMS_CACHE_TTL_MS })
  }
  return items
}

/**
 * Same data as `fetchAllItemsRaw`, mapped to {@link ZohoNormalizedItem} with
 * the Family custom field parsed from `custom_fields` (see `zohoItemFamily.js`).
 * Uses `fetchAllItemsRaw` (not `listAllItems` directly) so that concurrent callers
 * share the `_itemsFetchInFlight` guard and only one Zoho scan is issued at a time.
 * @returns {Promise<ZohoNormalizedItem[]>}
 */
async function getItems() {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho not configured')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }
  const raw = await fetchAllItemsRaw()
  const familyId = c.familyCustomFieldId
  return raw.map((it) => normalizeZohoInventoryItem(it, familyId))
}

function getZohoConfigOrNotConfigured() {
  return readZohoConfig()
}

module.exports = {
  fetchAllItemsRaw,
  fetchItemsRawForWarehouse,
  clearItemsCache,
  fetchAllBillsRaw,
  clearBillsCache,
  fetchAllVendorCreditsRaw,
  clearVendorCreditsCache,
  getItems,
  zohoApiRequest,
  fetchListPaginated,
  getZohoConfigOrNotConfigured,
  readZohoConfig,
  INVENTORY_V1,
  orgEnvHint,
  getSales,
  getPurchases,
  getVendorCredits,
}
