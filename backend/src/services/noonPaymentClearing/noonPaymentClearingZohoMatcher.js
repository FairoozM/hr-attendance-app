const { fetchCustomers, fetchInvoices } = require('../../integrations/zoho/zohoBooksClient')
const {
  ROW_CLASS,
  requiresZohoInvoice,
  invoiceMatchKeyForRow,
  round2,
  num,
  clean,
} = require('./noonPaymentClearingCategoryService')
const {
  matchKey,
  resolveNoonOrderIds,
  isParentOnlyMatch,
  parseNoonOrderId,
} = require('./noonOrderIdHelper')
const { getNoonPaymentClearingMarketplaceConfig } = require('./noonPaymentClearingMarketplaceConfig')
const { normalizeNoonDate } = require('./noonStatementParserService')

/** Noon invoices can be created long before settlement payout — keep a wide window. */
const INVOICE_LOOKBACK_DAYS = 1095
const INVOICE_FORWARD_DAYS = 90

const customerIdByNameCache = new Map()

function poNumber(invoice) {
  return clean(
    invoice?.reference_number ||
      invoice?.purchaseorder_number ||
      invoice?.purchase_order_number ||
      invoice?.po_number ||
      invoice?.poNumber
  )
}

/** Zoho UI "Order Number" column — often reference_number, otherwise custom field / sales order. */
function orderNumber(invoice) {
  const direct = clean(
    invoice?.order_number ||
      invoice?.orderNumber ||
      invoice?.salesorder_number ||
      invoice?.sales_order_number
  )
  if (direct) return direct
  for (const cf of Array.isArray(invoice?.custom_fields) ? invoice.custom_fields : []) {
    const label = clean(cf?.label || cf?.placeholder || cf?.api_name || cf?.field_name || '').toLowerCase()
    if (
      label === 'order number' ||
      label === 'order_number' ||
      label === 'ordernumber' ||
      label === 'cf_order_number'
    ) {
      const value = clean(cf?.value ?? cf?.value_formatted)
      if (value) return value
    }
  }
  return ''
}

function invoiceNumber(invoice) {
  return clean(invoice?.invoice_number || invoice?.number)
}

function mapInvoice(invoice) {
  const zohoPoNumber = poNumber(invoice)
  const zohoOrderNumber = orderNumber(invoice)
  return {
    zohoInvoiceId: clean(invoice?.invoice_id || invoice?.id),
    zohoInvoiceNumber: invoiceNumber(invoice),
    zohoPoNumber,
    zohoOrderNumber,
    /** Primary Noon match key candidates (item-level IDs). */
    matchKeys: [zohoOrderNumber, zohoPoNumber].filter(Boolean),
    zohoCustomerId: clean(invoice?.customer_id || invoice?.customerId),
    zohoCustomerName: clean(invoice?.customer_name || invoice?.customerName),
    zohoInvoiceTotal: num(invoice?.total ?? invoice?.invoice_total),
    balance: num(invoice?.balance ?? invoice?.balance_due),
    raw: invoice,
  }
}

function indexInvoices(invoices) {
  const byInvoiceNumber = new Map()
  const byOrderRef = new Map()
  for (const invoice of Array.isArray(invoices) ? invoices : []) {
    const mapped = mapInvoice(invoice)
    const invoiceKey = matchKey(mapped.zohoInvoiceNumber)
    if (invoiceKey) {
      if (!byInvoiceNumber.has(invoiceKey)) byInvoiceNumber.set(invoiceKey, [])
      byInvoiceNumber.get(invoiceKey).push(mapped)
    }
    for (const rawKey of mapped.matchKeys) {
      const key = matchKey(rawKey)
      if (!key) continue
      if (!byOrderRef.has(key)) byOrderRef.set(key, [])
      byOrderRef.get(key).push(mapped)
    }
  }
  return { byInvoiceNumber, byOrderRef, byPoNumber: byOrderRef }
}

/**
 * Exact item-level match only. Never accept parent PO when matching a child item ID.
 */
function findExactInvoiceMatches(itemOrderId, byOrderRef, byInvoiceNumber) {
  const key = matchKey(itemOrderId)
  if (!key) return { matches: [], matchType: '' }
  const orderMatches = (byOrderRef.get(key) || []).filter((inv) =>
    (inv.matchKeys || []).some((candidate) => matchKey(candidate) === key)
  )
  if (orderMatches.length > 0) return { matches: orderMatches, matchType: 'order_number' }
  const invMatches = (byInvoiceNumber.get(key) || []).filter(
    (inv) => matchKey(inv.zohoInvoiceNumber) === key
  )
  if (invMatches.length > 0) return { matches: invMatches, matchType: 'invoice_number_fallback' }
  return { matches: [], matchType: '' }
}

