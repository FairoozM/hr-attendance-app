const {
  listCreditNoteRefunds,
  createCreditNote,
  refundCreditNote,
} = require('../integrations/zoho/zohoBooksClient')
const {
  matchZohoInvoicesForRows,
  resolvePaymentClearingZohoCustomerId,
  resolveKsaZohoCustomerId,
} = require('./amazonPaymentClearingZohoMatcher')
const { buildSettlementReference, buildEntryReference } = require('./amazonPaymentClearingReferenceService')
const { round2 } = require('./amazonPaymentClearingOrderBreakdownService')
const { buildReturnFeeBreakdown } = require('./amazonPaymentClearingReturnFeeService')
const zohoPaymentService = require('./amazonPaymentClearingZohoPaymentService')
const store = require('./amazonPaymentClearingStore')
const { getPaymentClearingMarketplaceConfig } = require('./amazonPaymentClearingMarketplaceConfig')
const { requireMarketplaceCode, requireClearingAccountByCode } = require('./amazonPaymentClearingAccountGuard')
const { runSafeWrite, STATUS } = require('./amazonPaymentClearingSafeWrite')
const recovery = require('./amazonPaymentClearingZohoRecovery')
const { settlementCurrencyForCustomer } = require('./amazonPaymentClearingCurrencyService')

const TOLERANCE = 0.01
const PAYMENT_TYPE = 'credit_note_refund'
const CREATE_PAYMENT_TYPE = 'credit_note_create'
const LEGACY_PAYMENT_TYPE = 'credit_note_apply'
const UNDEPOSITED_ACCOUNT_CODE = '1024'
/** @deprecated Prefer marketplace undeposited account name from config */
const UNDEPOSITED_ACCOUNT_NAME = 'KSA-Amazon Undeposited Funds'

function undepositedAccountFor(marketplace) {
  const cfg = getPaymentClearingMarketplaceConfig(marketplace)
  return {
    accountCode: cfg.undepositedAccountCode,
    accountName: cfg.undepositedAccountName,
  }
}

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
  const principalOnly = positiveAmount(breakdown.principalRefundAmount)
  if (principalOnly > TOLERANCE) return principalOnly
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

const REFRESHED_CREDIT_NOTE_FIELDS = [
  'zohoCreditNoteId',
  'zohoCreditNoteNumber',
  'creditNoteAmount',
  'creditNoteStatus',
  'creditNoteDifference',
  'creditNoteAction',
  'status',
  'blockingReason',
]

function pickRefreshedCreditNote(fresh) {
  const out = {}
  for (const key of REFRESHED_CREDIT_NOTE_FIELDS) {
    if (fresh[key] !== undefined) out[key] = fresh[key]
  }
  if (clean(fresh.zohoInvoiceId)) out.zohoInvoiceId = clean(fresh.zohoInvoiceId)
  if (clean(fresh.zohoInvoiceNumber)) out.zohoInvoiceNumber = clean(fresh.zohoInvoiceNumber)
  return out
}

/**
 * Fold credit notes found live in Zoho into the stored return-match arrays, so every
 * screen that reads the saved batch stops treating those returns as missing.
 * Only orders the batch already knows about are touched.
 * @param {{ matchedReturns?: any[], missingCreditNotes?: any[], creditNoteBlockingRows?: any[] }} stored
 * @param {any[]} refreshedRows rows returned by refreshReturnRowsFromLiveZoho
 */
