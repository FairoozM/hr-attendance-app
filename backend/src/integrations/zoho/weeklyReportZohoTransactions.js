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

/** @param {{ maxInvoicePages?: number }} [opts] */
function resolveReconInvoiceMaxPages(opts = {}) {
  if (opts.maxInvoicePages != null && Number.isFinite(Number(opts.maxInvoicePages))) {
    return Math.max(1, Math.floor(Number(opts.maxInvoicePages)))
  }
  const raw = process.env.WEEKLY_REPORT_RECON_INVOICE_MAX_PAGES
  if (raw === undefined || String(raw).trim() === '') return MAX_DEFAULT_PAGES
  const n = parseInt(String(raw).trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : MAX_DEFAULT_PAGES
}

/** @param {{ maxInvoiceDetailLimit?: number }} [opts] — 0 allowed; unset env = no cap */
function resolveReconInvoiceDetailLimit(opts = {}) {
  if (opts.maxInvoiceDetailLimit != null && Number.isFinite(Number(opts.maxInvoiceDetailLimit))) {
    return Math.max(0, Math.floor(Number(opts.maxInvoiceDetailLimit)))
  }
  const raw = process.env.WEEKLY_REPORT_RECON_INVOICE_DETAIL_LIMIT
  if (raw === undefined || String(raw).trim() === '') return Infinity
  const n = parseInt(String(raw).trim(), 10)
  return Number.isFinite(n) && n >= 0 ? n : Infinity
}

/**
 * Sort column for invoice list during dated reconstruction. Probe confirmed Zoho
 * Inventory `/invoices` honors `sort_column=date` (same pattern as Books client).
 * Default `date`; opt-in via opts to skip.
 * @param {{ invoiceSortColumn?: string|null }} [opts]
 */
function resolveReconInvoiceSortColumn(opts = {}) {
  if (opts.invoiceSortColumn === null) return ''
  if (opts.invoiceSortColumn != null && String(opts.invoiceSortColumn).trim() !== '') {
    return String(opts.invoiceSortColumn).trim()
  }
  const raw = process.env.WEEKLY_REPORT_RECON_INVOICE_SORT_COLUMN
  if (raw !== undefined && String(raw).trim() !== '') return String(raw).trim()
  return 'date'
}

/**
 * Sort order for invoice list during dated reconstruction. `A` = ascending
 * (oldest first) so capped detail fetches see early-window invoices first.
 * @param {{ invoiceSortOrder?: string|null }} [opts]
 */
function resolveReconInvoiceSortOrder(opts = {}) {
  if (opts.invoiceSortOrder === null) return ''
  if (opts.invoiceSortOrder != null && String(opts.invoiceSortOrder).trim() !== '') {
    const v = String(opts.invoiceSortOrder).trim().toUpperCase()
    return v === 'A' || v === 'D' ? v : 'A'
  }
  const raw = process.env.WEEKLY_REPORT_RECON_INVOICE_SORT_ORDER
  if (raw !== undefined && String(raw).trim() !== '') {
    const v = String(raw).trim().toUpperCase()
    return v === 'A' || v === 'D' ? v : 'A'
  }
  return 'A'
}

const MAX_INVENTORY_ADJUSTMENT_PAGES =
  process.env.WEEKLY_REPORT_INVENTORY_ADJUSTMENT_MAX_PAGES !== undefined
    ? Math.max(1, parseInt(process.env.WEEKLY_REPORT_INVENTORY_ADJUSTMENT_MAX_PAGES, 10) || MAX_DEFAULT_PAGES)
    : MAX_DEFAULT_PAGES
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
 * One row from Zoho Inventory `GET /inventory/v1/reports/salesbyitem` — **total including tax**
 * for the Weekly Ads "Net Sales (AED)" fill-in. Prefers inclusive fields from Zoho; otherwise
 * pre-tax amount plus line tax columns.
 *
 * @param {object} r - one element of the report `sales[]` array
 * @returns {number}
 */
function itemTotalWithTaxFromSalesByItemRow(r) {
  if (!r || typeof r !== 'object') return 0
  const p = (v) => {
    if (v == null) return 0
    if (v === '') return 0
    if (typeof v === 'number' && Number.isFinite(v)) return v
    return parseLineQty(v)
  }
  for (const k of [
    'total_inclusive_amount',
    'amount_inclusive_of_tax',
    'total_inclusive',
    'tax_inclusive_amount',
    'inclusive_amount',
  ]) {
    if (r[k] == null || r[k] === '') continue
    const v = p(r[k])
    if (Number.isFinite(v) && v > 0) return v
  }
  const gross = p(r.gross_amount)
  if (gross > 0) return gross
  const net = itemTotalNetFromSalesByItemRow(r)
  const lineTax =
    p(r.item_tax) + p(r.tax_amount) + p(r.tax_total) + p(r.total_tax) + p(r.tax)
  if (lineTax > 0) return net + lineTax
  return net
}

/**
 * Sum tax-inclusive Sales-by-Item totals for one Zoho warehouse (empty string = all warehouses).
 *
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate - YYYY-MM-DD
 * @param {string} [warehouseId]
 * @returns {Promise<{ total: number, truncated: boolean, pages: number, row_count: number }>}
 */
async function aggregateReportSalesWithTaxForWarehouse(fromDate, toDate, warehouseId) {
  const wid = normalizeWarehouseId(warehouseId)
  const { rows, truncated, pages } = await fetchSalesByItemRows(fromDate, toDate, wid)
  let total = 0
  for (const row of rows || []) {
    total += itemTotalWithTaxFromSalesByItemRow(row)
  }
  const rounded = Math.round(total * 100) / 100
  return {
    total: rounded,
    truncated: !!truncated,
    pages: pages || 0,
    row_count: Array.isArray(rows) ? rows.length : 0,
  }
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

/** @param {object | undefined} line */
function lineHasValidDocumentDate(line) {
  const d = line && line.document_date != null ? String(line.document_date).slice(0, 10) : ''
  return d.length >= 10
}

/** Drop aggregated sales-by-item rows (no per-line date) from reconstruction windows. */
function filterToDatedMovementLines(lines) {
  return (lines || []).filter(lineHasValidDocumentDate)
}

/** Server-local calendar date YYYY-MM-DD (opening-stock reconciliation anchor). */
function isoDateLocal(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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

/** @param {object} li */
function invoiceLineItemUsableForRecon(li) {
  if (!li || typeof li !== 'object') return false
  const n = normalizeVendorCreditLineItem(li)
  const hasId =
    (n.item_id && String(n.item_id).trim() !== '') ||
    (n.sku && String(n.sku).trim() !== '') ||
    (n.name && String(n.name).trim() !== '')
  return hasId && n.quantity > 0
}

/** Invoice list rows sometimes include full `line_items`; use them to skip GET /invoices/{id}. */
function invoiceListRowHasUsableLineItems(inv) {
  return normalizeZohoLineItems(inv?.line_items).some(invoiceLineItemUsableForRecon)
}

/**
 * @param {object[]} lineRows
 * @param {object} inv
 * @param {(li: object, doc: object) => boolean} lineFilter
 */
function appendInvoiceLineRows(lineRows, inv, lineFilter) {
  const iid = inv && inv.invoice_id != null ? String(inv.invoice_id).trim() : ''
  const docDate = inv && inv.date != null ? String(inv.date).slice(0, 10) : ''
  for (const li of normalizeZohoLineItems(inv?.line_items)) {
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

/**
 * Half-open movement window (fromExclusive, toInclusive]: date > fromExclusive && date <= toInclusive.
 * @param {string|undefined} iso
 * @param {string} fromExclusive
 * @param {string} toInclusive
 */
function isDateInHalfOpenRangeInclEnd(iso, fromExclusive, toInclusive) {
  if (!iso || !toInclusive) return false
  const s = String(iso).slice(0, 10)
  if (s.length < 10) return false
  if (fromExclusive && s <= fromExclusive) return false
  return s <= toInclusive
}

/** @param {Array<{ item_id?: string, sku?: string, name?: string, item_name?: string }>} items */
function buildTargetReconItemSets(items) {
  const itemIds = new Set()
  const skus = new Set()
  const names = new Set()
  for (const it of items || []) {
    if (!it) continue
    const id = it.item_id != null ? String(it.item_id).trim() : ''
    if (id) itemIds.add(id)
    const sk = it.sku != null ? String(it.sku).trim().toLowerCase() : ''
    if (sk) skus.add(sk)
    const nm = (it.name || it.item_name) != null ? String(it.name || it.item_name).trim().toLowerCase() : ''
    if (nm) names.add(nm)
  }
  return {
    itemIds,
    skus,
    names,
    count: itemIds.size + skus.size + names.size,
  }
}

/** @param {object} line @param {{ itemIds: Set<string>, skus: Set<string>, names: Set<string> } | null} target */
function lineMatchesTargetRecon(line, target) {
  if (!target) return true
  const id = line?.item_id != null ? String(line.item_id).trim() : ''
  if (id && target.itemIds.has(id)) return true
  const sk = line?.sku != null ? String(line.sku).trim().toLowerCase() : ''
  if (sk && target.skus.has(sk)) return true
  const nm = line?.name != null ? String(line.name).trim().toLowerCase() : ''
  if (nm && target.names.has(nm)) return true
  return false
}

/** @param {object[]} sampleInvoices */
function probeInvoiceListRowShape(sampleInvoices) {
  const sample = (sampleInvoices || []).slice(0, 5)
  const sampleKeys = sample[0] ? Object.keys(sample[0]).sort() : []
  const itemFieldsOnList = new Set()
  let listRowsWithUsableLineItemsSample = 0
  for (const inv of sample) {
    if (!inv) continue
    if (invoiceListRowHasUsableLineItems(inv)) {
      listRowsWithUsableLineItemsSample += 1
      itemFieldsOnList.add('line_items')
    }
    for (const k of [
      'item_names',
      'item_name',
      'sku',
      'skus',
      'line_item_details',
      'products',
      'item_descriptions',
    ]) {
      const v = inv[k]
      if (v == null) continue
      if (Array.isArray(v) && v.length === 0) continue
      if (String(v).trim() !== '') itemFieldsOnList.add(k)
    }
  }
  return {
    sampleKeys,
    itemFieldsOnList: [...itemFieldsOnList],
    listPrefilterPossible: itemFieldsOnList.size > 0,
    listRowsWithUsableLineItemsSample,
  }
}

/**
 * Skip GET /invoices/{id} only when list row proves invoice cannot contain target items.
 * @param {object} inv
 * @param {{ itemIds: Set<string>, skus: Set<string>, names: Set<string> } | null} target
 * @param {boolean} listPrefilterPossible
 */
function canSkipInvoiceDetailAtListLevel(inv, target, listPrefilterPossible) {
  if (!target || !listPrefilterPossible) return false
  if (invoiceListRowHasUsableLineItems(inv)) {
    return !normalizeZohoLineItems(inv.line_items).some((li) =>
      lineMatchesTargetRecon(normalizeVendorCreditLineItem(li), target),
    )
  }
  return false
}

/** @param {{ reconTargetItems?: object[] | { itemIds: Set<string> } }} opts */
function resolveTargetReconFromOpts(opts) {
  if (!opts || !opts.reconTargetItems) return null
  const raw = opts.reconTargetItems
  if (raw && raw.itemIds instanceof Set) return raw
  return buildTargetReconItemSets(raw)
}

function buildInvoicePrefilterMeta({
  target,
  probe,
  invoicesSkippedByPrefilter,
  invoicesSkippedByEarlyStop,
  matchingLinesInWindow,
  matchingLinesTotal,
  stopAfterMatchingSalesLines,
  targetedReconComplete,
}) {
  const enabled = !!target
  let strategy = 'disabled'
  let reason = 'No target item set; all invoices eligible for detail fetch.'
  if (target) {
    if (stopAfterMatchingSalesLines) {
      strategy = probe.listPrefilterPossible
        ? 'target_item_ids_with_stop_after_matching'
        : 'target_item_ids_with_stop_after_matching'
      reason = probe.listPrefilterPossible
        ? 'List-level skip when list line_items exclude target items; detail fetch stops after enough matching lines in window.'
        : 'Invoice list rows lack item fields (see list_row_sample_keys); detail fetch stops after enough target matching lines in window — not a full-catalog recon.'
    } else if (probe.listPrefilterPossible) {
      strategy = 'target_item_ids'
      reason = 'Skip detail fetch when list row line_items exclude target items.'
    } else {
      strategy = 'not_possible_invoice_list_has_no_item_fields'
      reason =
        'Invoice list rows lack item_id/sku/name on list payload; cannot skip detail fetch at list level safely.'
    }
  }
  return {
    enabled,
    strategy,
    target_item_count: target ? target.itemIds.size : 0,
    target_identifier_sets: target ? target.count : 0,
    invoices_skipped_by_prefilter: invoicesSkippedByPrefilter,
    invoices_skipped_by_early_stop: invoicesSkippedByEarlyStop || 0,
    matching_sales_lines_in_window: matchingLinesInWindow,
    matching_sales_lines_total: matchingLinesTotal || 0,
    stop_after_matching_sales_lines: stopAfterMatchingSalesLines ?? null,
    targeted_recon_complete: !!targetedReconComplete,
    list_row_sample_keys: probe.sampleKeys,
    list_item_fields_found: probe.itemFieldsOnList,
    reason,
  }
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

/** @param {string} iso YYYY-MM-DD @returns {string} iso+1 day */
function addOneDayIsoDate(iso) {
  if (!iso || typeof iso !== 'string') return ''
  const s = iso.slice(0, 10)
  if (s.length < 10) return ''
  const t = Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  if (!Number.isFinite(t)) return ''
  const d = new Date(t + 24 * 60 * 60 * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function fetchSalesByItemLinesWithIncludeExclude(fromDate, toDate, opts) {
  const includeId = normalizeWarehouseId(opts && opts.warehouseId)
  const excludeId = normalizeWarehouseId(opts && opts.excludeWarehouseId)
  if (includeId) {
    const rep = await fetchSalesByItemRows(fromDate, toDate, includeId)
    const lines = (rep.rows || []).map((r) => normalizeSalesByItemLine(r, includeId))
    return { lines, list_truncated: !!rep.truncated, list_pages: rep.pages || 0 }
  }
  if (excludeId) {
    const [allRep, exRep] = await Promise.all([
      fetchSalesByItemRows(fromDate, toDate, ''),
      fetchSalesByItemRows(fromDate, toDate, excludeId),
    ])
    const allLines = (allRep.rows || []).map((r) => normalizeSalesByItemLine(r, ''))
    const exLines = (exRep.rows || []).map((r) => normalizeSalesByItemLine(r, excludeId))
    const lines = subtractSalesByItemLines(allLines, exLines)
    return {
      lines,
      list_truncated: !!(allRep.truncated || exRep.truncated),
      list_pages: Math.max(allRep.pages || 0, exRep.pages || 0),
    }
  }
  const rep = await fetchSalesByItemRows(fromDate, toDate, '')
  const lines = (rep.rows || []).map((r) => normalizeSalesByItemLine(r, ''))
  return { lines, list_truncated: !!rep.truncated, list_pages: rep.pages || 0 }
}

/**
 * Stock-reconciliation sales source using two windowed Sales-by-Item calls.
 *
 * Sales-by-Item rows are pre-aggregated by item and never carry a per-line
 * `document_date`. To make them usable for the closing-as-of reconstruction
 * windows ((fromDate, splitDate] for opening, (splitDate, throughDate] for
 * closing) we issue **two** Sales-by-Item calls — one per window — and
 * synthesize a `document_date` that lands each line in the intended bucket
 * (splitDate for in-window, throughDate for after-window).
 *
 * No invoice-detail fan-out. No Zoho rate-limit pressure.
 *
 * @param {string} fromDate              YYYY-MM-DD (report from_date; exclusive lower bound of opening window)
 * @param {string} splitDate             YYYY-MM-DD (report to_date; closes the opening window inclusively and opens the after window exclusively)
 * @param {string} throughDate           YYYY-MM-DD (typically today; inclusive upper bound of after window)
 * @param {{ onWarning?: (s: string) => void, warehouseId?: string, excludeWarehouseId?: string }} [opts]
 */
async function getSalesByItemWindowedForRecon(fromDate, splitDate, throughDate, opts = {}) {
  const onW = typeof opts.onWarning === 'function' ? opts.onWarning : () => {}
  const t0 = Date.now()
  const afterFrom = addOneDayIsoDate(splitDate)
  const hasAfterWindow = afterFrom && throughDate && afterFrom <= String(throughDate).slice(0, 10)
  try {
    const inPromise = fetchSalesByItemLinesWithIncludeExclude(fromDate, splitDate, opts)
    const afterPromise = hasAfterWindow
      ? fetchSalesByItemLinesWithIncludeExclude(afterFrom, throughDate, opts)
      : Promise.resolve({ lines: [], list_truncated: false, list_pages: 0 })
    const [inWin, afterWin] = await Promise.all([inPromise, afterPromise])
    const stampedIn = inWin.lines.map((line) => ({
      ...line,
      document_date: String(splitDate || '').slice(0, 10),
      _window: 'opening',
    }))
    const stampedAfter = afterWin.lines.map((line) => ({
      ...line,
      document_date: String(throughDate || '').slice(0, 10),
      _window: 'closing',
    }))
    const lines = stampedIn.concat(stampedAfter)
    const list_truncated = !!(inWin.list_truncated || afterWin.list_truncated)
    const list_pages = Math.max(inWin.list_pages || 0, afterWin.list_pages || 0)
    if (list_truncated) {
      onW(
        'Sales-by-Item windowed reconstruction: pagination cap reached for at least one window; opening/closing sales may be incomplete.',
      )
    }
    console.log(
      `[zoho-timing] salesbyitem windowed recon: in=${stampedIn.length} after=${stampedAfter.length}` +
        ` in_window=${fromDate}..${splitDate}` +
        (hasAfterWindow ? ` after_window=${afterFrom}..${throughDate}` : ' after_window=none') +
        ` ${Date.now() - t0}ms` +
        (list_truncated ? ' (partial)' : ''),
    )
    return {
      lines,
      line_count: lines.length,
      document_count: lines.length,
      list_truncated,
      list_pages,
      source: 'zoho_inventory_reports_salesbyitem_windowed',
      fallback_used: false,
      sales_reconstruction_partial: list_truncated,
      in_window: {
        from_date: fromDate || null,
        to_date: splitDate || null,
        line_count: stampedIn.length,
        list_truncated: !!inWin.list_truncated,
        list_pages: inWin.list_pages || 0,
      },
      after_window: {
        from_date: hasAfterWindow ? afterFrom : null,
        to_date: hasAfterWindow ? throughDate : null,
        line_count: stampedAfter.length,
        list_truncated: !!afterWin.list_truncated,
        list_pages: afterWin.list_pages || 0,
        skipped: !hasAfterWindow,
      },
      windowed_split_date: splitDate || null,
      windowed_through_date: throughDate || null,
      requires_document_dates: false,
      error: null,
    }
  } catch (e) {
    onW(`Sales-by-Item windowed reconstruction failed: ${e && e.message ? e.message : String(e)}`)
    return {
      lines: [],
      line_count: 0,
      document_count: 0,
      list_truncated: false,
      list_pages: 0,
      source: 'zoho_inventory_reports_salesbyitem_windowed',
      fallback_used: false,
      sales_reconstruction_partial: false,
      in_window: { from_date: fromDate || null, to_date: splitDate || null, line_count: 0, list_truncated: false, list_pages: 0 },
      after_window: {
        from_date: hasAfterWindow ? afterFrom : null,
        to_date: hasAfterWindow ? throughDate : null,
        line_count: 0,
        list_truncated: false,
        list_pages: 0,
        skipped: !hasAfterWindow,
      },
      windowed_split_date: splitDate || null,
      windowed_through_date: throughDate || null,
      requires_document_dates: false,
      error: e,
    }
  }
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
  const maxInvoicePages = resolveReconInvoiceMaxPages(opts)
  const detailLimit = resolveReconInvoiceDetailLimit(opts)
  const sortColumn = resolveReconInvoiceSortColumn(opts)
  const sortOrder = resolveReconInvoiceSortOrder(opts)
  const target = resolveTargetReconFromOpts(opts)
  const stopAfterMatchingSalesLines =
    target && opts.stopAfterMatchingSalesLines != null && Number.isFinite(Number(opts.stopAfterMatchingSalesLines))
      ? Math.max(1, Math.floor(Number(opts.stopAfterMatchingSalesLines)))
      : null
  const reconMatchFromDate =
    opts.reconMatchFromDate != null && String(opts.reconMatchFromDate).trim() !== ''
      ? String(opts.reconMatchFromDate).slice(0, 10)
      : fromDate
  const reconMatchToDate =
    opts.reconMatchToDate != null && String(opts.reconMatchToDate).trim() !== ''
      ? String(opts.reconMatchToDate).slice(0, 10)
      : toDate
  let detailFetches = 0
  let detailCacheHits = 0
  let detailFetchTruncated = false
  let detailCapWarned = false
  let listRowsWithLineItems = 0
  let invoicesSkippedByPrefilter = 0
  let invoicesSkippedByEarlyStop = 0
  let matchingLinesInWindow = 0
  let matchingLinesTotal = 0
  let targetedReconComplete = false
  const t0 = Date.now()
  try {
    const dateParams = new URLSearchParams()
    if (fromDate) dateParams.set('date_start', fromDate)
    if (toDate) dateParams.set('date_end', toDate)
    if (sortColumn) dateParams.set('sort_column', sortColumn)
    if (sortOrder) dateParams.set('sort_order', sortOrder)

    console.log(
      `[zoho-recon-invoices] list fetch ${fromDate || '?'}..${toDate || '?'} max_pages=${maxInvoicePages}` +
        (Number.isFinite(detailLimit) ? ` detail_limit=${detailLimit}` : '') +
        (sortColumn ? ` sort=${sortColumn}:${sortOrder || 'A'}` : ''),
    )

    const { rows, truncated, pages } = await fetchListPaginated(
      `${INVENTORY_V1}/invoices`,
      'invoices',
      maxInvoicePages,
      dateParams,
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

    let firstInvoiceDate = ''
    let lastInvoiceDate = ''
    for (const inv of invoices) {
      const d = inv && inv.date != null ? String(inv.date).slice(0, 10) : ''
      if (!d) continue
      if (!firstInvoiceDate || d < firstInvoiceDate) firstInvoiceDate = d
      if (!lastInvoiceDate || d > lastInvoiceDate) lastInvoiceDate = d
    }

    const lineRows = []
    const invoicesNeedingDetail = []
    for (const inv of invoices) {
      if (invoiceListRowHasUsableLineItems(inv)) {
        listRowsWithLineItems += 1
        appendInvoiceLineRows(lineRows, inv, lineFilter)
      } else {
        invoicesNeedingDetail.push(inv)
      }
    }

    const listProbe = probeInvoiceListRowShape(invoices)
    if (target) {
      console.log(
        `[zoho-recon-invoices] target items=${target.count} list_prefilter_possible=${listProbe.listPrefilterPossible}` +
          (listProbe.sampleKeys.length ? ` list_keys_sample=${listProbe.sampleKeys.slice(0, 12).join(',')}` : '') +
          (stopAfterMatchingSalesLines ? ` stop_after_matching=${stopAfterMatchingSalesLines}` : ''),
      )
    }

    const invoicesForDetail = []
    for (const inv of invoicesNeedingDetail) {
      if (canSkipInvoiceDetailAtListLevel(inv, target, listProbe.listPrefilterPossible)) {
        invoicesSkippedByPrefilter += 1
        continue
      }
      invoicesForDetail.push(inv)
    }

    if (stopAfterMatchingSalesLines && target) {
      invoicesForDetail.sort((a, b) => {
        const da = a && a.date != null ? String(a.date).slice(0, 10) : ''
        const db = b && b.date != null ? String(b.date).slice(0, 10) : ''
        return da.localeCompare(db) || String(a.invoice_id || '').localeCompare(String(b.invoice_id || ''))
      })
    }

    console.log(
      `[zoho-recon-invoices] ${invoices.length} invoices in range: ${listRowsWithLineItems} with list line_items, ` +
        `${invoicesForDetail.length} need detail` +
        (invoicesSkippedByPrefilter ? `, ${invoicesSkippedByPrefilter} skipped by list prefilter` : '') +
        (stopAfterMatchingSalesLines ? ' (date-sorted for targeted fetch)' : ''),
    )

    const countMatchingLinesAdded = (startIdx) => {
      if (!target || !stopAfterMatchingSalesLines) return
      for (let i = startIdx; i < lineRows.length; i += 1) {
        const line = lineRows[i]
        if (!lineMatchesTargetRecon(line, target)) continue
        matchingLinesTotal += 1
        const d = line.document_date != null ? String(line.document_date).slice(0, 10) : ''
        if (!isDateInHalfOpenRangeInclEnd(d, reconMatchFromDate, reconMatchToDate)) continue
        matchingLinesInWindow += 1
      }
    }

    const fetchInvoiceDetail = async (inv, idx, total) => {
      const iid = inv.invoice_id != null && String(inv.invoice_id).trim() !== '' ? String(inv.invoice_id).trim() : ''
      let full = inv
      if (!iid) return full

      const cached = getCachedDocDetail(_invoiceDetailById, iid)
      if (cached) {
        detailCacheHits += 1
        return cached
      }

      if (Number.isFinite(detailLimit) && detailFetches >= detailLimit) {
        detailFetchTruncated = true
        if (!detailCapWarned) {
          detailCapWarned = true
          const msg = `Invoice detail fetch cap reached (${detailLimit}); remaining invoices omitted from dated sales reconstruction.`
          onW(msg)
          console.warn(`[zoho-recon-invoices] ${msg}`)
        }
        return full
      }

      detailFetches += 1
      if (detailFetches === 1 || detailFetches % 25 === 0) {
        const capLabel = Number.isFinite(detailLimit) ? `/${detailLimit}` : ''
        console.log(
          `[zoho-recon-invoices] detail fetch ${detailFetches}${capLabel} invoice ${idx + 1}/${total} elapsed=${Date.now() - t0}ms` +
            (stopAfterMatchingSalesLines ? ` matching_in_window=${matchingLinesInWindow}/${stopAfterMatchingSalesLines}` : ''),
        )
      }
      try {
        const json = await zohoApiRequest(`${INVENTORY_V1}/invoices/${encodeURIComponent(iid)}`)
        full = (json && json.invoice) || inv
        if (full && full !== inv) setCachedDocDetail(_invoiceDetailById, iid, full)
      } catch (e) {
        onW(`GET /invoices/${iid} - ${e && e.message ? e.message : String(e)}`)
      }
      return full
    }

    if (stopAfterMatchingSalesLines && target) {
      for (let idx = 0; idx < invoicesForDetail.length; idx += 1) {
        if (matchingLinesInWindow >= stopAfterMatchingSalesLines) {
          targetedReconComplete = true
          invoicesSkippedByEarlyStop = invoicesForDetail.length - idx
          break
        }
        if (detailFetchTruncated) break
        const before = lineRows.length
        const full = await fetchInvoiceDetail(invoicesForDetail[idx], idx, invoicesForDetail.length)
        appendInvoiceLineRows(lineRows, full, lineFilter)
        countMatchingLinesAdded(before)
        if (matchingLinesInWindow >= stopAfterMatchingSalesLines) {
          targetedReconComplete = true
          invoicesSkippedByEarlyStop = invoicesForDetail.length - idx - 1
          break
        }
      }
      if (!targetedReconComplete && !detailFetchTruncated && matchingLinesInWindow >= stopAfterMatchingSalesLines) {
        targetedReconComplete = true
      }
    } else {
      const detailTasks = invoicesForDetail.map((inv, idx) => async () => {
        const full = await fetchInvoiceDetail(inv, idx, invoicesForDetail.length)
        return full
      })
      const detailInvoices = await promiseConcurrent(detailTasks, DETAIL_CONCURRENCY)
      for (const inv of detailInvoices) {
        appendInvoiceLineRows(lineRows, inv, lineFilter)
      }
    }

    if (stopAfterMatchingSalesLines && target && matchingLinesInWindow >= stopAfterMatchingSalesLines) {
      targetedReconComplete = true
    }

    const prefilter = buildInvoicePrefilterMeta({
      target,
      probe: listProbe,
      invoicesSkippedByPrefilter,
      invoicesSkippedByEarlyStop,
      matchingLinesInWindow,
      matchingLinesTotal,
      stopAfterMatchingSalesLines,
      targetedReconComplete,
    })

    let salesReconstructionPartial = truncated || detailFetchTruncated
    if (stopAfterMatchingSalesLines && target) {
      salesReconstructionPartial = truncated || detailFetchTruncated || !targetedReconComplete
    }
    console.log(
      `[zoho-timing] invoice reconstruction: ${lineRows.length} lines, ${detailFetches} detail fetch(es), ${detailCacheHits} cache hit(s), ${Date.now() - t0}ms` +
        (salesReconstructionPartial ? ' (partial)' : ' (complete)') +
        (prefilter.enabled ? ` prefilter=${prefilter.strategy}` : ''),
    )

    return {
      lines: lineRows,
      line_count: lineRows.length,
      document_count: invoices.length,
      list_truncated: truncated,
      list_pages: pages,
      invoice_max_pages: maxInvoicePages,
      invoice_list_count: invoices.length,
      invoice_list_pages: pages,
      invoice_list_with_usable_line_items: listRowsWithLineItems,
      invoice_detail_fetches: detailFetches,
      invoice_detail_cache_hits: detailCacheHits,
      invoice_detail_fetch_limit: Number.isFinite(detailLimit) ? detailLimit : null,
      max_invoice_details: Number.isFinite(detailLimit) ? detailLimit : null,
      invoice_detail_fetch_truncated: detailFetchTruncated,
      sales_reconstruction_partial: salesReconstructionPartial,
      targeted_recon_complete: targetedReconComplete,
      invoice_sort_column: sortColumn || null,
      invoice_sort_order: sortOrder || null,
      invoice_date_start: fromDate || null,
      invoice_date_end: toDate || null,
      first_invoice_date: firstInvoiceDate || null,
      last_invoice_date: lastInvoiceDate || null,
      prefilter,
      error: null,
    }
  } catch (e) {
    onW(e && e.message ? e.message : String(e))
    return {
      lines: [],
      line_count: 0,
      document_count: 0,
      list_truncated: false,
      list_pages: 0,
      invoice_list_count: 0,
      invoice_list_pages: 0,
      invoice_list_with_usable_line_items: 0,
      invoice_detail_fetches: 0,
      invoice_detail_cache_hits: 0,
      invoice_detail_fetch_truncated: false,
      sales_reconstruction_partial: false,
      targeted_recon_complete: false,
      invoice_sort_column: sortColumn || null,
      invoice_sort_order: sortOrder || null,
      invoice_date_start: fromDate || null,
      invoice_date_end: toDate || null,
      first_invoice_date: null,
      last_invoice_date: null,
      prefilter: buildInvoicePrefilterMeta({
        target: null,
        probe: { sampleKeys: [], itemFieldsOnList: [], listPrefilterPossible: false },
        invoicesSkippedByPrefilter: 0,
        invoicesSkippedByEarlyStop: 0,
        matchingLinesInWindow: 0,
        matchingLinesTotal: 0,
        stopAfterMatchingSalesLines: null,
        targetedReconComplete: false,
      }),
      error: e,
    }
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
        source: 'zoho_inventory_reports_salesbyitem',
        fallback_used: false,
        cached: false,
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
        source: 'zoho_inventory_reports_salesbyitem',
        fallback_used: false,
        cached: false,
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
      source: 'zoho_inventory_reports_salesbyitem',
      fallback_used: false,
      cached: false,
    }
  } catch (fastErr) {
    onW(`Sales by Item fast path failed; using invoice detail fallback. ${fastErr && fastErr.message ? fastErr.message : String(fastErr)}`)
    const fallback = await getSalesFromInvoicesSlow(fromDate, toDate, opts)
    return {
      ...fallback,
      source: 'zoho_inventory_invoices_detail_fallback',
      fallback_used: true,
      fallback_reason: fastErr && fastErr.message ? fastErr.message : String(fastErr),
      cached: false,
    }
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
  if (hit && Date.now() < hit.expiresAt) return { ...hit.value, cached: true }
  if (_salesDetailInFlight.has(key)) return _salesDetailInFlight.get(key)
  const p = getSalesUncached(fromDate, toDate, opts)
    .then((value) => {
      const withCache = { ...value, cached: false }
      if (withCache && !withCache.error && SALES_DETAIL_CACHE_TTL_MS > 0) {
        _salesDetailCache.set(key, { value: withCache, expiresAt: Date.now() + SALES_DETAIL_CACHE_TTL_MS })
      }
      return withCache
    })
    .finally(() => {
      _salesDetailInFlight.delete(key)
    })
  _salesDetailInFlight.set(key, p)
  return p
}

/** @type {Map<string, { value: object, expiresAt: number }>} */
const _stockReconCache = new Map()
/** @type {Map<string, Promise<object>>} */
const _stockReconInFlight = new Map()

const STOCK_RECON_CACHE_TTL_MS =
  process.env.ZOHO_STOCK_RECON_CACHE_TTL_MS !== undefined
    ? Math.max(0, parseInt(process.env.ZOHO_STOCK_RECON_CACHE_TTL_MS, 10) || 0)
    : SALES_DETAIL_CACHE_TTL_MS

/**
 * Sales, bills, and vendor credits over `[fromDate, throughDate]` for opening-stock reconciliation.
 * Bills and vendor credits include **all vendors**; warehouse scope matches `opts` (same as purchases / credits).
 *
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} throughDate - YYYY-MM-DD (typically {@link isoDateLocal})
 * @param {{ onWarning?: (s: string) => void, reportGroup?: string, warehouseId?: string, excludeWarehouseId?: string, includeWarehouseDetail?: boolean }} [opts]
 */
async function getStockReconstructionUncached(fromDate, throughDate, opts = {}) {
  const useSalesByItemWindowed = !!opts.useSalesByItemWindowed
  const requireDatedSalesLines = !useSalesByItemWindowed && !!opts.requireDatedSalesLines
  let salesPromise
  if (useSalesByItemWindowed) {
    const splitDate =
      opts.salesReconSplitDate != null && String(opts.salesReconSplitDate).trim() !== ''
        ? String(opts.salesReconSplitDate).slice(0, 10)
        : fromDate
    salesPromise = getSalesByItemWindowedForRecon(fromDate, splitDate, throughDate, opts)
  } else if (requireDatedSalesLines) {
    salesPromise = getSalesFromInvoicesSlow(fromDate, throughDate, opts).then((invoiceSales) => {
      const rawLines = Array.isArray(invoiceSales?.lines) ? invoiceSales.lines : []
      const datedLines = filterToDatedMovementLines(rawLines)
      return {
        ...invoiceSales,
        lines: datedLines,
        line_count: datedLines.length,
        document_count: Number.isFinite(Number(invoiceSales?.document_count))
          ? Number(invoiceSales.document_count)
          : datedLines.length,
        source: 'zoho_inventory_invoices_for_reconstruction',
        fallback_used: false,
        dated_lines_for_reconstruction: true,
        raw_line_count: rawLines.length,
        undated_lines_excluded: Math.max(0, rawLines.length - datedLines.length),
      }
    })
  } else {
    salesPromise = getSales(fromDate, throughDate, opts)
  }

  const [salesR, purchR, vcR] = await Promise.all([
    salesPromise,
    getPurchases(fromDate, throughDate, null, {
      ...opts,
      stockReconstructionAllVendors: true,
    }),
    getVendorCredits(fromDate, throughDate, null, {
      ...opts,
      stockReconstructionAllVendors: true,
    }),
  ])
  return {
    salesR,
    purchR,
    vcR,
    list_truncated: !!(salesR.list_truncated || purchR.list_truncated || vcR.list_truncated),
    require_dated_sales_lines: requireDatedSalesLines,
    sales_reconstruction_mode: useSalesByItemWindowed
      ? 'salesbyitem_windowed'
      : requireDatedSalesLines
        ? 'invoice_detail'
        : 'salesbyitem_full_range',
  }
}

function stockReconUsesTargetedInvoiceOpts(opts = {}) {
  return (
    (opts.reconTargetItems != null &&
      (Array.isArray(opts.reconTargetItems) ? opts.reconTargetItems.length > 0 : true)) ||
    (opts.stopAfterMatchingSalesLines != null && Number.isFinite(Number(opts.stopAfterMatchingSalesLines)))
  )
}

function stockReconCacheKey(fromDate, throughDate, opts = {}) {
  const target = resolveTargetReconFromOpts(opts)
  const salesMode = opts.useSalesByItemWindowed
    ? 'salesbyitem_windowed'
    : opts.requireDatedSalesLines
      ? 'dated_sales'
      : 'default_sales'
  return [
    String(fromDate || ''),
    String(throughDate || ''),
    normalizeWarehouseId(opts.warehouseId),
    normalizeWarehouseId(opts.excludeWarehouseId),
    salesMode,
    opts.useSalesByItemWindowed && opts.salesReconSplitDate
      ? `split${String(opts.salesReconSplitDate).slice(0, 10)}`
      : '',
    String(resolveReconInvoiceMaxPages(opts)),
    String(resolveReconInvoiceDetailLimit(opts)),
    resolveReconInvoiceSortColumn(opts),
    resolveReconInvoiceSortOrder(opts),
    opts.stopAfterMatchingSalesLines != null ? `stop${opts.stopAfterMatchingSalesLines}` : '',
    opts.reconMatchFromDate ? `mf${opts.reconMatchFromDate}` : '',
    opts.reconMatchToDate ? `mt${opts.reconMatchToDate}` : '',
    target ? `tgt${target.count}` : '',
  ].join('|')
}

async function getStockReconstruction(fromDate, throughDate, opts = {}) {
  if (stockReconUsesTargetedInvoiceOpts(opts)) {
    const value = await getStockReconstructionUncached(fromDate, throughDate, opts)
    return { ...value, cached: false }
  }
  const key = stockReconCacheKey(fromDate, throughDate, opts)
  const hit = _stockReconCache.get(key)
  if (hit && Date.now() < hit.expiresAt) return { ...hit.value, cached: true }
  if (_stockReconInFlight.has(key)) return _stockReconInFlight.get(key)
  const p = getStockReconstructionUncached(fromDate, throughDate, opts)
    .then((value) => {
      const withCache = { ...value, cached: false }
      if (withCache && STOCK_RECON_CACHE_TTL_MS > 0) {
        _stockReconCache.set(key, { value: withCache, expiresAt: Date.now() + STOCK_RECON_CACHE_TTL_MS })
      }
      return withCache
    })
    .finally(() => {
      _stockReconInFlight.delete(key)
    })
  _stockReconInFlight.set(key, p)
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
  const reconPurchasesAllVendors = !!opts.stockReconstructionAllVendors
  const pMode =
    cfg.purchases && String(cfg.purchases.mode).toLowerCase() === 'by_contact_id' ? 'by_contact_id' : 'unfiltered'
  const pContact =
    pMode === 'by_contact_id' && cfg.purchases && cfg.purchases.contact_id
      ? String(cfg.purchases.contact_id).trim()
      : ''
  if (!reconPurchasesAllVendors && pMode === 'by_contact_id' && !pContact) {
    onW('WEEKLY_REPORT_PURCHASES_MODE=by_contact_id but no contact_id set; using all vendors for purchases.')
  }
  const filterBill =
    reconPurchasesAllVendors
      ? () => true
      : pMode === 'by_contact_id' && pContact
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
      source: 'zoho_inventory_bills',
      cached: true,
      vendor_filter_mode: pMode,
    }
  } catch (e) {
    onW(e && e.message ? e.message : String(e))
    return {
      lines: [],
      line_count: 0,
      document_count: 0,
      list_truncated: false,
      list_pages: 0,
      error: e,
      source: 'zoho_inventory_bills',
      cached: true,
      vendor_filter_mode: pMode,
    }
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
  const reconVcAllVendors = !!opts.stockReconstructionAllVendors
  if (
    !reconVcAllVendors &&
    (vendorId == null || String(vendorId).trim() === '') &&
    !vname
  ) {
    return {
      lines: [],
      line_count: 0,
      document_count: 0,
      list_truncated: false,
      list_pages: 0,
      error: null,
      source: 'zoho_inventory_vendorcredits',
      cached: true,
      vendor_filter_mode: 'not_configured',
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
      if (!reconVcAllVendors && !matchesVendorCreditDocument(vc, vid, vname2)) continue
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
      source: 'zoho_inventory_vendorcredits',
      cached: true,
      vendor_filter_mode: reconVcAllVendors ? 'all_vendors_stock_reconstruction' : (vid || vname2 ? 'configured_vendor' : 'not_configured'),
    }
  } catch (e) {
    onW(e && e.message ? e.message : String(e))
    return {
      lines: [],
      line_count: 0,
      document_count: 0,
      list_truncated: false,
      list_pages: 0,
      error: e,
      source: 'zoho_inventory_vendorcredits',
      cached: true,
      vendor_filter_mode: reconVcAllVendors ? 'all_vendors_stock_reconstruction' : (vid || vname2 ? 'configured_vendor' : 'not_configured'),
    }
  }
}

/**
 * Normalize one inventory adjustment line (list row or nested line_items entry).
 * @param {object} li
 * @param {object} doc
 * @param {string} docId
 * @param {string} docDate
 */
function normalizeInventoryAdjustmentLineItem(li, doc, docId, docDate) {
  const item = li && li.item && typeof li.item === 'object' ? li.item : null
  const itemId =
    (li && li.item_id != null && String(li.item_id).trim() !== '' && String(li.item_id).trim()) ||
    (item && item.item_id != null && String(item.item_id).trim() !== '' && String(item.item_id).trim()) ||
    ''
  const sku =
    (li && li.sku != null && String(li.sku)) ||
    (item && item.sku != null && String(item.sku)) ||
    ''
  const name =
    (li && li.name != null && String(li.name)) ||
    (item && item.name != null && String(item.name)) ||
    (doc && doc.name != null && String(doc.name)) ||
    ''
  return {
    type: 'inventory_adjustment',
    document_id: docId,
    document_date: docDate,
    item_id: itemId,
    sku,
    name,
    quantity_adjusted: parseLineQty(
      li && (li.quantity_adjusted != null ? li.quantity_adjusted : li.quantity),
    ),
    warehouse_id: resolveLineWarehouseId(li, doc),
    warehouse_name: resolveLineWarehouseName(li, doc),
    adjustment_type:
      doc && doc.adjustment_type != null ? String(doc.adjustment_type) : null,
    status: doc && doc.status != null ? String(doc.status) : null,
  }
}

/**
 * Inventory adjustments — probe / reconstruction source (not applied to stock columns yet).
 * List is paginated with a page cap; document dates are filtered client-side.
 *
 * @param {string} fromDate YYYY-MM-DD
 * @param {string} toDate YYYY-MM-DD (inclusive; use reconstruction through-date for opening window)
 * @param {object} [opts]
 */
async function getInventoryAdjustments(fromDate, toDate, opts = {}) {
  const onW = typeof opts.onWarning === 'function' ? opts.onWarning : () => {}
  const lineFilter = makeWarehouseLineFilter(opts)
  const t0 = Date.now()
  try {
    const { rows, truncated, pages } = await fetchListPaginated(
      `${INVENTORY_V1}/inventoryadjustments`,
      'inventory_adjustments',
      MAX_INVENTORY_ADJUSTMENT_PAGES,
      null,
    )
    console.log(
      `[zoho-timing] inventoryadjustments: ${rows.length} list rows, ${pages} page(s), ${Date.now() - t0}ms`,
    )
    const documentIds = new Set()
    const lineRows = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      if (!isNotVoidStatus(row)) continue
      const rawD = row.date != null ? row.date : row.adjustment_date
      const docDate = rawD != null ? String(rawD).slice(0, 10) : ''
      if (!isDateInRangeIncl(docDate, fromDate, toDate)) continue
      const docId =
        row.inventory_adjustment_id != null && String(row.inventory_adjustment_id).trim() !== ''
          ? String(row.inventory_adjustment_id).trim()
          : ''

      const nested = normalizeZohoLineItems(row.line_items)
      if (nested.length > 0) {
        for (const li of nested) {
          if (!lineFilter(li, row)) continue
          const norm = normalizeInventoryAdjustmentLineItem(li, row, docId, docDate)
          if (!norm.item_id) continue
          lineRows.push(norm)
          if (docId) documentIds.add(docId)
        }
        continue
      }

      const listItemId = row.item_id != null ? String(row.item_id).trim() : ''
      if (!listItemId) continue
      if (!lineFilter(row, row)) continue
      lineRows.push(normalizeInventoryAdjustmentLineItem(row, row, docId, docDate))
      if (docId) documentIds.add(docId)
    }
    return {
      lines: lineRows,
      line_count: lineRows.length,
      document_count: documentIds.size,
      list_truncated: truncated,
      list_pages: pages,
      date_filter_mode: 'client_side',
      error: null,
      source: 'zoho_inventory_inventoryadjustments',
    }
  } catch (e) {
    onW(e && e.message ? e.message : String(e))
    return {
      lines: [],
      line_count: 0,
      document_count: 0,
      list_truncated: false,
      list_pages: 0,
      date_filter_mode: 'client_side',
      error: e,
      source: 'zoho_inventory_inventoryadjustments',
    }
  }
}

module.exports = {
  getSales,
  getPurchases,
  getVendorCredits,
  getStockReconstruction,
  getInventoryAdjustments,
  isoDateLocal,
  isDateInRangeIncl,
  itemTotalWithTaxFromSalesByItemRow,
  aggregateReportSalesWithTaxForWarehouse,
  _internals: {
    parseLineQty,
    matchesReportVendor,
    normalizeZohoLineItems,
    invoiceLineItemUsableForRecon,
    invoiceListRowHasUsableLineItems,
    appendInvoiceLineRows,
    buildTargetReconItemSets,
    lineMatchesTargetRecon,
    probeInvoiceListRowShape,
    canSkipInvoiceDetailAtListLevel,
    buildInvoicePrefilterMeta,
    isDateInHalfOpenRangeInclEnd,
    stockReconUsesTargetedInvoiceOpts,
    stockReconCacheKey,
    matchesVendorCreditDocument,
    matchesBillDocument,
    normalizeVendorCreditLineItem,
    normalizeInventoryAdjustmentLineItem,
    resolveLineWarehouseName,
    parseVendorCreditLineDollarAmount,
    normalizeWarehouseId,
    resolveLineWarehouseId,
    makeWarehouseLineFilter,
    itemTotalNetFromSalesByItemRow,
    itemTotalWithTaxFromSalesByItemRow,
    /** @deprecated use itemTotalNetFromSalesByItemRow (pre-tax only) */
    itemTotalGrossFromSalesByItemRow: (r) => itemTotalNetFromSalesByItemRow(r),
    resolveWeeklyReportSalesVatRate,
    isoDateLocal,
    lineHasValidDocumentDate,
    filterToDatedMovementLines,
    getSalesFromInvoicesSlow,
    getSalesByItemWindowedForRecon,
    addOneDayIsoDate,
    fetchSalesByItemLinesWithIncludeExclude,
    resolveReconInvoiceMaxPages,
    resolveReconInvoiceDetailLimit,
    resolveReconInvoiceSortColumn,
    resolveReconInvoiceSortOrder,
  },
}
