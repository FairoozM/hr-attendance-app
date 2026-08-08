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
const {
  getNoonPaymentClearingMarketplaceConfig,
  getNoonFeeJournalCounterAccount,
} = require('./noonPaymentClearingMarketplaceConfig')
const {
  DEFAULT_VAT_RATE,
  extractVatFromNoonRow,
} = require('./noonPaymentClearingVatService')

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

/** Normalize a clearing/expense account object (id/name/code). */
function normalizeGlAccount(account = null, fallbackName = '') {
  if (!account) {
    return { accountId: '', accountName: fallbackName, accountCode: '' }
  }
  return {
    accountId: clean(account.accountId || account.depositToAccountId),
    accountName: clean(account.accountName || account.depositToAccountName) || fallbackName,
    accountCode: clean(account.accountCode || account.depositToAccountCode),
  }
}

/**
 * Amazon-style undeposited account (invoice net deposit-to + advertising journal counter).
 * @deprecated name kept for callers; prefer getNoonFeeJournalCounterAccount(feeType).
 */
function getSettlementBridgeAccount(override = null) {
  if (override && (override.accountId || override.depositToAccountId || override.accountCode)) {
    return normalizeGlAccount(override, 'Noon Undeposited Funds')
  }
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  return normalizeGlAccount(cfg.undepositedFundsAccount, 'Noon Undeposited Funds')
}

function normalizeInputVatAccount(inputVatAccount = null, vatRate = DEFAULT_VAT_RATE) {
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const defaults = cfg.inputVatAccount || {}
  // null/undefined → marketplace default (1085). Explicit empty object disables VAT account.
  let source = defaults
  if (inputVatAccount != null) {
    const hasAny = Boolean(
      clean(inputVatAccount.accountId || inputVatAccount.inputVatAccountId) ||
        clean(inputVatAccount.accountCode || inputVatAccount.inputVatAccountCode) ||
        clean(inputVatAccount.accountName || inputVatAccount.inputVatAccountName)
    )
    source = hasAny ? inputVatAccount : { accountId: '', accountName: '', accountCode: '' }
  }
  return {
    accountId: clean(source.accountId || source.inputVatAccountId || source.depositToAccountId),
    accountName:
      clean(source.accountName || source.inputVatAccountName || source.depositToAccountName) ||
      (source === defaults ? 'Input VAT' : ''),
    accountCode: clean(source.accountCode || source.inputVatAccountCode || source.depositToAccountCode),
    vatRate:
      source.vatRate == null || source.vatRate === ''
        ? cfg.vatRate || vatRate
        : Number(source.vatRate) || vatRate,
  }
}

function resolveClearingForFeeType(feeType) {
  return normalizeGlAccount(getNoonFeeJournalCounterAccount(feeType))
}

