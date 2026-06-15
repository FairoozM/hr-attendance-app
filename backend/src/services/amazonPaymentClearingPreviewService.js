const {
  CATEGORY,
  CATEGORY_ORDER,
  isFeeCategory,
  isSalesCategory,
  hasOrderId,
} = require('./amazonPaymentClearingCategoryService')
const { matchSettlementRowsToInvoices } = require('./amazonPaymentClearingZohoMatcher')
const { buildOrderFeeBreakdown, round2 } = require('./amazonPaymentClearingOrderBreakdownService')
const { buildReconciliationSummary } = require('./amazonPaymentClearingReconciliationService')

function sum(rows, predicate = () => true) {
  return round2((Array.isArray(rows) ? rows : []).reduce((acc, row) => {
    if (!predicate(row)) return acc
    return acc + (Number(row.amount) || 0)
  }, 0))
}

function buildPivot(rows) {
  const byCategory = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const category = row.category || CATEGORY.OTHER
    const entry = byCategory.get(category) || { category, count: 0, total: 0 }
    entry.count += 1
    entry.total = round2(entry.total + (Number(row.amount) || 0))
    byCategory.set(category, entry)
  }
  return orderCategoryEntries(byCategory)
}

function orderCategoryEntries(byCategory) {
  const ordered = []
  for (const category of CATEGORY_ORDER) {
    if (byCategory.has(category)) ordered.push(byCategory.get(category))
  }
  for (const entry of byCategory.values()) {
    if (!CATEGORY_ORDER.includes(entry.category)) ordered.push(entry)
  }
  return ordered
}

function buildSettlementLevelFees(rows) {
  const byCategory = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (hasOrderId(row)) continue
    const amount = Number(row.amount) || 0
    if (!amount && !row.transactionType && !row.amountType && !row.amountDescription) continue
    const category = row.category || CATEGORY.OTHER
    const entry = byCategory.get(category) || { category, count: 0, total: 0 }
    entry.count += 1
    entry.total = round2(entry.total + amount)
    byCategory.set(category, entry)
  }
  return orderCategoryEntries(byCategory)
}

function groupRowsByOrder(rows) {
  const groups = new Map()
  const missingOrderIdRows = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row.orderId) {
      missingOrderIdRows.push(row)
      continue
    }
    if (!groups.has(row.orderId)) groups.set(row.orderId, [])
    groups.get(row.orderId).push(row)
  }
  return { groups, missingOrderIdRows }
}

function orderSummary(orderId, rows, invoice = null, status = 'matched', reason = '') {
  const breakdown = buildOrderFeeBreakdown(rows)
  const out = {
    orderId,
    ...breakdown,
    // Legacy aliases used elsewhere in totals/store
    feesTotal: breakdown.totalFees,
    netAmount: breakdown.netSettlementAmount,
    status,
  }
  if (invoice) {
    out.zohoInvoiceId = invoice.zohoInvoiceId
    out.zohoInvoiceNumber = invoice.zohoInvoiceNumber
    out.zohoPoNumber = invoice.zohoPoNumber || ''
    out.zohoCustomerId = invoice.zohoCustomerId || ''
    out.zohoCustomerName = invoice.zohoCustomerName
    out.zohoInvoiceTotal = invoice.zohoInvoiceTotal
    out.matchType = invoice.matchType || 'po_number'
  }
  if (reason) out.reason = reason
  return out
}

function buildOrderReconciliation(rows, matchResult) {
  const { groups } = groupRowsByOrder(rows)
  const matchedByOrder = new Map()
  for (const row of matchResult.matchedRows || []) {
    if (row.orderId && row.zohoInvoice && !matchedByOrder.has(row.orderId)) {
      matchedByOrder.set(row.orderId, { ...row.zohoInvoice, matchType: row.matchType })
    }
  }
  const matchedOrders = []
  const unmatchedOrders = []
  for (const [orderId, orderRows] of groups.entries()) {
    const invoice = matchedByOrder.get(orderId)
    if (invoice) {
      matchedOrders.push(orderSummary(orderId, orderRows, invoice, 'matched'))
    } else {
      unmatchedOrders.push(orderSummary(
        orderId,
        orderRows,
        null,
        'unmatched',
        'No Zoho invoice found with matching PO number or invoice_number'
      ))
    }
  }
  matchedOrders.sort((a, b) => a.orderId.localeCompare(b.orderId))
  unmatchedOrders.sort((a, b) => a.orderId.localeCompare(b.orderId))
  return { matchedOrders, unmatchedOrders }
}

