/**
 * Zoho Books API v3 client — customers, invoices, credit notes.
 *
 * Performance strategy
 * ────────────────────
 * The raw /invoices list is the only reliable source of sub_total + tax_total
 * data needed for a VAT report. The salesbycustomer report endpoint was tried
 * but does NOT return tax breakdown fields, making it useless for VAT filing.
 *
 * To avoid CloudFront 30s timeouts we fetch invoice pages IN PARALLEL
 * (batches of 5 concurrent requests), which is ~5× faster than sequential:
 *
 *   414 invoices (3 pages)  → ~3s  (was 7-10s sequential)
 *   2000 invoices (10 pages) → ~6s  (was ~25s sequential)
 *   4000 invoices (20 pages) → ~12s (hard cap, truncation warning shown)
 *
 * Required Zoho OAuth scopes:
 *   ZohoBooks.contacts.READ
 *   ZohoBooks.invoices.READ
 *   ZohoBooks.creditnotes.READ
 *   ZohoBooks.reports.READ   (kept in token for future use)
 */

const { zohoApiRequest, fetchListPaginated } = require('./zohoInventoryClient')

const BOOKS_V3   = '/books/v3'
const MAX_PAGES    = 20    // 20 × 200 = 4,000 invoices hard cap
const BATCH_SIZE   = 6   // concurrent page requests — lower burst vs Zoho daily quota
const MAX_CN_PAGES = 10   // credit notes are small, sequential is fine

// ── Customers ──────────────────────────────────────────────────────────────

/**
 * Fetch all Zoho Books customers (contact_type=customer).
 * @returns {Promise<object[]>}
 */
async function fetchCustomers() {
  const params = new URLSearchParams({
    contact_type: 'customer',
    sort_column:  'contact_name',
    sort_order:   'A',
  })
  const { rows } = await fetchListPaginated(`${BOOKS_V3}/contacts`, 'contacts', 50, params)
  return rows
}

// ── Invoices (parallel page fetching) ─────────────────────────────────────

/**
 * Fetch invoices for the given date range using parallel page requests.
 *
 * Page 1 is fetched first to detect whether there are more pages.
 * Remaining pages up to MAX_PAGES are then fetched in batches of BATCH_SIZE
 * concurrent requests — 5× faster than sequential pagination.
 *
 * Each invoice includes sub_total (taxable) and tax_total (VAT amount),
 * which are the fields required for the KSA VAT report.
 *
 * @param {string} fromDate   YYYY-MM-DD
 * @param {string} toDate     YYYY-MM-DD
 * @param {string|null} customerId
 * @returns {Promise<{ rows: object[], truncated: boolean, pages: number }>}
 */
async function fetchInvoices(fromDate, toDate, customerId = null) {
  const t0 = Date.now()

  function pageParams(page) {
    const p = new URLSearchParams()
    if (fromDate)    p.set('date_start',  fromDate)
    if (toDate)      p.set('date_end',    toDate)
    if (customerId)  p.set('customer_id', String(customerId))
    p.set('filter_by', 'Status.All')
    p.set('page',      String(page))
    p.set('per_page',  '200')
    return p
  }

  // ── Fire the first BATCH_SIZE pages simultaneously ──
  // Most queries fit in 1-5 pages so this eliminates the sequential
  // "page 1 first, then rest" delay entirely.
  let fetchedPages = 0
  let truncated    = false
  const allRows    = []

  let nextPage = 1
  while (nextPage <= MAX_PAGES) {
    const pagesToFetch = []
    for (let p = nextPage; p < nextPage + BATCH_SIZE && p <= MAX_PAGES; p++) {
      pagesToFetch.push(p)
    }
    nextPage += BATCH_SIZE

    const results = await Promise.all(
      pagesToFetch.map((p) =>
        zohoApiRequest(`${BOOKS_V3}/invoices`, pageParams(p))
          .then((json) => ({
            rows:    json?.invoices ?? [],
            hasMore: json?.page_context?.has_more_page === true,
            total:   Number(json?.page_context?.total ?? 0),
          }))
          .catch(() => ({ rows: [], hasMore: false, total: 0 }))
      )
    )

    let doneEarly = false
    for (const result of results) {
      fetchedPages++
      allRows.push(...result.rows)

      // If Zoho says no more pages, or returned an empty page, stop
      if (!result.hasMore || result.rows.length === 0) {
        doneEarly = true
        break
      }

      // Use total record count to skip unnecessary future fetches
      if (result.total > 0) {
        const perPage     = result.rows.length || 200
        const totalPages  = Math.ceil(result.total / perPage)
        if (fetchedPages >= Math.min(totalPages, MAX_PAGES)) {
          doneEarly = true
          break
        }
      }
    }

    if (doneEarly) break
  }

  if (fetchedPages >= MAX_PAGES) truncated = true

  console.log(`[zoho-books] invoices: ${allRows.length} rows in ${fetchedPages} page(s)${truncated ? ' [TRUNCATED]' : ''} — ${Date.now() - t0}ms`)
  return { rows: allRows, truncated, pages: fetchedPages }
}

