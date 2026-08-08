const { round2, num, clean } = require('./noonPaymentClearingCategoryService')
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

function buildInvoicePaymentPlan(item, accounts) {
  const netProceed = positiveAmount(item.netProceed)
  const commission = positiveAmount(item.referralFee)
  const fulfillmentShipping = positiveAmount(
    round2(num(item.fulfillmentFee) + num(item.shippingCharges))
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
    netBalancePayment,
    commissionPayment,
    fulfillmentPayment,
    totalClearingAmount,
    paymentAction: 'record_payment',
  }
}

function buildPaymentPreviewFromBatch(batch, mappingRules = []) {
  requireBatchForPaymentPreview(batch)
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const accounts = cfg.paymentPreviewAccounts
  const matched = Array.isArray(batch.matchedOrders) ? batch.matchedOrders : []
  const invoicePayments = matched.map((item) => buildInvoicePaymentPlan(item, accounts))
  const feeJournalLines = buildFeeJournalPreviewLines(batch.allRows || [], mappingRules)
  const parentChargeLines = feeJournalLines.filter((l) => l.rowClass === 'parent_order_charge')
  const statementFeeLines = feeJournalLines.filter((l) => l.rowClass === 'statement_fee')
  const adjustmentLines = feeJournalLines.filter((l) => l.rowClass === 'order_adjustment')

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
    adjustmentClearings: adjustmentLines,
    feeJournalLines,
    summary: {
      invoicePaymentCount: invoicePayments.length,
      totalInvoicePayments,
      totalFeesJournals: totalFeeJournals,
      totalAdjustments: round2(adjustmentLines.reduce((a, l) => a + l.amount, 0)),
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
}
