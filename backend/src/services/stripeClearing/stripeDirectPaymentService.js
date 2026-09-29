'use strict'

/**
 * Admin actions for direct Stripe payments (Payment Links) against an existing Zoho invoice:
 * invoice search, read-only validation, confirmation and release of the local mapping.
 *
 * Nothing here creates, changes or deletes anything in Zoho, Stripe or the website database;
 * they are only read. Confirmation and release hold the payout posting lock so they never race
 * a post, and the preview's posting fingerprint covers every allocation the mapping adds.
 */

const { getStripeClearingConfig } = require('../../config/stripeClearing')
const defaultSources = require('./stripeClearingSources')
const directStore = require('./stripeDirectPaymentStore')
const directModel = require('./stripeDirectPaymentModel')
const payoutStore = require('./stripePayoutClearingStore')
const clearingStore = require('./stripeClearingStore')

const PAYOUT_PATTERN = /^po_[A-Za-z0-9]{8,64}$/
const INTENT_PATTERN = /^pi_[A-Za-z0-9]{8,64}$/
const READ = { source: 'stripe_direct_payment_mapping' }
const SEARCH_BY = new Set(['auto', 'invoice', 'reference', 'amount'])

function fail(status, code, message, extra = {}) {
  const err = new Error(message)
  err.status = status
  err.code = code
  Object.assign(err, extra)
  return err
}

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function toMinor(major) {
  return Math.round((Number(major) || 0) * 100)
}

function defaultDeps() {
  const db = () => require('../../db')
  return {
    config: getStripeClearingConfig(),
    sources: defaultSources,
    store: directStore,
    clearingStore,
    reader: { query: (sql, params) => db().query(sql, params) },
    acquireLock: (payoutId) => payoutStore.acquirePayoutLock(db().pool, payoutId),
    previewPayout: (payoutId) => require('./stripePayoutPreviewService').previewPayout(payoutId),
  }
}

function assertIds(payoutId, paymentIntentId) {
  const po = clean(payoutId)
  const pi = clean(paymentIntentId)
  if (!PAYOUT_PATTERN.test(po)) throw fail(400, 'INVALID_PAYOUT_ID', 'A Stripe payout ID (po_…) is required.')
  if (!INTENT_PATTERN.test(pi)) throw fail(400, 'INVALID_PAYMENT_INTENT', 'A Stripe PaymentIntent ID (pi_…) is required.')
  return { po, pi }
}

function customerIdsFor(customer, config) {
  const key = clean(customer).toLowerCase()
  if (key === 'website') return [config.websiteZohoCustomerId]
  if (key === 'shop') return [config.shopZohoCustomerId]
  return [config.websiteZohoCustomerId, config.shopZohoCustomerId]
}

