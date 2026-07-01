const { buildPaymentPreviewFromBatch, PAYMENT_PREVIEW_TOLERANCE } = require('./amazonPaymentClearingPaymentPreviewService')
const { round2 } = require('./amazonPaymentClearingOrderBreakdownService')
const zohoPaymentService = require('./amazonPaymentClearingZohoPaymentService')
const { buildSettlementReference, buildEntryReference } = require('./amazonPaymentClearingReferenceService')
const { isCreditNoteApplyComplete } = require('./amazonPaymentClearingCreditNotePostingService')
const { buildReturnFeePlan, aggregateReturnFeeJournalLines } = require('./amazonPaymentClearingReturnFeeService')
const store = require('./amazonPaymentClearingStore')

const PAYMENT_TYPES = Object.freeze({
  NET_BALANCE: 'net_balance',
  COMMISSION: 'commission',
  SHIPPING_FBA: 'shipping_fba',
})

async function ensureCanPostBatch(batch, paymentPreviewExists, options = {}) {
  const dryRun = options.dryRun !== false
  const allowPosted = options.allowPosted === true
  if (!batch) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  // A real (non-dry-run) post to an already-posted batch is blocked unless the
  // admin explicitly entered force-repost mode. Dry runs stay allowed so a
  // posted batch can still be inspected safely.
  if (batch.status === 'posted' && !dryRun && !allowPosted) {
    const err = new Error('Settlement has already been posted.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_ALREADY_POSTED'
    err.status = 409
    throw err
  }
  const postedButAllowed = batch.status === 'posted' && (dryRun || allowPosted)
  if (batch.status !== 'approved' && !postedButAllowed) {
    const err = new Error('Posting requires an approved settlement batch.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_APPROVED'
    err.status = 422
    throw err
  }
  const diff = Number(batch.reconciliationSummary?.reconciliationDifference) || 0
  if (batch.reconciliationSummary?.reconciliationStatus === 'mismatch' || Math.abs(diff) > PAYMENT_PREVIEW_TOLERANCE) {
    const err = new Error('Posting requires a reconciled settlement batch.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_RECONCILED'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.unmatchedOrders) && batch.unmatchedOrders.length > 0) {
    const err = new Error('Posting requires zero unmatched orders.')
    err.code = 'AMAZON_PAYMENT_CLEARING_UNMATCHED_ORDERS'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.creditNoteBlockingRows) && batch.creditNoteBlockingRows.length > 0) {
    const err = new Error('Posting requires all refund/return rows to have matched Zoho credit notes with clean amounts.')
    err.code = 'AMAZON_PAYMENT_CLEARING_CREDIT_NOTE_BLOCKED'
    err.status = 422
    throw err
  }
  if (!paymentPreviewExists) {
    const err = new Error('Posting requires a generated payment preview.')
    err.code = 'AMAZON_PAYMENT_CLEARING_PAYMENT_PREVIEW_REQUIRED'
    err.status = 422
    throw err
  }
  if (!dryRun) {
    const feeLines = Array.isArray(batch.nonOrderLinkedAmazonFeeMappings) ? batch.nonOrderLinkedAmazonFeeMappings : []
    const unmapped = feeLines.filter((row) => row.mappingStatus === 'needs_mapping')
    if (unmapped.length > 0) {
      const err = new Error('Posting requires all Amazon fee journal mappings to be mapped.')
      err.code = 'AMAZON_PAYMENT_CLEARING_FEE_JOURNAL_UNMAPPED'
      err.status = 422
      err.unmappedFeeTypes = unmapped.map((row) => row.feeType).filter(Boolean)
      throw err
    }
  }
}

async function ensureCanPostReturnFeeJournals(batch, options = {}) {
  const dryRun = options.dryRun !== false
  if (!batch) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (batch.status !== 'posted' && !batch.postedToZoho) {
    const err = new Error('Return fee journals require sales payments to be posted first (step 9).')
    err.code = 'AMAZON_PAYMENT_CLEARING_SALES_NOT_POSTED'
    err.status = 422
    throw err
  }
  if (!dryRun && batch.batchId != null) {
    const cnComplete = await isCreditNoteApplyComplete(batch.batchId, batch)
    if (!cnComplete) {
      const err = new Error('Return fee journals require all return credit notes to be applied in step 10 first.')
      err.code = 'AMAZON_PAYMENT_CLEARING_CREDIT_NOTE_APPLY_REQUIRED'
      err.status = 422
      throw err
    }
    const returnFeePlan = buildReturnFeePlan(batch, batch.allRows || [])
    if ((returnFeePlan.summary?.varianceBlockerCount || 0) > 0) {
      const err = new Error('Return fee journals require variance blockers to be resolved in step 11.')
      err.code = 'AMAZON_PAYMENT_CLEARING_RETURN_FEE_BLOCKED'
      err.status = 422
      throw err
    }
  }
}

async function isReturnFeePostComplete(batchId, batchOverride = null) {
  const batch = batchOverride || await store.getBatchById(batchId)
  if (!batch) return false
  const returnFeePlan = buildReturnFeePlan(batch, batch.allRows || [])
  const returnFeeJournalLines = aggregateReturnFeeJournalLines(returnFeePlan.journalLines || []).filter(
    (row) => row.status === 'ready'
  )
  if (returnFeeJournalLines.length === 0) {
    return (returnFeePlan.summary?.varianceBlockerCount || 0) === 0
  }
  const postings = await store.listPostingsForBatch(batchId).catch(() => [])
  const postedTypes = new Set(
    postings
      .filter((row) => String(row.paymentType || '').startsWith('return_fee_journal_') && row.status === 'posted')
      .map((row) => row.paymentType)
  )
  return returnFeeJournalLines.every((_row, idx) => postedTypes.has(`return_fee_journal_${idx + 1}`))
}

async function postReturnFeeJournalRows({
  batch,
  store,
  dryRun,
  paymentDate,
  createManualJournal,
  buildJournalPayloadPreview,
  result,
}) {
  const returnFeePlan = buildReturnFeePlan(batch, batch.allRows || [])
  const returnFeeJournalLines = aggregateReturnFeeJournalLines(returnFeePlan.journalLines || [])
  for (const [idx, row] of returnFeeJournalLines.entries()) {
    const paymentType = `return_fee_journal_${idx + 1}`
    const existing = await store.findGroupedPosting(batch.batchId, paymentType)
    if (existing) {
      result.summary.journalsSkipped += 1
      result.journals.push({
        ...row,
        paymentType,
        status: 'skipped',
        zohoJournalId: existing.zohoPaymentId,
        reason: 'Already posted for batch/return fee journal.',
      })
      continue
    }

    const journalRequest = {
      feeType: row.feeType,
      description: row.notes || row.feeType,
      amount: Math.abs(round2(Number(row.amount) || 0)),
      debit: row.debit,
      credit: row.credit,
      referenceNumber: row.referenceNumber,
      notes: row.notes,
      date: paymentDate,
    }

    let zohoPayloadPreview = null
    try {
      zohoPayloadPreview = await buildJournalPayloadPreview(journalRequest)
    } catch (err) {
      result.summary.errors += 1
      const error = {
        ...row,
        paymentType,
        status: 'error',
        zohoJournalId: '',
        error: err?.message || 'Failed to build return fee journal payload preview',
        code: err?.code || 'ZOHO_RETURN_FEE_JOURNAL_PREVIEW_FAILED',
      }
      result.errors.push(error)
      result.journals.push(error)
      continue
    }

    if (dryRun) {
      result.journals.push({ ...row, paymentType, status: 'dry_run', zohoJournalId: '', zohoPayloadPreview })
      continue
    }

    try {
      const created = await createManualJournal(journalRequest)
      const mappingSnapshot = {
        normalizedFeeType: row.normalizedFeeType || '',
        feeType: row.feeType || '',
        orderIds: row.orderIds || [],
        sourceAmount: row.amount,
      }
      const posting = await store.insertPosting({
        batchId: batch.batchId,
        invoiceId: null,
        orderId: null,
        paymentType,
        postingGroupKey: `APC-${batch.batchId}-${paymentType}`,
        zohoPaymentId: created.zohoJournalId,
        zohoJournalNumber: created.zohoJournalNumber,
        amount: journalRequest.amount,
        accountCode: row.debit?.accountCode || '',
        invoiceAllocations: (row.orderIds || []).map((orderId) => ({ orderId })),
        referenceNumber: row.referenceNumber,
        description: row.notes,
        notes: row.notes,
        mappingSnapshot,
        status: 'posted',
      })
      result.summary.journalsCreated += 1
      result.journals.push({
        ...row,
        paymentType,
        status: 'created',
        zohoJournalId: posting.zohoPaymentId,
        zohoJournalNumber: posting.zohoJournalNumber || created.zohoJournalNumber,
        mappingSnapshot,
        zohoPayloadPreview,
      })
    } catch (err) {
      result.summary.errors += 1
      const error = {
        ...row,
        paymentType,
        status: 'error',
        error: err?.message || 'Failed to create return fee journal',
        code: err?.code || 'ZOHO_RETURN_FEE_JOURNAL_CREATE_FAILED',
        zohoPayloadPreview,
      }
      result.errors.push(error)
      result.journals.push(error)
    }
  }
}

function flattenPaymentPreview(paymentPreview) {
  const rows = []
  for (const payment of Array.isArray(paymentPreview?.payments) ? paymentPreview.payments : []) {
    rows.push({
      paymentType: PAYMENT_TYPES.NET_BALANCE,
      paymentLabel: 'Net Balance Payment',
      orderId: payment.orderId,
      invoiceId: payment.zohoInvoiceId,
      invoiceNumber: payment.zohoInvoiceNumber,
      amount: payment.netBalancePayment.amount,
      accountCode: payment.netBalancePayment.depositToAccountCode,
      accountName: payment.netBalancePayment.depositToAccountName,
      source: payment,
    })
    rows.push({
      paymentType: PAYMENT_TYPES.COMMISSION,
      paymentLabel: 'Commission Payment',
      orderId: payment.orderId,
      invoiceId: payment.zohoInvoiceId,
      invoiceNumber: payment.zohoInvoiceNumber,
      amount: payment.commissionPayment.amount,
      accountCode: payment.commissionPayment.depositToAccountCode,
      accountName: payment.commissionPayment.depositToAccountName,
      source: payment,
    })
    rows.push({
      paymentType: PAYMENT_TYPES.SHIPPING_FBA,
      paymentLabel: 'Shipping/FBA Payment',
      orderId: payment.orderId,
      invoiceId: payment.zohoInvoiceId,
      invoiceNumber: payment.zohoInvoiceNumber,
      amount: payment.shippingFbaPayment.amount,
      accountCode: payment.shippingFbaPayment.depositToAccountCode,
      accountName: payment.shippingFbaPayment.depositToAccountName,
      source: payment,
    })
  }
  return rows.filter((row) => row.invoiceId && Number(row.amount) > 0)
}

function customerByInvoiceId(batch) {
  const out = new Map()
  for (const order of Array.isArray(batch?.matchedOrders) ? batch.matchedOrders : []) {
    if (order.zohoInvoiceId) {
      out.set(order.zohoInvoiceId, order.zohoCustomerId || order.customerId || '')
    }
  }
  return out
}

function requireSingleCustomer(paymentRows, customerIdsByInvoice) {
  const customerIds = new Set()
  for (const row of paymentRows) {
    const customerId = row.source.customerId || customerIdsByInvoice.get(row.invoiceId) || ''
    if (customerId) customerIds.add(customerId)
  }
  if (customerIds.size > 1) {
    const err = new Error('Grouped Zoho posting requires all invoices to belong to the same customer.')
    err.code = 'AMAZON_PAYMENT_CLEARING_MULTIPLE_CUSTOMERS'
    err.status = 422
    err.customerIds = Array.from(customerIds)
    throw err
  }
  if (customerIds.size === 0) {
    const err = new Error('Grouped Zoho posting requires a Zoho customer ID for the matched invoices.')
    err.code = 'AMAZON_PAYMENT_CLEARING_CUSTOMER_ID_MISSING'
    err.status = 422
    throw err
  }
  return Array.from(customerIds)[0] || ''
}

function groupedPaymentRows(paymentRows, customerId, paymentDate, batch) {
  const batchId = batch?.batchId ?? batch
  const reference = buildSettlementReference(typeof batch === 'object' ? batch : { batchId })
  const groups = new Map()
  for (const row of paymentRows) {
    const key = row.paymentType
    if (!groups.has(key)) {
      groups.set(key, {
        paymentType: row.paymentType,
        paymentLabel: row.paymentLabel,
        orderId: '',
        invoiceId: '',
        invoiceNumber: '',
        amount: 0,
        accountCode: row.accountCode,
        accountName: row.accountName,
        invoiceAllocations: [],
      })
    }
    const group = groups.get(key)
    group.amount = round2(group.amount + row.amount)
    group.invoiceAllocations.push({
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoiceNumber,
      orderId: row.orderId,
      amountApplied: row.amount,
    })
  }
  return Array.from(groups.values()).map((group) => {
    const amount = round2(group.amount)
    const entry = buildEntryReference(reference, group.paymentType)
    return {
      ...group,
      invoiceNumber: `${group.invoiceAllocations.length} invoices`,
      amount,
      entryLabel: entry.entryLabel,
      referenceNumber: entry.referenceNumber,
      description: entry.description,
      settlementReference: reference,
      source: {
        customerId,
        invoices: group.invoiceAllocations,
      },
      zohoPaymentRequest: {
        customerId,
        amount,
        invoices: group.invoiceAllocations,
        depositToAccountCode: group.accountCode,
        depositToAccountName: group.accountName,
        paymentDate,
        referenceNumber: entry.referenceNumber,
        description: entry.description,
      },
    }
  })
}

async function postApprovedBatch({
  batch,
  store,
  dryRun = true,
  allowPosted = false,
  postedBy,
  createPayment = zohoPaymentService.createZohoCustomerPayment,
  buildPayloadPreview = zohoPaymentService.buildCustomerPaymentPayloadPreview,
  createManualJournal = zohoPaymentService.createZohoManualJournal,
  buildJournalPayloadPreview = zohoPaymentService.buildManualJournalPayloadPreview,
}) {
  const latestPreview = await store.getLatestPaymentPreviewForBatch(batch.batchId)
  await ensureCanPostBatch(batch, Boolean(latestPreview), { dryRun, allowPosted })
  const currentPreview = buildPaymentPreviewFromBatch(batch)
  const paymentPreview = {
    batchId: batch.batchId,
    ...currentPreview,
    paymentPreviewId: latestPreview?.paymentPreviewId || null,
    createdAt: latestPreview?.createdAt || null,
  }
  const paymentRows = flattenPaymentPreview(paymentPreview)
  const customerIdsByInvoice = customerByInvoiceId(batch)
  const paymentDate = zohoPaymentService.todayLocalDate()
  const customerId = paymentRows.length ? requireSingleCustomer(paymentRows, customerIdsByInvoice) : ''
  const settlementReference = buildSettlementReference(batch)
  const postingRows = paymentRows.length ? groupedPaymentRows(paymentRows, customerId, paymentDate, batch) : []
  const feeJournalLines = Array.isArray(paymentPreview.amazonFeeJournalLines) ? paymentPreview.amazonFeeJournalLines : []
  const result = {
    success: true,
    dryRun: Boolean(dryRun),
    batchId: batch.batchId,
    status: dryRun ? 'dry_run' : 'posted',
    settlementReference,
    summary: {
      invoicesPosted: new Set(paymentRows.map((row) => row.invoiceId)).size,
      paymentsCreated: 0,
      paymentsSkipped: 0,
      journalsCreated: 0,
      journalsSkipped: 0,
      errors: 0,
    },
    payments: [],
    journals: [],
    errors: [],
  }

  for (const row of postingRows) {
    const existing = await store.findGroupedPosting(batch.batchId, row.paymentType)
    if (existing) {
      result.summary.paymentsSkipped += 1
      result.payments.push({
        ...row,
        status: 'skipped',
        zohoPaymentId: existing.zohoPaymentId,
        reason: 'Already posted for batch/payment type.',
      })
      continue
    }

    const zohoPaymentRequest = row.zohoPaymentRequest

    let zohoPayloadPreview = null
    try {
      zohoPayloadPreview = await buildPayloadPreview(zohoPaymentRequest)
    } catch (err) {
      if (dryRun) {
        result.summary.errors += 1
        const error = {
          ...row,
          status: 'error',
          zohoPaymentId: '',
          error: err?.message || 'Failed to build Zoho payment payload preview',
          code: err?.code || 'ZOHO_PAYMENT_PAYLOAD_PREVIEW_FAILED',
        }
        result.errors.push(error)
        result.payments.push(error)
        continue
      }
    }

    if (dryRun) {
      result.payments.push({ ...row, status: 'dry_run', zohoPaymentId: '', zohoPayloadPreview })
      continue
    }

    try {
      const created = await createPayment(zohoPaymentRequest)
      const posting = await store.insertPosting({
        batchId: batch.batchId,
        invoiceId: null,
        orderId: null,
        paymentType: row.paymentType,
        postingGroupKey: `APC-${batch.batchId}-${row.paymentType}`,
        zohoPaymentId: created.zohoPaymentId,
        amount: row.amount,
        accountCode: row.accountCode,
        invoiceAllocations: row.invoiceAllocations,
        referenceNumber: row.referenceNumber,
        description: row.description,
        status: 'posted',
      })
      result.summary.paymentsCreated += 1
      result.payments.push({ ...row, status: 'created', zohoPaymentId: posting.zohoPaymentId, zohoPayloadPreview })
    } catch (err) {
      result.summary.errors += 1
      const error = {
        ...row,
        status: 'error',
        error: err?.message || 'Failed to create Zoho payment',
        code: err?.code || 'ZOHO_PAYMENT_CREATE_FAILED',
        zohoPayloadPreview,
      }
      result.errors.push(error)
      result.payments.push(error)
    }
  }

  for (const [idx, row] of feeJournalLines.entries()) {
    const paymentType = `fee_journal_${idx + 1}`
    const existing = await store.findGroupedPosting(batch.batchId, paymentType)
    if (existing) {
      result.summary.journalsSkipped += 1
      result.journals.push({
        ...row,
        paymentType,
        status: 'skipped',
        zohoJournalId: existing.zohoPaymentId,
        reason: 'Already posted for batch/fee journal.',
      })
      continue
    }

    const journalRequest = {
      feeType: row.feeType,
      description: row.description,
      amount: Math.abs(round2(Number(row.totalAmount) || 0)),
      debit: row.debit,
      credit: row.credit,
      referenceNumber: row.referenceNumber,
      notes: row.notes,
      date: paymentDate,
    }

    let zohoPayloadPreview = null
    try {
      if (row.mappingStatus === 'needs_mapping') {
        const err = new Error('Amazon fee journal mapping is not mapped.')
        err.code = 'AMAZON_PAYMENT_CLEARING_FEE_JOURNAL_UNMAPPED'
        throw err
      }
      zohoPayloadPreview = await buildJournalPayloadPreview(journalRequest)
    } catch (err) {
      result.summary.errors += 1
      const error = {
        ...row,
        paymentType,
        status: 'error',
        zohoJournalId: '',
        error: err?.message || 'Failed to build Zoho journal payload preview',
        code: err?.code || 'ZOHO_JOURNAL_PAYLOAD_PREVIEW_FAILED',
      }
      result.errors.push(error)
      result.journals.push(error)
      continue
    }

    if (dryRun) {
      result.journals.push({ ...row, paymentType, status: 'dry_run', zohoJournalId: '', zohoPayloadPreview })
      continue
    }

    try {
      const created = await createManualJournal(journalRequest)
      const mappingSnapshot = {
        mappingRuleId: row.mappingRuleId || row.mappingRuleUsed?.id || null,
        mappingRuleUsed: row.mappingRuleUsed || null,
        normalizedFeeType: row.normalizedFeeType || '',
        feeType: row.feeType || '',
        rawTransactionType: row.rawTransactionType || '',
        description: row.description || '',
        debit: row.debit,
        credit: row.credit,
        rowNumbers: row.rowNumbers || [],
        rowCount: row.rowCount || 0,
        sourceAmount: row.totalAmount,
      }
      const posting = await store.insertPosting({
        batchId: batch.batchId,
        invoiceId: null,
        orderId: null,
        paymentType,
        postingGroupKey: `APC-${batch.batchId}-${paymentType}`,
        zohoPaymentId: created.zohoJournalId,
        zohoJournalNumber: created.zohoJournalNumber,
        amount: journalRequest.amount,
        accountCode: row.debit?.accountId || '',
        invoiceAllocations: row.rowNumbers?.map((rowNumber) => ({ rowNumber })) || [],
        referenceNumber: row.referenceNumber,
        description: row.notes,
        notes: row.notes,
        mappingSnapshot,
        status: 'posted',
      })
      if (row.mappingRuleId || row.mappingRuleUsed?.id) {
        await store.markFeeJournalMappingsUsed([row.mappingRuleId || row.mappingRuleUsed.id]).catch(() => {})
      }
      result.summary.journalsCreated += 1
      result.journals.push({
        ...row,
        paymentType,
        status: 'created',
        zohoJournalId: posting.zohoPaymentId,
        zohoJournalNumber: posting.zohoJournalNumber || created.zohoJournalNumber,
        mappingSnapshot,
        zohoPayloadPreview,
      })
    } catch (err) {
      result.summary.errors += 1
      const error = {
        ...row,
        paymentType,
        status: 'error',
        error: err?.message || 'Failed to create Zoho manual journal',
        code: err?.code || 'ZOHO_JOURNAL_CREATE_FAILED',
        zohoPayloadPreview,
      }
      result.errors.push(error)
      result.journals.push(error)
    }
  }

  if (!dryRun && result.summary.errors === 0) {
    const zohoPaymentIds = result.payments
      .filter((row) => row.zohoPaymentId)
      .map((row) => ({
        paymentType: row.paymentType,
        zohoPaymentId: row.zohoPaymentId,
        referenceNumber: row.referenceNumber || '',
      }))
    await store.markBatchPosted(batch.batchId, postedBy, {
      ...result.summary,
      forceRepost: Boolean(allowPosted),
      returnFeeJournalsPosted: 0,
      zohoPaymentIds,
      zohoJournalIds: result.journals
        .filter((row) => row.zohoJournalId)
        .map((row) => ({
          paymentType: row.paymentType,
          zohoJournalId: row.zohoJournalId,
          zohoJournalNumber: row.zohoJournalNumber || '',
          referenceNumber: row.referenceNumber || '',
          notes: row.notes || '',
          mappingSnapshot: row.mappingSnapshot || null,
        })),
      reference: settlementReference.referenceBase,
      settlementReference,
      postedAt: new Date().toISOString(),
    })
  }

  return result
}

async function postReturnFeeJournalsForBatch({
  batch,
  store,
  dryRun = true,
  postedBy,
  createManualJournal = zohoPaymentService.createZohoManualJournal,
  buildJournalPayloadPreview = zohoPaymentService.buildManualJournalPayloadPreview,
}) {
  await ensureCanPostReturnFeeJournals(batch, { dryRun })
  const paymentDate = zohoPaymentService.todayLocalDate()
  const settlementReference = buildSettlementReference(batch)
  const result = {
    success: true,
    dryRun: Boolean(dryRun),
    batchId: batch.batchId,
    status: dryRun ? 'dry_run' : 'posted',
    settlementReference,
    summary: {
      journalsCreated: 0,
      journalsSkipped: 0,
      errors: 0,
    },
    journals: [],
    errors: [],
  }

  await postReturnFeeJournalRows({
    batch,
    store,
    dryRun,
    paymentDate,
    createManualJournal,
    buildJournalPayloadPreview,
    result,
  })

  if (!dryRun && result.summary.errors === 0) {
    const currentBatch = await store.getBatchById(batch.batchId)
    const prevSummary = currentBatch?.postingSummary || {}
    const allPostings = await store.listPostingsForBatch(batch.batchId)
    const zohoJournalIds = allPostings
      .filter((row) => row.zohoPaymentId && String(row.paymentType || '').includes('journal'))
      .map((row) => ({
        paymentType: row.paymentType,
        zohoJournalId: row.zohoPaymentId,
        zohoJournalNumber: row.zohoJournalNumber || '',
        referenceNumber: row.referenceNumber || '',
        notes: row.description || '',
        mappingSnapshot: row.mappingSnapshot || null,
      }))
    await store.markBatchPosted(batch.batchId, postedBy ?? currentBatch?.postedBy ?? null, {
      ...prevSummary,
      returnFeeJournalsPosted: result.journals.filter((row) => row.status === 'created').length,
      zohoJournalIds,
    })
  }

  result.success = result.summary.errors === 0
  return result
}

module.exports = {
  PAYMENT_TYPES,
  ensureCanPostBatch,
  ensureCanPostReturnFeeJournals,
  isReturnFeePostComplete,
  flattenPaymentPreview,
  groupedPaymentRows,
  requireSingleCustomer,
  postApprovedBatch,
  postReturnFeeJournalsForBatch,
}
