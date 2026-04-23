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

const { listAllItems, zohoApiRequest, fetchListPaginated } = require('./zohoInventoryClient')
const {
  getSales,
  getPurchases,
  getVendorCredits,
} = require('./weeklyReportZohoTransactions')
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
 * All inventory item rows as returned by Zoho (unfiltered, paginated). Raw API objects.
 * @returns {Promise<object[]>}
 */
async function fetchAllItemsRaw() {
  return listAllItems()
}

/**
 * Same data as `fetchAllItemsRaw`, mapped to {@link ZohoNormalizedItem} with
 * the Family custom field parsed from `custom_fields` (see `zohoItemFamily.js`).
 * @returns {Promise<ZohoNormalizedItem[]>}
 */
async function getItems() {
  const c = readZohoConfig()
  if (c.code !== 'ok') {
    const e = new Error('Zoho not configured')
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }
  const raw = await listAllItems()
  const familyId = c.familyCustomFieldId
  return raw.map((it) => normalizeZohoInventoryItem(it, familyId))
}

function getZohoConfigOrNotConfigured() {
  return readZohoConfig()
}

module.exports = {
  fetchAllItemsRaw,
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
