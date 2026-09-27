'use strict'

/**
 * Guarded write path: one Stripe PaymentIntent → one Zoho customer payment.
 * Every request re-validates Stripe, the website order and Zoho live. There is no
 * bulk, scheduled or webhook-driven posting.
 *
 * The PaymentIntent ID is the idempotency key everywhere: the local row, the
 * advisory lock and the Zoho `reference_number`. An uncertain POST is never
 * repeated; it is resolved by looking the reference up in Zoho.
 */

const { getStripeClearingConfig } = require('../../config/stripeClearing')
const defaultStripeConfig = require('../../config/stripe')
const defaultSources = require('./stripeClearingSources')
const defaultStore = require('./stripeClearingStore')
const { MATCH_STATUS, expectedZohoCustomerId } = require('./stripeClearingMatcher')
const { evaluatePaymentIntent } = require('./stripeClearingDryRunService')
const { postingGate } = require('./stripeClearingGate')

const { CLEARING_STATUS } = defaultStore
const PI_PATTERN = /^pi_[A-Za-z0-9]{8,64}$/
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000
const UNRESOLVED = [CLEARING_STATUS.POSTING, CLEARING_STATUS.FAILED_NEEDS_REVIEW]

// Raised before the request left this server, or Zoho refused it before processing.
const NOT_SENT_CODES = new Set([
  'ZOHO_NOT_CONFIGURED',
  'ZOHO_SYNC_PAUSED',
  'ZOHO_RATE_MINUTE_LIMIT',
  'ZOHO_DAILY_LIMIT',
  'ZOHO_SAFE_STOP',
  'ZOHO_HTTP_429',
])

function defaultDeps() {
  const db = require('../../db')
  return {
    config: getStripeClearingConfig(),
    stripeConfig: defaultStripeConfig,
    sources: defaultSources,
    store: defaultStore,
    zohoPayments: require('../amazonPaymentClearingZohoPaymentService'),
    pool: db.pool,
    queryDb: { query: db.query },
    now: () => new Date(),
  }
}

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function differs(a, b, tolerance) {
  return Math.abs(round2(a) - round2(b)) > tolerance
}

function safeMessage(err, stripeConfig = defaultStripeConfig) {
  return stripeConfig.redact(String((err && err.message) || err || 'Unknown error')).slice(0, 500)
}

function fail(status, code, message, extra = {}) {
  const err = new Error(message)
  err.status = status
  err.code = code
  Object.assign(err, extra)
  return err
}

function dubaiDate(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return new Date(t + DUBAI_OFFSET_MS).toISOString().slice(0, 10)
}

function customerLabel(order) {
  return order.shopOrder ? 'Burjman Shop - Web & App' : 'Website'
}

function postErrorKind(err) {
  if (err && NOT_SENT_CODES.has(err.code)) return 'rejected'
  if (err && err.code === 'ZOHO_API_ERROR' && err.zohoResponse) return 'rejected'
  const status = Number(err && err.httpStatus)
  if (status >= 400 && status < 500) return 'rejected'
  return 'ambiguous'
}

function unavailable(err, stripeConfig) {
  if (err && err.code === 'STRIPE_NOT_CONFIGURED') return fail(503, 'STRIPE_NOT_CONFIGURED', 'Stripe is not configured, so the payment cannot be verified.')
  if (err && err.stage === 'stripe') return fail(503, 'STRIPE_UNAVAILABLE', `Stripe could not be read: ${safeMessage(err, stripeConfig)}`)
  if (err && err.stage === 'website') return fail(503, 'WEBSITE_DB_UNAVAILABLE', `Website orders could not be read: ${safeMessage(err, stripeConfig)}`)
  return fail(503, 'ZOHO_UNAVAILABLE', `Zoho could not be read: ${safeMessage(err, stripeConfig)}`)
}

async function zohoRead(fn, stripeConfig) {
  try {
    return await fn()
  } catch (err) {
    if (err && err.code === 'ZOHO_REFERENCE_FILTER_IGNORED') throw fail(502, err.code, err.message)
    throw fail(503, 'ZOHO_UNAVAILABLE', `Zoho could not be read: ${safeMessage(err, stripeConfig)}`)
  }
}