function shiftDateIso(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return isoDate
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

function deriveInvoiceRange(rows) {
  const dates = []
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const raw of [row.orderDate, row.transactionDate]) {
      const d = normalizeNoonDate(raw) || clean(raw)
      if (d) dates.push(d)
    }
  }
  dates.sort()
  const today = new Date().toISOString().slice(0, 10)
  const settlementFromDate = dates[0] || shiftDateIso(today, -60)
  const settlementToDate = dates[dates.length - 1] || today
  return {
    fromDate: shiftDateIso(settlementFromDate, -INVOICE_LOOKBACK_DAYS),
    toDate: settlementToDate >= today ? settlementToDate : today,
    settlementFromDate,
    settlementToDate,
  }
}

async function resolveZohoCustomerByName(customerName) {
  const name = clean(customerName)
  if (!name) return null
  if (customerIdByNameCache.has(name)) return customerIdByNameCache.get(name)
  const customers = await fetchCustomers()
  const hit = (Array.isArray(customers) ? customers : []).find(
    (customer) => clean(customer?.contact_name || customer?.customer_name) === name
  )
  const id = clean(hit?.contact_id || hit?.customer_id)
  if (id) customerIdByNameCache.set(name, id)
  return id || null
}

function saleItemGroups(rows) {
  const groups = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!requiresZohoInvoice(row.rowClass)) continue
    const matchKeyId = invoiceMatchKeyForRow(row)
    const ids = resolveNoonOrderIds({ orderNr: row.orderNr, itemNr: row.itemNr })
    const key = matchKeyId || `row:${row.rowNumber}`
    if (!groups.has(key)) {
      groups.set(key, {
        itemOrderId: ids.itemOrderId || matchKeyId,
        parentOrderId: ids.parentOrderId,
        sku: clean(row.sku),
        partnerSku: clean(row.partnerSku),
        title: clean(row.title),
        rows: [],
        netProceed: 0,
        referralFee: 0,
        fulfillmentFee: 0,
        shippingCharges: 0,
        total: 0,
      })
    }
    const g = groups.get(key)
    g.rows.push(row)
    g.netProceed = round2(g.netProceed + num(row.netProceed))
    g.referralFee = round2(g.referralFee + num(row.referralFee))
    g.fulfillmentFee = round2(g.fulfillmentFee + num(row.fulfillmentFee))
    g.shippingCharges = round2(g.shippingCharges + num(row.shippingCharges))
    g.total = round2(g.total + num(row.total))
    if (row.sku) g.sku = clean(row.sku)
  }
  return Array.from(groups.values())
}

/**
 * Match sale item groups to Zoho invoices using FULL item-level Noon IDs only.
 */
