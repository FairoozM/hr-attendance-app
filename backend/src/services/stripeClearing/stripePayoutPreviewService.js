'use strict'

/**
 * Read-only preview of payout-level clearing. One Stripe payout → per Zoho customer
 * (Website / Burjman Shop, never mixed):
 * - NET customer payment → Stripe Undeposited Funds (1019), allocated invoice by invoice
 * - FEE customer payment → Stripe Processing Chg Un-Cleared (1013), allocated invoice by invoice
 * - CUSTOMER_ADVANCE journal Dr 1019 / Cr Customer Advance Funds (1123) for admin-confirmed
 *   overpayments (Stripe gross above the invoice total)
 * Refund balance transactions in the payout are either the return of a confirmed customer
 * advance (Dr 1123 / Cr 1019) or a normal invoice refund: a refund of the existing Zoho credit
 * note from 1019 (+ a 1019/1013 journal when Stripe adjusted its fee). The two never mix.
 *
 * Nothing here writes to Stripe, the website database, Zoho or the local database.
 * Amounts are kept in minor units until output.
 */

const crypto = require('crypto')
const { getStripeClearingConfig } = require('../../config/stripeClearing')
const defaultStripeConfig = require('../../config/stripe')
const { postingGate } = require('./stripeClearingGate')
const defaultSources = require('./stripeClearingSources')
const { MATCH_STATUS, classifyStripePayment, expectedZohoCustomerId, pickMatchedInvoice } = require('./stripeClearingMatcher')
const model = require('./stripePayoutClearingModel')
const payoutStore = require('./stripePayoutClearingStore')
const directStore = require('./stripeDirectPaymentStore')
const directModel = require('./stripeDirectPaymentModel')
const { dubaiDateOf, getDubaiPostingDate } = require('./stripePostingDate')

const { GROUP_STATUS, PAYOUT_STATUS, COMPONENT, ZOHO_STATE, RECOVERY_ACTION, POSTABLE_GROUP, NORMAL_REFUND_STATUS } = model
const { CASE_STATUS, REFUND_STATUS, ENTITY, COMPONENT_STATUS } = payoutStore

const PAYOUT_PATTERN = /^po_[A-Za-z0-9]{8,64}$/
const CHARGE_TYPES = new Set(['charge', 'payment'])
const LIVE_REFUND = new Set(['succeeded', 'pending'])
const PREVIEW = { source: 'stripe_payout_preview' }
// Normal refund statuses that may be sent to Zoho (VERIFIED only when not yet tracked locally).
const POSTABLE_REFUND = new Set([NORMAL_REFUND_STATUS.READY, NORMAL_REFUND_STATUS.FAILED, NORMAL_REFUND_STATUS.POSTED])
const REVIEW_REFUND = new Set([NORMAL_REFUND_STATUS.NEEDS_REVIEW, NORMAL_REFUND_STATUS.MISMATCH])

function isRefundTxn(t) {
  return t.type === 'refund' || t.reportingCategory === 'refund'
}
// Case statuses whose advance belongs in the payout's clearing.
const CONFIRMED_CASE = new Set([CASE_STATUS.CONFIRMED, CASE_STATUS.ADVANCE_POSTED, CASE_STATUS.REFUNDED])
// Case statuses a later Stripe refund may be linked to.
const REFUNDABLE_CASE = new Set([CASE_STATUS.CONFIRMED, CASE_STATUS.ADVANCE_POSTED])

const LINE_STATE = Object.freeze({
  OPEN: 'OPEN',
  PARTIALLY_CLEARED: 'PARTIALLY_CLEARED',
  CLEARED: 'CLEARED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
})

function defaultRecords() {
  const reader = { query: (sql, params) => require('../../db').query(sql, params) }
  return {
    loadAdvanceCases: (chargeIds) => payoutStore.listCasesByChargeIds(reader, chargeIds),
    loadComponents: (payoutId) => payoutStore.listComponents(reader, payoutId),
    loadCaseEvents: (caseIds) => payoutStore.listEvents(reader, ENTITY.ADVANCE_CASE, caseIds),
    loadRefundComponents: (refundIds) => payoutStore.listRefundComponents(reader, refundIds),
    loadDirectMappings: (intentIds) => directStore.listActiveByIntents(reader, intentIds),
  }
}

function defaultDeps() {
  return {
    config: getStripeClearingConfig(),
    stripeConfig: defaultStripeConfig,
    sources: defaultSources,
    zohoPayments: require('../amazonPaymentClearingZohoPaymentService'),
    records: defaultRecords(),
  }
}

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function toMajor(minor) {
  return Math.round(Number(minor) || 0) / 100
}

function toMinor(major) {
  return Math.round((Number(major) || 0) * 100)
}

function fail(status, code, message) {
  const err = new Error(message)
  err.status = status
  err.code = code
  return err
}

function assertPayoutId(payoutId) {
  const id = clean(payoutId)
  if (!PAYOUT_PATTERN.test(id)) throw fail(400, 'INVALID_PAYOUT_ID', 'A Stripe payout ID (po_…) is required.')
  return id
}

function customerName(customerId, config) {
  if (customerId === config.websiteZohoCustomerId) return config.websiteCustomerName
  if (customerId === config.shopZohoCustomerId) return config.shopCustomerName
  return customerId
}

/** Exact name + code + active + type; never falls back to another account. */
function resolveAccount(accounts, { name, code, type, id }) {
  const matches = accounts.filter((a) => clean(a.accountName).toLowerCase() === name.toLowerCase())
  if (matches.length !== 1) return { account: null, problem: `${matches.length} Zoho accounts are named "${name}".` }
  const a = matches[0]
  if (clean(a.accountCode) !== code) return { account: null, problem: `Zoho account "${name}" has code ${a.accountCode || '(none)'}, expected ${code}.` }
  if (!a.isActive) return { account: null, problem: `Zoho account "${name}" is inactive.` }
  if (clean(a.accountType) !== type) return { account: null, problem: `Zoho account "${name}" is type ${a.accountType}, expected ${type}.` }
  if (id && clean(a.accountId) !== id) return { account: null, problem: `Zoho account "${name}" has ID ${a.accountId}, expected ${id}.` }
  return { account: { accountId: a.accountId, accountName: a.accountName, accountCode: a.accountCode, accountType: a.accountType }, problem: null }
}

async function resolveAccounts(config, zohoPayments) {
  const accounts = await zohoPayments.listZohoChartAccounts()
  const net = resolveAccount(accounts, { name: config.depositAccountName, code: config.depositAccountCode, type: 'cash' })
  const fee = resolveAccount(accounts, { name: config.feeAccountName, code: config.feeAccountCode, type: 'cash' })
  const advance = resolveAccount(accounts, {
    name: config.advanceAccountName,
    code: config.advanceAccountCode,
    type: config.advanceAccountType,
    id: config.advanceAccountId,
  })
  const feeExpense = resolveAccount(accounts, {
    name: config.feeExpenseAccountName,
    code: config.feeExpenseAccountCode,
    type: config.feeExpenseAccountType,
    id: config.feeExpenseAccountId,
  })
  return {
    net: net.account,
    fee: fee.account,
    advance: advance.account,
    feeExpense: feeExpense.account,
    problems: { base: [net.problem, fee.problem].filter(Boolean), advance: advance.problem, feeExpense: feeExpense.problem },
  }
}

/** Stripe composition of a payout; the payout's own balance transaction is excluded. */
function summarizeComposition(payout, txns) {
  const content = txns.filter((t) => t.type !== 'payout')
  const charges = content.filter((t) => CHARGE_TYPES.has(t.type))
  const other = content.filter((t) => !CHARGE_TYPES.has(t.type))
  const sum = (list, key) => list.reduce((s, t) => s + (Number(t[key]) || 0), 0)
  const netMinor = sum(content, 'netMinor')
  return {
    chargeCount: charges.length,
    chargeGross: toMajor(sum(charges, 'amountMinor')),
    chargeFee: toMajor(sum(charges, 'feeMinor')),
    chargeNet: toMajor(sum(charges, 'netMinor')),
    otherCount: other.length,
    otherNet: toMajor(sum(other, 'netMinor')),
    contentNet: toMajor(netMinor),
    payoutAmount: toMajor(payout.amountMinor),
    // Stripe pays out the net of every balance transaction in the payout.
    reconciles: netMinor === payout.amountMinor,
  }
}

function publicOther(t) {
  return {
    balanceTransactionId: t.balanceTransactionId,
    type: t.type,
    reportingCategory: t.reportingCategory,
    amount: toMajor(t.amountMinor),
    fee: toMajor(t.feeMinor),
    net: toMajor(t.netMinor),
    description: t.description,
    sourceId: t.sourceId,
    chargeId: t.chargeId,
    paymentIntentId: t.paymentIntentId,
  }
}

/**
 * Invoice state for a line whose Stripe side was accepted by the matcher.
 * `expectedTotalMinor` is what the Zoho invoice total must equal.
 */
function invoiceState(match, invoice, customerId, expectedTotalMinor) {
  const ownInvoice = invoice && invoice.customerId === customerId && toMinor(invoice.total) === expectedTotalMinor
  if (match.status === MATCH_STATUS.MATCHED_READY_TO_CLEAR) return { state: LINE_STATE.OPEN, reason: match.reason }
  if (match.status === MATCH_STATUS.ALREADY_CLEARED && ownInvoice) {
    return { state: LINE_STATE.CLEARED, reason: `Zoho invoice ${invoice.invoiceNumber} is already paid.` }
  }
  if (match.status === MATCH_STATUS.ZOHO_BALANCE_MISMATCH && ownInvoice) {
    return { state: LINE_STATE.PARTIALLY_CLEARED, reason: `Zoho invoice ${invoice.invoiceNumber} is partly paid (balance ${invoice.balance}).` }
  }
  if (match.status === MATCH_STATUS.ALREADY_CLEARED && invoice && invoice.customerId === customerId) {
    return { state: LINE_STATE.NEEDS_REVIEW, reason: `Zoho invoice ${invoice.invoiceNumber} total ${invoice.total} does not equal ${toMajor(expectedTotalMinor)}.` }
  }
  return { state: LINE_STATE.NEEDS_REVIEW, reason: match.reason }
}

function publicRefundCheck(check) {
  return {
    status: check.status,
    matchesAdvance: check.ok,
    reason: check.reason,
    refundedAmount: check.refundedAmount,
    refunds: check.refunds,
    refund: check.refund,
  }
}

function publicMapping(m) {
  return {
    mappingId: m.id,
    mappingType: m.mappingType,
    status: m.status,
    paymentIntentId: m.paymentIntentId,
    chargeId: m.chargeId,
    zohoInvoiceId: m.zohoInvoiceId,
    invoiceNumber: m.zohoInvoiceNumber,
    zohoCustomerId: m.zohoCustomerId,
    customerKey: m.customerKey,
    invoiceReference: m.invoiceReference,
    stripeGross: m.stripeGross,
    evidence: m.evidence,
    reason: m.reason,
    firstPayoutId: m.payoutId,
    mappedBy: m.mappedBy,
    mappedAt: m.mappedAt,
    // Set once the payout's local components are known.
    removable: false,
    lockedReason: null,
  }
}

/**
 * A charge an admin mapped to an existing Zoho invoice (direct Stripe payment / Payment Link).
 * It clears exactly like an invoice-backed website charge: invoice = gross, NET and FEE as Stripe
 * split them. The mapping is re-checked against Stripe and the live invoice on every preview.
 */
