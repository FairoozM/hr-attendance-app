/**
 * Posting progress and admin recovery actions for Amazon payment clearing.
 * Nothing here creates accounting records in Zoho: it reads Zoho and updates the
 * local posting ledger only after an exact live match.
 */
const {
  describeExpectedEntries,
  localJournalRowResolver,
} = require('./amazonPaymentClearingPostingService')
const {
  PAYMENT_TYPE: CN_REFUND_TYPE,
  CREATE_PAYMENT_TYPE: CN_CREATE_TYPE,
  LEGACY_PAYMENT_TYPE: CN_LEGACY_TYPE,
  collectReturnRowsForApply,
  settlementHasReturnApplyWork,
  localCreditNotePostingsByOrder,
} = require('./amazonPaymentClearingCreditNotePostingService')
const recovery = require('./amazonPaymentClearingZohoRecovery')
const { STATUS } = require('./amazonPaymentClearingSafeWrite')

const GROUP_LABELS = Object.freeze({
  sales_payment: 'Sales payments',
  fee_journal: 'Fee journals',
  credit_note: 'Credit notes and refunds',
  return_fee_journal: 'Return fee journals',
})

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function httpError(message, code, status) {
  const err = new Error(message)
  err.code = code
  err.status = status
  return err
}

function entryStatus(local) {
  if (!local) return 'not_started'
  if (local.status === STATUS.POSTED && local.zohoPaymentId) return 'posted'
  if (local.status === STATUS.FAILED) return 'failed'
  if (local.status === STATUS.PENDING || local.status === STATUS.VERIFICATION_REQUIRED) return 'verification_required'
  return 'verification_required'
}

function groupStatus(entries) {
  if (!entries.length) return 'not_required'
  const statuses = entries.map((row) => row.status)
  if (statuses.every((s) => s === 'posted')) return 'posted'
  if (statuses.some((s) => s === 'verification_required')) return 'verification_required'
  if (statuses.some((s) => s === 'posted')) return 'partially_posted'
  if (statuses.some((s) => s === 'failed')) return 'failed'
  return 'not_started'
}

function entryView(expected, local) {
  const status = entryStatus(local)
  const verification = local?.mappingSnapshot?.verification || null
  return {
    group: expected.group,
    paymentType: expected.paymentType,
    label: expected.label,
    amount: expected.amount,
    referenceNumber: expected.referenceNumber,
    status,
    postingId: local?.id || null,
    zohoId: local?.zohoPaymentId || '',
    zohoNumber: local?.zohoJournalNumber || '',
    error: status === 'posted' ? '' : local?.errorMessage || '',
    verification,
    legacyPaymentType: local && local.paymentType !== expected.paymentType ? local.paymentType : '',
  }
}

function recoveryActionsFor(entry) {
  if (entry.status === 'posted') return []
  if (entry.status === 'not_started' || entry.status === 'failed') {
    const actions = [{ action: 'resume', label: 'Post missing entry', description: 'Checks Zoho first, then posts only if nothing exists.' }]
    if (entry.group === 'sales_payment' || entry.group === 'fee_journal' || entry.group === 'return_fee_journal') {
      actions.push({ action: 'link', label: 'Link existing Zoho record', description: 'Use when the entry already exists in Zoho.' })
    }
    return actions
  }
  const actions = [
    { action: 'reverify', label: 'Re-check Zoho', description: 'Looks the entry up in Zoho again; marks it posted only on one exact match.' },
    { action: 'link', label: 'Link Zoho record', description: 'Confirm a specific Zoho record id after checking it in Zoho.' },
  ]
  if (entry.verification?.outcome === 'none') {
    actions.push({
      action: 'release',
      label: 'Release for retry',
      description: 'Only after confirming in Zoho that nothing was created. Re-checks Zoho before releasing.',
    })
  }
  return actions
}

/**
 * @param {{ batch: any, creditNoteBatch?: any, store: any, env?: NodeJS.ProcessEnv }} input
 */
