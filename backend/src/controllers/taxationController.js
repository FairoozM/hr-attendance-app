/**
 * Taxation API controllers.
 *
 * GET /api/taxation/vat/customers  – Zoho Books customer list (cached 5 min)
 * GET /api/taxation/vat/report     – Invoice + credit-note totals for a date range
 *
 * Error handling mirrors weeklyReportsController.js: same codes, same HTTP statuses.
 */

const { fetchCustomers, fetchInvoices, fetchCreditNotes } = require('../integrations/zoho/zohoBooksClient')
const { validateDateRange, handleZohoError } = require('./weeklyReportsController')

const KSA_VAT_RATE = 0.15

// ── Customer cache (5 min TTL, module-level) ────────────────────────────────
let _customerCache = null
const CUSTOMER_CACHE_TTL_MS = 5 * 60 * 1000

async function getCachedCustomers() {
  if (_customerCache && Date.now() < _customerCache.expiresAt) {
    return _customerCache.contacts
  }
  const contacts = await fetchCustomers()
  _customerCache = { contacts, expiresAt: Date.now() + CUSTOMER_CACHE_TTL_MS }
  console.log(`[taxation] cached ${contacts.length} customer(s)`)
  return contacts
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a numeric field from a Zoho object (may be string, number, or absent).
 */
function parseNum(v) {
  if (v == null) return 0
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = parseFloat(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

/**
 * Aggregate a flat list of Zoho invoice/credit-note summary rows into
 * per-customer totals.
 *
 * Zoho Books summary fields used (all present on list responses):
 *   invoice:     customer_id, customer_name, total, sub_total, tax_total, status
 *   creditnote:  customer_id, customer_name, total, sub_total, tax_total (or tax_amount), status
 *
 * For voided documents, total/tax figures are already 0 in Zoho — we still skip
 * them explicitly to be safe.
 *
 * @param {object[]} rows
 * @param {'invoice'|'creditnote'} type
 * @returns {object[]}  Array of per-customer aggregate objects
 */
function aggregateByCustomer(rows, type) {
  const map = new Map()

  for (const row of rows) {
    // Skip voided documents
    const status = row.status ? String(row.status).toLowerCase() : ''
    if (status === 'void' || status === 'voided') continue

    const customerId   = row.customer_id   || row.contact_id || ''
    const customerName = row.customer_name || row.contact_name || 'Unknown'

    const subTotal = parseNum(row.sub_total)   // taxable amount
    // Zoho may use tax_total or tax_amount depending on endpoint/version
    const taxAmount = parseNum(row.tax_total ?? row.tax_amount)
    const total     = parseNum(row.total)

    if (!map.has(customerId)) {
      map.set(customerId, {
        customer_id:   customerId,
        customer_name: customerName,
        count:         0,
        taxable_amount: 0,
        tax_amount:     0,
        total:          0,
      })
    }
    const entry = map.get(customerId)
    entry.count         += 1
    entry.taxable_amount += subTotal
    entry.tax_amount    += taxAmount
    entry.total         += total
  }

  return Array.from(map.values())
    .sort((a, b) => a.customer_name.localeCompare(b.customer_name))
}

/**
 * Compute grand totals across all per-customer rows.
 */
function grandTotals(rows) {
  let taxable = 0, tax = 0, total = 0
  for (const r of rows) {
    taxable += r.taxable_amount
    tax     += r.tax_amount
    total   += r.total
  }

  // If Zoho did not return tax figures, derive from taxable × KSA_VAT_RATE
  const effectiveTax = tax > 0 ? tax : taxable * KSA_VAT_RATE

  return { taxable, tax, effective_tax: effectiveTax, total }
}

// ── Route handlers ───────────────────────────────────────────────────────────

/**
 * GET /api/taxation/vat/customers
 * Returns all Zoho Books customers (cached 5 min).
 */
async function getVatCustomers(_req, res) {
  try {
    const contacts = await getCachedCustomers()
    return res.json({ contacts })
  } catch (err) {
    return handleZohoError(res, err, 'getVatCustomers')
  }
}

/**
 * GET /api/taxation/vat/report?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD[&customer_id=...]
 *
 * Fetches invoices and credit notes in parallel from Zoho Books,
 * aggregates per customer, and returns totals.
 */
async function getVatReport(req, res) {
  const range = validateDateRange(req, res)
  if (!range) return

  const customerId = req.query.customer_id && String(req.query.customer_id).trim() !== ''
    ? String(req.query.customer_id).trim()
    : null

  const t0 = Date.now()
  try {
    const [invResult, cnResult] = await Promise.all([
      fetchInvoices(range.from_date, range.to_date, customerId),
      fetchCreditNotes(range.from_date, range.to_date, customerId),
    ])
    console.log(
      `[taxation] vat-report from=${range.from_date} to=${range.to_date}` +
      ` customer=${customerId || 'all'}` +
      ` invoices=${invResult.rows.length} cn=${cnResult.rows.length}` +
      ` ${Date.now() - t0}ms`
    )

    const invoiceRows    = aggregateByCustomer(invResult.rows, 'invoice')
    const creditNoteRows = aggregateByCustomer(cnResult.rows, 'creditnote')

    const invTotals = grandTotals(invoiceRows)
    const cnTotals  = grandTotals(creditNoteRows)

    return res.json({
      from_date:   range.from_date,
      to_date:     range.to_date,
      customer_id: customerId,
      invoices:    invoiceRows,
      credit_notes: creditNoteRows,
      totals: {
        invoice_taxable:  invTotals.taxable,
        invoice_tax:      invTotals.effective_tax,
        invoice_total:    invTotals.total,
        cn_taxable:       cnTotals.taxable,
        cn_tax:           cnTotals.effective_tax,
        cn_total:         cnTotals.total,
      },
      meta: {
        invoice_truncated:    invResult.truncated,
        credit_note_truncated: cnResult.truncated,
        vat_rate:             KSA_VAT_RATE,
      },
    })
  } catch (err) {
    return handleZohoError(res, err, 'getVatReport')
  }
}

module.exports = { getVatCustomers, getVatReport }
