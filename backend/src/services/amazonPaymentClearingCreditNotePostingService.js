const {
  listCreditNoteInvoiceApplications,
  applyCreditNoteToInvoice,
  createCreditNote,
} = require('../integrations/zoho/zohoBooksClient')
const { matchZohoInvoicesForRows, resolveKsaZohoCustomerId } = require('./amazonPaymentClearingZohoMatcher')
const { buildSettlementReference, buildEntryReference } = require('./amazonPaymentClearingReferenceService')
const { round2 } = require('./amazonPaymentClearingOrderBreakdownService')
const zohoPaymentService = require('./amazonPaymentClearingZohoPaymentService')
const store = require('./amazonPaymentClearingStore')

const TOLERANCE = 0.01
const PAYMENT_TYPE = 'credit_note_apply'

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

function collectReturnRowsForApply(batch) {
  const byOrder = new Map()

  function upsert(row, source) {
    const orderId = clean(row?.orderId)
    if (!orderId) return
    const existing = byOrder.get(orderId) || { orderId, sources: new Set() }
    existing.sources.add(source)
    byOrder.set(orderId, {
      ...existing,
      ...row,
      orderId,
      amazonRefundAmount: positiveAmount(row.amazonRefundAmount ?? row.creditNoteAmount ?? Math.abs(row.amount ?? row.principalTotal)),
      zohoInvoiceId: clean(row.zohoInvoiceId),
      zohoInvoiceNumber: clean(row.zohoInvoiceNumber),
      zohoCreditNoteId: clean(row.zohoCreditNoteId),
      zohoCreditNoteNumber: clean(row.zohoCreditNoteNumber),
      creditNoteAmount: positiveAmount(row.creditNoteAmount),
      creditNoteAction: row.creditNoteAction || existing.creditNoteAction,
      status: row.status || existing.status,
      blockingReason: row.blockingReason || existing.blockingReason || '',
    })
  }

  for (const row of batch?.matchedReturns || []) upsert(row, 'matchedReturns')
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
    if (row?.creditNoteAction === 'ready_to_create' || row?.zohoInvoiceId) upsert(row, 'creditNoteBlockingRows')
  }
  for (const row of batch?.allRows || []) {
    const tx = clean(row?.transactionType).toLowerCase()
    const isReturn = tx.includes('refund') || tx.includes('return') || row?.rowClass === 'refund' || row?.rowClass === 'return'
    if (!isReturn) continue
    upsert(
      {
        orderId: row.orderId,
        amazonRefundAmount: Math.abs(round2(Number(row.amount) || 0)),
        transactionType: row.transactionType,
        amountType: row.amountType,
        amountDescription: row.amountDescription,
        rowClass: row.rowClass,
        category: row.category,
      },
      'allRows'
    )
  }

  return Array.from(byOrder.values())
}

async function refreshReturnRowsFromLiveZoho(batch, rows, opts = {}) {
  if (!rows.length) return rows
  const allRows = Array.isArray(batch?.allRows) ? batch.allRows : []
  const settlementRows = allRows.length
    ? allRows
    : rows.map((row) => ({
        orderId: row.orderId,
        amount: -positiveAmount(row.amazonRefundAmount),
        transactionType: row.transactionType || 'Refund',
        rowClass: row.rowClass || 'refund',
        amountType: row.amountType || 'ItemPrice',
        amountDescription: row.amountDescription || 'Principal',
      }))
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
    return {
      ...row,
      ...fresh,
      amazonRefundAmount: positiveAmount(row.amazonRefundAmount || fresh.amazonRefundAmount),
      creditNoteAmount: positiveAmount(fresh.creditNoteAmount || row.creditNoteAmount),
    }
  })
}