async function buildDirectLine(t, line, mapping, ctx) {
  const { config, sources } = ctx
  const base = {
    ...line,
    source: directModel.SOURCE.DIRECT_STRIPE_PAYMENT,
    direct: publicMapping(mapping),
    customerId: mapping.zohoCustomerId,
    matchStatus: 'DIRECT_PAYMENT_MAPPED',
  }
  const review = (reason) => ({ ...base, state: LINE_STATE.NEEDS_REVIEW, reason })
  const label = `Direct-payment mapping ${mapping.id} (${mapping.zohoInvoiceNumber})`
  if (!directModel.customerKeyOf(mapping.zohoCustomerId, config)) return review(`${label} names customer ${mapping.zohoCustomerId}, which is not a Stripe-clearing customer.`)
  if (mapping.chargeId && t.chargeId && mapping.chargeId !== t.chargeId) return review(`${label} was confirmed for charge ${mapping.chargeId}, not ${t.chargeId}.`)
  if (toMinor(mapping.stripeGross) !== t.amountMinor) return review(`${label} was confirmed for ${mapping.stripeGross}; Stripe now shows ${toMajor(t.amountMinor)}.`)
  if (clean(mapping.currency) !== t.currency) return review(`${label} is in ${mapping.currency}; Stripe is ${t.currency}.`)
  if (t.chargeDisputed) return review('Stripe charge is disputed.')
  if (t.chargeRefundedMinor > 0) return review(`Stripe refunded ${toMajor(t.chargeRefundedMinor)} on this direct payment; refunds of direct payments are resolved by hand.`)
  if (typeof sources.getZohoInvoiceDetail !== 'function') return review('Zoho invoice lookup is unavailable.')
  const inv = await cached(ctx.stripeCache, `direct-inv:${mapping.zohoInvoiceId}`, () => sources.getZohoInvoiceDetail(mapping.zohoInvoiceId, PREVIEW))
  if (!inv) return review(`Zoho no longer has invoice ${mapping.zohoInvoiceNumber}.`)
  base.invoice = {
    invoiceId: inv.invoiceId,
    invoiceNumber: inv.invoiceNumber,
    total: inv.total,
    balance: inv.balance,
    status: inv.status,
    customerId: inv.customerId,
    referenceNumber: inv.referenceNumber,
    date: inv.date,
  }
  if (inv.invoiceNumber !== mapping.zohoInvoiceNumber) return review(`${label}: Zoho invoice ${mapping.zohoInvoiceId} is now numbered ${inv.invoiceNumber}.`)
  if (inv.customerId !== mapping.zohoCustomerId) return review(`${label}: Zoho ${inv.invoiceNumber} is now under customer ${inv.customerId}.`)
  if (clean(inv.currencyCode).toUpperCase() !== config.websiteCurrency) return review(`Zoho ${inv.invoiceNumber} is in ${inv.currencyCode}.`)
  if (directModel.BLOCKED_INVOICE_STATUS.has(inv.status)) return review(`Zoho ${inv.invoiceNumber} is ${inv.status}.`)
  if (toMinor(inv.total) !== t.amountMinor) return review(`Zoho ${inv.invoiceNumber} total ${inv.total} does not equal Stripe ${toMajor(t.amountMinor)}.`)
  const who = `mapped by ${mapping.mappedBy}`
  if (toMinor(inv.balance) === toMinor(inv.total)) {
    return { ...base, state: LINE_STATE.OPEN, reason: `Direct Stripe payment for Zoho ${inv.invoiceNumber} (P.O.# ${inv.referenceNumber || '—'}), ${who}.` }
  }
  if (inv.status === 'paid' || toMinor(inv.balance) === 0) {
    return { ...base, state: LINE_STATE.CLEARED, reason: `Zoho invoice ${inv.invoiceNumber} is already paid (direct Stripe payment, ${who}).` }
  }
  return { ...base, state: LINE_STATE.PARTIALLY_CLEARED, reason: `Zoho invoice ${inv.invoiceNumber} is partly paid (balance ${inv.balance}; direct Stripe payment, ${who}).` }
}

const MAX_SUGGESTION_REFERENCES = 3

/**
 * Stripe evidence and an invoice suggestion for a charge without a website order. Read-only;
 * a suggestion is never a mapping. Lookup failures are reported, not hidden.
 */
async function describeUnassigned(line, ctx) {
  const { sources, config } = ctx
  const eligible = !line.website && !line.direct && Boolean(line.paymentIntentId)
    && (ctx.ordersByIntent.get(line.paymentIntentId) || []).length === 0
  const out = {
    directEligible: eligible,
    directIneligibleReason: eligible ? null : line.direct ? 'A direct-payment mapping exists for this PaymentIntent.' : line.website || (ctx.ordersByIntent.get(line.paymentIntentId) || []).length > 0 ? 'A website order carries this PaymentIntent.' : 'The charge has no PaymentIntent.',
    stripeEvidence: null,
    references: [],
    suggestion: null,
    evidenceError: null,
  }
  if (!eligible || typeof sources.getPaymentIntentEvidence !== 'function') return out
  try {
    const evidence = await cached(ctx.stripeCache, `evidence:${line.paymentIntentId}`, () => sources.getPaymentIntentEvidence(line.paymentIntentId))
    out.stripeEvidence = evidence
    out.references = directModel.extractReferences(evidence)
    const refs = out.references.slice(0, MAX_SUGGESTION_REFERENCES)
    const invoices = []
    for (const r of refs) {
      if (r.kind === 'reference') invoices.push(...await cached(ctx.cache, `inv-ref:${r.value}`, () => sources.findZohoInvoicesByReference(r.value, PREVIEW)))
      else if (typeof sources.searchZohoInvoices === 'function') invoices.push(...await sources.searchZohoInvoices({ invoiceNumber: r.value }, PREVIEW))
    }
    out.suggestion = directModel.suggestInvoice({ references: out.references, invoices, grossMinor: line.grossMinor, config })
  } catch {
    // Raw Stripe errors can name the API key; the admin only needs to know to verify by hand.
    out.evidenceError = 'Stripe/Zoho evidence could not be read. Manual verification is required.'
  }
  return out
}

async function buildLine(t, ctx) {
  const { config, sources, ordersByIntent, casesByCharge, payout, payoutTxnIds } = ctx
  const line = {
    balanceTransactionId: t.balanceTransactionId,
    chargeId: t.chargeId,
    paymentIntentId: t.paymentIntentId,
    grossMinor: t.amountMinor,
    feeMinor: t.feeMinor,
    netMinor: t.netMinor,
    // Standard line: invoice = gross, NET and FEE allocated as Stripe split them.
    invoiceTotalMinor: t.amountMinor,
    netAllocMinor: t.netMinor,
    feeAllocMinor: t.feeMinor,
    advanceMinor: 0,
    currency: t.currency,
    source: null,
    website: null,
    direct: null,
    invoice: null,
    customerId: null,
    advance: null,
    refund: null,
    normalRefunds: null,
    state: LINE_STATE.NEEDS_REVIEW,
    matchStatus: null,
    reason: '',
    chargeCreatedAt: t.createdAt || null,
    description: t.description || null,
  }
  const review = (reason) => ({ ...line, state: LINE_STATE.NEEDS_REVIEW, reason })

  if (t.currency !== config.websiteCurrency || t.exchangeRate != null) return review(`Stripe balance transaction is ${t.currency}${t.exchangeRate != null ? ' with conversion' : ''}.`)
  if (t.amountMinor !== t.netMinor + t.feeMinor) return review('Stripe gross does not equal net + fee.')
  if (!t.paymentIntentId) return review('Stripe charge has no PaymentIntent.')

  const websiteOrders = ordersByIntent.get(t.paymentIntentId) || []
  const mapping = ctx.mappingsByIntent ? ctx.mappingsByIntent.get(t.paymentIntentId) || null : null
  if (mapping && websiteOrders.length > 0) {
    line.direct = publicMapping(mapping)
    return review(`Website order(s) ${websiteOrders.map((o) => o.orderNumber).join(', ')} and direct-payment mapping ${mapping.id} (${mapping.zohoInvoiceNumber}) both claim this PaymentIntent; it cannot clear both ways.`)
  }
  if (mapping) return buildDirectLine(t, line, mapping, ctx)

  const order = websiteOrders.length === 1 ? websiteOrders[0] : null
  if (order) {
    line.source = directModel.SOURCE.WEBSITE_ORDER
    line.website = { orderId: order.orderId, orderNumber: order.orderNumber, finalAmount: order.finalAmount, shopOrder: order.shopOrder, orderStatus: order.orderStatus, paymentStatus: order.paymentStatus }
    line.customerId = expectedZohoCustomerId(order, config)
  }

  let zohoInvoices = null
  if (order && clean(order.orderNumber)) {
    zohoInvoices = await sources.findZohoInvoicesByReference(order.orderNumber, { source: 'stripe_payout_preview' })
  }
  const linkedCase = t.chargeId ? casesByCharge.get(t.chargeId) : null
  const orderTotalMinor = order ? toMinor(order.finalAmount) : null
  const overpaymentMinor = order && orderTotalMinor > 0 && t.amountMinor > orderTotalMinor ? t.amountMinor - orderTotalMinor : 0
  // The charge's refunded amount is read now, not as of the payout. A later refund of exactly
  // the overpayment is the advance being returned in its own payout; it never rewrites this one.
  let refundCheck = null
  if (overpaymentMinor > 0 && t.chargeRefundedMinor > 0 && t.chargeId) {
    refundCheck = model.assessAdvanceRefund({
      chargeId: t.chargeId,
      paymentIntentId: t.paymentIntentId,
      chargeStatus: t.chargeStatus,
      chargeFullyRefunded: t.chargeFullyRefunded === true,
      chargeRefundedMinor: t.chargeRefundedMinor,
      overpaymentMinor,
      currency: config.websiteCurrency,
      payoutCreatedAt: payout.createdAt,
      payoutBalanceTransactionIds: payoutTxnIds,
      refunds: await sources.listChargeRefunds(t.chargeId),
      storedCase: linkedCase,
    })
    line.refund = publicRefundCheck(refundCheck)
  }
  // A normal refund (no overpayment, no advance case) never rewrites the sale: the invoice
  // clears at its full value here and each refund is a credit note refund in its own payout.
  const refundsClearedSeparately = overpaymentMinor === 0 && t.chargeRefundedMinor > 0 && Boolean(t.chargeId) && !linkedCase
  if (refundsClearedSeparately) {
    const refunds = await cached(ctx.stripeCache, `refunds:${t.chargeId}`, () => sources.listChargeRefunds(t.chargeId))
    line.normalRefunds = refunds.map((r) => ({
      refundId: r.refundId,
      amount: toMajor(r.amountMinor),
      status: r.status,
      createdAt: r.createdAt,
      balanceTransactionId: r.balanceTransaction ? r.balanceTransaction.balanceTransactionId : null,
      inThisPayout: Boolean(r.balanceTransaction && payoutTxnIds.has(r.balanceTransaction.balanceTransactionId)),
      refundStatus: r.balanceTransaction ? NORMAL_REFUND_STATUS.MATCHED : NORMAL_REFUND_STATUS.DETECTED,
    }))
    const listedMinor = refunds.filter((r) => LIVE_REFUND.has(r.status)).reduce((s, r) => s + r.amountMinor, 0)
    if (listedMinor !== t.chargeRefundedMinor) {
      return review(`Stripe shows ${toMajor(t.chargeRefundedMinor)} refunded on this charge, but its refunds add up to ${toMajor(listedMinor)}.`)
    }
  }
  const stripe = {
    paymentIntentId: t.paymentIntentId,
    status: 'succeeded',
    amountReceived: toMajor(t.amountMinor),
    amountRefunded: refundCheck && refundCheck.ok ? 0 : toMajor(t.chargeRefundedMinor),
    disputed: t.chargeDisputed,
    currency: t.currency,
  }
  const match = classifyStripePayment({ stripe, websiteOrders, zohoInvoices, config, refundsClearedSeparately })
  line.matchStatus = match.status
  const invoice = order ? pickMatchedInvoice(zohoInvoices, order.orderNumber) : null
  if (invoice) {
    line.invoice = { invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber, total: invoice.total, balance: invoice.balance, status: invoice.status, customerId: invoice.customerId }
  }
  if (refundCheck && !refundCheck.ok) {
    return review(`Stripe refunded ${toMajor(t.chargeRefundedMinor)} of ${toMajor(t.amountMinor)} (overpayment ${toMajor(overpaymentMinor)}). ${refundCheck.reason}`)
  }

  const overpaid = match.status === MATCH_STATUS.AMOUNT_MISMATCH && overpaymentMinor > 0
  if (!overpaid) {
    const s = invoiceState(match, invoice, line.customerId, t.amountMinor)
    if (refundsClearedSeparately && s.state !== LINE_STATE.NEEDS_REVIEW) {
      const ids = line.normalRefunds.map((r) => `${r.refundId} (${r.amount})`).join(', ')
      s.reason = `${s.reason} Stripe refund(s) ${ids} are cleared separately as credit note refunds in the payout that carries them.`
    }
    return { ...line, ...s }
  }
  if (toMinor(order.walletRedeemed) !== 0) {
    return review(`${match.reason} Website order used ${order.walletRedeemed} wallet credit, which may explain the difference.`)
  }

  // Customer overpayment candidate: every check must pass as if Stripe had collected
  // exactly the website order total (one invoice, same customer, same total, no refund/dispute).
  const asOrderTotal = classifyStripePayment({ stripe: { ...stripe, amountReceived: order.finalAmount }, websiteOrders, zohoInvoices, config })
  const s = invoiceState(asOrderTotal, invoice, line.customerId, orderTotalMinor)
  if (s.state === LINE_STATE.NEEDS_REVIEW) return review(`${match.reason} ${s.reason}`)
  const netAllocMinor = orderTotalMinor - t.feeMinor
  if (netAllocMinor <= 0) return review(`${match.reason} The Stripe fee is not covered by the invoice total.`)
  const refund = refundCheck ? refundCheck.refund : null
  return {
    ...line,
    ...s,
    matchStatus: asOrderTotal.status,
    invoiceTotalMinor: orderTotalMinor,
    netAllocMinor,
    feeAllocMinor: t.feeMinor,
    advanceMinor: overpaymentMinor,
    advance: {
      overpaymentAmount: toMajor(overpaymentMinor),
      invoiceTotal: toMajor(orderTotalMinor),
      stripeGross: toMajor(t.amountMinor),
      netAllocation: toMajor(netAllocMinor),
      caseStatus: CASE_STATUS.REVIEW_REQUIRED,
      confirmed: false,
      caseId: null,
      confirmedBy: null,
      confirmedAt: null,
      reason: null,
      refundStatus: refundCheck ? refundCheck.status : REFUND_STATUS.NOT_REFUNDED,
      refund,
    },
    reason: `Stripe collected ${toMajor(t.amountMinor)} for invoice ${invoice.invoiceNumber} total ${toMajor(orderTotalMinor)}: customer overpayment ${toMajor(overpaymentMinor)}.${refund ? ` Refund ${refund.refundId} of ${refund.amount} already exists and belongs to a later payout.` : ''}`,
  }
}

