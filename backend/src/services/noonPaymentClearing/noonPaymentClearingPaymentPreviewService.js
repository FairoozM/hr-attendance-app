const {
  round2,
  num,
  clean,
  ROW_CLASS,
  isUnclearedInvoicePaymentBucketRow,
} = require('./noonPaymentClearingCategoryService')
const { getNoonPaymentClearingMarketplaceConfig } = require('./noonPaymentClearingMarketplaceConfig')
const { buildSettlementReference, buildEntryReference } = require('./noonPaymentClearingReferenceService')
const { isNoonSettlementReconciliationAcceptable, RECONCILIATION_TOLERANCE } = require('./noonPaymentClearingReconciliationService')
const { buildFeeJournalPreviewLines } = require('./noonPaymentClearingPreviewService')

const PAYMENT_PREVIEW_TOLERANCE = RECONCILIATION_TOLERANCE

function positiveAmount(value) {
  return Math.abs(round2(Number(value) || 0))
}

function requireBatchForPaymentPreview(batch) {
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (batch.status !== 'approved' && batch.status !== 'posted') {
    const err = new Error('Payment preview requires an approved Noon statement batch.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_APPROVED'
    err.status = 422
    throw err
  }
  if (!isNoonSettlementReconciliationAcceptable(batch.reconciliationSummary, PAYMENT_PREVIEW_TOLERANCE)) {
    const err = new Error('Payment preview requires a reconciled Noon statement batch.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_RECONCILED'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.unmatchedOrders) && batch.unmatchedOrders.length > 0) {
    const err = new Error('Payment preview requires zero unmatched item orders.')
    err.code = 'NOON_PAYMENT_CLEARING_UNMATCHED_ORDERS'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.multipleMatchItems) && batch.multipleMatchItems.length > 0) {
    const err = new Error('Payment preview requires zero multiple invoice matches.')
    err.code = 'NOON_PAYMENT_CLEARING_MULTIPLE_MATCHES'
    err.status = 422
    throw err
  }
}

/**
 * Parent / adjustment logistics assigned to a child invoice — add onto that child's
 * Record Payment buckets (1067 commission / 1068 shipping), Amazon KSA style.
 */
function collectAssignedUnclearedPaymentAddOns(allRows = []) {
  const byItem = new Map()
  for (const row of Array.isArray(allRows) ? allRows : []) {
    if (!isUnclearedInvoicePaymentBucketRow(row)) continue
    const itemId = clean(row.assignedItemOrderId) || clean(row.itemOrderId)
    if (!itemId) continue

    const entry = byItem.get(itemId) || {
      commission: 0,
      fulfillment: 0,
      sourceRowNumbers: [],
    }

    const referral = positiveAmount(row.referralFee)
    let fulfillment = positiveAmount(
      round2(
        num(row.fulfillmentFee) +
          num(row.shippingCharges) +
          num(row.otherOrderFees) +
          num(row.othersInclVat) +
          num(row.orderSubsidies)
      )
    )
    // Fee columns empty but total is a logistics/parent charge — use total.
    if (referral === 0 && fulfillment === 0 && Math.abs(num(row.total)) >= 0.01) {
      fulfillment = positiveAmount(row.total)
    }

    entry.commission = round2(entry.commission + referral)
    entry.fulfillment = round2(entry.fulfillment + fulfillment)
    entry.sourceRowNumbers.push(row.rowNumber)
    byItem.set(itemId, entry)
  }
  return byItem
}

function buildInvoicePaymentPlan(item, accounts, addOns = null) {
  const netProceed = positiveAmount(item.netProceed)
  const commission = round2(positiveAmount(item.referralFee) + positiveAmount(addOns?.commission))
  const fulfillmentShipping = round2(
    positiveAmount(round2(num(item.fulfillmentFee) + num(item.shippingCharges))) +
      positiveAmount(addOns?.fulfillment)
  )
  const netBalancePayment = {
    amount: netProceed,
    paymentType: 'net_balance',
    ...accounts.NET_BALANCE,
  }
  const commissionPayment = {
    amount: commission,
    paymentType: 'commission',
    ...accounts.COMMISSION,
  }
  const fulfillmentPayment = {
    amount: fulfillmentShipping,
    paymentType: 'fulfillment_shipping',
    ...accounts.FULFILLMENT_SHIPPING,
  }
  const totalClearingAmount = round2(
    netBalancePayment.amount + commissionPayment.amount + fulfillmentPayment.amount
  )
  return {
    itemOrderId: item.itemOrderId || '',
    parentOrderId: item.parentOrderId || '',
    sku: item.sku || '',
    partnerSku: item.partnerSku || '',
    zohoInvoiceId: item.zohoInvoiceId || '',
    zohoInvoiceNumber: item.zohoInvoiceNumber || '',
    zohoPoNumber: item.zohoPoNumber || '',
    customerId: item.zohoCustomerId || '',
    customerName: item.zohoCustomerName || '',
    invoiceTotal: round2(item.zohoInvoiceTotal),
    netProceed,
    referralFee: commission,
    fulfillmentShipping,
    parentLogisticsAddOn: positiveAmount(addOns?.fulfillment),
    parentCommissionAddOn: positiveAmount(addOns?.commission),
    netBalancePayment,
    commissionPayment,
    fulfillmentPayment,
    totalClearingAmount,
    paymentAction: 'record_payment',
  }
}

