/**
 * Deterministic accounting fingerprint of a Noon statement batch.
 *
 * Runs only the offline parts of the pipeline — no Zoho calls, no batch status
 * gate — so any saved batch can be fingerprinted and compared before/after a
 * refactor. Field order and row order are stabilised here on purpose: a diff in
 * this output means the accounting moved, not that a map iterated differently.
 */
const {
  ROW_CLASS,
  round2,
  num,
  clean,
} = require('./noonPaymentClearingCategoryService')
const { getNoonPaymentClearingMarketplaceConfig } = require('./noonPaymentClearingMarketplaceConfig')
const { buildFeeJournalPreviewLines } = require('./noonPaymentClearingPreviewService')
const {
  buildSaleParentOrderIdSet,
  buildSettlementAdjustmentJournal,
  collectSettlementAdjustmentSourceRows,
} = require('./noonPaymentClearingSettlementAdjustmentService')
const { reclassifyReturnRows, collectReturnRows } = require('./noonPaymentClearingReturnService')
const {
  buildInvoicePaymentPlansFromBatch,
  collectPlanExclusions,
  computeStatementUndepositedTarget,
} = require('./noonPaymentClearingPaymentPreviewService')

function byRowNumber(a, b) {
  return num(a.rowNumber) - num(b.rowNumber)
}

function sortKeyed(rows, keyFn) {
  return [...rows].sort((a, b) => String(keyFn(a)).localeCompare(String(keyFn(b))))
}

function fingerprintRows(allRows, saleParentSet) {
  return [...allRows].sort(byRowNumber).map((row) => ({
    rowNumber: row.rowNumber,
    rowClass: row.rowClass,
    normalizedFeeType: clean(row.normalizedFeeType),
    transactionType: clean(row.transactionType),
    parentOrderId: clean(row.originalParentOrderId || row.parentOrderId),
    itemOrderId: clean(row.itemOrderId),
    assignedItemOrderId: clean(row.assignedItemOrderId),
    assignedZohoInvoiceNumber: clean(row.assignedZohoInvoiceNumber || row.zohoInvoiceNumber),
    netProceed: round2(num(row.netProceed)),
    referralFee: round2(num(row.referralFee)),
    fulfillmentFee: round2(num(row.fulfillmentFee)),
    shippingCharges: round2(num(row.shippingCharges)),
    total: round2(num(row.total)),
    excludeFromPaymentClearing: Boolean(row.excludeFromPaymentClearing),
    saleParentInStatement: saleParentSet.has(
      clean(row.originalParentOrderId || row.parentOrderId).toLowerCase()
    ),
  }))
}

function fingerprintFeeJournals(lines) {
  return sortKeyed(lines, (l) => `${l.rowNumber}|${l.normalizedFeeType}`).map((line) => ({
    rowNumber: line.rowNumber,
    rowClass: line.rowClass,
    normalizedFeeType: clean(line.normalizedFeeType),
    amount: round2(num(line.amount)),
    netExpense: round2(num(line.netExpense)),
    inputVatAmount: round2(num(line.inputVatAmount)),
    vatTreatment: clean(line.vatTreatment),
    mappingStatus: clean(line.mappingStatus),
    lineItems: (line.lineItems || []).map((li) => ({
      side: li.debitOrCredit,
      accountCode: clean(li.accountCode),
      amount: round2(num(li.amount)),
    })),
  }))
}

function fingerprintSettlementAdjustment(journal) {
  if (!journal) return null
  return {
    amount: round2(num(journal.amount)),
    signedAmount: round2(num(journal.signedAmount)),
    blocked: Boolean(journal.blocked),
    blockCode: clean(journal.blockCode),
    sourceLineCount: journal.sourceLineCount,
    summary: {
      sourceRowCount: journal.summary?.sourceRowCount ?? 0,
      grossNegativeAdjustments: round2(num(journal.summary?.grossNegativeAdjustments)),
      grossPositiveAdjustments: round2(num(journal.summary?.grossPositiveAdjustments)),
      netExpense: round2(num(journal.summary?.netExpense)),
      inputVat: round2(num(journal.summary?.inputVat)),
      netUndepositedImpact: round2(num(journal.summary?.netUndepositedImpact)),
    },
    sourceLines: sortKeyed(journal.sourceLines || [], (l) => l.rowNumber).map((line) => ({
      rowNumber: line.rowNumber,
      rowClass: clean(line.rowClass),
      signedAmount: round2(num(line.signedAmount)),
      netAmount: round2(num(line.netAmount)),
      vatAmount: round2(num(line.vatAmount)),
      undepositedImpact: round2(num(line.undepositedImpact)),
      paidInvoiceSubsidy: Boolean(line.paidInvoiceSubsidy),
    })),
    lineItems: sortKeyed(
      journal.lineItems || [],
      (li) => `${li.accountCode}|${li.debitOrCredit}|${li.amount}|${li.description}`
    ).map((li) => ({
      side: li.debitOrCredit,
      accountCode: clean(li.accountCode),
      amount: round2(num(li.amount)),
    })),
  }
}