/** Candidate fields exactly as stored in stripe_customer_advance_cases. */
function advanceCandidate(line, payout, config) {
  return {
    payoutId: payout.payoutId,
    zohoCustomerId: line.customerId,
    customerName: customerName(line.customerId, config),
    orderNumber: line.website.orderNumber,
    invoiceId: line.invoice.invoiceId,
    invoiceNumber: line.invoice.invoiceNumber,
    paymentIntentId: line.paymentIntentId,
    chargeId: line.chargeId,
    balanceTransactionId: line.balanceTransactionId,
    currency: line.currency,
    stripeGross: toMajor(line.grossMinor),
    stripeNet: toMajor(line.netMinor),
    stripeFee: toMajor(line.feeMinor),
    invoiceTotal: toMajor(line.invoiceTotalMinor),
    overpaymentAmount: toMajor(line.advanceMinor),
    netAllocation: toMajor(line.netAllocMinor),
    customerAdvanceAccountId: config.advanceAccountId,
    customerAdvanceAccountCode: config.advanceAccountCode,
    advanceReference: model.advanceReference(payout.payoutId),
  }
}

function caseDifferences(stored, candidate) {
  const keys = ['payoutId', 'zohoCustomerId', 'invoiceId', 'stripeGross', 'stripeNet', 'stripeFee', 'invoiceTotal', 'overpaymentAmount', 'netAllocation']
  return keys.filter((k) => (typeof candidate[k] === 'number' ? toMinor(stored[k]) !== toMinor(candidate[k]) : clean(stored[k]) !== clean(candidate[k])))
}

/** Attach stored advance cases to lines; a case that no longer fits its charge sends the line to review. */
function applyCases(lines, casesByCharge, payout, config) {
  return lines.map((line) => {
    const stored = line.chargeId ? casesByCharge.get(line.chargeId) : null
    if (!line.advance) {
      if (stored && line.state !== LINE_STATE.NEEDS_REVIEW) {
        return { ...line, state: LINE_STATE.NEEDS_REVIEW, reason: `Customer advance case ${stored.id} exists for this charge, but the charge is no longer an overpayment.` }
      }
      return line
    }
    if (!stored) return line
    const diff = caseDifferences(stored, advanceCandidate(line, payout, config))
    if (diff.length > 0) {
      return { ...line, state: LINE_STATE.NEEDS_REVIEW, reason: `Customer advance case ${stored.id} differs from Stripe/Zoho now (${diff.join(', ')}).` }
    }
    if (stored.refundId && !line.advance.refund) {
      return { ...line, state: LINE_STATE.NEEDS_REVIEW, reason: `Customer advance case ${stored.id} records refund ${stored.refundId}, but Stripe no longer shows it on this charge.` }
    }
    const advance = {
      ...line.advance,
      caseId: stored.id,
      caseStatus: stored.status,
      confirmed: CONFIRMED_CASE.has(stored.status),
      confirmedBy: stored.confirmedBy,
      confirmedAt: stored.confirmedAt,
      reason: stored.reason,
      refundStatus: line.advance.refund ? line.advance.refundStatus : stored.refundStatus || REFUND_STATUS.NOT_REFUNDED,
      refundDetectedAt: stored.refundDetectedAt || null,
    }
    if (stored.status === CASE_STATUS.REJECTED) {
      return { ...line, advance, state: LINE_STATE.NEEDS_REVIEW, reason: `Customer advance case ${stored.id} was rejected; resolve this charge manually.` }
    }
    return { ...line, advance }
  })
}

/** One invoice may be cleared by one charge only; every line sharing an invoice goes to review. */
function flagSharedInvoices(lines) {
  const count = new Map()
  for (const l of lines) if (l.invoice && l.state !== LINE_STATE.NEEDS_REVIEW) count.set(l.invoice.invoiceId, (count.get(l.invoice.invoiceId) || 0) + 1)
  return lines.map((l) => (l.invoice && count.get(l.invoice.invoiceId) > 1
    ? { ...l, state: LINE_STATE.NEEDS_REVIEW, reason: `Zoho ${l.invoice.invoiceNumber} is claimed by more than one charge in this payout.` }
    : l))
}

function allocation(line, amountMinor) {
  if (line.direct) {
    return {
      invoiceId: line.invoice.invoiceId,
      invoiceNumber: line.invoice.invoiceNumber,
      orderNumber: null,
      paymentIntentId: line.paymentIntentId,
      source: directModel.SOURCE.DIRECT_STRIPE_PAYMENT,
      amount: toMajor(amountMinor),
    }
  }
  return {
    invoiceId: line.invoice.invoiceId,
    invoiceNumber: line.invoice.invoiceNumber,
    orderNumber: line.website.orderNumber,
    paymentIntentId: line.paymentIntentId,
    amount: toMajor(amountMinor),
  }
}

function publicLine(l) {
  return {
    balanceTransactionId: l.balanceTransactionId,
    chargeId: l.chargeId,
    paymentIntentId: l.paymentIntentId,
    gross: toMajor(l.grossMinor),
    net: toMajor(l.netMinor),
    fee: toMajor(l.feeMinor),
    invoiceTotal: toMajor(l.invoiceTotalMinor),
    netAllocation: toMajor(l.netAllocMinor),
    feeAllocation: toMajor(l.feeAllocMinor),
    customerAdvance: toMajor(l.advanceMinor),
    source: l.source || null,
    website: l.website,
    direct: l.direct || null,
    chargeCreatedAt: l.chargeCreatedAt || null,
    description: l.description || null,
    invoice: l.invoice,
    advance: l.advance,
    refund: l.refund,
    normalRefunds: l.normalRefunds || null,
    state: l.state,
    matchStatus: l.matchStatus,
    reason: l.reason,
  }
}

/** Proposed components for one customer; amounts from allocatable lines only. */
function proposeComponents(customerId, allocatable, payout, accounts, config, date) {
  const sum = (key) => allocatable.reduce((s, l) => s + l[key], 0)
  const netMinor = sum('netAllocMinor')
  const feeMinor = sum('feeAllocMinor')
  const advanceLines = allocatable.filter((l) => l.advanceMinor > 0)
  const advanceMinor = advanceLines.reduce((s, l) => s + l.advanceMinor, 0)
  const components = []
  if (allocatable.length > 0) {
    const net = {
      component: COMPONENT.NET,
      zohoRecordType: 'customer_payment',
      amount: toMajor(netMinor),
      reference: model.netReference(payout.payoutId),
      depositAccountId: accounts.net ? accounts.net.accountId : null,
      account: accounts.net,
      allocations: allocatable.map((l) => allocation(l, l.netAllocMinor)),
      advanceCaseIds: [],
    }
    const fee = {
      component: COMPONENT.FEE,
      zohoRecordType: 'customer_payment',
      amount: toMajor(feeMinor),
      reference: model.feeReference(payout.payoutId),
      depositAccountId: accounts.fee ? accounts.fee.accountId : null,
      account: accounts.fee,
      allocations: allocatable.map((l) => allocation(l, l.feeAllocMinor)),
      advanceCaseIds: [],
    }
    net.payload = model.customerPaymentPayload(net, customerId, date, config.paymentMode)
    fee.payload = model.customerPaymentPayload(fee, customerId, date, config.paymentMode)
    components.push(net, fee)
  }
  if (advanceMinor > 0) {
    const adv = {
      component: COMPONENT.CUSTOMER_ADVANCE,
      zohoRecordType: 'journal',
      amount: toMajor(advanceMinor),
      reference: model.advanceReference(payout.payoutId),
      debitAccountId: accounts.net ? accounts.net.accountId : null,
      creditAccountId: config.advanceAccountId,
      debitAccount: accounts.net,
      creditAccount: accounts.advance || { accountId: config.advanceAccountId, accountName: config.advanceAccountName, accountCode: config.advanceAccountCode },
      allocations: [],
      advanceCaseIds: advanceLines.map((l) => l.advance.caseId).filter(Boolean),
      sources: advanceLines.map((l) => ({
        chargeId: l.chargeId,
        paymentIntentId: l.paymentIntentId,
        invoiceNumber: l.invoice.invoiceNumber,
        orderNumber: l.website.orderNumber,
        amount: toMajor(l.advanceMinor),
      })),
    }
    adv.payload = model.advanceJournalPayload(adv, customerId, date)
    components.push(adv)
  }
  return components
}

function cached(cache, key, load) {
  if (!cache.has(key)) cache.set(key, load())
  return cache.get(key)
}

async function zohoPaymentState(component, customerId, ctx) {
  const all = await cached(ctx.cache, `pay:${component.reference}`, () => ctx.sources.findZohoPaymentsByReference(component.reference, { source: 'stripe_payout_preview' }))
  const mine = all.filter((p) => p.customerId === customerId)
  if (ctx.deep) mine.push(...await invoicePaymentEvidence(component, mine, ctx))
  const records = mine.map((p) => ({ recordId: p.paymentId, amount: p.amount, date: p.date, accountId: p.accountId, accountName: p.accountName }))
  if (mine.length === 0) return { state: ZOHO_STATE.MISSING, recordId: null, records, differences: [] }
  if (mine.length > 1) return { state: ZOHO_STATE.CONFLICT, recordId: null, records, differences: [], reason: `${mine.length} Zoho payments have this reference for this customer.` }
  const detail = await ctx.zohoPayments.getZohoCustomerPayment(mine[0].paymentId, { source: 'stripe_payout_preview' })
  const differences = model.compareCustomerPayment(detail, component, customerId)
  if (differences.length > 0) {
    return { state: ZOHO_STATE.CONFLICT, recordId: mine[0].paymentId, records, differences, reason: `Zoho payment ${mine[0].paymentId} differs: ${differences.join(' ')}` }
  }
  return { state: ZOHO_STATE.VERIFIED, recordId: mine[0].paymentId, records, differences: [], invoices: component.allocations }
}

function incompleteRecovery(message) {
  const err = new Error(message)
  err.code = 'RECOVERY_LOOKUP_INCOMPLETE'
  err.status = 502
  return err
}

/**
 * Recovery evidence read from each allocated invoice itself: a payment under this reference that
 * the payment search index does not show (yet) is still found. Evidence that cannot be read in
 * full fails the lookup; it is never replaced by the weaker search alone.
 */
async function invoicePaymentEvidence(component, known, ctx) {
  if (typeof ctx.sources.listZohoInvoicePayments !== 'function') throw incompleteRecovery('Invoice payment evidence is unavailable; the recovery lookup is incomplete.')
  const allocations = component.allocations || []
  if (allocations.length === 0 || allocations.some((a) => !clean(a.invoiceId))) {
    throw incompleteRecovery(`${component.component} has no complete invoice allocation to read payments from; the recovery lookup is incomplete.`)
  }
  const seen = new Set(known.map((p) => p.paymentId))
  const out = []
  for (const a of allocations) {
    const rows = await ctx.sources.listZohoInvoicePayments(a.invoiceId, PREVIEW)
    for (const p of rows.filter((x) => clean(x.referenceNumber) === component.reference && !seen.has(x.paymentId))) {
      seen.add(p.paymentId)
      out.push({ paymentId: p.paymentId, amount: p.amount, date: p.date, accountId: null, accountName: null, foundOnInvoice: a.invoiceId })
    }
  }
  return out
}

/**
 * Zoho date sent by a local component's own POST attempt; '' when it never sent one. Attempts
 * from before request snapshots were all dated on the payout arrival day.
 */
function recordedDate(local, arrivalDate) {
  if (!local) return ''
  if (local.requestSnapshot) return model.proposedDate(local.requestSnapshot)
  return local.attemptCount > 0 ? clean(arrivalDate) : ''
}

/** Recorded-attempt dates an existing record is matched against (see `model.acceptedDates`). */
function recordedDates(local, arrivalDate) {
  return { matchDate: recordedDate(local, arrivalDate), postedDay: (local && dubaiDateOf(local.postedAt)) || '' }
}

/** Days a record of this component can carry: the proposed posting date and any recorded attempt date. */
function componentDates(component) {
  return [...new Set([model.proposedDate(component), ...model.acceptedDates(component)].filter(Boolean))].sort()
}

/**
 * Journals under this exact reference. Recovery (`ctx.deep`) also lists the journals of every
 * day the component can carry, so a journal the reference search does not show (yet) is still found.
 */
async function journalsByReference(reference, dates, ctx) {
  const found = await ctx.sources.findZohoJournalsByReference(reference, PREVIEW)
  if (!ctx.deep) return found
  if (!dates || dates.length === 0 || typeof ctx.sources.listZohoJournalsInRange !== 'function') {
    throw incompleteRecovery(`The journal date listing for "${reference}" is unavailable; the recovery lookup is incomplete.`)
  }
  const byId = new Map(found.map((j) => [j.journalId, j]))
  for (const j of await ctx.sources.listZohoJournalsInRange(dates[0], dates[dates.length - 1], PREVIEW)) {
    if (clean(j.referenceNumber) === reference && !byId.has(j.journalId)) byId.set(j.journalId, j)
  }
  return [...byId.values()]
}