function buildFoldedUnclearedChargeSummaries(allRows = []) {
  return (Array.isArray(allRows) ? allRows : [])
    .filter((row) => isUnclearedInvoicePaymentBucketRow(row))
    .map((row) => ({
      rowNumber: row.rowNumber,
      rowClass: row.rowClass,
      feeType: row.normalizedFeeType || '',
      displayLabel: row.displayLabel || row.title || '',
      accountingTreatment: 'Invoice Record Payment → uncleared (first entry)',
      signedAmount: round2(num(row.total)),
      amount: Math.abs(round2(num(row.total))),
      parentOrderId: clean(row.originalParentOrderId || row.parentOrderId),
      assignedItemOrderId: clean(row.assignedItemOrderId) || clean(row.itemOrderId),
      previewNote: clean(row.assignedItemOrderId)
        ? `Folded into invoice payment for ${clean(row.assignedItemOrderId)} → uncleared GL`
        : clean(row.itemOrderId)
          ? `Cleared via invoice payment for ${clean(row.itemOrderId)} → uncleared GL`
          : 'Uncleared via invoice payment (no child assignment)',
      clearingPath: 'invoice_payment_uncleared',
    }))
}

function buildPaymentPreviewFromBatch(batch, mappingRules = [], inputVatAccount = null) {
  requireBatchForPaymentPreview(batch)
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const accounts = cfg.paymentPreviewAccounts
  const matched = Array.isArray(batch.matchedOrders) ? batch.matchedOrders : []
  const allRows = batch.allRows || []
  const addOnsByItem = collectAssignedUnclearedPaymentAddOns(allRows)
  const invoicePayments = matched.map((item) =>
    buildInvoicePaymentPlan(item, accounts, addOnsByItem.get(clean(item.itemOrderId)) || null)
  )
  const feeJournalLines = buildFeeJournalPreviewLines(
    allRows,
    mappingRules,
    inputVatAccount || batch.inputVatAccount || null
  )
  const foldedUnclearedCharges = buildFoldedUnclearedChargeSummaries(allRows)
  const parentChargeLines = foldedUnclearedCharges.filter((l) => l.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE)
  const adjustmentFolded = foldedUnclearedCharges.filter((l) => l.rowClass === ROW_CLASS.ORDER_ADJUSTMENT)
  const statementFeeLines = feeJournalLines.filter((l) => l.rowClass === 'statement_fee')
  // Non-logistics adjustments that still journal (rare) stay as journal clearings.
  const adjustmentJournalLines = feeJournalLines.filter((l) => l.rowClass === 'order_adjustment')

  const totalInvoicePayments = round2(invoicePayments.reduce((a, p) => a + p.totalClearingAmount, 0))
  const totalFeeJournals = round2(feeJournalLines.reduce((a, l) => a + l.amount, 0))
  const expectedSettlement = round2(batch.reconciliationSummary?.expectedSettlement || 0)
  const metadata = batch.reportSnapshot || batch.metadata || {}
  const settlementReference = buildSettlementReference(metadata)

  return {
    batchId: batch.batchId || batch.id,
    status: 'previewed',
    settlementReference,
    postingReferences: {
      netBalance: buildEntryReference(metadata, 'Net Undeposited'),
      commission: buildEntryReference(metadata, 'Commission'),
      fulfillmentShipping: buildEntryReference(metadata, 'Fulfillment'),
    },
    invoicePayments,
    parentLevelCharges: parentChargeLines,
    statementLevelCharges: statementFeeLines,
    adjustmentClearings: [...adjustmentFolded, ...adjustmentJournalLines],
    feeJournalLines,
    summary: {
      invoicePaymentCount: invoicePayments.length,
      totalInvoicePayments,
      totalFeesJournals: totalFeeJournals,
      totalAdjustments: round2(
        [...adjustmentFolded, ...adjustmentJournalLines].reduce((a, l) => a + (Number(l.amount) || 0), 0)
      ),
      expectedNoonSettlement: expectedSettlement,
      finalDifference: round2(
        expectedSettlement - round2(totalInvoicePayments - totalFeeJournals)
      ),
      unmappedFeeJournalCount: feeJournalLines.filter((l) => l.mappingStatus === 'needs_mapping').length,
    },
  }
}

module.exports = {
  PAYMENT_PREVIEW_TOLERANCE,
  requireBatchForPaymentPreview,
  buildInvoicePaymentPlan,
  buildPaymentPreviewFromBatch,
  collectAssignedUnclearedPaymentAddOns,
}
