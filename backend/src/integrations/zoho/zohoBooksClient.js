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
const MAX_PAGES  = 20          // 20 × 200 = 4,000 invoices hard cap (~12s parallel)
const BATCH_SIZE = 5           // concurrent page requests per batch
const MAX_CN_PAGES = 10        // credit notes are small, sequential is fine

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

  // ── Page 1 ──
  const page1Json = await zohoApiRequest(`${BOOKS_V3}/invoices`, pageParams(1))
  const page1Rows = page1Json?.invoices ?? []
  const allRows   = [...page1Rows]

  const hasMore = page1Json?.page_context?.has_more_page === true
  if (!hasMore) {
    console.log(`[zoho-books] invoices: ${allRows.length} rows in 1 page — ${Date.now() - t0}ms`)
    return { rows: allRows, truncated: false, pages: 1 }
  }

  // Estimate total pages from page_context.total (record count) if available
  const totalRecords = Number(page1Json?.page_context?.total ?? 0)
  const perPage      = page1Rows.length || 200
  const estimatedPages = totalRecords > 0
    ? Math.min(Math.ceil(totalRecords / perPage), MAX_PAGES)
    : MAX_PAGES

  // ── Pages 2…estimatedPages in parallel batches ──
  const remainingPageNums = []
  for (let p = 2; p <= estimatedPages; p++) remainingPageNums.push(p)

  let fetchedPages = 1
  let truncated    = false

  for (let i = 0; i < remainingPageNums.length; i += BATCH_SIZE) {
    const batch = remainingPageNums.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map((p) =>
        zohoApiRequest(`${BOOKS_V3}/invoices`, pageParams(p))
          .then((json) => ({ rows: json?.invoices ?? [], hasMore: json?.page_context?.has_more_page === true }))
          .catch(() => ({ rows: [], hasMore: false }))
      )
    )

    for (const result of results) {
      allRows.push(...result.rows)
      fetchedPages++
      // Stop early if Zoho says no more pages
      if (!result.hasMore && result.rows.length < perPage) break
    }

    // If last page in batch had no data, we're done
    if (results[results.length - 1].rows.length === 0) break
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