/**
 * Resolve "Stripe Undeposited Funds" from the Zoho chart of accounts. Never falls
 * back to another account.
 */
async function resolveStripeDepositAccount(config, zohoPayments) {
  let accounts
  try {
    accounts = await zohoPayments.listZohoChartAccounts()
  } catch (err) {
    throw fail(503, 'ZOHO_UNAVAILABLE', `Zoho chart of accounts could not be read: ${safeMessage(err)}`)
  }
  const wanted = config.depositAccountName.toLowerCase()
  const matches = accounts.filter((a) => clean(a.accountName).toLowerCase() === wanted)
  if (matches.length === 0) {
    throw fail(422, 'STRIPE_DEPOSIT_ACCOUNT_MISSING', `Zoho account "${config.depositAccountName}" was not found. Nothing was posted.`)
  }
  if (matches.length > 1) {
    throw fail(422, 'STRIPE_DEPOSIT_ACCOUNT_AMBIGUOUS', `${matches.length} Zoho accounts are named "${config.depositAccountName}". Nothing was posted.`)
  }
  const account = matches[0]
  if (!account.isActive) {
    throw fail(422, 'STRIPE_DEPOSIT_ACCOUNT_INACTIVE', `Zoho account "${config.depositAccountName}" is inactive. Nothing was posted.`)
  }
  if (config.depositAccountCode && clean(account.accountCode) !== config.depositAccountCode) {
    throw fail(422, 'STRIPE_DEPOSIT_ACCOUNT_CODE_MISMATCH', `Zoho account "${config.depositAccountName}" has code ${account.accountCode || '(none)'}, expected ${config.depositAccountCode}.`)
  }
  if (config.depositAccountId && account.accountId !== config.depositAccountId) {
    throw fail(422, 'STRIPE_DEPOSIT_ACCOUNT_ID_MISMATCH', `STRIPE_CLEARING_DEPOSIT_ACCOUNT_ID does not match Zoho account "${config.depositAccountName}".`)
  }
  return { accountId: account.accountId, accountName: account.accountName, accountCode: account.accountCode }
}

function invoiceProblem(live, expect, tolerance) {
  const label = expect.invoiceNumber
  if (!live) return ['ZOHO_INVOICE_GONE', `Zoho invoice ${label} no longer exists.`]
  if (live.invoiceId !== expect.invoiceId) return ['ZOHO_INVOICE_CHANGED', `Zoho returned a different invoice for ${label}.`]
  if (live.status === 'void') return ['ZOHO_INVOICE_VOID', `Zoho invoice ${label} is void.`]
  if (live.status === 'draft') return ['ZOHO_INVOICE_DRAFT', `Zoho invoice ${label} is a draft.`]
  if (live.status === 'paid' || live.balance <= tolerance) return ['ZOHO_INVOICE_ALREADY_PAID', `Zoho invoice ${label} is already paid.`]
  if (clean(live.referenceNumber) !== expect.orderNumber) return ['ZOHO_INVOICE_REFERENCE_CHANGED', `Zoho invoice ${label} no longer references order ${expect.orderNumber}.`]
  if (live.customerId !== expect.customerId) return ['ZOHO_INVOICE_CUSTOMER_CHANGED', `Zoho invoice ${label} is no longer under the expected customer.`]
  if (clean(live.currencyCode).toUpperCase() !== expect.currency) return ['ZOHO_INVOICE_CURRENCY_CHANGED', `Zoho invoice ${label} is not in ${expect.currency}.`]
  if (differs(live.balance, expect.amount, tolerance)) {
    return ['ZOHO_INVOICE_BALANCE_CHANGED', `Zoho invoice ${label} balance is ${round2(live.balance)}, not ${round2(expect.amount)}.`]
  }
  if (differs(live.total, expect.amount, tolerance)) {
    return ['ZOHO_INVOICE_TOTAL_CHANGED', `Zoho invoice ${label} total is ${round2(live.total)}, not ${round2(expect.amount)}.`]
  }
  return null
}

