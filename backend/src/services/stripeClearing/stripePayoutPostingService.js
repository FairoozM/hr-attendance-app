'use strict'

/**
 * Guarded Zoho posting of one payout + customer group (never per PaymentIntent).
 *
 * Order: NET customer payment → verify → FEE customer payment → verify → (when the group
 * has an admin-confirmed overpayment) CUSTOMER_ADVANCE journal → verify. The advance
 * refund journal is never part of this: it belongs to the later payout holding the refund.
 *
 * Last, once every group is posted and verified: one payout-level fee journal
 * (Dr Stripe Fees / Cr 1013 for the payout's total Stripe fees, no customer).
 *
 * Per normal (invoice) Stripe refund in the payout, independently: refund of the existing
 * credit note from 1019 → verify → (when Stripe changed its fee on the refund) the refund fee
 * journal between 1019 and 1013 → verify. Customer advance refunds are never posted here.
 *
 * Every request:
 * - requires the server posting gate (STRIPE_CLEARING_POSTING_ENABLED + live Stripe key);
 * - holds a per-payout advisory lock;
 * - re-runs the live preview and refuses unless the group is still postable and its
 *   accounting plan equals the one the admin reviewed (posting fingerprint);
 * - dates every new Zoho record with the current Asia/Dubai day on the server (never the payout
 *   arrival day); the date is part of the fingerprint, so a preview from before Dubai midnight
 *   is refused;
 * - searches Zoho right before each POST; an exact existing record is recorded, not recreated;
 * - never retries an uncertain POST: it searches Zoho for the deterministic record instead.
 */

const { getStripeClearingConfig } = require('../../config/stripeClearing')
const defaultStripeConfig = require('../../config/stripe')
const { postingGate } = require('./stripeClearingGate')
const { postErrorKind } = require('./stripeClearingPostingService')
const model = require('./stripePayoutClearingModel')
const payoutStore = require('./stripePayoutClearingStore')
const preview = require('./stripePayoutPreviewService')
const writer = require('./stripePayoutZohoWriter')
const { getDubaiPostingDate } = require('./stripePostingDate')

const { GROUP_STATUS, COMPONENT, ZOHO_STATE, RECOVERY_ACTION } = model
const { COMPONENT_STATUS, CASE_STATUS, EVENT } = payoutStore

const PAYOUT_PATTERN = /^po_[A-Za-z0-9]{8,64}$/
const REFUND_PATTERN = /^re_[A-Za-z0-9]{8,64}$/
const POSTING_ORDER = [COMPONENT.NET, COMPONENT.FEE, COMPONENT.CUSTOMER_ADVANCE]
const REFUND_POSTING_ORDER = [COMPONENT.REFUND_CREDIT_NOTE_REFUND, COMPONENT.REFUND_FEE_ADJUSTMENT]
const { NORMAL_REFUND_STATUS } = model
const RUNNABLE_REFUND = new Set([NORMAL_REFUND_STATUS.READY, NORMAL_REFUND_STATUS.FAILED, NORMAL_REFUND_STATUS.POSTED, NORMAL_REFUND_STATUS.VERIFIED])
// ALREADY_POSTED runs only to record the existing Zoho records locally; nothing is sent.
const RUNNABLE_GROUP = new Set([GROUP_STATUS.READY, GROUP_STATUS.READY_WITH_CUSTOMER_ADVANCE, GROUP_STATUS.PARTIALLY_POSTED, GROUP_STATUS.ALREADY_POSTED])
const ADVANCE_CASE_OK = new Set([CASE_STATUS.CONFIRMED, CASE_STATUS.ADVANCE_POSTED])

function defaultDeps() {
  const db = require('../../db')
  return {
    config: getStripeClearingConfig(),
    stripeConfig: defaultStripeConfig,
    store: payoutStore,
    writer,
    pool: db.pool,
    previewDeps: {},
    now: () => new Date(),
  }
}

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function fail(status, code, message, extra = {}) {
  const err = new Error(message)
  err.status = status
  err.code = code
  Object.assign(err, extra)
  return err
}

function safeMessage(err, stripeConfig) {
  return stripeConfig.redact(String((err && err.message) || err || 'Unknown error')).slice(0, 500)
}

function resolveCustomer(customerKey, config) {
  const key = clean(customerKey)
  if (key.toLowerCase() === 'website' || key === config.websiteZohoCustomerId) return config.websiteZohoCustomerId
  if (key.toLowerCase() === 'burjman' || key === config.shopZohoCustomerId) return config.shopZohoCustomerId
  throw fail(400, 'INVALID_CUSTOMER', 'Customer must be "website" or "burjman".')
}

const RECORD_LABEL = { journal: 'journal', creditnote_refund: 'credit note refund' }
const recordLabel = (c) => RECORD_LABEL[c.zohoRecordType] || 'customer payment'

function createRecord(c, writer) {
  if (c.zohoRecordType === 'journal') return writer.createJournal(c.payload)
  if (c.zohoRecordType === 'creditnote_refund') return writer.createCreditNoteRefund(c.creditNoteId, c.payload)
  return writer.createCustomerPayment(c.payload)
}

const VERIFIED_FIELDS = {
  [COMPONENT.PAYOUT_FEE_JOURNAL]: 'reference, date, accounts and amount match; no customer tag',
  [COMPONENT.REFUND_CREDIT_NOTE_REFUND]: 'reference, credit note, date, amount and Stripe Undeposited Funds account match',
  [COMPONENT.REFUND_FEE_ADJUSTMENT]: 'reference, date, accounts and amount match; no customer tag',
}

/** The live preview must be dated today (Asia/Dubai, server clock); Dubai midnight in between refuses. */
function assertPostingDate(result, ctx) {
  const today = getDubaiPostingDate(ctx.now())
  if (result.zohoPostingDate !== today) {
    throw fail(409, 'POSTING_DATE_CHANGED', `The Zoho posting date is now ${today} (Asia/Dubai), not ${result.zohoPostingDate}. Reload the preview and review it again. Nothing was posted.`)
  }
}

