'use strict'

/**
 * Read-only preview of payout-level clearing. One Stripe payout → per Zoho customer
 * (Website / Burjman Shop, never mixed):
 * - NET customer payment → Stripe Undeposited Funds (1019), allocated invoice by invoice
 * - FEE customer payment → Stripe Processing Chg Un-Cleared (1013), allocated invoice by invoice
 * - CUSTOMER_ADVANCE journal Dr 1019 / Cr Customer Advance Funds (1123) for admin-confirmed
 *   overpayments (Stripe gross above the invoice total)
 *
 * Nothing here writes to Stripe, the website database, Zoho or the local database.
 * Amounts are kept in minor units until output.
 */

const { getStripeClearingConfig } = require('../../config/stripeClearing')
const defaultSources = require('./stripeClearingSources')
const { MATCH_STATUS, classifyStripePayment, expectedZohoCustomerId, pickMatchedInvoice } = require('./stripeClearingMatcher')
const model = require('./stripePayoutClearingModel')
const payoutStore = require('./stripePayoutClearingStore')

const { GROUP_STATUS, PAYOUT_STATUS, COMPONENT, ZOHO_STATE, RECOVERY_ACTION, POSTABLE_GROUP } = model
const { CASE_STATUS, REFUND_STATUS, ENTITY } = payoutStore

const PAYOUT_PATTERN = /^po_[A-Za-z0-9]{8,64}$/
const CHARGE_TYPES = new Set(['charge', 'payment'])
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000
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
  }
}

