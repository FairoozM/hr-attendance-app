const {
  round2,
  num,
  clean,
  ROW_CLASS,
  isUnclearedInvoicePaymentBucketRow,
  displayLabelForFeeRow,
} = require('./noonPaymentClearingCategoryService')
const { resolveNoonOrderIds } = require('./noonOrderIdHelper')
const { getNoonPaymentClearingMarketplaceConfig } = require('./noonPaymentClearingMarketplaceConfig')
const { truncateZohoReference } = require('./noonPaymentClearingReferenceService')
const { extractVatFromNoonRow, DEFAULT_VAT_RATE } = require('./noonPaymentClearingVatService')
const { ASSIGNMENT_REASON_ZOHO } = require('./noonPaymentClearingParentChargeFallback')

const SETTLEMENT_ADJUSTMENT_FEE_TYPE = 'NOON_SETTLEMENT_ADJUSTMENT'
const PAID_INVOICE_SUBSIDY_REASON = 'open_balance_short_already_paid'

function itemOrderMatchKey(value) {
  return clean(value).toLowerCase().replace(/\s+/g, '')
}

function parentOrderIdForRow(row) {
  return clean(
    row.originalParentOrderId ||
      row.parentOrderId ||
      resolveNoonOrderIds(row).parentOrderId
  ).toLowerCase()
}

function isSaleBearingSaleRow(row) {
  return row?.rowClass === ROW_CLASS.SALE_ITEM && num(row.netProceed) >= 0.01
}

/** Parents with a genuine sale line (Net Proceeds > 0) in this statement — not zero-sale logistics rows. */
function buildSaleParentOrderIdSet(rows = []) {
  const set = new Set()
  for (const row of rows) {
    if (!isSaleBearingSaleRow(row)) continue
    const parent = parentOrderIdForRow(row)
    if (parent) set.add(parent)
  }
  return set
}

function hasMarketplaceLogisticsCharge(row) {
  if (!row) return false
  return (
    Math.abs(num(row.fulfillmentFee)) >= 0.005 ||
    Math.abs(num(row.shippingCharges)) >= 0.005 ||
    Math.abs(num(row.otherOrderFees)) >= 0.005 ||
    Math.abs(num(row.othersInclVat)) >= 0.005
  )
}

/**
 * Item-level (or parent) logistics with Net Proceeds = 0 and no sale-bearing parent in this statement.
 * Zoho invoice match is audit-only — route to settlement adjustment, not Record Payment / 1068.
 */
function isZeroSaleCrossWeekLogisticsSettlementRow(row, saleParentSet) {
  if (!row || row.excludeFromPaymentClearing) return false
  if (num(row.netProceed) >= 0.01) return false
  if (!hasMarketplaceLogisticsCharge(row)) return false
  if (row.rowClass === ROW_CLASS.SALE_ITEM && num(row.total) > 0.01) return false
  const parent = parentOrderIdForRow(row)
  if (!parent) return false
  const parents = saleParentSet || buildSaleParentOrderIdSet([])
  if (parents.has(parent)) return false
  return true
}

function isCrossWeekSettlementAdjustmentRow(row, saleParentSet) {
  if (!row) return false
  if (!isUnclearedInvoicePaymentBucketRow(row)) return false
  const rc = row.rowClass
  if (rc !== ROW_CLASS.PARENT_ORDER_CHARGE && rc !== ROW_CLASS.ORDER_ADJUSTMENT) return false
  const parent = parentOrderIdForRow(row)
  if (!parent) return false
  return !saleParentSet.has(parent)
}

/** Positive subsidy on a Zoho-paid invoice — settlement adjustment journal only (not Record Payment). */
function isPaidInvoiceSubsidyAdjustmentRow(row, planExclusions = null) {
  if (!row || num(row.total) < 0.01) return false
  if (!isUnclearedInvoicePaymentBucketRow(row)) return false
  const assignedItem = clean(row.assignedItemOrderId) || clean(row.itemOrderId)
  const assignedInv = clean(row.assignedZohoInvoiceId || row.zohoInvoiceId)
  if (!assignedItem && !assignedInv) return false
  if (row.paidInvoiceSubsidy) return true
  if (row.excludeFromPaymentClearing && num(row.total) >= 0.01) return true
  if (clean(row.excludeReason) === PAID_INVOICE_SUBSIDY_REASON && num(row.total) >= 0.01) {
    return true
  }
  const exInv = planExclusions?.excludedInvoiceIds
  const exItem = planExclusions?.excludedItemOrderIds
  if (exInv && assignedInv && exInv.has(assignedInv)) return true
  if (exItem && assignedItem && exItem.has(itemOrderMatchKey(assignedItem))) return true
  return false
}