/** Everything checked against the live preview before any Zoho record is created. */
function assertPostable(result, group, fingerprint, config) {
  const needsReview = (code, message, reasons) => fail(409, code, message, { reasons, groupStatus: GROUP_STATUS.NEEDS_REVIEW })
  if (group.postingFingerprint !== fingerprint) {
    throw needsReview('PREVIEW_CHANGED', 'The payout, invoices, accounts, customer advance or Zoho posting date changed since this preview. Reload the preview and review it again. Nothing was posted.')
  }
  if (result.payout.status !== 'paid') throw needsReview('PAYOUT_NOT_PAID', `Payout status is ${result.payout.status}. Nothing was posted.`)
  if (result.blockers.length > 0) throw needsReview('PAYOUT_NEEDS_REVIEW', 'The payout does not reconcile. Nothing was posted.', result.blockers)
  if (!RUNNABLE_GROUP.has(group.status)) {
    throw needsReview('GROUP_NOT_POSTABLE', `${group.customerName} is ${group.status}. Nothing was posted.`, group.reasons)
  }
  const unexpected = group.components.filter((c) => !POSTING_ORDER.includes(c.component))
  if (unexpected.length > 0) throw needsReview('UNEXPECTED_COMPONENT', `${unexpected.map((c) => c.component).join(', ')} is not part of payout posting.`)
  const byKind = new Map(group.components.map((c) => [c.component, c]))
  const net = byKind.get(COMPONENT.NET)
  const fee = byKind.get(COMPONENT.FEE)
  const adv = byKind.get(COMPONENT.CUSTOMER_ADVANCE)
  if (!net || !fee) throw needsReview('COMPONENTS_MISSING', 'The group has no NET and FEE payments to post.')

  const accounts = result.accounts
  const problems = []
  if (!accounts.net || net.depositAccountId !== accounts.net.accountId || net.payload.account_id !== accounts.net.accountId) problems.push('NET is not deposited to the verified Stripe Undeposited Funds account.')
  if (!accounts.fee || fee.depositAccountId !== accounts.fee.accountId || fee.payload.account_id !== accounts.fee.accountId) problems.push('FEE is not deposited to the verified Stripe Processing Chg Un-Cleared account.')
  for (const c of [net, fee]) {
    if (c.payload.customer_id !== group.customerId) problems.push(`${c.component} is not for customer ${group.customerName}.`)
  }
  for (const c of [net, fee, adv].filter(Boolean)) {
    if (model.proposedDate(c) !== result.zohoPostingDate) problems.push(`${c.component} is not dated with the Zoho posting date ${result.zohoPostingDate}.`)
  }

  const advanceLines = group.lines.filter((l) => l.customerAdvance > 0)
  if (advanceLines.length > 0 || adv) {
    if (!adv || advanceLines.length === 0) problems.push('The customer advance journal does not match the overpaid charges.')
    else {
      const caseIds = []
      for (const l of advanceLines) {
        if (!l.advance || !l.advance.confirmed || !l.advance.caseId || !ADVANCE_CASE_OK.has(l.advance.caseStatus)) {
          problems.push(`The customer advance on ${l.invoice ? l.invoice.invoiceNumber : l.chargeId} is not admin-confirmed.`)
        } else caseIds.push(l.advance.caseId)
      }
      const same = (a, b) => JSON.stringify([...a].map(String).sort()) === JSON.stringify([...b].map(String).sort())
      if (!same(caseIds, adv.advanceCaseIds)) problems.push('The customer advance journal is not linked to exactly the confirmed advance cases.')
      const advanceMinor = advanceLines.reduce((s, l) => s + Math.round(l.customerAdvance * 100), 0)
      if (Math.round(adv.amount * 100) !== advanceMinor) problems.push('The customer advance journal amount does not equal the confirmed overpayments.')
      if (!accounts.net || adv.debitAccountId !== accounts.net.accountId) problems.push('The advance journal does not debit the verified Stripe Undeposited Funds account.')
      if (!accounts.advance || adv.creditAccountId !== accounts.advance.accountId || adv.creditAccountId !== config.advanceAccountId) {
        problems.push('The advance journal does not credit the verified Customer Advance Funds account.')
      }
      const tagged = (adv.payload.line_items || []).filter((li) => li.customer_id)
      if (tagged.length !== 1 || tagged[0].account_id !== config.advanceAccountId || tagged[0].customer_id !== group.customerId) {
        problems.push(`The Customer Advance Funds line is not tagged to ${group.customerName}.`)
      }
    }
  }
  if (problems.length > 0) throw needsReview('GROUP_CHANGED', `${group.customerName} cannot be posted. Nothing was posted.`, problems)
  return POSTING_ORDER.map((k) => byKind.get(k)).filter(Boolean)
}

function componentRow(c, payoutId, customerId, currency) {
  return {
    payoutId,
    zohoCustomerId: customerId,
    component: c.component,
    zohoRecordType: c.zohoRecordType,
    amount: c.amount,
    currency,
    depositAccountId: c.depositAccountId || null,
    debitAccountId: c.debitAccountId || null,
    creditAccountId: c.creditAccountId || null,
    reference: c.reference,
    allocations: c.allocations,
    advanceCaseIds: c.advanceCaseIds,
  }
}

function outcomeOf(c, local, extra = {}) {
  return {
    component: c.component,
    amount: c.amount,
    reference: c.reference,
    status: local.status,
    zohoRecordId: local.zohoRecordId,
    attemptCount: local.attemptCount,
    lastError: local.lastError,
    postedAt: local.postedAt,
    verifiedAt: local.verifiedAt,
    requestSent: false,
    ...extra,
  }
}

/** A rejection Zoho provably did not act on; anything else may have created the record. */
function writeErrorKind(err) {
  if (Number(err && err.httpStatus) === 408) return 'ambiguous'
  return postErrorKind(err)
}

const UNCERTAIN_LOCAL = [COMPONENT_STATUS.POSTING_UNCERTAIN, COMPONENT_STATUS.POSTING]

// Everything the Zoho lookups compare against; stored with each attempt.
const SNAPSHOT_KEYS = [
  'component', 'zohoRecordType', 'amount', 'currency', 'reference', 'date', 'depositAccountId', 'debitAccountId', 'creditAccountId',
  'allocations', 'advanceCaseIds', 'creditNoteId', 'candidateCreditNoteIds', 'direction', 'signedFeeMinor', 'signedAmount', 'payload',
]

function requestSnapshot(c) {
  const out = {}
  for (const key of SNAPSHOT_KEYS) if (c[key] !== undefined) out[key] = c[key]
  return out
}

/** Read-only recovery lookup with the strongest direct evidence; never throws. */
async function recoveryLookup(c, ctx) {
  try {
    return await ctx.zohoStateDeep(c)
  } catch (err) {
    return { state: null, error: safeMessage(err, ctx.stripeConfig) }
  }
}

function evidenceOf(lookup, at) {
  if (lookup.error) return { checkedAt: at, complete: false, searchError: lookup.error }
  return { checkedAt: at, complete: true, state: lookup.state, recordId: lookup.recordId || null, records: lookup.records || [], differences: lookup.differences || [], reason: lookup.reason || null }
}

// An uncertain episode keeps its start; an interrupted POSTING row starts one now.
const newEpisodeAt = (local, at) => (local.status === COMPONENT_STATUS.POSTING_UNCERTAIN && local.uncertainSince ? null : at)

/**
 * Apply one read-only recovery lookup to a component whose Zoho write may have happened:
 * exact match → VERIFIED, conflict → NEEDS_REVIEW, missing (or Zoho unreadable) →
 * POSTING_UNCERTAIN. Never POSTs and never makes the component retryable. Only a complete
 * lookup counts as a recheck: a failed, malformed or partial one leaves the recheck unrecorded.
 */
async function applyRecovery(local, c, lookup, opts, ctx) {
  const { store, db, actor } = ctx
  const at = ctx.now().toISOString()
  const evidence = evidenceOf(lookup, at)
  const base = { evidence, ...(opts.recoveryCheck && !lookup.error ? { recoveryCheckAt: at } : {}) }
  const prefix = opts.reason ? `${opts.reason} ` : ''
  const from = [local.status]
  if (lookup.error) {
    const detail = `${prefix}Zoho could not be searched completely (${lookup.error}); this does not count as a recheck. Zoho response uncertain — do not repost.`
    const row = await store.transitionComponent(db, local.id, from, COMPONENT_STATUS.POSTING_UNCERTAIN, { ...base, uncertainAt: newEpisodeAt(local, at), lastError: detail, event: EVENT.RECOVERY_LOOKUP_FAILED }, detail, actor)
    return outcomeOf(c, row, { reason: detail, evidence })
  }
  const plan = model.planRecovery(lookup, local)
  if (plan.action === RECOVERY_ACTION.SKIP_VERIFIED) {
    const detail = `${prefix}Zoho shows exactly one matching ${recordLabel(c)} ${lookup.recordId}; recorded as verified.`
    const row = await store.transitionComponent(db, local.id, from, COMPONENT_STATUS.VERIFIED, { ...base, zohoRecordId: lookup.recordId, postedAt: local.postedAt ? null : at, verifiedAt: at, event: EVENT.RECOVERY_MATCH_FOUND }, detail, actor)
    return outcomeOf(c, row, { reason: detail, evidence })
  }
  if (plan.action === RECOVERY_ACTION.NEEDS_REVIEW) {
    const detail = `${prefix}${plan.reason}`
    const row = await store.transitionComponent(db, local.id, from, COMPONENT_STATUS.NEEDS_REVIEW, { ...base, lastError: detail, event: EVENT.RECOVERY_CONFLICT }, detail, actor)
    return outcomeOf(c, row, { reason: detail, evidence })
  }
  const detail = `${prefix}No matching Zoho ${recordLabel(c)} was found yet. Zoho response uncertain — do not repost.`
  const row = await store.transitionComponent(db, local.id, from, COMPONENT_STATUS.POSTING_UNCERTAIN, { ...base, uncertainAt: newEpisodeAt(local, at), lastError: detail, event: EVENT.RECOVERY_STILL_MISSING }, detail, actor)
  return outcomeOf(c, row, { reason: detail, evidence })
}