function defaultDeps() {
  return {
    config: getStripeClearingConfig(),
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
  return { net: net.account, fee: fee.account, advance: advance.account, problems: { base: [net.problem, fee.problem].filter(Boolean), advance: advance.problem } }
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

async function buildLine(t, ctx) {
  const { config, sources, ordersByIntent, casesByCharge } = ctx
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
    website: null,
    invoice: null,
    customerId: null,
    advance: null,
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
  // A later refund of exactly a confirmed customer advance is booked against 1123, not this invoice.
  const linkedCase = t.chargeId ? casesByCharge.get(t.chargeId) : null
  const refundIsAdvance = Boolean(linkedCase && CONFIRMED_CASE.has(linkedCase.status) && t.chargeRefundedMinor === toMinor(linkedCase.overpaymentAmount))
  const stripe = {
    paymentIntentId: t.paymentIntentId,
    status: 'succeeded',
    amountReceived: toMajor(t.amountMinor),
    amountRefunded: refundIsAdvance ? 0 : toMajor(t.chargeRefundedMinor),
    disputed: t.chargeDisputed,
    currency: t.currency,
  }
  const match = classifyStripePayment({ stripe, websiteOrders, zohoInvoices, config })
  line.matchStatus = match.status
  const invoice = order ? pickMatchedInvoice(zohoInvoices, order.orderNumber) : null
  if (invoice) {
    line.invoice = { invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber, total: invoice.total, balance: invoice.balance, status: invoice.status, customerId: invoice.customerId }
  }

  const orderTotalMinor = order ? toMinor(order.finalAmount) : null
  const overpaid = match.status === MATCH_STATUS.AMOUNT_MISMATCH && order && t.amountMinor > orderTotalMinor
  if (!overpaid) {
    const s = invoiceState(match, invoice, line.customerId, t.amountMinor)
    return { ...line, ...s }
  }

  // Customer overpayment candidate: every check must pass as if Stripe had collected
  // exactly the website order total (one invoice, same customer, same total, no refund/dispute).
  const asOrderTotal = classifyStripePayment({ stripe: { ...stripe, amountReceived: order.finalAmount }, websiteOrders, zohoInvoices, config })
  const s = invoiceState(asOrderTotal, invoice, line.customerId, orderTotalMinor)
  if (s.state === LINE_STATE.NEEDS_REVIEW) return review(`${match.reason} ${s.reason}`)
  const advanceMinor = t.amountMinor - orderTotalMinor
  const netAllocMinor = orderTotalMinor - t.feeMinor
  if (netAllocMinor <= 0) return review(`${match.reason} The Stripe fee is not covered by the invoice total.`)
  return {
    ...line,
    ...s,
    matchStatus: asOrderTotal.status,
    invoiceTotalMinor: orderTotalMinor,
    netAllocMinor,
    feeAllocMinor: t.feeMinor,
    advanceMinor,
    advance: {
      overpaymentAmount: toMajor(advanceMinor),
      invoiceTotal: toMajor(orderTotalMinor),
      stripeGross: toMajor(t.amountMinor),
      netAllocation: toMajor(netAllocMinor),
      caseStatus: CASE_STATUS.REVIEW_REQUIRED,
      confirmed: false,
      caseId: null,
      confirmedBy: null,
      confirmedAt: null,
      reason: null,
    },
    reason: `Stripe collected ${toMajor(t.amountMinor)} for invoice ${invoice.invoiceNumber} total ${toMajor(orderTotalMinor)}: customer overpayment ${toMajor(advanceMinor)}.`,
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
    const advance = {
      ...line.advance,
      caseId: stored.id,
      caseStatus: stored.status,
      confirmed: CONFIRMED_CASE.has(stored.status),
      confirmedBy: stored.confirmedBy,
      confirmedAt: stored.confirmedAt,
      reason: stored.reason,
      refundStatus: stored.refundStatus,
    }
    if (stored.status === CASE_STATUS.REJECTED) {
      return { ...line, advance, state: LINE_STATE.NEEDS_REVIEW, reason: `Customer advance case ${stored.id} was rejected; resolve this charge manually.` }
    }
    return { ...line, advance }
  })
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
    website: l.website,
    invoice: l.invoice,
    advance: l.advance,
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

/** Advance journals for this payout reference, grouped by the customer tagged on the 1123 line. */
async function advanceJournals(payoutId, ctx) {
  return cached(ctx.cache, `jr:${payoutId}`, async () => {
    const reference = model.advanceReference(payoutId)
    const found = await ctx.sources.findZohoJournalsByReference(reference, { source: 'stripe_payout_preview' })
    const out = []
    for (const j of found) {
      const detail = await ctx.sources.getZohoJournal(j.journalId, { source: 'stripe_payout_preview' })
      out.push({ journalId: j.journalId, detail, customerId: detail ? model.journalCustomer(detail, ctx.config.advanceAccountId) : '' })
    }
    return out
  })
}

async function zohoJournalState(component, customerId, ctx, payoutId) {
  const journals = await advanceJournals(payoutId, ctx)
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
    blockers.push(`Customer overpayment of ${l.advance.overpaymentAmount} on ${l.invoice.invoiceNumber} needs admin confirmation (Confirm Customer Advance).`)
  }
  if (accounts.problems.base.length > 0) blockers.push(...accounts.problems.base)
  const hasAdvance = allocatable.some((l) => l.advanceMinor > 0)
  if (hasAdvance && accounts.problems.advance) blockers.push(accounts.problems.advance)
  if (payout.status !== 'paid') blockers.push(`Payout status is ${payout.status}.`)

  const proposed = proposeComponents(customerId, allocatable, payout, accounts, config, date)
  const components = []
  for (const c of proposed) {
    const zoho = c.zohoRecordType === 'journal' ? await zohoJournalState(c, customerId, ctx, payoutId) : await zohoPaymentState(c, customerId, ctx)
    const local = localByKey.get(`${customerId}|${c.component}`) || null
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
    lines: lines.map(publicLine),
  }
}

/** Stripe refunds in this payout, linked charge → case. Preview only; never posted here. */
function linkRefunds(otherTxns, casesByCharge, payoutId, accounts, config, date) {
  return otherTxns
    .filter((t) => t.type === 'refund' || t.reportingCategory === 'refund')
    .map((t) => {
      const stored = t.chargeId ? casesByCharge.get(t.chargeId) : null
      const refundMinor = -t.netMinor
      const base = {
        balanceTransactionId: t.balanceTransactionId,
        refundId: t.sourceId,
        chargeId: t.chargeId,
        paymentIntentId: t.paymentIntentId,
        amount: toMajor(refundMinor),
        caseId: stored ? stored.id : null,
        originalPayoutId: stored ? stored.payoutId : null,
        customerId: stored ? stored.zohoCustomerId : null,
        overpaymentAmount: stored ? stored.overpaymentAmount : null,
      }
      if (!stored) return { ...base, status: 'NO_ADVANCE_CASE', matched: false, reason: 'Refund is not linked to a customer advance case.', proposedJournal: null }
      if (!REFUNDABLE_CASE.has(stored.status)) {
        return { ...base, status: REFUND_STATUS.REFUND_MISMATCH, matched: false, reason: `Customer advance case ${stored.id} is ${stored.status}.`, proposedJournal: null }
      }
      if (refundMinor !== toMinor(stored.overpaymentAmount) || t.currency !== config.websiteCurrency) {
        return { ...base, status: REFUND_STATUS.REFUND_MISMATCH, matched: false, reason: `Refund ${toMajor(refundMinor)} does not equal the customer advance ${stored.overpaymentAmount}.`, proposedJournal: null }
      }
      const component = {
        component: COMPONENT.CUSTOMER_ADVANCE_REFUND,
        amount: toMajor(refundMinor),
        reference: model.advanceRefundReference(payoutId),
        debitAccountId: config.advanceAccountId,
        creditAccountId: accounts.net ? accounts.net.accountId : null,
      }
      return {
        ...base,
        status: REFUND_STATUS.REFUND_MATCHED,
        matched: true,
        reason: `Refund equals customer advance case ${stored.id}; Dr Customer Advance Funds / Cr Stripe Undeposited Funds.`,
        proposedJournal: { ...component, payload: model.advanceJournalPayload(component, stored.zohoCustomerId, date) },
      }
    })
}

function reconcile(groups, payout, chargeTxns, refunds) {
  const sum = (key) => groups.reduce((s, g) => s + toMinor(g.totals[key]), 0)
  const into1019Minor = sum('total1019')
  const feesMinor = sum('feeTo1013')
  const refundsOutMinor = refunds.filter((r) => r.matched).reduce((s, r) => s + toMinor(r.amount), 0)
  const chargeGrossMinor = chargeTxns.reduce((s, t) => s + t.amountMinor, 0)
  return {
    netTo1019: toMajor(sum('netTo1019')),
    customerAdvances: toMajor(sum('customerAdvance')),
    total1019: toMajor(into1019Minor),
    advanceRefundsOutOf1019: toMajor(refundsOutMinor),
    fees: toMajor(feesMinor),
    payoutAmount: toMajor(payout.amountMinor),
    stripeGross: toMajor(chargeGrossMinor),
    total1019PlusFees: toMajor(into1019Minor + feesMinor),
    // NET + advances (less linked advance refunds) must equal what Stripe paid out.
    payoutMatches: into1019Minor - refundsOutMinor === payout.amountMinor,
    // Everything in 1019 plus fees must equal every charge's gross in the payout.
    grossMatches: into1019Minor + feesMinor === chargeGrossMinor,
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
  const { config, sources, zohoPayments, records } = deps
  const id = assertPayoutId(payoutId)
  const payout = await sources.retrieveStripePayout(id)
  if (!payout) throw fail(404, 'STRIPE_PAYOUT_NOT_FOUND', `Stripe has no payout ${id}.`)
  if (payout.currency !== config.websiteCurrency) throw fail(422, 'PAYOUT_CURRENCY', `Payout ${id} is in ${payout.currency}, not ${config.websiteCurrency}.`)

  const txns = await sources.listPayoutBalanceTransactions(id)
  const composition = summarizeComposition(payout, txns)
  const chargeTxns = txns.filter((t) => CHARGE_TYPES.has(t.type))
  const otherTxns = txns.filter((t) => t.type !== 'payout' && !CHARGE_TYPES.has(t.type))
  const date = dubaiDate(payout.arrivalDate)

  const intentIds = [...new Set(chargeTxns.map((t) => t.paymentIntentId).filter(Boolean))]
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

  const built = []
  for (const t of chargeTxns) built.push(await buildLine(t, { config, sources, ordersByIntent, casesByCharge }))
  const lines = applyCases(built, casesByCharge, payout, config)
  const localComponents = await records.loadComponents(id)
  const localByKey = new Map(localComponents.map((c) => [`${c.zohoCustomerId}|${c.component}`, c]))

  const accounts = await resolveAccounts(config, zohoPayments)

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

  const ctx = { sources, zohoPayments, config, payout, accounts, date, localByKey, payoutId: id, cache: new Map() }
  const groups = []
  for (const customerId of [config.websiteZohoCustomerId, config.shopZohoCustomerId]) {
    const customerLines = byCustomer.get(customerId)
    if (customerLines) groups.push(await buildGroup(customerId, customerLines, ctx))
  }

  const refunds = linkRefunds(otherTxns, casesByCharge, id, accounts, config, date)
  const reconciliation = reconcile(groups, payout, chargeTxns, refunds)
  const payoutBlockers = []
  if (unassigned.length > 0) payoutBlockers.push(`${unassigned.length} charge(s) could not be assigned to Website or Burjman.`)
  if (!composition.reconciles) payoutBlockers.push('Stripe balance transactions do not add up to the payout amount.')
  if (!reconciliation.payoutMatches) payoutBlockers.push(`NET ${reconciliation.netTo1019} + customer advances ${reconciliation.customerAdvances} − advance refunds ${reconciliation.advanceRefundsOutOf1019} does not equal the payout ${reconciliation.payoutAmount}.`)
  if (!reconciliation.grossMatches) payoutBlockers.push(`Stripe Undeposited Funds ${reconciliation.total1019} + fees ${reconciliation.fees} does not equal Stripe gross ${reconciliation.stripeGross}.`)
  for (const r of refunds.filter((x) => !x.matched)) payoutBlockers.push(`Refund ${r.refundId || r.balanceTransactionId} (${r.amount}): ${r.reason}`)

  // A payout that does not reconcile can post nothing; completed groups stay as they are.
  for (const g of groups) {
    if (payoutBlockers.length > 0 && POSTABLE_GROUP.has(g.status)) {
      g.reasons = ['The payout does not reconcile; nothing may be posted.', ...g.reasons]
      g.status = GROUP_STATUS.NEEDS_REVIEW
    }
    g.postable = POSTABLE_GROUP.has(g.status)
  }

  const caseIds = cases.filter((c) => c.payoutId === id).map((c) => c.id)
  const caseEvents = caseIds.length > 0 ? await records.loadCaseEvents(caseIds) : []

  const warnings = []
  if (otherTxns.length > 0) warnings.push(`${otherTxns.length} non-charge balance transaction(s) are in this payout; they are not part of invoice clearing.`)

  return {
    preview: true,
    postingEnabled: false,
    payout: {
      payoutId: payout.payoutId,
      status: payout.status,
      amount: toMajor(payout.amountMinor),
      currency: payout.currency,
      arrivalDate: payout.arrivalDate,
      createdAt: payout.createdAt,
    },
    status: model.derivePayoutStatus(groups, payoutBlockers),
    blockers: payoutBlockers,
    proposedPaymentDate: date,
    accounts: {
      net: accounts.net,
      fee: accounts.fee,
      advance: accounts.advance,
      problems: [...accounts.problems.base, ...(accounts.problems.advance ? [accounts.problems.advance] : [])],
    },
    composition,
    reconciliation,
    customersPresent: groups.map((g) => g.customerName),
    groups,
    unassigned,
    advanceCases: cases.filter((c) => c.payoutId === id),
    advanceCaseEvents: caseEvents,
    advanceRefunds: refunds,
    otherTransactions: otherTxns.map(publicOther),
    warnings,
  }
}

module.exports = {
  GROUP_STATUS,
  PAYOUT_STATUS,
  LINE_STATE,
  RECOVERY_ACTION,
  netReference: model.netReference,
  feeReference: model.feeReference,
  listPayoutSummaries,
  previewPayout,
}