// ── Credit Notes ──────────────────────────────────────────────────────────

/**
 * Fetch credit notes — sequential list (small volume, fast enough).
 * Zoho Books has no pre-aggregated credit notes report endpoint.
 *
 * @param {string} fromDate
 * @param {string} toDate
 * @param {string|null} customerId
 * @returns {Promise<{ rows: object[], truncated: boolean, pages: number }>}
 */
async function fetchCreditNotes(fromDate, toDate, customerId = null) {
  const params = new URLSearchParams()
  if (fromDate)   params.set('date_start',  fromDate)
  if (toDate)     params.set('date_end',    toDate)
  if (customerId) params.set('customer_id', String(customerId))

  return fetchListPaginated(`${BOOKS_V3}/creditnotes`, 'creditnotes', MAX_CN_PAGES, params)
}

// Export fetchCreditNotesByCustomer as alias (used by controller)
const fetchCreditNotesByCustomer = fetchCreditNotes

function buildZohoJsonStringBody(payload) {
  const form = new URLSearchParams()
  form.set('JSONString', JSON.stringify(payload))
  return form.toString()
}

/**
 * List invoices a credit note has been applied to.
 * @param {string} creditNoteId
 * @returns {Promise<object[]>}
 */
async function listCreditNoteInvoiceApplications(creditNoteId) {
  const id = String(creditNoteId || '').trim()
  if (!id) return []
  const json = await zohoApiRequest(`${BOOKS_V3}/creditnotes/${encodeURIComponent(id)}/invoices`, new URLSearchParams())
  if (Array.isArray(json?.invoices)) return json.invoices
  if (Array.isArray(json?.creditnote?.invoices)) return json.creditnote.invoices
  return []
}

async function listCreditNoteRefunds(creditNoteId) {
  const id = String(creditNoteId || '').trim()
  if (!id) return []
  const json = await zohoApiRequest(`${BOOKS_V3}/creditnotes/${encodeURIComponent(id)}/refunds`, new URLSearchParams())
  if (Array.isArray(json?.creditnote_refunds)) return json.creditnote_refunds
  if (Array.isArray(json?.creditnote?.creditnote_refunds)) return json.creditnote.creditnote_refunds
  return []
}

/**
 * Refund an open credit note balance to a bank/cash account (e.g. undeposited funds).
 * @param {string} creditNoteId
 * @param {object} payload
 */
async function refundCreditNote(creditNoteId, payload) {
  const id = String(creditNoteId || '').trim()
  const body = {
    date: payload.date,
    refund_mode: payload.refund_mode || payload.refundMode || 'Bank Transfer',
    reference_number: payload.reference_number || payload.referenceNumber || '',
    amount: Number(payload.amount) || 0,
    from_account_id: String(payload.from_account_id || payload.fromAccountId || ''),
    description: payload.description || '',
  }
  const json = await zohoApiRequest(
    `${BOOKS_V3}/creditnotes/${encodeURIComponent(id)}/refunds`,
    new URLSearchParams(),
    'POST',
    buildZohoJsonStringBody(body),
    { source: 'amazon_payment_clearing_cn_refund', skipCache: true, critical: true }
  )
  const refund = json?.creditnote_refund || json?.creditnote?.creditnote_refund || json || {}
  return {
    creditNoteRefundId: refund.creditnote_refund_id || refund.credit_note_refund_id || refund.id || '',
    creditNoteId: refund.creditnote_id || id,
    amount: Number(refund.amount ?? refund.amount_bcy ?? body.amount) || 0,
    referenceNumber: refund.reference_number || body.reference_number || '',
    raw: json,
  }
}