/** A POST whose result is unknown: record it, search Zoho once, never re-POST. */
async function resolveUncertain(local, c, reason, ctx) {
  const at = ctx.now().toISOString()
  const marked = await ctx.store.transitionComponent(ctx.db, local.id, [COMPONENT_STATUS.POSTING], COMPONENT_STATUS.POSTING, { uncertainAt: at, lastError: reason, event: EVENT.POSTING_RESPONSE_UNCERTAIN, evidence: { at, reason } }, reason, ctx.actor)
  const out = await applyRecovery(marked, c, await recoveryLookup(c, ctx), { reason }, ctx)
  return { ...out, requestSent: true }
}

/** Read the created record back through the same exact duplicate check. */
async function verifyCreated(local, c, recordId, ctx) {
  const { store, db, actor } = ctx
  let state
  try {
    state = await ctx.zohoState(c)
  } catch (err) {
    const detail = `Zoho ${recordLabel(c)} ${recordId} was created, but could not be read back yet (${safeMessage(err, ctx.stripeConfig)}). It will be verified, not recreated, on the next attempt.`
    return outcomeOf(c, await store.transitionComponent(db, local.id, [COMPONENT_STATUS.POSTED], COMPONENT_STATUS.POSTED, { lastError: detail }, detail, actor), { requestSent: true, reason: detail })
  }
  if (state.state === ZOHO_STATE.VERIFIED && state.recordId === recordId) {
    const matched = VERIFIED_FIELDS[c.component] || 'reference, customer, account, amount and allocations match'
    const row = await store.transitionComponent(db, local.id, [COMPONENT_STATUS.POSTED], COMPONENT_STATUS.VERIFIED, { verifiedAt: ctx.now().toISOString(), event: EVENT.VERIFIED, evidence: evidenceOf(state, ctx.now().toISOString()) }, `Zoho ${recordLabel(c)} ${recordId} verified: ${matched}.`, actor)
    return outcomeOf(c, row, { requestSent: true })
  }
  const why = state.state === ZOHO_STATE.MISSING ? 'it is not found by its reference' : state.reason || `Zoho shows ${state.recordId} instead`
  const detail = `Zoho ${recordLabel(c)} ${recordId} was created but does not verify: ${why}.`
  return outcomeOf(c, await store.transitionComponent(db, local.id, [COMPONENT_STATUS.POSTED], COMPONENT_STATUS.NEEDS_REVIEW, { lastError: detail }, detail, actor), { requestSent: true, reason: detail })
}

async function postComponent(c, row, ctx) {
  const { store, db, actor, stripeConfig } = ctx
  let local = (await store.upsertPlannedComponent(db, row, actor)).component
  let zoho
  try {
    // A retry after an earlier attempt also checks the direct evidence, not only the search index.
    zoho = local.attemptCount > 0 ? await ctx.zohoStateDeep(c) : await ctx.zohoState(c)
  } catch (err) {
    return outcomeOf(c, local, { reason: `Zoho could not be searched before posting (${safeMessage(err, stripeConfig)}); nothing was sent.` })
  }
  const plan = model.planRecovery(zoho, local)
  if (plan.action === RECOVERY_ACTION.SKIP_VERIFIED) {
    if (local.status !== COMPONENT_STATUS.VERIFIED) {
      const at = ctx.now().toISOString()
      const recovered = UNCERTAIN_LOCAL.includes(local.status)
      local = await store.transitionComponent(
        db, local.id,
        [COMPONENT_STATUS.PLANNED, COMPONENT_STATUS.FAILED, COMPONENT_STATUS.POSTING, COMPONENT_STATUS.POSTING_UNCERTAIN, COMPONENT_STATUS.POSTED, COMPONENT_STATUS.NEEDS_REVIEW],
        COMPONENT_STATUS.VERIFIED,
        { zohoRecordId: zoho.recordId, postedAt: local.postedAt ? null : at, verifiedAt: at, event: recovered ? EVENT.RECOVERY_MATCH_FOUND : EVENT.VERIFIED, evidence: evidenceOf(zoho, at) },
        `Zoho ${recordLabel(c)} ${zoho.recordId} already exists and matches exactly; recorded without posting.`,
        actor,
      )
    }
    return outcomeOf(c, local, { reason: plan.reason })
  }
  // Zoho may already hold it: nothing is sent and the component is not relabelled.
  if (plan.action === RECOVERY_ACTION.POSTING_UNCERTAIN) return outcomeOf(c, local, { reason: plan.reason, uncertain: true })
  if (plan.action === RECOVERY_ACTION.NEEDS_REVIEW) {
    if (local.status !== COMPONENT_STATUS.NEEDS_REVIEW) {
      local = await store.transitionComponent(db, local.id, [local.status], COMPONENT_STATUS.NEEDS_REVIEW, { lastError: plan.reason }, plan.reason, actor)
    }
    return outcomeOf(c, local, { reason: plan.reason })
  }

  const postingDate = getDubaiPostingDate(ctx.now())
  if (model.proposedDate(c) !== postingDate) {
    return outcomeOf(c, local, { reason: `The Zoho posting date changed to ${postingDate} (Asia/Dubai) before ${c.component} was sent. Reload the preview and review it again; nothing was sent.` })
  }
  // What is sent now is what the read-back and any recovery must find.
  c = { ...c, matchDate: postingDate }
  const retry = local.attemptCount > 0
  local = await store.transitionComponent(
    db, local.id, [COMPONENT_STATUS.PLANNED, COMPONENT_STATUS.FAILED], COMPONENT_STATUS.POSTING,
    { incrementAttempt: true, requestSnapshot: requestSnapshot(c), event: retry ? EVENT.POSTING_RETRIED : EVENT.POSTING_STARTED },
    `Posting ${c.component} ${c.amount} (${c.reference}) to Zoho, attempt ${local.attemptCount + 1}.${local.retryAuthorizedAt && retry ? ` Retry allowed by ${local.retryAuthorizedBy}.` : ''}`,
    actor,
  )
  let created
  try {
    created = await createRecord(c, ctx.writer)
  } catch (err) {
    if (writeErrorKind(err) === 'rejected') {
      const detail = `Zoho did not accept the ${recordLabel(c)}: ${safeMessage(err, stripeConfig)}`
      return outcomeOf(c, await store.transitionComponent(db, local.id, [COMPONENT_STATUS.POSTING], COMPONENT_STATUS.FAILED, { lastError: detail }, detail, actor), { requestSent: true, reason: detail })
    }
    return resolveUncertain(local, c, `Zoho ${recordLabel(c)} POST result is unknown (${safeMessage(err, stripeConfig)}).`, ctx)
  }
  const recordId = clean(created && created.recordId)
  if (!recordId) return resolveUncertain(local, c, `Zoho answered the ${recordLabel(c)} POST without a record ID.`, ctx)
  try {
    local = await store.transitionComponent(db, local.id, [COMPONENT_STATUS.POSTING], COMPONENT_STATUS.POSTED, { zohoRecordId: recordId, postedAt: ctx.now().toISOString() }, `Zoho ${recordLabel(c)} ${recordId} created.`, actor)
  } catch (err) {
    throw fail(500, 'LOCAL_RECORD_FAILED_AFTER_POST', `Zoho ${recordLabel(c)} ${recordId} was created, but the local record could not be saved (${safeMessage(err, stripeConfig)}). The next attempt finds and verifies it in Zoho; do not create it by hand.`, { zohoRecordId: recordId })
  }
  return verifyCreated(local, c, recordId, ctx)
}

