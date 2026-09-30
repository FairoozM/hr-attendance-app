const { buildPaymentPreviewFromBatch, PAYMENT_PREVIEW_TOLERANCE } = require('./amazonPaymentClearingPaymentPreviewService')
const { round2 } = require('./amazonPaymentClearingOrderBreakdownService')
const zohoPaymentService = require('./amazonPaymentClearingZohoPaymentService')
const { buildSettlementReference, buildEntryReference } = require('./amazonPaymentClearingReferenceService')
const { isCreditNoteApplyComplete } = require('./amazonPaymentClearingCreditNotePostingService')
const { buildReturnFeePlan, aggregateReturnFeeJournalLines } = require('./amazonPaymentClearingReturnFeeService')
const { fetchInvoices, fetchInvoicesByIds, invoiceBalanceDue } = require('../integrations/zoho/zohoBooksClient')
const store = require('./amazonPaymentClearingStore')
const {
  isSettlementReconciliationAcceptable,
  legacyPaymentPreviewTolerance,
  settlementCurrencyForCustomer,
} = require('./amazonPaymentClearingCurrencyService')
const {
  requireMarketplaceCode,
  assertPostingAccountsReady,
  requireClearingAccountByCode,
} = require('./amazonPaymentClearingAccountGuard')
const { getPaymentClearingMarketplaceConfig } = require('./amazonPaymentClearingMarketplaceConfig')
const { runSafeWrite, STATUS } = require('./amazonPaymentClearingSafeWrite')
const recovery = require('./amazonPaymentClearingZohoRecovery')
const identity = require('./amazonPaymentClearingPostingIdentity')

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
  if (!isSettlementReconciliationAcceptable(batch.reconciliationSummary, batch.zohoCustomerName, PAYMENT_PREVIEW_TOLERANCE)) {
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
    const checkCreditNotes = options.isCreditNoteApplyComplete || isCreditNoteApplyComplete
    const cnComplete = await checkCreditNotes(batch.batchId, batch)
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

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function readyReturnFeeJournalLines(batch) {
  const returnFeePlan = buildReturnFeePlan(batch, batch.allRows || [])
  const aggregated = aggregateReturnFeeJournalLines(returnFeePlan.journalLines || [])
  const lines = identity.assignIdentities(
    aggregated,
    (row) => identity.returnFeeJournalIdentity(row),
    (row) => row.normalizedFeeType || row.feeType || 'return fee',
    'return fee journal'
  )
  return { returnFeePlan, lines }
}

function accountKey(account) {
  return clean(account?.accountId) || `code:${clean(account?.accountCode)}`
}

/**
 * Journal problems that would post the wrong accounting and must stop posting:
 * debit and credit on the same account, or one aggregated journal mixing
 * source lines that point in opposite directions.
 */
function journalShapeProblems(lines, sourceLines = []) {
  const problems = []
  for (const line of lines) {
    if (accountKey(line.debit) === accountKey(line.credit)) {
      problems.push(`${line.feeType || line.normalizedFeeType || 'journal'} debits and credits the same account (${accountKey(line.debit)}).`)
    }
  }
  const directions = new Map()
  for (const line of sourceLines) {
    if (line.status !== 'ready') continue
    const key = line.normalizedFeeType || line.feeType
    const dir = `${accountKey(line.debit)}>${accountKey(line.credit)}`
    if (!directions.has(key)) directions.set(key, new Set())
    directions.get(key).add(dir)
  }
  for (const [key, dirs] of directions) {
    if (dirs.size > 1) {
      problems.push(`${key} combines order lines with opposite debit/credit directions into one journal; review the return rows.`)
    }
  }
  return problems
}

function journalShapeError(problems) {
  const err = new Error(`Journal entries cannot be posted as built. Nothing was posted. ${problems.join(' ')}`)
  err.code = 'AMAZON_PAYMENT_CLEARING_JOURNAL_SHAPE_INVALID'
  err.status = 422
  err.problems = problems
  return err
}

/**
 * Local posting row for a journal identity, falling back to a legacy positional row
 * that was created for the same journal.
 */
function localJournalRowResolver(postings, kind, marketplace, lines) {
  const legacy = identity.mapLegacyJournalPostings(postings, kind, marketplace, lines)
  const byType = new Map(postings.map((row) => [row.paymentType, row]))
  return {
    legacy,
    find(paymentType) {
      return byType.get(paymentType) || legacy.byIdentity.get(paymentType) || null
    },
  }
}

async function isReturnFeePostComplete(batchId, batchOverride = null) {
  const batch = batchOverride || await store.getBatchById(batchId)
  if (!batch) return false
  const { returnFeePlan, lines } = readyReturnFeeJournalLines(batch)
  const ready = lines.filter((row) => row.status === 'ready')
  if (ready.length === 0) {
    return (returnFeePlan.summary?.varianceBlockerCount || 0) === 0
  }
  const postings = await store.listPostingsForBatch(batchId)
  const resolver = localJournalRowResolver(postings, 'return_fee', batch.marketplace, ready)
  return ready.every((row) => {
    if (resolver.legacy.ambiguous.has(row.paymentType)) return false
    const local = resolver.find(row.paymentType)
    return Boolean(local && local.status === STATUS.POSTED && local.zohoPaymentId)
  })
}

function requestDateOf(localRow) {
  return clean(localRow?.mappingSnapshot?.request?.date) || null
}

function resolveLineAccountId(account, marketplace, env) {
  const explicit = clean(account?.accountId)
  if (explicit) return explicit
  return requireClearingAccountByCode(marketplace, account?.accountCode, { env }).accountId
}

function storeForLocalRow(baseStore, localRow) {
  return {
    ...baseStore,
    findPostingByKey: async (batchId, key) => (await baseStore.findPostingByKey(batchId, key)) || localRow || null,
  }
}

function tally(result, kind, outcome) {
  const created = kind === 'payment' ? 'paymentsCreated' : 'journalsCreated'
  const skipped = kind === 'payment' ? 'paymentsSkipped' : 'journalsSkipped'
  if (outcome.status === STATUS.POSTED) {
    result.summary[outcome.alreadyPosted && !outcome.created ? skipped : created] += 1
    return outcome.alreadyPosted && !outcome.created ? 'skipped' : 'created'
  }
  if (outcome.status === STATUS.VERIFICATION_REQUIRED) {
    result.summary.verificationRequired += 1
    return 'verification_required'
  }
  result.summary.errors += 1
  return 'error'
}

/**
 * Post (or verify) one journal through the safe-write state machine.
 */
async function safeWriteJournal({
  store,
  batch,
  marketplace,
  env,
  line,
  journalRequest,
  mappingSnapshot,
  localRow,
  createManualJournal,
  lookupDeps,
  source,
  force = false,
}) {
  const debitAccountId = resolveLineAccountId(journalRequest.debit, marketplace, env)
  const creditAccountId = resolveLineAccountId(journalRequest.credit, marketplace, env)
  const request = {
    ...journalRequest,
    debit: { ...journalRequest.debit, accountId: debitAccountId },
    credit: { ...journalRequest.credit, accountId: creditAccountId },
  }
  const expectedFor = (local) => ({
    referenceNumber: journalRequest.referenceNumber,
    date: requestDateOf(local),
    amount: journalRequest.amount,
    lines: [
      { accountId: debitAccountId, debitOrCredit: 'debit', amount: journalRequest.amount },
      { accountId: creditAccountId, debitOrCredit: 'credit', amount: journalRequest.amount },
    ],
  })
  return runSafeWrite({
    force,
    store: storeForLocalRow(store, localRow),
    label: `${line.feeType || line.normalizedFeeType || 'Journal'} journal`,
    row: {
      batchId: batch.batchId,
      invoiceId: null,
      orderId: null,
      paymentType: line.paymentType,
      postingGroupKey: `APC-${batch.batchId}-${line.paymentType}`,
      amount: journalRequest.amount,
      accountCode: debitAccountId,
      invoiceAllocations: mappingSnapshot.invoiceAllocations || [],
      referenceNumber: journalRequest.referenceNumber,
      description: journalRequest.notes,
      notes: journalRequest.notes,
      mappingSnapshot: {
        ...mappingSnapshot,
        marketplace,
        debitAccountId,
        creditAccountId,
        request: { date: journalRequest.date, amount: journalRequest.amount, referenceNumber: journalRequest.referenceNumber },
      },
    },
    lookup: (local) => recovery.lookupJournal(expectedFor(local), lookupDeps),
    verifyById: (id, local) => recovery.verifyRecordById('journal', id, expectedFor(local), lookupDeps),
    create: async () => {
      const created = await createManualJournal(request, {
        marketplace,
        strictMarketplace: true,
        retryTransport: false,
        env,
        source,
      })
      return { zohoId: created?.zohoJournalId || '', zohoNumber: created?.zohoJournalNumber || '' }
    },
  })
}

async function postReturnFeeJournalRows({
  batch,
  store,
  dryRun,
  marketplace,
  env,
  paymentDate,
  createManualJournal,
  buildJournalPayloadPreview,
  lookupDeps,
  result,
}) {
  const { returnFeePlan, lines } = readyReturnFeeJournalLines(batch)
  const postings = await store.listPostingsForBatch(batch.batchId)
  const resolver = localJournalRowResolver(postings, 'return_fee', marketplace, lines)

  for (const row of lines) {
    const { paymentType } = row
    const localRow = resolver.find(paymentType)
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

    if (resolver.legacy.ambiguous.has(paymentType)) {
      result.summary.verificationRequired += 1
      result.journals.push({
        ...row,
        status: 'verification_required',
        zohoJournalId: '',
        error: 'More than one earlier posting row claims this journal. Check Zoho and resolve before posting.',
      })
      continue
    }

    let zohoPayloadPreview = null
    try {
      zohoPayloadPreview = await buildJournalPayloadPreview(journalRequest, { marketplace, strictMarketplace: true, env })
    } catch (err) {
      result.summary.errors += 1
      const error = {
        ...row,
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
      const already = localRow && localRow.status === STATUS.POSTED
      result.journals.push({
        ...row,
        status: already ? 'skipped' : 'dry_run',
        zohoJournalId: already ? localRow.zohoPaymentId : '',
        localStatus: localRow?.status || '',
        zohoPayloadPreview,
      })
      continue
    }

    const mappingSnapshot = {
      identity: paymentType,
      normalizedFeeType: row.normalizedFeeType || '',
      feeType: row.feeType || '',
      orderIds: row.orderIds || [],
      sourceAmount: row.amount,
      invoiceAllocations: (row.orderIds || []).map((orderId) => ({ orderId })),
    }
    const outcome = await safeWriteJournal({
      store,
      batch,
      marketplace,
      env,
      line: row,
      journalRequest,
      mappingSnapshot,
      localRow,
      createManualJournal,
      lookupDeps,
      source: 'amazon_payment_clearing_return_fee_journal_post',
    })
    const status = tally(result, 'journal', outcome)
    const entry = {
      ...row,
      status,
      zohoJournalId: outcome.zohoId,
      zohoJournalNumber: outcome.zohoNumber,
      error: status === 'error' || status === 'verification_required' ? outcome.message : undefined,
      verification: outcome.verification || null,
      mappingSnapshot,
      zohoPayloadPreview,
    }
    if (status === 'error') result.errors.push(entry)
    result.journals.push(entry)
  }
  return returnFeePlan
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

function mergeInvoiceAllocations(allocations) {
  const merged = new Map()
  for (const row of Array.isArray(allocations) ? allocations : []) {
    const invoiceId = String(row.invoiceId || '').trim()
    if (!invoiceId) continue
    const existing = merged.get(invoiceId)
    const amountApplied = round2(Number(row.amountApplied) || 0)
    if (!existing) {
      merged.set(invoiceId, {
        invoiceId,
        invoiceNumber: row.invoiceNumber || '',
        orderId: row.orderId || '',
        amountApplied,
      })
      continue
    }
    existing.amountApplied = round2(existing.amountApplied + amountApplied)
    if (!existing.invoiceNumber && row.invoiceNumber) existing.invoiceNumber = row.invoiceNumber
    if (!existing.orderId && row.orderId) existing.orderId = row.orderId
  }
  return Array.from(merged.values())
}

/**
 * Live invoice balances for the plan. One paged "unpaid invoices for customer" list covers
 * nearly every invoice in a few calls; anything absent (paid, void, list failure) is fetched
 * individually so an already-paid invoice still surfaces as a balance issue.
 */
async function fetchInvoiceBalancesForPosting(invoiceIds, opts = {}) {
  const fetchByIds = opts.fetchInvoicesByIds || fetchInvoicesByIds
  const fetchUnpaid = opts.fetchUnpaidInvoices || ((customerId) => fetchInvoices(null, null, customerId, { filterBy: 'Status.Unpaid' }))
  const wanted = new Set(invoiceIds.map((id) => String(id).trim()).filter(Boolean))
  const invoices = new Map()
  const customerId = String(opts.customerId || '').trim()
  if (customerId && (opts.fetchUnpaidInvoices || !opts.fetchInvoicesByIds)) {
    const listed = await fetchUnpaid(customerId).catch(() => null)
    for (const row of listed?.rows || []) {
      const id = String(row?.invoice_id || '').trim()
      if (wanted.has(id)) invoices.set(id, row)
    }
  }
  const missing = Array.from(wanted).filter((id) => !invoices.has(id))
  if (missing.length) {
    const fetched = await fetchByIds(missing, opts.strict ? { strict: true } : undefined)
    for (const [id, invoice] of fetched) invoices.set(String(id), invoice)
  }
  return invoices
}

async function validateInvoiceBalancesForPosting(paymentPreview, opts = {}) {
  const customerName = paymentPreview?.zohoCustomerName || ''
  const balanceTolerance = legacyPaymentPreviewTolerance(customerName)
  const payments = Array.isArray(paymentPreview?.payments) ? paymentPreview.payments : []
  const invoiceIds = payments.map((row) => row.zohoInvoiceId).filter(Boolean)
  if (!invoiceIds.length) return []
  const invoices = await fetchInvoiceBalancesForPosting(invoiceIds, opts)
  const issues = []
  for (const plan of payments) {
    const invoiceId = String(plan.zohoInvoiceId || '').trim()
    if (!invoiceId) continue
    const invoice = invoices.get(invoiceId)
    const balanceDue = invoiceBalanceDue(invoice)
    if (balanceDue == null) continue
    const plannedTotal = round2(plan.totalClearingAmount)
    if (plannedTotal <= balanceDue + balanceTolerance) continue
    const invoiceNumber = plan.zohoInvoiceNumber || invoice?.invoice_number || invoice?.number || invoiceId
    issues.push({
      orderId: plan.orderId || '',
      zohoInvoiceId: invoiceId,
      zohoInvoiceNumber: invoiceNumber,
      balanceDue,
      plannedPaymentTotal: plannedTotal,
      netBalanceAmount: round2(plan.netBalancePayment?.amount),
      commissionAmount: round2(plan.commissionPayment?.amount),
      shippingAmount: round2(plan.shippingFbaPayment?.amount),
      message:
        `Invoice ${invoiceNumber} balance due is ${balanceDue} but clearing requires ${plannedTotal}. ` +
        'The invoice may already be paid or have credit notes applied in Zoho.',
    })
  }
  return issues
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
    const invoiceAllocations = mergeInvoiceAllocations(group.invoiceAllocations)
    const amount = round2(invoiceAllocations.reduce((sum, row) => sum + (Number(row.amountApplied) || 0), 0))
    const entry = buildEntryReference(reference, group.paymentType)
    return {
      ...group,
      invoiceNumber: `${invoiceAllocations.length} invoices`,
      amount,
      invoiceAllocations,
      entryLabel: entry.entryLabel,
      referenceNumber: entry.referenceNumber,
      description: entry.description,
      settlementReference: reference,
      source: {
        customerId,
        invoices: invoiceAllocations,
      },
      zohoPaymentRequest: {
        customerId,
        amount,
        invoices: invoiceAllocations,
        depositToAccountCode: group.accountCode,
        depositToAccountName: group.accountName,
        paymentDate,
        referenceNumber: entry.referenceNumber,
        description: entry.description,
      },
    }
  })
}

/**
 * Balance check for the payment entries that will actually be sent. Lookup failures
 * and missing balances stop posting instead of being treated as "no issue".
 * @param {Array<{ paymentType: string, invoiceAllocations: Array<{ invoiceId: string, invoiceNumber?: string, orderId?: string, amountApplied: number }> }>} rowsToPost
 */
async function validateRemainingInvoiceBalances(rowsToPost, opts = {}) {
  const balanceTolerance = legacyPaymentPreviewTolerance(opts.customerName || '')
  const plannedByInvoice = new Map()
  for (const row of rowsToPost) {
    for (const allocation of row.invoiceAllocations || []) {
      const invoiceId = clean(allocation.invoiceId)
      if (!invoiceId) continue
      const entry = plannedByInvoice.get(invoiceId) || {
        invoiceId,
        invoiceNumber: allocation.invoiceNumber || '',
        orderId: allocation.orderId || '',
        planned: 0,
        byType: {},
      }
      entry.planned = round2(entry.planned + (Number(allocation.amountApplied) || 0))
      entry.byType[row.paymentType] = round2((entry.byType[row.paymentType] || 0) + (Number(allocation.amountApplied) || 0))
      plannedByInvoice.set(invoiceId, entry)
    }
  }
  if (!plannedByInvoice.size) return []
  let invoices
  try {
    invoices = await fetchInvoiceBalancesForPosting(Array.from(plannedByInvoice.keys()), {
      customerId: opts.customerId,
      fetchInvoicesByIds: opts.fetchInvoicesByIds,
      fetchUnpaidInvoices: opts.fetchUnpaidInvoices,
      strict: true,
    })
  } catch (err) {
    const wrapped = new Error(
      `Could not load Zoho invoice balances before posting (${err?.message || err}). Nothing was posted; try again when Zoho responds.`
    )
    wrapped.code = 'AMAZON_PAYMENT_CLEARING_INVOICE_BALANCE_UNAVAILABLE'
    wrapped.status = 503
    throw wrapped
  }
  const issues = []
  for (const entry of plannedByInvoice.values()) {
    const invoice = invoices.get(entry.invoiceId)
    const balanceDue = invoice ? invoiceBalanceDue(invoice) : null
    const invoiceNumber = entry.invoiceNumber || invoice?.invoice_number || entry.invoiceId
    if (balanceDue == null) {
      issues.push({
        orderId: entry.orderId,
        zohoInvoiceId: entry.invoiceId,
        zohoInvoiceNumber: invoiceNumber,
        balanceDue: null,
        plannedPaymentTotal: entry.planned,
        message: `Invoice ${invoiceNumber} balance could not be read from Zoho.`,
      })
      continue
    }
    if (entry.planned <= balanceDue + balanceTolerance) continue
    issues.push({
      orderId: entry.orderId,
      zohoInvoiceId: entry.invoiceId,
      zohoInvoiceNumber: invoiceNumber,
      balanceDue,
      plannedPaymentTotal: entry.planned,
      netBalanceAmount: entry.byType[PAYMENT_TYPES.NET_BALANCE] || 0,
      commissionAmount: entry.byType[PAYMENT_TYPES.COMMISSION] || 0,
      shippingAmount: entry.byType[PAYMENT_TYPES.SHIPPING_FBA] || 0,
      message:
        `Invoice ${invoiceNumber} balance due is ${balanceDue} but the remaining clearing requires ${entry.planned}. ` +
        'The invoice may already be paid or have credit notes applied in Zoho.',
    })
  }
  return issues
}

function overallPostingStatus(summary, dryRun) {
  if (dryRun) return 'dry_run'
  const done =
    (summary.paymentsCreated || 0) + (summary.paymentsSkipped || 0) + (summary.journalsCreated || 0) + (summary.journalsSkipped || 0)
  if (summary.verificationRequired > 0) return 'verification_required'
  if (summary.errors > 0) return done > 0 ? 'partially_posted' : 'failed'
  return 'posted'
}

function feeJournalLinesWithIdentity(feeJournalLines, marketplace) {
  return identity.assignIdentities(
    feeJournalLines,
    (row) => identity.feeJournalIdentity(row, marketplace),
    (row) => [row.feeType, row.rawTransactionType, row.description].filter(Boolean).join(' / ') || 'fee',
    'fee journal'
  )
}

async function postApprovedBatch({
  batch,
  store,
  dryRun = true,
  allowPosted = false,
  forceRepost = false,
  postedBy,
  createPayment = zohoPaymentService.createZohoCustomerPayment,
  buildPayloadPreview = zohoPaymentService.buildCustomerPaymentPayloadPreview,
  createManualJournal = zohoPaymentService.createZohoManualJournal,
  buildJournalPayloadPreview = zohoPaymentService.buildManualJournalPayloadPreview,
  fetchInvoicesByIds: fetchInvoicesByIdsOverride,
  fetchUnpaidInvoices: fetchUnpaidInvoicesOverride,
  zohoLookup = null,
  env = process.env,
}) {
  const latestPreview = await store.getLatestPaymentPreviewForBatch(batch.batchId)
  await ensureCanPostBatch(batch, Boolean(latestPreview), { dryRun, allowPosted })
  const marketplace = requireMarketplaceCode(batch.marketplace)
  const currentPreview = buildPaymentPreviewFromBatch(batch)
  const paymentPreview = {
    batchId: batch.batchId,
    zohoCustomerName: batch.zohoCustomerName || '',
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
  const feeJournalLines = feeJournalLinesWithIdentity(
    Array.isArray(paymentPreview.amazonFeeJournalLines) ? paymentPreview.amazonFeeJournalLines : [],
    marketplace
  )
  const accounts = assertPostingAccountsReady({ marketplace, feeJournalLines, env })
  const shapeProblems = journalShapeProblems(feeJournalLines)
  if (shapeProblems.length) throw journalShapeError(shapeProblems)
  const accountIdByCode = new Map(
    Object.values(accounts.accounts)
      .filter(Boolean)
      .map((row) => [row.accountCode, row.accountId])
  )
  const currencyCode = settlementCurrencyForCustomer(
    batch.zohoCustomerName,
    batch.report?.currency,
    getPaymentClearingMarketplaceConfig(marketplace).currency
  )
  const lookupDeps = zohoLookup || recovery.defaultZohoLookupDeps()

  const result = {
    success: true,
    dryRun: Boolean(dryRun),
    batchId: batch.batchId,
    marketplace,
    status: dryRun ? 'dry_run' : 'posted',
    settlementReference,
    summary: {
      invoicesPosted: new Set(paymentRows.map((row) => row.invoiceId)).size,
      paymentsCreated: 0,
      paymentsSkipped: 0,
      journalsCreated: 0,
      journalsSkipped: 0,
      verificationRequired: 0,
      errors: 0,
    },
    payments: [],
    journals: [],
    errors: [],
  }

  const existingPostings = await store.listPostingsForBatch(batch.batchId)
  const localByType = new Map(existingPostings.map((row) => [row.paymentType, row]))
  const needsWrite = (row) => {
    const local = localByType.get(row.paymentType)
    return !local || local.status === STATUS.FAILED
  }

  let balanceIssueByInvoiceId = new Map()
  try {
    const balanceIssues = await validateRemainingInvoiceBalances(postingRows.filter(needsWrite), {
      customerId,
      fetchInvoicesByIds: fetchInvoicesByIdsOverride,
      fetchUnpaidInvoices: fetchUnpaidInvoicesOverride,
      customerName: batch.zohoCustomerName || '',
    })
    balanceIssueByInvoiceId = new Map(balanceIssues.map((row) => [row.zohoInvoiceId, row]))
  } catch (err) {
    if (!dryRun) throw err
    result.warnings = [err.message]
  }

  for (const row of postingRows) {
    const local = localByType.get(row.paymentType) || null
    const blockingIssues = needsWrite(row)
      ? row.invoiceAllocations.map((allocation) => balanceIssueByInvoiceId.get(allocation.invoiceId)).filter(Boolean)
      : []
    if (blockingIssues.length) {
      result.summary.errors += 1
      const error = {
        ...row,
        status: 'error',
        zohoPaymentId: '',
        error: blockingIssues.map((issue) => issue.message).join(' | '),
        code: 'ZOHO_INVOICE_BALANCE_INSUFFICIENT',
        balanceIssues: blockingIssues,
      }
      result.errors.push(error)
      result.payments.push(error)
      continue
    }

    const depositToAccountId = accountIdByCode.get(clean(row.accountCode)) || ''
    const zohoPaymentRequest = { ...row.zohoPaymentRequest, depositToAccountId }

    let zohoPayloadPreview = null
    try {
      if (!depositToAccountId) {
        const err = new Error(`${row.paymentLabel} account ${row.accountCode} is not a ${marketplace} clearing account.`)
        err.code = 'AMAZON_PAYMENT_CLEARING_ACCOUNT_CONFIG_INVALID'
        throw err
      }
      zohoPayloadPreview = await buildPayloadPreview(zohoPaymentRequest, { marketplace, strictMarketplace: true, env })
    } catch (err) {
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

    if (dryRun) {
      const already = local && local.status === STATUS.POSTED
      result.payments.push({
        ...row,
        status: already ? 'skipped' : 'dry_run',
        zohoPaymentId: already ? local.zohoPaymentId : '',
        localStatus: local?.status || '',
        zohoPayloadPreview,
      })
      continue
    }

    const expectedFor = (localRow) => ({
      customerId,
      referenceNumber: row.referenceNumber,
      date: requestDateOf(localRow),
      amount: row.amount,
      accountId: depositToAccountId,
      currencyCode,
      invoices: row.invoiceAllocations.map((allocation) => ({
        invoiceId: allocation.invoiceId,
        amountApplied: allocation.amountApplied,
      })),
    })
    const outcome = await runSafeWrite({
      force: forceRepost,
      store,
      label: row.paymentLabel,
      row: {
        batchId: batch.batchId,
        invoiceId: null,
        orderId: null,
        paymentType: row.paymentType,
        postingGroupKey: `APC-${batch.batchId}-${row.paymentType}`,
        amount: row.amount,
        accountCode: row.accountCode,
        invoiceAllocations: row.invoiceAllocations,
        referenceNumber: row.referenceNumber,
        description: row.description,
        mappingSnapshot: {
          marketplace,
          accountId: depositToAccountId,
          request: {
            date: paymentDate,
            customerId,
            amount: row.amount,
            referenceNumber: row.referenceNumber,
            accountId: depositToAccountId,
            currencyCode,
          },
        },
      },
      lookup: (localRow) => recovery.lookupCustomerPayment(expectedFor(localRow), lookupDeps),
      verifyById: (id, localRow) => recovery.verifyRecordById('payment', id, expectedFor(localRow), lookupDeps),
      create: async () => {
        const created = await createPayment(zohoPaymentRequest, {
          marketplace,
          strictMarketplace: true,
          retryTransport: false,
          env,
        })
        return { zohoId: created?.zohoPaymentId || created?.payment_id || '' }
      },
    })
    const status = tally(result, 'payment', outcome)
    const entry = {
      ...row,
      status,
      zohoPaymentId: outcome.zohoId,
      error: status === 'error' || status === 'verification_required' ? outcome.message : undefined,
      verification: outcome.verification || null,
      zohoPayloadPreview,
    }
    if (status === 'error') result.errors.push(entry)
    result.payments.push(entry)
  }

  const feeResolver = localJournalRowResolver(existingPostings, 'fee', marketplace, feeJournalLines)
  for (const row of feeJournalLines) {
    const { paymentType } = row
    const localRow = feeResolver.find(paymentType)
    const journalRequest = {
      feeType: row.feeType,
      description: row.lineDescription || row.description,
      amount: Math.abs(round2(Number(row.totalAmount) || 0)),
      debit: row.debit,
      credit: row.credit,
      referenceNumber: row.referenceNumber,
      notes: row.notes,
      date: paymentDate,
    }

    if (feeResolver.legacy.ambiguous.has(paymentType)) {
      result.summary.verificationRequired += 1
      result.journals.push({
        ...row,
        status: 'verification_required',
        zohoJournalId: '',
        error: 'More than one earlier posting row claims this journal. Check Zoho and resolve before posting.',
      })
      continue
    }

    let zohoPayloadPreview = null
    try {
      if (row.mappingStatus === 'needs_mapping') {
        const err = new Error('Amazon fee journal mapping is not mapped.')
        err.code = 'AMAZON_PAYMENT_CLEARING_FEE_JOURNAL_UNMAPPED'
        throw err
      }
      zohoPayloadPreview = await buildJournalPayloadPreview(journalRequest, { marketplace, strictMarketplace: true, env })
    } catch (err) {
      result.summary.errors += 1
      const error = {
        ...row,
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
      const already = localRow && localRow.status === STATUS.POSTED
      result.journals.push({
        ...row,
        status: already ? 'skipped' : 'dry_run',
        zohoJournalId: already ? localRow.zohoPaymentId : '',
        localStatus: localRow?.status || '',
        zohoPayloadPreview,
      })
      continue
    }

    const mappingSnapshot = {
      identity: paymentType,
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
      invoiceAllocations: row.rowNumbers?.map((rowNumber) => ({ rowNumber })) || [],
    }
    const outcome = await safeWriteJournal({
      store,
      batch,
      marketplace,
      env,
      line: row,
      journalRequest,
      mappingSnapshot,
      localRow,
      createManualJournal,
      lookupDeps,
      source: 'amazon_payment_clearing_fee_journal_post',
      force: forceRepost,
    })
    const status = tally(result, 'journal', outcome)
    if (status === 'created' && (row.mappingRuleId || row.mappingRuleUsed?.id)) {
      await store.markFeeJournalMappingsUsed([row.mappingRuleId || row.mappingRuleUsed.id]).catch(() => {})
    }
    const entry = {
      ...row,
      status,
      zohoJournalId: outcome.zohoId,
      zohoJournalNumber: outcome.zohoNumber,
      error: status === 'error' || status === 'verification_required' ? outcome.message : undefined,
      verification: outcome.verification || null,
      mappingSnapshot,
      zohoPayloadPreview,
    }
    if (status === 'error') result.errors.push(entry)
    result.journals.push(entry)
  }

  result.status = overallPostingStatus(result.summary, dryRun)
  result.success = result.summary.errors === 0 && result.summary.verificationRequired === 0

  if (!dryRun && result.success) {
    await store.markBatchPosted(batch.batchId, postedBy, {
      ...result.summary,
      forceRepost: Boolean(allowPosted),
      returnFeeJournalsPosted: 0,
      zohoPaymentIds: result.payments
        .filter((row) => row.zohoPaymentId)
        .map((row) => ({
          paymentType: row.paymentType,
          zohoPaymentId: row.zohoPaymentId,
          referenceNumber: row.referenceNumber || '',
        })),
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

/**
 * Everything the sales and return-fee steps are expected to create in Zoho, keyed by
 * posting identity, with the same expected-record builders posting uses. No Zoho calls.
 * @returns {{ marketplace: string, customerId: string, currencyCode: string, entries: Map<string, any>, configProblem: string }}
 */
function describeExpectedEntries(batch, { env = process.env } = {}) {
  const marketplace = requireMarketplaceCode(batch.marketplace)
  const entries = new Map()
  let configProblem = ''
  let accountIdByCode = new Map()
  try {
    const resolved = assertPostingAccountsReady({ marketplace, env })
    accountIdByCode = new Map(
      Object.values(resolved.accounts)
        .filter(Boolean)
        .map((row) => [row.accountCode, row.accountId])
    )
  } catch (err) {
    configProblem = err?.message || String(err)
  }
  const currencyCode = settlementCurrencyForCustomer(
    batch.zohoCustomerName,
    batch.report?.currency,
    getPaymentClearingMarketplaceConfig(marketplace).currency
  )
  const preview = { batchId: batch.batchId, zohoCustomerName: batch.zohoCustomerName || '', ...buildPaymentPreviewFromBatch(batch) }
  const paymentRows = flattenPaymentPreview(preview)
  const customerId = paymentRows.length ? requireSingleCustomer(paymentRows, customerByInvoiceId(batch)) : ''
  const paymentDate = zohoPaymentService.todayLocalDate()
  const groups = paymentRows.length ? groupedPaymentRows(paymentRows, customerId, paymentDate, batch) : []
  for (const row of groups) {
    const accountId = accountIdByCode.get(clean(row.accountCode)) || ''
    entries.set(row.paymentType, {
      group: 'sales_payment',
      kind: 'payment',
      paymentType: row.paymentType,
      label: row.paymentLabel,
      amount: row.amount,
      referenceNumber: row.referenceNumber,
      accountId,
      rowTemplate: {
        batchId: batch.batchId,
        invoiceId: null,
        orderId: null,
        paymentType: row.paymentType,
        postingGroupKey: `APC-${batch.batchId}-${row.paymentType}`,
        amount: row.amount,
        accountCode: row.accountCode,
        invoiceAllocations: row.invoiceAllocations,
        referenceNumber: row.referenceNumber,
        description: row.description,
      },
      expectedFor: (local) => ({
        customerId,
        referenceNumber: row.referenceNumber,
        date: requestDateOf(local),
        amount: row.amount,
        accountId,
        currencyCode,
        invoices: row.invoiceAllocations.map((a) => ({ invoiceId: a.invoiceId, amountApplied: a.amountApplied })),
      }),
    })
  }

  const journalEntry = (group, row, amount) => {
    let debitAccountId = ''
    let creditAccountId = ''
    try {
      debitAccountId = resolveLineAccountId(row.debit, marketplace, env)
      creditAccountId = resolveLineAccountId(row.credit, marketplace, env)
    } catch (err) {
      configProblem = configProblem || err?.message || String(err)
    }
    return {
      group,
      kind: 'journal',
      paymentType: row.paymentType,
      label: [row.feeType || row.normalizedFeeType, row.rawTransactionType, row.description].filter(Boolean).join(' / '),
      amount,
      referenceNumber: row.referenceNumber,
      debitAccountId,
      creditAccountId,
      rowTemplate: {
        batchId: batch.batchId,
        invoiceId: null,
        orderId: null,
        paymentType: row.paymentType,
        postingGroupKey: `APC-${batch.batchId}-${row.paymentType}`,
        amount,
        accountCode: debitAccountId,
        invoiceAllocations: [],
        referenceNumber: row.referenceNumber,
        description: row.notes,
        notes: row.notes,
      },
      expectedFor: (local) => ({
        referenceNumber: row.referenceNumber,
        date: requestDateOf(local),
        amount,
        lines: [
          { accountId: debitAccountId, debitOrCredit: 'debit', amount },
          { accountId: creditAccountId, debitOrCredit: 'credit', amount },
        ],
      }),
    }
  }

  const rawFeeLines = Array.isArray(preview.amazonFeeJournalLines) ? preview.amazonFeeJournalLines : []
  for (const row of feeJournalLinesWithIdentity(rawFeeLines, marketplace)) {
    entries.set(row.paymentType, journalEntry('fee_journal', row, Math.abs(round2(Number(row.totalAmount) || 0))))
  }
  const { lines } = readyReturnFeeJournalLines(batch)
  for (const row of lines) {
    entries.set(row.paymentType, journalEntry('return_fee_journal', row, Math.abs(round2(Number(row.amount) || 0))))
  }
  return { marketplace, customerId, currencyCode, entries, configProblem }
}

async function postReturnFeeJournalsForBatch({
  batch,
  store,
  dryRun = true,
  postedBy,
  createManualJournal = zohoPaymentService.createZohoManualJournal,
  buildJournalPayloadPreview = zohoPaymentService.buildManualJournalPayloadPreview,
  zohoLookup = null,
  env = process.env,
  isCreditNoteApplyComplete: creditNoteCheck = undefined,
}) {
  await ensureCanPostReturnFeeJournals(batch, { dryRun, isCreditNoteApplyComplete: creditNoteCheck })
  const marketplace = requireMarketplaceCode(batch.marketplace)
  const paymentDate = zohoPaymentService.todayLocalDate()
  const settlementReference = buildSettlementReference(batch)
  const { returnFeePlan, lines } = readyReturnFeeJournalLines(batch)
  assertPostingAccountsReady({ marketplace, env })
  const shapeProblems = journalShapeProblems(lines, returnFeePlan.journalLines || [])
  if (shapeProblems.length) throw journalShapeError(shapeProblems)

  const result = {
    success: true,
    dryRun: Boolean(dryRun),
    batchId: batch.batchId,
    marketplace,
    status: dryRun ? 'dry_run' : 'posted',
    settlementReference,
    summary: {
      journalsCreated: 0,
      journalsSkipped: 0,
      verificationRequired: 0,
      errors: 0,
    },
    journals: [],
    errors: [],
  }

  await postReturnFeeJournalRows({
    batch,
    store,
    dryRun,
    marketplace,
    env,
    paymentDate,
    createManualJournal,
    buildJournalPayloadPreview,
    lookupDeps: zohoLookup || recovery.defaultZohoLookupDeps(),
    result,
  })

  result.status = overallPostingStatus(result.summary, dryRun)
  result.success = result.summary.errors === 0 && result.summary.verificationRequired === 0

  if (!dryRun && result.success) {
    const currentBatch = await store.getBatchById(batch.batchId)
    const prevSummary = currentBatch?.postingSummary || {}
    const allPostings = await store.listPostingsForBatch(batch.batchId)
    const zohoJournalIds = allPostings
      .filter((row) => row.zohoPaymentId && row.status === STATUS.POSTED && String(row.paymentType || '').includes('journal'))
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
      returnFeeJournalsPosted: result.journals.filter((row) => row.status === 'created' || row.status === 'skipped').length,
      zohoJournalIds,
    })
  }

  return result
}

module.exports = {
  PAYMENT_TYPES,
  ensureCanPostBatch,
  ensureCanPostReturnFeeJournals,
  isReturnFeePostComplete,
  mergeInvoiceAllocations,
  validateInvoiceBalancesForPosting,
  validateRemainingInvoiceBalances,
  journalShapeProblems,
  readyReturnFeeJournalLines,
  flattenPaymentPreview,
  groupedPaymentRows,
  requireSingleCustomer,
  postApprovedBatch,
  postReturnFeeJournalsForBatch,
  describeExpectedEntries,
  feeJournalLinesWithIdentity,
  localJournalRowResolver,
  overallPostingStatus,
}
