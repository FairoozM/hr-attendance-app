const { listCreditNoteRefunds, refundCreditNote } = require('../../integrations/zoho/zohoBooksClient')
const { buildSettlementReference, buildEntryReference } = require('./noonPaymentClearingReferenceService')
const { round2, num, clean } = require('./noonPaymentClearingCategoryService')
const { positiveAmount } = require('./noonPaymentClearingRowPredicates')
const { getNoonPaymentClearingMarketplaceConfig } = require('./noonPaymentClearingMarketplaceConfig')
const {
  buildReturnDescription,
  buildNoonReturnFeeBreakdown,
  collectReturnRows,
  TOLERANCE,
} = require('./noonPaymentClearingReturnService')
const store = require('./noonPaymentClearingStore')
const zohoPaymentService = require('../amazonPaymentClearingZohoPaymentService')

const PAYMENT_TYPE = 'credit_note_refund'

async function creditNoteRefundTotal(creditNoteId, referenceNumber = '', listRefunds = listCreditNoteRefunds) {
  const refunds = await listRefunds(creditNoteId)
  const refKey = clean(referenceNumber)
  let total = 0
  for (const row of refunds) {
    const rowRef = clean(row.reference_number || row.referenceNumber)
    if (refKey && rowRef && rowRef !== refKey) continue
    total = round2(total + num(row.amount ?? row.amount_bcy ?? row.amount_fcy))
  }
  return total
}

function resolveProductRefundAmount(row, batch) {
  const fromProduct = positiveAmount(row.productRefundAmount)
  if (fromProduct >= TOLERANCE) return fromProduct
  const fromCn = positiveAmount(row.creditNoteAmount)
  if (fromCn >= TOLERANCE) return fromCn
  const itemKey = clean(row.itemOrderId)
  if (!itemKey) return 0
  const returnRow = collectReturnRows(batch?.allRows || []).find(
    (candidate) => clean(candidate.itemOrderId) === itemKey
  )
  if (returnRow) {
    return buildNoonReturnFeeBreakdown(returnRow).productRefundAmount
  }
  const refundRow = (batch?.refundReturnRows || []).find(
    (candidate) => clean(candidate.itemOrderId) === itemKey
  )
  return positiveAmount(refundRow?.productRefundAmount)
}

function collectReturnRowsForApply(batch) {
  const byItem = new Map()
  for (const row of batch?.refundReturnRows || []) {
    const key = clean(row.itemOrderId)
    if (!key) continue
    byItem.set(key, { ...byItem.get(key), ...row, itemOrderId: key })
  }
  for (const row of batch?.matchedReturns || []) {
    const key = clean(row.itemOrderId)
    if (!key) continue
    const existing = byItem.get(key) || {}
    byItem.set(key, {
      ...existing,
      ...row,
      itemOrderId: key,
      productRefundAmount:
        positiveAmount(row.productRefundAmount) >= TOLERANCE
          ? row.productRefundAmount
          : existing.productRefundAmount,
      creditNoteAmount:
        positiveAmount(row.creditNoteAmount) >= TOLERANCE
          ? row.creditNoteAmount
          : existing.creditNoteAmount,
      zohoInvoiceId: clean(row.zohoInvoiceId) || clean(existing.zohoInvoiceId),
      zohoCreditNoteId: clean(row.zohoCreditNoteId) || clean(existing.zohoCreditNoteId),
    })
  }
  return [...byItem.values()]
}

async function resolvePlanRowAction(row, batch, opts = {}) {
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const undeposited = cfg.undepositedFundsAccount
  const creditNoteId = clean(row.zohoCreditNoteId)
  const invoiceId = clean(row.zohoInvoiceId)
  const refundAmount = resolveProductRefundAmount(row, batch)
  const metadata = batch?.reportSnapshot || batch?.metadata || {}
  const itemOrderId = clean(row.itemOrderId)
  const settlementReference = buildSettlementReference(metadata)
  const entry = buildEntryReference(settlementReference, 'noon_return', itemOrderId)
  const description = buildReturnDescription(
    { itemOrderId, netProceed: -refundAmount },
    metadata,
    'return'
  )

  const baseFields = {
    rowNumber: row.rowNumber,
    itemOrderId,
    parentOrderId: clean(row.parentOrderId),
    productRefundAmount: refundAmount,
    creditNoteAmount: positiveAmount(row.creditNoteAmount),
    zohoInvoiceId: invoiceId,
    zohoInvoiceNumber: row.zohoInvoiceNumber || '',
    zohoCreditNoteId: creditNoteId,
    zohoCreditNoteNumber: row.zohoCreditNoteNumber || '',
    refundAccountCode: undeposited.accountCode,
    refundAccountName: undeposited.accountName,
    referenceNumber: entry.referenceNumber,
    description,
    blockCode: row.blockCode || '',
    blockingReason: row.blockingReason || '',
  }

  if (row.status === 'blocked' || row.creditNoteAction === 'blocked') {
    return {
      ...baseFields,
      action: 'blocked',
      status: 'blocked',
      blockingReason: row.blockingReason || row.blockCode || 'Return credit note matching blocked.',
      refundAmount,
    }
  }

  if (!creditNoteId) {
    return {
      ...baseFields,
      action: 'blocked',
      status: 'blocked',
      blockingReason: 'No Zoho Credit Note found for this return.',
      refundAmount,
    }
  }

  if (!invoiceId) {
    // Zoho CN refund API needs only creditnote_id; invoice link is audit metadata.
    baseFields.zohoInvoiceId = ''
  }

  if (refundAmount <= TOLERANCE) {
    return {
      ...baseFields,
      action: 'blocked',
      status: 'blocked',
      blockingReason: 'Product refund amount is zero.',
      refundAmount,
    }
  }

  const existing = await store.findGroupedPosting(
    batch.batchId,
    PAYMENT_TYPE,
    `${PAYMENT_TYPE}:${itemOrderId}`
  )
  if (existing?.status === 'posted') {
    return {
      ...baseFields,
      action: 'skipped_already_posted',
      status: 'completed',
      refundAmount,
      zohoPaymentId: existing.zohoPaymentId,
    }
  }

  const listRefunds = opts.listRefunds || listCreditNoteRefunds
  const refunded = await creditNoteRefundTotal(creditNoteId, entry.referenceNumber, listRefunds)
  if (refunded >= refundAmount - TOLERANCE) {
    return {
      ...baseFields,
      action: 'skipped_already_refunded',
      status: 'completed',
      refundAmount,
      amountAlreadyRefunded: refunded,
      blockCode: 'RETURN_CREDIT_NOTE_ALREADY_REFUNDED',
    }
  }

  const remaining = round2(refundAmount - refunded)
  const accountId = clean(undeposited.accountId)
  return {
    ...baseFields,
    action: 'refund_existing',
    status: 'ready',
    refundAmount: remaining,
    amountAlreadyRefunded: refunded,
    refundAccountId: accountId,
    zohoRefundRequest: {
      date: opts.paymentDate || zohoPaymentService.todayLocalDate(),
      refund_mode: 'Bank Transfer',
      reference_number: entry.referenceNumber,
      amount: remaining,
      from_account_id: accountId,
      description,
    },
  }
}