function matchNoonRowsToInvoices(rows, invoices) {
  const list = Array.isArray(invoices) ? invoices : Array.isArray(invoices?.rows) ? invoices.rows : []
  const { byInvoiceNumber, byOrderRef } = indexInvoices(list)
  const matchedItems = []
  const unmatchedItems = []
  const multipleMatchItems = []
  const notApplicableRows = []
  const annotatedRows = []

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!requiresZohoInvoice(row.rowClass)) {
      notApplicableRows.push(row)
      annotatedRows.push({
        ...row,
        matchStatus: 'not_applicable',
        matchType: '',
        zohoInvoiceId: '',
        zohoInvoiceNumber: '',
        zohoPoNumber: '',
      })
      continue
    }
    // Sale rows are matched at group level below; placeholder for now.
  }

  const groups = saleItemGroups(rows)
  const groupResultByKey = new Map()

  for (const group of groups) {
    const itemOrderId = clean(group.itemOrderId)
    const parentOrderId = clean(group.parentOrderId)
    if (!itemOrderId) {
      const entry = {
        ...group,
        matchStatus: 'missing_invoice',
        matchType: '',
        reason: 'Sale item is missing an item-level Noon order ID',
        zohoInvoice: null,
      }
      unmatchedItems.push(entry)
      groupResultByKey.set(`row-group:${group.rows[0]?.rowNumber}`, entry)
      continue
    }

    // Protect against parent→child false matches: if someone stored parent on Zoho for a child ID search, reject.
    const { matches, matchType } = findExactInvoiceMatches(itemOrderId, byOrderRef, byInvoiceNumber)

    // Extra guard: drop any match that is only a parent of this item.
    const parsedItem = parseNoonOrderId(itemOrderId)
    const exact = matches.filter((inv) => {
      const candidates = [...(inv.matchKeys || []), inv.zohoInvoiceNumber]
      if (candidates.some((c) => isParentOnlyMatch({ candidate: c, itemOrderId, parentOrderId }))) {
        return false
      }
      if (
        parsedItem.shape === 'item' &&
        candidates.some((c) => matchKey(c) === matchKey(parsedItem.parentOrderId))
      ) {
        return false
      }
      return candidates.some((c) => matchKey(c) === matchKey(itemOrderId))
    })

    if (exact.length === 1) {
      const invoice = exact[0]
      const entry = {
        ...group,
        matchStatus: 'matched',
        matchType,
        zohoInvoice: invoice,
        zohoInvoiceId: invoice.zohoInvoiceId,
        zohoInvoiceNumber: invoice.zohoInvoiceNumber,
        zohoPoNumber: invoice.zohoPoNumber,
        zohoCustomerId: invoice.zohoCustomerId,
        zohoCustomerName: invoice.zohoCustomerName,
        zohoInvoiceTotal: invoice.zohoInvoiceTotal,
      }
      matchedItems.push(entry)
      groupResultByKey.set(matchKey(itemOrderId), entry)
    } else if (exact.length > 1) {
      const entry = {
        ...group,
        matchStatus: 'multiple_matches',
        matchType,
        reason: `Multiple Zoho invoices found for item order ${itemOrderId}`,
        zohoInvoiceCandidates: exact,
        zohoInvoice: null,
      }
      multipleMatchItems.push(entry)
      unmatchedItems.push(entry)
      groupResultByKey.set(matchKey(itemOrderId), entry)
    } else {
      const entry = {
        ...group,
        matchStatus: 'missing_invoice',
        matchType: '',
        reason: `No Zoho invoice found for exact item order ${itemOrderId}`,
        zohoInvoice: null,
      }
      unmatchedItems.push(entry)
      groupResultByKey.set(matchKey(itemOrderId), entry)
    }
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!requiresZohoInvoice(row.rowClass)) continue
    const key = matchKey(invoiceMatchKeyForRow(row))
    const entry = groupResultByKey.get(key)
    if (!entry) {
      annotatedRows.push({
        ...row,
        matchStatus: 'missing_invoice',
        reason: 'Sale item could not be grouped for matching',
      })
      continue
    }
    annotatedRows.push({
      ...row,
      matchStatus: entry.matchStatus,
      matchType: entry.matchType || '',
      zohoInvoiceId: entry.zohoInvoiceId || '',
      zohoInvoiceNumber: entry.zohoInvoiceNumber || '',
      zohoPoNumber: entry.zohoPoNumber || '',
      zohoCustomerId: entry.zohoCustomerId || '',
      zohoCustomerName: entry.zohoCustomerName || '',
      zohoInvoiceTotal: entry.zohoInvoiceTotal,
      blockingReason:
        entry.matchStatus === 'matched' ? '' : entry.reason || entry.matchStatus,
    })
  }

  // Merge not-applicable annotations
  const saleRowNumbers = new Set(annotatedRows.map((r) => r.rowNumber))
  for (const row of Array.isArray(rows) ? rows : []) {
    if (saleRowNumbers.has(row.rowNumber)) continue
    annotatedRows.push({
      ...row,
      matchStatus: 'not_applicable',
      matchType: '',
      zohoInvoiceId: '',
      zohoInvoiceNumber: '',
    })
  }
  annotatedRows.sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0))

  return {
    matchedItems,
    unmatchedItems,
    multipleMatchItems,
    notApplicableRows,
    annotatedRows,
    matchedOrders: matchedItems,
    unmatchedOrders: unmatchedItems.filter((i) => i.matchStatus !== 'multiple_matches'),
  }
}

async function matchZohoInvoicesForNoonRows(rows, options = {}) {
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const customerName = clean(options.customerName) || cfg.zohoCustomerName
  const customerId =
    clean(options.customerId) || (await resolveZohoCustomerByName(customerName))
  if (!customerId) {
    const err = new Error(`Zoho customer "${customerName}" was not found.`)
    err.code = 'NOON_PAYMENT_CLEARING_CUSTOMER_NOT_FOUND'
    err.status = 422
    throw err
  }
  const range = deriveInvoiceRange(rows)
  // zohoBooksClient.fetchInvoices(fromDate, toDate, customerId) — positional args.
  const fetched = await fetchInvoices(range.fromDate, range.toDate, customerId || null)
  const invoices = Array.isArray(fetched?.rows) ? fetched.rows : Array.isArray(fetched) ? fetched : []
  const result = matchNoonRowsToInvoices(rows, invoices)
  return {
    ...result,
    zohoCustomerId: customerId,
    zohoCustomerName: customerName,
    invoiceDateRange: range,
    invoiceCount: invoices.length,
    invoiceFetchTruncated: Boolean(fetched?.truncated),
  }
}

/**
 * Pure helper for tests: parent invoice must not satisfy child item match.
 */
function wouldParentMatchChildInvoice(parentOrderId, childItemOrderId, invoicePoOrNumber) {
  if (matchKey(invoicePoOrNumber) === matchKey(childItemOrderId)) return false
  return isParentOnlyMatch({
    candidate: invoicePoOrNumber,
    itemOrderId: childItemOrderId,
    parentOrderId,
  })
}

module.exports = {
  poNumber,
  orderNumber,
  invoiceNumber,
  mapInvoice,
  matchNoonRowsToInvoices,
  matchZohoInvoicesForNoonRows,
  saleItemGroups,
  resolveZohoCustomerByName,
  deriveInvoiceRange,
  findExactInvoiceMatches,
  wouldParentMatchChildInvoice,
  indexInvoices,
  INVOICE_LOOKBACK_DAYS,
}
