'use strict'

/**
 * Read-only preview of payout-level clearing: one Stripe payout → per Zoho customer,
 * one NET customer payment (Stripe Undeposited Funds) and one FEE customer payment
 * (Stripe Processing Chg Un-Cleared), each allocated invoice by invoice.
 *
 * Nothing here writes to Stripe, the website database, Zoho or the local database.
 * Grouping key: payout ID + Zoho customer + component. Website and shop invoices are
 * never mixed in one payment. Amounts are kept in minor units until output.
 */

const { getStripeClearingConfig } = require('../../config/stripeClearing')
const defaultSources = require('./stripeClearingSources')
const { MATCH_STATUS, classifyStripePayment, expectedZohoCustomerId, pickMatchedInvoice } = require('./stripeClearingMatcher')

const PAYOUT_PATTERN = /^po_[A-Za-z0-9]{8,64}$/
const CHARGE_TYPES = new Set(['charge', 'payment'])
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000

const GROUP_STATUS = Object.freeze({
  READY: 'READY',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  MULTIPLE_MATCHES: 'MULTIPLE_MATCHES',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
})

const LINE_STATE = Object.freeze({
  OPEN: 'OPEN',
  CLEARED: 'CLEARED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
})

function defaultDeps() {
  return {
    config: getStripeClearingConfig(),
    sources: defaultSources,
    zohoPayments: require('../amazonPaymentClearingZohoPaymentService'),
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

function dubaiDate(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return new Date(t + DUBAI_OFFSET_MS).toISOString().slice(0, 10)
}

function fail(status, code, message) {
  const err = new Error(message)
  err.status = status
  err.code = code
  return err
}

function netReference(payoutId) {
  return `Stripe funds received ${payoutId}`
}

function feeReference(payoutId) {
  return `Stripe processing fee ${payoutId}`
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

/** Exact name + code + active + cash type; never falls back to another account. */
function resolveAccount(accounts, name, code) {
  const matches = accounts.filter((a) => clean(a.accountName).toLowerCase() === name.toLowerCase())
  if (matches.length !== 1) return { account: null, problem: `${matches.length} Zoho accounts are named "${name}".` }
  const a = matches[0]
  if (clean(a.accountCode) !== code) return { account: null, problem: `Zoho account "${name}" has code ${a.accountCode || '(none)'}, expected ${code}.` }
  if (!a.isActive) return { account: null, problem: `Zoho account "${name}" is inactive.` }
  if (clean(a.accountType) !== 'cash') return { account: null, problem: `Zoho account "${name}" is type ${a.accountType}, expected cash.` }
  return { account: { accountId: a.accountId, accountName: a.accountName, accountCode: a.accountCode, accountType: a.accountType }, problem: null }
}

async function resolveAccounts(config, zohoPayments) {
  const accounts = await zohoPayments.listZohoChartAccounts()
  const net = resolveAccount(accounts, config.depositAccountName, config.depositAccountCode)
  const fee = resolveAccount(accounts, config.feeAccountName, config.feeAccountCode)
  return { net: net.account, fee: fee.account, problems: [net.problem, fee.problem].filter(Boolean) }
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

async function buildLine(t, ctx) {
  const { config, sources, ordersByIntent } = ctx
  const line = {
    balanceTransactionId: t.balanceTransactionId,
    chargeId: t.chargeId,
    paymentIntentId: t.paymentIntentId,
    grossMinor: t.amountMinor,
    feeMinor: t.feeMinor,
    netMinor: t.netMinor,
    currency: t.currency,
    website: null,
    invoice: null,
    customerId: null,
    state: LINE_STATE.NEEDS_REVIEW,
    matchStatus: null,
    reason: '',
  }
  const review = (reason) => ({ ...line, state: LINE_STATE.NEEDS_REVIEW, reason })

  if (t.currency !== config.websiteCurrency || t.exchangeRate != null) return review(`Stripe balance transaction is ${t.currency}${t.exchangeRate != null ? ' with conversion' : ''}.`)
  if (t.amountMinor !== t.netMinor + t.feeMinor) return review('Stripe gross does not equal net + fee.')
  if (!t.paymentIntentId) return review('Stripe charge has no PaymentIntent.')

  const websiteOrders = ordersByIntent.get(t.paymentIntentId) || []
  const order = websiteOrders.length === 1 ? websiteOrders[0] : null
  if (order) {
    line.website = { orderId: order.orderId, orderNumber: order.orderNumber, finalAmount: order.finalAmount, shopOrder: order.shopOrder, orderStatus: order.orderStatus, paymentStatus: order.paymentStatus }
    line.customerId = expectedZohoCustomerId(order, config)
  }

  let zohoInvoices = null
  if (order && clean(order.orderNumber)) {
    zohoInvoices = await sources.findZohoInvoicesByReference(order.orderNumber, { source: 'stripe_payout_preview' })
  }
  const stripe = {
    paymentIntentId: t.paymentIntentId,
    status: 'succeeded',
    amountReceived: toMajor(t.amountMinor),
    amountRefunded: toMajor(t.chargeRefundedMinor),
    disputed: t.chargeDisputed,
    currency: t.currency,
  }
  const match = classifyStripePayment({ stripe, websiteOrders, zohoInvoices, config })
  line.matchStatus = match.status
  const invoice = order ? pickMatchedInvoice(zohoInvoices, order.orderNumber) : null
  if (invoice) {
    line.invoice = { invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber, total: invoice.total, balance: invoice.balance, status: invoice.status, customerId: invoice.customerId }
  }

  if (match.status === MATCH_STATUS.MATCHED_READY_TO_CLEAR) {
    return { ...line, state: LINE_STATE.OPEN, reason: match.reason }
  }
  const paidInvoice = match.status === MATCH_STATUS.ALREADY_CLEARED && invoice && invoice.customerId === line.customerId
  if (paidInvoice && toMinor(invoice.total) === t.amountMinor) {
    return { ...line, state: LINE_STATE.CLEARED, reason: `Zoho invoice ${invoice.invoiceNumber} is already paid.` }
  }
  if (paidInvoice) {
    return review(`Zoho invoice ${invoice.invoiceNumber} total ${invoice.total} does not equal Stripe gross ${toMajor(t.amountMinor)}.`)
  }
  return review(match.reason)
}

function allocation(line, amountMinor) {
  return {
    invoiceId: line.invoice.invoiceId,
    invoiceNumber: line.invoice.invoiceNumber,
    orderNumber: line.website.orderNumber,
    paymentIntentId: line.paymentIntentId,
    amount: toMajor(amountMinor),
  }
}

/** Compare an existing Zoho payment with what the preview would create. */
function compareExisting(detail, component) {
  const differences = []
  if (!detail) return { matchesProposal: false, differences: ['The Zoho payment could not be read.'] }
  if (toMinor(detail.amount) !== toMinor(component.amount)) differences.push(`Amount ${detail.amount}, proposed ${component.amount}.`)
  if (component.account && clean(detail.account_id) !== component.account.accountId) differences.push(`Deposited to ${detail.account_name || detail.account_id}.`)
  const existing = new Map()
  for (const inv of detail.invoices || []) existing.set(clean(inv.invoice_id), toMinor(inv.amount_applied))
  const proposed = new Map(component.allocations.map((a) => [a.invoiceId, toMinor(a.amount)]))
  for (const [id, minor] of proposed) {
    if (!existing.has(id)) differences.push(`Invoice ${id} is not allocated in Zoho.`)
    else if (existing.get(id) !== minor) differences.push(`Invoice ${id}: Zoho ${toMajor(existing.get(id))}, proposed ${toMajor(minor)}.`)
  }
  for (const id of existing.keys()) if (!proposed.has(id)) differences.push(`Zoho also allocates invoice ${id}.`)
  return { matchesProposal: differences.length === 0, differences }
}

async function checkExisting(component, customerId, ctx) {
  const { sources, zohoPayments, refCache } = ctx
  if (!refCache.has(component.reference)) {
    refCache.set(component.reference, sources.findZohoPaymentsByReference(component.reference, { source: 'stripe_payout_preview' }))
  }
  const all = await refCache.get(component.reference)
  const mine = all.filter((p) => p.customerId === customerId)
  const payments = mine.map((p) => ({ paymentId: p.paymentId, amount: p.amount, date: p.date, accountId: p.accountId, accountName: p.accountName }))
  if (mine.length !== 1) return { count: mine.length, payments, comparison: null }
  const detail = await zohoPayments.getZohoCustomerPayment(mine[0].paymentId, { source: 'stripe_payout_preview' })
  return { count: 1, payments, comparison: { ...compareExisting(detail, component), date: detail ? detail.date : null } }
}

function groupStatus(group, payout, accountsOk) {
  const reasons = []
  const net = group.net.existing
  const fee = group.fee.existing
  if (net.count > 1 || fee.count > 1) {
    return { status: GROUP_STATUS.MULTIPLE_MATCHES, reasons: ['More than one Zoho payment has this reference for this customer.'] }
  }
  if (net.count === 1 && fee.count === 1) {
    const differences = [...net.comparison.differences, ...fee.comparison.differences]
    if (differences.length === 0) return { status: GROUP_STATUS.ALREADY_EXISTS, reasons: ['NET and FEE payments already exist in Zoho and match this payout.'] }
    return { status: GROUP_STATUS.NEEDS_REVIEW, reasons: ['NET and FEE payments exist in Zoho but differ from this payout.', ...differences] }
  }
  if (net.count === 1 || fee.count === 1) {
    return { status: GROUP_STATUS.NEEDS_REVIEW, reasons: [`Only the ${net.count === 1 ? 'NET' : 'FEE'} payment exists in Zoho.`] }
  }
  const review = group.lines.filter((l) => l.state === LINE_STATE.NEEDS_REVIEW)
  const cleared = group.lines.filter((l) => l.state === LINE_STATE.CLEARED)
  if (review.length > 0) reasons.push(`${review.length} charge(s) need review.`)
  if (cleared.length > 0) reasons.push(`${cleared.length} invoice(s) are already paid in Zoho without these payout references.`)
  if (!accountsOk) reasons.push('The Zoho deposit accounts could not be resolved exactly.')
  if (payout.status !== 'paid') reasons.push(`Payout status is ${payout.status}.`)
  if (reasons.length > 0) return { status: GROUP_STATUS.NEEDS_REVIEW, reasons }
  return { status: GROUP_STATUS.READY, reasons: [] }
}

function buildGroup(customerId, lines, payout, accounts, config) {
  const allocatable = lines.filter((l) => l.invoice && l.state !== LINE_STATE.NEEDS_REVIEW)
  const sum = (key) => allocatable.reduce((s, l) => s + l[key], 0)
  const grossMinor = sum('grossMinor')
  const netMinor = sum('netMinor')
  const feeMinor = sum('feeMinor')
  const component = (kind, reference, account, key) => ({
    component: kind,
    reference,
    account,
    amount: toMajor(key === 'net' ? netMinor : feeMinor),
    allocations: allocatable.map((l) => allocation(l, key === 'net' ? l.netMinor : l.feeMinor)),
  })
  return {
    groupKey: `${payout.payoutId}|${customerId}|NET+FEE`,
    customerId,
    customerName: customerName(customerId, config),
    invoiceCount: allocatable.length,
    chargeCount: lines.length,
    gross: toMajor(grossMinor),
    net: component('NET', netReference(payout.payoutId), accounts.net, 'net'),
    fee: component('FEE', feeReference(payout.payoutId), accounts.fee, 'fee'),
    netPlusFeeEqualsGross: netMinor + feeMinor === grossMinor,
    everyInvoiceBalances: allocatable.every((l) => l.netMinor + l.feeMinor === l.grossMinor && toMinor(l.invoice.total) === l.grossMinor),
    lines: lines.map(publicLine),
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
    website: l.website,
    invoice: l.invoice,
    state: l.state,
    matchStatus: l.matchStatus,
    reason: l.reason,
  }
}

/**
 * Recent payouts with their Stripe-side composition only (no Zoho calls).
 * @param {{ limit?: number|string }} params
 */
async function listPayoutSummaries(params = {}, overrides = {}) {
  const { sources } = { ...defaultDeps(), ...overrides }
  const limit = Math.min(Math.max(parseInt(params.limit, 10) || 10, 1), 30)
  const payouts = await sources.listStripePayouts({ limit })
  const rows = []
  for (const payout of payouts) {
    const txns = await sources.listPayoutBalanceTransactions(payout.payoutId)
    rows.push({
      payoutId: payout.payoutId,
      status: payout.status,
      amount: toMajor(payout.amountMinor),
      currency: payout.currency,
      arrivalDate: payout.arrivalDate,
      createdAt: payout.createdAt,
      composition: summarizeComposition(payout, txns),
    })
  }
  return { rows }
}

/**
 * Full read-only preview of one payout.
 * @param {string} payoutId
 */
async function previewPayout(payoutId, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const { config, sources, zohoPayments } = deps
  const id = assertPayoutId(payoutId)
  const payout = await sources.retrieveStripePayout(id)
  if (!payout) throw fail(404, 'STRIPE_PAYOUT_NOT_FOUND', `Stripe has no payout ${id}.`)
  if (payout.currency !== config.websiteCurrency) throw fail(422, 'PAYOUT_CURRENCY', `Payout ${id} is in ${payout.currency}, not ${config.websiteCurrency}.`)

  const txns = await sources.listPayoutBalanceTransactions(id)
  const composition = summarizeComposition(payout, txns)
  const chargeTxns = txns.filter((t) => CHARGE_TYPES.has(t.type))
  const otherTxns = txns.filter((t) => t.type !== 'payout' && !CHARGE_TYPES.has(t.type))

  const intentIds = [...new Set(chargeTxns.map((t) => t.paymentIntentId).filter(Boolean))]
  const orders = intentIds.length > 0 ? await sources.loadWebsiteOrdersByIntents(intentIds, config.websiteCurrency) : []
  const ordersByIntent = new Map()
  for (const o of orders) {
    const list = ordersByIntent.get(o.stripePaymentIntentId) || []
    list.push(o)
    ordersByIntent.set(o.stripePaymentIntentId, list)
  }

  const lines = []
  for (const t of chargeTxns) lines.push(await buildLine(t, { config, sources, ordersByIntent }))

  const accounts = await resolveAccounts(config, zohoPayments)
  const accountsOk = accounts.problems.length === 0

  const byCustomer = new Map()
  const unassigned = []
  for (const line of lines) {
    if (line.customerId !== config.websiteZohoCustomerId && line.customerId !== config.shopZohoCustomerId) {
      unassigned.push(publicLine(line))
      continue
    }
    const list = byCustomer.get(line.customerId) || []
    list.push(line)
    byCustomer.set(line.customerId, list)
  }

  const ctx = { sources, zohoPayments, refCache: new Map() }
  const groups = []
  for (const customerId of [config.websiteZohoCustomerId, config.shopZohoCustomerId]) {
    const customerLines = byCustomer.get(customerId)
    if (!customerLines) continue
    const group = buildGroup(customerId, customerLines, payout, accounts, config)
    group.net.existing = await checkExisting(group.net, customerId, ctx)
    group.fee.existing = await checkExisting(group.fee, customerId, ctx)
    Object.assign(group, groupStatus(group, payout, accountsOk))
    groups.push(group)
  }

  const allocated = groups.reduce(
    (s, g) => ({ gross: s.gross + toMinor(g.gross), net: s.net + toMinor(g.net.amount), fee: s.fee + toMinor(g.fee.amount) }),
    { gross: 0, net: 0, fee: 0 },
  )
  const warnings = []
  if (unassigned.length > 0) warnings.push(`${unassigned.length} charge(s) could not be assigned to Website or Burjman.`)
  if (otherTxns.length > 0) warnings.push(`${otherTxns.length} non-charge balance transaction(s) are in this payout; they are not part of invoice clearing.`)
  if (!composition.reconciles) warnings.push('Stripe balance transactions do not add up to the payout amount.')
  const readiness = groups.length > 0 && unassigned.length === 0 && groups.every((g) => g.status === GROUP_STATUS.READY)
    ? GROUP_STATUS.READY
    : groups.length > 0 && groups.every((g) => g.status === GROUP_STATUS.ALREADY_EXISTS) && unassigned.length === 0
      ? GROUP_STATUS.ALREADY_EXISTS
      : GROUP_STATUS.NEEDS_REVIEW

  return {
    preview: true,
    payout: {
      payoutId: payout.payoutId,
      status: payout.status,
      amount: toMajor(payout.amountMinor),
      currency: payout.currency,
      arrivalDate: payout.arrivalDate,
      createdAt: payout.createdAt,
    },
    proposedPaymentDate: dubaiDate(payout.arrivalDate),
    accounts: { net: accounts.net, fee: accounts.fee, problems: accounts.problems },
    composition,
    reconciliation: {
      matchedGross: toMajor(allocated.gross),
      netAllocations: toMajor(allocated.net),
      feeAllocations: toMajor(allocated.fee),
      netPlusFeeEqualsGross: allocated.net + allocated.fee === allocated.gross,
    },
    readiness,
    customersPresent: groups.map((g) => g.customerName),
    groups,
    unassigned,
    otherTransactions: otherTxns.map(publicOther),
    warnings,
  }
}

module.exports = {
  GROUP_STATUS,
  LINE_STATE,
  netReference,
  feeReference,
  listPayoutSummaries,
  previewPayout,
}