async function buildPostingStatus({ batch, creditNoteBatch = null, store, env = process.env }) {
  const returnsBatch = creditNoteBatch || batch
  const described = describeExpectedEntries(batch, { env })
  const postings = await store.listPostingsForBatch(batch.batchId)
  const byType = new Map(postings.map((row) => [row.paymentType, row]))
  const expected = Array.from(described.entries.values())
  const feeResolver = localJournalRowResolver(
    postings,
    'fee',
    described.marketplace,
    expected.filter((row) => row.group === 'fee_journal')
  )
  const returnResolver = localJournalRowResolver(
    postings,
    'return_fee',
    described.marketplace,
    expected.filter((row) => row.group === 'return_fee_journal')
  )

  const localFor = (row) => {
    if (row.group === 'fee_journal') return feeResolver.find(row.paymentType)
    if (row.group === 'return_fee_journal') return returnResolver.find(row.paymentType)
    return byType.get(row.paymentType) || null
  }

  const groups = { sales_payment: [], fee_journal: [], return_fee_journal: [], credit_note: [] }
  for (const row of expected) {
    const view = entryView(row, localFor(row))
    view.actions = recoveryActionsFor(view)
    groups[row.group].push(view)
  }

  const returnRows = collectReturnRowsForApply(returnsBatch)
  const cnLocal = localCreditNotePostingsByOrder(postings)
  for (const row of returnRows) {
    const local = cnLocal.get(clean(row.orderId)) || { create: null, refund: null }
    const refundStatus = entryStatus(local.refund)
    const createStatus = local.create ? entryStatus(local.create) : ''
    const status =
      refundStatus === 'posted'
        ? 'posted'
        : [createStatus, refundStatus].includes('verification_required')
          ? 'verification_required'
          : [createStatus, refundStatus].includes('failed')
            ? 'failed'
            : createStatus === 'posted'
              ? 'partially_posted'
              : 'not_started'
    const uncertain = [local.create, local.refund].find((p) => p && entryStatus(p) === 'verification_required')
    const view = {
      group: 'credit_note',
      paymentType: CN_REFUND_TYPE,
      orderId: row.orderId,
      label: `Return ${row.orderId}`,
      amount: Math.abs(Number(row.creditNoteAmount || row.amazonRefundAmount) || 0),
      status,
      creditNote: local.create
        ? { postingId: local.create.id, status: createStatus, zohoId: local.create.zohoPaymentId || '', error: local.create.errorMessage || '' }
        : row.zohoCreditNoteId
          ? { postingId: null, status: 'existing', zohoId: row.zohoCreditNoteId, error: '' }
          : null,
      refund: local.refund
        ? { postingId: local.refund.id, status: refundStatus, zohoId: local.refund.zohoPaymentId || '', error: local.refund.errorMessage || '' }
        : null,
      postingId: uncertain?.id || local.refund?.id || local.create?.id || null,
      error: uncertain?.errorMessage || local.refund?.errorMessage || local.create?.errorMessage || '',
      verification: uncertain?.mappingSnapshot?.verification || null,
    }
    view.actions =
      status === 'verification_required'
        ? recoveryActionsFor({ ...view, group: 'credit_note' }).filter((a) => a.action !== 'link' || view.verification)
        : status === 'posted'
          ? []
          : [{ action: 'resume', label: 'Apply credit notes', description: 'Step 10 checks Zoho first and only sends missing creates/refunds.' }]
    groups.credit_note.push(view)
  }

  const unmappedLegacy = [...feeResolver.legacy.unmapped, ...returnResolver.legacy.unmapped].map((row) => ({
    postingId: row.id,
    paymentType: row.paymentType,
    zohoId: row.zohoPaymentId || '',
    amount: row.amount,
    referenceNumber: row.referenceNumber,
    status: row.status,
  }))

  const status = {
    sales_payment: groupStatus(groups.sales_payment),
    fee_journal: groupStatus(groups.fee_journal),
    credit_note: settlementHasReturnApplyWork(returnsBatch) || groups.credit_note.length ? groupStatus(groups.credit_note) : 'not_required',
    return_fee_journal: groupStatus(groups.return_fee_journal),
  }
  const done = (s) => s === 'posted' || s === 'not_required'
  const salesComplete = done(status.sales_payment) && done(status.fee_journal)
  const creditNotesComplete = done(status.credit_note)
  const returnFeesComplete = done(status.return_fee_journal)
  const settlementComplete = salesComplete && creditNotesComplete && returnFeesComplete

  const all = [...groups.sales_payment, ...groups.fee_journal, ...groups.credit_note, ...groups.return_fee_journal]
  const verificationCount = all.filter((row) => row.status === 'verification_required').length
  const postedCount = all.filter((row) => row.status === 'posted').length
  let overall = 'not_started'
  if (settlementComplete) overall = 'completed'
  else if (verificationCount) overall = 'verification_required'
  else if (salesComplete) overall = 'sales_posted'
  else if (postedCount) overall = 'partially_posted'
  else if (all.some((row) => row.status === 'failed')) overall = 'failed'

  const blockers = []
  if (described.configProblem) blockers.push({ step: 'sales_payment', message: described.configProblem })
  if (verificationCount) {
    blockers.push({
      step: 'verification',
      message: `${verificationCount} entr${verificationCount === 1 ? 'y needs' : 'ies need'} verification in Zoho before posting can continue. Automatic reposting is blocked for these entries.`,
    })
  }
  if (!salesComplete) {
    blockers.push({
      step: 'credit_note',
      message: 'Credit notes and refunds wait until every sales payment and fee journal is verified in Zoho (step 9).',
    })
  }
  if (!creditNotesComplete) {
    blockers.push({
      step: 'return_fee_journal',
      message: 'Return fee journals wait until every return credit note is created and refunded (step 10).',
    })
  }
  if (unmappedLegacy.length) {
    blockers.push({
      step: 'verification',
      message: `${unmappedLegacy.length} earlier journal posting row(s) could not be matched to a current journal; review them before posting more journals.`,
    })
  }

  return {
    success: true,
    batchId: batch.batchId,
    marketplace: described.marketplace,
    batchStatus: batch.status,
    overall,
    salesComplete,
    creditNotesComplete,
    returnFeesComplete,
    settlementComplete,
    groups: Object.entries(groups).map(([key, entries]) => ({
      key,
      label: GROUP_LABELS[key],
      status: status[key],
      entries,
    })),
    unmappedLegacyPostings: unmappedLegacy,
    blockers,
  }
}

