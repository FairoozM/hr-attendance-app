/**
 * Zoho Books API v3 client — customers, invoices, credit notes.
 *
 * Performance strategy
 * ────────────────────
 * The raw /invoices list endpoint returns individual documents and requires
 * paginating through thousands of records (10 000+ rows = 50 pages = 3-4 min).
 *
 * Instead we use the Zoho Books REPORT endpoints which return pre-aggregated
 * per-customer totals in a handful of calls:
 *
 *   GET /books/v3/reports/salesbycustomer   → invoice totals per customer
 *   GET /books/v3/reports/creditnotes       → credit note totals per customer
 *     (credit notes are already fast via list, kept as primary with report fallback)
 *
 * Required Zoho OAuth scopes:
 *   ZohoBooks.contacts.READ
 *   ZohoBooks.invoices.READ
 *   ZohoBooks.creditnotes.READ
 */

const { zohoApiRequest, fetchListPaginated } = require('./zohoInventoryClient')

const BOOKS_V3 = '/books/v3'
const MAX_PAGES = 50
const MAX_CN_PAGES = 10   // credit notes are small, 10 pages is more than enough

// ── Customers ──────────────────────────────────────────────────────────────

/**
 * Fetch all Zoho Books customers.
 * @returns {Promise<object[]>}
 */
async function fetchCustomers() {
  const params = new URLSearchParams({
    contact_type: 'customer',
    sort_column:  'contact_name',
    sort_order:   'A',
  })
  const { rows } = await fetchListPaginated(`${BOOKS_V3}/contacts`, 'contacts', MAX_PAGES, params)
  return rows
}

// ── Sales by Customer report (replaces raw invoice pagination) ─────────────

/**
 * Fetch the "Sales by Customer" report from Zoho Books.
 *
 * This returns pre-aggregated per-customer totals (invoice_count, sub_total,
 * tax_amount, total) in a single API call — far faster than paginating through
 * thousands of individual invoice records.
 *
 * When customerId is supplied, filters to that customer only (fast path).
 *
 * Zoho Books report pagination: response has page_context.has_more_page.
 * Typical real-world result fits in 1-2 pages (one row per customer).
 *
 * @param {string} fromDate   YYYY-MM-DD
 * @param {string} toDate     YYYY-MM-DD
 * @param {string|null} customerId
 * @returns {Promise<{ rows: object[], truncated: boolean, pages: number }>}
 */
async function fetchSalesByCustomer(fromDate, toDate, customerId = null) {
  const params = new URLSearchParams()
  if (fromDate)    params.set('from_date',   fromDate)
  if (toDate)      params.set('to_date',     toDate)
  if (customerId)  params.set('customer_id', String(customerId))

  // The report endpoint uses different response keys depending on Zoho region/version.
  // We try 'salesbycustomer' first, then fall back to common alternatives.
  const t0 = Date.now()
  let page = 1
  const allRows = []
  let truncated = false

  while (page <= 10) {
    params.set('page', String(page))
    let json
    try {
      json = await zohoApiRequest(`${BOOKS_V3}/reports/salesbycustomer`, params)
    } catch (err) {
      const code = err?.zohoCode ?? err?.body?.code ?? err?.code
      if (code === 57 || String(code) === '57' || err?.status === 401) {
        console.warn('[zoho-books] salesbycustomer report: missing ZohoBooks.reports.READ scope — will fall back to invoice list')
        return { rows: [], truncated: false, pages: 0, scopeError: true }
      }
      // 404 / "Invalid URL" means the endpoint doesn't exist in this region — fall back
      if (err?.status === 404 || code === 5 || String(code) === '5') {
        console.warn('[zoho-books] salesbycustomer report: endpoint not found — falling back to invoice list')
        return { rows: [], truncated: false, pages: 0, scopeError: false }
      }
      throw err
    }

    // Zoho Books uses different top-level keys for different report responses
    const pageRows =
      json?.salesbycustomer ??
      json?.sales_by_customer ??
      json?.customers ??
      json?.report_rows ??
      []

    if (!Array.isArray(pageRows) || pageRows.length === 0) break

    allRows.push(...pageRows)

    const hasMore = json?.page_context?.has_more_page === true
    if (!hasMore) break

    if (page >= 10) { truncated = true; break }
    page++
  }

  console.log(`[zoho-books] salesbycustomer: ${allRows.length} customers in ${page} page(s) — ${Date.now() - t0}ms`)
  return { rows: allRows, truncated, pages: page }
}

/**
 * Fallback: raw invoice list pagination (used when report endpoint is unavailable
 * or when single-customer detail is needed).
 *
 * Hard-capped at 15 pages to prevent runaway fetches.
 */
async function fetchInvoices(fromDate, toDate, customerId = null) {
  const params = new URLSearchParams()
  if (fromDate)   params.set('date_start',  fromDate)
  if (toDate)     params.set('date_end',    toDate)
  if (customerId) params.set('customer_id', String(customerId))
  params.set('filter_by', 'Status.All')

  return fetchListPaginated(`${BOOKS_V3}/invoices`, 'invoices', 15, params)
}

// ── Credit Notes ──────────────────────────────────────────────────────────

/**
 * Fetch credit notes for the given date range.
 * Zoho Books has no pre-aggregated credit notes report endpoint — we use the
 * list endpoint directly. Credit notes are small (typically <500 per quarter)
 * so 1-3 pages load in 1-3 seconds.
 */
async function fetchCreditNotesByCustomer(fromDate, toDate, customerId = null) {
  return fetchCreditNotesList(fromDate, toDate, customerId)
}

/**
 * Raw credit notes list pagination (fallback / single-customer path).
 */
async function fetchCreditNotesList(fromDate, toDate, customerId = null) {
  const params = new URLSearchParams()
  if (fromDate)   params.set('date_start',  fromDate)
  if (toDate)     params.set('date_end',    toDate)
  if (customerId) params.set('customer_id', String(customerId))

  return fetchListPaginated(`${BOOKS_V3}/creditnotes`, 'creditnotes', MAX_CN_PAGES, params)
}

// Keep old name as alias for backward compat with controller
const fetchCreditNotes = fetchCreditNotesList

module.exports = {
  fetchCustomers,
  fetchSalesByCustomer,
  fetchInvoices,
  fetchCreditNotesByCustomer,
  fetchCreditNotes,
  BOOKS_V3,
}
