const { fetchCustomers, fetchInvoices } = require('../integrations/zoho/zohoBooksClient')
const { normalizeSettlementDate } = require('./amazonSettlementParserService')

const KSA_ZOHO_CUSTOMER_NAME = 'KSA-Amazon'
/** Zoho invoice date is often weeks before Amazon settlement payout. */
const INVOICE_LOOKBACK_DAYS = 120

let cachedKsaCustomerId = null

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function matchKey(value) {
  return clean(value).toLowerCase().replace(/\s+/g, '')
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function dateOnly(value) {
  return normalizeSettlementDate(value)
}

function shiftDateIso(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return isoDate
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

function deriveInvoiceRange(rows, lookbackDays = INVOICE_LOOKBACK_DAYS) {
  const dates = []
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const raw of [row.settlementStartDate, row.settlementEndDate, row.postedDate, row.depositDate]) {
      const d = dateOnly(raw)
      if (d) dates.push(d)
    }
  }
  dates.sort()
  const fallbackTo = new Date().toISOString().slice(0, 10)
  const fallbackFrom = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const settlementFromDate = dates[0] || fallbackFrom
  const settlementToDate = dates[dates.length - 1] || fallbackTo
  return {
    fromDate: shiftDateIso(settlementFromDate, -lookbackDays),
    toDate: settlementToDate,
    settlementFromDate,
    settlementToDate,
    lookbackDays,
  }
}

async function resolveKsaZohoCustomerId(options = {}) {
  if (options.customerId) return clean(options.customerId)
  const fromEnv = clean(process.env.AMAZON_KSA_ZOHO_CUSTOMER_ID)
  if (fromEnv) return fromEnv
  if (cachedKsaCustomerId) return cachedKsaCustomerId
  const customers = await fetchCustomers()
  const hit = (Array.isArray(customers) ? customers : []).find(
    (customer) => clean(customer?.contact_name || customer?.customer_name) === KSA_ZOHO_CUSTOMER_NAME
  )
  cachedKsaCustomerId = clean(hit?.contact_id || hit?.customer_id)
  return cachedKsaCustomerId || null
}

function invoiceNumber(invoice) {
  return clean(invoice?.invoice_number || invoice?.number)
}

function poNumber(invoice) {
  return clean(
    invoice?.reference_number ||
      invoice?.purchaseorder_number ||
      invoice?.purchase_order_number ||
      invoice?.po_number ||
      invoice?.poNumber
  )
}

function mapInvoice(invoice) {
  return {
    zohoInvoiceId: clean(invoice?.invoice_id || invoice?.id),
    zohoInvoiceNumber: invoiceNumber(invoice),
    zohoPoNumber: poNumber(invoice),
    zohoCustomerId: clean(invoice?.customer_id || invoice?.customerId),
    zohoCustomerName: clean(invoice?.customer_name || invoice?.customerName),
    zohoInvoiceTotal: num(invoice?.total),
    status: clean(invoice?.status),
    raw: invoice,
  }
}

function indexInvoices(invoices) {
  const byInvoiceNumber = new Map()
  const byPoNumber = new Map()
  const duplicateZohoInvoiceNumbers = []
  const duplicateZohoPoNumbers = []
  for (const invoice of Array.isArray(invoices) ? invoices : []) {
    const mapped = mapInvoice(invoice)
    const invoiceKey = matchKey(mapped.zohoInvoiceNumber)
    if (invoiceKey) {
      if (!byInvoiceNumber.has(invoiceKey)) {
        byInvoiceNumber.set(invoiceKey, [])
      }
      byInvoiceNumber.get(invoiceKey).push(mapped)
    }
    const poKey = matchKey(mapped.zohoPoNumber)
    if (poKey) {
      if (!byPoNumber.has(poKey)) {
        byPoNumber.set(poKey, [])
      }
      byPoNumber.get(poKey).push(mapped)
    }
  }
  for (const matches of byInvoiceNumber.values()) {
    if (matches.length > 1) duplicateZohoInvoiceNumbers.push(matches[0].zohoInvoiceNumber)
  }
  for (const matches of byPoNumber.values()) {
    if (matches.length > 1) duplicateZohoPoNumbers.push(matches[0].zohoPoNumber)
  }
  return { byInvoiceNumber, byPoNumber, duplicateZohoInvoiceNumbers, duplicateZohoPoNumbers }
}

