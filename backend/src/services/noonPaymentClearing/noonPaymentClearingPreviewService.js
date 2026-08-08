const {
  ROW_CLASS,
  round2,
  num,
  clean,
  displayLabelForFeeRow,
  accountingTreatmentForFeeRow,
  reclassifyExplainableOtherRows,
  feeMappingTypeCandidates,
} = require('./noonPaymentClearingCategoryService')
const { buildNoonOrderHierarchy } = require('./noonPaymentClearingHierarchyService')
const {
  buildNoonReconciliationSummary,
  isNoonSettlementReconciliationAcceptable,
  RECONCILIATION_TOLERANCE,
} = require('./noonPaymentClearingReconciliationService')
const { buildSettlementReference } = require('./noonPaymentClearingReferenceService')
const { applyParentOrderChargeFallback } = require('./noonPaymentClearingParentChargeFallback')
const {
  resolveNoonFeeJournalSides,
  isNoonFeeMappingComplete,
} = require('./noonPaymentClearingJournalDirection')

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

function findFeeMappingRule(mappingRules, feeType) {
  const candidates = new Set(feeMappingTypeCandidates(feeType).map((t) => clean(t)))
  return (Array.isArray(mappingRules) ? mappingRules : []).find(
    (r) => r.isActive !== false && candidates.has(clean(r.normalizedFeeType))
  )
}

function normalizeClearingAccount(clearingAccount = {}) {
  return {
    accountId: clean(clearingAccount.accountId || clearingAccount.clearingAccountId),
    accountName: clean(clearingAccount.accountName || clearingAccount.clearingAccountName) || 'Noon',
    accountCode: clean(clearingAccount.accountCode || clearingAccount.clearingAccountCode),
  }
}

function buildFeeJournalPreviewLines(rows, mappingRules = [], clearingAccount = {}) {
  const clearing = normalizeClearingAccount(clearingAccount)
  const journalRows = (Array.isArray(rows) ? rows : []).filter(
    (row) =>
      row.rowClass === ROW_CLASS.STATEMENT_FEE ||
      row.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE ||
      (row.rowClass === ROW_CLASS.ORDER_ADJUSTMENT && Math.abs(num(row.total)) >= 0.01)
  )
  return journalRows.map((row, idx) => {
    const feeType = row.normalizedFeeType || 'OTHER'
    const rule = findFeeMappingRule(mappingRules, feeType)
    const signedAmount = round2(num(row.total))
    const displayLabel = row.displayLabel || displayLabelForFeeRow(row)
    const isAdvertising =
      feeType === 'NOON_ADVERTISING_FEE' || feeType === 'ADVERTISING' || /advertis/i.test(displayLabel)
    const originalParentOrderId = clean(row.originalParentOrderId || row.parentOrderId)
    const assignedItemOrderId = clean(row.assignedItemOrderId)
    const assignmentReason = clean(row.assignmentReason)
    const feeAccountId = clean(rule?.zohoAccountId || rule?.debitAccountId)
    const feeAccountName = clean(rule?.zohoAccountName || rule?.debitAccountName)
    const mapped = isNoonFeeMappingComplete(feeAccountId, clearing.accountId)
    const sides = mapped
      ? resolveNoonFeeJournalSides({
          feeAccountId,
          feeAccountName,
          clearingAccountId: clearing.accountId,
          clearingAccountName: clearing.accountName,
          signedAmount,
        })
      : {
          amount: Math.abs(signedAmount),
          signedAmount,
          direction: signedAmount > 0 ? 'credit_reversal' : 'expense',
          debit: { accountId: '', accountName: feeAccountName || '' },
          credit: { accountId: '', accountName: clearing.accountName || 'Noon' },
          preview: {
            debitLabel: signedAmount > 0 ? clearing.accountName || 'Noon' : feeAccountName || 'Fee account',
            creditLabel: signedAmount > 0 ? feeAccountName || 'Fee account' : clearing.accountName || 'Noon',
          },
        }

    return {
      lineIndex: idx + 1,
      rowNumber: row.rowNumber,
      parentOrderId: originalParentOrderId,
      itemOrderId: clean(row.itemOrderId),
      originalParentOrderId,
      assignedItemOrderId,
      assignmentReason,
      assignmentReasonLabel: clean(row.assignmentReasonLabel),
      parentFallbackStatus: clean(row.parentFallbackStatus),
      title: row.title || '',
      transactionType: row.transactionType || '',
      rowClass: row.rowClass,
      feeType,
      normalizedFeeType: feeType,
      displayLabel,
      accountingTreatment: row.accountingTreatment || accountingTreatmentForFeeRow(row),
      signedAmount,
      amount: sides.amount,
      currency: row.currency || 'AED',
      isStatementLevelExpense: row.rowClass === ROW_CLASS.STATEMENT_FEE,
      invoiceRequired: false,
      journalDirection: sides.direction,
      counterAccountName: clearing.accountName || 'Noon',
      zohoAccountName: feeAccountName,
      zohoAccountId: feeAccountId,
      accountingPreview: {
        debit: sides.preview.debitLabel,
        credit: sides.preview.creditLabel,
      },
      previewNote: isAdvertising
        ? 'Statement-level expense · No invoice required'
        : assignedItemOrderId
          ? `Parent: ${originalParentOrderId} · Cleared via: ${assignedItemOrderId} · Parent-order fallback`
          : originalParentOrderId
            ? `Parent: ${originalParentOrderId}`
            : '',
      mappingStatus: mapped ? 'mapped' : 'needs_mapping',
      debit: sides.debit,
      credit: sides.credit,
    }
  })
}

function buildPreview({
  rows,
  metadata,
  matchResult,
  mappingRules = [],
  clearingAccount = {},
  zohoCustomerId = '',
  zohoCustomerName = '',
  warnings = [],
} = {}) {
  const matchedOrders = matchResult?.matchedOrders || []
  let annotatedRows = reclassifyExplainableOtherRows(matchResult?.annotatedRows || rows || [])
  annotatedRows = applyParentOrderChargeFallback(annotatedRows, matchedOrders)

  const hierarchy = buildNoonOrderHierarchy(annotatedRows)
  const reconciliation = buildNoonReconciliationSummary(annotatedRows, metadata)
  const unmatchedOrders = matchResult?.unmatchedOrders || []
  const multipleMatchItems = matchResult?.multipleMatchItems || []
  const blockingIssues = buildBlockingIssues({
    annotatedRows,
    unmatchedOrders,
    multipleMatchItems,
    reconciliation,
  })
  const feeJournalLines = buildFeeJournalPreviewLines(annotatedRows, mappingRules, clearingAccount)
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
    clearingAccount: normalizeClearingAccount(clearingAccount),
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
  normalizeClearingAccount,
}
