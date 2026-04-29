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
 * - Purchases = **Bills** `line_items` (unfiltered to vendor by default, or the contact
 *   in `WEEKLY_REPORT_PURCHASES_*` / JSON when `by_contact_id`). **Not** the
 *   Purchases-by-Item report, which can mirror return-like per-item numbers.
 * - Returned to wholesale = same on **Vendor Credits** for the configured vendor.
 * - List responses are **paginated**; we may truncate after `maxPages` and set `truncated`.
 */

const { fetchListPaginated, zohoApiRequest } = require('./zohoInventoryClient')
const { INVENTORY_V1 } = require('./zohoConfig')
// Bills and vendor credits: full lists are cached; filter in memory by date / vendor.
const { fetchAllBillsRaw, fetchAllVendorCreditsRaw } = require('./zohoTransactionsCache')
const { getVendorConfigForGroup } = require('../../services/weeklyReportVendorConfig')

const MAX_DEFAULT_PAGES = 50
/** Lower than before to reduce burst traffic against Zoho’s daily quota. */
const DETAIL_CONCURRENCY = 4
const SALES_DETAIL_CACHE_TTL_MS =
  process.env.ZOHO_ITEMS_CACHE_TTL_MS !== undefined
    ? Math.max(0, parseInt(process.env.ZOHO_ITEMS_CACHE_TTL_MS, 10) || 0)
    : 5 * 60 * 1000

/**
 * Cross-request TTL cache for GET /invoices/{id}, /bills/{id}, /vendorcredits/{id}.
 * Without this, each weekly report refresh re-fetches hundreds of documents.
 * Default 30 min (longer than list caches).
 */
const DOCUMENT_DETAIL_CACHE_TTL_MS =
  process.env.ZOHO_DOCUMENT_DETAIL_CACHE_TTL_MS !== undefined
    ? Math.max(0, parseInt(process.env.ZOHO_DOCUMENT_DETAIL_CACHE_TTL_MS, 10) || 0)
    : 30 * 60 * 1000

const MAX_DOCUMENT_DETAIL_CACHE_ENTRIES = 4000

/** @type {Map<string, { doc: object, expiresAt: number }>} */
const _invoiceDetailById = new Map()
/** @type {Map<string, { doc: object, expiresAt: number }>} */
const _billDetailById = new Map()
/** @type {Map<string, { doc: object, expiresAt: number }>} */
const _vendorCreditDetailById = new Map()

function trimDocCache(m) {
  while (m.size >= MAX_DOCUMENT_DETAIL_CACHE_ENTRIES) {
    const k = m.keys().next().value
    m.delete(k)
  }
}

function getCachedDocDetail(m, id) {
  const k = String(id || '')
  const hit = m.get(k)
  if (!hit) return null
  if (Date.now() >= hit.expiresAt) {
    m.delete(k)
    return null
  }
  return hit.doc
}

function setCachedDocDetail(m, id, doc) {
  if (!DOCUMENT_DETAIL_CACHE_TTL_MS || !doc || !id) return
  trimDocCache(m)
  m.set(String(id), { doc, expiresAt: Date.now() + DOCUMENT_DETAIL_CACHE_TTL_MS })
}

const _salesDetailCache = new Map()
const _salesDetailInFlight = new Map()

/** Reserved for future use; weekly sales $ uses pre-tax `amount` only (see `itemTotalNetFromSalesByItemRow`). */
function resolveWeeklyReportSalesVatRate() {
  const raw = process.env.WEEKLY_REPORT_SALES_VAT_RATE
  if (raw === undefined || String(raw).trim() === '') return 0.15
  const n = parseFloat(String(raw).replace(/,/g, '').trim())
  if (!Number.isFinite(n) || n < 0) return 0.15
  return n
}

/**
 * "Sales by Item" report line total for the weekly `sales_amount` column: use Zoho’s
 * **pre-tax** value only. Prefer explicit tax-exclusive fields when present, else
 * `amount` from the report. Does **not** add line tax, VAT, or `WEEKLY_REPORT_SALES_VAT_RATE`.
 *
 * @param {object} r - one row from `/inventory/v1/reports/salesbyitem` `sales[]`
 */