function mergeRefreshedReturnMatches(stored, refreshedRows) {
  const found = new Map()
  for (const row of Array.isArray(refreshedRows) ? refreshedRows : []) {
    const orderId = clean(row?.orderId)
    if (!orderId || !clean(row.zohoCreditNoteId) || row.status !== 'matched') continue
    found.set(orderId, row)
  }
  const missing = Array.isArray(stored?.missingCreditNotes) ? stored.missingCreditNotes : []
  const blocking = Array.isArray(stored?.creditNoteBlockingRows) ? stored.creditNoteBlockingRows : []
  const newlyFound = []
  const matchedReturns = (Array.isArray(stored?.matchedReturns) ? stored.matchedReturns : []).map((row) => {
    const orderId = clean(row?.orderId)
    const fresh = found.get(orderId)
    if (!fresh) return row
    if (row.status === 'matched' && clean(row.zohoCreditNoteId) === clean(fresh.zohoCreditNoteId)) return row
    newlyFound.push(orderId)
    return { ...row, ...pickRefreshedCreditNote(fresh) }
  })
  const inMatched = new Set(matchedReturns.map((row) => clean(row?.orderId)))
  for (const [orderId, fresh] of found) {
    if (inMatched.has(orderId)) continue
    const storedRow = [...missing, ...blocking].find((row) => clean(row?.orderId) === orderId)
    if (!storedRow) continue
    matchedReturns.push({ ...storedRow, ...pickRefreshedCreditNote(fresh) })
    inMatched.add(orderId)
    newlyFound.push(orderId)
  }
  const withoutFound = (rows) => rows.filter((row) => !found.has(clean(row?.orderId)))
  const missingCreditNotes = withoutFound(missing)
  const creditNoteBlockingRows = withoutFound(blocking)
  const changed =
    newlyFound.length > 0 || missingCreditNotes.length !== missing.length || creditNoteBlockingRows.length !== blocking.length
  return {
    changed,
    newlyFound: Array.from(new Set(newlyFound)).map((orderId) => ({
      orderId,
      zohoCreditNoteId: clean(found.get(orderId)?.zohoCreditNoteId),
      zohoCreditNoteNumber: clean(found.get(orderId)?.zohoCreditNoteNumber),
    })),
    matchedReturns,
    missingCreditNotes,
    creditNoteBlockingRows,
  }
}

function notReceivedOrderIds(batch) {
  return new Set(
    (Array.isArray(batch?.returnDispositions) ? batch.returnDispositions : [])
      .filter((row) => row?.disposition === 'not_received')
      .map((row) => clean(row.orderId))
      .filter(Boolean)
  )
}

function resolveCreditNoteRefundAmount(row) {
  return resolveCreditNoteApplyAmount(row)
}