/** Check a Zoho payment read back from Zoho against what this clearing intended. */
function verifyZohoPayment(payment, invoiceAfter, row, tolerance) {
  const problems = []
  if (!payment) {
    problems.push('The Zoho payment could not be read back.')
  } else {
    if (clean(payment.reference_number) !== row.stripePaymentIntentId) problems.push(`Reference is "${clean(payment.reference_number)}".`)
    if (differs(payment.amount, row.amount, tolerance)) problems.push(`Amount is ${round2(payment.amount)}, expected ${round2(row.amount)}.`)
    if (clean(payment.customer_id) !== row.zohoCustomerId) problems.push('Customer differs.')
    if (clean(payment.account_id) !== row.zohoAccountId) problems.push('Deposit account differs.')
    const applied = Array.isArray(payment.invoices) ? payment.invoices : []
    const ours = applied.filter((inv) => clean(inv.invoice_id) === row.zohoInvoiceId)
    const appliedAmount = ours.reduce((sum, inv) => sum + (Number(inv.amount_applied) || 0), 0)
    if (ours.length === 0) problems.push(`Not applied to ${row.zohoInvoiceNumber}.`)
    else if (differs(appliedAmount, row.amount, tolerance)) problems.push(`Applied ${round2(appliedAmount)} to ${row.zohoInvoiceNumber}, expected ${round2(row.amount)}.`)
    if (applied.length > ours.length) problems.push('Also applied to other invoices.')
  }
  if (!invoiceAfter) {
    problems.push(`Zoho invoice ${row.zohoInvoiceNumber} could not be read after posting.`)
  } else if (invoiceAfter.balance > tolerance) {
    problems.push(`Zoho invoice ${row.zohoInvoiceNumber} still has balance ${round2(invoiceAfter.balance)}.`)
  }
  return { ok: problems.length === 0, problems, balanceAfter: invoiceAfter ? invoiceAfter.balance : null }
}

function publicClearing(record) {
  if (!record) return null
  return {
    status: record.status,
    paymentIntentId: record.stripePaymentIntentId,
    websiteOrderNumber: record.websiteOrderNumber,
    zohoInvoiceId: record.zohoInvoiceId,
    zohoInvoiceNumber: record.zohoInvoiceNumber,
    zohoPaymentId: record.zohoPaymentId,
    amount: record.amount,
    currency: record.currency,
    paymentDate: record.paymentDate,
    attemptCount: record.attemptCount,
    lastError: record.lastError,
    postedAt: record.postedAt,
    updatedAt: record.updatedAt,
  }
}

function outcome(kind, record, extra = {}) {
  return { outcome: kind, clearing: publicClearing(record), ...extra }
}

function buildFields({ stripe, order, invoice, account, config }) {
  return {
    stripePaymentIntentId: stripe.paymentIntentId,
    stripeChargeId: stripe.chargeId || null,
    stripeLivemode: stripe.livemode === true,
    websiteOrderId: order.orderId,
    websiteOrderNumber: order.orderNumber,
    zohoInvoiceId: invoice.invoiceId,
    zohoInvoiceNumber: invoice.invoiceNumber,
    zohoCustomerId: expectedZohoCustomerId(order, config),
    zohoAccountId: account.accountId,
    amount: round2(stripe.amountReceived),
    currency: config.websiteCurrency,
    paymentDate: dubaiDate(stripe.succeededAt || stripe.date),
    stripeCreatedAt: stripe.date,
  }
}

/** The payment handed to the shared Zoho service. No notes or description are sent. */
function buildPayment(fields, config) {
  return {
    customerId: fields.zohoCustomerId,
    paymentMode: config.paymentMode,
    amount: fields.amount,
    paymentDate: fields.paymentDate,
    referenceNumber: fields.stripePaymentIntentId,
    depositToAccountId: fields.zohoAccountId,
    invoices: [{ invoiceId: fields.zohoInvoiceId, amountApplied: fields.amount }],
  }
}

async function blockIfTracked(existing, detail, ctx) {
  if (ctx.readOnly || !existing || !defaultStore.RETRYABLE.includes(existing.status)) return
  await ctx.store
    .transition(ctx.db, existing.id, defaultStore.RETRYABLE, CLEARING_STATUS.BLOCKED, { lastError: detail }, detail, ctx.actor)
    .catch((err) => console.error('[stripe-clearing] could not mark BLOCKED:', safeMessage(err)))
}