function groupOutcome(outcomes, required) {
  const verified = outcomes.filter((o) => o.status === COMPONENT_STATUS.VERIFIED).length
  if (verified === required) return GROUP_STATUS.POSTED
  if (outcomes.some((o) => o.status === COMPONENT_STATUS.POSTING_UNCERTAIN)) return GROUP_STATUS.POSTING_UNCERTAIN
  if (outcomes.some((o) => o.status === COMPONENT_STATUS.NEEDS_REVIEW)) return GROUP_STATUS.NEEDS_REVIEW
  if (verified > 0) return GROUP_STATUS.PARTIALLY_POSTED
  return 'NOT_POSTED'
}

async function postLocked(payoutId, customerId, fingerprint, ctx) {
  const result = await ctx.previewPayout(payoutId)
  const group = result.groups.find((g) => g.customerId === customerId)
  if (!group) throw fail(409, 'GROUP_NOT_IN_PAYOUT', `Payout ${payoutId} has no charges for this customer.`)
  if (group.status === GROUP_STATUS.POSTED && group.postingFingerprint === fingerprint) {
    return {
      outcome: GROUP_STATUS.POSTED,
      alreadyPosted: true,
      payoutId,
      customerId,
      customerName: group.customerName,
      components: group.components.map((c) => ({ component: c.component, amount: c.amount, reference: c.reference, status: c.local ? c.local.status : null, zohoRecordId: c.zoho.recordId, requestSent: false })),
      zohoRequests: 0,
      advanceCasesPosted: [],
    }
  }
  const components = assertPostable(result, group, fingerprint, ctx.config)
  assertPostingDate(result, ctx)

  const outcomes = []
  for (const c of components) {
    const out = await postComponent(c, componentRow(c, payoutId, customerId, result.payout.currency), ctx)
    outcomes.push(out)
    if (out.status !== COMPONENT_STATUS.VERIFIED) break
  }

  let advanceCasesPosted = []
  const adv = components.find((c) => c.component === COMPONENT.CUSTOMER_ADVANCE)
  const advOut = outcomes.find((o) => o.component === COMPONENT.CUSTOMER_ADVANCE)
  if (adv && advOut && advOut.status === COMPONENT_STATUS.VERIFIED) {
    advanceCasesPosted = await ctx.store.markAdvancePosted(ctx.db, adv.advanceCaseIds, advOut.zohoRecordId, ctx.actor)
  }
  const outcome = groupOutcome(outcomes, components.length)
  return {
    outcome,
    alreadyPosted: false,
    payoutId,
    customerId,
    customerName: group.customerName,
    components: outcomes,
    notAttempted: components.slice(outcomes.length).map((c) => c.component),
    zohoRequests: outcomes.filter((o) => o.requestSent).length,
    advanceCasesPosted: advanceCasesPosted.map((c) => ({ id: c.id, status: c.status, zohoJournalId: c.zohoJournalId })),
  }
}

/**
 * Everything checked against the live preview before the payout fee journal is created:
 * every group posted with every component verified, verified FEE payments = Stripe fee
 * total = journal amount, and exactly Dr Stripe Fees / Cr 1013 with no customer tag.
 */
function assertFeeJournalPostable(result, fingerprint, config) {
  const S = model.FEE_JOURNAL_STATUS
  const fj = result.feeJournal
  const needsReview = (code, message, reasons) => fail(409, code, message, { reasons, feeJournalStatus: S.NEEDS_REVIEW })
  if (!fj) throw needsReview('FEE_JOURNAL_MISSING', 'The preview has no payout fee journal. Nothing was posted.')
  if (fj.postingFingerprint !== fingerprint) {
    throw needsReview('PREVIEW_CHANGED', 'The payout, its fees, the verified FEE payments or the Zoho posting date changed since this preview. Reload the preview and review it again. Nothing was posted.')
  }
  if (result.payout.status !== 'paid') throw needsReview('PAYOUT_NOT_PAID', `Payout status is ${result.payout.status}. Nothing was posted.`)
  if (result.blockers.length > 0) throw needsReview('PAYOUT_NEEDS_REVIEW', 'The payout does not reconcile. Nothing was posted.', result.blockers)
  if (!fj.postable || !(fj.status === S.READY || fj.status === S.VERIFIED)) {
    throw fail(409, 'FEE_JOURNAL_NOT_POSTABLE', `The payout fee journal is ${fj.status}. Nothing was posted.`, { reasons: fj.reasons, feeJournalStatus: fj.status })
  }

  const problems = []
  const normalRefunds = result.normalRefunds || []
  if (result.groups.length === 0 && normalRefunds.length === 0) problems.push('The payout has no customer groups.')
  for (const g of result.groups) {
    const complete = fj.status === S.READY ? g.status === GROUP_STATUS.POSTED : model.COMPLETE_GROUP.has(g.status)
    if (!complete) problems.push(`${g.customerName} is ${g.status}, not posted.`)
    for (const c of g.components) {
      if (c.zoho.state !== ZOHO_STATE.VERIFIED) problems.push(`${g.customerName} ${c.component} is not verified in Zoho.`)
    }
    if (!g.components.some((c) => c.component === COMPONENT.FEE)) problems.push(`${g.customerName} has no FEE payment.`)
  }
  const minor = (v) => Math.round(Number(v) * 100)
  // Each refund's Stripe fee is in 1013 only through its own verified adjustment journal.
  let refundFee = 0
  for (const r of normalRefunds.filter((x) => minor(x.stripeFee) !== 0)) {
    const adj = r.components.find((c) => c.component === COMPONENT.REFUND_FEE_ADJUSTMENT)
    if (!adj || adj.zoho.state !== ZOHO_STATE.VERIFIED) problems.push(`Refund ${r.refundId} fee adjustment ${r.stripeFee} is not verified in Zoho.`)
    else refundFee += minor(r.stripeFee)
  }
  const expectedAdjustments = normalRefunds.filter((x) => minor(x.stripeFee) !== 0).map((r) => r.refundId).sort()
  const listedAdjustments = (fj.refundFeeAdjustments || []).map((a) => a.refundId).sort()
  if (JSON.stringify(expectedAdjustments) !== JSON.stringify(listedAdjustments)) problems.push('The fee journal does not account for exactly the refunds with a Stripe fee.')
  const verifiedFee = result.groups.reduce((s, g) => s + g.components
    .filter((c) => c.component === COMPONENT.FEE && c.zoho.state === ZOHO_STATE.VERIFIED)
    .reduce((t, c) => t + minor(c.amount), 0), 0) + refundFee
  // The journal clears the signed 1013 balance: its amount is |fees| and its direction their sign.
  const signedFee = minor(fj.stripeFeeTotal)
  if (verifiedFee !== signedFee || minor(fj.amount) !== Math.abs(signedFee) || signedFee === 0) {
    const what = expectedAdjustments.length > 0 ? 'Verified FEE payments and refund fee adjustments' : 'Verified FEE payments'
    problems.push(`${what} ${(verifiedFee / 100).toFixed(2)}, Stripe fees ${fj.stripeFeeTotal} and the journal amount ${fj.amount} (absolute) must all agree and be non-zero.`)
  }
  const side = model.payoutFeeJournalAccounts(signedFee, config.feeExpenseAccountId, config.feeAccountId)
  if (!side || fj.direction !== side.direction) problems.push(`The journal direction ${fj.direction || '(none)'} does not follow the signed Stripe fee total ${fj.stripeFeeTotal}.`)

  const accounts = result.accounts
  const reversal = Boolean(side && side.direction === model.FEE_JOURNAL_DIRECTION.FEE_REVERSAL)
  if (!accounts.feeExpense || accounts.feeExpense.accountId !== config.feeExpenseAccountId) problems.push('Stripe Fees (2270) is not verified.')
  if (!accounts.fee || accounts.fee.accountId !== config.feeAccountId) problems.push('Stripe Processing Chg Un-Cleared (1013) is not verified.')
  if (!side || fj.debitAccountId !== side.debitAccountId || fj.creditAccountId !== side.creditAccountId) {
    problems.push(reversal ? 'A fee reversal must debit 1013 and credit Stripe Fees (2270).' : 'The journal must debit Stripe Fees (2270) and credit 1013.')
  }
  if (fj.reference !== model.payoutFeeReference(result.payout.payoutId)) problems.push('The journal reference is not the payout fee reference.')
  const payload = fj.payload || {}
  if (fj.date !== result.zohoPostingDate || payload.journal_date !== fj.date) problems.push(`The journal date is not the Zoho posting date ${result.zohoPostingDate}.`)
  const lines = payload.line_items || []
  const shapeOk = Boolean(side) && lines.length === 2
    && lines[0].account_id === side.debitAccountId && lines[0].debit_or_credit === 'debit' && minor(lines[0].amount) === minor(fj.amount)
    && lines[1].account_id === side.creditAccountId && lines[1].debit_or_credit === 'credit' && minor(lines[1].amount) === minor(fj.amount)
  if (!shapeOk) {
    problems.push(reversal
      ? 'The journal must be exactly one 1013 debit and one Stripe Fees credit for the total.'
      : 'The journal must be exactly one Stripe Fees debit and one 1013 credit for the total.')
  }
  if (lines.some((l) => l.customer_id)) problems.push('The payout fee journal must not be tagged to a customer.')
  if (payload.reference_number !== fj.reference) problems.push('The journal payload reference does not match.')
  if (payload.notes) problems.push('The journal must not carry notes.')
  if (problems.length > 0) throw needsReview('FEE_JOURNAL_CHANGED', 'The payout fee journal cannot be posted. Nothing was posted.', problems)
  return fj
}

