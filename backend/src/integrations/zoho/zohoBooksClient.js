/**
 * Zoho Books API v3 client — customers, invoices, credit notes.
 *
 * Reuses the same `zohoApiRequest` and `fetchListPaginated` helpers from
 * zohoInventoryClient.js (same OAuth credentials, same organization_id).
 *
 * Required Zoho OAuth scopes (must be present on the refresh token):
 *   ZohoBooks.contacts.READ
 *   ZohoBooks.invoices.READ
 *   ZohoBooks.creditnotes.READ
 *
 * If the token lacks these scopes, Zoho returns HTTP 401 / code 57.
 * The caller surfaces that as a ZOHO_API_ERROR with a clear message.
 */

const { zohoApiRequest, fetchListPaginated } = require('./zohoInventoryClient')

const BOOKS_V3 = '/books/v3'
const MAX_PAGES = 50

/**
 * Fetch all customers (contact_type=customer) from Zoho Books.
 * Cached by the caller — this always hits Zoho.
 *
 * @returns {Promise<object[]>}  Array of Zoho contact objects.
 */
async function fetchCustomers() {
  const params = new URLSearchParams()
  params.set('contact_type', 'customer')
  params.set('sort_column', 'contact_name')
  params.set('sort_order', 'A')

  const { rows } = await fetchListPaginated(
    `${BOOKS_V3}/contacts`,
    'contacts',
    MAX_PAGES,
    params
  )
  return rows
}

/**
 * Fetch all invoices in the given date range, optionally filtered to one customer.
 * Returns raw Zoho invoice objects (summary-level, not line-item detail).
 *
 * Zoho date filter params: date_start / date_end (Books v3 field names).
 *
 * @param {string} fromDate  YYYY-MM-DD
 * @param {string} toDate    YYYY-MM-DD
 * @param {string|null} [customerId]  Zoho contact_id; null = all customers
 * @returns {Promise<{ rows: object[], truncated: boolean, pages: number }>}
 */
async function fetchInvoices(fromDate, toDate, customerId = null) {
  const params = new URLSearchParams()
  if (fromDate) params.set('date_start', fromDate)
  if (toDate)   params.set('date_end',   toDate)
  if (customerId) params.set('customer_id', String(customerId))
  // Exclude void invoices
  params.set('filter_by', 'Status.All')

  return fetchListPaginated(
    `${BOOKS_V3}/invoices`,
    'invoices',
    MAX_PAGES,
    params
  )
}

/**
 * Fetch all credit notes in the given date range, optionally filtered to one customer.
 *
 * @param {string} fromDate  YYYY-MM-DD
 * @param {string} toDate    YYYY-MM-DD
 * @param {string|null} [customerId]
 * @returns {Promise<{ rows: object[], truncated: boolean, pages: number }>}
 */
async function fetchCreditNotes(fromDate, toDate, customerId = null) {
  const params = new URLSearchParams()
  if (fromDate) params.set('date_start', fromDate)
  if (toDate)   params.set('date_end',   toDate)
  if (customerId) params.set('customer_id', String(customerId))

  return fetchListPaginated(
    `${BOOKS_V3}/creditnotes`,
    'creditnotes',
    MAX_PAGES,
    params
  )
}

/**
 * Fetch a single invoice's full detail (includes line_items with tax breakdown).
 * Used when the list endpoint doesn't return tax_amount at the line level.
 *
 * @param {string} invoiceId
 * @returns {Promise<object>}
 */
async function fetchInvoiceDetail(invoiceId) {
  const json = await zohoApiRequest(`${BOOKS_V3}/invoices/${invoiceId}`)
  return json?.invoice || json
}

module.exports = {
  fetchCustomers,
  fetchInvoices,
  fetchCreditNotes,
  fetchInvoiceDetail,
  BOOKS_V3,
}