/** Expected Zoho record + lookup for one local posting row. */
function expectationForPosting(posting, described, postings) {
  const type = clean(posting.paymentType)
  const snap = posting.mappingSnapshot || {}
  const req = snap.request || {}
  const withDate = (date) => (date ? { mappingSnapshot: { request: { date } } } : null)

  if (type === CN_CREATE_TYPE) {
    const expected = {
      customerId: clean(req.customerId),
      referenceNumber: clean(req.referenceNumber || posting.referenceNumber),
      date: clean(req.date) || null,
      total: Number(req.total ?? posting.amount) || 0,
      currencyCode: clean(req.currencyCode) || null,
    }
    return {
      kind: 'credit_note',
      expectedFor: (local) => ({ ...expected, date: local === null ? null : expected.date }),
      lookup: (exp, deps) => recovery.lookupCreditNote(exp, deps),
    }
  }
  if (type === CN_REFUND_TYPE || type === CN_LEGACY_TYPE) {
    const creditNoteId = clean(snap.zohoCreditNoteId)
    const expected = {
      referenceNumber: clean(req.referenceNumber || posting.referenceNumber),
      date: clean(req.date) || null,
      amount: Number(req.amount ?? posting.amount) || 0,
      fromAccountId: clean(req.fromAccountId || snap.refundAccountId) || null,
    }
    return {
      kind: 'credit_note_refund',
      creditNoteId,
      expectedFor: (local) => ({ ...expected, date: local === null ? null : expected.date }),
      lookup: (exp, deps) => recovery.lookupCreditNoteRefund(creditNoteId, exp, deps),
    }
  }

  const all = Array.from(described.entries.values())
  let entry = described.entries.get(type)
  if (!entry) {
    for (const kind of ['fee', 'return_fee']) {
      const resolver = localJournalRowResolver(postings, kind, described.marketplace, all)
      for (const [identity, row] of resolver.legacy.byIdentity) {
        if (row.id === posting.id) entry = described.entries.get(identity)
      }
    }
  }
  if (!entry) return null
  return {
    kind: entry.kind,
    entry,
    expectedFor: (local) => entry.expectedFor(local === null ? null : local || withDate(req.date)),
    lookup: (exp, deps) =>
      entry.kind === 'payment' ? recovery.lookupCustomerPayment(exp, deps) : recovery.lookupJournal(exp, deps),
    verifyById: (id, exp, deps) => recovery.verifyRecordById(entry.kind, id, exp, deps),
  }
}

async function loadPosting(store, batchId, postingId) {
  const postings = await store.listPostingsForBatch(batchId)
  const posting = postings.find((row) => Number(row.id) === Number(postingId))
  if (!posting) throw httpError('Posting row not found for this settlement.', 'AMAZON_PAYMENT_CLEARING_POSTING_NOT_FOUND', 404)
  return { posting, postings }
}

/**
 * Re-check one uncertain entry in Zoho. Marks it posted only when exactly one record
 * matches and this app sent the create (or it is the record already on file).
 */