/**
 * Apply credit note balance to one or more invoices.
 * @param {string} creditNoteId
 * @param {{ invoice_id: string, amount_applied: number }[]} invoices
 */
async function applyCreditNoteToInvoice(creditNoteId, invoices) {
  const id = String(creditNoteId || '').trim()
  const payload = {
    invoices: (Array.isArray(invoices) ? invoices : []).map((row) => ({
      invoice_id: String(row.invoice_id || row.invoiceId || ''),
      amount_applied: Number(row.amount_applied ?? row.amountApplied) || 0,
    })),
  }
  const json = await zohoApiRequest(
    `${BOOKS_V3}/creditnotes/${encodeURIComponent(id)}/invoices`,
    new URLSearchParams(),
    'POST',
    buildZohoJsonStringBody(payload),
    { source: 'amazon_payment_clearing_cn_apply', skipCache: true, critical: true }
  )
  return json
}

/**
 * Create an open credit note in Zoho Books.
 * @param {object} payload
 */
function clean(value) {
  return value == null ? '' : String(value).trim()
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function invoiceBalanceDue(invoice) {
  if (!invoice) return null
  const raw = invoice.balance ?? invoice.balance_due ?? invoice.unpaid_amount ?? invoice.amount_due
  if (raw == null || raw === '') return null
  return Math.round(num(raw) * 100) / 100
}

/**
 * Fetch a single Zoho Books invoice (includes live balance due).
 * @param {string} invoiceId
 */
async function fetchInvoiceById(invoiceId) {
  const id = clean(invoiceId)
  if (!id) return null
  const json = await zohoApiRequest(
    `${BOOKS_V3}/invoices/${encodeURIComponent(id)}`,
    new URLSearchParams(),
    'GET',
    undefined,
    { source: 'amazon_payment_clearing_invoice', skipCache: true }
  )
  return json?.invoice || json || null
}

/**
 * Fetch multiple invoices by id in parallel for payment balance checks.
 * @param {string[]} invoiceIds
 * @returns {Promise<Map<string, object>>}
 */
async function fetchInvoicesByIds(invoiceIds) {
  const ids = [...new Set((Array.isArray(invoiceIds) ? invoiceIds : []).map(clean).filter(Boolean))]
  const rows = await Promise.all(ids.map((id) => fetchInvoiceById(id).catch(() => null)))
  const out = new Map()
  for (const invoice of rows) {
    if (!invoice) continue
    const id = clean(invoice.invoice_id || invoice.id)
    if (id) out.set(id, invoice)
  }
  return out
}

async function createCreditNote(payload) {
  const json = await zohoApiRequest(
    `${BOOKS_V3}/creditnotes`,
    new URLSearchParams(),
    'POST',
    buildZohoJsonStringBody(payload),
    { source: 'amazon_payment_clearing_cn_create', skipCache: true, critical: true }
  )
  const body = json?.creditnote || json || {}
  return {
    creditNoteId: body.creditnote_id || body.credit_note_id || body.id || '',
    creditNoteNumber: body.creditnote_number || body.credit_note_number || body.number || '',
    raw: json,
  }
}

module.exports = {
  fetchCustomers,
  fetchInvoices,
  fetchInvoiceById,
  fetchInvoicesByIds,
  invoiceBalanceDue,
  fetchCreditNotes,
  fetchCreditNotesByCustomer,
  listCreditNoteInvoiceApplications,
  listCreditNoteRefunds,
  applyCreditNoteToInvoice,
  refundCreditNote,
  createCreditNote,
  BOOKS_V3,
}