/** Journals with this reference, each with the customer tagged on its 1123 line. */
async function taggedJournals(reference, ctx, dates) {
  return cached(ctx.cache, `jr:${reference}`, async () => {
    const found = await journalsByReference(reference, dates, ctx)
    const out = []
    for (const j of found) {
      const detail = await ctx.sources.getZohoJournal(j.journalId, { source: 'stripe_payout_preview' })
      out.push({ journalId: j.journalId, detail, customerId: detail ? model.journalCustomer(detail, ctx.config.advanceAccountId) : '' })
    }
    return out
  })
}

/** Advance journals for this payout reference, grouped by the customer tagged on the 1123 line. */
function advanceJournals(payoutId, ctx) {
  return taggedJournals(model.advanceReference(payoutId), ctx)
}

async function zohoJournalState(component, customerId, ctx, payoutId) {
  const journals = component.reference ? await taggedJournals(component.reference, ctx, componentDates(component)) : await advanceJournals(payoutId, ctx)
  const untagged = journals.filter((j) => !j.customerId)
  const mine = journals.filter((j) => j.customerId === customerId)
  const records = mine.map((j) => ({ recordId: j.journalId, date: j.detail ? j.detail.journalDate : null }))
  if (untagged.length > 0) {
    return { state: ZOHO_STATE.CONFLICT, recordId: null, records, differences: [], reason: `Zoho journal ${untagged.map((j) => j.journalId).join(', ')} has this reference but no customer tag on Customer Advance Funds.` }
  }
  if (mine.length === 0) return { state: ZOHO_STATE.MISSING, recordId: null, records, differences: [] }
  if (mine.length > 1) return { state: ZOHO_STATE.CONFLICT, recordId: null, records, differences: [], reason: `${mine.length} Zoho journals have this reference for this customer.` }
  const differences = model.compareAdvanceJournal(mine[0].detail, component, customerId)
  if (differences.length > 0) {
    return { state: ZOHO_STATE.CONFLICT, recordId: mine[0].journalId, records, differences, reason: `Zoho journal ${mine[0].journalId} differs: ${differences.join(' ')}` }
  }
  return { state: ZOHO_STATE.VERIFIED, recordId: mine[0].journalId, records, differences: [] }
}

/** The payout fee journal under its deterministic reference; any other shape is a conflict. */
async function feeJournalZohoState(component, ctx) {
  const found = await journalsByReference(component.reference, componentDates(component), ctx)
  const records = found.map((j) => ({ recordId: j.journalId }))
  if (found.length === 0) return { state: ZOHO_STATE.MISSING, recordId: null, records, differences: [] }
  if (found.length > 1) return { state: ZOHO_STATE.CONFLICT, recordId: null, records, differences: [], reason: `${found.length} Zoho journals have the reference "${component.reference}".` }
  const detail = await ctx.sources.getZohoJournal(found[0].journalId, { source: 'stripe_payout_preview' })
  const differences = model.compareFeeJournal(detail, component, model.payoutFeeJournalLabels(component.direction))
  if (differences.length > 0) {
    return { state: ZOHO_STATE.CONFLICT, recordId: found[0].journalId, records, differences, reason: `Zoho journal ${found[0].journalId} differs: ${differences.join(' ')}` }
  }
  return { state: ZOHO_STATE.VERIFIED, recordId: found[0].journalId, records, differences: [] }
}

/**
 * The credit note refund under this Stripe refund's reference. Every credit note of the order
 * is searched, so the reference on any other credit note is a conflict, never a second post.
 */
async function creditNoteRefundZohoState(component, ctx) {
  const ids = [component.creditNoteId, ...(component.candidateCreditNoteIds || []).filter((id) => id !== component.creditNoteId)]
  const hits = []
  for (const id of ids) {
    const rows = await cached(ctx.cache, `cnr:${id}`, () => ctx.sources.listZohoCreditNoteRefunds(id, PREVIEW))
    for (const r of rows.filter((x) => clean(x.referenceNumber) === component.reference)) hits.push({ creditNoteId: id, row: r })
  }
  const records = hits.map((h) => ({ recordId: h.row.creditNoteRefundId, creditNoteId: h.creditNoteId, amount: h.row.amount, date: h.row.date }))
  if (hits.length === 0) return { state: ZOHO_STATE.MISSING, recordId: null, records, differences: [] }
  if (hits.length > 1) return { state: ZOHO_STATE.CONFLICT, recordId: null, records, differences: [], reason: `${hits.length} Zoho credit note refunds have the reference "${component.reference}".` }
  const [hit] = hits
  const detail = await cached(ctx.cache, `cnrd:${hit.creditNoteId}:${hit.row.creditNoteRefundId}`, () => ctx.sources.getZohoCreditNoteRefund(hit.creditNoteId, hit.row.creditNoteRefundId, PREVIEW))
  const differences = model.compareCreditNoteRefund(detail && { ...detail, creditNoteId: detail.creditNoteId || hit.creditNoteId }, component)
  if (differences.length > 0) {
    return { state: ZOHO_STATE.CONFLICT, recordId: hit.row.creditNoteRefundId, records, differences, reason: `Zoho credit note refund ${hit.row.creditNoteRefundId} differs: ${differences.join(' ')}` }
  }
  return { state: ZOHO_STATE.VERIFIED, recordId: hit.row.creditNoteRefundId, records, differences: [] }
}

/** The refund fee journal under its deterministic reference; any other shape is a conflict. */
async function refundFeeJournalZohoState(component, ctx) {
  const found = await journalsByReference(component.reference, componentDates(component), ctx)
  const records = found.map((j) => ({ recordId: j.journalId }))
  if (found.length === 0) return { state: ZOHO_STATE.MISSING, recordId: null, records, differences: [] }
  if (found.length > 1) return { state: ZOHO_STATE.CONFLICT, recordId: null, records, differences: [], reason: `${found.length} Zoho journals have the reference "${component.reference}".` }
  const detail = await ctx.sources.getZohoJournal(found[0].journalId, PREVIEW)
  const differences = model.compareRefundFeeJournal(detail, component)
  if (differences.length > 0) {
    return { state: ZOHO_STATE.CONFLICT, recordId: found[0].journalId, records, differences, reason: `Zoho journal ${found[0].journalId} differs: ${differences.join(' ')}` }
  }
  return { state: ZOHO_STATE.VERIFIED, recordId: found[0].journalId, records, differences: [] }
}

/**
 * Fresh Zoho state of one proposed component (no preview cache); used right before posting.
 * `opts.deep` (recovery after an uncertain write) adds the direct evidence: invoice payments for
 * customer payments and the day's journal listing for journals. Credit note refunds are always
 * read from the credit notes themselves.
 */
async function componentZohoState(component, customerId, payoutId, overrides = {}, opts = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const ctx = { sources: deps.sources, zohoPayments: deps.zohoPayments, config: deps.config, cache: new Map(), deep: opts.deep === true }
  if (component.component === COMPONENT.PAYOUT_FEE_JOURNAL) return feeJournalZohoState(component, ctx)
  if (component.component === COMPONENT.REFUND_CREDIT_NOTE_REFUND) return creditNoteRefundZohoState(component, ctx)
  if (component.component === COMPONENT.REFUND_FEE_ADJUSTMENT) return refundFeeJournalZohoState(component, ctx)
  return component.zohoRecordType === 'journal' ? zohoJournalState(component, customerId, ctx, payoutId) : zohoPaymentState(component, customerId, ctx)
}

function shiftDate(ymd, days) {
  const d = new Date(`${ymd}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Manual fee journals from before this workflow (e.g. "Website&Burjuman stripe transaction
 * fee - 50 Invoices") that provably carry this payout's fees. Only published journals that
 * mention Stripe, dated around the payout, and not written by this workflow are inspected.
 */
async function findLegacyFeeJournal(payout, arrivalDate, expected, ctx) {
  const { LEGACY_STATE } = model
  const start = shiftDate(dubaiDateOf(payout.createdAt) || arrivalDate, -ctx.config.legacyFeeJournalDaysBefore)
  const end = shiftDate(arrivalDate, ctx.config.legacyFeeJournalDaysAfter)
  const window = { start, end }
  if (typeof ctx.sources.listZohoJournalsInRange !== 'function') {
    return { state: LEGACY_STATE.ERROR, window, journals: [], candidatesChecked: 0, reason: 'Legacy fee journals cannot be listed; confirm manually.' }
  }
  try {
    const rows = await ctx.sources.listZohoJournalsInRange(start, end, { source: 'stripe_payout_preview' })
    const candidates = rows.filter((j) => !model.isAutomatedReference(j.referenceNumber)
      && /stripe/i.test(`${j.referenceNumber || ''} ${j.notes || ''}`)
      && (j.status || 'published') === 'published'
      && toMinor(j.total) >= expected.totalMinor)
    const journals = []
    for (const j of candidates) {
      const detail = await ctx.sources.getZohoJournal(j.journalId, { source: 'stripe_payout_preview' })
      const match = model.matchLegacyFeeJournal(detail, expected)
      if (match.matched) {
        journals.push({ journalId: j.journalId, entryNumber: j.entryNumber || null, journalDate: j.journalDate, referenceNumber: j.referenceNumber, total: j.total, how: match.how, matchedLines: match.lines })
      }
    }
    if (journals.length === 0) {
      return { state: LEGACY_STATE.NONE, window, journals, candidatesChecked: candidates.length, reason: `No legacy Stripe fee journal dated ${start}..${end} carries these fees.` }
    }
    if (journals.length > 1) {
      return { state: LEGACY_STATE.AMBIGUOUS, window, journals, candidatesChecked: candidates.length, reason: `${journals.length} legacy journals (${journals.map((j) => `#${j.entryNumber || j.journalId}`).join(', ')}) could each carry these fees; confirm manually.` }
    }
    const [j] = journals
    const how = j.how === 'TOTAL_LINE' ? `one Stripe Fees line of ${j.matchedLines[0].toFixed(2)}` : `Stripe Fees lines ${j.matchedLines.map((x) => x.toFixed(2)).join(' + ')} (one per customer FEE payment)`
    return {
      state: LEGACY_STATE.MATCHED,
      window,
      journals,
      candidatesChecked: candidates.length,
      reason: `Legacy journal #${j.entryNumber || j.journalId} ("${j.referenceNumber}", ${j.journalDate}) carries ${how} against Stripe Processing Chg Un-Cleared; no new fee journal is needed.`,
    }
  } catch (err) {
    return { state: LEGACY_STATE.ERROR, window, journals: [], candidatesChecked: 0, reason: `Legacy fee journals could not be checked: ${err.message}` }
  }
}

/** Hash of what the admin approves for the fee journal, including each group's verified FEE payment. */
function feeJournalFingerprint(payout, component, feeComponents, refundAdjustments) {
  const plan = {
    kind: COMPONENT.PAYOUT_FEE_JOURNAL,
    payoutId: payout.payoutId,
    payoutAmountMinor: payout.amountMinor,
    arrivalDate: payout.arrivalDate,
    zohoPostingDate: component.date,
    amountMinor: toMinor(component.amount),
    signedFeeMinor: component.signedFeeMinor,
    direction: component.direction,
    reference: component.reference,
    debitAccountId: component.debitAccountId,
    creditAccountId: component.creditAccountId,
    fees: feeComponents.map((f) => [f.customerId, toMinor(f.amount), f.zohoState, f.zohoRecordId]),
  }
  if (refundAdjustments.length > 0) plan.refundFees = refundAdjustments.map((a) => [a.refundId, a.feeMinor, a.zohoState, a.zohoRecordId])
  return crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}

/**
 * The payout-level fee journal clears the signed 1013 balance left by the FEE payments and
 * refund fee adjustments: Dr Stripe Fees / Cr 1013 when Stripe's fees on the payout's balance
 * transactions sum positive, Dr 1013 / Cr Stripe Fees for the absolute amount when they sum
 * negative, none when they sum to zero. Never tagged to a customer and never split by customer.
 */