async function reverifyPosting({ batch, store, postingId, actorUserId = null, zohoLookup = null, env = process.env }) {
  const { posting, postings } = await loadPosting(store, batch.batchId, postingId)
  const described = describeExpectedEntries(batch, { env })
  const exp = expectationForPosting(posting, described, postings)
  if (!exp) throw httpError('This posting row no longer matches a planned entry; review it manually.', 'AMAZON_PAYMENT_CLEARING_POSTING_UNPLANNED', 409)
  const deps = zohoLookup || recovery.defaultZohoLookupDeps()
  const check = await exp.lookup(exp.expectedFor(posting), deps)
  const attempted = Boolean(posting.mappingSnapshot?.attempted)
  const sameAsRecorded = posting.zohoPaymentId && check.match?.zohoId === posting.zohoPaymentId
  const verification = { reason: 'admin re-check', outcome: check.outcome, message: check.message, candidates: check.candidates, checkedAt: new Date().toISOString() }
  let updated
  if (check.outcome === 'exact' && (attempted || sameAsRecorded)) {
    updated = await store.updatePostingOutcome(posting.id, {
      status: STATUS.POSTED,
      zohoPaymentId: check.match.zohoId,
      zohoJournalNumber: check.match.zohoNumber || null,
      errorMessage: null,
      snapshotPatch: { verification },
    })
  } else {
    updated = await store.updatePostingOutcome(posting.id, {
      status: posting.status === STATUS.FAILED ? STATUS.FAILED : STATUS.VERIFICATION_REQUIRED,
      errorMessage:
        check.outcome === 'exact'
          ? `Exactly one matching Zoho record (${check.match.zohoNumber || check.match.zohoId}) exists but was not created by this posting run. Link it to continue.`
          : check.message,
      snapshotPatch: { verification },
    })
  }
  await store.insertClearingAudit({
    batchId: batch.batchId,
    action: 'posting_reverify',
    reason: `Posting ${posting.id} (${posting.paymentType}) re-checked: ${check.outcome}`,
    actorUserId,
    previousZohoPaymentIds: posting.zohoPaymentId ? [posting.zohoPaymentId] : [],
    details: { postingId: posting.id, outcome: check.outcome, candidates: check.candidates },
  })
  return { success: true, posting: updated, verification }
}

/**
 * Link a Zoho record the admin has checked. The record must exist live and match the
 * planned entry on every field (the existing Zoho date is accepted as-is).
 */
async function linkPosting({ batch, store, postingId = null, paymentType = '', zohoId, reason = '', actorUserId = null, zohoLookup = null, env = process.env }) {
  const id = clean(zohoId)
  if (!id) throw httpError('A Zoho record id is required to link.', 'AMAZON_PAYMENT_CLEARING_ZOHO_ID_REQUIRED', 422)
  if (!clean(reason)) throw httpError('A reason is required to link a Zoho record.', 'AMAZON_PAYMENT_CLEARING_REASON_REQUIRED', 422)
  const postings = await store.listPostingsForBatch(batch.batchId)
  const described = describeExpectedEntries(batch, { env })
  if (described.configProblem) throw httpError(described.configProblem, 'AMAZON_PAYMENT_CLEARING_ACCOUNT_CONFIG_INVALID', 422)
  const deps = zohoLookup || recovery.defaultZohoLookupDeps()

  let posting = postingId ? postings.find((row) => Number(row.id) === Number(postingId)) || null : null
  if (postingId && !posting) throw httpError('Posting row not found for this settlement.', 'AMAZON_PAYMENT_CLEARING_POSTING_NOT_FOUND', 404)
  if (posting && posting.status === STATUS.POSTED && posting.zohoPaymentId) {
    throw httpError('This entry is already posted and verified.', 'AMAZON_PAYMENT_CLEARING_POSTING_ALREADY_POSTED', 409)
  }
  let exp
  if (posting) {
    exp = expectationForPosting(posting, described, postings)
  } else {
    const entry = described.entries.get(clean(paymentType))
    if (!entry) throw httpError('Unknown entry for this settlement.', 'AMAZON_PAYMENT_CLEARING_POSTING_UNPLANNED', 404)
    const existing = postings.find((row) => row.paymentType === entry.paymentType)
    if (existing) throw httpError('A posting row already exists for this entry; link it by posting id.', 'AMAZON_PAYMENT_CLEARING_POSTING_CONFLICT', 409)
    exp = {
      kind: entry.kind,
      entry,
      expectedFor: () => entry.expectedFor(null),
      verifyById: (zid, e, d) => recovery.verifyRecordById(entry.kind, zid, e, d),
    }
  }
  if (!exp) throw httpError('This posting row no longer matches a planned entry.', 'AMAZON_PAYMENT_CLEARING_POSTING_UNPLANNED', 409)

  const expected = exp.expectedFor(null)
  let check
  if (exp.verifyById) {
    check = await exp.verifyById(id, expected, deps)
  } else {
    const found = await exp.lookup(expected, deps)
    const candidate = found.candidates.find((row) => row.zohoId === id)
    check = candidate
      ? { ...found, outcome: candidate.diffs.length || candidate.unverified.length ? 'conflict' : found.outcome, match: candidate }
      : { outcome: 'missing', match: null, candidates: found.candidates, message: `Zoho record ${id} was not found for this entry.` }
  }
  if (check.outcome !== 'exact') {
    throw Object.assign(
      httpError(`Cannot link: ${check.message}`, 'AMAZON_PAYMENT_CLEARING_LINK_MISMATCH', 409),
      { verification: check }
    )
  }
  const verification = { reason: `linked by admin: ${clean(reason)}`, outcome: 'exact', message: check.message, candidates: check.candidates, checkedAt: new Date().toISOString() }
  let saved
  if (posting) {
    saved = await store.updatePostingOutcome(posting.id, {
      status: STATUS.POSTED,
      zohoPaymentId: id,
      zohoJournalNumber: check.match?.zohoNumber || null,
      errorMessage: null,
      snapshotPatch: { verification, linkedBy: actorUserId, linkedAt: verification.checkedAt },
    })
  } else {
    saved = await store.insertPosting({
      ...exp.entry.rowTemplate,
      zohoPaymentId: id,
      zohoJournalNumber: check.match?.zohoNumber || null,
      status: STATUS.POSTED,
      mappingSnapshot: { identity: exp.entry.paymentType, attempted: false, verification, linkedBy: actorUserId, linkedAt: verification.checkedAt },
    })
  }
  await store.insertClearingAudit({
    batchId: batch.batchId,
    action: 'posting_link',
    reason: clean(reason),
    actorUserId,
    previousZohoPaymentIds: [],
    details: { postingId: saved?.id, paymentType: saved?.paymentType, zohoId: id },
  })
  return { success: true, posting: saved, verification }
}