function criteriaFor(q, by) {
  const text = clean(q)
  if (!text) throw fail(400, 'SEARCH_REQUIRED', 'Enter an invoice number, P.O.# or amount.')
  const mode = by === 'auto'
    ? (/^inv-/i.test(text) ? 'invoice' : /^\d+\.\d{1,2}$/.test(text) ? 'amount' : 'reference')
    : by
  if (mode === 'invoice') return { mode, criteria: { invoiceNumber: text.toUpperCase() } }
  if (mode === 'reference') return { mode, criteria: { reference: text.replace(/^#/, '') } }
  const amount = Number(text.replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) throw fail(400, 'INVALID_AMOUNT', 'Enter the amount as a number, e.g. 1261.00.')
  return { mode, criteria: { amount } }
}

/**
 * Zoho invoice search by invoice number, P.O.# (reference) or amount, within the Stripe-clearing
 * customers. Read-only. Each row says whether it may be selected and why not.
 * @param {{ q: string, by?: string, customer?: 'website'|'shop'|'all' }} input
 */
async function searchInvoices(input = {}, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const by = SEARCH_BY.has(clean(input.by)) ? clean(input.by) : 'auto'
  const { mode, criteria } = criteriaFor(input.q, by)
  const customers = customerIdsFor(input.customer, deps.config)
  const rows = []
  if (mode === 'amount') {
    for (const customerId of customers) rows.push(...await deps.sources.searchZohoInvoices({ ...criteria, customerId }, READ))
  } else {
    const found = await deps.sources.searchZohoInvoices(criteria, READ)
    rows.push(...(clean(input.customer) && clean(input.customer).toLowerCase() !== 'all' ? found.filter((inv) => customers.includes(inv.customerId)) : found))
  }
  const invoices = []
  for (const inv of rows) {
    const key = directModel.customerKeyOf(inv.customerId, deps.config)
    const mapping = await deps.store.getActiveByInvoice(deps.reader, inv.invoiceId)
    const reasons = []
    if (!key) reasons.push('Customer is not a Stripe-clearing customer.')
    if (directModel.BLOCKED_INVOICE_STATUS.has(inv.status)) reasons.push(`Invoice is ${inv.status}.`)
    if (toMinor(inv.balance) === 0) reasons.push('Invoice is fully paid.')
    if (mapping) reasons.push(`Already mapped to ${mapping.paymentIntentId}.`)
    invoices.push({
      invoiceId: inv.invoiceId,
      invoiceNumber: inv.invoiceNumber,
      referenceNumber: inv.referenceNumber,
      customerId: inv.customerId,
      customerName: directModel.customerNameOf(inv.customerId, deps.config) || inv.customerName || inv.customerId,
      customerKey: key,
      date: inv.date,
      total: inv.total,
      balance: inv.balance,
      status: inv.status,
      currencyCode: inv.currencyCode,
      selectable: reasons.length === 0,
      notSelectableReasons: reasons,
    })
  }
  return { mode, query: clean(input.q), invoices, zohoWrites: 0 }
}

function findLine(result, pi) {
  const unassigned = (result.unassigned || []).find((l) => l.paymentIntentId === pi)
  if (unassigned) return { line: unassigned, group: null }
  for (const group of result.groups || []) {
    const line = group.lines.find((l) => l.paymentIntentId === pi)
    if (line) return { line, group }
  }
  return null
}

function evidenceText(assessment, invoice, evidence) {
  if (assessment.status === directModel.EVIDENCE.MATCH) {
    const texts = assessment.matched.flatMap((r) => r.sources.map((s) => `${s.source} "${s.text}"`))
    return `${texts.join('; ')} ↔ ${invoice.invoiceNumber} P.O.# ${invoice.referenceNumber || '—'}`
  }
  if (evidence && evidence.checkoutEvidence && evidence.checkoutEvidence !== 'AVAILABLE') {
    return 'Payment Link evidence unavailable (Stripe key cannot read Checkout Sessions); verified manually, invoice number re-typed by the admin.'
  }
  return 'No Stripe reference; invoice number re-typed by the admin.'
}

async function runValidation(po, pi, invoiceId, deps) {
  const id = clean(invoiceId)
  if (!id) throw fail(400, 'INVOICE_REQUIRED', 'Select a Zoho invoice.')
  const result = await deps.previewPayout(po)
  const found = findLine(result, pi)
  if (!found) throw fail(404, 'CHARGE_NOT_IN_PAYOUT', `PaymentIntent ${pi} has no charge in payout ${po}.`)
  const { line, group } = found
  if (group) {
    const how = line.direct ? `mapped to ${line.direct.invoiceNumber}` : line.website ? `website order ${line.website.orderNumber}` : 'its customer group'
    throw fail(409, 'CHARGE_ALREADY_ASSIGNED', `PaymentIntent ${pi} already clears through ${how}.`)
  }
  const currency = deps.config.websiteCurrency
  let evidence = line.stripeEvidence
  if (!evidence) {
    try {
      evidence = await deps.sources.getPaymentIntentEvidence(pi)
    } catch {
      throw fail(502, 'STRIPE_PAYMENT_UNREADABLE', `Stripe PaymentIntent ${pi} could not be read; the mapping cannot be checked.`)
    }
  }
  const references = directModel.extractReferences(evidence)
  const invoice = await deps.sources.getZohoInvoiceDetail(id, READ)
  const [intentMapping] = await deps.store.listActiveByIntents(deps.reader, [pi])
  const invoiceMapping = invoice ? await deps.store.getActiveByInvoice(deps.reader, invoice.invoiceId) : null
  const allocatingComponents = await deps.store.listComponentsAllocating(deps.reader, { zohoInvoiceId: id, paymentIntentId: pi })
  const zohoIntentPayments = await deps.sources.findZohoPaymentsByReference(pi, READ)
  const localClearing = await deps.clearingStore.getByIntent(deps.reader, pi)
  const websiteOrdersForIntent = await deps.sources.loadWebsiteOrdersByIntents([pi], currency)
  const ordersWithReference = invoice && invoice.referenceNumber ? await deps.sources.loadWebsiteOrdersByNumbers([invoice.referenceNumber], currency) : []
  const competingOrders = ordersWithReference.filter((o) => !o.deleted && clean(o.stripePaymentIntentId) && o.stripePaymentIntentId !== pi)
  const v = directModel.validateDirectMapping({
    line, invoice, config: deps.config, evidence, references, intentMapping, invoiceMapping, allocatingComponents,
    competingOrders, zohoIntentPayments, localClearing, websiteOrdersForIntent,
  })
  return {
    payoutId: po,
    paymentIntentId: pi,
    chargeId: line.chargeId,
    stripe: { gross: line.gross, fee: line.fee, net: line.net, currency, createdAt: line.chargeCreatedAt, description: line.description },
    stripeEvidence: evidence,
    checkoutEvidence: evidence.checkoutEvidence || 'AVAILABLE',
    references,
    invoice: invoice
      ? {
          invoiceId: invoice.invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          referenceNumber: invoice.referenceNumber,
          customerId: invoice.customerId,
          customerName: directModel.customerNameOf(invoice.customerId, deps.config),
          customerKey: v.customerKey,
          date: invoice.date,
          total: invoice.total,
          balance: invoice.balance,
          status: invoice.status,
          currencyCode: invoice.currencyCode,
        }
      : null,
    websiteOrdersWithReference: ordersWithReference.map((o) => ({ orderNumber: o.orderNumber, orderStatus: o.orderStatus, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod, hasStripePaymentIntent: Boolean(clean(o.stripePaymentIntentId)), deleted: o.deleted })),
    checks: v.checks,
    blocking: v.blocking,
    evidenceStatus: v.evidence.status,
    evidenceSummary: invoice ? evidenceText(v.evidence, invoice, evidence) : null,
    requiresTypedInvoiceNumber: directModel.evidenceNeedsTypedConfirmation(v.evidence.status),
    _assessment: v,
  }
}

function publicValidation({ _assessment, ...rest }) {
  return rest
}

/** Every check for mapping one charge to one invoice; changes nothing. */
async function validateDirectPayment(payoutId, paymentIntentId, invoiceId, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const { po, pi } = assertIds(payoutId, paymentIntentId)
  return { ...publicValidation(await runValidation(po, pi, invoiceId, deps)), zohoWrites: 0 }
}

/**
 * Admin confirms a direct Stripe payment for one Zoho invoice. Re-validates under the payout
 * lock; every blocking check must pass. Without a Stripe reference to the invoice the admin must
 * re-type the invoice number (amount alone is never enough). Writes one local row only.
 */
async function confirmDirectPayment(payoutId, paymentIntentId, opts = {}, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const { po, pi } = assertIds(payoutId, paymentIntentId)
  const reason = clean(opts.reason)
  if (!opts.actor) throw fail(401, 'ACTOR_REQUIRED', 'The confirming admin could not be identified.')
  if (reason.length < directModel.MIN_REASON_LENGTH) throw fail(400, 'REASON_REQUIRED', `Explain the mapping (at least ${directModel.MIN_REASON_LENGTH} characters).`)
  const lock = await deps.acquireLock(po)
  try {
    const v = await runValidation(po, pi, opts.invoiceId, deps)
    if (v.blocking) {
      throw fail(409, 'DIRECT_MAPPING_BLOCKED', `Mapping blocked: ${v.checks.filter((c) => c.blocking).map((c) => `${c.label} — ${c.detail}`).join(' ')}`, { reasons: v.checks.filter((c) => c.blocking).map((c) => c.detail) })
    }
    if (v.requiresTypedInvoiceNumber && clean(opts.confirmInvoiceNumber).toUpperCase() !== v.invoice.invoiceNumber.toUpperCase()) {
      throw fail(400, 'EVIDENCE_REQUIRED', `Stripe does not reference ${v.invoice.invoiceNumber}. Re-type the invoice number to confirm this mapping by hand.`)
    }
    const mapping = await deps.store.insertMapping(lock.db, {
      paymentIntentId: pi,
      chargeId: v.chargeId,
      zohoInvoiceId: v.invoice.invoiceId,
      zohoInvoiceNumber: v.invoice.invoiceNumber,
      zohoCustomerId: v.invoice.customerId,
      customerKey: v.invoice.customerKey,
      payoutId: po,
      currency: v.stripe.currency,
      stripeGross: v.stripe.gross,
      invoiceReference: v.invoice.referenceNumber || null,
      evidence: v.evidenceSummary,
      reason,
      mappedBy: opts.actor,
    })
    return { mapping, zohoWrites: 0, stripeWrites: 0 }
  } finally {
    await lock.release()
  }
}

/**
 * Release a mapping made in error. Only while its payout customer has no local component and
 * Zoho shows none of the group's records; afterwards a separate correction process applies.
 */
async function releaseDirectPayment(payoutId, paymentIntentId, opts = {}, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const { po, pi } = assertIds(payoutId, paymentIntentId)
  const reason = clean(opts.reason)
  if (!opts.actor) throw fail(401, 'ACTOR_REQUIRED', 'The admin could not be identified.')
  if (reason.length < directModel.MIN_REASON_LENGTH) throw fail(400, 'REASON_REQUIRED', `Explain the release (at least ${directModel.MIN_REASON_LENGTH} characters).`)
  const lock = await deps.acquireLock(po)
  try {
    const [mapping] = await deps.store.listActiveByIntents(lock.db, [pi])
    if (!mapping) throw fail(404, 'DIRECT_MAPPING_NOT_FOUND', `No active direct-payment mapping for ${pi}.`)
    if (mapping.payoutId !== po) throw fail(409, 'DIRECT_MAPPING_OTHER_PAYOUT', `The mapping was confirmed in payout ${mapping.payoutId}.`)
    const result = await deps.previewPayout(po)
    const found = findLine(result, pi)
    if (found && found.line.direct && !found.line.direct.removable) throw fail(409, 'DIRECT_MAPPING_LOCKED', found.line.direct.lockedReason)
    const group = found && found.group
    const inZoho = group ? group.components.filter((c) => c.zoho && c.zoho.state !== 'MISSING') : []
    if (inZoho.length > 0) {
      throw fail(409, 'DIRECT_MAPPING_LOCKED', `Zoho already holds ${inZoho.map((c) => `${c.component} (${c.zoho.state})`).join(', ')} for this payout customer; the mapping can only change through a separate correction.`)
    }
    const released = await deps.store.releaseMapping(lock.db, mapping.id, { actor: opts.actor, reason })
    return { mapping: released, zohoWrites: 0, stripeWrites: 0 }
  } finally {
    await lock.release()
  }
}

/** Every mapping (active and released) of one PaymentIntent. */
async function directPaymentHistory(paymentIntentId, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const pi = clean(paymentIntentId)
  if (!INTENT_PATTERN.test(pi)) throw fail(400, 'INVALID_PAYMENT_INTENT', 'A Stripe PaymentIntent ID (pi_…) is required.')
  return { paymentIntentId: pi, mappings: await deps.store.listHistoryByIntent(deps.reader, pi) }
}

module.exports = {
  searchInvoices,
  validateDirectPayment,
  confirmDirectPayment,
  releaseDirectPayment,
  directPaymentHistory,
}