async function buildFeeJournal({ payout, txns, groups, payoutBlockers, accounts, config, date, arrivalDate, local, ctx, normalRefunds = [] }) {
  const stripeFeeMinor = txns.filter((t) => t.type !== 'payout').reduce((s, t) => s + (Number(t.feeMinor) || 0), 0)
  // A refund's fee reaches 1013 only through its own adjustment journal; zero-fee refunds need none.
  const refundAdjustments = normalRefunds.filter((r) => r.feeMinor !== 0).map((r) => {
    const c = r.components.find((x) => x.component === COMPONENT.REFUND_FEE_ADJUSTMENT)
    return {
      refundId: r.refundId,
      feeMinor: r.feeMinor,
      fee: toMajor(r.feeMinor),
      zohoState: c ? c.zoho.state : ZOHO_STATE.MISSING,
      zohoRecordId: c ? c.zoho.recordId : null,
    }
  })
  const feeComponents = groups.map((g) => {
    const c = g.components.find((x) => x.component === COMPONENT.FEE)
    return {
      customerId: g.customerId,
      customerName: g.customerName,
      amount: c ? c.amount : 0,
      zohoState: c ? c.zoho.state : ZOHO_STATE.MISSING,
      zohoRecordId: c ? c.zoho.recordId : null,
    }
  })
  const verifiedFeeMinor = feeComponents.filter((f) => f.zohoState === ZOHO_STATE.VERIFIED).reduce((s, f) => s + toMinor(f.amount), 0)
    + refundAdjustments.filter((a) => a.zohoState === ZOHO_STATE.VERIFIED).reduce((s, a) => s + a.feeMinor, 0)

  const accountProblems = []
  if (accounts.problems.feeExpense) accountProblems.push(accounts.problems.feeExpense)
  if (!accounts.fee) accountProblems.push('Stripe Processing Chg Un-Cleared (1013) is not resolved.')
  else if (clean(accounts.fee.accountId) !== config.feeAccountId) accountProblems.push(`Stripe Processing Chg Un-Cleared has ID ${accounts.fee.accountId}, expected ${config.feeAccountId}.`)

  const side = model.payoutFeeJournalAccounts(stripeFeeMinor, config.feeExpenseAccountId, config.feeAccountId)
  const reversal = Boolean(side && side.direction === model.FEE_JOURNAL_DIRECTION.FEE_REVERSAL)
  const component = {
    component: COMPONENT.PAYOUT_FEE_JOURNAL,
    zohoRecordType: 'journal',
    amount: toMajor(Math.abs(stripeFeeMinor)),
    signedFeeMinor: stripeFeeMinor,
    signedAmount: toMajor(stripeFeeMinor),
    direction: side ? side.direction : null,
    currency: payout.currency,
    reference: model.payoutFeeReference(payout.payoutId),
    date,
    ...recordedDates(local, arrivalDate),
    debitAccountId: side ? side.debitAccountId : null,
    creditAccountId: side ? side.creditAccountId : null,
    depositAccountId: null,
    allocations: [],
    advanceCaseIds: [],
  }
  component.payload = side ? model.payoutFeeJournalPayload(component, date) : null
  // Searched whenever fees moved at all: a journal under this reference on a zero-fee payout is a conflict.
  const feeActivity = stripeFeeMinor !== 0 || refundAdjustments.length > 0 || feeComponents.some((f) => toMinor(f.amount) !== 0)
  const zoho = feeActivity || local
    ? await feeJournalZohoState(component, ctx)
    : { state: ZOHO_STATE.MISSING, recordId: null, records: [], differences: [] }

  const input = {
    payoutBlockers, groups, stripeFeeMinor, verifiedFeeMinor, accountProblems, zoho, local,
    refundAdjustments, normalRefundCount: normalRefunds.length,
  }
  let derived = model.deriveFeeJournalStatus(input)
  let legacy = null
  if (derived.needsLegacyCheck) {
    legacy = await findLegacyFeeJournal(payout, arrivalDate, {
      feeExpenseAccountId: config.feeExpenseAccountId,
      clearingAccountId: config.feeAccountId,
      totalMinor: Math.abs(stripeFeeMinor),
      direction: component.direction,
      feeMinors: reversal ? [] : feeComponents.map((f) => toMinor(f.amount)).filter((m) => m > 0),
    }, ctx)
    derived = model.deriveFeeJournalStatus({ ...input, legacy })
  }
  const S = model.FEE_JOURNAL_STATUS
  const tracked = Boolean(local && local.status === 'VERIFIED')
  return {
    ...component,
    status: derived.status,
    reasons: derived.reasons,
    stripeFeeTotal: toMajor(stripeFeeMinor),
    verifiedFeeTotal: toMajor(verifiedFeeMinor),
    feeComponents,
    refundFeeAdjustments: refundAdjustments.map(({ feeMinor, ...a }) => a),
    debitAccount: !side ? null : reversal ? accounts.fee : accounts.feeExpense,
    creditAccount: !side ? null : reversal ? accounts.feeExpense : accounts.fee,
    accountProblems,
    zoho,
    legacy,
    local: publicLocal(local),
    tracked,
    recovery: derived.recovery,
    postable: payoutBlockers.length === 0 && (derived.status === S.READY || (derived.status === S.VERIFIED && !tracked)),
    postingFingerprint: feeJournalFingerprint(payout, component, feeComponents, refundAdjustments),
  }
}

/**
 * Hash of everything the admin approves when posting a group: payout, customer, Zoho posting
 * date and each component's amount, reference, accounts, allocations and advance cases. Zoho
 * and local status are excluded so a partly posted group keeps the same fingerprint within a
 * Dubai day; a preview approved before Dubai midnight no longer matches after it.
 */
function postingFingerprint(payout, customerId, date, components) {
  const plan = {
    payoutId: payout.payoutId,
    payoutAmountMinor: payout.amountMinor,
    arrivalDate: payout.arrivalDate,
    zohoPostingDate: date,
    customerId,
    components: components.map((c) => ({
      component: c.component,
      amountMinor: toMinor(c.amount),
      reference: c.reference,
      depositAccountId: c.depositAccountId || null,
      debitAccountId: c.debitAccountId || null,
      creditAccountId: c.creditAccountId || null,
      allocations: c.allocations.map((a) => [a.invoiceId, toMinor(a.amount)]),
      advanceCaseIds: [...c.advanceCaseIds].map(String).sort(),
    })),
  }
  return crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}

function publicLocal(row) {
  if (!row) return null
  return {
    id: row.id,
    status: row.status,
    zohoRecordId: row.zohoRecordId,
    zohoJournalId: row.zohoJournalId,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    postedAt: row.postedAt,
    verifiedAt: row.verifiedAt,
    firstUncertainAt: row.firstUncertainAt || null,
    uncertainSince: row.uncertainSince || null,
    lastRecoveryCheckAt: row.lastRecoveryCheckAt || null,
    recoveryCheckCount: row.recoveryCheckCount || 0,
    retryAuthorizedAt: row.retryAuthorizedAt || null,
    retryAuthorizedBy: row.retryAuthorizedBy || null,
    retryAuthorizationReason: row.retryAuthorizationReason || null,
    createdBy: row.createdBy || null,
    updatedBy: row.updatedBy || null,
  }
}

async function buildGroup(customerId, lines, ctx) {
  const { payout, accounts, config, date, localByKey, payoutId } = ctx
  const allocatable = lines.filter((l) => l.invoice && l.state !== LINE_STATE.NEEDS_REVIEW)
  const blockers = []
  const review = lines.filter((l) => l.state === LINE_STATE.NEEDS_REVIEW)
  if (review.length > 0) blockers.push(`${review.length} charge(s) need review.`)
  const pendingAdvance = allocatable.filter((l) => l.advance && !l.advance.confirmed)
  for (const l of pendingAdvance) {
    const refund = l.advance.refund
    blockers.push(`Customer overpayment of ${l.advance.overpaymentAmount} on ${l.invoice.invoiceNumber} needs admin confirmation (Confirm Customer Advance).${refund ? ` Matching Stripe refund ${refund.refundId} (${refund.amount}) already exists; it clears the advance in its own later payout.` : ''}`)
  }
  if (accounts.problems.base.length > 0) blockers.push(...accounts.problems.base)
  const hasAdvance = allocatable.some((l) => l.advanceMinor > 0)
  if (hasAdvance && accounts.problems.advance) blockers.push(accounts.problems.advance)
  if (payout.status !== 'paid') blockers.push(`Payout status is ${payout.status}.`)

  const proposed = proposeComponents(customerId, allocatable, payout, accounts, config, date)
  const components = []
  for (const proposal of proposed) {
    const local = localByKey.get(`${customerId}|${proposal.component}`) || null
    const c = { ...proposal, ...recordedDates(local, ctx.arrivalDate) }
    const zoho = c.zohoRecordType === 'journal' ? await zohoJournalState(c, customerId, ctx, payoutId) : await zohoPaymentState(c, customerId, ctx)
    components.push({ ...c, zoho, local: publicLocal(local), localStatus: local ? local.status : null, recovery: model.planRecovery(zoho, local) })
  }

  // Records the preview does not propose must not exist.
  const proposedKinds = new Set(proposed.map((c) => c.component))
  for (const [key, row] of localByKey) {
    const [cust, kind] = key.split('|')
    if (cust === customerId && !proposedKinds.has(kind) && kind !== COMPONENT.CUSTOMER_ADVANCE_REFUND) {
      blockers.push(`A local ${kind} component (${row.status}) exists that this payout no longer proposes.`)
    }
  }
  if (!proposedKinds.has(COMPONENT.CUSTOMER_ADVANCE)) {
    const journals = await advanceJournals(payoutId, ctx)
    const unexpected = journals.filter((j) => j.customerId === customerId || !j.customerId)
    if (unexpected.length > 0) blockers.push(`Zoho has customer advance journal(s) ${unexpected.map((j) => j.journalId).join(', ')} for this payout, but none is proposed.`)
  }

  // Each invoice balance must equal its total minus what verified payout components applied.
  const verifiedApplied = new Map()
  for (const c of components) {
    if (c.zoho.state !== ZOHO_STATE.VERIFIED) continue
    for (const a of c.allocations) verifiedApplied.set(a.invoiceId, (verifiedApplied.get(a.invoiceId) || 0) + toMinor(a.amount))
  }
  for (const l of allocatable) {
    const expected = l.invoiceTotalMinor - (verifiedApplied.get(l.invoice.invoiceId) || 0)
    if (toMinor(l.invoice.balance) !== expected) {
      blockers.push(`Zoho ${l.invoice.invoiceNumber} balance is ${l.invoice.balance}; expected ${toMajor(expected)} after verified payout components.`)
    }
  }

  const { status, reasons } = model.deriveGroupStatus({ blockers, components, hasAdvance })
  const sum = (key) => allocatable.reduce((s, l) => s + l[key], 0)
  const invoiceGrossMinor = sum('invoiceTotalMinor')
  const netMinor = sum('netAllocMinor')
  const feeMinor = sum('feeAllocMinor')
  const advanceMinor = sum('advanceMinor')
  const grossMinor = sum('grossMinor')
  return {
    groupKey: `${payoutId}|${customerId}`,
    customerId,
    customerName: customerName(customerId, config),
    status,
    reasons,
    advanceReviewRequired: pendingAdvance.length > 0,
    invoiceCount: allocatable.length,
    chargeCount: lines.length,
    totals: {
      invoiceGross: toMajor(invoiceGrossMinor),
      netTo1019: toMajor(netMinor),
      customerAdvance: toMajor(advanceMinor),
      total1019: toMajor(netMinor + advanceMinor),
      feeTo1013: toMajor(feeMinor),
      stripeGross: toMajor(grossMinor),
    },
    checks: {
      total1019PlusFeeEqualsGross: netMinor + advanceMinor + feeMinor === grossMinor,
      netPlusFeeEqualsInvoices: netMinor + feeMinor === invoiceGrossMinor,
      everyLineBalances: allocatable.every((l) => l.netAllocMinor + l.feeAllocMinor === l.invoiceTotalMinor && l.netAllocMinor + l.advanceMinor === l.netMinor),
    },
    components: components.map(({ localStatus, ...c }) => c),
    postingFingerprint: postingFingerprint(payout, customerId, date, proposed),
    lines: lines.map(publicLine),
  }
}

function refundMismatch(t, stored) {
  if (!REFUNDABLE_CASE.has(stored.status)) return `Customer advance case ${stored.id} is ${stored.status}.`
  if (stored.payoutId === t.payoutId) return `Refund is in the same payout as customer advance case ${stored.id}; it must belong to a later payout.`
  if (stored.refundId && stored.refundId !== t.sourceId) return `Customer advance case ${stored.id} records refund ${stored.refundId}, not ${t.sourceId}.`
  if (stored.refundBalanceTransactionId && stored.refundBalanceTransactionId !== t.balanceTransactionId) {
    return `Customer advance case ${stored.id} records refund balance transaction ${stored.refundBalanceTransactionId}, not ${t.balanceTransactionId}.`
  }
  if (t.refundStatus !== 'succeeded') return `Stripe refund ${t.sourceId} status is ${t.refundStatus || 'unknown'}.`
  if (t.feeMinor !== 0) return `Refund balance transaction has a fee of ${toMajor(t.feeMinor)}.`
  if (-t.netMinor !== toMinor(stored.overpaymentAmount) || t.currency !== stored.currency) {
    return `Refund ${toMajor(-t.netMinor)} ${t.currency} does not equal the customer advance ${stored.overpaymentAmount} ${stored.currency}.`
  }
  return null
}