function isSameWeekPositiveParentSubsidyRow(row, saleParentSet) {
  if (!row || num(row.total) < 0.01) return false
  if (!isUnclearedInvoicePaymentBucketRow(row)) return false
  const rc = row.rowClass
  if (rc !== ROW_CLASS.PARENT_ORDER_CHARGE && rc !== ROW_CLASS.ORDER_ADJUSTMENT) return false
  const parent = parentOrderIdForRow(row)
  if (!parent || !saleParentSet.has(parent)) return false
  return true
}

function isSettlementAdjustmentSourceRow(row, planExclusions = null, saleParentSet = null) {
  if (!row) return false
  if (isPaidInvoiceSubsidyAdjustmentRow(row, planExclusions)) return true
  const parents = saleParentSet || buildSaleParentOrderIdSet([])
  if (isZeroSaleCrossWeekLogisticsSettlementRow(row, parents)) return true
  if (isSameWeekPositiveParentSubsidyRow(row, parents)) return true
  if (row.excludeFromPaymentClearing) return false
  return isCrossWeekSettlementAdjustmentRow(row, parents)
}

function normalizeGlAccount(account = null, fallbackName = '') {
  if (!account) return { accountId: '', accountName: fallbackName, accountCode: '' }
  return {
    accountId: clean(account.accountId),
    accountName: clean(account.accountName) || fallbackName,
    accountCode: clean(account.accountCode),
  }
}

function resolveAdjustmentExpenseAccount(row, cfg) {
  const feeType = clean(row.normalizedFeeType).toUpperCase()
  const referral = Math.abs(num(row.referralFee))
  const fulfillment = Math.abs(
    round2(num(row.fulfillmentFee) + num(row.shippingCharges) + num(row.otherOrderFees))
  )
  if (
    feeType.includes('REFERRAL') ||
    feeType.includes('COMMISSION') ||
    (referral >= 0.01 && fulfillment < 0.01)
  ) {
    return normalizeGlAccount(cfg.commissionExpenseAccount, 'Commission Expense')
  }
  return normalizeGlAccount(cfg.shippingExpenseAccount, 'Shipping Expense')
}

function isParentFallbackRow(row) {
  const status = clean(row.parentFallbackStatus)
  const reason = clean(row.assignmentReason)
  if (status === 'assigned_zoho_orphan') return true
  if (reason === ASSIGNMENT_REASON_ZOHO) return true
  return false
}

function orderIdPartForDescription(row) {
  const item = clean(row.itemOrderId)
  const parent = clean(
    row.originalParentOrderId || row.parentOrderId || resolveNoonOrderIds(row).parentOrderId
  )
  const assigned = clean(row.assignedItemOrderId)

  if (item && item.includes('-')) return item
  if (isParentFallbackRow(row) && parent && assigned) {
    return `Parent ${parent} | Child ${assigned}`
  }
  if (assigned && assigned.includes('-')) return assigned
  if (parent) return parent
  return assigned || item || 'unknown'
}

function grossLabelForRow(row) {
  const gross = round2(Math.abs(num(row.total)))
  return num(row.total) > 0 ? `Gross +${gross}` : `Gross ${gross}`
}

function primaryOrderIdForRow(row) {
  return orderIdPartForDescription(row)
}