function itemTotalNetFromSalesByItemRow(r) {
  if (!r || typeof r !== 'object') return 0
  const p = (v) => {
    if (v == null) return 0
    if (v === '') return 0
    if (typeof v === 'number' && Number.isFinite(v)) return v
    return parseLineQty(v)
  }
  for (const k of [
    'amount_excluding_tax',
    'tax_exclusive_amount',
    'exclusive_amount',
    'net_amount',
  ]) {
    if (r[k] == null || r[k] === '') continue
    const v = p(r[k])
    if (Number.isFinite(v)) return v
  }
  if (typeof r.amount === 'number' && Number.isFinite(r.amount)) {
    return r.amount
  }
  return p(r.amount)
}

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

async function promiseConcurrent(tasks, limit) {
  if (!Array.isArray(tasks) || tasks.length === 0) return []
  const results = new Array(tasks.length)
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

function normalizeWarehouseId(v) {
  return v == null || String(v).trim() === '' ? '' : String(v).trim()
}

function resolveLineWarehouseId(line, doc) {
  return (
    normalizeWarehouseId(line && line.warehouse_id) ||
    normalizeWarehouseId(line && line.warehouse && line.warehouse.warehouse_id) ||
    normalizeWarehouseId(line && line.location_id) ||
    normalizeWarehouseId(line && line.location && line.location.location_id) ||
    normalizeWarehouseId(doc && doc.warehouse_id) ||
    normalizeWarehouseId(doc && doc.warehouse && doc.warehouse.warehouse_id) ||
    normalizeWarehouseId(doc && doc.location_id) ||
    normalizeWarehouseId(doc && doc.location && doc.location.location_id)
  )
}

function resolveLineWarehouseName(line, doc) {
  return (
    (line && line.warehouse_name && String(line.warehouse_name)) ||
    (line && line.warehouse && line.warehouse.warehouse_name && String(line.warehouse.warehouse_name)) ||
    (line && line.location_name && String(line.location_name)) ||
    (line && line.location && line.location.location_name && String(line.location.location_name)) ||
    (doc && doc.warehouse_name && String(doc.warehouse_name)) ||
    (doc && doc.warehouse && doc.warehouse.warehouse_name && String(doc.warehouse.warehouse_name)) ||
    (doc && doc.location_name && String(doc.location_name)) ||
    (doc && doc.location && doc.location.location_name && String(doc.location.location_name)) ||
    ''
  )
}

function makeWarehouseLineFilter(opts = {}) {
  const includeId = normalizeWarehouseId(opts.warehouseId)
  const excludeId = normalizeWarehouseId(opts.excludeWarehouseId)
  if (!includeId && !excludeId) return () => true
  return (line, doc) => {
    const wid = resolveLineWarehouseId(line, doc)
    if (!wid) return false
    if (includeId) return wid === includeId
    if (excludeId) return wid !== excludeId
    return true
  }
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
  const exp = expectedVendorId && String(expectedVendorId).trim() !== '' ? String(expectedVendorId).trim() : ''
  if (!exp || !vc) return false
  // Contact id from WEEKLY_REPORT_VENDORS_JSON / vendor_credits_contact_id may sit on
  // customer_id, contact_id, or vendor_contact_id depending on org / API version.
  for (const k of ['customer_id', 'contact_id', 'vendor_contact_id', 'contact_person_id']) {
    if (vc[k] != null && String(vc[k]).trim() === exp) return true
  }
  return false
}

/**
 * Bills: match `vendor_id` / `vendor_name` or the same contact-id fields as vendor credits.
 * Used when `WEEKLY_REPORT_PURCHASES_MODE=by_contact_id`.
 * @param {object} bill
 * @param {string|undefined} expectedVendorId
 * @param {string|undefined} expectedVendorName
 */
function matchesBillDocument(bill, expectedVendorId, expectedVendorName) {
  if (!bill) return false
  if (matchesReportVendor(bill.vendor_id, expectedVendorId, bill.vendor_name, expectedVendorName)) {
    return true
  }
  if (expectedVendorName && String(expectedVendorName).trim() !== '') return false
  return matchesVendorCreditDocument(bill, expectedVendorId, undefined)
}

/**
 * Best-effort line amount on a vendor credit line (Zoho field names vary).
 * Weekly report also values returns as **qty × item sales price**; this is a fallback.
 * @param {object} li
 */
function parseVendorCreditLineDollarAmount(li) {
  if (!li || typeof li !== 'object') return 0
  const p = (v) => {
    if (v == null) return 0
    if (v === '') return 0
    if (typeof v === 'number' && Number.isFinite(v)) return v
    return parseLineQty(v)
  }
  for (const k of [
    'item_total',
    'line_item_total',
    'line_total',
    'bcy_line_item_total',
    'bcy_item_total',
    'item_sub_total',
    'sub_total',
    'bcy_sub_total',
    'total',
  ]) {
    if (li[k] == null || li[k] === '') continue
    const a = p(li[k])
    if (a > 0) return a
  }
  const q = p(li.quantity) || p(li.qty) || 0
  for (const rk of ['rate', 'sales_rate', 'item_rate', 'bcy_rate', 'item_rate_formatted', 'item_price']) {
    if (li[rk] == null || li[rk] === '') continue
    const rate = p(li[rk])
    if (q > 0 && rate > 0) {
      return Math.round(q * rate * 100) / 100
    }
  }
  return 0
}

/**
 * @param {object} li
 * @returns {{ item_id: string, name: string, sku: string, quantity: number, item_total: number, warehouse_id: string, warehouse_name: string }}
 */
function normalizeVendorCreditLineItem(li) {
  if (!li || typeof li !== 'object') {
    return { item_id: '', name: '', sku: '', quantity: 0, item_total: 0, warehouse_id: '', warehouse_name: '' }
  }
  const it = li.item && typeof li.item === 'object' ? li.item : null
  const itemId =
    li.item_id != null && String(li.item_id).trim() !== ''
      ? String(li.item_id).trim()
      : it && it.item_id != null
        ? String(it.item_id).trim()
        : ''
  const sku = (() => {
    if (li.sku != null && String(li.sku).trim() !== '') return String(li.sku).trim()
    if (it && it.sku != null && String(it.sku).trim() !== '') return String(it.sku).trim()
    return ''
  })()
  const name =
    (li.name && String(li.name)) ||
    (li.item_name && String(li.item_name)) ||
    (it && it.name && String(it.name)) ||
    (it && it.item_name && String(it.item_name)) ||
    ''
  const quantity = parseLineQty(li.quantity != null ? li.quantity : li.qty)
  const item_total = parseVendorCreditLineDollarAmount(li)
  const warehouse_id = resolveLineWarehouseId(li, null)
  const warehouse_name = resolveLineWarehouseName(li, null)
  return { item_id: itemId, name, sku, quantity, item_total, warehouse_id, warehouse_name }
}

function makeSalesByItemKey(r) {
  const itemId = r && r.item_id != null ? String(r.item_id).trim() : ''
  if (itemId) return `id:${itemId}`
  const sku = r && r.sku != null ? String(r.sku).trim().toLowerCase() : ''
  if (sku) return `sku:${sku}`
  const nm = r && (r.name != null || r.item_name != null)
    ? String(r.name != null ? r.name : r.item_name).trim().toLowerCase()
    : ''
  return nm ? `name:${nm}` : ''
}

function normalizeSalesByItemLine(r, forcedWarehouseId = '') {
  const item_id = r && r.item_id != null ? String(r.item_id).trim() : ''
  const sku = r && r.sku != null ? String(r.sku).trim() : ''
  const name = r && (r.name != null || r.item_name != null)
    ? String(r.name != null ? r.name : r.item_name).trim()
    : ''
  const quantity = parseLineQty(
    r && (r.quantity != null ? r.quantity : (r.qty != null ? r.qty : (r.quantity_sold != null ? r.quantity_sold : r.sold_quantity)))
  )
  const item_total = itemTotalNetFromSalesByItemRow(r)
  return {
    type: 'sales_by_item',
    document_id: '',
    document_date: '',
    item_id,
    name,
    sku,
    quantity: Math.max(0, quantity),
    item_total: Math.max(0, item_total),
    warehouse_id: forcedWarehouseId || '',
    warehouse_name: '',
  }
}

async function fetchSalesByItemRows(fromDate, toDate, warehouseId = '') {
  const params = new URLSearchParams()
  if (fromDate) params.set('from_date', fromDate)
  if (toDate) params.set('to_date', toDate)
  if (warehouseId) params.set('warehouse_id', warehouseId)
  const { rows, truncated, pages } = await fetchListPaginated(
    `${INVENTORY_V1}/reports/salesbyitem`,
    'sales',
    MAX_DEFAULT_PAGES,
    params
  )
  return { rows, truncated, pages }
}

function subtractSalesByItemLines(allLines, minusLines) {
  const m = new Map()
  for (const line of allLines) {
    const k = makeSalesByItemKey(line)
    if (!k) continue
    if (!m.has(k)) m.set(k, { ...line })
    else {
      const cur = m.get(k)
      cur.quantity += Number(line.quantity) || 0
      cur.item_total += Number(line.item_total) || 0
    }
  }
  for (const line of minusLines) {
    const k = makeSalesByItemKey(line)
    if (!k || !m.has(k)) continue
    const cur = m.get(k)
    cur.quantity -= Number(line.quantity) || 0
    cur.item_total -= Number(line.item_total) || 0
  }
  const out = []
  for (const v of m.values()) {
    const q = Math.round((Number(v.quantity) || 0) * 100) / 100
    const a = Math.round((Number(v.item_total) || 0) * 100) / 100
    if (q <= 0 && Math.abs(a) < 0.005) continue
    out.push({
      ...v,
      quantity: q > 0 ? q : 0,
      item_total: a > 0 ? a : 0,
    })
  }
  return out
}

async function getSalesFromInvoicesSlow(fromDate, toDate, opts = {}) {
  const onW = typeof opts.onWarning === 'function' ? opts.onWarning : () => {}
  const lineFilter = makeWarehouseLineFilter(opts)
  const t0 = Date.now()
  try {
    const dateParams = new URLSearchParams()
    if (fromDate) dateParams.set('date_start', fromDate)
    if (toDate) dateParams.set('date_end', toDate)

    const { rows, truncated, pages } = await fetchListPaginated(
      `${INVENTORY_V1}/invoices`,
      'invoices',
      MAX_DEFAULT_PAGES,
      dateParams
    )
    console.log(`[zoho-timing] invoices list: ${rows.length} docs, ${pages} page(s), ${Date.now() - t0}ms`)
    if (truncated) {
      onW('Invoices list may be incomplete: pagination cap reached. Narrow the date range.')
    }

    const invoices = rows.filter((inv) => {
      if (!isNotVoidStatus(inv)) return false
      const d = inv && inv.date != null ? String(inv.date) : ''
      return isDateInRangeIncl(d, fromDate, toDate)
    })
    const detailTasks = invoices.map((inv) => async () => {
      const iid = inv.invoice_id != null && String(inv.invoice_id).trim() !== '' ? String(inv.invoice_id).trim() : ''
      let full = inv
      if (iid && normalizeZohoLineItems(inv.line_items).length === 0) {
        const cached = getCachedDocDetail(_invoiceDetailById, iid)
        if (cached) {
          full = cached
        } else {
          try {
            const json = await zohoApiRequest(`${INVENTORY_V1}/invoices/${encodeURIComponent(iid)}`)
            full = (json && json.invoice) || inv
            if (full && full !== inv) setCachedDocDetail(_invoiceDetailById, iid, full)
          } catch (e) {
            onW(`GET /invoices/${iid} - ${e && e.message ? e.message : String(e)}`)
          }
        }
      }
      return full
    })
    const fullInvoices = await promiseConcurrent(detailTasks, DETAIL_CONCURRENCY)
    const lineRows = []
    for (const inv of fullInvoices) {
      const iid = inv && inv.invoice_id != null ? String(inv.invoice_id).trim() : ''
      const docDate = inv && inv.date != null ? String(inv.date).slice(0, 10) : ''
      for (const li of normalizeZohoLineItems(inv && inv.line_items)) {
        if (!lineFilter(li, inv)) continue
        const n = normalizeVendorCreditLineItem(li)
        lineRows.push({
          type: 'invoice',
          document_id: iid,
          document_date: docDate,
          item_id: n.item_id,
          name: n.name,
          sku: n.sku,
          quantity: n.quantity,
          item_total: n.item_total,
          warehouse_id: resolveLineWarehouseId(li, inv),
          warehouse_name: n.warehouse_name || resolveLineWarehouseName(li, inv),
        })
      }
    }
    console.log(`[zoho-timing] invoice details: ${lineRows.length} lines, ${Date.now() - t0}ms`)

    return {
      lines: lineRows,
      line_count: lineRows.length,
      document_count: invoices.length,
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
 * Sales line items for weekly report.
 *
 * Fast path: `/reports/salesbyitem` (pre-aggregated by item, no per-invoice fan-out).
 * Fallback path: invoice detail fan-out (`/invoices/{id}`) for compatibility when
 * sales-by-item is unavailable.
 *
 * For `excludeWarehouseId`, computes:
 *   all-warehouses sales_by_item  minus  excluded-warehouse sales_by_item.
 */
async function getSalesUncached(fromDate, toDate, opts = {}) {
  const onW = typeof opts.onWarning === 'function' ? opts.onWarning : () => {}
  const includeId = normalizeWarehouseId(opts.warehouseId)
  const excludeId = normalizeWarehouseId(opts.excludeWarehouseId)
  const t0 = Date.now()

  try {
    if (includeId) {
      const rep = await fetchSalesByItemRows(fromDate, toDate, includeId)
      const lines = (rep.rows || []).map((r) => normalizeSalesByItemLine(r, includeId))
      console.log(`[zoho-timing] salesbyitem include:${includeId} rows=${lines.length}, pages=${rep.pages}, ${Date.now() - t0}ms`)
      return {
        lines,
        line_count: lines.length,
        document_count: lines.length,
        list_truncated: !!rep.truncated,
        list_pages: rep.pages || 0,
        error: null,
      }
    }

    if (excludeId) {
      const [allRep, exRep] = await Promise.all([
        fetchSalesByItemRows(fromDate, toDate, ''),
        fetchSalesByItemRows(fromDate, toDate, excludeId),
      ])
      const allLines = (allRep.rows || []).map((r) => normalizeSalesByItemLine(r, ''))
      const exLines = (exRep.rows || []).map((r) => normalizeSalesByItemLine(r, excludeId))
      const lines = subtractSalesByItemLines(allLines, exLines)
      console.log(`[zoho-timing] salesbyitem exclude:${excludeId} all=${allLines.length} minus=${exLines.length} out=${lines.length}, ${Date.now() - t0}ms`)
      return {
        lines,
        line_count: lines.length,
        document_count: lines.length,
        list_truncated: !!(allRep.truncated || exRep.truncated),
        list_pages: Math.max(allRep.pages || 0, exRep.pages || 0),
        error: null,
      }
    }

    const rep = await fetchSalesByItemRows(fromDate, toDate, '')
    const lines = (rep.rows || []).map((r) => normalizeSalesByItemLine(r, ''))
    console.log(`[zoho-timing] salesbyitem rows=${lines.length}, pages=${rep.pages}, ${Date.now() - t0}ms`)
    return {
      lines,
      line_count: lines.length,
      document_count: lines.length,
      list_truncated: !!rep.truncated,
      list_pages: rep.pages || 0,
      error: null,
    }
  } catch (fastErr) {
    onW(`Sales by Item fast path failed; using invoice detail fallback. ${fastErr && fastErr.message ? fastErr.message : String(fastErr)}`)
    return getSalesFromInvoicesSlow(fromDate, toDate, opts)
  }
}

async function getSales(fromDate, toDate, opts = {}) {
  const key = [
    String(fromDate || ''),
    String(toDate || ''),
    normalizeWarehouseId(opts.warehouseId),
    normalizeWarehouseId(opts.excludeWarehouseId),
  ].join('|')
  const hit = _salesDetailCache.get(key)
  if (hit && Date.now() < hit.expiresAt) return hit.value
  if (_salesDetailInFlight.has(key)) return _salesDetailInFlight.get(key)
  const p = getSalesUncached(fromDate, toDate, opts)
    .then((value) => {
      if (value && !value.error && SALES_DETAIL_CACHE_TTL_MS > 0) {
        _salesDetailCache.set(key, { value, expiresAt: Date.now() + SALES_DETAIL_CACHE_TTL_MS })
      }
      return value
    })
    .finally(() => {
      _salesDetailInFlight.delete(key)
    })
  _salesDetailInFlight.set(key, p)
  return p
}

/**
 * Purchase **line items** from Zoho `GET /inventory/v1/bills` (not the Purchases-by-Item
 * report): bill lines are actual purchases, whereas the report can show per-item figures
 * that line up with vendor-credit return qty and **duplicate the same $** as
 * "Returned to wholesale" in the same period.
 *
 * **Default (unfiltered):** all vendors’ bills in the date range — same intent as the old
 * sales-by-item report usage. For `WEEKLY_REPORT_PURCHASES_MODE=by_contact_id` (+ contact id
 * in env or `WEEKLY_REPORT_VENDORS_JSON`), only bills for that contact/vendor.
 *
 * @param {string} fromDate
 * @param {string} toDate
 * @param {string | undefined} _vendorId — API compatibility; bill scope uses JSON/env purchase mode, not the report-vendor id
 * @param {{ onWarning?: (s: string) => void, reportGroup?: string, warehouseId?: string, excludeWarehouseId?: string }} [opts]
 */
async function getPurchases(fromDate, toDate, _vendorId, opts = {}) {
  void _vendorId
  const onW = typeof opts.onWarning === 'function' ? opts.onWarning : () => {}
  const lineFilter = makeWarehouseLineFilter(opts)
  const needsWarehouseDetail = !!(
    opts.includeWarehouseDetail ||
    normalizeWarehouseId(opts.warehouseId) ||
    normalizeWarehouseId(opts.excludeWarehouseId)
  )
  const t0 = Date.now()
  const cfg = getVendorConfigForGroup(String(opts.reportGroup || ''))
  const pMode =
    cfg.purchases && String(cfg.purchases.mode).toLowerCase() === 'by_contact_id' ? 'by_contact_id' : 'unfiltered'
  const pContact =
    pMode === 'by_contact_id' && cfg.purchases && cfg.purchases.contact_id
      ? String(cfg.purchases.contact_id).trim()
      : ''
  if (pMode === 'by_contact_id' && !pContact) {
    onW('WEEKLY_REPORT_PURCHASES_MODE=by_contact_id but no contact_id set; using all vendors for purchases.')
  }
  const filterBill =
    pMode === 'by_contact_id' && pContact
      ? (b) => matchesBillDocument(b, pContact, undefined)
      : () => true
  const detailById = new Map()
  const fetchBillDetail = (billId) => {
    if (!billId) return Promise.resolve(null)
    const id = String(billId)
    if (detailById.has(id)) return detailById.get(id)
    const cached = getCachedDocDetail(_billDetailById, id)
    if (cached) return Promise.resolve(cached)
    const p = (async () => {
      try {
        const p2 = new URLSearchParams()
        const json = await zohoApiRequest(`${INVENTORY_V1}/bills/${encodeURIComponent(id)}`, p2)
        const bill = (json && json.bill) || null
        if (bill) setCachedDocDetail(_billDetailById, id, bill)
        return bill
      } catch (e) {
        onW(`GET /bills/${id} — ${e && e.message ? e.message : String(e)}`)
        return null
      }
    })()
    detailById.set(id, p)
    return p
  }
  try {
    const rows = await fetchAllBillsRaw()
    console.log(`[zoho-timing] bills: ${rows.length} docs, cache, ${Date.now() - t0}ms`)
    const lineRows = []
    let billsInRange = 0
    for (const bill of rows) {
      if (!isNotVoidStatus(bill)) continue
      const rawD = bill && (bill.date != null ? bill.date : bill.bill_date)
      const bdate = rawD != null ? String(rawD) : ''
      if (!isDateInRangeIncl(bdate, fromDate, toDate)) continue
      if (!filterBill(bill)) continue
      let lines = normalizeZohoLineItems(bill.line_items)
      let lineDoc = bill
      const bid = bill.bill_id != null && String(bill.bill_id).trim() !== '' ? String(bill.bill_id).trim() : ''
      if ((needsWarehouseDetail || lines.length === 0) && bid) {
        const full = await fetchBillDetail(bid)
        if (full) {
          lineDoc = full
          lines = normalizeZohoLineItems(full.line_items)
        }
      }
      if (lines.length === 0) continue
      billsInRange += 1
      const docDate = bdate.length >= 10 ? bdate.slice(0, 10) : bdate
      for (const li of lines) {
        if (!lineFilter(li, lineDoc)) continue
        const n = normalizeVendorCreditLineItem(li)
        lineRows.push({
          type: 'bill',
          document_id: bid,
          document_date: docDate,
          item_id: n.item_id,
          name: n.name,
          sku: n.sku,
          quantity: n.quantity,
          item_total: n.item_total,
          warehouse_id: resolveLineWarehouseId(li, lineDoc),
          warehouse_name: n.warehouse_name || resolveLineWarehouseName(li, lineDoc),
        })
      }
    }
    return {
      lines: lineRows,
      line_count: lineRows.length,
      document_count: billsInRange,
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
 * @param {{ vendorName?: string, onWarning?: (s: string) => void, warehouseId?: string, excludeWarehouseId?: string }} [opts]
 */
async function getVendorCredits(fromDate, toDate, vendorId, opts = {}) {
  const onW = typeof opts.onWarning === 'function' ? opts.onWarning : () => {}
  const lineFilter = makeWarehouseLineFilter(opts)
  const needsWarehouseDetail = !!(
    opts.includeWarehouseDetail ||
    normalizeWarehouseId(opts.warehouseId) ||
    normalizeWarehouseId(opts.excludeWarehouseId)
  )
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
    const cached = getCachedDocDetail(_vendorCreditDetailById, id)
    if (cached) return Promise.resolve(cached)
    const p = (async () => {
      try {
        const p2 = new URLSearchParams()
        const json = await zohoApiRequest(
          `${INVENTORY_V1}/vendorcredits/${encodeURIComponent(id)}`,
          p2
        )
        const vc = (json && json.vendor_credit) || null
        if (vc) setCachedDocDetail(_vendorCreditDetailById, id, vc)
        return vc
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
      let lineDoc = vc
      if ((needsWarehouseDetail || lines.length === 0) && vc.vendor_credit_id) {
        const full = await fetchVendorCreditDetail(vc.vendor_credit_id)
        if (full) {
          lineDoc = full
          lines = normalizeZohoLineItems(full.line_items)
        }
      }
      for (const li of lines) {
        if (!lineFilter(li, lineDoc)) continue
        const n = normalizeVendorCreditLineItem(li)
        lineRows.push({
          type: 'vendor_credit',
          document_id: vc.vendor_credit_id,
          document_date: vc.date,
          item_id: n.item_id,
          name: n.name,
          sku: n.sku,
          quantity: n.quantity,
          item_total: n.item_total,
          warehouse_id: resolveLineWarehouseId(li, lineDoc),
          warehouse_name: n.warehouse_name || resolveLineWarehouseName(li, lineDoc),
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
    matchesBillDocument,
    normalizeVendorCreditLineItem,
    resolveLineWarehouseName,
    parseVendorCreditLineDollarAmount,
    normalizeWarehouseId,
    resolveLineWarehouseId,
    makeWarehouseLineFilter,
    itemTotalNetFromSalesByItemRow,
    /** @deprecated use itemTotalNetFromSalesByItemRow (pre-tax only) */
    itemTotalGrossFromSalesByItemRow: (r) => itemTotalNetFromSalesByItemRow(r),
    resolveWeeklyReportSalesVatRate,
  },
}