function fingerprintPaymentPlans(plans) {
  return sortKeyed(plans, (p) => `${p.zohoInvoiceNumber}|${p.itemOrderId}`).map((p) => ({
    itemOrderId: clean(p.itemOrderId),
    zohoInvoiceNumber: clean(p.zohoInvoiceNumber),
    invoiceTotal: round2(num(p.invoiceTotal)),
    saleGross: round2(num(p.saleGross)),
    netBalance: round2(num(p.netBalancePayment?.amount)),
    commission: round2(num(p.commissionPayment?.amount)),
    fulfillmentShipping: round2(num(p.fulfillmentPayment?.amount)),
    parentLogisticsAddOn: round2(num(p.parentLogisticsAddOn)),
    parentCommissionAddOn: round2(num(p.parentCommissionAddOn)),
    totalClearingAmount: round2(num(p.totalClearingAmount)),
    exceedsInvoiceTotal: Boolean(p.exceedsInvoiceTotal),
  }))
}

function fingerprintReturns(returnRows, matchedReturns) {
  return {
    returnRowNumbers: [...returnRows].sort(byRowNumber).map((r) => r.rowNumber),
    matched: sortKeyed(matchedReturns || [], (r) => clean(r.itemOrderId)).map((r) => ({
      itemOrderId: clean(r.itemOrderId),
      status: clean(r.status),
      blockCode: clean(r.blockCode),
      zohoCreditNoteNumber: clean(r.zohoCreditNoteNumber),
      productRefundAmount: round2(num(r.productRefundAmount)),
      commissionReversalGross: round2(num(r.commissionReversalGross)),
    })),
  }
}

/**
 * @param {object} batch stored batch as returned by the clearing store
 * @param {object} [options] `inputVatAccount` / `mappingRules` override the marketplace defaults
 */
function buildNoonClearingFingerprint(batch, options = {}) {
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const rawRows = batch?.allRows || []
  const saleParentSet = buildSaleParentOrderIdSet(rawRows)
  const allRows = reclassifyReturnRows(rawRows, saleParentSet)
  const metadata = batch?.reportSnapshot || batch?.metadata || {}
  const inputVatAccount = options.inputVatAccount || cfg.inputVatAccount
  const mappingRules = options.mappingRules || []

  const feeJournalLines = buildFeeJournalPreviewLines(allRows, mappingRules, inputVatAccount, {
    clearingAccount: cfg.undepositedFundsAccount,
    advertisingExpenseAccount: cfg.advertisingExpenseAccount,
  })
  const planExclusions = collectPlanExclusions(batch)
  const settlementAdjustmentJournal = buildSettlementAdjustmentJournal(
    allRows,
    { ...metadata, zohoCustomerId: clean(batch?.zohoCustomerId) },
    {
      undepositedFundsAccount: cfg.undepositedFundsAccount,
      inputVatAccount,
      vatRate: cfg.vatRate,
    },
    planExclusions
  )
  const invoicePayments = buildInvoicePaymentPlansFromBatch(batch, {})
  const openBalancePlans = buildInvoicePaymentPlansFromBatch(batch, {}, { ignoreExclusions: true })

  return {
    referenceNr: clean(metadata.referenceNr),
    rowCount: allRows.length,
    rowClassCounts: allRows.reduce((acc, row) => {
      const key = row.rowClass || ROW_CLASS.OTHER
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    reconciliationSummary: {
      calculatedSettlement: round2(num(batch?.reconciliationSummary?.calculatedSettlement)),
      expectedSettlement: round2(num(batch?.reconciliationSummary?.expectedSettlement)),
      reconciliationDifference: round2(num(batch?.reconciliationSummary?.reconciliationDifference)),
      reconciliationStatus: clean(batch?.reconciliationSummary?.reconciliationStatus),
    },
    targetUndeposited1066: round2(computeStatementUndepositedTarget(allRows)),
    settlementAdjustmentSourceRowNumbers: collectSettlementAdjustmentSourceRows(allRows, planExclusions)
      .map((r) => r.rowNumber)
      .sort((a, b) => num(a) - num(b)),
    rows: fingerprintRows(allRows, saleParentSet),
    feeJournalLines: fingerprintFeeJournals(feeJournalLines),
    settlementAdjustmentJournal: fingerprintSettlementAdjustment(settlementAdjustmentJournal),
    invoicePayments: fingerprintPaymentPlans(invoicePayments),
    openBalancePlans: fingerprintPaymentPlans(openBalancePlans),
    returns: fingerprintReturns(collectReturnRows(allRows, saleParentSet), batch?.matchedReturns),
  }
}

module.exports = {
  buildNoonClearingFingerprint,
}
