/**
 * Weekly report row shape built from Zoho Inventory REST (Items API) — separate
 * from Excel/UI formatting (see zohoService + weeklyReportXlsxService).
 *
 * Does not compute hidden stock movements. Values we cannot read from the API
 * are returned as `null` (UI / Excel show "—"); see docs/zoho-inventory-api-coverage.md.
 */

const { listAllItems } = require('../integrations/zoho/zohoInventoryClient')
const { readZohoInventoryConfig } = require('../integrations/zoho/zohoConfig')

/**
 * Exposed on JSON responses so the UI can show a one-line data-source note.
 * Copy remains short; the canonical gap analysis is in docs/zoho-inventory-api-coverage.md
 */
const ZOHO_WEEKLY_REPORT_INTEGRATION = {
  data_source: 'zoho_inventory_rest_v1',
  item_endpoint: 'GET /inventory/v1/items (pages)',
  /**
   * Fields we do **not** take from a single public endpoint for an arbitrary
   * date range (Zoho’s UI "Inventory Summary" / Deluge pipeline is not mirrored).
   */
  metrics_unavailable_in_this_integration: [
    'opening_stock (at from_date start)',
    'purchases (period total)',
    'returned_to_wholesale (period total)',
    'sold (period total, as in the old Deluge report)',
  ],
  metrics_populated: [
    'closing_stock: sum of per-location `location_available_stock` (or `location_stock_on_hand` fallback) on each item as returned by the API — this is *current* stock, not a historical to_date close unless the request is made at that time',
    'family: Zoho item custom field, resolved via ZOHO_FAMILY_CUSTOMFIELD_ID when set, else ""',
  ],
  documentation: 'docs/zoho-inventory-api-coverage.md',
}

function parseQty(s) {
  if (s === undefined || s === null) return 0
  const n = parseFloat(String(s).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

/**
 * @param {object} item - raw Zoho item
 * @returns {number} Sum of available stock across locations
 */
function sumCurrentLocationStock(item) {
  const locs = item.locations
  if (!Array.isArray(locs) || locs.length === 0) {
    // Some items may have top-level rate only; no locations array
    return 0
  }
  let sum = 0
  for (const loc of locs) {
    const q =
      loc.location_available_stock != null && String(loc.location_available_stock).length
        ? loc.location_available_stock
        : loc.location_stock_on_hand
    sum += parseQty(q)
  }
  return sum
}

/**
 * @param {object} item
 * @param {string | null} familyFieldId
 * @returns {string}
 */
function pickFamilyValue(item, familyFieldId) {
  const custom = item.custom_fields
  if (!Array.isArray(custom) || custom.length === 0) return ''
  if (familyFieldId) {
    const f = custom.find(
      (c) => c && String(c.customfield_id) === String(familyFieldId)
    )
    if (f && f.value != null && f.value !== '') {
      return String(f.value).trim()
    }
    return ''
  }
  // No id configured: cannot reliably pick a label — leave empty; doc tells ops to set ZOHO_FAMILY_CUSTOMFIELD_ID
  return ''
}

/**
 * Normalised "report row" before `item_report_groups` filtering (same field names
 * as the old webhook contract; see zohoService validation).
 * @param {string} fromDate
 * @param {string} toDate
 * @param {object} zohoItem
 * @param {string | null} familyFieldId
 * @returns {object}
 */
function zohoItemToReportRow(zohoItem, fromDate, toDate, familyFieldId) {
  const sku = typeof zohoItem.sku === 'string' ? zohoItem.sku.trim() : ''
  const name = typeof zohoItem.name === 'string' ? zohoItem.name.trim() : ''
  const iid = zohoItem.item_id
  const itemId = iid == null || iid === '' ? '' : String(iid)

  const family = pickFamilyValue(zohoItem, familyFieldId)
  const closing = sumCurrentLocationStock(zohoItem)

  // Period metrics: not available without aggregating other documents; unambiguously null
  return {
    sku,
    item_name: name,
    item_id: itemId,
    family: typeof family === 'string' ? family : '',
    opening_stock: null,
    purchases: null,
    returned_to_wholesale: null,
    closing_stock: Number.isFinite(closing) ? closing : 0,
    sold: null,
    _zoho: {
      from_date: fromDate,
      to_date: toDate,
    },
  }
}

/**
 * Fetch and normalise all active items to report rows. Date args are passed
 * through to row metadata and drive no extra API calls.
 *
 * @param {string} fromDate
 * @param {string} toDate
 * @returns {Promise<object[]>}
 */
async function fetchZohoItemRowsUnfiltered(fromDate, toDate) {
  const cfg = readZohoInventoryConfig()
  if (cfg.code !== 'ok') {
    const e = new Error(
      'Zoho source not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_INVENTORY_ORGANIZATION_ID.'
    )
    e.code = 'ZOHO_NOT_CONFIGURED'
    throw e
  }
  const familyFieldId = cfg.familyCustomFieldId
  const raw = await listAllItems()
  const out = []
  for (const row of raw) {
    if (!row) continue
    if (row.status && String(row.status).toLowerCase() === 'inactive') continue
    const sk = typeof row.sku === 'string' ? row.sku.trim() : ''
    if (!sk) continue
    out.push(zohoItemToReportRow(row, fromDate, toDate, familyFieldId))
  }
  return out
}

module.exports = {
  fetchZohoItemRowsUnfiltered,
  ZOHO_WEEKLY_REPORT_INTEGRATION,
  sumCurrentLocationStock,
  pickFamilyValue,
  // tests
  _internals: { zohoItemToReportRow, parseQty },
}
