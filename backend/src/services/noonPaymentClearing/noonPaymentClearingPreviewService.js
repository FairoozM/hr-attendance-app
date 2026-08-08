const { ROW_CLASS, round2, num, clean } = require('./noonPaymentClearingCategoryService')
const { buildNoonOrderHierarchy } = require('./noonPaymentClearingHierarchyService')
const {
  buildNoonReconciliationSummary,
  isNoonSettlementReconciliationAcceptable,
  RECONCILIATION_TOLERANCE,
} = require('./noonPaymentClearingReconciliationService')
const { buildSettlementReference } = require('./noonPaymentClearingReferenceService')

function buildBlockingIssues({ annotatedRows, unmatchedOrders, multipleMatchItems, reconciliation }) {
  const issues = []
  for (const item of Array.isArray(unmatchedOrders) ? unmatchedOrders : []) {
    issues.push({
      code: 'MISSING_INVOICE',
      severity: 'block',
      message: item.reason || `Missing Zoho invoice for ${item.itemOrderId}`,
      itemOrderId: item.itemOrderId,
      parentOrderId: item.parentOrderId,
    })
  }
  for (const item of Array.isArray(multipleMatchItems) ? multipleMatchItems : []) {
    issues.push({
      code: 'MULTIPLE_MATCHES',
      severity: 'block',
      message: item.reason || `Multiple Zoho invoices for ${item.itemOrderId}`,
      itemOrderId: item.itemOrderId,
      parentOrderId: item.parentOrderId,
    })
  }
  for (const row of Array.isArray(annotatedRows) ? annotatedRows : []) {
    if (row.rowClass === ROW_CLASS.OTHER && Math.abs(num(row.total)) >= RECONCILIATION_TOLERANCE) {
      issues.push({
        code: 'UNEXPLAINED_OTHER',
        severity: 'block',
        message: `Unexplained other amount ${row.total} on row ${row.rowNumber}`,
        rowNumber: row.rowNumber,
      })
    }
  }
  if (reconciliation && !isNoonSettlementReconciliationAcceptable(reconciliation)) {
    issues.push({
      code: 'SETTLEMENT_MISMATCH',
      severity: 'block',
      message: `Settlement difference ${reconciliation.reconciliationDifference} exceeds tolerance`,
    })
  }
  return issues
}

function buildFeeJournalPreviewLines(rows, mappingRules = []) {
  const journalRows = (Array.isArray(rows) ? rows : []).filter(
    (row) =>
      row.rowClass === ROW_CLASS.STATEMENT_FEE ||
      row.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE ||
      (row.rowClass === ROW_CLASS.ORDER_ADJUSTMENT && Math.abs(num(row.total)) >= 0.01)
  )
  return journalRows.map((row, idx) => {
    const feeType = row.normalizedFeeType || 'OTHER'
    const rule = (Array.isArray(mappingRules) ? mappingRules : []).find(
      (r) => r.isActive !== false && clean(r.normalizedFeeType) === clean(feeType)
    )
    const amount = Math.abs(round2(num(row.total)))
    return {
      lineIndex: idx + 1,
      rowNumber: row.rowNumber,
      parentOrderId: row.parentOrderId || '',
      itemOrderId: row.itemOrderId || '',
      title: row.title || '',
      transactionType: row.transactionType || '',
      rowClass: row.rowClass,
      feeType,
      normalizedFeeType: feeType,
      amount,
      currency: row.currency || 'AED',
      mappingStatus: rule && rule.debitAccountId && rule.creditAccountId ? 'mapped' : 'needs_mapping',
      debit: rule
        ? { accountId: rule.debitAccountId, accountName: rule.debitAccountName }
        : { accountId: '', accountName: '' },
      credit: rule
        ? { accountId: rule.creditAccountId, accountName: rule.creditAccountName }
        : { accountId: '', accountName: '' },
    }
  })
}

function buildPreview({
  rows,
  metadata,
  matchResult,
  mappingRules = [],
  zohoCustomerId = '',
  zohoCustomerName = '',
  warnings = [],
} = {}) {
  const annotatedRows = matchResult?.annotatedRows || rows || []
  const hierarchy = buildNoonOrderHierarchy(annotatedRows)
  const reconciliation = buildNoonReconciliationSummary(annotatedRows, metadata)
  const unmatchedOrders = matchResult?.unmatchedOrders || []
  const multipleMatchItems = matchResult?.multipleMatchItems || []
  const matchedOrders = matchResult?.matchedOrders || []
  const blockingIssues = buildBlockingIssues({
    annotatedRows,
    unmatchedOrders,
    multipleMatchItems,
    reconciliation,
  })
  const feeJournalLines = buildFeeJournalPreviewLines(annotatedRows, mappingRules)
  const parentCharges = annotatedRows.filter((r) => r.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE)
  const adjustments = annotatedRows.filter((r) => r.rowClass === ROW_CLASS.ORDER_ADJUSTMENT)
  const statementFees = annotatedRows.filter((r) => r.rowClass === ROW_CLASS.STATEMENT_FEE)

  const isCleanForApproval =
    isNoonSettlementReconciliationAcceptable(reconciliation) &&
    unmatchedOrders.length === 0 &&
    multipleMatchItems.length === 0 &&
    !blockingIssues.some((i) => i.code === 'UNEXPLAINED_OTHER')

  return {
    metadata: {
      ...metadata,
      settlementReference: buildSettlementReference(metadata),
    },
    allRows: annotatedRows,
    hierarchy,
    matchedOrders,
    unmatchedOrders,
    multipleMatchItems,
    parentCharges,
    adjustments,
    statementFees,
    reconciliationSummary: reconciliation,
    feeJournalLines,
    blockingIssues,
    warnings: Array.isArray(warnings) ? warnings : [],
    zohoCustomerId,
    zohoCustomerName,
    isCleanForApproval,
    totals: {
      rowCount: annotatedRows.length,
      matchedItemCount: matchedOrders.length,
      unmatchedItemCount: unmatchedOrders.length,
      multipleMatchCount: multipleMatchItems.length,
      parentChargeCount: parentCharges.length,
      adjustmentCount: adjustments.length,
      statementFeeCount: statementFees.length,
      settlementTotal: reconciliation.calculatedSettlement,
    },
  }
}

module.exports = {
  buildPreview,
  buildBlockingIssues,
  buildFeeJournalPreviewLines,
}