/** Customer advance refunds in this payout, linked charge → case. Preview only; never posted here. */
async function linkRefunds(refundTxns, casesByCharge, ctx) {
  const { payoutId, accounts, config, date } = ctx
  const out = []
  for (const t of refundTxns) {
    const stored = t.chargeId ? casesByCharge.get(t.chargeId) : null
    const refundMinor = -t.netMinor
    const base = {
      balanceTransactionId: t.balanceTransactionId,
      refundId: t.sourceId,
      chargeId: t.chargeId,
      paymentIntentId: t.paymentIntentId,
      amount: toMajor(refundMinor),
      caseId: stored ? stored.id : null,
      caseStatus: stored ? stored.status : null,
      originalPayoutId: stored ? stored.payoutId : null,
      customerId: stored ? stored.zohoCustomerId : null,
      overpaymentAmount: stored ? stored.overpaymentAmount : null,
      originalAdvanceJournal: null,
      posting: { allowed: false, blockers: ['Refund is not linked to a confirmed customer advance.'] },
    }
    const problem = refundMismatch({ ...t, payoutId }, stored)
    if (problem) {
      out.push({ ...base, status: REFUND_STATUS.REFUND_MISMATCH, matched: false, reason: problem, proposedJournal: null })
      continue
    }
    const component = {
      component: COMPONENT.CUSTOMER_ADVANCE_REFUND,
      amount: toMajor(refundMinor),
      reference: model.advanceRefundReference(payoutId),
      debitAccountId: config.advanceAccountId,
      creditAccountId: accounts.net ? accounts.net.accountId : null,
      date,
      matchDate: '',
    }
    const originalAdvance = {
      component: COMPONENT.CUSTOMER_ADVANCE,
      amount: stored.overpaymentAmount,
      reference: model.advanceReference(stored.payoutId),
      debitAccountId: accounts.net ? accounts.net.accountId : null,
      creditAccountId: config.advanceAccountId,
    }
    const journal = await zohoJournalState(originalAdvance, stored.zohoCustomerId, ctx, stored.payoutId)
    const refundJournal = await zohoJournalState(component, stored.zohoCustomerId, ctx, payoutId)
    const posting = model.refundPostingGate({
      caseStatus: stored.status,
      originalAdvanceJournalState: journal.state,
      refundStatus: REFUND_STATUS.REFUND_MATCHED,
      refundMinor,
      overpaymentMinor: toMinor(stored.overpaymentAmount),
      postingEnabled: config.postingEnabled === true,
    })
    out.push({
      ...base,
      status: REFUND_STATUS.REFUND_MATCHED,
      matched: true,
      reason: `Refund equals customer advance case ${stored.id} from ${stored.payoutId}; Dr Customer Advance Funds / Cr Stripe Undeposited Funds.`,
      originalAdvanceJournal: { reference: originalAdvance.reference, state: journal.state, recordId: journal.recordId, reason: journal.reason || null },
      refundJournal: { reference: component.reference, state: refundJournal.state, recordId: refundJournal.recordId, reason: refundJournal.reason || null },
      posting,
      proposedJournal: { ...component, payload: model.advanceJournalPayload(component, stored.zohoCustomerId, date) },
    })
  }
  return out
}

function publicCreditNote(c, how) {
  return {
    creditNoteId: c.creditNoteId,
    creditNoteNumber: c.creditNoteNumber,
    status: c.status,
    date: c.date,
    total: c.total,
    balance: c.balance,
    invoiceId: c.invoiceId,
    invoiceNumber: c.invoiceNumber,
    salesReturnNumber: c.salesReturnNumber || null,
    customerId: c.customerId,
    refunds: (c.refunds || []).map((r) => ({
      creditNoteRefundId: r.creditNoteRefundId,
      date: r.date,
      referenceNumber: r.referenceNumber,
      amount: r.amount,
      fromAccountId: r.fromAccountId || null,
      fromAccountName: r.fromAccountName || null,
    })),
    matchedBy: how || null,
  }
}

/**
 * Hash of what the admin approves when posting one normal refund: the Stripe refund, the
 * sale it reverses, the credit note and each component. Zoho/local status are excluded.
 */
function refundFingerprint(payout, r, components) {
  const plan = {
    kind: 'NORMAL_REFUND',
    payoutId: payout.payoutId,
    payoutAmountMinor: payout.amountMinor,
    refundId: r.refundId,
    balanceTransactionId: r.balanceTransactionId,
    chargeId: r.chargeId,
    paymentIntentId: r.paymentIntentId,
    customerId: r.customerId,
    invoiceId: r.invoice ? r.invoice.invoiceId : null,
    creditNoteId: r.creditNote ? r.creditNote.creditNoteId : null,
    grossMinor: r.grossMinor,
    feeMinor: r.feeMinor,
    components: components.map((c) => ({
      component: c.component,
      amountMinor: toMinor(c.amount),
      reference: c.reference,
      date: c.date,
      creditNoteId: c.creditNoteId || null,
      depositAccountId: c.depositAccountId || null,
      debitAccountId: c.debitAccountId || null,
      creditAccountId: c.creditAccountId || null,
    })),
  }
  return crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}

/**
 * One normal invoice refund in this payout: Stripe refund → charge → PaymentIntent → website
 * order → Zoho invoice → existing credit note. Amounts are the refund balance transaction's own
 * (gross, Stripe fee, net). Anything not provable stops at NEEDS_REVIEW / MISMATCH with a code.
 */
/**
 * A refund whose Zoho write is uncertain shows POSTING_UNCERTAIN whatever the rest of the plan
 * says: once the record exists, the credit note balance or invoice may no longer look refundable.
 */
async function buildNormalRefund(t, ctx) {
  const r = await planNormalRefund(t, ctx)
  const uncertain = ctx.localRefunds.filter((row) => row.refundId === t.sourceId && UNCERTAIN_LOCAL.has(row.status))
  if (uncertain.length === 0 || r.status === NORMAL_REFUND_STATUS.POSTING_UNCERTAIN) return r
  const reasons = uncertain.map((row) => `${row.component}: ${model.UNCERTAIN_REASON}`)
  return { ...r, status: NORMAL_REFUND_STATUS.POSTING_UNCERTAIN, reasonCode: 'ZOHO_RESPONSE_UNCERTAIN', reason: reasons[0], reasons: [...reasons, ...r.reasons.filter((x) => !reasons.includes(x))] }
}