async function postFeeJournalLocked(payoutId, fingerprint, ctx) {
  const result = await ctx.previewPayout(payoutId)
  const fj = result.feeJournal
  const S = model.FEE_JOURNAL_STATUS
  const summary = { payoutId, amount: fj ? fj.amount : null, reference: fj ? fj.reference : null }
  if (fj && fj.status === S.VERIFIED && fj.tracked && fj.postingFingerprint === fingerprint) {
    return { outcome: S.VERIFIED, alreadyPosted: true, ...summary, component: { component: fj.component, amount: fj.amount, reference: fj.reference, status: fj.local.status, zohoRecordId: fj.zoho.recordId, requestSent: false }, zohoRequests: 0 }
  }
  const c = assertFeeJournalPostable(result, fingerprint, ctx.config)
  assertPostingDate(result, ctx)
  const out = await postComponent(c, componentRow(c, payoutId, null, result.payout.currency), ctx)
  const outcome = out.status === COMPONENT_STATUS.VERIFIED ? S.VERIFIED
    : out.status === COMPONENT_STATUS.POSTING_UNCERTAIN ? S.POSTING_UNCERTAIN
      : out.status === COMPONENT_STATUS.NEEDS_REVIEW ? S.NEEDS_REVIEW
        : out.status === COMPONENT_STATUS.POSTED ? 'POSTED_UNVERIFIED' : 'NOT_POSTED'
  return { outcome, alreadyPosted: false, ...summary, component: out, zohoRequests: out.requestSent ? 1 : 0 }
}

/**
 * Everything checked against the live preview before a normal refund is sent: the refund
 * belongs to this paid, reconciling payout; its customer, invoice and credit note agree; the
 * credit note refund is exactly the Stripe gross from 1019; and the fee journal, when present,
 * is exactly Stripe's fee on the refund between 1019 and 1013.
 */
function assertRefundPostable(result, r, fingerprint, config) {
  const needsReview = (code, message, reasons) => fail(409, code, message, { reasons, refundStatus: NORMAL_REFUND_STATUS.NEEDS_REVIEW })
  if (!r.postingFingerprint) {
    throw fail(409, 'REFUND_NOT_POSTABLE', `Refund ${r.refundId} is ${r.status}. Nothing was posted.`, { reasons: r.reasons, refundStatus: r.status })
  }
  if (r.postingFingerprint !== fingerprint) {
    throw needsReview('PREVIEW_CHANGED', 'The refund, its invoice, credit note, accounts or Zoho posting date changed since this preview. Reload the preview and review it again. Nothing was posted.')
  }
  if (result.payout.status !== 'paid') throw needsReview('PAYOUT_NOT_PAID', `Payout status is ${result.payout.status}. Nothing was posted.`)
  if (result.blockers.length > 0) throw needsReview('PAYOUT_NEEDS_REVIEW', 'The payout does not reconcile. Nothing was posted.', result.blockers)
  if (!r.postable || !RUNNABLE_REFUND.has(r.status)) {
    throw fail(409, 'REFUND_NOT_POSTABLE', `Refund ${r.refundId} is ${r.status}. Nothing was posted.`, { reasons: r.reasons, refundStatus: r.status })
  }
  const minor = (v) => Math.round(Number(v) * 100)
  const accounts = result.accounts
  const problems = []
  const customers = [config.websiteZohoCustomerId, config.shopZohoCustomerId]
  if (!customers.includes(r.customerId)) problems.push('The refund is not for the Website or Burjman customer.')
  if (!r.invoice || r.invoice.customerId !== r.customerId) problems.push('The invoice is not under the refund customer.')
  if (!r.creditNote || r.creditNote.customerId !== r.customerId || r.creditNote.invoiceId !== (r.invoice && r.invoice.invoiceId)) {
    problems.push('The credit note is not the refund customer\'s credit note for this invoice.')
  }
  if (!r.itemsProven) problems.push('The returned items are not proven against the invoice.')
  const unexpected = r.components.filter((c) => !REFUND_POSTING_ORDER.includes(c.component))
  if (unexpected.length > 0) problems.push(`${unexpected.map((c) => c.component).join(', ')} is not part of refund posting.`)
  const cn = r.components.find((c) => c.component === COMPONENT.REFUND_CREDIT_NOTE_REFUND)
  const adj = r.components.find((c) => c.component === COMPONENT.REFUND_FEE_ADJUSTMENT)
  if (!cn) problems.push('The refund has no credit note refund to post.')
  else {
    const p = cn.payload || {}
    if (minor(cn.amount) !== minor(r.gross) || minor(p.amount) !== minor(r.gross)) problems.push('The credit note refund does not equal the Stripe refund amount.')
    if (!accounts.net || cn.depositAccountId !== accounts.net.accountId || p.from_account_id !== accounts.net.accountId) {
      problems.push('The credit note refund is not paid from the verified Stripe Undeposited Funds account.')
    }
    if (cn.reference !== model.normalRefundReference(r.refundId) || p.reference_number !== cn.reference) problems.push('The credit note refund reference is not the Stripe refund reference.')
    if (!r.creditNote || cn.creditNoteId !== r.creditNote.creditNoteId) problems.push('The credit note refund is not for the matched credit note.')
    if (cn.date !== result.zohoPostingDate || p.date !== cn.date) problems.push(`The credit note refund date is not the Zoho posting date ${result.zohoPostingDate}.`)
    if (p.refund_mode !== config.paymentMode) problems.push(`The refund mode is not ${config.paymentMode}.`)
    if (p.description || p.notes) problems.push('The credit note refund must not carry a description or notes.')
  }
  const feeMinor = minor(r.stripeFee)
  if (feeMinor === 0 && adj) problems.push('A refund fee journal is proposed for a refund without a Stripe fee.')
  if (feeMinor !== 0) {
    if (!adj) problems.push(`Stripe changed its fee by ${r.stripeFee} on this refund, but no fee journal is proposed.`)
    else {
      const net = accounts.net ? accounts.net.accountId : null
      const fee = accounts.fee ? accounts.fee.accountId : null
      const [dr, cr] = feeMinor < 0 ? [net, fee] : [fee, net]
      if (!net || !fee || fee !== config.feeAccountId) problems.push('Stripe Undeposited Funds or Stripe Processing Chg Un-Cleared is not verified.')
      if (adj.debitAccountId !== dr || adj.creditAccountId !== cr) problems.push('The refund fee journal accounts do not follow the sign of Stripe\'s fee.')
      if (minor(adj.amount) !== Math.abs(feeMinor)) problems.push('The refund fee journal amount does not equal Stripe\'s fee on the refund.')
      if (adj.reference !== model.refundFeeReference(r.refundId) || adj.payload.reference_number !== adj.reference) problems.push('The refund fee journal reference is not the refund fee reference.')
      if (adj.date !== result.zohoPostingDate || adj.payload.journal_date !== adj.date) problems.push(`The refund fee journal date is not the Zoho posting date ${result.zohoPostingDate}.`)
      const lines = adj.payload.line_items || []
      const shapeOk = lines.length === 2
        && lines[0].account_id === dr && lines[0].debit_or_credit === 'debit' && minor(lines[0].amount) === Math.abs(feeMinor)
        && lines[1].account_id === cr && lines[1].debit_or_credit === 'credit' && minor(lines[1].amount) === Math.abs(feeMinor)
      if (!shapeOk) problems.push('The refund fee journal must be exactly one debit and one credit for the fee.')
      if (lines.some((l) => l.customer_id) || adj.payload.notes) problems.push('The refund fee journal must be untagged and carry no notes.')
    }
  }
  if (problems.length > 0) throw needsReview('REFUND_CHANGED', `Refund ${r.refundId} cannot be posted. Nothing was posted.`, problems)
  return REFUND_POSTING_ORDER.map((k) => r.components.find((c) => c.component === k)).filter(Boolean)
}

