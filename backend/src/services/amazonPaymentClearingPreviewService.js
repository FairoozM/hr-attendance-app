const {
  CATEGORY,
  CATEGORY_ORDER,
  isFeeCategory,
  isSalesCategory,
  hasOrderId,
  ROW_CLASS,
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

function isRefundReturnRow(row) {
  return row?.rowClass === ROW_CLASS.REFUND || row?.rowClass === ROW_CLASS.RETURN
}

function refundReturnKey(row) {
  return [
    String(row?.orderId || '').trim().toLowerCase(),
    String(row?.amountType || '').trim().toLowerCase(),
    String(row?.amountDescription || '').trim().toLowerCase(),
    Math.abs(round2(Number(row?.amount ?? row?.amazonRefundAmount) || 0)),
  ].join('|')
}

const BLOCKING_ISSUE_LABELS = {
  MISSING_ORDER_ID: 'Settlement rows missing an Amazon order ID',
  UNMATCHED_SALES: 'Sales orders with no matching Zoho invoice',
  MISSING_CREDIT_NOTE: 'Refund/return rows with no matching Zoho credit note',
  CREDIT_NOTE_DIFF: 'Refund/return rows where the credit note amount differs',
  SETTLEMENT_MISMATCH: 'Settlement total does not match the expected deposit',
  UNKNOWN_ROWS: 'Settlement rows that could not be classified',
}

/**
 * Builds a unified, row-numbered view of every parsed settlement row with a
 * resolved status + blocking reason so the UI can drill from any warning down
 * to the exact rows.
 */
function buildAllRows(rows, context) {
  const {
    unmatchedOrderIds = [],
    matchedOrderIds = [],
    matchedReturns = [],
    creditNoteBlockingRows = [],
  } = context || {}
  const unmatchedSet = new Set(unmatchedOrderIds.map((id) => String(id)))
  const matchedSet = new Set(matchedOrderIds.map((id) => String(id)))
  const blockedByKey = new Map()
  for (const blocked of creditNoteBlockingRows) blockedByKey.set(refundReturnKey(blocked), blocked)
  const matchedReturnByKey = new Map()
  for (const matched of matchedReturns) matchedReturnByKey.set(refundReturnKey(matched), matched)

  return (Array.isArray(rows) ? rows : []).map((row, idx) => {
    const orderId = String(row.orderId || '').trim()
    let status = 'ok'
    let blockingReason = ''
    if (isRefundReturnRow(row)) {
      const key = refundReturnKey(row)
      const blocked = blockedByKey.get(key)
      const matched = matchedReturnByKey.get(key)
      if (blocked) {
        status = 'blocked'
        blockingReason = blocked.blockingReason || 'Refund/return credit note reconciliation is not clean.'
      } else if (matched) {
        status = matched.status === 'matched' ? 'matched' : 'blocked'
        blockingReason = matched.status === 'matched' ? '' : (matched.blockingReason || '')
      } else {
        status = 'review'
      }
    } else if (!orderId) {
      status = 'missing_order_id'
      blockingReason = 'Settlement row is missing Amazon order ID.'
    } else if (unmatchedSet.has(orderId)) {
      status = 'unmatched'
      blockingReason = 'No Zoho invoice found with matching PO number or invoice_number.'
    } else if (row.rowClass === ROW_CLASS.ADJUSTMENT || row.category === CATEGORY.ADJUSTMENT) {
      status = 'review'
    } else if (matchedSet.has(orderId)) {
      status = 'matched'
    } else if (row.rowClass === ROW_CLASS.UNKNOWN) {
      status = 'unknown'
    }
    return {
      rowNumber: idx + 1,
      category: row.category || CATEGORY.OTHER,
      rowClass: row.rowClass || ROW_CLASS.UNKNOWN,
      orderId,
      amount: round2(Number(row.amount) || 0),
      currency: row.currency || '',
      settlementDate: row.postedDate || row.settlementEndDate || row.settlementStartDate || row.depositDate || '',
      transactionType: row.transactionType || '',
      amountType: row.amountType || '',
      amountDescription: row.amountDescription || '',
      status,
      blockingReason,
    }
  })
}

function buildAmountDifferences(matchedOrders) {
  return (Array.isArray(matchedOrders) ? matchedOrders : [])
    .map((order) => {
      const amazonTotal = round2(Number(order.amazonOrderTotal) || 0)
      const zohoTotal = round2(Number(order.zohoInvoiceTotal) || 0)
      const difference = round2(amazonTotal - zohoTotal)
      return {
        orderId: order.orderId || '',
        zohoInvoiceNumber: order.zohoInvoiceNumber || '',
        zohoInvoiceId: order.zohoInvoiceId || '',
        amazonOrderTotal: amazonTotal,
        zohoInvoiceTotal: zohoTotal,
        difference,
      }
    })
    .filter((row) => Math.abs(row.difference) > 0.01)
}

function buildBlockingIssues({ allRows, unmatchedOrders, creditNoteBlockingRows, reconciliationStatus }) {
  const issues = []
  const add = (code, predicateRows, extra = {}) => {
    const rowNumbers = predicateRows.map((row) => row.rowNumber).filter((n) => Number.isFinite(n))
    const orderIds = Array.from(new Set(predicateRows.map((row) => row.orderId).filter(Boolean)))
    const count = extra.count != null ? extra.count : (rowNumbers.length || orderIds.length)
    if (!count) return
    issues.push({ code, label: BLOCKING_ISSUE_LABELS[code], count, rowNumbers, orderIds })
  }

  add('MISSING_ORDER_ID', allRows.filter((row) => row.status === 'missing_order_id'))
  add(
    'UNMATCHED_SALES',
    allRows.filter((row) => row.status === 'unmatched'),
    { count: (unmatchedOrders || []).length || allRows.filter((row) => row.status === 'unmatched').length }
  )

  const missingCn = (creditNoteBlockingRows || []).filter(
    (row) => !row.zohoCreditNoteId || /missing|no zoho/i.test(row.blockingReason || '')
  )
  const diffCn = (creditNoteBlockingRows || []).filter(
    (row) => row.zohoCreditNoteId && /differ/i.test(row.blockingReason || '')
  )
  if (missingCn.length) {
    issues.push({
      code: 'MISSING_CREDIT_NOTE',
      label: BLOCKING_ISSUE_LABELS.MISSING_CREDIT_NOTE,
      count: missingCn.length,
      rowNumbers: [],
      orderIds: Array.from(new Set(missingCn.map((row) => row.orderId).filter(Boolean))),
    })
  }
  if (diffCn.length) {
    issues.push({
      code: 'CREDIT_NOTE_DIFF',
      label: BLOCKING_ISSUE_LABELS.CREDIT_NOTE_DIFF,
      count: diffCn.length,
      rowNumbers: [],
      orderIds: Array.from(new Set(diffCn.map((row) => row.orderId).filter(Boolean))),
    })
  }
  if (reconciliationStatus === 'mismatch') {
    issues.push({
      code: 'SETTLEMENT_MISMATCH',
      label: BLOCKING_ISSUE_LABELS.SETTLEMENT_MISMATCH,
      count: 1,
      rowNumbers: [],
      orderIds: [],
    })
  }
  add('UNKNOWN_ROWS', allRows.filter((row) => row.status === 'unknown'))
  return issues
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
  matchedReturns = [],
  missingCreditNotes = [],
  creditNoteBlockingRows = [],
  parserWarnings = [],
  rawRowCount = rows.length,
}) {
  const allRows = Array.isArray(rows) ? rows : []
  const refundReturnRows = allRows.filter(isRefundReturnRow)
  const salesAndFeeRows = allRows.filter((row) => !isRefundReturnRow(row))
  const matchResult = matchSettlementRowsToInvoices(salesAndFeeRows, invoices)
  const { matchedOrders, unmatchedOrders } = buildOrderReconciliation(salesAndFeeRows, matchResult)
  const pivot = buildPivot(allRows)
  const settlementLevelFees = buildSettlementLevelFees(allRows)
  const adjustmentRows = allRows.filter((row) => row.rowClass === ROW_CLASS.ADJUSTMENT || row.category === CATEGORY.ADJUSTMENT)
  const orderLevelFeeRows = salesAndFeeRows.filter((row) => hasOrderId(row) && isFeeCategory(row.category))
  const settlementLevelFeeRows = allRows.filter((row) => !hasOrderId(row) && isFeeCategory(row.category))
  const matchedInvoiceTotal = round2(
    matchedOrders.reduce((acc, row) => acc + (Number(row.zohoInvoiceTotal) || 0), 0)
  )
  const unmatchedOrderTotal = round2(
    unmatchedOrders.reduce((acc, row) => acc + (Number(row.amazonOrderTotal) || 0), 0)
  )
  const amazonSettlementTotal = sum(allRows)
  const refundReturnTotal = sum(refundReturnRows)
  const reconciliationSummary = buildReconciliationSummary({
    matchedOrders,
    refundReturnTotal,
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
  if (creditNoteBlockingRows.length > 0) {
    warnings.push(`${creditNoteBlockingRows.length} refund/return row(s) block approval because credit note reconciliation is not clean.`)
  }
  if (reconciliationSummary.reconciliationStatus === 'mismatch') {
    warnings.push('Settlement total does not match calculated expected deposit.')
  }

  const unifiedRows = buildAllRows(allRows, {
    unmatchedOrderIds: matchResult.unmatchedOrderIds,
    matchedOrderIds: matchedOrders.map((order) => order.orderId),
    matchedReturns,
    creditNoteBlockingRows,
  })
  const amountDifferences = buildAmountDifferences(matchedOrders)
  const blockingIssues = buildBlockingIssues({
    allRows: unifiedRows,
    unmatchedOrders,
    creditNoteBlockingRows,
    reconciliationStatus: reconciliationSummary.reconciliationStatus,
  })

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
      returnsTotal: sum(rows, (row) => row.category === CATEGORY.RETURN),
      refundReturnTotal,
      adjustmentsTotal: sum(rows, (row) => row.category === CATEGORY.ADJUSTMENT),
      matchedInvoiceTotal,
      unmatchedOrderTotal,
      difference: round2(amazonSettlementTotal - matchedInvoiceTotal),
    },
    pivot,
    settlementLevelFees,
    refundReturnRows,
    matchedReturns,
    missingCreditNotes,
    creditNoteBlockingRows,
    adjustmentRows,
    reconciliationSummary,
    matchedOrders,
    unmatchedOrders,
    allRows: unifiedRows,
    amountDifferences,
    blockingIssues,
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
  buildAllRows,
  buildAmountDifferences,
  buildBlockingIssues,
  groupRowsByOrder,
  orderSummary,
  round2,
}