/**
 * Rebuild the match live and check the Zoho invoice again.
 * @returns {Promise<{ kind: 'READY'|'ALREADY_CLEARED', evaluation: object, fields: object, liveInvoice?: object }>}
 */
async function validateLive(paymentIntentId, account, ctx, existing) {
  const { config, sources, stripeConfig } = ctx
  let evaluation
  try {
    evaluation = await evaluatePaymentIntent(paymentIntentId, { sources, config, localClearing: existing })
  } catch (err) {
    throw unavailable(err, stripeConfig)
  }
  const { stripe, order, invoice, match } = evaluation
  if (!stripe) throw fail(404, 'STRIPE_PAYMENT_INTENT_NOT_FOUND', `Stripe has no PaymentIntent ${paymentIntentId}.`)
  if (stripe.livemode !== true) {
    throw fail(403, 'STRIPE_TEST_MODE_PAYMENT', 'Test-mode Stripe payments can never clear Zoho invoices.')
  }
  if (match.status === MATCH_STATUS.ALREADY_CLEARED && order && invoice) {
    return { kind: 'ALREADY_CLEARED', evaluation, fields: buildFields({ stripe, order, invoice, account, config }) }
  }
  if (match.status !== MATCH_STATUS.MATCHED_READY_TO_CLEAR) {
    await blockIfTracked(existing, `Not eligible: ${match.status}. ${match.reason}`, ctx)
    throw fail(409, 'NOT_ELIGIBLE', match.reason, { matchStatus: match.status })
  }

  const fields = buildFields({ stripe, order, invoice, account, config })
  if (!fields.paymentDate) throw fail(409, 'NOT_ELIGIBLE', 'Stripe payment has no usable payment date.', { matchStatus: match.status })
  const liveInvoice = await zohoRead(() => sources.fetchZohoInvoiceById(invoice.invoiceId), stripeConfig)
  const problem = invoiceProblem(
    liveInvoice,
    {
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      orderNumber: order.orderNumber,
      customerId: fields.zohoCustomerId,
      currency: config.websiteCurrency,
      amount: fields.amount,
    },
    config.amountTolerance,
  )
  if (problem) {
    await blockIfTracked(existing, problem[1], ctx)
    throw fail(409, problem[0], problem[1])
  }
  return { kind: 'READY', evaluation, fields, liveInvoice }
}

async function markNeedsReview(row, fromStatuses, detail, ctx, patch = {}) {
  try {
    return await ctx.store.transition(
      ctx.db,
      row.id,
      fromStatuses,
      CLEARING_STATUS.FAILED_NEEDS_REVIEW,
      { ...patch, lastError: detail },
      detail,
      ctx.actor,
    )
  } catch (err) {
    console.error('[stripe-clearing] could not mark FAILED_NEEDS_REVIEW:', safeMessage(err))
    return row
  }
}

async function finishPosted(row, zohoPaymentId, fromStatuses, opts, ctx) {
  const { sources, zohoPayments, config, stripeConfig } = ctx
  let verification
  try {
    const payment = await zohoPayments.getZohoCustomerPayment(zohoPaymentId, { source: 'stripe_clearing_verify' })
    const invoiceAfter = await sources.fetchZohoInvoiceById(row.zohoInvoiceId)
    verification = verifyZohoPayment(payment, invoiceAfter, row, config.amountTolerance)
  } catch (err) {
    verification = { ok: false, problems: [`Read-back failed: ${safeMessage(err, stripeConfig)}`], balanceAfter: null }
  }
  if (!verification.ok) {
    const how = opts.recovered ? 'was found by reference' : 'was created'
    const detail = `Zoho payment ${zohoPaymentId} ${how} but verification failed: ${verification.problems.join(' ')}`
    const updated = await markNeedsReview(row, fromStatuses, detail, ctx, { zohoPaymentId })
    throw fail(502, 'ZOHO_PAYMENT_VERIFICATION_FAILED', detail, { clearing: publicClearing(updated), zohoPaymentId })
  }
  let posted
  try {
    posted = await ctx.store.transition(
      ctx.db,
      row.id,
      fromStatuses,
      CLEARING_STATUS.POSTED,
      { zohoPaymentId, postedAt: ctx.now().toISOString() },
      opts.recovered ? `Recovered Zoho payment ${zohoPaymentId} by reference.` : `Zoho payment ${zohoPaymentId} created and verified.`,
      ctx.actor,
    )
  } catch (err) {
    console.error('[stripe-clearing] local record failed after Zoho post:', safeMessage(err, stripeConfig))
    throw fail(
      500,
      'LOCAL_RECORD_FAILED_AFTER_POST',
      `Zoho payment ${zohoPaymentId} exists and was verified, but the local record could not be saved. ` +
        'The next request for this PaymentIntent recovers it by reference. Do not create it in Zoho by hand.',
      { zohoPaymentId },
    )
  }
  return outcome(opts.recovered ? 'RECOVERED' : 'POSTED', posted, {
    invoiceBalanceBefore: opts.balanceBefore == null ? null : round2(opts.balanceBefore),
    invoiceBalanceAfter: verification.balanceAfter == null ? null : round2(verification.balanceAfter),
  })
}

