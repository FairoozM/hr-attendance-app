const {
  listCreditNoteRefunds,
  createCreditNote,
  refundCreditNote,
} = require('../integrations/zoho/zohoBooksClient')
const { matchZohoInvoicesForRows, resolveKsaZohoCustomerId } = require('./amazonPaymentClearingZohoMatcher')
const { buildSettlementReference, buildEntryReference } = require('./amazonPaymentClearingReferenceService')
const { round2 } = require('./amazonPaymentClearingOrderBreakdownService')
const { buildReturnFeeBreakdown } = require('./amazonPaymentClearingReturnFeeService')
const zohoPaymentService = require('./amazonPaymentClearingZohoPaymentService')
const store = require('./amazonPaymentClearingStore')

const TOLERANCE = 0.01
const PAYMENT_TYPE = 'credit_note_refund'
const LEGACY_PAYMENT_TYPE = 'credit_note_apply'
const UNDEPOSITED_ACCOUNT_CODE = '1024'
const UNDEPOSITED_ACCOUNT_NAME = 'KSA-Amazon Undeposited Funds'

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function positiveAmount(value) {
  return Math.abs(round2(num(value)))
}

function isRefundLikeRow(row) {
  const tx = clean(row?.transactionType).toLowerCase()
  return tx.includes('refund') || tx.includes('return') || row?.rowClass === 'refund' || row?.rowClass === 'return'
}

function principalRefundAmountForOrder(orderId, allRows) {
  const orderRows = (Array.isArray(allRows) ? allRows : []).filter(
    (row) => clean(row?.orderId) === clean(orderId) && isRefundLikeRow(row)
  )
  if (!orderRows.length) return 0
  const breakdown = buildReturnFeeBreakdown(orderRows)
  return positiveAmount(breakdown.customerRefundAmount)
}

function resolveAmazonRefundAmount(row, allRows) {
  const orderId = clean(row?.orderId)
  const fromPrincipal = orderId ? principalRefundAmountForOrder(orderId, allRows) : 0
  if (fromPrincipal > TOLERANCE) return fromPrincipal
  return positiveAmount(row.amazonRefundAmount ?? row.creditNoteAmount ?? Math.abs(row.amount ?? row.principalTotal))
}

function resolveCreditNoteApplyAmount(row) {
  const creditNoteAmount = positiveAmount(row.creditNoteAmount)
  const amazonPrincipal = positiveAmount(row.amazonRefundAmount)
  if (creditNoteAmount > TOLERANCE) return creditNoteAmount
  return amazonPrincipal
}

function settlementHasReturnApplyWork(batch) {
  if ((batch?.refundReturnRows || []).length > 0) return true
  if ((batch?.matchedReturns || []).length > 0) return true
  if ((batch?.netNegativeReturnOrders || []).length > 0) return true
  if ((batch?.creditNoteBlockingRows || []).some((row) => row?.orderId)) return true
  return (batch?.allRows || []).some((row) => {
    const tx = clean(row?.transactionType).toLowerCase()
    return Boolean(clean(row?.orderId)) && (tx.includes('refund') || tx.includes('return') || row?.rowClass === 'refund' || row?.rowClass === 'return')
  })
}

function buildSettlementRowsForZohoRematch(batch, rows) {
  const settlementRows = Array.isArray(batch?.allRows) ? [...batch.allRows] : []
  const refundOrders = new Set(
    settlementRows.filter((row) => isRefundLikeRow(row) && clean(row.orderId)).map((row) => clean(row.orderId))
  )
  for (const row of rows) {
    const orderId = clean(row.orderId)
    if (!orderId || refundOrders.has(orderId)) continue
    refundOrders.add(orderId)
    settlementRows.push({
      orderId,
      amount: -positiveAmount(row.amazonRefundAmount),
      transactionType: row.transactionType || 'Refund',
      rowClass: row.rowClass || 'refund',
      category: row.category || 'Refund',
      amountType: row.amountType || 'ItemPrice',
      amountDescription: row.amountDescription || 'Principal',
    })
  }
  return settlementRows
}

