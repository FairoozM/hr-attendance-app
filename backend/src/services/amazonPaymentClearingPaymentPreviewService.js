const { round2 } = require('./amazonPaymentClearingOrderBreakdownService')

const PAYMENT_ACCOUNTS = Object.freeze({
  NET_BALANCE: {
    depositToAccountCode: '1024',
    depositToAccountName: 'KSA-Amazon Undeposited Funds',
  },
  COMMISSION: {
    depositToAccountCode: '1026',
    depositToAccountName: 'KSA-Amazon Uncleared Commission Exp',
  },
  SHIPPING_FBA: {
    depositToAccountCode: '1028',
    depositToAccountName: 'KSA-Amazon Uncleared Shipping Exp',
  },
})

const PAYMENT_PREVIEW_TOLERANCE = 0.01

function positiveAmount(value) {
  return Math.abs(round2(Number(value) || 0))
}

function payment(amount, account) {
  return {
    amount: positiveAmount(amount),
    ...account,
  }
}

function requireBatchForPaymentPreview(batch) {
  if (!batch) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (batch.status === 'posted') {
    const err = new Error('Payment preview cannot be generated for an already posted batch.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_POSTED'
    err.status = 409
    throw err
  }
  if (batch.status !== 'approved') {
    const err = new Error('Payment preview requires an approved settlement batch.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_APPROVED'
    err.status = 422
    throw err
  }
  const reconciliation = batch.reconciliationSummary || {}
  const diff = Number(reconciliation.reconciliationDifference) || 0
  if (reconciliation.reconciliationStatus === 'mismatch' || Math.abs(diff) > PAYMENT_PREVIEW_TOLERANCE) {
    const err = new Error('Payment preview requires a reconciled settlement batch.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_RECONCILED'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.unmatchedOrders) && batch.unmatchedOrders.length > 0) {
    const err = new Error('Payment preview requires zero unmatched orders.')
    err.code = 'AMAZON_PAYMENT_CLEARING_UNMATCHED_ORDERS'
    err.status = 422
    throw err
  }
}

function buildInvoicePaymentPlan(order) {
  const shippingOffsetTotal = round2(
    (Number(order.shippingCollectedTotal) || 0) + (Number(order.shippingPromotionTotal) || 0)
  )
  const shippingFbaFeeTotal = round2(
    (Number(order.fulfillmentFeeTotal) || 0) +
      (Number(order.closingFeeTotal) || 0) +
      (Number(order.otherAmazonFeeTotal) || 0) +
      shippingOffsetTotal
  )
  const invoiceClearingNetBalance = round2(
    (Number(order.principalTotal) || 0) +
      (Number(order.commissionTotal) || 0) +
      (Number(order.fulfillmentFeeTotal) || 0) +
      (Number(order.closingFeeTotal) || 0) +
      (Number(order.otherAmazonFeeTotal) || 0) +
      shippingOffsetTotal
  )
  const netBalancePayment = payment(invoiceClearingNetBalance, PAYMENT_ACCOUNTS.NET_BALANCE)
  const commissionPayment = payment(order.commissionTotal, PAYMENT_ACCOUNTS.COMMISSION)
  const shippingFbaPayment = payment(shippingFbaFeeTotal, PAYMENT_ACCOUNTS.SHIPPING_FBA)
  const totalClearingAmount = round2(
    netBalancePayment.amount + commissionPayment.amount + shippingFbaPayment.amount
  )
  const invoiceTotal = round2(order.zohoInvoiceTotal)
  const remainingDifference = round2(invoiceTotal - totalClearingAmount)

  return {
    orderId: order.orderId || '',
    zohoInvoiceId: order.zohoInvoiceId || '',
    zohoInvoiceNumber: order.zohoInvoiceNumber || '',
    zohoPoNumber: order.zohoPoNumber || '',
    customerId: order.zohoCustomerId || '',
    customerName: order.zohoCustomerName || '',
    invoiceTotal,
    shippingOffsetTotal,
    invoiceClearingNetBalance,
    netBalancePayment,
    commissionPayment,
    shippingFbaPayment,
    totalClearingAmount,
    remainingDifference,
    status: Math.abs(remainingDifference) <= PAYMENT_PREVIEW_TOLERANCE ? 'ready' : 'mismatch',
  }
}

function buildPaymentPreviewFromBatch(batch) {
  requireBatchForPaymentPreview(batch)
  const payments = (Array.isArray(batch.matchedOrders) ? batch.matchedOrders : []).map(buildInvoicePaymentPlan)
  const paymentPlanSummary = payments.reduce(
    (acc, row) => {
      acc.invoiceCount += 1
      acc.paymentEntryCount += 3
      acc.netBalanceTotal = round2(acc.netBalanceTotal + row.netBalancePayment.amount)
      acc.commissionClearingTotal = round2(acc.commissionClearingTotal + row.commissionPayment.amount)
      acc.shippingFbaClearingTotal = round2(acc.shippingFbaClearingTotal + row.shippingFbaPayment.amount)
      acc.totalPaymentAmount = round2(acc.totalPaymentAmount + row.totalClearingAmount)
      acc.zohoInvoiceTotal = round2(acc.zohoInvoiceTotal + row.invoiceTotal)
      return acc
    },
    {
      invoiceCount: 0,
      paymentEntryCount: 0,
      netBalanceTotal: 0,
      commissionClearingTotal: 0,
      shippingFbaClearingTotal: 0,
      totalPaymentAmount: 0,
      zohoInvoiceTotal: 0,
      difference: 0,
    }
  )
  paymentPlanSummary.difference = round2(paymentPlanSummary.zohoInvoiceTotal - paymentPlanSummary.totalPaymentAmount)
  const warnings = []
  const mismatches = payments.filter((row) => row.status === 'mismatch')
  if (mismatches.length > 0) {
    warnings.push(`${mismatches.length} invoice payment plan(s) do not clear to zero.`)
  }

  return {
    batchId: batch.batchId,
    status: 'previewed',
    paymentPlanSummary,
    payments,
    warnings,
  }
}

module.exports = {
  PAYMENT_ACCOUNTS,
  PAYMENT_PREVIEW_TOLERANCE,
  buildInvoicePaymentPlan,
  buildPaymentPreviewFromBatch,
  requireBatchForPaymentPreview,
}