async function buildCreditNoteApplyPlan(batch, opts = {}) {
  const rows = collectReturnRowsForApply(batch)
  const planRows = []
  for (const row of rows) {
    planRows.push(await resolvePlanRowAction(row, batch, opts))
  }
  const summary = planRows.reduce(
    (acc, row) => {
      acc.totalRows += 1
      if (row.action === 'skipped_already_refunded' || row.action === 'skipped_already_posted') {
        acc.skipped += 1
      }
      if (row.action === 'refund_existing') acc.refundExisting += 1
      if (row.action === 'blocked') acc.blocked += 1
      acc.totalRefundAmount = round2(acc.totalRefundAmount + num(row.refundAmount))
      return acc
    },
    { totalRows: 0, refundExisting: 0, skipped: 0, blocked: 0, totalRefundAmount: 0 }
  )
  const complete = planRows.every(
    (row) =>
      row.action === 'skipped_already_refunded' ||
      row.action === 'skipped_already_posted' ||
      row.status === 'completed'
  )
  return { planRows, summary, complete, paymentType: PAYMENT_TYPE }
}

async function applyCreditNotesForBatch(batch, opts = {}) {
  const dryRun = opts.dryRun !== false
  const plan = await buildCreditNoteApplyPlan(batch, opts)
  const results = []

  for (const row of plan.planRows) {
    if (row.action === 'blocked') {
      results.push({ ...row, posted: false, error: row.blockingReason })
      continue
    }
    if (row.action === 'skipped_already_refunded' || row.action === 'skipped_already_posted') {
      results.push({ ...row, posted: false, skipped: true })
      continue
    }
    if (row.action !== 'refund_existing') {
      results.push({ ...row, posted: false })
      continue
    }
    if (dryRun) {
      results.push({ ...row, posted: false, dryRun: true })
      continue
    }

    try {
      const refund = await refundCreditNote(row.zohoCreditNoteId, row.zohoRefundRequest)
      await store.insertPosting({
        batchId: batch.batchId,
        invoiceId: row.zohoInvoiceId,
        itemOrderId: row.itemOrderId,
        paymentType: PAYMENT_TYPE,
        postingGroupKey: `${PAYMENT_TYPE}:${row.itemOrderId}`,
        zohoPaymentId: clean(refund?.creditnote_refund_id || refund?.refund_id || refund?.payment_id),
        amount: row.refundAmount,
        accountCode: row.refundAccountCode,
        referenceNumber: row.referenceNumber,
        description: row.description,
        mappingSnapshot: { zohoRefundRequest: row.zohoRefundRequest, zohoResponse: refund },
        status: 'posted',
      })
      results.push({ ...row, posted: true, zohoRefundId: refund })
    } catch (err) {
      results.push({ ...row, posted: false, error: err.message || String(err) })
    }
  }

  return { plan, results, dryRun }
}

function isCreditNoteApplyComplete(batch, plan = null) {
  if (!plan) return false
  const rows = plan.planRows || []
  if (!rows.length) return true
  return rows.every(
    (row) =>
      row.action !== 'refund_existing' &&
      row.action !== 'blocked' &&
      (row.action === 'skipped_already_refunded' ||
        row.action === 'skipped_already_posted' ||
        row.status === 'completed' ||
        row.posted === true)
  )
}

module.exports = {
  PAYMENT_TYPE,
  buildCreditNoteApplyPlan,
  applyCreditNotesForBatch,
  isCreditNoteApplyComplete,
  creditNoteRefundTotal,
  collectReturnRowsForApply,
}