function adjustmentDescriptionLabel(row) {
  const fulfillment = Math.abs(
    round2(num(row.fulfillmentFee) + num(row.shippingCharges) + num(row.otherOrderFees))
  )
  if (fulfillment >= 0.01) return 'shipping'
  const raw = (displayLabelForFeeRow(row) || 'shipping').toLowerCase()
  if (raw.includes('fulfillment') || raw.includes('shipping') || raw.includes('logistics')) {
    return 'shipping'
  }
  if (raw.includes('commission') || raw.includes('referral')) {
    return 'commission'
  }
  if (raw.includes('adjustment')) {
    return 'adjustment'
  }
  return raw.split('/')[0].trim() || 'shipping'
}

function buildAdjustmentLineDescription(row, metadata = {}, kind = 'expense') {
  const ref = clean(metadata.referenceNr) || clean(metadata.statementId) || 'Noon settlement'
  const orderPart = orderIdPartForDescription(row)
  const grossLabel = grossLabelForRow(row)

  if (kind === 'vat') {
    return `Noon VAT | ${orderPart} | ${ref} | ${grossLabel}`
  }

  if (num(row.total) > 0) {
    return `Noon subsidy | ${orderPart} | ${ref} | ${grossLabel}`
  }

  const label = adjustmentDescriptionLabel(row)
  return `Noon ${label} | ${orderPart} | ${ref} | ${grossLabel}`
}

function lineItemFromAccount(account, debitOrCredit, amount, description = '', customerId = '') {
  const item = {
    debitOrCredit,
    accountId: account.accountId,
    accountName: account.accountName,
    accountCode: account.accountCode,
    amount: round2(amount),
    description: clean(description),
  }
  const resolvedCustomerId = clean(customerId)
  if (resolvedCustomerId) item.customerId = resolvedCustomerId
  return item
}

function buildSourceRowAdjustmentFragments(row, accounts, metadata, saleParentSet = null) {
  const signedGross = round2(num(row.total))
  if (Math.abs(signedGross) < 0.01) return null

  const noonCustomerId = clean(metadata.zohoCustomerId)
  const vatRate = accounts.vatRate ?? DEFAULT_VAT_RATE
  const vatBreakdown = extractVatFromNoonRow(row, { vatRate })
  const expenseAccount = resolveAdjustmentExpenseAccount(row, accounts.cfg)
  const inputVat = normalizeGlAccount(accounts.inputVatAccount, 'Input VAT')
  const undeposited = normalizeGlAccount(accounts.undepositedFundsAccount, 'Noon Undeposited Funds')

  const absGross = Math.abs(signedGross)
  const absNet = Math.abs(vatBreakdown.netAmount)
  const absVat = Math.abs(vatBreakdown.vatAmount)
  const isPositiveReversal = signedGross > 0
  const expenseDesc = buildAdjustmentLineDescription(row, metadata, 'expense')
  const vatDesc = buildAdjustmentLineDescription(row, metadata, 'vat')

  const detailLineItems = []
  let undepositedSignedImpact = 0

  if (isPositiveReversal) {
    undepositedSignedImpact = absGross
    if (vatBreakdown.vatInclusive && absVat >= 0.005) {
      detailLineItems.push(lineItemFromAccount(expenseAccount, 'credit', absNet, expenseDesc, noonCustomerId))
      detailLineItems.push(lineItemFromAccount(inputVat, 'credit', absVat, vatDesc, noonCustomerId))
    } else {
      detailLineItems.push(lineItemFromAccount(expenseAccount, 'credit', absGross, expenseDesc, noonCustomerId))
    }
  } else if (vatBreakdown.vatInclusive && absVat >= 0.005) {
    undepositedSignedImpact = -absGross
    detailLineItems.push(lineItemFromAccount(expenseAccount, 'debit', absNet, expenseDesc, noonCustomerId))
    detailLineItems.push(lineItemFromAccount(inputVat, 'debit', absVat, vatDesc, noonCustomerId))
  } else {
    undepositedSignedImpact = -absGross
    detailLineItems.push(lineItemFromAccount(expenseAccount, 'debit', absGross, expenseDesc, noonCustomerId))
  }

  const sourceDetail = {
    rowNumber: row.rowNumber,
    rowClass: row.rowClass,
    transactionType: clean(row.transactionType),
    parentOrderId: clean(row.originalParentOrderId || row.parentOrderId),
    itemOrderId: clean(row.itemOrderId),
    assignedItemOrderId: clean(row.assignedItemOrderId),
    assignedZohoInvoiceId: clean(row.assignedZohoInvoiceId || row.zohoInvoiceId),
    assignedZohoInvoiceNumber: clean(row.assignedZohoInvoiceNumber),
    sku: clean(row.sku || row.partnerSku),
    signedGrossAmount: signedGross,
    grossAmount: absGross,
    vatInclusive: vatBreakdown.vatInclusive,
    vatRate: vatBreakdown.vatRate,
    netExpenseAmount: round2(isPositiveReversal ? -absNet : absNet),
    vatAmount: round2(isPositiveReversal ? -absVat : absVat),
    expenseAccountId: expenseAccount.accountId,
    expenseAccountName: expenseAccount.accountName,
    expenseAccountCode: expenseAccount.accountCode,
    inputVatAccountId: inputVat.accountId,
    inputVatAccountName: inputVat.accountName,
    inputVatAccountCode: inputVat.accountCode,
    undepositedImpact: undepositedSignedImpact,
    parentFallbackStatus: clean(row.parentFallbackStatus),
    assignmentReason: clean(row.assignmentReason),
    displayLabel: row.displayLabel || displayLabelForFeeRow(row) || 'Settlement adjustment',
    accountingTreatment: isPaidInvoiceSubsidyAdjustmentRow(row)
      ? 'Cross-week settlement adjustment (paid-invoice subsidy)'
      : isZeroSaleCrossWeekLogisticsSettlementRow(row, saleParentSet || buildSaleParentOrderIdSet([]))
        ? 'Cross-week zero-sale item logistics — settlement adjustment journal'
        : 'Cross-week settlement adjustment',
    paidInvoiceSubsidy: Boolean(row.paidInvoiceSubsidy),
    isPositiveReversal,
  }

  return { detailLineItems, undepositedSignedImpact, sourceDetail, undeposited }
}