function refundComponentRow(c, payoutId, r, currency) {
  return {
    payoutId,
    refundId: r.refundId,
    balanceTransactionId: r.balanceTransactionId,
    chargeId: r.chargeId,
    paymentIntentId: r.paymentIntentId,
    zohoCustomerId: r.customerId,
    invoiceId: r.invoice.invoiceId,
    creditNoteId: r.creditNote.creditNoteId,
    component: c.component,
    zohoRecordType: c.zohoRecordType,
    amount: c.amount,
    currency,
    depositAccountId: c.depositAccountId || null,
    debitAccountId: c.debitAccountId || null,
    creditAccountId: c.creditAccountId || null,
    reference: c.reference,
  }
}

async function postRefundLocked(payoutId, refundId, fingerprint, ctx) {
  const result = await ctx.previewPayout(payoutId)
  const r = (result.normalRefunds || []).find((x) => x.refundId === refundId)
  if (!r) {
    const advance = (result.advanceRefunds || []).some((x) => x.refundId === refundId)
    throw fail(409, advance ? 'REFUND_IS_CUSTOMER_ADVANCE' : 'REFUND_NOT_IN_PAYOUT', advance
      ? `Refund ${refundId} returns a customer advance; it is not a normal invoice refund. Nothing was posted.`
      : `Payout ${payoutId} has no normal refund ${refundId}. Nothing was posted.`)
  }
  const summary = { payoutId, refundId, amount: r.gross, creditNoteNumber: r.creditNote ? r.creditNote.creditNoteNumber : null }
  if (r.status === NORMAL_REFUND_STATUS.VERIFIED && r.tracked && r.postingFingerprint === fingerprint) {
    return {
      outcome: NORMAL_REFUND_STATUS.VERIFIED,
      alreadyPosted: true,
      ...summary,
      components: r.components.map((c) => ({ component: c.component, amount: c.amount, reference: c.reference, status: c.local ? c.local.status : null, zohoRecordId: c.zoho.recordId, requestSent: false })),
      zohoRequests: 0,
    }
  }
  const components = assertRefundPostable(result, r, fingerprint, ctx.config)
  assertPostingDate(result, ctx)
  // Same posting rules as the payout components, on the refund component table.
  const refundCtx = {
    ...ctx,
    store: { ...ctx.store, upsertPlannedComponent: ctx.store.upsertPlannedRefundComponent, transitionComponent: ctx.store.transitionRefundComponent },
  }
  const outcomes = []
  for (const c of components) {
    const out = await postComponent(c, refundComponentRow(c, payoutId, r, result.payout.currency), refundCtx)
    outcomes.push(out)
    if (out.status !== COMPONENT_STATUS.VERIFIED) break
  }
  const verified = outcomes.filter((o) => o.status === COMPONENT_STATUS.VERIFIED).length
  const outcome = verified === components.length ? NORMAL_REFUND_STATUS.VERIFIED
    : outcomes.some((o) => o.status === COMPONENT_STATUS.POSTING_UNCERTAIN) ? NORMAL_REFUND_STATUS.POSTING_UNCERTAIN
      : outcomes.some((o) => o.status === COMPONENT_STATUS.NEEDS_REVIEW) ? NORMAL_REFUND_STATUS.NEEDS_REVIEW
        : verified > 0 || outcomes.some((o) => o.status === COMPONENT_STATUS.POSTED) ? NORMAL_REFUND_STATUS.POSTED
          : outcomes.some((o) => o.status === COMPONENT_STATUS.FAILED) ? NORMAL_REFUND_STATUS.FAILED : 'NOT_POSTED'
  return {
    outcome,
    alreadyPosted: false,
    ...summary,
    components: outcomes,
    notAttempted: components.slice(outcomes.length).map((c) => c.component),
    zohoRequests: outcomes.filter((o) => o.requestSent).length,
  }
}

/** Gate, identity and fingerprint checks, then `run` under the payout advisory lock. */
async function underPostingLock(payoutId, opts, overrides, customerKey, run) {
  const deps = { ...defaultDeps(), ...overrides }
  const id = clean(payoutId)
  if (!PAYOUT_PATTERN.test(id)) throw fail(400, 'INVALID_PAYOUT_ID', 'A Stripe payout ID (po_…) is required.')
  const customerId = customerKey === null ? null : resolveCustomer(customerKey, deps.config)
  const gate = postingGate(deps.config, deps.stripeConfig)
  if (!gate.allowed) throw fail(403, gate.reasons[0].code, `${gate.reasons.map((r) => r.message).join(' ')} Nothing was posted.`, { reasons: gate.reasons.map((r) => r.message) })
  if (!opts.actor) throw fail(401, 'ACTOR_REQUIRED', 'The posting admin could not be identified.')
  const fingerprint = clean(opts.fingerprint)
  if (!fingerprint) throw fail(400, 'FINGERPRINT_REQUIRED', 'Post from a loaded preview (posting fingerprint missing).')

  const previewDeps = { ...deps.previewDeps, now: deps.now, config: deps.config, stripeConfig: deps.stripeConfig }
  const lock = await deps.store.acquirePayoutLock(deps.pool, id)
  try {
    return await run(id, customerId, fingerprint, {
      ...deps,
      db: lock.db,
      actor: opts.actor,
      previewPayout: (pid) => preview.previewPayout(pid, previewDeps),
      zohoState: (c) => preview.componentZohoState(c, customerId, id, previewDeps),
      zohoStateDeep: (c) => preview.componentZohoState(c, customerId, id, previewDeps, { deep: true }),
    })
  } finally {
    await lock.release().catch((err) => console.error('[stripe-payout-posting] lock release failed:', safeMessage(err, deps.stripeConfig)))
  }
}

