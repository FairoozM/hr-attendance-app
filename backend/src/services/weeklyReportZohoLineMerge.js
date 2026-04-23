/**
 * Map Zoho transaction line rows (invoices, bills, vendor credits) to weekly
 * report rows by **sku (primary)**, else **item_id**, else **item name** (case-insensitive),
 * matching `item_report_groups` item resolution.
 */

/**
 * @param {object[]} zohoItemRows - raw from GET /items
 * @returns {Map<string, string>} item_id string -> sku (trimmed)
 */
function buildItemIdToSkuMap(zohoItemRows) {
  const m = new Map()
  if (!Array.isArray(zohoItemRows)) return m
  for (const it of zohoItemRows) {
    if (!it || typeof it !== 'object') continue
    if (it.item_id == null || it.item_id === '') continue
    const sku = typeof it.sku === 'string' ? it.sku.trim() : ''
    if (sku) m.set(String(it.item_id).trim(), sku)
  }
  return m
}

/**
 * One canonical key per line to avoid double-counting.
 * @param {{ item_id?: unknown, name?: string, quantity?: unknown }} line
 * @param {Map<string, string>} idToSku
 * @returns {string|null}
 */
function lineCanonicalKey(line, idToSku) {
  const iid = line.item_id != null && line.item_id !== '' ? String(line.item_id).trim() : ''
  if (iid) {
    const sk = idToSku.get(iid)
    if (sk && String(sk).trim() !== '') {
      return `s:${String(sk).trim().toLowerCase()}`
    }
    return `i:${iid}`
  }
  const nm = line && line.name != null && String(line.name).trim() !== '' ? String(line.name).trim().toLowerCase() : ''
  return nm ? `n:${nm}` : null
}

function parseLineQty(v) {
  if (v == null) return 0
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = parseFloat(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

/**
 * @param {Array<{ item_id?: unknown, name?: string, quantity?: unknown }>} lines
 * @param {Map<string, string>} idToSku
 * @returns {Map<string, number>}
 */
function sumLinesToMap(lines, idToSku) {
  const map = new Map()
  for (const line of lines || []) {
    const k = lineCanonicalKey(line, idToSku)
    if (!k) continue
    const q = parseLineQty(line.quantity)
    map.set(k, (map.get(k) || 0) + q)
  }
  return map
}

/**
 * @param {Map<string, number>} m
 * @param {{ sku: string, item_id: string, item_name: string }} row
 * @returns {number}
 */
function mapLookupForReportRow(m, row) {
  if (!m || m.size === 0) return 0
  const sk = (row.sku && String(row.sku).trim().toLowerCase()) || ''
  if (sk) {
    const v = m.get(`s:${sk}`)
    if (v != null) return v
  }
  if (row.item_id != null && String(row.item_id).trim() !== '') {
    const v = m.get(`i:${String(row.item_id).trim()}`)
    if (v != null) return v
  }
  const nm = (row.item_name && String(row.item_name).trim().toLowerCase()) || ''
  if (nm) {
    const v = m.get(`n:${nm}`)
    if (v != null) return v
  }
  return 0
}

/**
 * Fills sold, purchases, and returned_to_wholesale. **Does not recompute
 * `opening_stock`** (Phase 4): that field stays a **TEMPORARY** duplicate of
 * current `stock_on_hand` (same as `closing_stock` from the Items API) until
 * a real opening snapshot exists; see `transaction_debug.opening_stock_is_temporary_fallback`
 * in `weeklyReportZohoData`.
 * @param {object} row - report row
 * @param {Map<string, number>} soldMap
 * @param {Map<string, number>} purchMap
 * @param {Map<string, number>} retMap
 */
function applyTransactionMapsToRow(row, soldMap, purchMap, retMap) {
  const sold = mapLookupForReportRow(soldMap, row)
  const pur = mapLookupForReportRow(purchMap, row)
  const ret = mapLookupForReportRow(retMap, row)
  row.sold = sold
  row.purchases = pur
  row.returned_to_wholesale = ret
  // opening_stock: intentionally unchanged — set with closing from parseZohoStockOnHand
  // (TEMPORARY: no historical "stock on from_date" in Items v1; see weeklyReportZohoData).
}

module.exports = {
  buildItemIdToSkuMap,
  lineCanonicalKey,
  sumLinesToMap,
  mapLookupForReportRow,
  applyTransactionMapsToRow,
  _internals: { parseLineQty, lineCanonicalKey },
}
