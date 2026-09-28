'use strict'

/**
 * Guarded Zoho posting of one payout + customer group (never per PaymentIntent).
 *
 * Order: NET customer payment → verify → FEE customer payment → verify → (when the group
 * has an admin-confirmed overpayment) CUSTOMER_ADVANCE journal → verify. The advance
 * refund journal is never part of this: it belongs to the later payout holding the refund.
 *
 * Every request:
 * - requires the server posting gate (STRIPE_CLEARING_POSTING_ENABLED + live Stripe key);
 * - holds a per-payout advisory lock;
 * - re-runs the live preview and refuses unless the group is still postable and its
 *   accounting plan equals the one the admin reviewed (posting fingerprint);
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

const { GROUP_STATUS, COMPONENT, ZOHO_STATE, RECOVERY_ACTION } = model
const { COMPONENT_STATUS, CASE_STATUS } = payoutStore

const PAYOUT_PATTERN = /^po_[A-Za-z0-9]{8,64}$/
const POSTING_ORDER = [COMPONENT.NET, COMPONENT.FEE, COMPONENT.CUSTOMER_ADVANCE]
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

const recordLabel = (c) => (c.zohoRecordType === 'journal' ? 'journal' : 'customer payment')

/** Everything checked against the live preview before any Zoho record is created. */
function assertPostable(result, group, fingerprint, config) {
  const needsReview = (code, message, reasons) => fail(409, code, message, { reasons, groupStatus: GROUP_STATUS.NEEDS_REVIEW })
  if (group.postingFingerprint !== fingerprint) {
    throw needsReview('PREVIEW_CHANGED', 'The payout, invoices, accounts or customer advance changed since this preview. Reload the preview and review it again. Nothing was posted.')
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

/** Resolve a POST whose result is unknown by searching Zoho; never re-POSTs. */
async function resolveUncertain(local, c, reason, ctx) {
  const { store, db, actor } = ctx
  let state
  try {
    state = await ctx.zohoState(c)
  } catch (err) {
    const detail = `${reason} Zoho could not be searched afterwards (${safeMessage(err, ctx.stripeConfig)}); confirm in Zoho before retrying.`
    return outcomeOf(c, await store.transitionComponent(db, local.id, [COMPONENT_STATUS.POSTING], COMPONENT_STATUS.NEEDS_REVIEW, { lastError: detail }, detail, actor), { requestSent: true, reason: detail })
  }
  if (state.state === ZOHO_STATE.VERIFIED) {
    const at = ctx.now().toISOString()
    const detail = `${reason} Zoho search found exactly one matching ${recordLabel(c)} ${state.recordId}; recorded as verified.`
    const row = await store.transitionComponent(db, local.id, [COMPONENT_STATUS.POSTING], COMPONENT_STATUS.VERIFIED, { zohoRecordId: state.recordId, postedAt: at, verifiedAt: at }, detail, actor)
    return outcomeOf(c, row, { requestSent: true, reason: detail })
  }
  if (state.state === ZOHO_STATE.MISSING) {
    const detail = `${reason} No matching Zoho ${recordLabel(c)} was found; it was not re-posted and may be retried.`
    return outcomeOf(c, await store.transitionComponent(db, local.id, [COMPONENT_STATUS.POSTING], COMPONENT_STATUS.FAILED, { lastError: detail }, detail, actor), { requestSent: true, reason: detail })
  }
  const detail = `${reason} ${state.reason}`
  return outcomeOf(c, await store.transitionComponent(db, local.id, [COMPONENT_STATUS.POSTING], COMPONENT_STATUS.NEEDS_REVIEW, { lastError: detail }, detail, actor), { requestSent: true, reason: detail })
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
    const row = await store.transitionComponent(db, local.id, [COMPONENT_STATUS.POSTED], COMPONENT_STATUS.VERIFIED, { verifiedAt: ctx.now().toISOString() }, `Zoho ${recordLabel(c)} ${recordId} verified: reference, customer, account, amount and allocations match.`, actor)
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
    zoho = await ctx.zohoState(c)
  } catch (err) {
    return outcomeOf(c, local, { reason: `Zoho could not be searched before posting (${safeMessage(err, stripeConfig)}); nothing was sent.` })
  }
  const plan = model.planRecovery(zoho, local)
  if (plan.action === RECOVERY_ACTION.SKIP_VERIFIED) {
    if (local.status !== COMPONENT_STATUS.VERIFIED) {
      const at = ctx.now().toISOString()
      local = await store.transitionComponent(
        db, local.id,
        [COMPONENT_STATUS.PLANNED, COMPONENT_STATUS.FAILED, COMPONENT_STATUS.POSTING, COMPONENT_STATUS.POSTED, COMPONENT_STATUS.NEEDS_REVIEW],
        COMPONENT_STATUS.VERIFIED,
        { zohoRecordId: zoho.recordId, postedAt: local.postedAt ? null : at, verifiedAt: at },
        `Zoho ${recordLabel(c)} ${zoho.recordId} already exists and matches exactly; recorded without posting.`,
        actor,
      )
    }
    return outcomeOf(c, local, { reason: plan.reason })
  }
  if (plan.action === RECOVERY_ACTION.NEEDS_REVIEW) {
    if (local.status !== COMPONENT_STATUS.NEEDS_REVIEW) {
      local = await store.transitionComponent(db, local.id, [local.status], COMPONENT_STATUS.NEEDS_REVIEW, { lastError: plan.reason }, plan.reason, actor)
    }
    return outcomeOf(c, local, { reason: plan.reason })
  }

  local = await store.transitionComponent(
    db, local.id, [COMPONENT_STATUS.PLANNED, COMPONENT_STATUS.FAILED], COMPONENT_STATUS.POSTING,
    { incrementAttempt: true },
    `Posting ${c.component} ${c.amount} (${c.reference}) to Zoho, attempt ${local.attemptCount + 1}.`,
    actor,
  )
  let created
  try {
    created = c.zohoRecordType === 'journal' ? await ctx.writer.createJournal(c.payload) : await ctx.writer.createCustomerPayment(c.payload)
  } catch (err) {
    if (postErrorKind(err) === 'rejected') {
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
 * Post one payout + customer group to Zoho.
 * @param {string} payoutId
 * @param {string} customerKey "website" | "burjman" (or the exact Zoho customer ID)
 * @param {{ actor?: string, fingerprint?: string }} opts fingerprint = group.postingFingerprint from the reviewed preview
 * @param {object} [overrides] test seams
 */
async function postPayoutCustomerGroup(payoutId, customerKey, opts = {}, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const id = clean(payoutId)
  if (!PAYOUT_PATTERN.test(id)) throw fail(400, 'INVALID_PAYOUT_ID', 'A Stripe payout ID (po_…) is required.')
  const customerId = resolveCustomer(customerKey, deps.config)
  const gate = postingGate(deps.config, deps.stripeConfig)
  if (!gate.allowed) throw fail(403, gate.reasons[0].code, `${gate.reasons.map((r) => r.message).join(' ')} Nothing was posted.`, { reasons: gate.reasons.map((r) => r.message) })
  if (!opts.actor) throw fail(401, 'ACTOR_REQUIRED', 'The posting admin could not be identified.')
  const fingerprint = clean(opts.fingerprint)
  if (!fingerprint) throw fail(400, 'FINGERPRINT_REQUIRED', 'Post from a loaded preview (posting fingerprint missing).')

  const previewDeps = { ...deps.previewDeps, config: deps.config, stripeConfig: deps.stripeConfig }
  const lock = await deps.store.acquirePayoutLock(deps.pool, id)
  try {
    return await postLocked(id, customerId, fingerprint, {
      ...deps,
      db: lock.db,
      actor: opts.actor,
      previewPayout: (pid) => preview.previewPayout(pid, previewDeps),
      zohoState: (c) => preview.componentZohoState(c, customerId, id, previewDeps),
    })
  } finally {
    await lock.release().catch((err) => console.error('[stripe-payout-posting] lock release failed:', safeMessage(err, deps.stripeConfig)))
  }
}

module.exports = { postPayoutCustomerGroup, POSTING_ORDER }