function matchSettlementRowsToInvoices(rows, invoices) {
  const settlementRows = Array.isArray(rows) ? rows : []
  const { byInvoiceNumber, byPoNumber, duplicateZohoInvoiceNumbers, duplicateZohoPoNumbers } = indexInvoices(invoices)
  const matchedRows = []
  const unmatchedRows = []
  const matchedInvoices = []
  const unmatchedOrderIdsSet = new Set()
  const missingOrderIdRows = []

  for (const row of settlementRows) {
    const orderId = clean(row.orderId)
    const orderKey = matchKey(orderId)
    if (!orderId) {
      missingOrderIdRows.push(row)
      unmatchedRows.push({ ...row, reason: 'Settlement row is missing Amazon order ID' })
      continue
    }
    const poMatches = byPoNumber.get(orderKey) || []
    const invoiceMatches = poMatches.length > 0 ? [] : (byInvoiceNumber.get(orderKey) || [])
    const matches = poMatches.length > 0 ? poMatches : invoiceMatches
    if (matches.length > 0) {
      const invoice = matches[0]
      const matchType = poMatches.length > 0 ? 'po_number' : 'invoice_number_fallback'
      matchedRows.push({ ...row, zohoInvoice: invoice, matchType })
      matchedInvoices.push({ ...invoice, matchType })
    } else {
      unmatchedRows.push({ ...row, reason: 'No Zoho invoice found with matching PO number or invoice_number' })
      unmatchedOrderIdsSet.add(orderId)
    }
  }

  const uniqueMatchedInvoices = []
  const seen = new Set()
  for (const invoice of matchedInvoices) {
    const key = invoice.zohoInvoiceId || invoice.zohoInvoiceNumber
    if (!key || seen.has(key)) continue
    seen.add(key)
    uniqueMatchedInvoices.push(invoice)
  }

  return {
    matchedRows,
    unmatchedRows,
    matchedInvoices: uniqueMatchedInvoices,
    unmatchedOrderIds: Array.from(unmatchedOrderIdsSet).sort(),
    duplicateZohoInvoiceNumbers,
    duplicateZohoPoNumbers,
    missingOrderIdRows,
  }
}

async function fetchZohoInvoicesForSettlementRows(rows, options = {}) {
  const range = {
    ...deriveInvoiceRange(rows),
    ...(options.fromDate ? { fromDate: options.fromDate } : {}),
    ...(options.toDate ? { toDate: options.toDate } : {}),
  }
  const customerId = await resolveKsaZohoCustomerId(options)
  if (Array.isArray(options.invoices)) {
    return {
      rows: options.invoices,
      truncated: false,
      pages: 0,
      ...range,
      customerId,
      customerName: KSA_ZOHO_CUSTOMER_NAME,
    }
  }
  const result = await fetchInvoices(range.fromDate, range.toDate, customerId || null)
  return {
    rows: Array.isArray(result?.rows) ? result.rows : [],
    truncated: Boolean(result?.truncated),
    pages: Number(result?.pages) || 0,
    ...range,
    customerId,
    customerName: KSA_ZOHO_CUSTOMER_NAME,
  }
}

function buildZohoFetchWarnings(zohoFetch) {
  const warnings = []
  if (!zohoFetch) return warnings
  if (!zohoFetch.rows.length) {
    warnings.push('No Zoho invoices were loaded for matching. Check Zoho API credentials and limits, then re-run preview.')
    return warnings
  }
  if (zohoFetch.truncated) {
    warnings.push(
      `Zoho invoice fetch was truncated at 4,000 rows for ${zohoFetch.customerName || 'KSA-Amazon'} (${zohoFetch.fromDate} to ${zohoFetch.toDate}). Some matches may be missing.`
    )
  }
  if (!zohoFetch.customerId) {
    warnings.push(`Could not resolve Zoho customer "${KSA_ZOHO_CUSTOMER_NAME}". Set AMAZON_KSA_ZOHO_CUSTOMER_ID or verify the customer exists in Zoho Books.`)
  }
  return warnings
}

async function matchZohoInvoicesForRows(rows, options = {}) {
  const zohoFetch = await fetchZohoInvoicesForSettlementRows(rows, options)
  const invoices = zohoFetch.rows
  return {
    invoices,
    zohoFetch,
    zohoFetchWarnings: buildZohoFetchWarnings(zohoFetch),
    ...matchSettlementRowsToInvoices(rows, invoices),
  }
}

module.exports = {
  KSA_ZOHO_CUSTOMER_NAME,
  INVOICE_LOOKBACK_DAYS,
  deriveInvoiceRange,
  matchSettlementRowsToInvoices,
  matchZohoInvoicesForRows,
  fetchZohoInvoicesForSettlementRows,
  buildZohoFetchWarnings,
  resolveKsaZohoCustomerId,
  _internals: {
    indexInvoices,
    mapInvoice,
    invoiceNumber,
    poNumber,
    matchKey,
    shiftDateIso,
  },
}