function buildBlockedPlanRow(row, batch, opts = {}) {
  const invoiceId = clean(row.zohoInvoiceId)
  const creditNoteId = clean(row.zohoCreditNoteId)
  const applyAmount = creditNoteId ? resolveCreditNoteApplyAmount(row) : positiveAmount(row.amazonRefundAmount)
  const settlementReference = buildSettlementReference(batch)
  const entry = buildEntryReference(settlementReference, 'refund_return', `Order ${row.orderId}`)
  return {
    orderId: row.orderId,
    action: 'blocked',
    status: 'blocked',
    blockingReason: row.blockingReason || 'Credit note apply is blocked for this return row.',
    applyAmount,
    amazonRefundAmount: positiveAmount(row.amazonRefundAmount),
    creditNoteAmount: positiveAmount(row.creditNoteAmount),
    zohoInvoiceId: invoiceId,
    zohoInvoiceNumber: row.zohoInvoiceNumber || '',
    zohoCreditNoteId: creditNoteId,
    zohoCreditNoteNumber: row.zohoCreditNoteNumber || '',
    referenceNumber: entry.referenceNumber,
    description: entry.description,
  }
}

function collectReturnRowsForApply(batch) {
  const byOrder = new Map()
  const allRows = Array.isArray(batch?.allRows) ? batch.allRows : []

  function upsert(row, source) {
    const orderId = clean(row?.orderId)
    if (!orderId) return
    const existing = byOrder.get(orderId) || { orderId, sources: new Set() }
    existing.sources.add(source)
    byOrder.set(orderId, {
      ...existing,
      ...row,
      orderId,
      amazonRefundAmount: resolveAmazonRefundAmount({ ...existing, ...row }, allRows),
      zohoInvoiceId: clean(row.zohoInvoiceId) || clean(existing.zohoInvoiceId),
      zohoInvoiceNumber: clean(row.zohoInvoiceNumber) || clean(existing.zohoInvoiceNumber),
      zohoCreditNoteId: clean(row.zohoCreditNoteId) || clean(existing.zohoCreditNoteId),
      zohoCreditNoteNumber: clean(row.zohoCreditNoteNumber) || clean(existing.zohoCreditNoteNumber),
      creditNoteAmount: positiveAmount(row.creditNoteAmount || existing.creditNoteAmount),
      creditNoteAction: row.creditNoteAction || existing.creditNoteAction,
      status: row.status || existing.status,
      blockingReason: row.blockingReason || existing.blockingReason || '',
    })
  }

  for (const row of batch?.refundReturnRows || []) upsert(row, 'refundReturnRows')
  for (const row of batch?.netNegativeReturnOrders || []) {
    upsert(
      {
        orderId: row.orderId,
        amazonRefundAmount: Math.abs(round2(Number(row.principalTotal) || 0)),
        zohoInvoiceId: row.zohoInvoiceId,
        zohoInvoiceNumber: row.zohoInvoiceNumber,
        zohoPoNumber: row.zohoPoNumber,
        zohoCreditNoteId: row.zohoCreditNoteId,
        zohoCreditNoteNumber: row.zohoCreditNoteNumber,
        creditNoteAction: row.creditNoteAction,
        status: row.status,
        blockingReason: row.blockingReason,
      },
      'netNegativeReturnOrders'
    )
  }
  for (const row of batch?.creditNoteBlockingRows || []) {
    const orderId = clean(row?.orderId)
    if (!orderId) continue
    const existing = byOrder.get(orderId)
    if (existing?.status === 'matched' || clean(existing?.zohoCreditNoteId)) continue
    if (row?.creditNoteAction === 'ready_to_create' || row?.zohoInvoiceId) upsert(row, 'creditNoteBlockingRows')
  }
  for (const row of batch?.allRows || []) {
    if (!isRefundLikeRow(row)) continue
    upsert(
      {
        orderId: row.orderId,
        transactionType: row.transactionType,
        amountType: row.amountType,
        amountDescription: row.amountDescription,
        rowClass: row.rowClass,
        category: row.category,
      },
      'allRows'
    )
  }
  for (const row of batch?.matchedReturns || []) upsert(row, 'matchedReturns')

  return Array.from(byOrder.values()).map((row) => ({
    ...row,
    amazonRefundAmount: resolveAmazonRefundAmount(row, allRows),
  }))
}