function collectSettlementAdjustmentSourceRows(allRows = [], planExclusions = null) {
  const saleParentSet = buildSaleParentOrderIdSet(allRows)
  return (Array.isArray(allRows) ? allRows : [])
    .filter((row) => isSettlementAdjustmentSourceRow(row, planExclusions, saleParentSet))
    .sort((a, b) => (Number(a.rowNumber) || 0) - (Number(b.rowNumber) || 0))
}

function summarizeSettlementAdjustmentSources(sourceDetails = []) {
  let grossNegative = 0
  let grossPositive = 0
  let netExpense = 0
  let inputVat = 0
  let netUndepositedImpact = 0
  let paidSubsidyCount = 0
  for (const line of sourceDetails) {
    const gross = round2(num(line.grossAmount))
    if (line.isPositiveReversal) grossPositive = round2(grossPositive + gross)
    else grossNegative = round2(grossNegative + gross)
    netExpense = round2(netExpense + num(line.netExpenseAmount))
    inputVat = round2(inputVat + num(line.vatAmount))
    netUndepositedImpact = round2(netUndepositedImpact + num(line.undepositedImpact))
    if (line.paidInvoiceSubsidy) paidSubsidyCount += 1
  }
  return {
    sourceRowCount: sourceDetails.length,
    grossNegativeAdjustments: grossNegative,
    grossPositiveAdjustments: grossPositive,
    netExpense,
    inputVat,
    netUndepositedImpact,
    paidInvoiceSubsidyLineCount: paidSubsidyCount,
  }
}