/**
 * Post one payout + customer group to Zoho.
 * @param {string} payoutId
 * @param {string} customerKey "website" | "burjman" (or the exact Zoho customer ID)
 * @param {{ actor?: string, fingerprint?: string }} opts fingerprint = group.postingFingerprint from the reviewed preview
 * @param {object} [overrides] test seams
 */
async function postPayoutCustomerGroup(payoutId, customerKey, opts = {}, overrides = {}) {
  return underPostingLock(payoutId, opts, overrides, customerKey, postLocked)
}

/**
 * Post the payout-level Stripe fee journal (Dr Stripe Fees / Cr 1013, payout total, no
 * customer). Last step of a payout: only after every customer group is posted and verified.
 * @param {string} payoutId
 * @param {{ actor?: string, fingerprint?: string }} opts fingerprint = feeJournal.postingFingerprint from the reviewed preview
 * @param {object} [overrides] test seams
 */
async function postPayoutFeeJournal(payoutId, opts = {}, overrides = {}) {
  return underPostingLock(payoutId, opts, overrides, null, (id, _customerId, fingerprint, ctx) => postFeeJournalLocked(id, fingerprint, ctx))
}

/**
 * Post one normal (invoice) Stripe refund of this payout: refund of the existing Zoho credit
 * note from Stripe Undeposited Funds, then (only when Stripe changed its fee on the refund) the
 * refund fee journal. Never creates credit notes and never posts customer advance refunds.
 * @param {string} payoutId
 * @param {string} refundId Stripe refund ID (re_…)
 * @param {{ actor?: string, fingerprint?: string }} opts fingerprint = normalRefunds[].postingFingerprint from the reviewed preview
 * @param {object} [overrides] test seams
 */
async function postPayoutRefund(payoutId, refundId, opts = {}, overrides = {}) {
  const rid = clean(refundId)
  if (!REFUND_PATTERN.test(rid)) throw fail(400, 'INVALID_REFUND_ID', 'A Stripe refund ID (re_…) is required.')
  return underPostingLock(payoutId, opts, overrides, null, (id, _customerId, fingerprint, ctx) => postRefundLocked(id, rid, fingerprint, ctx))
}

const RECOVERY_SCOPE = Object.freeze({ COMPONENT: 'component', REFUND_COMPONENT: 'refund-component' })
const MIN_REASON_LENGTH = 10

function recoveryTarget(scope, store) {
  if (scope === RECOVERY_SCOPE.COMPONENT) return { get: store.getComponent, store }
  if (scope === RECOVERY_SCOPE.REFUND_COMPONENT) {
    return { get: store.getRefundComponent, store: { ...store, transitionComponent: store.transitionRefundComponent } }
  }
  throw fail(400, 'INVALID_RECOVERY_SCOPE', 'Scope must be "component" or "refund-component".')
}

const minorOf = (v) => Math.round(Number(v) * 100)
const allocationKey = (list) => JSON.stringify((list || []).map((a) => [String(a.invoiceId), minorOf(a.amount)]).sort())

/**
 * The live proposal for a stored uncertain row, and the customer it is searched under. Refused
 * when the payout now proposes something else: the lookup would not test what was sent.
 */
function proposalFor(result, row, scope) {
  let c = null
  let customerId = null
  if (scope === RECOVERY_SCOPE.REFUND_COMPONENT) {
    const r = (result.normalRefunds || []).find((x) => x.refundId === row.refundId)
    c = r ? r.components.find((x) => x.component === row.component) : null
    customerId = r ? r.customerId : null
  } else if (row.component === COMPONENT.PAYOUT_FEE_JOURNAL) {
    c = result.feeJournal && result.feeJournal.component === row.component ? result.feeJournal : null
  } else {
    const g = result.groups.find((x) => x.customerId === row.zohoCustomerId)
    c = g ? g.components.find((x) => x.component === row.component) : null
    customerId = row.zohoCustomerId
  }
  if (!c) throw fail(409, 'RECOVERY_PROPOSAL_MISSING', `Payout ${row.payoutId} no longer proposes ${row.component} (${row.reference}). Check Zoho by hand; nothing was changed.`)
  const differences = []
  if (c.reference !== row.reference) differences.push('reference')
  if (c.zohoRecordType !== row.zohoRecordType) differences.push('record type')
  if (minorOf(c.amount) !== minorOf(row.amount)) differences.push('amount')
  for (const key of ['depositAccountId', 'debitAccountId', 'creditAccountId']) if ((c[key] || null) !== (row[key] || null)) differences.push(key)
  if (scope === RECOVERY_SCOPE.REFUND_COMPONENT && c.creditNoteId !== row.creditNoteId) differences.push('credit note')
  if (scope === RECOVERY_SCOPE.COMPONENT && allocationKey(c.allocations) !== allocationKey(row.allocations)) differences.push('allocations')
  if (differences.length > 0) {
    throw fail(409, 'RECOVERY_PLAN_CHANGED', `The payout now proposes a different ${differences.join(', ')} for ${row.component} than the uncertain attempt. Check Zoho by hand; nothing was changed.`, { differences })
  }
  return { c, customerId }
}

/** Admin + lock, no posting gate or fingerprint: recovery reads Zoho and changes local state only. */
async function underRecoveryLock(payoutId, scope, componentId, opts, overrides, run) {
  const deps = { ...defaultDeps(), ...overrides }
  const id = clean(payoutId)
  if (!PAYOUT_PATTERN.test(id)) throw fail(400, 'INVALID_PAYOUT_ID', 'A Stripe payout ID (po_…) is required.')
  if (!/^\d{1,18}$/.test(clean(componentId))) throw fail(400, 'INVALID_COMPONENT_ID', 'A component ID is required.')
  if (!opts.actor) throw fail(401, 'ACTOR_REQUIRED', 'The admin could not be identified.')
  const target = recoveryTarget(scope, deps.store)
  const previewDeps = { ...deps.previewDeps, now: deps.now, config: deps.config, stripeConfig: deps.stripeConfig }
  const lock = await deps.store.acquirePayoutLock(deps.pool, id)
  try {
    const row = await target.get(lock.db, clean(componentId))
    if (!row || row.payoutId !== id) throw fail(404, 'COMPONENT_NOT_FOUND', `Payout ${id} has no ${scope} ${componentId}.`)
    // The attempt's own snapshot; only rows from before snapshots fall back to the live proposal.
    const { c, customerId } = row.requestSnapshot
      ? { c: row.requestSnapshot, customerId: row.zohoCustomerId || null }
      : proposalFor(await preview.previewPayout(id, previewDeps), row, scope)
    const ctx = {
      ...deps,
      store: target.store,
      db: lock.db,
      actor: opts.actor,
      zohoStateDeep: (x) => preview.componentZohoState(x, customerId, id, previewDeps, { deep: true }),
    }
    const out = await run(row, c, ctx)
    if (out.status === COMPONENT_STATUS.VERIFIED && row.component === COMPONENT.CUSTOMER_ADVANCE) {
      out.advanceCasesPosted = (await deps.store.markAdvancePosted(lock.db, row.advanceCaseIds, out.zohoRecordId, opts.actor))
        .map((x) => ({ id: x.id, status: x.status, zohoJournalId: x.zohoJournalId }))
    }
    return { payoutId: id, scope, componentId: row.id, outcome: out.status, component: out, zohoWrites: 0 }
  } finally {
    await lock.release().catch((err) => console.error('[stripe-payout-posting] lock release failed:', safeMessage(err, deps.stripeConfig)))
  }
}