/**
 * Resolve an attempt whose Zoho result is unknown. Looks the PaymentIntent
 * reference up in Zoho; never re-POSTs.
 */
async function recoverByReference(row, fromStatuses, reason, ctx) {
  const pi = row.stripePaymentIntentId
  let refs
  try {
    refs = await ctx.sources.findZohoPaymentsByReference(pi, { critical: true, source: 'stripe_clearing_recovery' })
  } catch (err) {
    const detail = `${reason} Reference lookup failed: ${safeMessage(err, ctx.stripeConfig)}`
    const updated = await markNeedsReview(row, fromStatuses, detail, ctx)
    throw fail(502, 'ZOHO_POST_AMBIGUOUS', detail, { clearing: publicClearing(updated) })
  }
  if (refs.length === 1) {
    return finishPosted(row, refs[0].paymentId, fromStatuses, { recovered: true }, ctx)
  }
  const detail = refs.length === 0
    ? `${reason} No Zoho payment has reference ${pi}; it will not be re-posted automatically.`
    : `${reason} ${refs.length} Zoho payments have reference ${pi}.`
  const updated = await markNeedsReview(row, fromStatuses, detail, ctx)
  throw fail(refs.length === 0 ? 502 : 409, refs.length === 0 ? 'ZOHO_POST_AMBIGUOUS' : 'DUPLICATE_ZOHO_REFERENCE', detail, {
    clearing: publicClearing(updated),
  })
}

/** Invoice already paid in Zoho by a payment carrying this PaymentIntent: record it, do not post. */
async function reconcileAlreadyCleared(live, existing, ctx) {
  const { sources, zohoPayments, config, stripeConfig } = ctx
  const { fields, evaluation } = live
  const pi = fields.stripePaymentIntentId
  const refs = await zohoRead(
    () => sources.findZohoPaymentsByReference(pi, { critical: true, source: 'stripe_clearing_post_check' }),
    stripeConfig,
  )
  if (refs.length !== 1) {
    throw fail(409, 'NOT_ELIGIBLE', evaluation.match.reason, { matchStatus: evaluation.match.status })
  }
  const payment = await zohoRead(() => zohoPayments.getZohoCustomerPayment(refs[0].paymentId, { source: 'stripe_clearing_verify' }), stripeConfig)
  const invoiceNow = await zohoRead(() => sources.fetchZohoInvoiceById(fields.zohoInvoiceId), stripeConfig)
  const check = verifyZohoPayment(payment, invoiceNow, fields, config.amountTolerance)
  if (!check.ok) {
    throw fail(409, 'NOT_ELIGIBLE', `${evaluation.match.reason} A Zoho payment with reference ${pi} exists but does not match: ${check.problems.join(' ')}`, {
      matchStatus: evaluation.match.status,
    })
  }
  const recorded = await ctx.store.recordExistingPosted(
    ctx.db,
    fields,
    refs[0].paymentId,
    clean(payment.date) || ctx.now().toISOString(),
    `Zoho payment ${refs[0].paymentId} already had reference ${pi}; recorded without posting.`,
    ctx.actor,
  )
  if (!recorded.recorded) {
    throw fail(409, 'CLEARING_STATE_CONFLICT', `Could not record the existing Zoho payment (${recorded.conflict}).`)
  }
  return outcome('ALREADY_CLEARED_RECORDED', recorded.row)
}