async function refreshReturnRowsFromLiveZoho(batch, rows, opts = {}) {
  if (!rows.length) return rows
  const settlementRows = buildSettlementRowsForZohoRematch(batch, rows)
  const zohoMatch = await matchZohoInvoicesForRows(settlementRows, opts)
  const freshByOrder = new Map()
  for (const row of zohoMatch.matchedReturns || []) {
    freshByOrder.set(clean(row.orderId), row)
  }
  for (const row of zohoMatch.creditNoteBlockingRows || []) {
    const orderId = clean(row.orderId)
    if (orderId && !freshByOrder.has(orderId)) freshByOrder.set(orderId, row)
  }
  return rows.map((row) => {
    const fresh = freshByOrder.get(clean(row.orderId))
    if (!fresh) return row
    const creditNoteId = clean(fresh.zohoCreditNoteId) || clean(row.zohoCreditNoteId)
    const resolvedStatus =
      creditNoteId && fresh.status === 'blocked' && (fresh.creditNoteAction === 'matched_existing' || positiveAmount(fresh.creditNoteAmount) > 0)
        ? 'matched'
        : fresh.status || row.status
    return {
      ...row,
      ...fresh,
      amazonRefundAmount: positiveAmount(fresh.amazonRefundAmount || row.amazonRefundAmount),
      creditNoteAmount: positiveAmount(fresh.creditNoteAmount || row.creditNoteAmount),
      zohoCreditNoteId: creditNoteId,
      zohoCreditNoteNumber: clean(fresh.zohoCreditNoteNumber) || clean(row.zohoCreditNoteNumber),
      creditNoteAction:
        creditNoteId && resolvedStatus === 'matched' ? 'matched_existing' : fresh.creditNoteAction || row.creditNoteAction,
      status: resolvedStatus,
      blockingReason: resolvedStatus === 'matched' ? '' : fresh.blockingReason || row.blockingReason || '',
    }
  })
}

function resolveCreditNoteRefundAmount(row) {
  return resolveCreditNoteApplyAmount(row)
}

async function resolveUndepositedRefundAccount(opts = {}) {
  const resolver = opts.resolveDepositAccount || zohoPaymentService.resolveConfiguredDepositAccount
  return resolver({
    depositToAccountCode: UNDEPOSITED_ACCOUNT_CODE,
    depositToAccountName: UNDEPOSITED_ACCOUNT_NAME,
  })
}

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

async function buildRefundCreditNoteRequest(row, batch, opts = {}) {
  const paymentDate = opts.paymentDate || zohoPaymentService.todayLocalDate()
  const settlementReference = buildSettlementReference(batch)
  const entry = buildEntryReference(settlementReference, 'refund_return', `Order ${row.orderId}`)
  const account = await resolveUndepositedRefundAccount(opts)
  const amount = resolveCreditNoteRefundAmount(row)
  return {
    amount,
    paymentDate,
    referenceNumber: entry.referenceNumber,
    description: entry.description,
    settlementReference,
    refundAccountCode: UNDEPOSITED_ACCOUNT_CODE,
    refundAccountName: account.accountName || UNDEPOSITED_ACCOUNT_NAME,
    refundAccountId: account.accountId,
    zohoRefundRequest: {
      date: paymentDate,
      refund_mode: 'Bank Transfer',
      reference_number: entry.referenceNumber,
      amount,
      from_account_id: account.accountId,
      description: entry.description,
    },
  }
}

