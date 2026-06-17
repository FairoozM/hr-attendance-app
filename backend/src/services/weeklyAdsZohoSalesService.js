/**
 * Weekly Ads report: Net Sales (AED) from Zoho Books **Sales by Customer** report
 * (`GET /books/v3/reports/salesbycustomer`), using **Sales with tax** per row.
 *
 * Marketplace row labels map to Zoho Books `customer_name` **exactly** (trimmed):
 *   Amazon (UAE) → Amazon
 *   Amazon (KSA) → KSA-Amazon
 *   Noon         → Noon
 *   Website      → Website
 *
 * Any other Zoho customer on the report is ignored. Custom marketplace rows in the UI
 * that are not in the map above get `null` sales and a short warning.
 */

const { zohoBooksJsonRequest } = require('./zohoApiClient')

const BOOKS_V3 = '/books/v3'
const REPORT_PATH = `${BOOKS_V3}/reports/salesbycustomer`
const MAX_REPORT_PAGES = 25

/** @type {Record<string, string>} UI marketplace label → exact Zoho Books customer_name */
const MARKETPLACE_TO_ZOHO_CUSTOMER_NAME = {
  'Amazon (UAE)': 'Amazon',
  'Amazon (KSA)': 'KSA-Amazon',
  Noon: 'Noon',
  Website: 'Website',
}

/**
 * @param {object[]} rows - `sales` array from Books salesbycustomer JSON
 * @returns {Map<string, number>} exact customer_name → total sales_with_tax
 */
function aggregateSalesWithTaxByCustomerName(rows) {
  const m = new Map()
  if (!Array.isArray(rows)) return m
  for (const row of rows) {
    const name = String(row?.customer_name ?? '').trim()
    if (!name) continue
    const n = Number(row?.sales_with_tax)
    if (!Number.isFinite(n)) continue
    m.set(name, (m.get(name) || 0) + n)
  }
  return m
}

/**
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate - YYYY-MM-DD
 * @returns {Promise<object[]>} merged `sales` rows across pages
 */
async function fetchAllSalesByCustomerRows(fromDate, toDate) {
  const all = []
  let page = 1
  while (page <= MAX_REPORT_PAGES) {
    const sp = new URLSearchParams({
      from_date: fromDate,
      to_date: toDate,
      page: String(page),
      per_page: '200',
    })
    const json = await zohoBooksJsonRequest(REPORT_PATH, sp, 'GET', undefined, {
      skipCache: true,
      source: 'weekly_ads_salesbycustomer',
    })
    const batch = json?.sales
    if (Array.isArray(batch) && batch.length) all.push(...batch)
    if (!json?.page_context?.has_more_page) break
    page += 1
  }
  return all
}

/**
 * @param {object} opts
 * @param {string} opts.fromDate - YYYY-MM-DD
 * @param {string} opts.toDate - YYYY-MM-DD
 * @param {string[]} opts.marketplaceNames
 * @returns {Promise<object>}
 */
async function fetchWeeklyAdsZohoSalesWithTax({ fromDate, toDate, marketplaceNames }) {
  const names = Array.isArray(marketplaceNames)
    ? marketplaceNames.map((s) => String(s || '').trim()).filter(Boolean)
    : []
  if (!fromDate || !toDate) {
    const e = new Error('from_date and to_date are required')
    e.code = 'BAD_REQUEST'
    throw e
  }
  if (names.length === 0) {
    const e = new Error('marketplaces must be a non-empty array')
    e.code = 'BAD_REQUEST'
    throw e
  }

  const rows = await fetchAllSalesByCustomerRows(fromDate, toDate)
  const byZohoCustomer = aggregateSalesWithTaxByCustomerName(rows)
  const warnings = []

  /** @type {Record<string, number|null>} */
  const sales = {}
  /** @type {Record<string, { zoho_customer_name: string }|null>} */
  const books_customer_resolution = {}

  for (const name of names) {
    const zohoName = MARKETPLACE_TO_ZOHO_CUSTOMER_NAME[name]
    if (!zohoName) {
      sales[name] = null
      books_customer_resolution[name] = null
      warnings.push(
        `"${name}" is not mapped to a Zoho Books customer for Weekly Ads. Known rows: Amazon (UAE), Amazon (KSA), Noon, Website.`,
      )
      continue
    }
    books_customer_resolution[name] = { zoho_customer_name: zohoName }
    if (!byZohoCustomer.has(zohoName)) {
      sales[name] = null
      warnings.push(
        `No Zoho Books Sales-by-Customer row for customer "${zohoName}" in this date range (${name}).`,
      )
      continue
    }
    sales[name] = byZohoCustomer.get(zohoName)
  }

  return {
    from_date: fromDate,
    to_date: toDate,
    sales,
    books_customer_resolution,
    /** @deprecated Books path; kept empty for older clients */
    warehouse_resolution: {},
    warnings,
    source: 'zoho_books_reports_salesbycustomer',
    amount_basis: 'sales_with_tax',
  }
}

module.exports = {
  fetchWeeklyAdsZohoSalesWithTax,
  _internals: { MARKETPLACE_TO_ZOHO_CUSTOMER_NAME, aggregateSalesWithTaxByCustomerName },
}