/**
 * Read-only "Recheck Zoho" for a component whose Zoho write may have happened: exact match →
 * VERIFIED, conflict → NEEDS_REVIEW, still missing → stays POSTING_UNCERTAIN. Never POSTs.
 * @param {string} payoutId
 * @param {'component'|'refund-component'} scope
 * @param {string} componentId
 * @param {{ actor?: string }} opts
 * @param {object} [overrides] test seams
 */
async function recheckUncertainComponent(payoutId, scope, componentId, opts = {}, overrides = {}) {
  return underRecoveryLock(payoutId, scope, componentId, opts, overrides, async (row, c, ctx) => {
    if (!UNCERTAIN_LOCAL.includes(row.status)) {
      throw fail(409, 'COMPONENT_NOT_UNCERTAIN', `${row.component} is ${row.status}; only an uncertain Zoho write is rechecked here.`)
    }
    return applyRecovery(row, c, await recoveryLookup(c, ctx), { recoveryCheck: true, reason: 'Admin recheck of Zoho.' }, ctx)
  })
}

const CLOCK_SKEW_MS = 5 * 60 * 1000

/**
 * The admin's own Zoho check, independent of this service's lookup: when they checked, where in
 * Zoho, what they searched for (must include the attempt's reference) and that nothing was found.
 */
function adminVerification(input) {
  const v = input && typeof input === 'object' ? input : null
  if (!v) throw fail(400, 'VERIFICATION_REQUIRED', 'Record your own Zoho check: when, where in Zoho, what you searched for, and that nothing was found.')
  const checkedAt = clean(v.checkedAt)
  const zohoLocation = clean(v.zohoLocation)
  const searchedFor = clean(v.searchedFor)
  if (v.recordsFound !== 0) {
    throw fail(400, 'VERIFICATION_FOUND_RECORDS', 'Your Zoho check must have found no matching record. If Zoho shows one, use Recheck Zoho instead; a retry would duplicate it.')
  }
  if (!checkedAt || Number.isNaN(Date.parse(checkedAt))) throw fail(400, 'VERIFICATION_TIME_REQUIRED', 'Give the time of your own Zoho check.')
  if (zohoLocation.length < 5 || zohoLocation.length > 200) throw fail(400, 'VERIFICATION_LOCATION_REQUIRED', 'Say where in Zoho you searched (5–200 characters).')
  if (searchedFor.length < 5 || searchedFor.length > 300) throw fail(400, 'VERIFICATION_SEARCH_REQUIRED', 'Say what you searched Zoho for (5–300 characters).')
  return { checkedAt: new Date(checkedAt).toISOString(), zohoLocation, searchedFor, recordsFound: 0 }
}

/**
 * "Confirm not created and allow retry": only for POSTING_UNCERTAIN, after a complete recheck in
 * this uncertain episode and the settle window, with the admin's reason, acknowledgement and own
 * Zoho verification (made after the settle window, searching for this attempt's reference). The
 * window alone proves nothing: Zoho is searched once more, and any failed, malformed or partial
 * lookup refuses the retry. Only a complete lookup that still finds nothing makes the component
 * FAILED with the retry authorization and all evidence recorded. Never POSTs: the retry is a
 * separate request.
 * @param {string} payoutId
 * @param {'component'|'refund-component'} scope
 * @param {string} componentId
 * @param {{ actor?: string, reason?: string, acknowledged?: boolean, verification?: { checkedAt: string, zohoLocation: string, searchedFor: string, recordsFound: number } }} opts
 * @param {object} [overrides] test seams
 */
async function confirmUncertainNotCreated(payoutId, scope, componentId, opts = {}, overrides = {}) {
  const reason = clean(opts.reason)
  if (opts.acknowledged !== true) throw fail(400, 'ACKNOWLEDGEMENT_REQUIRED', 'Confirm that you checked Zoho and the record does not exist.')
  if (reason.length < MIN_REASON_LENGTH || reason.length > 500) throw fail(400, 'REASON_REQUIRED', `Give a reason of ${MIN_REASON_LENGTH}–500 characters.`)
  const verification = adminVerification(opts.verification)
  return underRecoveryLock(payoutId, scope, componentId, opts, overrides, async (row, c, ctx) => {
    if (row.status !== COMPONENT_STATUS.POSTING_UNCERTAIN) {
      throw fail(409, 'COMPONENT_NOT_UNCERTAIN', `${row.component} is ${row.status}; only a POSTING_UNCERTAIN component can be confirmed as not created.`)
    }
    const since = Date.parse(row.uncertainSince)
    if (!row.lastRecoveryCheckAt || Date.parse(row.lastRecoveryCheckAt) < since) {
      throw fail(409, 'RECHECK_REQUIRED', 'Recheck Zoho first; the confirmation is only available after a complete recheck of this uncertain attempt.')
    }
    const settleMinutes = ctx.config.uncertainSettleMinutes == null ? 15 : ctx.config.uncertainSettleMinutes
    const availableAt = since + settleMinutes * 60 * 1000
    const nowMs = ctx.now().getTime()
    if (nowMs < availableAt) {
      throw fail(409, 'SETTLE_WINDOW_OPEN', `Available from ${new Date(availableAt).toISOString()}, to give Zoho time to show the record.`, { confirmAvailableAt: new Date(availableAt).toISOString() })
    }
    const checkedMs = Date.parse(verification.checkedAt)
    if (checkedMs < availableAt) {
      throw fail(409, 'VERIFICATION_TOO_EARLY', `Your Zoho check must be made after ${new Date(availableAt).toISOString()}; an earlier search can miss a record Zoho had not indexed yet.`)
    }
    if (checkedMs > nowMs + CLOCK_SKEW_MS) throw fail(400, 'VERIFICATION_IN_FUTURE', 'The time of your Zoho check is in the future.')
    if (!verification.searchedFor.includes(c.reference)) {
      throw fail(400, 'VERIFICATION_REFERENCE_MISSING', `Your Zoho search must include this attempt's reference "${c.reference}".`)
    }
    const lookup = await recoveryLookup(c, ctx)
    if (lookup.error || lookup.state !== ZOHO_STATE.MISSING) {
      const out = await applyRecovery(row, c, lookup, { recoveryCheck: true, reason: 'Checked Zoho before allowing a retry.' }, ctx)
      return { ...out, retryAllowed: false }
    }
    const at = ctx.now().toISOString()
    const evidence = { serverLookup: evidenceOf(lookup, at), adminVerification: verification, acknowledged: true, reason }
    const confirmed = await ctx.store.transitionComponent(
      ctx.db, row.id, [COMPONENT_STATUS.POSTING_UNCERTAIN], COMPONENT_STATUS.POSTING_UNCERTAIN,
      { recoveryCheckAt: at, event: EVENT.ADMIN_CONFIRMED_NOT_CREATED, evidence },
      `${ctx.actor} confirmed the uncertain ${recordLabel(c)} was not created in Zoho (own check ${verification.checkedAt} in ${verification.zohoLocation}): ${reason}`,
      ctx.actor,
    )
    const detail = `Retry allowed by ${ctx.actor} after confirming in Zoho that the uncertain attempt created nothing: ${reason}`
    const allowed = await ctx.store.transitionComponent(
      ctx.db, confirmed.id, [COMPONENT_STATUS.POSTING_UNCERTAIN], COMPONENT_STATUS.FAILED,
      { lastError: detail, retryAuthorization: { at, by: ctx.actor, reason, evidence }, event: EVENT.RETRY_ALLOWED, evidence },
      detail,
      ctx.actor,
    )
    return { ...outcomeOf(c, allowed, { reason: detail, evidence }), retryAllowed: true }
  })
}

module.exports = {
  postPayoutCustomerGroup,
  postPayoutFeeJournal,
  postPayoutRefund,
  recheckUncertainComponent,
  confirmUncertainNotCreated,
  RECOVERY_SCOPE,
  POSTING_ORDER,
  REFUND_POSTING_ORDER,
}