function buildSettlementAdjustmentJournal(allRows = [], metadata = {}, accountOverrides = {}, planExclusions = null) {
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const accounts = {
    cfg,
    undepositedFundsAccount:
      accountOverrides.undepositedFundsAccount || cfg.undepositedFundsAccount,
    inputVatAccount: accountOverrides.inputVatAccount || cfg.inputVatAccount,
    vatRate: accountOverrides.vatRate ?? cfg.vatRate ?? DEFAULT_VAT_RATE,
  }
  const sourceRows = collectSettlementAdjustmentSourceRows(allRows, planExclusions)
  if (!sourceRows.length) return null

  const saleParentSet = buildSaleParentOrderIdSet(allRows)
  const sourceDetails = []
  const detailLineItems = []
  let undepositedDebit = 0
  let undepositedCredit = 0
  let undepositedAccount = normalizeGlAccount(accounts.undepositedFundsAccount, 'Noon Undeposited Funds')

  for (const row of sourceRows) {
    const fragment = buildSourceRowAdjustmentFragments(row, accounts, metadata, saleParentSet)
    if (!fragment) continue
    sourceDetails.push(fragment.sourceDetail)
    detailLineItems.push(...fragment.detailLineItems)
    undepositedAccount = fragment.undeposited
    if (fragment.undepositedSignedImpact > 0) {
      undepositedDebit = round2(undepositedDebit + fragment.undepositedSignedImpact)
    } else if (fragment.undepositedSignedImpact < 0) {
      undepositedCredit = round2(undepositedCredit + Math.abs(fragment.undepositedSignedImpact))
    }
  }

  if (!sourceDetails.length) return null

  const ref = clean(metadata.referenceNr) || clean(metadata.statementId) || 'Noon settlement'
  const balancingDesc = `Noon settlement adjustments | ${ref}`
  if (undepositedDebit >= 0.01) {
    detailLineItems.push(
      lineItemFromAccount(undepositedAccount, 'debit', undepositedDebit, balancingDesc)
    )
  }
  if (undepositedCredit >= 0.01) {
    detailLineItems.push(
      lineItemFromAccount(undepositedAccount, 'credit', undepositedCredit, balancingDesc)
    )
  }

  const summary = summarizeSettlementAdjustmentSources(sourceDetails)
  const amount = round2(Math.max(undepositedDebit, undepositedCredit))
  if (amount < 0.01) return null

  const signedAmount = round2(summary.netUndepositedImpact)
  const referenceNumber = truncateZohoReference(ref)

  return {
    paymentType: 'settlement_adjustment',
    feeType: SETTLEMENT_ADJUSTMENT_FEE_TYPE,
    normalizedFeeType: SETTLEMENT_ADJUSTMENT_FEE_TYPE,
    displayLabel: 'Noon Settlement Adjustments Journal',
    accountingTreatment: 'Cross-week shipping/logistics — Dr expense + VAT / Cr 1066 (or reversed for subsidies)',
    rowClass: 'settlement_adjustment',
    amount,
    signedAmount,
    referenceNumber,
    sourceLineCount: sourceDetails.length,
    sourceLines: sourceDetails,
    lineItems: detailLineItems,
    summary,
    zohoAccountId: undepositedAccount.accountId,
    zohoAccountName: undepositedAccount.accountName,
    zohoAccountCode: undepositedAccount.accountCode,
    accountingPreview: {
      sourceRowCount: summary.sourceRowCount,
      grossNegativeAdjustments: summary.grossNegativeAdjustments,
      grossPositiveAdjustments: summary.grossPositiveAdjustments,
      netExpense: summary.netExpense,
      inputVat: summary.inputVat,
      netUndepositedImpact: summary.netUndepositedImpact,
      lines: detailLineItems.map((line) => ({
        side: line.debitOrCredit,
        account: line.accountName,
        amount: line.amount,
        description: line.description,
      })),
    },
    previewNote:
      'Zero-sale cross-week charges and paid-invoice subsidies — not Record Payment. One journal per statement with per-order expense/VAT detail.',
    mappingStatus: 'mapped',
  }
}

module.exports = {
  SETTLEMENT_ADJUSTMENT_FEE_TYPE,
  parentOrderIdForRow,
  isSaleBearingSaleRow,
  buildSaleParentOrderIdSet,
  hasMarketplaceLogisticsCharge,
  isZeroSaleCrossWeekLogisticsSettlementRow,
  isCrossWeekSettlementAdjustmentRow,
  isPaidInvoiceSubsidyAdjustmentRow,
  isSameWeekPositiveParentSubsidyRow,
  isSettlementAdjustmentSourceRow,
  collectSettlementAdjustmentSourceRows,
  summarizeSettlementAdjustmentSources,
  buildSettlementAdjustmentJournal,
  buildAdjustmentLineDescription,
  primaryOrderIdForRow,
}