async function invoiceApplicationTotal(creditNoteId, invoiceId, listApplications = listCreditNoteInvoiceApplications) {
  const apps = await listApplications(creditNoteId)
  let total = 0
  for (const row of apps) {
    if (clean(row.invoice_id || row.invoiceId) !== clean(invoiceId)) continue
    total = round2(total + num(row.amount_applied ?? row.amountApplied ?? row.applied_amount))
  }
  return total
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
  const listApplications = opts.listApplications || listCreditNoteInvoiceApplications
  const invoiceId = clean(row.zohoInvoiceId)
  const applyAmount = positiveAmount(row.amazonRefundAmount)
  const settlementReference = buildSettlementReference(batch)
  const entry = buildEntryReference(settlementReference, 'refund_return', `Order ${row.orderId}`)

  if (row.creditNoteAction === 'blocked' || row.status === 'blocked') {
    if (row.creditNoteAction !== 'ready_to_create') {
      return {
        orderId: row.orderId,
        action: 'blocked',
        status: 'blocked',
        blockingReason: row.blockingReason || 'Credit note apply is blocked for this return row.',
        applyAmount,
        zohoInvoiceId: invoiceId,
        zohoInvoiceNumber: row.zohoInvoiceNumber || '',
      }
    }
  }

  if (!invoiceId) {
    return {
      orderId: row.orderId,
      action: 'blocked',
      status: 'blocked',
      blockingReason: 'No Zoho invoice found for this Amazon return order.',
      applyAmount,
    }
  }

  if (applyAmount <= TOLERANCE) {
    return {
      orderId: row.orderId,
      action: 'blocked',
      status: 'blocked',
      blockingReason: 'Amazon refund amount is zero.',
      applyAmount,
      zohoInvoiceId: invoiceId,
    }
  }

  const creditNoteId = clean(row.zohoCreditNoteId)
  if (creditNoteId) {
    const applied = await invoiceApplicationTotal(creditNoteId, invoiceId, listApplications)
    if (applied >= applyAmount - TOLERANCE) {
      return {
        orderId: row.orderId,
        action: 'skipped_already_applied',
        status: 'completed',
        applyAmount,
        amazonRefundAmount: applyAmount,
        amountAlreadyApplied: applied,
        creditNoteAmount: positiveAmount(row.creditNoteAmount),
        zohoInvoiceId: invoiceId,
        zohoInvoiceNumber: row.zohoInvoiceNumber || '',
        zohoCreditNoteId: creditNoteId,
        zohoCreditNoteNumber: row.zohoCreditNoteNumber || '',
        referenceNumber: entry.referenceNumber,
        description: entry.description,
      }
    }
    const remaining = round2(applyAmount - applied)
    return {
      orderId: row.orderId,
      action: 'apply_existing',
      status: 'ready',
      applyAmount: remaining,
      amazonRefundAmount: applyAmount,
      amountAlreadyApplied: applied,
      creditNoteAmount: positiveAmount(row.creditNoteAmount),
      zohoInvoiceId: invoiceId,
      zohoInvoiceNumber: row.zohoInvoiceNumber || '',
      zohoCreditNoteId: creditNoteId,
      zohoCreditNoteNumber: row.zohoCreditNoteNumber || '',
      referenceNumber: entry.referenceNumber,
      description: entry.description,
      zohoApplyRequest: {
        creditNoteId,
        invoices: [{ invoice_id: invoiceId, amount_applied: remaining }],
      },
    }
  }

  if (row.creditNoteAction === 'ready_to_create' || !creditNoteId) {
    const customerId = await resolveKsaZohoCustomerId(opts)
    return {
      orderId: row.orderId,
      action: 'create_and_apply',
      status: 'ready',
      applyAmount,
      amazonRefundAmount: applyAmount,
      creditNoteAmount: 0,
      zohoInvoiceId: invoiceId,
      zohoInvoiceNumber: row.zohoInvoiceNumber || '',
      zohoCustomerId: customerId,
      referenceNumber: entry.referenceNumber,
      description: entry.description,
      zohoCreateRequest: buildCreateCreditNotePayload(row, customerId, opts.paymentDate || zohoPaymentService.todayLocalDate()),
      zohoApplyRequest: {
        invoices: [{ invoice_id: invoiceId, amount_applied: applyAmount }],
      },
    }
  }

  return {
    orderId: row.orderId,
    action: 'blocked',
    status: 'blocked',
    blockingReason: row.blockingReason || 'Unable to determine credit note apply action.',
    applyAmount,
    zohoInvoiceId: invoiceId,
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
      if (row.action === 'skipped_already_applied') acc.skippedAlreadyApplied += 1
      if (row.action === 'apply_existing') acc.applyExisting += 1
      if (row.action === 'create_and_apply') acc.createAndApply += 1
      if (row.action === 'blocked') acc.blocked += 1
      if (row.status === 'completed' || row.action === 'skipped_already_applied') acc.completed += 1
      return acc
    },
    {
      totalRows: 0,
      skippedAlreadyApplied: 0,
      applyExisting: 0,
      createAndApply: 0,
      blocked: 0,
      completed: 0,
    }
  )
  const existingPostings = await store.listPostingsForBatch(batch.batchId).catch(() => [])
  const postedOrders = new Set(
    existingPostings
      .filter((row) => row.paymentType === PAYMENT_TYPE && row.status === 'posted')
      .map((row) => clean(row.orderId))
      .filter(Boolean)
  )
  for (const row of planRows) {
    if (postedOrders.has(clean(row.orderId))) {
      row.action = 'skipped_already_posted'
      row.status = 'completed'
    }
  }
  summary.isComplete =
    !settlementHasReturnApplyWork(batch) ||
    (planRows.length > 0 &&
      summary.blocked === 0 &&
      planRows.every(
        (row) =>
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
    listApplications: options.listApplications,
  })

  const result = {
    success: true,
    dryRun,
    batchId: batch.batchId,
    plan,
    summary: {
      created: 0,
      applied: 0,
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
    if (row.action === 'skipped_already_applied' || row.action === 'skipped_already_posted') {
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
      let creditNoteId = clean(row.zohoCreditNoteId)
      let creditNoteNumber = row.zohoCreditNoteNumber || ''

      if (row.action === 'create_and_apply') {
        const created = await (options.createCreditNote || createCreditNote)(row.zohoCreateRequest)
        creditNoteId = clean(created.creditNoteId)
        creditNoteNumber = created.creditNoteNumber || ''
        result.summary.created += 1
      }

      const applyInvoices = row.action === 'create_and_apply'
        ? row.zohoApplyRequest.invoices
        : row.zohoApplyRequest?.invoices || [{ invoice_id: row.zohoInvoiceId, amount_applied: row.applyAmount }]

      await (options.applyCreditNoteToInvoice || applyCreditNoteToInvoice)(creditNoteId, applyInvoices)
      result.summary.applied += 1

      const posting = await store.insertPosting({
        batchId: batch.batchId,
        invoiceId: row.zohoInvoiceId,
        orderId: row.orderId,
        paymentType: PAYMENT_TYPE,
        postingGroupKey: `APC-${batch.batchId}-cn-${row.orderId}`,
        zohoPaymentId: creditNoteId,
        amount: row.applyAmount,
        accountCode: 'credit_note_application',
        invoiceAllocations: applyInvoices,
        referenceNumber: row.referenceNumber,
        description: row.description,
        mappingSnapshot: {
          action: row.action,
          zohoCreditNoteId: creditNoteId,
          zohoCreditNoteNumber: creditNoteNumber,
        },
        status: 'posted',
      })

      result.rows.push({
        ...row,
        status: 'posted',
        zohoCreditNoteId: creditNoteId,
        zohoCreditNoteNumber: creditNoteNumber,
        postingId: posting?.postingId,
      })
    } catch (err) {
      result.summary.errors += 1
      const errorRow = {
        ...row,
        status: 'error',
        error: err?.message || 'Credit note apply failed',
        code: err?.code || 'CREDIT_NOTE_APPLY_FAILED',
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
  TOLERANCE,
  collectReturnRowsForApply,
  settlementHasReturnApplyWork,
  refreshReturnRowsFromLiveZoho,
  buildCreditNoteApplyPlan,
  applyCreditNotesForBatch,
  isCreditNoteApplyComplete,
  buildCreateCreditNotePayload,
  resolvePlanRowAction,
}