async function planNormalRefund(t, ctx) {
  const { config, sources, accounts, date, payout, ordersByIntent, localRefunds } = ctx
  const R = NORMAL_REFUND_STATUS
  const grossMinor = -t.amountMinor
  const reference = model.normalRefundReference(t.sourceId)
  const out = {
    refundId: t.sourceId,
    balanceTransactionId: t.balanceTransactionId,
    chargeId: t.chargeId,
    paymentIntentId: t.paymentIntentId,
    currency: t.currency,
    stripeRefundStatus: t.refundStatus || null,
    grossMinor,
    feeMinor: t.feeMinor,
    netMinor: t.netMinor,
    gross: toMajor(grossMinor),
    stripeFee: toMajor(t.feeMinor),
    // Positive: Stripe returned part of its fee; negative: Stripe charged an extra fee.
    feeAdjustment: toMajor(-t.feeMinor),
    net: toMajor(t.netMinor),
    reference,
    kind: null,
    sequence: null,
    refundCount: null,
    chargeGross: null,
    priorRefunded: null,
    cumulativeRefunded: null,
    remainingRefundable: null,
    priorRefunds: [],
    laterRefunds: [],
    website: null,
    invoice: null,
    customerId: null,
    customerName: null,
    creditNote: null,
    creditNoteCandidates: [],
    returnedItems: [],
    itemsProven: false,
    itemsReason: null,
    legacyRefund: null,
    // What this refund does to the clearing accounts once posted (1019 by its net, 1013 by its fee).
    clearingImpact: { stripeUndepositedFunds: toMajor(t.netMinor), processingChargesUncleared: toMajor(t.feeMinor) },
    components: [],
    localRecords: [],
    status: R.DETECTED,
    reasonCode: null,
    reason: '',
    reasons: [],
    tracked: false,
    postable: false,
    postingFingerprint: null,
  }
  const stop = (code, reason, status = R.NEEDS_REVIEW) => ({ ...out, status, reasonCode: code, reason, reasons: [reason], components: [] })
  const local = localRefunds.filter((c) => c.refundId === out.refundId)
  out.localRecords = local.map((row) => ({ component: row.component, ...publicLocal(row), payoutId: row.payoutId }))
  if (local.some((row) => row.payoutId !== payout.payoutId)) {
    return stop('LOCAL_RECORD_OTHER_PAYOUT', `Refund ${out.refundId} is recorded locally under payout ${local.find((row) => row.payoutId !== payout.payoutId).payoutId}.`)
  }

  if (!out.refundId || !t.chargeId) return stop('REFUND_NOT_LINKED', 'The refund balance transaction has no Stripe refund or charge.')
  if (t.currency !== config.websiteCurrency || t.exchangeRate != null) return stop('REFUND_CURRENCY', `Refund balance transaction is ${t.currency}${t.exchangeRate != null ? ' with conversion' : ''}.`)
  if (grossMinor <= 0) return stop('REFUND_NOT_NEGATIVE', `Refund balance transaction amount is ${toMajor(t.amountMinor)}.`)
  if (t.netMinor !== t.amountMinor - t.feeMinor) return stop('REFUND_NET_MISMATCH', 'Stripe refund amount minus fee does not equal its net.')
  if (t.refundStatus !== 'succeeded') return stop('REFUND_NOT_SUCCEEDED', `Stripe refund status is ${t.refundStatus || 'unknown'}.`)
  if (!t.paymentIntentId) return stop('NO_PAYMENT_INTENT', 'Stripe refund has no PaymentIntent.')

  let chargeRefunds
  let intent
  try {
    chargeRefunds = await cached(ctx.stripeCache, `refunds:${t.chargeId}`, () => sources.listChargeRefunds(t.chargeId))
    intent = await cached(ctx.stripeCache, `pi:${t.paymentIntentId}`, () => sources.retrieveStripePaymentIntent(t.paymentIntentId))
  } catch (err) {
    return stop('STRIPE_LOOKUP_FAILED', `Stripe could not be read: ${err.message}`)
  }
  if (!intent) return stop('PAYMENT_INTENT_MISSING', `Stripe has no PaymentIntent ${t.paymentIntentId}.`)
  if (intent.chargeId !== t.chargeId) return stop('CHARGE_MISMATCH', `PaymentIntent ${t.paymentIntentId} was paid by charge ${intent.chargeId || '(none)'}, not ${t.chargeId}.`)
  if (intent.status !== 'succeeded') return stop('PAYMENT_NOT_SUCCEEDED', `PaymentIntent status is ${intent.status}.`)
  if (intent.disputed) return stop('CHARGE_DISPUTED', 'The refunded charge is disputed.')
  if (clean(intent.currency).toUpperCase() !== config.websiteCurrency) return stop('REFUND_CURRENCY', `PaymentIntent is in ${intent.currency}.`)
  const chargeGrossMinor = toMinor(intent.amountReceived)
  out.chargeGross = toMajor(chargeGrossMinor)
  const self = chargeRefunds.find((r) => r.refundId === out.refundId)
  if (!self || !self.balanceTransaction || self.balanceTransaction.balanceTransactionId !== t.balanceTransactionId) {
    return stop('REFUND_NOT_ON_CHARGE', `Stripe does not list refund ${out.refundId} with balance transaction ${t.balanceTransactionId} on charge ${t.chargeId}.`)
  }

  const orders = ordersByIntent.get(t.paymentIntentId) || []
  if (orders.length === 0) return stop('ORDER_MISSING', 'No website order has this PaymentIntent ID.')
  if (orders.length > 1) return stop('ORDER_AMBIGUOUS', `${orders.length} website orders share this PaymentIntent ID.`)
  const [order] = orders
  out.website = { orderId: order.orderId, orderNumber: order.orderNumber, finalAmount: order.finalAmount, shopOrder: order.shopOrder, orderStatus: order.orderStatus, paymentStatus: order.paymentStatus }
  if (order.deleted) return stop('ORDER_DELETED', 'Website order is deleted.')
  if (!clean(order.orderNumber)) return stop('ORDER_NUMBER_MISSING', 'Website order has no order number to look up in Zoho.')
  if (order.sameNumberCount > 0) return stop('ORDER_AMBIGUOUS', `Order number ${order.orderNumber} is used by another website order.`)
  const customerId = expectedZohoCustomerId(order, config)
  out.customerId = customerId
  out.customerName = customerName(customerId, config)
  const orderTotalMinor = toMinor(order.finalAmount)
  if (chargeGrossMinor > orderTotalMinor) {
    return stop('POSSIBLE_CUSTOMER_ADVANCE', `Stripe collected ${toMajor(chargeGrossMinor)} for order total ${toMajor(orderTotalMinor)}; confirm the customer advance on the charge's payout first. This refund is not treated as an invoice refund.`)
  }
  if (chargeGrossMinor < orderTotalMinor) return stop('ORDER_AMOUNT_MISMATCH', `Stripe collected ${toMajor(chargeGrossMinor)}, less than the order total ${toMajor(orderTotalMinor)}.`)

  let invoices
  try {
    invoices = await cached(ctx.cache, `inv:${order.orderNumber}`, () => sources.findZohoInvoicesByReference(order.orderNumber, PREVIEW))
  } catch (err) {
    return stop('ZOHO_LOOKUP_FAILED', `Zoho invoices could not be searched: ${err.message}`)
  }
  const liveInvoices = invoices.filter((inv) => clean(inv.referenceNumber) === clean(order.orderNumber) && inv.status !== 'void')
  if (liveInvoices.length === 0) return stop('INVOICE_MISSING', `No live Zoho invoice has reference ${order.orderNumber}.`)
  if (liveInvoices.length > 1) return stop('INVOICE_AMBIGUOUS', `${liveInvoices.length} Zoho invoices reference order ${order.orderNumber}.`)
  const [invoice] = liveInvoices
  out.invoice = { invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber, total: invoice.total, balance: invoice.balance, status: invoice.status, customerId: invoice.customerId }
  if (invoice.customerId !== customerId) {
    return stop('CUSTOMER_MISMATCH', `Zoho invoice ${invoice.invoiceNumber} is not under the ${out.customerName} customer that owns website order ${order.orderNumber}.`)
  }
  if (clean(invoice.currencyCode).toUpperCase() !== config.websiteCurrency) return stop('INVOICE_CURRENCY', `Zoho invoice currency is ${invoice.currencyCode}.`)
  if (invoice.status === 'draft') return stop('INVOICE_DRAFT', `Zoho invoice ${invoice.invoiceNumber} is still a draft.`)
  const invoiceTotalMinor = toMinor(invoice.total)
  if (invoiceTotalMinor !== chargeGrossMinor) {
    return stop('INVOICE_AMOUNT_MISMATCH', `Zoho invoice ${invoice.invoiceNumber} total ${invoice.total} does not equal the Stripe charge ${toMajor(chargeGrossMinor)}.`)
  }

  const cls = model.classifyNormalRefund({ refundId: out.refundId, refundMinor: grossMinor, invoiceTotalMinor, chargeRefunds })
  Object.assign(out, {
    kind: cls.kind || null,
    sequence: cls.sequence || null,
    refundCount: cls.refundCount || null,
    priorRefunded: cls.priorRefundedMinor == null ? null : toMajor(cls.priorRefundedMinor),
    cumulativeRefunded: cls.cumulativeMinor == null ? null : toMajor(cls.cumulativeMinor),
    remainingRefundable: cls.remainingMinor == null ? null : toMajor(cls.remainingMinor),
    priorRefunds: cls.priorRefunds || [],
    laterRefunds: cls.laterRefunds || [],
  })
  if (cls.problem) return stop(cls.code, cls.problem)
  if (!accounts.net) return stop('ACCOUNT_UNRESOLVED', 'Stripe Undeposited Funds (1019) is not resolved.')

  let candidates
  try {
    const rows = await sources.findZohoCreditNotesForOrder(order.orderNumber, customerId, PREVIEW)
    candidates = []
    for (const row of rows.filter((n) => n.status !== 'void')) {
      const detail = await cached(ctx.cache, `cn:${row.creditNoteId}`, () => sources.getZohoCreditNote(row.creditNoteId, PREVIEW))
      if (!detail) return stop('ZOHO_LOOKUP_FAILED', `Zoho credit note ${row.creditNoteNumber} could not be read.`)
      const listed = await cached(ctx.cache, `cnr:${row.creditNoteId}`, () => sources.listZohoCreditNoteRefunds(row.creditNoteId, PREVIEW))
      const refunds = []
      for (const r of listed) {
        const d = await cached(ctx.cache, `cnrd:${row.creditNoteId}:${r.creditNoteRefundId}`, () => sources.getZohoCreditNoteRefund(row.creditNoteId, r.creditNoteRefundId, PREVIEW))
        refunds.push({ ...r, fromAccountId: d ? d.fromAccountId : null, fromAccountName: d ? d.fromAccountName : null })
      }
      candidates.push({ ...detail, refunds })
    }
  } catch (err) {
    return stop('ZOHO_LOOKUP_FAILED', `Zoho credit notes could not be searched: ${err.message}`)
  }
  out.creditNoteCandidates = candidates.map((c) => publicCreditNote(c))
  const foreign = candidates.filter((c) => c.customerId !== customerId)
  if (foreign.length > 0) return stop('CUSTOMER_MISMATCH', `Credit note ${foreign.map((c) => c.creditNoteNumber).join(', ')} is not under ${out.customerName}.`)
  const otherInvoice = candidates.filter((c) => c.invoiceId !== invoice.invoiceId)
  if (otherInvoice.length > 0) {
    return stop('CREDIT_NOTE_INVOICE_MISMATCH', `Credit note ${otherInvoice.map((c) => `${c.creditNoteNumber} (linked to ${c.invoiceNumber || 'no invoice'})`).join(', ')} is not linked to ${invoice.invoiceNumber}.`)
  }
  const creditedMinor = candidates.filter((c) => c.status !== 'draft').reduce((s, c) => s + toMinor(c.total), 0)
  if (creditedMinor > invoiceTotalMinor) {
    return stop('CREDIT_NOTES_EXCEED_INVOICE', `Credit notes for order ${order.orderNumber} total ${toMajor(creditedMinor)}, more than invoice ${invoice.invoiceNumber} ${invoice.total}.`)
  }

  const siblingRefunds = chargeRefunds.filter((r) => LIVE_REFUND.has(r.status) && r.refundId !== out.refundId).map((r) => ({ refundId: r.refundId, amountMinor: r.amountMinor }))
  const pick = model.selectCreditNote({
    reference,
    grossMinor,
    depositAccountId: accounts.net.accountId,
    siblingRefunds,
    creditNotes: candidates.map((c) => ({
      ...c,
      totalMinor: toMinor(c.total),
      balanceMinor: toMinor(c.balance),
      refunds: c.refunds.map((r) => ({ ...r, amountMinor: toMinor(r.amount) })),
    })),
  })
  if (pick.outcome === 'PROBLEM') return stop(pick.code, pick.reason, pick.status)
  const creditNote = candidates.find((c) => c.creditNoteId === pick.creditNote.creditNoteId)
  out.creditNote = publicCreditNote(creditNote, pick.how)

  let invoiceDetail
  try {
    invoiceDetail = await cached(ctx.cache, `invd:${invoice.invoiceId}`, () => sources.getZohoInvoiceDetail(invoice.invoiceId, PREVIEW))
  } catch (err) {
    return stop('ZOHO_LOOKUP_FAILED', `Zoho invoice ${invoice.invoiceNumber} could not be read: ${err.message}`)
  }
  const items = invoiceDetail ? model.proveReturnedItems(creditNote, invoiceDetail) : { proven: false, reason: `Zoho invoice ${invoice.invoiceNumber} could not be read.`, items: [] }
  out.returnedItems = items.items
  out.itemsProven = items.proven
  out.itemsReason = items.reason

  if (pick.outcome === 'LEGACY') {
    const l = pick.legacyRefund
    out.legacyRefund = { creditNoteRefundId: l.creditNoteRefundId, referenceNumber: l.referenceNumber, amount: l.amount, date: l.date, fromAccountId: l.fromAccountId }
    if (local.length > 0) return stop('LOCAL_RECORD_CONFLICT', `A manual credit note refund covers ${out.refundId}, but local refund components also exist.`)
    if (t.feeMinor !== 0) {
      return stop('LEGACY_FEE_UNPROVEN', `A manual credit note refund covers the refund amount, but Stripe also changed its fee by ${toMajor(t.feeMinor)}; confirm how that was booked.`)
    }
    const reason = `Credit note ${creditNote.creditNoteNumber} already has a manual refund of ${l.amount} from Stripe Undeposited Funds ("${l.referenceNumber}", ${l.date}); nothing will be posted.`
    return { ...out, status: R.LEGACY_VERIFIED, reasonCode: 'LEGACY_MANUAL_REFUND', reason, reasons: [reason] }
  }
  if (!items.proven) return stop('ITEMS_NOT_PROVEN', `${items.reason} Confirm the return manually; items are never guessed.`)

  const cnComponent = {
    component: COMPONENT.REFUND_CREDIT_NOTE_REFUND,
    zohoRecordType: 'creditnote_refund',
    amount: toMajor(grossMinor),
    currency: t.currency,
    reference,
    date,
    creditNoteId: creditNote.creditNoteId,
    creditNoteNumber: creditNote.creditNoteNumber,
    candidateCreditNoteIds: candidates.map((c) => c.creditNoteId),
    depositAccountId: accounts.net.accountId,
    account: accounts.net,
    debitAccountId: null,
    creditAccountId: null,
  }
  cnComponent.payload = model.creditNoteRefundPayload(cnComponent, date, config.paymentMode)
  const proposed = [cnComponent]
  const adjustment = model.refundFeeAdjustmentAccounts(t.feeMinor, accounts.net.accountId, config.feeAccountId)
  if (adjustment) {
    if (!accounts.fee || clean(accounts.fee.accountId) !== config.feeAccountId) return stop('ACCOUNT_UNRESOLVED', 'Stripe Processing Chg Un-Cleared (1013) is not resolved.')
    const feeComponent = {
      component: COMPONENT.REFUND_FEE_ADJUSTMENT,
      zohoRecordType: 'journal',
      amount: toMajor(Math.abs(t.feeMinor)),
      currency: t.currency,
      reference: model.refundFeeReference(out.refundId),
      date,
      direction: adjustment.direction,
      debitAccountId: adjustment.debitAccountId,
      creditAccountId: adjustment.creditAccountId,
      depositAccountId: null,
      creditNoteId: creditNote.creditNoteId,
    }
    feeComponent.payload = model.payoutFeeJournalPayload(feeComponent, date)
    proposed.push(feeComponent)
  }
  const proposedKinds = new Set(proposed.map((c) => c.component))
  const stray = local.filter((row) => !proposedKinds.has(row.component))
  if (stray.length > 0) return stop('LOCAL_RECORD_CONFLICT', `Local ${stray.map((row) => `${row.component} (${row.status})`).join(', ')} exists that this refund no longer proposes.`)

  const components = []
  for (const proposal of proposed) {
    const row = local.find((x) => x.component === proposal.component) || null
    const c = { ...proposal, ...recordedDates(row, ctx.arrivalDate) }
    const zoho = c.component === COMPONENT.REFUND_CREDIT_NOTE_REFUND ? await creditNoteRefundZohoState(c, ctx) : await refundFeeJournalZohoState(c, ctx)
    const identity = row && (row.creditNoteId !== c.creditNoteId || row.invoiceId !== invoice.invoiceId || row.zohoCustomerId !== customerId)
    const recovery = identity
      ? { action: RECOVERY_ACTION.NEEDS_REVIEW, reason: `Local record points to credit note ${row.creditNoteId} / invoice ${row.invoiceId} / customer ${row.zohoCustomerId}.` }
      : model.planRecovery(zoho, row)
    components.push({ ...c, zoho, local: publicLocal(row), localStatus: row ? row.status : null, recovery })
  }
  const derived = model.deriveNormalRefundStatus(components)
  let { status, reasonCode, reasons } = derived
  // The sale must be cleared into 1019 before its refund leaves 1019.
  if ((status === R.READY || status === R.FAILED) && toMinor(invoice.balance) !== 0) {
    status = R.MATCHED
    reasonCode = 'WAITING_FOR_SALE_CLEARING'
    reasons = [`Invoice ${invoice.invoiceNumber} still has a balance of ${invoice.balance}; clear the sale (NET/FEE payments of its payout) before refunding credit note ${creditNote.creditNoteNumber}.`]
  }
  const kindText = out.kind === model.REFUND_KIND.FULL_REFUND ? 'Full refund' : 'Partial refund'
  const summary = `${kindText} ${out.gross} of ${invoice.invoiceNumber} (${out.cumulativeRefunded} of ${invoice.total} refunded so far): refund credit note ${creditNote.creditNoteNumber} from Stripe Undeposited Funds${adjustment ? `; fee adjustment ${toMajor(Math.abs(t.feeMinor))} ${adjustment.direction === 'FEE_RETURNED' ? 'Dr 1019 / Cr 1013' : 'Dr 1013 / Cr 1019'}` : ''}.`
  const allReasons = [...reasons, summary]
  return {
    ...out,
    status,
    reasonCode,
    reason: allReasons[0],
    reasons: allReasons,
    tracked: derived.tracked,
    components: components.map(({ localStatus, ...c }) => c),
    postingFingerprint: refundFingerprint(payout, out, proposed),
  }
}

const UNCERTAIN_LOCAL = new Set([COMPONENT_STATUS.POSTING_UNCERTAIN, COMPONENT_STATUS.POSTING])

/**
 * A stored component whose Zoho write may have happened (POSTING_UNCERTAIN, or POSTING left by
 * an interrupted request). Listed from the local rows, so it stays visible, and keeps the payout
 * from clearing, even if the payout no longer proposes it.
 */
function uncertainEntry(scope, row, config, now) {
  if (!UNCERTAIN_LOCAL.has(row.status)) return null
  const settleMs = (config.uncertainSettleMinutes == null ? 15 : config.uncertainSettleMinutes) * 60 * 1000
  const since = row.uncertainSince ? Date.parse(row.uncertainSince) : null
  const confirmAvailableAt = since == null ? null : new Date(since + settleMs).toISOString()
  const nowMs = (typeof now === 'function' ? now() : new Date()).getTime()
  let confirmBlockedReason = null
  if (row.status !== COMPONENT_STATUS.POSTING_UNCERTAIN) confirmBlockedReason = 'The posting attempt was interrupted; recheck Zoho first.'
  else if (!row.lastRecoveryCheckAt || (since != null && Date.parse(row.lastRecoveryCheckAt) < since)) confirmBlockedReason = 'Recheck Zoho first.'
  else if (since != null && nowMs < since + settleMs) confirmBlockedReason = `Available from ${confirmAvailableAt}, to give Zoho time to show the record.`
  return {
    scope,
    componentId: row.id,
    component: row.component,
    zohoRecordType: row.zohoRecordType,
    customerId: row.zohoCustomerId || null,
    refundId: row.refundId || null,
    creditNoteId: row.creditNoteId || null,
    reference: row.reference,
    amount: row.amount,
    status: row.status,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    firstUncertainAt: row.firstUncertainAt || null,
    uncertainSince: row.uncertainSince || null,
    lastRecoveryCheckAt: row.lastRecoveryCheckAt || null,
    recoveryCheckCount: row.recoveryCheckCount || 0,
    confirmAvailableAt,
    canConfirm: confirmBlockedReason === null,
    confirmBlockedReason,
  }
}