async function postLocked(paymentIntentId, account, ctx) {
  const { store, sources, zohoPayments, config, stripeConfig } = ctx
  const existing = await store.getByIntent(ctx.db, paymentIntentId)
  if (existing && existing.status === CLEARING_STATUS.POSTED) {
    return outcome('ALREADY_POSTED', existing)
  }
  if (existing && UNRESOLVED.includes(existing.status)) {
    return recoverByReference(existing, [existing.status], `Previous attempt ended as ${existing.status}.`, ctx)
  }

  const live = await validateLive(paymentIntentId, account, ctx, existing)
  if (live.kind === 'ALREADY_CLEARED') return reconcileAlreadyCleared(live, existing, ctx)

  const refs = await zohoRead(
    () => sources.findZohoPaymentsByReference(paymentIntentId, { critical: true, source: 'stripe_clearing_post_check' }),
    stripeConfig,
  )
  if (refs.length > 0) {
    const detail = `Zoho already has ${refs.length} payment(s) with reference ${paymentIntentId} while ${live.fields.zohoInvoiceNumber} is still open.`
    await blockIfTracked(existing, detail, ctx)
    throw fail(409, 'DUPLICATE_ZOHO_REFERENCE', detail)
  }

  const claim = await store.claimForPosting(ctx.db, live.fields, ctx.actor)
  if (!claim.claimed) {
    if (claim.conflict === 'INVOICE_CLAIMED' || claim.conflict === 'uq_stripe_payment_clearings_invoice') {
      throw fail(409, 'DUPLICATE_ZOHO_INVOICE_CLAIM', `Zoho invoice ${live.fields.zohoInvoiceNumber} is already linked to another Stripe payment.`, {
        clearing: publicClearing(claim.row),
      })
    }
    if (claim.row && claim.row.status === CLEARING_STATUS.POSTED) return outcome('ALREADY_POSTED', claim.row)
    throw fail(409, 'DUPLICATE_STRIPE_PAYMENT_INTENT', `PaymentIntent ${paymentIntentId} already has a clearing record (${claim.conflict}).`, {
      clearing: publicClearing(claim.row),
    })
  }
  const row = claim.row

  let created
  try {
    created = await zohoPayments.createZohoCustomerPayment(buildPayment(live.fields, config), {
      source: 'stripe_clearing_post',
      retryTransport: false,
    })
  } catch (err) {
    if (postErrorKind(err) === 'rejected') {
      const detail = `Zoho did not accept the payment: ${safeMessage(err, stripeConfig)}`
      let failed = row
      try {
        failed = await store.transition(ctx.db, row.id, [CLEARING_STATUS.POSTING], CLEARING_STATUS.FAILED, { lastError: detail }, detail, ctx.actor)
      } catch (markErr) {
        console.error('[stripe-clearing] could not mark FAILED:', safeMessage(markErr, stripeConfig))
      }
      throw fail(NOT_SENT_CODES.has(err.code) ? 503 : 422, 'ZOHO_REJECTED_PAYMENT', detail, { clearing: publicClearing(failed) })
    }
    return recoverByReference(row, [CLEARING_STATUS.POSTING], `Zoho payment POST result is unknown (${safeMessage(err, stripeConfig)}).`, ctx)
  }
  if (!created || !clean(created.zohoPaymentId)) {
    return recoverByReference(row, [CLEARING_STATUS.POSTING], 'Zoho answered without a payment ID.', ctx)
  }
  return finishPosted(row, clean(created.zohoPaymentId), [CLEARING_STATUS.POSTING], { recovered: false, balanceBefore: live.liveInvoice.balance }, ctx)
}

function assertPaymentIntentId(paymentIntentId) {
  const pi = clean(paymentIntentId)
  if (!PI_PATTERN.test(pi)) throw fail(400, 'INVALID_PAYMENT_INTENT_ID', 'A Stripe PaymentIntent ID (pi_…) is required.')
  return pi
}

/**
 * Post one PaymentIntent to Zoho after full live re-validation.
 * @param {string} paymentIntentId
 * @param {{ actor?: string }} [opts]
 * @param {object} [overrides] test seams
 */