async function resolveUndepositedRefundAccount(opts = {}) {
  const marketplace = requireMarketplaceCode(opts.marketplace)
  const undeposited = undepositedAccountFor(marketplace)
  if (opts.resolveDepositAccount) {
    return opts.resolveDepositAccount(
      {
        depositToAccountCode: undeposited.accountCode,
        depositToAccountName: undeposited.accountName,
        marketplace,
      },
      { marketplace, strictMarketplace: true }
    )
  }
  const account = requireClearingAccountByCode(marketplace, undeposited.accountCode, { env: opts.env })
  return { accountId: account.accountId, accountName: account.accountName, source: account.source }
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
  const marketplace = requireMarketplaceCode(opts.marketplace || batch?.marketplace)
  const undeposited = undepositedAccountFor(marketplace)
  const paymentDate = opts.paymentDate || zohoPaymentService.todayLocalDate()
  const settlementReference = buildSettlementReference(batch)
  const entry = buildEntryReference(settlementReference, 'refund_return', `Order ${row.orderId}`)
  const account = await resolveUndepositedRefundAccount({ ...opts, marketplace })
  const amount = resolveCreditNoteRefundAmount(row)
  return {
    amount,
    paymentDate,
    referenceNumber: entry.referenceNumber,
    description: entry.description,
    settlementReference,
    refundAccountCode: undeposited.accountCode,
    refundAccountName: account.accountName || undeposited.accountName,
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

function buildCreateCreditNotePayload(row, customerId, paymentDate, marketplace = 'KSA') {
  const orderId = clean(row.orderId)
  const amount = positiveAmount(row.amazonRefundAmount)
  const label = getPaymentClearingMarketplaceConfig(marketplace).label
  return {
    customer_id: customerId,
    date: paymentDate,
    reference_number: orderId,
    line_items: [
      {
        name: `${label} return ${orderId}`,
        description: `${label} return ${orderId}`,
        rate: amount,
        quantity: 1,
      },
    ],
  }
}

async function resolvePlanRowAction(row, batch, opts = {}) {
  const marketplace = requireMarketplaceCode(opts.marketplace || batch?.marketplace)
  const undeposited = undepositedAccountFor(marketplace)
  const listRefunds = opts.listRefunds || uncachedRefunds
  const invoiceId = clean(row.zohoInvoiceId)
  const creditNoteId = clean(row.zohoCreditNoteId)
  const refundAmount = creditNoteId ? resolveCreditNoteRefundAmount(row) : positiveAmount(row.amazonRefundAmount)
  const settlementReference = buildSettlementReference(batch)
  const entry = buildEntryReference(settlementReference, 'refund_return', `Order ${row.orderId}`)
  const matchOpts = { ...opts, marketplace }

  const baseFields = {
    orderId: row.orderId,
    amazonRefundAmount: positiveAmount(row.amazonRefundAmount),
    creditNoteAmount: positiveAmount(row.creditNoteAmount),
    zohoInvoiceId: invoiceId,
    zohoInvoiceNumber: row.zohoInvoiceNumber || '',
    zohoCreditNoteId: creditNoteId,
    zohoCreditNoteNumber: row.zohoCreditNoteNumber || '',
    refundAccountCode: undeposited.accountCode,
    refundAccountName: undeposited.accountName,
    referenceNumber: entry.referenceNumber,
    description: entry.description,
  }

  if (notReceivedOrderIds(batch).has(clean(row.orderId))) {
    if (creditNoteId) {
      return {
        ...baseFields,
        action: 'blocked',
        status: 'blocked',
        applyAmount: 0,
        refundAmount: 0,
        blockingReason: `Marked not received, but Zoho now has credit note ${row.zohoCreditNoteNumber || creditNoteId} for this order. Undo the mark (step 10) or void the credit note in Zoho.`,
      }
    }
    return {
      ...baseFields,
      action: 'moved_to_not_received',
      status: 'completed',
      applyAmount: 0,
      refundAmount: 0,
    }
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
    const refundRequest = await buildRefundCreditNoteRequest({ ...row, creditNoteAmount: refundAmount }, batch, matchOpts)
    return {
      ...baseFields,
      action: 'refund_existing',
      status: 'ready',
      applyAmount: remaining,
      refundAmount: remaining,
      amountAlreadyRefunded: refunded,
      refundAccountId: refundRequest.refundAccountId,
      refundAccountName: refundRequest.refundAccountName || undeposited.accountName,
      zohoRefundRequest: {
        ...refundRequest.zohoRefundRequest,
        amount: remaining,
      },
    }
  }

  if (row.creditNoteAction === 'ready_to_create') {
    const customerId = opts.offline
      ? clean(opts.customerId) || null
      : await resolvePaymentClearingZohoCustomerId(matchOpts)
    const paymentDate = opts.paymentDate || zohoPaymentService.todayLocalDate()
    return {
      ...baseFields,
      action: 'create_and_refund',
      status: 'ready',
      applyAmount: refundAmount,
      refundAmount,
      zohoCustomerId: customerId,
      zohoCreateRequest: buildCreateCreditNotePayload(row, customerId, paymentDate, marketplace),
      zohoRefundRequest: (await buildRefundCreditNoteRequest(row, batch, { ...matchOpts, paymentDate })).zohoRefundRequest,
    }
  }

  return {
    ...buildBlockedPlanRow(row, batch, matchOpts),
    refundAmount: refundAmount,
    refundAccountCode: undeposited.accountCode,
    refundAccountName: undeposited.accountName,
  }
}

function uncachedRefunds(creditNoteId) {
  return listCreditNoteRefunds(creditNoteId, { source: 'amazon_payment_clearing_verify', skipCache: true })
}

function postingSummary(posting) {
  return {
    postingId: posting.id,
    paymentType: posting.paymentType,
    status: posting.status,
    zohoId: posting.zohoPaymentId || '',
    errorMessage: posting.errorMessage || '',
  }
}

/** Local create/refund posting rows per return order (legacy credit_note_apply counts as refund). */
function localCreditNotePostingsByOrder(postings) {
  const out = new Map()
  for (const posting of Array.isArray(postings) ? postings : []) {
    const type = posting.paymentType
    if (type !== PAYMENT_TYPE && type !== LEGACY_PAYMENT_TYPE && type !== CREATE_PAYMENT_TYPE) continue
    const orderId = clean(posting.orderId)
    if (!orderId) continue
    const entry = out.get(orderId) || { create: null, refund: null }
    if (type === CREATE_PAYMENT_TYPE) entry.create = posting
    else if (!entry.refund || type === PAYMENT_TYPE) entry.refund = posting
    out.set(orderId, entry)
  }
  return out
}

function isCreditNotePlanRowComplete(row) {
  return (
    row.action === 'skipped_already_refunded' ||
    row.action === 'skipped_already_applied' ||
    row.action === 'skipped_already_posted' ||
    row.action === 'moved_to_not_received' ||
    row.status === 'posted' ||
    row.status === 'completed'
  )
}

async function buildCreditNoteApplyPlan(batch, opts = {}) {
  const marketplace = requireMarketplaceCode(opts.marketplace || batch?.marketplace)
  const matchOpts = {
    ...opts,
    marketplace,
    customerId: opts.customerId || batch.zohoCustomerId || null,
    customerName: opts.customerName || batch.zohoCustomerName || null,
  }
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {}
  let rows = collectReturnRowsForApply(batch)
  if (matchOpts.offline) matchOpts.refreshZoho = false
  if (matchOpts.refreshZoho !== false && rows.length > 0) {
    onProgress({ step: 'Loading invoices and credit notes from Zoho', current: 0, total: 0 })
    rows = await refreshReturnRowsFromLiveZoho(batch, rows, matchOpts)
    if (typeof opts.onRefreshedRows === 'function') await opts.onRefreshedRows(rows)
  }
  const planRows = []
  for (const [index, row] of rows.entries()) {
    onProgress({ step: `Checking refunds in Zoho for order ${row.orderId}`, current: index, total: rows.length })
    planRows.push(await resolvePlanRowAction(row, batch, matchOpts))
  }

  const summary = planRows.reduce(
    (acc, row) => {
      acc.totalRows += 1
      if (row.action === 'skipped_already_refunded' || row.action === 'skipped_already_applied') acc.skippedAlreadyRefunded += 1
      if (row.action === 'refund_existing' || row.action === 'apply_existing') acc.refundExisting += 1
      if (row.action === 'create_and_refund' || row.action === 'create_and_apply') acc.createAndRefund += 1
      if (row.action === 'blocked') acc.blocked += 1
      if (row.action === 'moved_to_not_received') acc.movedToNotReceived += 1
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
      movedToNotReceived: 0,
      completed: 0,
    }
  )
  const existingPostings = await (opts.store || store).listPostingsForBatch(batch.batchId)
  const localByOrder = localCreditNotePostingsByOrder(existingPostings)
  for (const row of planRows) {
    const local = localByOrder.get(clean(row.orderId))
    if (!local) continue
    row.localCreate = local.create ? postingSummary(local.create) : null
    row.localRefund = local.refund ? postingSummary(local.refund) : null
    if (local.refund?.status === STATUS.POSTED) {
      row.action = 'skipped_already_posted'
      row.status = 'completed'
      continue
    }
    const uncertain = [local.create, local.refund].find(
      (posting) => posting && (posting.status === STATUS.PENDING || posting.status === STATUS.VERIFICATION_REQUIRED)
    )
    if (uncertain) {
      row.status = 'verification_required'
      row.verificationMessage = uncertain.errorMessage || 'An earlier Zoho write for this return has an unconfirmed outcome.'
    }
  }
  summary.verificationRequired = planRows.filter((row) => row.status === 'verification_required').length
  summary.blocked = planRows.filter((row) => row.action === 'blocked').length
  summary.completed = planRows.filter((row) => isCreditNotePlanRowComplete(row)).length
  summary.skippedAlreadyApplied = summary.skippedAlreadyRefunded
  summary.applyExisting = summary.refundExisting
  summary.createAndApply = summary.createAndRefund
  summary.isComplete =
    !settlementHasReturnApplyWork(batch) ||
    (planRows.length > 0 &&
      summary.blocked === 0 &&
      summary.verificationRequired === 0 &&
      planRows.every((row) => isCreditNotePlanRowComplete(row)))

  return {
    batchId: batch.batchId,
    rows: planRows,
    summary,
  }
}

/** Uses the saved credit note matches; "Refresh credit notes from Zoho" is what re-reads them. */
async function isCreditNoteApplyComplete(batchId, batchOverride = null, opts = {}) {
  const batch = batchOverride || await store.getBatchById(batchId)
  if (!batch) return false
  const returnCount = collectReturnRowsForApply(batch).length
  if (returnCount === 0) return !settlementHasReturnApplyWork(batch)
  const plan = await buildCreditNoteApplyPlan(batch, { refreshZoho: false, ...opts })
  return Boolean(plan.summary?.isComplete)
}

function requestDateOf(localRow) {
  return clean(localRow?.mappingSnapshot?.request?.date) || null
}

function creditNoteTotal(payload) {
  return round2(
    (Array.isArray(payload?.line_items) ? payload.line_items : []).reduce(
      (sum, line) => sum + num(line.rate) * (num(line.quantity) || 1),
      0
    )
  )
}

function rowOutcomeStatus(outcome) {
  if (outcome.status === STATUS.POSTED) return outcome.alreadyPosted && !outcome.created ? 'skipped' : 'posted'
  if (outcome.status === STATUS.VERIFICATION_REQUIRED) return 'verification_required'
  return 'error'
}

/**
 * Create (when needed) and refund each return credit note. Each Zoho write goes
 * through the safe-write state machine, so a timeout or restart never re-sends a
 * create or refund whose outcome is unknown.
 */
async function applyCreditNotesForBatch(batch, options = {}) {
  const dryRun = options.dryRun !== false
  const marketplace = requireMarketplaceCode(batch?.marketplace)
  const postingStore = options.store || store
  const paymentDate = options.paymentDate || zohoPaymentService.todayLocalDate()
  const plan = await buildCreditNoteApplyPlan(batch, {
    marketplace,
    paymentDate,
    listRefunds: options.listRefunds,
    resolveDepositAccount: options.resolveDepositAccount,
    env: options.env,
    store: postingStore,
    onProgress: options.onProgress,
    onRefreshedRows: options.onRefreshedRows,
    ...(options.refreshZoho === false ? { refreshZoho: false } : {}),
  })

  const result = {
    success: true,
    dryRun,
    batchId: batch.batchId,
    marketplace,
    plan,
    summary: {
      created: 0,
      applied: 0,
      refunded: 0,
      skipped: 0,
      verificationRequired: 0,
      errors: 0,
    },
    rows: [],
    errors: [],
  }

  if (dryRun) {
    return result
  }

  const lookupDeps = options.zohoLookup || recovery.defaultZohoLookupDeps()
  const createCn = options.createCreditNote || createCreditNote
  const refundCn = options.refundCreditNote || refundCreditNote
  const currencyCode = settlementCurrencyForCustomer(
    batch.zohoCustomerName,
    batch.report?.currency,
    getPaymentClearingMarketplaceConfig(marketplace).currency
  )
  const undeposited = undepositedAccountFor(marketplace)

  const record = (row, status, extra = {}) => {
    const out = { ...row, ...extra, status }
    if (status === 'error') {
      result.summary.errors += 1
      result.errors.push(out)
    } else if (status === 'verification_required') {
      result.summary.verificationRequired += 1
    }
    result.rows.push(out)
  }

  const reportProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {}
  for (const [index, row] of plan.rows.entries()) {
    reportProgress({ step: `Order ${row.orderId}`, current: index, total: plan.rows.length })
    if (
      row.action === 'skipped_already_refunded' ||
      row.action === 'skipped_already_applied' ||
      row.action === 'skipped_already_posted' ||
      row.action === 'moved_to_not_received'
    ) {
      result.summary.skipped += 1
      result.rows.push({ ...row, status: 'skipped' })
      continue
    }
    if (row.action === 'blocked') {
      record(row, 'error', { error: row.blockingReason || 'Credit note apply is blocked for this return row.' })
      continue
    }
    if (!clean(row.zohoInvoiceId)) {
      record(row, 'error', { error: 'Return row has no Zoho invoice id.' })
      continue
    }

    try {
      let creditNoteId = clean(row.zohoCreditNoteId)
      let creditNoteNumber = row.zohoCreditNoteNumber || ''

      if (row.action === 'create_and_refund' || row.action === 'create_and_apply') {
        const createPayload = row.zohoCreateRequest || {}
        const total = creditNoteTotal(createPayload)
        const expected = (localRow) => ({
          customerId: clean(createPayload.customer_id),
          referenceNumber: clean(createPayload.reference_number),
          date: requestDateOf(localRow),
          total,
          currencyCode,
        })
        const created = await runSafeWrite({
          store: postingStore,
          label: `Credit note for order ${row.orderId}`,
          row: {
            batchId: batch.batchId,
            invoiceId: row.zohoInvoiceId,
            orderId: row.orderId,
            paymentType: CREATE_PAYMENT_TYPE,
            amount: total,
            accountCode: '',
            invoiceAllocations: [],
            referenceNumber: clean(createPayload.reference_number),
            description: row.description,
            mappingSnapshot: {
              marketplace,
              request: {
                date: createPayload.date,
                customerId: clean(createPayload.customer_id),
                total,
                referenceNumber: clean(createPayload.reference_number),
                currencyCode,
              },
            },
          },
          lookup: (localRow) => recovery.lookupCreditNote(expected(localRow), lookupDeps),
          create: async () => {
            const cn = await createCn(createPayload, { retryTransport: false })
            return { zohoId: cn?.creditNoteId || '', zohoNumber: cn?.creditNoteNumber || '' }
          },
        })
        if (created.status !== STATUS.POSTED) {
          record(row, rowOutcomeStatus(created), {
            step: 'create_credit_note',
            error: created.message,
            verification: created.verification || null,
          })
          continue
        }
        if (created.created) result.summary.created += 1
        creditNoteId = created.zohoId
        creditNoteNumber = created.zohoNumber || creditNoteNumber
      }

      const refundPayload = row.zohoRefundRequest || {
        date: paymentDate,
        amount: row.refundAmount ?? row.applyAmount,
        reference_number: row.referenceNumber,
        description: row.description,
        from_account_id: row.refundAccountId,
      }
      const fromAccountId = clean(refundPayload.from_account_id)
      if (!creditNoteId || !fromAccountId) {
        record(row, 'error', {
          step: 'refund_credit_note',
          error: !creditNoteId ? 'No Zoho credit note to refund.' : `No ${marketplace} undeposited funds account for the refund.`,
        })
        continue
      }
      const refundAmount = round2(num(refundPayload.amount))
      const expectedRefund = (localRow) => ({
        referenceNumber: clean(refundPayload.reference_number),
        date: requestDateOf(localRow),
        amount: refundAmount,
        fromAccountId,
      })
      const refunded = await runSafeWrite({
        store: postingStore,
        label: `Credit note refund for order ${row.orderId}`,
        row: {
          batchId: batch.batchId,
          invoiceId: row.zohoInvoiceId,
          orderId: row.orderId,
          paymentType: PAYMENT_TYPE,
          amount: refundAmount,
          accountCode: row.refundAccountCode || undeposited.accountCode,
          invoiceAllocations: [],
          referenceNumber: clean(refundPayload.reference_number),
          description: row.description,
          mappingSnapshot: {
            action: row.action,
            marketplace,
            zohoCreditNoteId: creditNoteId,
            zohoCreditNoteNumber: creditNoteNumber,
            refundAccountId: fromAccountId,
            refundAccountName: row.refundAccountName || undeposited.accountName,
            request: {
              date: refundPayload.date,
              amount: refundAmount,
              referenceNumber: clean(refundPayload.reference_number),
              fromAccountId,
            },
          },
        },
        lookup: (localRow) => recovery.lookupCreditNoteRefund(creditNoteId, expectedRefund(localRow), lookupDeps),
        create: async () => {
          const out = await refundCn(creditNoteId, refundPayload, { retryTransport: false })
          return { zohoId: out?.creditNoteRefundId || '', extra: { zohoCreditNoteRefundId: out?.creditNoteRefundId || '' } }
        },
      })
      const status = rowOutcomeStatus(refunded)
      if (status === 'posted') {
        result.summary.refunded += 1
        result.summary.applied += 1
      } else if (status === 'skipped') {
        result.summary.skipped += 1
      }
      record(row, status, {
        step: 'refund_credit_note',
        zohoCreditNoteId: creditNoteId,
        zohoCreditNoteNumber: creditNoteNumber,
        zohoCreditNoteRefundId: refunded.zohoId,
        postingId: refunded.posting?.id,
        error: status === 'error' || status === 'verification_required' ? refunded.message : undefined,
        verification: refunded.verification || null,
      })
    } catch (err) {
      record(row, 'error', {
        error: err?.message || 'Credit note refund failed',
        code: err?.code || 'CREDIT_NOTE_REFUND_FAILED',
      })
    }
  }

  result.success = result.summary.errors === 0 && result.summary.verificationRequired === 0
  return result
}

module.exports = {
  PAYMENT_TYPE,
  CREATE_PAYMENT_TYPE,
  LEGACY_PAYMENT_TYPE,
  UNDEPOSITED_ACCOUNT_CODE,
  UNDEPOSITED_ACCOUNT_NAME,
  TOLERANCE,
  isCreditNotePlanRowComplete,
  collectReturnRowsForApply,
  settlementHasReturnApplyWork,
  refreshReturnRowsFromLiveZoho,
  mergeRefreshedReturnMatches,
  notReceivedOrderIds,
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
  localCreditNotePostingsByOrder,
}