function publicNormalRefund({ grossMinor, feeMinor, netMinor, ...r }) {
  return r
}

function reconcile(groups, payout, chargeTxns, advanceRefunds, normalRefundTxns = []) {
  const sum = (key) => groups.reduce((s, g) => s + toMinor(g.totals[key]), 0)
  const into1019Minor = sum('total1019')
  const feesMinor = sum('feeTo1013')
  const refundsOutMinor = advanceRefunds.filter((r) => r.matched).reduce((s, r) => s + toMinor(r.amount), 0)
  const chargeGrossMinor = chargeTxns.reduce((s, t) => s + t.amountMinor, 0)
  const normalGrossMinor = normalRefundTxns.reduce((s, t) => s - t.amountMinor, 0)
  const normalFeeMinor = normalRefundTxns.reduce((s, t) => s + t.feeMinor, 0)
  const normalNetMinor = normalRefundTxns.reduce((s, t) => s + t.netMinor, 0)
  return {
    netTo1019: toMajor(sum('netTo1019')),
    customerAdvances: toMajor(sum('customerAdvance')),
    total1019: toMajor(into1019Minor),
    advanceRefundsOutOf1019: toMajor(refundsOutMinor),
    normalRefundsGross: toMajor(normalGrossMinor),
    normalRefundFeeAdjustments: toMajor(-normalFeeMinor),
    normalRefundsNetOutOf1019: toMajor(-normalNetMinor),
    fees: toMajor(feesMinor),
    payoutAmount: toMajor(payout.amountMinor),
    stripeGross: toMajor(chargeGrossMinor),
    total1019PlusFees: toMajor(into1019Minor + feesMinor),
    // NET + advances − advance refunds − normal refunds (each at its Stripe net) must equal the payout.
    payoutMatches: into1019Minor - refundsOutMinor + normalNetMinor === payout.amountMinor,
    // Everything in 1019 plus fees must equal every charge's gross in the payout.
    grossMatches: into1019Minor + feesMinor === chargeGrossMinor,
  }
}

/**
 * Full read-only preview of one payout.
 * @param {string} payoutId
 */
async function previewPayout(payoutId, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const { config, sources, zohoPayments, records, stripeConfig } = deps
  const id = assertPayoutId(payoutId)
  const payout = await sources.retrieveStripePayout(id)
  if (!payout) throw fail(404, 'STRIPE_PAYOUT_NOT_FOUND', `Stripe has no payout ${id}.`)
  if (payout.currency !== config.websiteCurrency) throw fail(422, 'PAYOUT_CURRENCY', `Payout ${id} is in ${payout.currency}, not ${config.websiteCurrency}.`)

  const txns = await sources.listPayoutBalanceTransactions(id)
  const composition = summarizeComposition(payout, txns)
  const chargeTxns = txns.filter((t) => CHARGE_TYPES.has(t.type))
  const otherTxns = txns.filter((t) => t.type !== 'payout' && !CHARGE_TYPES.has(t.type))
  // The arrival day only describes the source payout; every Zoho record is dated on the day it is posted.
  const arrivalDate = dubaiDateOf(payout.arrivalDate)
  const date = getDubaiPostingDate(typeof deps.now === 'function' ? deps.now() : new Date())
  const refundTxns = otherTxns.filter(isRefundTxn)

  const intentIds = [...new Set([...chargeTxns, ...refundTxns].map((t) => t.paymentIntentId).filter(Boolean))]
  const orders = intentIds.length > 0 ? await sources.loadWebsiteOrdersByIntents(intentIds, config.websiteCurrency) : []
  const ordersByIntent = new Map()
  for (const o of orders) {
    const list = ordersByIntent.get(o.stripePaymentIntentId) || []
    list.push(o)
    ordersByIntent.set(o.stripePaymentIntentId, list)
  }

  const chargeIds = [...new Set([...chargeTxns, ...otherTxns].map((t) => t.chargeId).filter(Boolean))]
  const cases = chargeIds.length > 0 ? await records.loadAdvanceCases(chargeIds) : []
  const casesByCharge = new Map(cases.map((c) => [c.chargeId, c]))

  const chargeIntentIds = [...new Set(chargeTxns.map((t) => t.paymentIntentId).filter(Boolean))]
  const mappings = chargeIntentIds.length > 0 && typeof records.loadDirectMappings === 'function' ? await records.loadDirectMappings(chargeIntentIds) : []
  const mappingsByIntent = new Map(mappings.map((m) => [m.paymentIntentId, m]))

  const payoutTxnIds = new Set(txns.map((t) => t.balanceTransactionId))
  const stripeCache = new Map()
  const built = []
  for (const t of chargeTxns) built.push(await buildLine(t, { config, sources, ordersByIntent, casesByCharge, payout, payoutTxnIds, stripeCache, mappingsByIntent }))
  const lines = flagSharedInvoices(applyCases(built, casesByCharge, payout, config))
  const localComponents = await records.loadComponents(id)
  const localFeeJournal = localComponents.find((c) => c.component === COMPONENT.PAYOUT_FEE_JOURNAL) || null
  const localByKey = new Map(localComponents
    .filter((c) => c.component !== COMPONENT.PAYOUT_FEE_JOURNAL)
    .map((c) => [`${c.zohoCustomerId}|${c.component}`, c]))
  for (const line of lines.filter((l) => l.direct)) {
    const used = localComponents.filter((c) => c.zohoCustomerId === line.direct.zohoCustomerId)
    line.direct.removable = used.length === 0
    line.direct.lockedReason = used.length > 0
      ? `Accounting exists for this payout customer (${used.map((c) => `${c.component} ${c.status}`).join(', ')}); the mapping can only change through a separate correction.`
      : null
  }

  const accounts = await resolveAccounts(config, zohoPayments)

  const byCustomer = new Map()
  const unassignedLines = []
  for (const line of lines) {
    if (line.customerId !== config.websiteZohoCustomerId && line.customerId !== config.shopZohoCustomerId) {
      unassignedLines.push(line)
      continue
    }
    const list = byCustomer.get(line.customerId) || []
    list.push(line)
    byCustomer.set(line.customerId, list)
  }

  const ctx = { sources, zohoPayments, config, payout, accounts, date, arrivalDate, localByKey, payoutId: id, cache: new Map() }
  const unassigned = []
  for (const line of unassignedLines) {
    unassigned.push({ ...publicLine(line), ...await describeUnassigned(line, { ...ctx, ordersByIntent, stripeCache }) })
  }
  const groups = []
  for (const customerId of [config.websiteZohoCustomerId, config.shopZohoCustomerId]) {
    const customerLines = byCustomer.get(customerId)
    if (customerLines) groups.push(await buildGroup(customerId, customerLines, ctx))
  }

  // Customer advance refunds and normal invoice refunds never mix: a refund on a charge with an
  // advance case follows the advance rules, every other refund is a normal invoice refund.
  const advanceRefundTxns = refundTxns.filter((t) => t.chargeId && casesByCharge.has(t.chargeId))
  const normalRefundTxns = refundTxns.filter((t) => !(t.chargeId && casesByCharge.has(t.chargeId)))
  const refunds = await linkRefunds(advanceRefundTxns, casesByCharge, ctx)
  const localRefunds = normalRefundTxns.length > 0 && typeof records.loadRefundComponents === 'function'
    ? await records.loadRefundComponents(normalRefundTxns.map((t) => t.sourceId).filter(Boolean))
    : []
  const refundCtx = { ...ctx, ordersByIntent, payoutTxnIds, stripeCache, localRefunds }
  const normalRefunds = []
  for (const t of normalRefundTxns) normalRefunds.push(await buildNormalRefund(t, refundCtx))

  const reconciliation = reconcile(groups, payout, chargeTxns, refunds, normalRefundTxns)
  const payoutBlockers = []
  if (unassigned.length > 0) payoutBlockers.push(`${unassigned.length} charge(s) could not be assigned to Website or Burjman. Map a direct Stripe payment with "Assign to Zoho Invoice".`)
  if (!composition.reconciles) payoutBlockers.push('Stripe balance transactions do not add up to the payout amount.')
  if (!reconciliation.payoutMatches) {
    const normalText = normalRefundTxns.length > 0 ? ` − normal refunds ${reconciliation.normalRefundsNetOutOf1019}` : ''
    payoutBlockers.push(`NET ${reconciliation.netTo1019} + customer advances ${reconciliation.customerAdvances} − advance refunds ${reconciliation.advanceRefundsOutOf1019}${normalText} does not equal the payout ${reconciliation.payoutAmount}.`)
  }
  if (!reconciliation.grossMatches) payoutBlockers.push(`Stripe Undeposited Funds ${reconciliation.total1019} + fees ${reconciliation.fees} does not equal Stripe gross ${reconciliation.stripeGross}.`)
  for (const r of refunds.filter((x) => !x.matched)) payoutBlockers.push(`Refund ${r.refundId || r.balanceTransactionId} (${r.amount}): ${r.reason}`)
  // Normal refund problems keep the payout from clearing fully but never block the sales' own posting.
  const refundBlockers = normalRefunds.filter((r) => REVIEW_REFUND.has(r.status)).map((r) => `Refund ${r.refundId || r.balanceTransactionId} (${r.gross}): ${r.reason}`)
  for (const r of normalRefunds) {
    r.postable = payoutBlockers.length === 0 && payout.status === 'paid'
      && (POSTABLE_REFUND.has(r.status) || (r.status === NORMAL_REFUND_STATUS.VERIFIED && !r.tracked))
  }

  // A payout that does not reconcile can post nothing; completed groups stay as they are.
  for (const g of groups) {
    if (payoutBlockers.length > 0 && POSTABLE_GROUP.has(g.status)) {
      g.reasons = ['The payout does not reconcile; nothing may be posted.', ...g.reasons]
      g.status = GROUP_STATUS.NEEDS_REVIEW
    }
    g.postable = POSTABLE_GROUP.has(g.status)
  }
  const feeJournal = await buildFeeJournal({ payout, txns, groups, payoutBlockers, accounts, config, date, arrivalDate, local: localFeeJournal, ctx, normalRefunds })

  const caseIds = cases.filter((c) => c.payoutId === id).map((c) => c.id)
  const caseEvents = caseIds.length > 0 ? await records.loadCaseEvents(caseIds) : []

  const warnings = []
  const nonRefundOther = otherTxns.filter((t) => !isRefundTxn(t))
  if (nonRefundOther.length > 0) warnings.push(`${nonRefundOther.length} non-charge balance transaction(s) are in this payout; they are not part of invoice clearing.`)
  if (refundTxns.length > 0) warnings.push(`${refundTxns.length} refund balance transaction(s) are in this payout; see Refunds.`)

  const uncertainComponents = [
    ...localComponents.map((row) => uncertainEntry('component', row, config, deps.now)),
    ...localRefunds.filter((row) => row.payoutId === id).map((row) => uncertainEntry('refund-component', row, config, deps.now)),
  ].filter(Boolean)
  const status = uncertainComponents.length > 0
    ? PAYOUT_STATUS.POSTING_UNCERTAIN
    : model.derivePayoutStatus(groups, payoutBlockers, feeJournal, { normal: normalRefunds, advance: refunds })

  const gate = postingGate(config, stripeConfig)
  return {
    preview: true,
    postingEnabled: gate.allowed,
    postingBlockedReasons: gate.reasons,
    payout: {
      payoutId: payout.payoutId,
      status: payout.status,
      amount: toMajor(payout.amountMinor),
      currency: payout.currency,
      arrivalDate: payout.arrivalDate,
      arrivalDay: arrivalDate,
      createdAt: payout.createdAt,
    },
    status,
    blockers: payoutBlockers,
    uncertainComponents,
    refundBlockers,
    zohoPostingDate: date,
    proposedPaymentDate: date,
    accounts: {
      net: accounts.net,
      fee: accounts.fee,
      advance: accounts.advance,
      feeExpense: accounts.feeExpense,
      problems: [...accounts.problems.base, ...(accounts.problems.advance ? [accounts.problems.advance] : [])],
    },
    composition,
    reconciliation,
    customersPresent: groups.map((g) => g.customerName),
    groups,
    feeJournal,
    unassigned,
    directMappings: mappings.map(publicMapping),
    advanceCases: cases.filter((c) => c.payoutId === id),
    advanceCaseEvents: caseEvents,
    advanceRefunds: refunds,
    normalRefunds: normalRefunds.map(publicNormalRefund),
    otherTransactions: otherTxns.map(publicOther),
    warnings,
  }
}

module.exports = {
  GROUP_STATUS,
  PAYOUT_STATUS,
  LINE_STATE,
  RECOVERY_ACTION,
  FEE_JOURNAL_STATUS: model.FEE_JOURNAL_STATUS,
  NORMAL_REFUND_STATUS,
  netReference: model.netReference,
  feeReference: model.feeReference,
  summarizeComposition,
  previewPayout,
  componentZohoState,
}