function buildPreview({
  report = {},
  rows = [],
  invoices = [],
  parserWarnings = [],
  rawRowCount = rows.length,
}) {
  const matchResult = matchSettlementRowsToInvoices(rows, invoices)
  const { matchedOrders, unmatchedOrders } = buildOrderReconciliation(rows, matchResult)
  const pivot = buildPivot(rows)
  const settlementLevelFees = buildSettlementLevelFees(rows)
  const orderLevelFeeRows = rows.filter((row) => hasOrderId(row) && isFeeCategory(row.category))
  const settlementLevelFeeRows = rows.filter((row) => !hasOrderId(row) && isFeeCategory(row.category))
  const matchedInvoiceTotal = round2(
    matchedOrders.reduce((acc, row) => acc + (Number(row.zohoInvoiceTotal) || 0), 0)
  )
  const unmatchedOrderTotal = round2(
    unmatchedOrders.reduce((acc, row) => acc + (Number(row.amazonOrderTotal) || 0), 0)
  )
  const amazonSettlementTotal = sum(rows)
  const reconciliationSummary = buildReconciliationSummary({
    matchedOrders,
    settlementLevelFees,
    actualAmazonSettlement: amazonSettlementTotal,
  })
  const warnings = [...(Array.isArray(parserWarnings) ? parserWarnings : [])]
  if (matchResult.duplicateZohoInvoiceNumbers.length > 0) {
    warnings.push(`Duplicate Zoho invoice numbers: ${matchResult.duplicateZohoInvoiceNumbers.join(', ')}`)
  }
  if (matchResult.duplicateZohoPoNumbers.length > 0) {
    warnings.push(`Duplicate Zoho PO numbers: ${matchResult.duplicateZohoPoNumbers.join(', ')}`)
  }
  if (matchResult.missingOrderIdRows.length > 0) {
    warnings.push(`${matchResult.missingOrderIdRows.length} settlement row(s) were not matchable because order ID is missing.`)
  }
  if (reconciliationSummary.reconciliationStatus === 'mismatch') {
    warnings.push('Settlement total does not match calculated expected deposit.')
  }

  return {
    marketplace: 'KSA',
    report: {
      reportId: report.reportId || '',
      reportDocumentId: report.reportDocumentId || '',
      settlementId: report.settlementId || '',
      settlementStartDate: report.settlementStartDate || '',
      settlementEndDate: report.settlementEndDate || '',
      depositDate: report.depositDate || '',
      currency: report.currency || 'SAR',
    },
    totals: {
      amazonSettlementTotal,
      productSalesTotal: sum(rows, (row) => isSalesCategory(row.category)),
      feesTotal: sum(rows, (row) => isFeeCategory(row.category)),
      orderLevelFeesTotal: sum(orderLevelFeeRows),
      settlementLevelFeesTotal: sum(settlementLevelFeeRows),
      refundsTotal: sum(rows, (row) => row.category === CATEGORY.REFUND),
      adjustmentsTotal: sum(rows, (row) => row.category === CATEGORY.ADJUSTMENT),
      matchedInvoiceTotal,
      unmatchedOrderTotal,
      difference: round2(amazonSettlementTotal - matchedInvoiceTotal),
    },
    pivot,
    settlementLevelFees,
    reconciliationSummary,
    matchedOrders,
    unmatchedOrders,
    warnings,
    rawRowCount,
    matchedRows: matchResult.matchedRows,
    unmatchedRows: matchResult.unmatchedRows,
    matchedInvoices: matchResult.matchedInvoices,
    unmatchedOrderIds: matchResult.unmatchedOrderIds,
    duplicateZohoInvoiceNumbers: matchResult.duplicateZohoInvoiceNumbers,
    duplicateZohoPoNumbers: matchResult.duplicateZohoPoNumbers,
    missingOrderIdRows: matchResult.missingOrderIdRows,
  }
}

module.exports = {
  buildPreview,
  buildPivot,
  buildSettlementLevelFees,
  buildOrderReconciliation,
  groupRowsByOrder,
  orderSummary,
  round2,
}