function buildFeeJournalPreviewLines(rows, mappingRules = [], inputVatAccount = null) {
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const vatAcct = normalizeInputVatAccount(inputVatAccount, cfg.vatRate || DEFAULT_VAT_RATE)
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
    const vatBreakdown = extractVatFromNoonRow(row, { vatRate: vatAcct.vatRate })
    const displayLabel = row.displayLabel || displayLabelForFeeRow(row)
    const isAdvertising =
      feeType === 'NOON_ADVERTISING_FEE' || feeType === 'ADVERTISING' || /advertis/i.test(displayLabel)
    const originalParentOrderId = clean(row.originalParentOrderId || row.parentOrderId)
    const assignedItemOrderId = clean(row.assignedItemOrderId)
    const assignmentReason = clean(row.assignmentReason)
    const suggestion = (cfg.feeJournalAccountSuggestions || []).find(
      (s) => clean(s.normalizedFeeType) === clean(feeType)
    )
    const feeAccountId = clean(rule?.zohoAccountId || rule?.debitAccountId)
    const feeAccountName =
      clean(rule?.zohoAccountName || rule?.debitAccountName) || clean(suggestion?.zohoAccountName)
    const feeAccountCode = clean(rule?.zohoAccountCode || suggestion?.zohoAccountCode)
    // Prefer saved mapping credit when present; else Amazon-style counter by fee type.
    const clearing =
      rule?.creditAccountId || rule?.creditAccountName
        ? normalizeGlAccount({
            accountId: rule.creditAccountId,
            accountName: rule.creditAccountName,
            accountCode: rule.creditAccountCode || suggestion?.creditAccountCode,
          })
        : resolveClearingForFeeType(feeType)
    const mapped = isNoonFeeMappingComplete(feeAccountId, clearing.accountId, {
      vatAmount: vatBreakdown.vatAmount,
      inputVatAccountId: vatAcct.accountId,
      clearingAccountCode: clearing.accountCode,
      inputVatAccountCode: vatAcct.accountCode,
    })
    const sides = mapped
      ? resolveNoonFeeJournalSides({
          feeAccountId,
          feeAccountName,
          feeAccountCode,
          clearingAccountId: clearing.accountId,
          clearingAccountName: clearing.accountName,
          clearingAccountCode: clearing.accountCode,
          inputVatAccountId: vatAcct.accountId,
          inputVatAccountName: vatAcct.accountName,
          inputVatAccountCode: vatAcct.accountCode,
          signedAmount,
          netAmount: vatBreakdown.netAmount,
          vatAmount: vatBreakdown.vatAmount,
          vatInclusive: vatBreakdown.vatInclusive,
        })
      : {
          amount: Math.abs(signedAmount),
          signedAmount,
          netAmount: vatBreakdown.netAmount,
          vatAmount: vatBreakdown.vatAmount,
          direction: signedAmount > 0 ? 'credit_reversal' : 'expense',
          debit: { accountId: '', accountName: feeAccountName || '' },
          credit: { accountId: '', accountName: clearing.accountName },
          lineItems: [],
          preview: {
            debitLabel: signedAmount > 0 ? clearing.accountName : feeAccountName || 'Fee account',
            creditLabel: signedAmount > 0 ? feeAccountName || 'Fee account' : clearing.accountName,
            lines: [],
          },
        }

    const vatTreatment =
      vatBreakdown.vatInclusive && Math.abs(vatBreakdown.vatAmount) >= 0.005
        ? 'vat_inclusive_split'
        : vatBreakdown.components.length === 0 && Math.abs(signedAmount) >= 0.005
          ? 'not_vat_inclusive_or_unknown'
          : 'no_vat'

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
      clearingAccountName: clearing.accountName,
      clearingAccountId: clearing.accountId,
      clearingAccountCode: clearing.accountCode,
      settlementBridgeAccountName: clearing.accountName,
      settlementBridgeAccountId: clearing.accountId,
      zohoAccountName: feeAccountName,
      zohoAccountId: feeAccountId,
      zohoAccountCode: feeAccountCode,
      inputVatAccountId: vatAcct.accountId,
      inputVatAccountName: vatAcct.accountName,
      inputVatAccountCode: vatAcct.accountCode,
      vatTreatment,
      vatBreakdown: {
        originalGrossAmount: vatBreakdown.originalGrossAmount,
        vatRate: vatBreakdown.vatRate,
        netAmount: vatBreakdown.netAmount,
        vatAmount: vatBreakdown.vatAmount,
        vatInclusive: vatBreakdown.vatInclusive,
        vatSource: vatBreakdown.vatSource,
        expenseAccountId: feeAccountId,
        inputVatAccountId: vatAcct.accountId,
        clearingAccountId: clearing.accountId,
        components: vatBreakdown.components,
        nonVatResidue: vatBreakdown.nonVatResidue,
      },
      grossInclVat: vatBreakdown.originalGrossAmount,
      netExpense: vatBreakdown.netAmount,
      inputVatAmount: vatBreakdown.vatAmount,
      accountingPreview: {
        debit: sides.preview.debitLabel,
        credit: sides.preview.creditLabel,
        lines: sides.preview.lines || [],
        grossInclVat: vatBreakdown.originalGrossAmount,
        netExpense: vatBreakdown.netAmount,
        inputVat: vatBreakdown.vatAmount,
        expenseAccount: feeAccountName,
        vatAccount: vatAcct.accountName,
        clearingAccount: clearing.accountName,
      },
      previewNote: isAdvertising
        ? vatBreakdown.vatInclusive
          ? 'Statement-level expense · VAT-inclusive · Credit: Noon Undeposited Funds (1066) · No invoice required'
          : 'Statement-level expense · Credit: Noon Undeposited Funds (1066) · No invoice required'
        : assignedItemOrderId
          ? `Parent: ${originalParentOrderId} · Cleared via: ${assignedItemOrderId} · Parent-order fallback`
          : originalParentOrderId
            ? `Parent: ${originalParentOrderId}`
            : '',
      mappingStatus: mapped ? 'mapped' : 'needs_mapping',
      debit: sides.debit,
      credit: sides.credit,
      lineItems: sides.lineItems || [],
    }
  })
}

function summarizeFeeJournalVat(feeJournalLines = []) {
  let grossInclVat = 0
  let netExpense = 0
  let inputVat = 0
  let vatInclusiveLineCount = 0
  for (const line of feeJournalLines) {
    if (!line?.vatBreakdown?.vatInclusive) continue
    vatInclusiveLineCount += 1
    grossInclVat = round2(grossInclVat + num(line.vatBreakdown.originalGrossAmount))
    netExpense = round2(netExpense + num(line.vatBreakdown.netAmount))
    inputVat = round2(inputVat + num(line.vatBreakdown.vatAmount))
  }
  return { grossInclVat, netExpense, inputVat, vatInclusiveLineCount }
}

function buildPreview({
  rows,
  metadata,
  matchResult,
  mappingRules = [],
  settlementBridgeAccount = null,
  inputVatAccount = null,
  zohoCustomerId = '',
  zohoCustomerName = '',
  warnings = [],
} = {}) {
  const cfg = getNoonPaymentClearingMarketplaceConfig()
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
  const feeJournalLines = buildFeeJournalPreviewLines(annotatedRows, mappingRules, inputVatAccount)
  const parentCharges = annotatedRows.filter((r) => r.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE)
  const adjustments = annotatedRows.filter((r) => r.rowClass === ROW_CLASS.ORDER_ADJUSTMENT)
  const statementFees = annotatedRows.filter((r) => r.rowClass === ROW_CLASS.STATEMENT_FEE)
  const vatSummary = summarizeFeeJournalVat(feeJournalLines)
  const inputVat = normalizeInputVatAccount(inputVatAccount)

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
    feeJournalVatSummary: vatSummary,
    settlementBridgeAccount: getSettlementBridgeAccount(settlementBridgeAccount),
    paymentPreviewAccounts: cfg.paymentPreviewAccounts,
    inputVatAccount: inputVat,
    blockingIssues,
    warnings: Array.isArray(warnings) ? warnings : [],
    zohoCustomerId: zohoCustomerId || matchResult?.zohoCustomerId || '',
    zohoCustomerName:
      zohoCustomerName || matchResult?.zohoCustomerName || cfg.zohoCustomerName || 'Noon',
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
      feeJournalInputVat: vatSummary.inputVat,
      feeJournalNetExpense: vatSummary.netExpense,
    },
  }
}

module.exports = {
  buildPreview,
  buildBlockingIssues,
  buildFeeJournalPreviewLines,
  getSettlementBridgeAccount,
  getNoonFeeJournalCounterAccount,
  summarizeFeeJournalVat,
}
