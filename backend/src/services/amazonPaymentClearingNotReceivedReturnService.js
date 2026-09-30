/**
 * Returns Amazon refunded to the customer but whose product never came back.
 * No credit note exists for them; the refund is expensed with one combined journal
 * per settlement: Dr Amazon Return Exp / Cr Amazon Undeposited Funds.
 */
const { round2 } = require('./amazonPaymentClearingOrderBreakdownService')
const { buildSettlementReference, buildEntryReference } = require('./amazonPaymentClearingReferenceService')
const { getPaymentClearingMarketplaceConfig } = require('./amazonPaymentClearingMarketplaceConfig')

const NOT_RECEIVED_DISPOSITION = 'not_received'
const NOT_RECEIVED_JOURNAL_TYPE = 'return_not_received_journal'
const TOLERANCE = 0.01

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function notReceivedDispositions(batch) {
  return (Array.isArray(batch?.returnDispositions) ? batch.returnDispositions : []).filter(
    (row) => row?.disposition === NOT_RECEIVED_DISPOSITION && clean(row.orderId)
  )
}

/**
 * @param {any} batch
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 */
function buildNotReceivedReturnPlan(batch, opts = {}) {
  const marketplace = clean(batch?.marketplace) || 'KSA'
  const cfg = getPaymentClearingMarketplaceConfig(marketplace)
  const orders = notReceivedDispositions(batch)
    .map((row) => ({
      orderId: clean(row.orderId),
      amount: Math.abs(round2(Number(row.amount) || 0)),
      reason: clean(row.reason),
      zohoInvoiceNumber: clean(row.zohoInvoiceNumber),
      markedBy: row.markedBy ?? null,
      markedAt: row.markedAt || null,
    }))
    .sort((a, b) => a.orderId.localeCompare(b.orderId))
  const total = round2(orders.reduce((sum, row) => sum + row.amount, 0))

  let line = null
  if (orders.length && total > TOLERANCE) {
    const envAccountId = clean(opts.env?.[cfg.returnExpenseAccountIdEnv])
    const expense = {
      accountCode: cfg.returnExpenseAccount.accountCode,
      accountName: cfg.returnExpenseAccount.accountName,
      accountId: envAccountId || cfg.returnExpenseAccount.accountId,
    }
    const settlementReference = buildSettlementReference(batch)
    const entry = buildEntryReference(settlementReference, 'return_not_received', 'Returns Not Received')
    const orderIds = orders.map((row) => row.orderId)
    line = {
      key: 'return-not-received',
      paymentType: NOT_RECEIVED_JOURNAL_TYPE,
      feeType: 'Returns not received',
      normalizedFeeType: 'RETURN_NOT_RECEIVED',
      amount: total,
      orderIds,
      debit: { ...expense, amount: total },
      credit: { ...cfg.returnFeeAccounts.UNDEPOSITED, amount: total },
      referenceNumber: entry.referenceNumber,
      notes: `Refunded by Amazon, product not received: ${orderIds.join(', ')}`,
      status: expense.accountId ? 'ready' : 'needs_mapping',
      blockingReason: expense.accountId
        ? ''
        : `No Zoho account id for ${expense.accountName}. Set ${cfg.returnExpenseAccountIdEnv} on the backend.`,
    }
  }

  return {
    batchId: batch?.batchId ?? null,
    marketplace: cfg.code,
    orders,
    line,
    summary: { orderCount: orders.length, total },
  }
}

module.exports = {
  NOT_RECEIVED_DISPOSITION,
  NOT_RECEIVED_JOURNAL_TYPE,
  notReceivedDispositions,
  buildNotReceivedReturnPlan,
}
