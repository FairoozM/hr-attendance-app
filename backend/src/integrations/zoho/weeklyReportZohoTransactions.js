/**
 * Zoho Inventory v1 — fetch invoices, bills, vendor credits for the weekly
 * report. All sales (invoices) are unfiltered; bills and vendor credits
 * are filtered in memory by vendor (see `matchesReportVendor` in
 * `../../services/weeklyReportReportVendor.js`).
 *
 * **Assumptions (see `docs/weekly-report-zoho-transactions.md`):**
 * - SOLD = sum of `line_items.quantity` on **Invoices** with `date` in [from,to],
 *   `status` not `void` (invoices in draft with stock impact depend on your org; we
 *   only exclude void by default).
 * - Purchases = same on **Bills** for the configured vendor.
 * - Returned to wholesale = same on **Vendor Credits** for the configured vendor.
 * - List responses are **paginated**; we may truncate after `maxPages` and set `truncated`.
 */

const { fetchListPaginated, zohoApiRequest } = require('./zohoInventoryClient')
const { INVENTORY_V1 } = require('./zohoConfig')
// Vendor credits are still loaded from the bills/vc cache (no report endpoint for them).
const { fetchAllVendorCreditsRaw } = require('./zohoTransactionsCache')

const MAX_DEFAULT_PAGES = 50

/**
 * @param {string|undefined} iso
 * @param {string} from - YYYY-MM-DD
 * @param {string} to
 */
function isDateInRangeIncl(iso, from, to) {
  if (!iso) return false
  const s = String(iso).slice(0, 10)
  return s.length >= 10 && s >= from && s <= to
}