function buildCreateCreditNotePayload(row, customerId, paymentDate) {
  const orderId = clean(row.orderId)
  const amount = positiveAmount(row.amazonRefundAmount)
  return {
    customer_id: customerId,
    date: paymentDate,
    reference_number: orderId,
    line_items: [
      {
        name: `Amazon KSA return ${orderId}`,
        description: `Amazon KSA return ${orderId}`,
        rate: amount,
        quantity: 1,
      },
    ],
  }
}

async function resolvePlanRowAction(row, batch, opts = {}) {
  const listRefunds = opts.listRefunds || listCreditNoteRefunds
  const invoiceId = clean(row.zohoInvoiceId)
  const creditNoteId = clean(row.zohoCreditNoteId)
  const refundAmount = creditNoteId ? resolveCreditNoteRefundAmount(row) : positiveAmount(row.amazonRefundAmount)
  const settlementReference = buildSettlementReference(batch)
  const entry = buildEntryReference(settlementReference, 'refund_return', `Order ${row.orderId}`)

  const baseFields = {
    orderId: row.orderId,
    amazonRefundAmount: positiveAmount(row.amazonRefundAmount),
    creditNoteAmount: positiveAmount(row.creditNoteAmount),
    zohoInvoiceId: invoiceId,
    zohoInvoiceNumber: row.zohoInvoiceNumber || '',
    zohoCreditNoteId: creditNoteId,
    zohoCreditNoteNumber: row.zohoCreditNoteNumber || '',
    refundAccountCode: UNDEPOSITED_ACCOUNT_CODE,
    refundAccountName: UNDEPOSITED_ACCOUNT_NAME,
    referenceNumber: entry.referenceNumber,
    description: entry.description,
  }

  if (!invoiceId) {
    return {
      ...baseFields,
      action: 'blocked',
      status: 'blocked',
      blockingReason: 'No Zoho invoice found for this Amazon return order.',
      applyAmount: refundAmount,
      refundAmount,
    }
  }

  if (refundAmount <= TOLERANCE && !creditNoteId) {
    return {
      ...baseFields,
      action: 'blocked',
      status: 'blocked',
      blockingReason: 'Amazon refund amount is zero.',
      applyAmount: refundAmount,
      refundAmount,
    }
  }

  if (creditNoteId) {
    const refunded = await creditNoteRefundTotal(creditNoteId, entry.referenceNumber, listRefunds)
    if (refunded >= refundAmount - TOLERANCE) {
      return {
        ...baseFields,
        action: 'skipped_already_refunded',
        status: 'completed',
        applyAmount: refundAmount,
        refundAmount,
        amountAlreadyRefunded: refunded,
      }
    }
    const remaining = round2(refundAmount - refunded)
    const refundRequest = await buildRefundCreditNoteRequest({ ...row, creditNoteAmount: refundAmount }, batch, opts)
    return {
      ...baseFields,
      action: 'refund_existing',
      status: 'ready',
      applyAmount: remaining,
      refundAmount: remaining,
      amountAlreadyRefunded: refunded,
      refundAccountId: refundRequest.refundAccountId,
      zohoRefundRequest: {
        ...refundRequest.zohoRefundRequest,
        amount: remaining,
      },
    }
  }

  if (row.creditNoteAction === 'ready_to_create') {
    const customerId = await resolveKsaZohoCustomerId(opts)
    const paymentDate = opts.paymentDate || zohoPaymentService.todayLocalDate()
  return {
      ...baseFields,
      action: 'create_and_refund',
      status: 'ready',
      applyAmount: refundAmount,
      refundAmount,
      zohoCustomerId: customerId,
      zohoCreateRequest: buildCreateCreditNotePayload(row, customerId, paymentDate),
      zohoRefundRequest: (await buildRefundCreditNoteRequest(row, batch, { ...opts, paymentDate })).zohoRefundRequest,
    }
  }

  return {
    ...buildBlockedPlanRow(row, batch, opts),
    refundAmount: refundAmount,
    refundAccountCode: UNDEPOSITED_ACCOUNT_CODE,
    refundAccountName: UNDEPOSITED_ACCOUNT_NAME,
  }
}

