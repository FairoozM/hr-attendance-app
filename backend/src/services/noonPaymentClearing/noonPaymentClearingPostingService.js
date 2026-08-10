const zohoPaymentService = require('../amazonPaymentClearingZohoPaymentService')
const { round2, clean } = require('./noonPaymentClearingCategoryService')
const { buildPaymentPreviewFromBatch, PAYMENT_PREVIEW_TOLERANCE } = require('./noonPaymentClearingPaymentPreviewService')
const { isNoonSettlementReconciliationAcceptable } = require('./noonPaymentClearingReconciliationService')
const { buildSettlementReference, buildEntryReference } = require('./noonPaymentClearingReferenceService')
const store = require('./noonPaymentClearingStore')

const PAYMENT_TYPES = Object.freeze({
  NET_BALANCE: 'net_balance',
  COMMISSION: 'commission',
  FULFILLMENT_SHIPPING: 'fulfillment_shipping',
})

async function ensureCanPostBatch(batch, paymentPreviewExists, options = {}) {
  const dryRun = options.dryRun !== false
  const allowPosted = options.allowPosted === true
  if (!batch) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (batch.status === 'posted' && !dryRun && !allowPosted) {
    const err = new Error('Noon statement has already been posted.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_ALREADY_POSTED'
    err.status = 409
    throw err
  }
  const postedButAllowed = batch.status === 'posted' && (dryRun || allowPosted)
  if (batch.status !== 'approved' && !postedButAllowed) {
    const err = new Error('Posting requires an approved Noon statement batch.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_APPROVED'
    err.status = 422
    throw err
  }
  if (!isNoonSettlementReconciliationAcceptable(batch.reconciliationSummary, PAYMENT_PREVIEW_TOLERANCE)) {
    const err = new Error('Posting requires a reconciled Noon statement batch.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_RECONCILED'
    err.status = 422
    throw err
  }
  if (Array.isArray(batch.unmatchedOrders) && batch.unmatchedOrders.length > 0) {
    const err = new Error('Posting requires zero unmatched item orders.')
    err.code = 'NOON_PAYMENT_CLEARING_UNMATCHED_ORDERS'
    err.status = 422
    throw err
  }
  if (!paymentPreviewExists) {
    const err = new Error('Posting requires a generated payment preview.')
    err.code = 'NOON_PAYMENT_CLEARING_PAYMENT_PREVIEW_REQUIRED'
    err.status = 422
    throw err
  }
  const feeLines = Array.isArray(options.feeJournalLines)
    ? options.feeJournalLines
    : Array.isArray(batch.feeJournalLines)
      ? batch.feeJournalLines
      : []
  if (!dryRun) {
    const unmapped = feeLines.filter((row) => row.mappingStatus === 'needs_mapping')
    if (unmapped.length > 0) {
      const err = new Error('Posting requires all Noon fee journal mappings to be mapped.')
      err.code = 'NOON_PAYMENT_CLEARING_FEE_JOURNAL_UNMAPPED'
      err.status = 422
      throw err
    }
  }
}

function flattenInvoicePayments(paymentPreview) {
  const rows = []
  for (const payment of Array.isArray(paymentPreview?.invoicePayments) ? paymentPreview.invoicePayments : []) {
    if (!payment.zohoInvoiceId) continue
    if (payment.netBalancePayment?.amount > 0) {
      rows.push({
        paymentType: PAYMENT_TYPES.NET_BALANCE,
        itemOrderId: payment.itemOrderId,
        invoiceId: payment.zohoInvoiceId,
        invoiceNumber: payment.zohoInvoiceNumber,
        amount: payment.netBalancePayment.amount,
        accountCode: payment.netBalancePayment.depositToAccountCode,
        accountName: payment.netBalancePayment.depositToAccountName,
        accountId: payment.netBalancePayment.depositToAccountId,
        customerId: payment.customerId,
      })
    }
    if (payment.commissionPayment?.amount > 0) {
      rows.push({
        paymentType: PAYMENT_TYPES.COMMISSION,
        itemOrderId: payment.itemOrderId,
        invoiceId: payment.zohoInvoiceId,
        invoiceNumber: payment.zohoInvoiceNumber,
        amount: payment.commissionPayment.amount,
        accountCode: payment.commissionPayment.depositToAccountCode,
        accountName: payment.commissionPayment.depositToAccountName,
        accountId: payment.commissionPayment.depositToAccountId,
        customerId: payment.customerId,
      })
    }
    if (payment.fulfillmentPayment?.amount > 0) {
      rows.push({
        paymentType: PAYMENT_TYPES.FULFILLMENT_SHIPPING,
        itemOrderId: payment.itemOrderId,
        invoiceId: payment.zohoInvoiceId,
        invoiceNumber: payment.zohoInvoiceNumber,
        amount: payment.fulfillmentPayment.amount,
        accountCode: payment.fulfillmentPayment.depositToAccountCode,
        accountName: payment.fulfillmentPayment.depositToAccountName,
        accountId: payment.fulfillmentPayment.depositToAccountId,
        customerId: payment.customerId,
      })
    }
  }
  return rows
}

function groupPayments(rows, customerId, paymentDate, metadata) {
  const groups = new Map()
  for (const row of rows) {
    if (!groups.has(row.paymentType)) {
      groups.set(row.paymentType, {
        paymentType: row.paymentType,
        amount: 0,
        accountCode: row.accountCode,
        accountName: row.accountName,
        accountId: row.accountId,
        invoiceAllocations: [],
      })
    }
    const g = groups.get(row.paymentType)
    g.amount = round2(g.amount + row.amount)
    g.invoiceAllocations.push({
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoiceNumber,
      orderId: row.itemOrderId,
      amountApplied: row.amount,
    })
  }
  return Array.from(groups.values()).map((group) => {
    const referenceNumber = buildEntryReference(metadata, group.paymentType)
    return {
      ...group,
      postingGroupKey: group.paymentType,
      referenceNumber,
      description: `${buildSettlementReference(metadata)} ${group.paymentType}`,
      zohoPaymentRequest: {
        customerId,
        amount: group.amount,
        invoices: group.invoiceAllocations,
        depositToAccountCode: group.accountCode,
        depositToAccountName: group.accountName,
        depositToAccountId: group.accountId,
        paymentDate,
        referenceNumber,
        description: `${buildSettlementReference(metadata)} ${group.paymentType}`,
      },
    }
  })
}

async function postApprovedBatch({
  batch,
  dryRun = true,
  allowPosted = false,
  postedBy,
  mappingRules = [],
  settlementBridgeAccount = null,
  inputVatAccount = null,
  createPayment = zohoPaymentService.createZohoCustomerPayment,
  buildPayloadPreview = zohoPaymentService.buildCustomerPaymentPayloadPreview,
  createManualJournal = zohoPaymentService.createZohoManualJournal,
  buildJournalPayloadPreview = zohoPaymentService.buildManualJournalPayloadPreview,
} = {}) {
  const latestPreview = await store.getLatestPaymentPreviewForBatch(batch.batchId)
  const paymentPreview = buildPaymentPreviewFromBatch(batch, mappingRules, inputVatAccount)
  await ensureCanPostBatch(batch, Boolean(latestPreview), {
    dryRun,
    allowPosted,
    feeJournalLines: paymentPreview.feeJournalLines,
  })
  const paymentRows = flattenInvoicePayments(paymentPreview)
  const customerId =
    clean(batch.zohoCustomerId) ||
    clean(paymentRows[0]?.customerId) ||
    ''
  if (paymentRows.length && !customerId) {
    const err = new Error('Grouped Zoho posting requires a Zoho customer ID.')
    err.code = 'NOON_PAYMENT_CLEARING_CUSTOMER_ID_MISSING'
    err.status = 422
    throw err
  }
  const paymentDate = zohoPaymentService.todayLocalDate()
  const metadata = batch.reportSnapshot || batch.metadata || {}
  const postingRows = paymentRows.length ? groupPayments(paymentRows, customerId, paymentDate, metadata) : []
  const feeJournalLines = Array.isArray(paymentPreview.feeJournalLines) ? paymentPreview.feeJournalLines : []
  const settlementReference = buildSettlementReference(metadata)
  const result = {
    success: true,
    dryRun: Boolean(dryRun),
    batchId: batch.batchId,
    status: dryRun ? 'dry_run' : 'posted',
    settlementReference,
    summary: {
      invoicesPosted: new Set(paymentRows.map((r) => r.invoiceId)).size,
      paymentsCreated: 0,
      paymentsSkipped: 0,
      journalsCreated: 0,
      journalsSkipped: 0,
      errors: 0,
    },
    payments: [],
    journals: [],
    errors: [],
    zohoPaymentIds: [],
    zohoJournalIds: [],
  }

  const run = async () => {
    for (const row of postingRows) {
      const existing = await store.findGroupedPosting(batch.batchId, row.paymentType)
      if (existing && existing.status === 'posted') {
        result.summary.paymentsSkipped += 1
        result.payments.push({
          ...row,
          status: 'skipped',
          zohoPaymentId: existing.zohoPaymentId,
          reason: 'Already posted for batch/payment type.',
        })
        continue
      }
      let zohoPayloadPreview = null
      try {
        zohoPayloadPreview = await buildPayloadPreview(row.zohoPaymentRequest)
      } catch (err) {
        result.summary.errors += 1
        const error = {
          ...row,
          status: 'error',
          error: err?.message || 'Failed to build payment payload',
          code: err?.code || 'ZOHO_PAYMENT_PREVIEW_FAILED',
        }
        result.errors.push(error)
        result.payments.push(error)
        continue
      }
      if (dryRun) {
        result.summary.paymentsCreated += 1
        result.payments.push({ ...row, status: 'dry_run', zohoPaymentId: '', zohoPayloadPreview })
        continue
      }
      try {
        const created = await createPayment(row.zohoPaymentRequest)
        const zohoPaymentId = clean(created?.payment_id || created?.paymentId || created?.id)
        await store.insertPosting({
          batchId: batch.batchId,
          invoiceId: null,
          itemOrderId: null,
          paymentType: row.paymentType,
          postingGroupKey: row.postingGroupKey,
          zohoPaymentId,
          amount: row.amount,
          accountCode: row.accountCode,
          invoiceAllocations: row.invoiceAllocations,
          referenceNumber: row.referenceNumber,
          description: row.description,
          status: 'posted',
        })
        result.summary.paymentsCreated += 1
        result.zohoPaymentIds.push({ zohoPaymentId, referenceNumber: row.referenceNumber })
        result.payments.push({ ...row, status: 'posted', zohoPaymentId })
      } catch (err) {
        result.summary.errors += 1
        const error = {
          ...row,
          status: 'error',
          error: err?.message || 'Zoho payment failed',
          code: err?.code || 'ZOHO_PAYMENT_FAILED',
        }
        result.errors.push(error)
        result.payments.push(error)
      }
    }

    for (const [idx, line] of feeJournalLines.entries()) {
      const paymentType = `fee_journal_${idx + 1}`
      const existing = await store.findGroupedPosting(batch.batchId, paymentType)
      if (existing && existing.status === 'posted') {
        result.summary.journalsSkipped += 1
        result.journals.push({
          ...line,
          paymentType,
          status: 'skipped',
          zohoJournalId: existing.zohoPaymentId,
        })
        continue
      }
      if (line.mappingStatus === 'needs_mapping' && !dryRun) {
        result.summary.errors += 1
        const error = { ...line, paymentType, status: 'error', error: 'Fee journal unmapped' }
        result.errors.push(error)
        result.journals.push(error)
        continue
      }
      const journalRequest = {
        feeType: line.feeType,
        description: line.title || line.feeType,
        amount: line.amount,
        debit: line.debit,
        credit: line.credit,
        customerId: clean(line.zohoCustomerId || batch.zohoCustomerId || customerId),
        lineItems: Array.isArray(line.lineItems)
          ? line.lineItems.map((item) => ({
              ...item,
              customerId:
                clean(item.customerId) ||
                clean(line.zohoCustomerId || batch.zohoCustomerId || customerId),
            }))
          : undefined,
        vatBreakdown: line.vatBreakdown || null,
        referenceNumber: buildEntryReference(metadata, line.feeType),
        date: paymentDate,
      }
      let zohoPayloadPreview = null
      try {
        zohoPayloadPreview = await buildJournalPayloadPreview(journalRequest)
      } catch (err) {
        result.summary.errors += 1
        const error = {
          ...line,
          paymentType,
          status: 'error',
          error: err?.message || 'Journal preview failed',
        }
        result.errors.push(error)
        result.journals.push(error)
        continue
      }
      if (dryRun) {
        result.summary.journalsCreated += 1
        result.journals.push({ ...line, paymentType, status: 'dry_run', zohoPayloadPreview })
        continue
      }
      try {
        const created = await createManualJournal(journalRequest)
        const zohoJournalId = clean(created?.journal_id || created?.journalId || created?.id)
        const zohoJournalNumber = clean(created?.journal_number || created?.journalNumber)
        await store.insertPosting({
          batchId: batch.batchId,
          paymentType,
          postingGroupKey: paymentType,
          zohoPaymentId: zohoJournalId,
          zohoJournalNumber,
          amount: line.amount,
          referenceNumber: journalRequest.referenceNumber,
          description: journalRequest.description,
          mappingSnapshot: { feeType: line.feeType, parentOrderId: line.parentOrderId },
          status: 'posted',
        })
        result.summary.journalsCreated += 1
        result.zohoJournalIds.push({ zohoJournalId, zohoJournalNumber })
        result.journals.push({ ...line, paymentType, status: 'posted', zohoJournalId, zohoJournalNumber })
      } catch (err) {
        result.summary.errors += 1
        const error = {
          ...line,
          paymentType,
          status: 'error',
          error: err?.message || 'Zoho journal failed',
        }
        result.errors.push(error)
        result.journals.push(error)
      }
    }

    if (!dryRun && result.summary.errors === 0) {
      await store.markBatchPosted(batch.batchId, postedBy, {
        reference: settlementReference,
        zohoPaymentIds: result.zohoPaymentIds,
        zohoJournalIds: result.zohoJournalIds,
        summary: result.summary,
      })
      result.status = 'posted'
    } else if (!dryRun && result.summary.errors > 0) {
      result.success = false
      result.status = 'error'
    }
    return result
  }

  if (dryRun) return run()
  return store.withBatchPostingLock(batch.batchId, run)
}

async function forceRepostBatch({
  batch,
  reason,
  actorUserId,
  mappingRules = [],
  settlementBridgeAccount = null,
  inputVatAccount = null,
}) {
  if (!batch || (batch.status !== 'posted' && !batch.postedToZoho)) {
    const err = new Error('Force repost requires a previously posted batch.')
    err.code = 'NOON_PAYMENT_CLEARING_NOT_POSTED'
    err.status = 422
    throw err
  }
  if (!clean(reason) || clean(reason).length < 4) {
    const err = new Error('Force repost requires a reason (min 4 characters).')
    err.code = 'NOON_PAYMENT_CLEARING_FORCE_REPOST_REASON'
    err.status = 422
    throw err
  }
  const prior = await store.listPostingsForBatch(batch.batchId)
  await store.insertAudit({
    batchId: batch.batchId,
    action: 'force_repost',
    reason,
    actorUserId,
    previousZohoPaymentIds: prior.map((p) => p.zohoPaymentId).filter(Boolean),
  })
  await store.clearPostingsForBatch(batch.batchId)
  return postApprovedBatch({
    batch,
    dryRun: false,
    allowPosted: true,
    postedBy: actorUserId,
    mappingRules,
    settlementBridgeAccount,
    inputVatAccount,
  })
}

module.exports = {
  ensureCanPostBatch,
  postApprovedBatch,
  forceRepostBatch,
  flattenInvoicePayments,
  PAYMENT_TYPES,
}