/**
 * Release an uncertain entry for retry, only after Zoho confirms nothing exists.
 */
async function releasePosting({ batch, store, postingId, reason = '', actorUserId = null, zohoLookup = null, env = process.env }) {
  if (!clean(reason)) throw httpError('A reason is required to release an entry for retry.', 'AMAZON_PAYMENT_CLEARING_REASON_REQUIRED', 422)
  const { posting, postings } = await loadPosting(store, batch.batchId, postingId)
  if (posting.status !== STATUS.PENDING && posting.status !== STATUS.VERIFICATION_REQUIRED) {
    throw httpError('Only entries awaiting verification can be released.', 'AMAZON_PAYMENT_CLEARING_POSTING_NOT_UNCERTAIN', 409)
  }
  const described = describeExpectedEntries(batch, { env })
  const exp = expectationForPosting(posting, described, postings)
  if (!exp) throw httpError('This posting row no longer matches a planned entry.', 'AMAZON_PAYMENT_CLEARING_POSTING_UNPLANNED', 409)
  const deps = zohoLookup || recovery.defaultZohoLookupDeps()
  const relaxed = { ...exp.expectedFor(null) }
  const check = await exp.lookup(relaxed, deps)
  if (check.outcome !== 'none') {
    throw Object.assign(
      httpError(`Cannot release: Zoho still has related records. ${check.message}`, 'AMAZON_PAYMENT_CLEARING_RELEASE_BLOCKED', 409),
      { verification: check }
    )
  }
  const updated = await store.updatePostingOutcome(posting.id, {
    status: STATUS.FAILED,
    errorMessage: `Released for retry: no Zoho record found. ${clean(reason)}`,
    snapshotPatch: {
      verification: { reason: 'released by admin', outcome: 'none', message: check.message, candidates: [], checkedAt: new Date().toISOString() },
      releasedBy: actorUserId,
    },
  })
  await store.insertClearingAudit({
    batchId: batch.batchId,
    action: 'posting_release',
    reason: clean(reason),
    actorUserId,
    previousZohoPaymentIds: posting.zohoPaymentId ? [posting.zohoPaymentId] : [],
    details: { postingId: posting.id, paymentType: posting.paymentType },
  })
  return { success: true, posting: updated }
}

module.exports = {
  buildPostingStatus,
  reverifyPosting,
  linkPosting,
  releasePosting,
  expectationForPosting,
}