async function buildCreditNoteApplyPlan(batch, opts = {}) {
  let rows = collectReturnRowsForApply(batch)
  if (opts.refreshZoho !== false && rows.length > 0) {
    rows = await refreshReturnRowsFromLiveZoho(batch, rows, opts)
  }
  const planRows = []
  for (const row of rows) {
    planRows.push(await resolvePlanRowAction(row, batch, opts))
  }

  const summary = planRows.reduce(
    (acc, row) => {
      acc.totalRows += 1
      if (row.action === 'skipped_already_refunded' || row.action === 'skipped_already_applied') acc.skippedAlreadyRefunded += 1
      if (row.action === 'refund_existing' || row.action === 'apply_existing') acc.refundExisting += 1
      if (row.action === 'create_and_refund' || row.action === 'create_and_apply') acc.createAndRefund += 1
      if (row.action === 'blocked') acc.blocked += 1
      if (row.status === 'completed' || row.action === 'skipped_already_refunded' || row.action === 'skipped_already_applied') {
        acc.completed += 1
      }
      return acc
    },
    {
      totalRows: 0,
      skippedAlreadyRefunded: 0,
      refundExisting: 0,
      createAndRefund: 0,
      blocked: 0,
      completed: 0,
    }
  )
  const existingPostings = await store.listPostingsForBatch(batch.batchId).catch(() => [])
  const postedOrders = new Set(
    existingPostings
      .filter((row) => (row.paymentType === PAYMENT_TYPE || row.paymentType === LEGACY_PAYMENT_TYPE) && row.status === 'posted')
      .map((row) => clean(row.orderId))
      .filter(Boolean)
  )
  for (const row of planRows) {
    if (postedOrders.has(clean(row.orderId))) {
      row.action = 'skipped_already_posted'
      row.status = 'completed'
    }
  }
  summary.skippedAlreadyApplied = summary.skippedAlreadyRefunded
  summary.applyExisting = summary.refundExisting
  summary.createAndApply = summary.createAndRefund
  summary.isComplete =
    !settlementHasReturnApplyWork(batch) ||
    (planRows.length > 0 &&
      summary.blocked === 0 &&
      planRows.every(
        (row) =>
          row.action === 'skipped_already_refunded' ||
          row.action === 'skipped_already_applied' ||
          row.action === 'skipped_already_posted' ||
          row.status === 'posted' ||
          row.status === 'completed'
      ))

  return {
    batchId: batch.batchId,
    rows: planRows,
    summary,
  }
}

async function isCreditNoteApplyComplete(batchId, batchOverride = null) {
  const batch = batchOverride || await store.getBatchById(batchId)
  if (!batch) return false
  const returnCount = collectReturnRowsForApply(batch).length
  if (returnCount === 0) return !settlementHasReturnApplyWork(batch)
  const plan = await buildCreditNoteApplyPlan(batch)
  return Boolean(plan.summary?.isComplete)
}

