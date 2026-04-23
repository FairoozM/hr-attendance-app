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

const { fetchListPaginated } = require('./zohoInventoryClient')
const { INVENTORY_V1 } = require('./zohoConfig')

const MAX_DEFAULT_PAGES = 500

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
 * All invoice line rows in the date range (all customers — no sales vendor filter).
 *
 * @param {string} fromDate
 * @param {string} toDate
 * @param {{ onWarning?: (s: string) => void }} [opts]
 * @returns {Promise<{ lines: object[], document_count: number, list_truncated: boolean, list_pages: number, error: Error|null }>}
 */
async function getSales(fromDate, toDate, opts = {}) {
  const onW = typeof opts.onWarning === 'function' ? opts.onWarning : () => {}
  try {
    const { rows, truncated, pages } = await fetchListPaginated(
      `${INVENTORY_V1}/invoices`,
      'invoices',
      MAX_DEFAULT_PAGES
    )
    if (truncated) {
      onW('Invoice list may be incomplete: pagination cap reached. Export date range to narrow results.')
    }
    const lineRows = []
    for (const inv of rows) {
      if (!isNotVoidStatus(inv)) continue
      if (!isDateInRangeIncl(inv.date, fromDate, toDate)) continue
      const lines = Array.isArray(inv.line_items) ? inv.line_items : []
      for (const li of lines) {
        lineRows.push({
          type: 'invoice',
          document_id: inv.invoice_id,
          document_date: inv.date,
          item_id: li.item_id,
          name: li.name,
          quantity: parseLineQty(li.quantity),
        })
      }
    }
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
 * Purchase bill line rows for a single vendor (Bills, not purchase orders), date range.
 * @param {string} fromDate
 * @param {string} toDate
 * @param {string | undefined} vendorId — `REPORT_VENDOR_ID` (Zoho `vendor_id` on the bill)
 * @param {{ vendorName?: string, onWarning?: (s: string) => void }} [opts] — `vendorName` for fallback match when id unset
 */
async function getPurchases(fromDate, toDate, vendorId, opts = {}) {
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
  try {
    const { rows, truncated, pages } = await fetchListPaginated(
      `${INVENTORY_V1}/bills`,
      'bills',
      MAX_DEFAULT_PAGES
    )
    if (truncated) {
      onW('Bills list may be incomplete: pagination cap reached.')
    }
    const lineRows = []
    for (const bill of rows) {
      if (!isNotVoidStatus(bill)) continue
      if (!isDateInRangeIncl(bill.date, fromDate, toDate)) continue
      if (!matchesReportVendor(bill.vendor_id, vid, bill.vendor_name, vname2)) continue
      const lines = Array.isArray(bill.line_items) ? bill.line_items : []
      for (const li of lines) {
        lineRows.push({
          type: 'bill',
          document_id: bill.bill_id != null ? bill.bill_id : bill.bill_number,
          document_date: bill.date,
          item_id: li.item_id,
          name: li.name,
          quantity: parseLineQty(li.quantity),
        })
      }
    }
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
  try {
    // List response key per Zoho Inventory: `vendor_credits`
    const { rows, truncated, pages } = await fetchListPaginated(
      `${INVENTORY_V1}/vendorcredits`,
      'vendor_credits',
      MAX_DEFAULT_PAGES
    )
    if (truncated) onW('Vendor credits list may be incomplete: pagination cap reached.')
    const lineRows = []
    for (const vc of rows) {
      if (!isNotVoidStatus(vc)) continue
      if (!isDateInRangeIncl(vc.date, fromDate, toDate)) continue
      if (!matchesReportVendor(vc.vendor_id, vid, vc.vendor_name, vname2)) continue
      const lines = Array.isArray(vc.line_items) ? vc.line_items : []
      for (const li of lines) {
        lineRows.push({
          type: 'vendor_credit',
          document_id: vc.vendor_credit_id,
          document_date: vc.date,
          item_id: li.item_id,
          name: li.name,
          quantity: parseLineQty(li.quantity),
        })
      }
    }
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

module.exports = {
  getSales,
  getPurchases,
  getVendorCredits,
  isDateInRangeIncl,
  _internals: { parseLineQty, matchesReportVendor },
}
