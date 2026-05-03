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

module.exports = {
  fetchCustomers,
  fetchInvoices,
  fetchCreditNotes,
  fetchCreditNotesByCustomer,
  BOOKS_V3,
}