async function applyCreditNotesForBatch(batch, options = {}) {
  const dryRun = options.dryRun !== false
  const plan = await buildCreditNoteApplyPlan(batch, {
    paymentDate: options.paymentDate || zohoPaymentService.todayLocalDate(),
    listRefunds: options.listRefunds,
    resolveDepositAccount: options.resolveDepositAccount,
  })

  const result = {
    success: true,
    dryRun,
    batchId: batch.batchId,
    plan,
    summary: {
      created: 0,
      applied: 0,
      refunded: 0,
      skipped: 0,
      errors: 0,
    },
    rows: [],
    errors: [],
  }

  if (dryRun) {
    return result
  }

  for (const row of plan.rows) {
    if (
      row.action === 'skipped_already_refunded' ||
      row.action === 'skipped_already_applied' ||
      row.action === 'skipped_already_posted'
    ) {
      result.summary.skipped += 1
      result.rows.push({ ...row, status: 'skipped' })
      continue
    }
    if (row.action === 'blocked') {
      result.summary.errors += 1
      result.errors.push(row)
      result.rows.push({ ...row, status: 'error' })
      continue
    }

    try {
      const existingPosting =
        (row.zohoInvoiceId &&
          (await store.findPosting(batch.batchId, row.zohoInvoiceId, PAYMENT_TYPE))) ||
        (row.zohoInvoiceId &&
          (await store.findPosting(batch.batchId, row.zohoInvoiceId, LEGACY_PAYMENT_TYPE)))
      if (existingPosting?.status === 'posted') {
        result.summary.skipped += 1
        result.rows.push({ ...row, status: 'skipped', postingId: existingPosting.postingId })
        continue
      }

      let creditNoteId = clean(row.zohoCreditNoteId)
      let creditNoteNumber = row.zohoCreditNoteNumber || ''

      if (row.action === 'create_and_refund' || row.action === 'create_and_apply') {
        const created = await (options.createCreditNote || createCreditNote)(row.zohoCreateRequest)
        creditNoteId = clean(created.creditNoteId)
        creditNoteNumber = created.creditNoteNumber || ''
        result.summary.created += 1
      }

      const refundPayload = row.zohoRefundRequest || {
        date: options.paymentDate || zohoPaymentService.todayLocalDate(),
        amount: row.refundAmount ?? row.applyAmount,
        reference_number: row.referenceNumber,
        description: row.description,
        from_account_id: row.refundAccountId,
      }

      const refunded = await (options.refundCreditNote || refundCreditNote)(creditNoteId, refundPayload)
      result.summary.refunded += 1
      result.summary.applied += 1

      const posting = await store.insertPosting({
        batchId: batch.batchId,
        invoiceId: row.zohoInvoiceId,
        orderId: row.orderId,
        paymentType: PAYMENT_TYPE,
        zohoPaymentId: refunded.creditNoteRefundId || creditNoteId,
        amount: row.refundAmount ?? row.applyAmount,
        accountCode: row.refundAccountCode || UNDEPOSITED_ACCOUNT_CODE,
        invoiceAllocations: [],
        referenceNumber: row.referenceNumber,
        description: row.description,
        mappingSnapshot: {
          action: row.action,
          zohoCreditNoteId: creditNoteId,
          zohoCreditNoteNumber: creditNoteNumber,
          zohoCreditNoteRefundId: refunded.creditNoteRefundId || '',
          refundAccountId: refundPayload.from_account_id || row.refundAccountId || '',
          refundAccountName: row.refundAccountName || UNDEPOSITED_ACCOUNT_NAME,
        },
        status: 'posted',
      })

      result.rows.push({
        ...row,
        status: 'posted',
        zohoCreditNoteId: creditNoteId,
        zohoCreditNoteNumber: creditNoteNumber,
        zohoCreditNoteRefundId: refunded.creditNoteRefundId || '',
        postingId: posting?.postingId,
      })
    } catch (err) {
      result.summary.errors += 1
      const errorRow = {
        ...row,
        status: 'error',
        error: err?.message || 'Credit note refund failed',
        code: err?.code || 'CREDIT_NOTE_REFUND_FAILED',
      }
      result.errors.push(errorRow)
      result.rows.push(errorRow)
    }
  }

  result.success = result.summary.errors === 0
  return result
}

module.exports = {
  PAYMENT_TYPE,
  LEGACY_PAYMENT_TYPE,
  UNDEPOSITED_ACCOUNT_CODE,
  UNDEPOSITED_ACCOUNT_NAME,
  TOLERANCE,
  collectReturnRowsForApply,
  settlementHasReturnApplyWork,
  refreshReturnRowsFromLiveZoho,
  buildCreditNoteApplyPlan,
  applyCreditNotesForBatch,
  isCreditNoteApplyComplete,
  buildCreateCreditNotePayload,
  buildRefundCreditNoteRequest,
  resolvePlanRowAction,
  resolveAmazonRefundAmount,
  resolveCreditNoteApplyAmount,
  resolveCreditNoteRefundAmount,
  principalRefundAmountForOrder,
  creditNoteRefundTotal,
}
