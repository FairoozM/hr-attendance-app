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
 * Priority: sku on line (fast, e.g. from salesbyitem report) → item_id→sku lookup → item_id → name.
 * @param {{ item_id?: unknown, sku?: string, name?: string }} line
 * @param {Map<string, string>} idToSku
 * @returns {string|null}
 */
function lineCanonicalKey(line, idToSku) {
  // Fast path: sku already on the line (e.g. from /reports/salesbyitem)
  if (line.sku && String(line.sku).trim() !== '') {
    return `s:${String(line.sku).trim().toLowerCase()}`
  }
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
 * Same as sumLinesToMap but sums `item_total` (currency amount) instead of quantity.
 * @param {Array<{ item_id?: unknown, name?: string, item_total?: unknown }>} lines
 * @param {Map<string, string>} idToSku
 * @returns {Map<string, number>}
 */
function sumAmountsToMap(lines, idToSku) {
  const map = new Map()
  for (const line of lines || []) {
    const k = lineCanonicalKey(line, idToSku)
    if (!k) continue
    const a = parseLineQty(line.item_total)
    map.set(k, (map.get(k) || 0) + a)
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
 * Fills sold, purchases, returned_to_wholesale, sales_amount, and purchase_amount on an item row.
 * @param {object} row - report row
 * @param {Map<string, number>} soldMap         - quantity sold
 * @param {Map<string, number>} purchMap        - quantity purchased
 * @param {Map<string, number>} retMap          - quantity returned
 * @param {Map<string, number>} [salesAmountMap]  - invoice item_total (currency)
 * @param {Map<string, number> | null} [purchAmountMap]  - purchase $ from Zoho; omit (null) when the caller
 *   overwrites with qty × item rate (e.g. weekly Zoho report).
 */
function applyTransactionMapsToRow(row, soldMap, purchMap, retMap, salesAmountMap, purchAmountMap) {
  row.sold = mapLookupForReportRow(soldMap, row)
  row.purchases = mapLookupForReportRow(purchMap, row)
  row.returned_to_wholesale = mapLookupForReportRow(retMap, row)
  row.sales_amount = salesAmountMap ? mapLookupForReportRow(salesAmountMap, row) : 0
  row.purchase_amount = purchAmountMap ? mapLookupForReportRow(purchAmountMap, row) : 0
}

/**
 * Return a new Map equal to `total` minus `subtract`, clamped to ≥ 0.
 * Used to exclude a specific warehouse's contribution from the all-warehouse totals.
 *
 * @param {Map<string, number>} total
 * @param {Map<string, number>} subtract
 * @returns {Map<string, number>}
 */
function subtractMaps(total, subtract) {
  if (!subtract || subtract.size === 0) return total
  const result = new Map(total)
  for (const [k, v] of subtract) {
    result.set(k, Math.max(0, (result.get(k) || 0) - v))
  }
  return result
}

module.exports = {
  buildItemIdToSkuMap,
  lineCanonicalKey,
  sumLinesToMap,
  sumAmountsToMap,
  subtractMaps,
  mapLookupForReportRow,
  applyTransactionMapsToRow,
  _internals: { parseLineQty, lineCanonicalKey },
}