async function postStripeClearing(paymentIntentId, opts = {}, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const pi = assertPaymentIntentId(paymentIntentId)
  const gate = postingGate(deps.config, deps.stripeConfig)
  if (!gate.allowed) {
    throw fail(403, gate.reasons[0].code, gate.reasons.map((r) => r.message).join(' '), { reasons: gate.reasons })
  }
  const account = await resolveStripeDepositAccount(deps.config, deps.zohoPayments)
  const lock = await deps.store.acquireIntentLock(deps.pool, pi)
  try {
    return await postLocked(pi, account, { ...deps, db: lock.db, actor: opts.actor || null, readOnly: false })
  } finally {
    await lock.release().catch((err) => console.error('[stripe-clearing] lock release failed:', safeMessage(err)))
  }
}

/**
 * Read-only: run every pre-post check and return the exact payment that would be
 * sent. Writes nothing locally or in Zoho.
 */
async function previewStripeClearing(paymentIntentId, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const pi = assertPaymentIntentId(paymentIntentId)
  const gate = postingGate(deps.config, deps.stripeConfig)
  const account = await resolveStripeDepositAccount(deps.config, deps.zohoPayments)
  const ctx = { ...deps, db: deps.queryDb, actor: null, readOnly: true }
  const existing = await deps.store.getByIntent(deps.queryDb, pi)
  if (existing && existing.status === CLEARING_STATUS.POSTED) return outcome('ALREADY_POSTED', existing)
  if (existing && UNRESOLVED.includes(existing.status)) {
    throw fail(409, 'CLEARING_NEEDS_REVIEW', `A previous attempt ended as ${existing.status}.`, { clearing: publicClearing(existing) })
  }
  const live = await validateLive(pi, account, ctx, existing)
  if (live.kind !== 'READY') {
    throw fail(409, 'NOT_ELIGIBLE', live.evaluation.match.reason, { matchStatus: live.evaluation.match.status })
  }
  const refs = await zohoRead(
    () => deps.sources.findZohoPaymentsByReference(pi, { critical: true, source: 'stripe_clearing_post_check' }),
    deps.stripeConfig,
  )
  if (refs.length > 0) throw fail(409, 'DUPLICATE_ZOHO_REFERENCE', `Zoho already has a payment with reference ${pi}.`)

  const payment = buildPayment(live.fields, deps.config)
  const { order } = live.evaluation
  return {
    outcome: 'PREVIEW',
    postingEnabled: gate.allowed,
    postingBlockedReasons: gate.reasons,
    paymentIntentId: pi,
    stripeChargeId: live.fields.stripeChargeId,
    websiteOrderNumber: live.fields.websiteOrderNumber,
    zohoInvoiceId: live.fields.zohoInvoiceId,
    zohoInvoiceNumber: live.fields.zohoInvoiceNumber,
    zohoInvoiceBalance: round2(live.liveInvoice.balance),
    amount: live.fields.amount,
    currency: live.fields.currency,
    paymentDate: live.fields.paymentDate,
    zohoCustomer: { id: live.fields.zohoCustomerId, name: customerLabel(order) },
    zohoAccount: account,
    zohoPayload: deps.zohoPayments.buildCustomerPaymentPayload(payment, { depositToAccountId: account.accountId }),
  }
}

/** Read-only: local record, its history and the live Zoho invoice. */
async function getStripeClearing(paymentIntentId, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const pi = assertPaymentIntentId(paymentIntentId)
  const record = await deps.store.getByIntent(deps.queryDb, pi)
  if (!record) return { clearing: null, events: [], zohoInvoice: null }
  const events = await deps.store.listEvents(deps.queryDb, record.id)
  const invoice = await zohoRead(() => deps.sources.fetchZohoInvoiceById(record.zohoInvoiceId), deps.stripeConfig)
  return {
    clearing: publicClearing(record),
    events,
    zohoInvoice: invoice
      ? { invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber, status: invoice.status, total: invoice.total, balance: invoice.balance }
      : null,
  }
}

module.exports = {
  postStripeClearing,
  previewStripeClearing,
  getStripeClearing,
  resolveStripeDepositAccount,
  verifyZohoPayment,
  postErrorKind,
  dubaiDate,
}