function parseLineQty(v) {
  if (v == null) return 0
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = parseFloat(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

/**
 * @param {object} doc
 * @returns {boolean}
 */
function isNotVoidStatus(doc) {
  const s = doc && (doc.status != null ? String(doc.status) : '')
  return s && s.toLowerCase() !== 'void'
}

/**
 * @param {string | number | undefined} actualId
 * @param {string} expectedId
 * @param {string | undefined} actualName
 * @param {string} expectedName
 */
function matchesReportVendor(actualId, expectedId, actualName, expectedName) {
  if (expectedId && String(expectedId).trim() !== '') {
    // String compare: Zoho uses long digit ids; avoid JavaScript number (unsafe > 2^53-1)
    return String(actualId ?? '').trim() === String(expectedId).trim()
  }
  if (expectedName && String(expectedName).trim() !== '') {
    const a = (actualName && String(actualName).trim().toLowerCase()) || ''
    return a === String(expectedName).trim().toLowerCase()
  }
  return false
}

/**
 * List responses often omit `line_items`; a single line is sometimes a lone object, not an array.
 * @param {unknown} lineItems
 * @returns {object[]}
 */
function normalizeZohoLineItems(lineItems) {
  if (lineItems == null) return []
  if (Array.isArray(lineItems)) return lineItems
  if (typeof lineItems === 'object' && (lineItems.item_id != null || lineItems.line_item_id != null)) {
    return [lineItems]
  }
  return []
}

/**
 * `vendor_credits_contact_id` may line up with `vendor_id` or the list field `customer_id` (Zoho's vendor contact id on the document).
 * @param {object} vc
 * @param {string|undefined} expectedVendorId
 * @param {string|undefined} expectedVendorName
 */
function matchesVendorCreditDocument(vc, expectedVendorId, expectedVendorName) {
  if (matchesReportVendor(vc.vendor_id, expectedVendorId, vc.vendor_name, expectedVendorName)) {
    return true
  }
  if (expectedVendorId && String(expectedVendorId).trim() !== '' && vc && vc.customer_id != null) {
    if (String(vc.customer_id).trim() === String(expectedVendorId).trim()) return true
  }
  return false
}

/**
 * Per-item sales totals for the date range using the Zoho "Sales by Item" report.
 *
 * Why this endpoint instead of /invoices list:
 *   The /invoices list API does NOT return line_items — you would need a separate
 *   GET /invoices/:id per invoice (hundreds of calls). The /reports/salesbyitem
 *   endpoint returns pre-aggregated quantity_sold + amount per item in a single
 *   paginated call, which is ~100× faster.
 *
 * @param {string} fromDate  YYYY-MM-DD
 * @param {string} toDate    YYYY-MM-DD
 * @param {{ onWarning?: (s: string) => void }} [opts]
 * @returns {Promise<{ lines: object[], document_count: number, list_truncated: boolean, list_pages: number, error: Error|null }>}
 */
async function getSales(fromDate, toDate, opts = {}) {
  const onW = typeof opts.onWarning === 'function' ? opts.onWarning : () => {}
  const warehouseId = opts.warehouseId && String(opts.warehouseId).trim() !== '' ? String(opts.warehouseId).trim() : null
  const t0 = Date.now()
  try {
    const dateParams = new URLSearchParams()
    if (fromDate) dateParams.set('from_date', fromDate)
    if (toDate) dateParams.set('to_date', toDate)
    if (warehouseId) dateParams.set('warehouse_id', warehouseId)

    const { rows, truncated, pages } = await fetchListPaginated(
      `${INVENTORY_V1}/reports/salesbyitem`,
      'sales',
      MAX_DEFAULT_PAGES,
      dateParams
    )
    console.log(`[zoho-timing] salesbyitem: ${rows.length} items, ${pages} page(s), ${Date.now() - t0}ms`)
    if (truncated) {
      onW('Sales by Item report may be incomplete: pagination cap reached. Narrow the date range.')
    }

    // Normalise into the same line shape used by sumLinesToMap / sumAmountsToMap.
    // `sku` is available directly from `row.item.sku` which lets lineCanonicalKey
    // skip the item_id→sku lookup and key by s:<sku> directly.
    const lineRows = rows.map((r) => ({
      type: 'sales_report',
      item_id: r.item_id || '',
      name: r.item_name || '',
      sku: (r.item && r.item.sku) ? String(r.item.sku).trim() : '',
      quantity: typeof r.quantity_sold === 'number' ? r.quantity_sold : parseLineQty(r.quantity_sold),
      item_total: typeof r.amount === 'number' ? r.amount : parseLineQty(r.amount),
    }))

    return {
      lines: lineRows,
      line_count: lineRows.length,
      document_count: rows.length,
      list_truncated: truncated,
      list_pages: pages,
      error: null,
    }
  } catch (e) {
    onW(e && e.message ? e.message : String(e))
    return { lines: [], line_count: 0, document_count: 0, list_truncated: false, list_pages: 0, error: e }
  }
}

/**
 * Fetch all purchase rows from the Zoho "Purchases by Item" report for a date range.
 *
 * The response nests items inside `purchases_by_item[n].purchase[]`, unlike
 * `salesbyitem` which has a flat `sales[]` array. We flatten across all groups
 * and pages into a single array.
 *
 * @param {string} fromDate  YYYY-MM-DD
 * @param {string} toDate    YYYY-MM-DD
 * @returns {Promise<{ rows: object[], truncated: boolean, pages: number }>}
 */
async function fetchPurchasesByItemReport(fromDate, toDate, warehouseId = null) {
  const allItems = []
  let page = 1
  const maxPages = MAX_DEFAULT_PAGES
  const t0 = Date.now()
  while (page <= maxPages) {
    const p = new URLSearchParams()
    if (fromDate) p.set('from_date', fromDate)
    if (toDate) p.set('to_date', toDate)
    if (warehouseId) p.set('warehouse_id', warehouseId)
    p.set('page', String(page))
    p.set('per_page', '200')
    const json = await zohoApiRequest(`${INVENTORY_V1}/reports/purchasesbyitem`, p)
    // Response shape: purchases_by_item: [{ purchase: [{item_id, item_name, quantity_purchased, amount, item:{sku}}] }]
    const groups = Array.isArray(json.purchases_by_item) ? json.purchases_by_item : []
    let pageCount = 0
    for (const group of groups) {
      const items = Array.isArray(group.purchase) ? group.purchase : []
      pageCount += items.length
      allItems.push(...items)
    }
    const hasMore = json.page_context && json.page_context.has_more_page === true
    if (!hasMore || pageCount === 0) {
      console.log(`[zoho-timing] purchasesbyitem: ${allItems.length} items, ${page} page(s), ${Date.now() - t0}ms`)
      return { rows: allItems, truncated: false, pages: page }
    }
    if (page === maxPages) {
      console.warn(`[zoho-timing] purchasesbyitem: safety limit ${maxPages} pages reached — ${allItems.length} items, TRUNCATED`)
      return { rows: allItems, truncated: true, pages: maxPages }
    }
    page++
  }
  return { rows: allItems, truncated: false, pages: page - 1 }
}

/** Module-level cache so repeated report calls within 5 min share one fetch. */
let _purchasesReportCache = null
let _purchasesReportInFlight = null
const PURCHASES_CACHE_TTL_MS = 5 * 60 * 1000

async function fetchPurchasesByItemReportCached(fromDate, toDate, warehouseId = null) {
  const key = `${fromDate}::${toDate}::${warehouseId || ''}`
  if (_purchasesReportCache && _purchasesReportCache.key === key && Date.now() < _purchasesReportCache.expiresAt) {
    return _purchasesReportCache.rows
  }
  if (_purchasesReportInFlight && _purchasesReportInFlight.key === key) return _purchasesReportInFlight.promise
  const promise = fetchPurchasesByItemReport(fromDate, toDate, warehouseId).then(({ rows }) => {
    _purchasesReportCache = { key, rows, expiresAt: Date.now() + PURCHASES_CACHE_TTL_MS }
    _purchasesReportInFlight = null
    return rows
  }).catch((e) => { _purchasesReportInFlight = null; throw e })
  _purchasesReportInFlight = { key, promise }
  return promise
}

/**
 * Per-item purchase totals for the date range using the Zoho "Purchases by Item" report.
 * Returns all vendors (no vendor filter) — grouping by family already provides the
 * right level of aggregation for the weekly report.
 *
 * @param {string} fromDate
 * @param {string} toDate
 * @param {string | undefined} _vendorId — kept for API compatibility, ignored
 * @param {{ onWarning?: (s: string) => void }} [opts]
 */
async function getPurchases(fromDate, toDate, _vendorId, opts = {}) {
  const onW = typeof opts.onWarning === 'function' ? opts.onWarning : () => {}
  const warehouseId = opts.warehouseId && String(opts.warehouseId).trim() !== '' ? String(opts.warehouseId).trim() : null
  const t0 = Date.now()
  try {
    const rows = await fetchPurchasesByItemReportCached(fromDate, toDate, warehouseId)
    console.log(`[zoho-timing] purchasesbyitem (cached): ${rows.length} items, ${Date.now() - t0}ms`)

    // Normalise into the same line shape used by sumLinesToMap / sumAmountsToMap
    const lineRows = rows.map((r) => ({
      type: 'purchases_report',
      item_id: r.item_id || '',
      name: r.item_name || '',
      sku: (r.item && r.item.sku) ? String(r.item.sku).trim() : '',
      quantity: typeof r.quantity_purchased === 'number' ? r.quantity_purchased : parseLineQty(r.quantity_purchased),
      item_total: typeof r.amount === 'number' ? r.amount : parseLineQty(r.amount),
    }))

    return {
      lines: lineRows,
      line_count: lineRows.length,
      document_count: rows.length,
      list_truncated: false,
      list_pages: 0,
      error: null,
    }
  } catch (e) {
    onW(e && e.message ? e.message : String(e))
    return { lines: [], line_count: 0, document_count: 0, list_truncated: false, list_pages: 0, error: e }
  }
}

/**
 * Vendor credit line rows for a single vendor.
 * Zoho stores `vendor_id` and `vendor_name` on the vendor credit document; we filter
 * in memory by `vendor_id` (or `vendor_name` when `opts.vendorName` is used).
 *
 * @param {string | undefined} vendorId — `REPORT_VENDOR_ID` (Zoho `vendor_id`)
 * @param {{ vendorName?: string, onWarning?: (s: string) => void }} [opts]
 */
async function getVendorCredits(fromDate, toDate, vendorId, opts = {}) {
  const onW = typeof opts.onWarning === 'function' ? opts.onWarning : () => {}
  const vname = opts.vendorName
  if ((vendorId == null || String(vendorId).trim() === '') && !vname) {
    return {
      lines: [],
      line_count: 0,
      document_count: 0,
      list_truncated: false,
      list_pages: 0,
      error: null,
    }
  }
  const vid = vendorId != null && String(vendorId).trim() !== '' ? String(vendorId).trim() : undefined
  const vname2 = vname
  const t0 = Date.now()
  const detailById = new Map()
  const fetchVendorCreditDetail = (creditId) => {
    if (!creditId) return Promise.resolve(null)
    const id = String(creditId)
    if (detailById.has(id)) return detailById.get(id)
    const p = (async () => {
      try {
        const p2 = new URLSearchParams()
        const json = await zohoApiRequest(
          `${INVENTORY_V1}/vendorcredits/${encodeURIComponent(id)}`,
          p2
        )
        return (json && json.vendor_credit) || null
      } catch (e) {
        onW(`GET /vendorcredits/${id} — ${e && e.message ? e.message : String(e)}`)
        return null
      }
    })()
    detailById.set(id, p)
    return p
  }
  try {
    // Vendor credits are served from the module-level TTL cache (fetchAllVendorCreditsRaw).
    // Zoho's **list** response may omit `line_items`; in that case load each doc with GET /vendorcredits/{id} (Zoho API docs show line items on the single-record response).
    const rows = await fetchAllVendorCreditsRaw()
    console.log(`[zoho-timing] vendorcredits: ${rows.length} docs, cache, ${Date.now() - t0}ms`)
    const lineRows = []
    for (const vc of rows) {
      if (!isNotVoidStatus(vc)) continue
      if (!isDateInRangeIncl(vc.date, fromDate, toDate)) continue
      if (!matchesVendorCreditDocument(vc, vid, vname2)) continue
      let lines = normalizeZohoLineItems(vc.line_items)
      if (lines.length === 0 && vc.vendor_credit_id) {
        const full = await fetchVendorCreditDetail(vc.vendor_credit_id)
        if (full) lines = normalizeZohoLineItems(full.line_items)
      }
      for (const li of lines) {
        const sku = li.sku && String(li.sku).trim() ? String(li.sku).trim() : ''
        lineRows.push({
          type: 'vendor_credit',
          document_id: vc.vendor_credit_id,
          document_date: vc.date,
          item_id: li.item_id,
          name: li.name,
          sku,
          quantity: parseLineQty(li.quantity),
        })
      }
    }
    return {
      lines: lineRows,
      line_count: lineRows.length,
      document_count: rows.length,
      list_truncated: false,
      list_pages: 0,
      error: null,
    }
  } catch (e) {
    onW(e && e.message ? e.message : String(e))
    return { lines: [], line_count: 0, document_count: 0, list_truncated: false, list_pages: 0, error: e }
  }
}

module.exports = {
  getSales,
  getPurchases,
  getVendorCredits,
  isDateInRangeIncl,
  _internals: {
    parseLineQty,
    matchesReportVendor,
    normalizeZohoLineItems,
    matchesVendorCreditDocument,
  },
}
