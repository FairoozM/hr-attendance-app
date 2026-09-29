'use strict'

/**
 * Direct Stripe payments (Payment Links) mapped by an admin to an existing Zoho invoice.
 * The payout is po_1UDDZ3DJogiiRoKPj4uB4mEL: two website-order charges (gross 970.70, fee 30.15)
 * and the real direct payment pi_3UB7cxDJogiiRoKP2ddNSqC5 (1261.00, fee 50.18) for INV-043544,
 * P.O.# 20901, Payment Link product "Matjar meem #20901" / "invoice #20901". The two website
 * charges' split is illustrative; their totals and the direct payment are the real figures.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { getStripeClearingConfig } = require('../src/config/stripeClearing')
const { previewPayout, LINE_STATE } = require('../src/services/stripeClearing/stripePayoutPreviewService')
const direct = require('../src/services/stripeClearing/stripeDirectPaymentService')
const directModel = require('../src/services/stripeClearing/stripeDirectPaymentModel')
const { GROUP_STATUS, PAYOUT_STATUS } = require('../src/services/stripeClearing/stripePayoutClearingModel')

const config = getStripeClearingConfig()
const WEB = config.websiteZohoCustomerId
const SHOP = config.shopZohoCustomerId
const OTHER = '4265011000099999999'

const PAYOUT = 'po_1UDDZ3DJogiiRoKPj4uB4mEL'
const PI = 'pi_3UB7cxDJogiiRoKP2ddNSqC5'
const CH = 'ch_3UB7cxDJogiiRoKP2kd1Ng0X'
const INV = { invoiceId: 'ZID-INV-043544', invoiceNumber: 'INV-043544', referenceNumber: '20901', customerId: WEB, status: 'sent', total: 1261, balance: 1261, currencyCode: 'AED', date: '2026-09-02' }
const ACTOR = 'user:7'
const REASON = 'Payment Link Matjar meem #20901 for invoice INV-043544'

const A1019 = '4265011000000984169'
const A1013 = '4265011000000699653'
const ACCOUNTS = [
  { accountId: A1019, accountName: 'Stripe Undeposited Funds', accountCode: '1019', accountType: 'cash', isActive: true },
  { accountId: A1013, accountName: 'Stripe Processing Chg Un-Cleared', accountCode: '1013', accountType: 'cash', isActive: true },
  { accountId: config.advanceAccountId, accountName: 'Customer Advance Funds', accountCode: '1123', accountType: 'other_current_liability', isActive: true },
  { accountId: config.feeExpenseAccountId, accountName: 'Stripe Fees', accountCode: '2270', accountType: 'expense', isActive: true },
]

const WEBSITE_CHARGES = [
  { chargeId: 'ch_3UB9aaDJogiiRoKP1website01', paymentIntentId: 'pi_3UB9aaDJogiiRoKP1website01', orderNumber: '20905', invoiceNumber: 'INV-043551', gross: 60000, fee: 1890 },
  { chargeId: 'ch_3UBBbbDJogiiRoKP1website02', paymentIntentId: 'pi_3UBBbbDJogiiRoKP1website02', orderNumber: '20908', invoiceNumber: 'INV-043556', gross: 37070, fee: 1125 },
]
const DIRECT_CHARGE = { chargeId: CH, paymentIntentId: PI, gross: 126100, fee: 5018 }

const PAYMENT_LINK_EVIDENCE = {
  paymentIntentId: PI,
  chargeId: CH,
  status: 'succeeded',
  currency: 'AED',
  amountReceivedMinor: 126100,
  refundedMinor: 0,
  disputed: false,
  description: null,
  chargeDescription: null,
  metadata: {},
  createdAt: '2026-09-02T10:14:00.000Z',
  sessions: [{
    checkoutSessionId: 'cs_live_20901',
    paymentLinkId: 'plink_20901',
    clientReferenceId: null,
    metadata: {},
    products: [{ productName: 'Matjar meem #20901', productDescription: 'invoice #20901', lineDescription: 'Matjar meem #20901', amountMinor: 126100, quantity: 1 }],
  }],
}

function memoryDirectStore(initial = []) {
  const rows = initial.map((m, i) => ({ id: i + 1, status: 'ACTIVE', mappingType: 'DIRECT_PAYMENT', ...m }))
  const components = []
  const store = {
    rows,
    components,
    listActiveByIntents: async (_db, ids) => rows.filter((m) => m.status === 'ACTIVE' && ids.includes(m.paymentIntentId)),
    getActiveByInvoice: async (_db, id) => rows.find((m) => m.status === 'ACTIVE' && m.zohoInvoiceId === id) || null,
    listHistoryByIntent: async (_db, pi) => rows.filter((m) => m.paymentIntentId === pi).reverse(),
    listComponentsAllocating: async (_db, { zohoInvoiceId, paymentIntentId }) => components
      .filter((c) => (c.allocations || []).some((a) => (zohoInvoiceId && a.invoiceId === zohoInvoiceId) || (paymentIntentId && a.paymentIntentId === paymentIntentId))),
    insertMapping: async (_db, m) => {
      if (rows.some((r) => r.status === 'ACTIVE' && (r.paymentIntentId === m.paymentIntentId || r.zohoInvoiceId === m.zohoInvoiceId || (m.chargeId && r.chargeId === m.chargeId)))) {
        const err = new Error('exists')
        err.status = 409
        err.code = 'DIRECT_MAPPING_EXISTS'
        throw err
      }
      const row = { ...m, id: rows.length + 1, status: 'ACTIVE', mappingType: m.mappingType || 'DIRECT_PAYMENT', mappedAt: '2026-09-29T09:00:00.000Z' }
      rows.push(row)
      return row
    },
    releaseMapping: async (_db, id, { actor, reason }) => {
      const row = rows.find((r) => r.id === id && r.status === 'ACTIVE')
      if (!row || components.some((c) => c.payoutId === row.payoutId && c.zohoCustomerId === row.zohoCustomerId)) {
        const err = new Error('locked')
        err.status = 409
        err.code = 'DIRECT_MAPPING_LOCKED'
        throw err
      }
      Object.assign(row, { status: 'RELEASED', releasedBy: actor, releaseReason: reason })
      return row
    },
  }
  return store
}

/**
 * The payout with fake Stripe / website / Zoho readers. Every write method records the attempt
 * and throws; the direct-mapping store is in memory.
 */
function world(opts = {}) {
  const website = WEBSITE_CHARGES.map((c) => ({ ...c, ...((opts.website && opts.website[c.orderNumber]) || {}) }))
  const directCharge = { ...DIRECT_CHARGE, ...(opts.directCharge || {}) }
  const chargeRows = [...website.map((c) => ({ ...c })), directCharge]
  const txns = chargeRows.map((c) => ({
    balanceTransactionId: `txn_${c.chargeId.slice(3)}`,
    type: 'charge',
    reportingCategory: 'charge',
    currency: 'AED',
    exchangeRate: null,
    amountMinor: c.gross,
    feeMinor: c.fee,
    netMinor: c.gross - c.fee,
    chargeId: c.chargeId,
    paymentIntentId: c.paymentIntentId,
    chargeRefundedMinor: c.refundedMinor || 0,
    chargeDisputed: c.disputed === true,
    chargeStatus: 'succeeded',
    chargeFullyRefunded: false,
    createdAt: c === directCharge ? '2026-09-02T10:14:00.000Z' : '2026-09-06T08:00:00.000Z',
  }))
  const payoutAmount = txns.reduce((s, t) => s + t.netMinor, 0)
  txns.push({ balanceTransactionId: 'txn_PAYOUT_1UDDZ3', type: 'payout', currency: 'AED', amountMinor: -payoutAmount, feeMinor: 0, netMinor: -payoutAmount })

  const orders = website.map((c, i) => ({
    orderId: String(20000 + i), orderNumber: c.orderNumber, orderStatus: 'delivered', paymentStatus: 'completed', paymentMethod: 'stripe',
    stripePaymentIntentId: c.paymentIntentId, shopOrder: false, finalAmount: c.gross / 100, refundAmount: 0, walletRedeemed: 0, deleted: false, sameNumberCount: 0,
  }))
  orders.push(...(opts.extraOrders || []))

  const invoices = website.map((c) => ({
    invoiceId: `ZID-${c.invoiceNumber}`, invoiceNumber: c.invoiceNumber, referenceNumber: c.orderNumber, customerId: WEB,
    status: 'sent', total: c.gross / 100, balance: c.gross / 100, currencyCode: 'AED', date: '2026-09-06',
  }))
  invoices.push({ ...INV, ...(opts.invoice || {}) })
  invoices.push(...(opts.extraInvoices || []))

  const writes = []
  const deny = (name) => async () => { writes.push(name); throw new Error(`${name} attempted`) }
  const stripeReads = []
  const store = opts.store || memoryDirectStore(opts.mappings || [])
  const components = opts.components || []
  store.components.push(...components)
  const evidence = opts.evidence === undefined ? PAYMENT_LINK_EVIDENCE : opts.evidence

  const sources = {
    retrieveStripePayout: async (id) => (id === PAYOUT ? { payoutId: PAYOUT, status: 'paid', amountMinor: payoutAmount, currency: 'AED', arrivalDate: '2026-09-09T00:00:00.000Z', createdAt: '2026-09-08T01:11:09.000Z' } : null),
    listPayoutBalanceTransactions: async () => txns,
    listChargeRefunds: async (chargeId) => (opts.refunds || []).filter((r) => r.chargeId === chargeId),
    getPaymentIntentEvidence: async (pi) => {
      stripeReads.push(pi)
      if (pi !== PI || !evidence) throw new Error(`no evidence for ${pi}`)
      return evidence
    },
    loadWebsiteOrdersByIntents: async (ids) => orders.filter((o) => ids.includes(o.stripePaymentIntentId)),
    loadWebsiteOrdersByNumbers: async (numbers) => orders.filter((o) => numbers.includes(o.orderNumber)),
    findZohoInvoicesByReference: async (ref) => invoices.filter((i) => i.referenceNumber === ref),
    searchZohoInvoices: async (q) => invoices.filter((i) => (q.invoiceNumber ? i.invoiceNumber === q.invoiceNumber : q.reference ? i.referenceNumber === q.reference : Math.round(i.total * 100) === Math.round(q.amount * 100))
      && (!q.customerId || i.customerId === q.customerId)),
    getZohoInvoiceDetail: async (id) => {
      const inv = invoices.find((i) => i.invoiceId === id)
      return inv ? { ...inv, lineItems: [] } : null
    },
    findZohoPaymentsByReference: async (ref) => (opts.zohoPayments || []).filter((p) => p.referenceNumber === ref),
    findZohoJournalsByReference: async () => [],
    getZohoJournal: async () => null,
    listZohoJournalsInRange: async () => [],
    createStripeRefund: deny('createStripeRefund'),
  }
  const zohoPayments = {
    listZohoChartAccounts: async () => ACCOUNTS,
    getZohoCustomerPayment: async () => null,
    createZohoCustomerPayment: deny('createZohoCustomerPayment'),
    createZohoJournal: deny('createZohoJournal'),
    createZohoManualJournal: deny('createZohoManualJournal'),
  }
  const records = {
    loadAdvanceCases: async () => [],
    loadComponents: async (payoutId) => components.filter((c) => c.payoutId === payoutId),
    loadCaseEvents: async () => [],
    loadDirectMappings: (ids) => store.listActiveByIntents(null, ids),
  }
  const run = () => previewPayout(PAYOUT, { config, sources, zohoPayments, records })
  let locks = 0
  const serviceDeps = {
    config,
    sources,
    store,
    clearingStore: { getByIntent: async (_db, pi) => (opts.localClearing && opts.localClearing.paymentIntentId === pi ? opts.localClearing : null) },
    reader: {},
    acquireLock: async () => { locks += 1; return { db: {}, release: async () => {} } },
    previewPayout: () => run(),
  }
  return { run, store, writes, stripeReads, serviceDeps, locks: () => locks }
}

function mapped(patch = {}) {
  return {
    paymentIntentId: PI, chargeId: CH, zohoInvoiceId: INV.invoiceId, zohoInvoiceNumber: INV.invoiceNumber, zohoCustomerId: WEB, customerKey: 'WEBSITE',
    payoutId: PAYOUT, currency: 'AED', stripeGross: 1261, invoiceReference: '20901', evidence: 'Payment Link product "Matjar meem #20901"', reason: REASON,
    mappedBy: ACTOR, mappedAt: '2026-09-29T09:00:00.000Z', ...patch,
  }
}

function websiteGroup(result) {
  return result.groups.find((g) => g.customerId === WEB)
}

const confirm = (w, extra = {}) => direct.confirmDirectPayment(PAYOUT, PI, { invoiceId: INV.invoiceId, reason: REASON, actor: ACTOR, ...extra }, w.serviceDeps)

// ── 1 / 3 / 11-current: the real case ──────────────────────────────────────

test('before mapping: the Payment Link charge is unresolved and blocks the payout (NEEDS_REVIEW)', async () => {
  const r = await world().run()
  assert.equal(r.status, PAYOUT_STATUS.NEEDS_REVIEW)
  assert.equal(r.unassigned.length, 1)
  const u = r.unassigned[0]
  assert.equal(u.paymentIntentId, PI)
  assert.equal(u.chargeId, CH)
  assert.deepEqual([u.gross, u.fee, u.net], [1261, 50.18, 1210.82])
  assert.equal(u.directEligible, true)
  assert.match(r.blockers[0], /could not be assigned.*Assign to Zoho Invoice/)
  assert.equal(r.reconciliation.payoutMatches, false)
})

test('PO suggestion: "invoice #20901" on the Payment Link suggests INV-043544, but nothing is mapped', async () => {
  const w = world()
  const u = (await w.run()).unassigned[0]
  assert.deepEqual(u.references.map((x) => [x.kind, x.value]), [['reference', '20901']])
  assert.deepEqual(u.references[0].sources.map((s) => s.text), ['Matjar meem #20901', 'invoice #20901'])
  assert.equal(u.suggestion.status, directModel.SUGGESTION.SUGGESTED)
  assert.equal(u.suggestion.invoiceId, INV.invoiceId)
  assert.equal(w.store.rows.length, 0)
})

test('validation shows the invoice, every check passing and the PO evidence 20901 ↔ P.O.# 20901', async () => {
  const w = world()
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.equal(v.blocking, false)
  assert.equal(v.evidenceStatus, directModel.EVIDENCE.MATCH)
  assert.equal(v.requiresTypedInvoiceNumber, false)
  assert.match(v.evidenceSummary, /Matjar meem #20901.*INV-043544 P\.O\.# 20901/)
  assert.deepEqual(
    { number: v.invoice.invoiceNumber, customer: v.invoice.customerName, date: v.invoice.date, po: v.invoice.referenceNumber, total: v.invoice.total, balance: v.invoice.balance, status: v.invoice.status },
    { number: 'INV-043544', customer: config.websiteCustomerName, date: '2026-09-02', po: '20901', total: 1261, balance: 1261, status: 'sent' },
  )
  assert.ok(v.checks.every((c) => c.ok), JSON.stringify(v.checks.filter((c) => !c.ok)))
  assert.equal(w.store.rows.length, 0)
})

test('direct Payment Link mapped to a Website invoice: confirmed under the payout lock, stored once, zero writes', async () => {
  const w = world()
  const out = await confirm(w)
  assert.equal(out.zohoWrites, 0)
  assert.equal(out.stripeWrites, 0)
  assert.equal(w.locks(), 1)
  assert.equal(w.store.rows.length, 1)
  const m = w.store.rows[0]
  assert.deepEqual(
    [m.paymentIntentId, m.chargeId, m.zohoInvoiceId, m.zohoInvoiceNumber, m.zohoCustomerId, m.customerKey, m.payoutId, m.invoiceReference, m.mappedBy],
    [PI, CH, INV.invoiceId, 'INV-043544', WEB, 'WEBSITE', PAYOUT, '20901', ACTOR],
  )
  assert.match(m.evidence, /20901/)
  assert.deepEqual(w.writes, [])
})

test('exact current case after mapping: Website group 2231.70 / NET 2151.37 / FEE 80.33, no advance, payout reconciles', async () => {
  const r = await world({ mappings: [mapped()] }).run()
  assert.deepEqual(r.unassigned, [])
  assert.deepEqual(r.blockers, [])
  const g = websiteGroup(r)
  assert.equal(g.status, GROUP_STATUS.READY)
  assert.equal(g.postable, true)
  assert.equal(g.chargeCount, 3)
  assert.equal(g.invoiceCount, 3)
  assert.deepEqual(g.totals, { invoiceGross: 2231.7, netTo1019: 2151.37, customerAdvance: 0, total1019: 2151.37, feeTo1013: 80.33, stripeGross: 2231.7 })
  assert.ok(Object.values(g.checks).every(Boolean))
  assert.equal(r.reconciliation.netTo1019, 2151.37)
  assert.equal(r.reconciliation.payoutAmount, 2151.37)
  assert.equal(r.reconciliation.total1019PlusFees, 2231.7)
  assert.equal(r.reconciliation.payoutMatches, true)
  assert.equal(r.reconciliation.grossMatches, true)
  assert.notEqual(r.status, PAYOUT_STATUS.NEEDS_REVIEW)
})

test('the direct line is labelled DIRECT STRIPE PAYMENT with its invoice, PO and admin, and allocates 1261 / 1210.82 / 50.18', async () => {
  const r = await world({ mappings: [mapped()] }).run()
  const g = websiteGroup(r)
  const line = g.lines.find((l) => l.paymentIntentId === PI)
  assert.equal(line.source, directModel.SOURCE.DIRECT_STRIPE_PAYMENT)
  assert.equal(line.website, null)
  assert.equal(line.state, LINE_STATE.OPEN)
  assert.deepEqual([line.direct.invoiceNumber, line.direct.invoiceReference, line.direct.mappedBy, line.invoice.referenceNumber], ['INV-043544', '20901', ACTOR, '20901'])
  assert.deepEqual([line.invoiceTotal, line.netAllocation, line.feeAllocation, line.customerAdvance], [1261, 1210.82, 50.18, 0])
  for (const l of g.lines.filter((x) => x.paymentIntentId !== PI)) assert.equal(l.source, directModel.SOURCE.WEBSITE_ORDER)
})

test('mapped direct payment joins the normal grouped Website NET and FEE customer payments (no separate payment)', async () => {
  const g = websiteGroup(await world({ mappings: [mapped()] }).run())
  assert.deepEqual(g.components.map((c) => c.component), ['NET', 'FEE'])
  const net = g.components.find((c) => c.component === 'NET')
  const fee = g.components.find((c) => c.component === 'FEE')
  assert.equal(net.amount, 2151.37)
  assert.equal(fee.amount, 80.33)
  assert.equal(net.account.accountCode, '1019')
  assert.equal(fee.account.accountCode, '1013')
  assert.deepEqual(net.allocations.map((a) => [a.invoiceNumber, a.amount]), [['INV-043551', 581.1], ['INV-043556', 359.45], ['INV-043544', 1210.82]])
  assert.deepEqual(fee.allocations.map((a) => [a.invoiceNumber, a.amount]), [['INV-043551', 18.9], ['INV-043556', 11.25], ['INV-043544', 50.18]])
  assert.equal(net.allocations[2].source, directModel.SOURCE.DIRECT_STRIPE_PAYMENT)
  assert.deepEqual(net.payload.invoices.map((i) => [i.invoice_id, i.amount_applied]), [['ZID-INV-043551', 581.1], ['ZID-INV-043556', 359.45], ['ZID-INV-043544', 1210.82]])
  assert.equal(net.payload.notes, undefined)
})

test('fee is part of the one payout fee journal 80.33 (Dr 2270 / Cr 1013); no journal just for the Payment Link', async () => {
  const r = await world({ mappings: [mapped()] }).run()
  assert.equal(r.feeJournal.amount, 80.33)
  assert.equal(r.feeJournal.reference, `Stripe processing fees ${PAYOUT}`)
  const accounts = [r.feeJournal.debitAccount && r.feeJournal.debitAccount.accountCode, r.feeJournal.creditAccount && r.feeJournal.creditAccount.accountCode]
  assert.deepEqual(accounts, ['2270', '1013'])
  const journals = r.groups.flatMap((g) => g.components).filter((c) => c.zohoRecordType === 'journal')
  assert.deepEqual(journals, [])
})

// ── 2: Burjman ─────────────────────────────────────────────────────────────

test('direct payment mapped to a Burjman invoice: customer comes from the invoice and joins the Burjman group', async () => {
  const w = world({ invoice: { customerId: SHOP } })
  const out = await confirm(w)
  assert.equal(out.mapping.customerKey, 'SHOP')
  assert.equal(out.mapping.zohoCustomerId, SHOP)
  const r = await w.run()
  const shop = r.groups.find((g) => g.customerId === SHOP)
  assert.equal(shop.customerName, config.shopCustomerName)
  assert.deepEqual(shop.lines.map((l) => l.source), [directModel.SOURCE.DIRECT_STRIPE_PAYMENT])
  assert.deepEqual(shop.totals, { invoiceGross: 1261, netTo1019: 1210.82, customerAdvance: 0, total1019: 1210.82, feeTo1013: 50.18, stripeGross: 1261 })
  assert.equal(websiteGroup(r).chargeCount, 2)
  assert.equal(r.reconciliation.payoutMatches, true)
})

// ── 5: amount alone is not enough ──────────────────────────────────────────

test('amount-only match: no Stripe reference means no suggestion and the admin must re-type the invoice number', async () => {
  const bare = { ...PAYMENT_LINK_EVIDENCE, sessions: [{ ...PAYMENT_LINK_EVIDENCE.sessions[0], products: [{ productName: 'Matjar meem', productDescription: null, amountMinor: 126100, quantity: 1 }] }] }
  const w = world({ evidence: bare })
  const u = (await w.run()).unassigned[0]
  assert.equal(u.suggestion.status, directModel.SUGGESTION.NONE)
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.equal(v.evidenceStatus, directModel.EVIDENCE.NONE)
  assert.equal(v.requiresTypedInvoiceNumber, true)
  await assert.rejects(confirm(w), { code: 'EVIDENCE_REQUIRED' })
  await assert.rejects(confirm(w, { confirmInvoiceNumber: 'INV-043545' }), { code: 'EVIDENCE_REQUIRED' })
  assert.equal(w.store.rows.length, 0)
  await confirm(w, { confirmInvoiceNumber: 'inv-043544' })
  assert.match(w.store.rows[0].evidence, /re-typed by the admin/)
})

// ── Checkout Session evidence is optional (restricted key without checkout_session_read) ──

function stripePermissionError() {
  const err = new Error("Permission denied. The provided key 'rk_live_...XXXX' does not have the required permissions for this endpoint. Enabling Checkout Sessions Read ('checkout_session_read') permissions on this key would allow this request to continue. You can edit permissions at https://dashboard.stripe.com/apikeys")
  err.type = 'StripePermissionError'
  err.code = 'more_permissions_required'
  err.statusCode = 403
  return err
}

/** The real evidence reader against a Stripe client whose key cannot read Checkout Sessions. */
async function evidenceWithoutCheckoutPermission(chargePatch = {}) {
  const stripeConfig = require('../src/config/stripe')
  const sources = require('../src/services/stripeClearing/stripeClearingSources')
  const calls = []
  const client = {
    paymentIntents: {
      retrieve: async (id, opts) => {
        calls.push(['paymentIntents.retrieve', id, opts])
        return {
          id, status: 'succeeded', currency: 'aed', amount_received: 126100, created: 1788330391, description: null, metadata: {},
          latest_charge: { id: CH, description: null, metadata: {}, calculated_statement_descriptor: 'WWW.LIFESMILE.AE', amount_refunded: 0, disputed: false, created: 1788330392, ...chargePatch },
        }
      },
    },
    checkout: {
      sessions: {
        list: async () => { calls.push(['checkout.sessions.list']); throw stripePermissionError() },
        listLineItems: async () => { calls.push(['checkout.sessions.listLineItems']); throw stripePermissionError() },
      },
    },
  }
  const original = stripeConfig.getStripeClient
  stripeConfig.getStripeClient = () => client
  try {
    return { evidence: await sources.getPaymentIntentEvidence(PI), calls }
  } finally {
    stripeConfig.getStripeClient = original
  }
}

test('Checkout Session permission denied: the PaymentIntent and charge are still read and session evidence is marked unavailable', async () => {
  const { evidence, calls } = await evidenceWithoutCheckoutPermission()
  assert.equal(evidence.checkoutEvidence, 'UNAVAILABLE_PERMISSION')
  assert.deepEqual(evidence.sessions, [])
  assert.deepEqual(
    [evidence.paymentIntentId, evidence.chargeId, evidence.status, evidence.currency, evidence.amountReceivedMinor, evidence.refundedMinor, evidence.disputed],
    [PI, CH, 'succeeded', 'AED', 126100, 0, false],
  )
  assert.equal(JSON.stringify(evidence).includes('rk_live'), false)
  assert.deepEqual(calls.map((c) => c[0]), ['paymentIntents.retrieve', 'checkout.sessions.list'])
})

test('real case with Checkout Session permission denied: nothing blocks, the admin re-types INV-043544, reason and mapping succeed', async () => {
  const { evidence } = await evidenceWithoutCheckoutPermission()
  const w = world({ evidence })
  const r = await w.run()
  const u = r.unassigned[0]
  assert.equal(u.directEligible, true)
  assert.equal(u.evidenceError, null)
  assert.equal(u.stripeEvidence.checkoutEvidence, 'UNAVAILABLE_PERMISSION')
  assert.equal(u.suggestion.status, directModel.SUGGESTION.NONE)
  assert.equal(JSON.stringify(r).includes('rk_live'), false)

  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.equal(v.blocking, false, JSON.stringify(v.checks.filter((c) => c.blocking)))
  assert.equal(v.checkoutEvidence, 'UNAVAILABLE_PERMISSION')
  assert.equal(v.evidenceStatus, directModel.EVIDENCE.NONE)
  assert.equal(v.requiresTypedInvoiceNumber, true)
  assert.ok(v.checks.find((c) => c.key === 'stripe_payment').ok)
  assert.deepEqual([v.invoice.invoiceNumber, v.invoice.customerName, v.invoice.total, v.invoice.balance, v.invoice.referenceNumber], ['INV-043544', 'Website', 1261, 1261, '20901'])

  const res = await confirm(w, { confirmInvoiceNumber: 'INV-043544' })
  assert.deepEqual([res.zohoWrites, res.stripeWrites], [0, 0])
  assert.equal(w.store.rows.length, 1)
  assert.deepEqual([w.store.rows[0].zohoInvoiceNumber, w.store.rows[0].customerKey, w.store.rows[0].stripeGross, w.store.rows[0].chargeId], ['INV-043544', 'WEBSITE', 1261, CH])
  assert.match(w.store.rows[0].evidence, /Payment Link evidence unavailable/)
  assert.deepEqual(w.writes, [])
  const after = await w.run()
  assert.equal(websiteGroup(after).status, GROUP_STATUS.READY)
  assert.equal(after.unassigned.length, 0)
})

test('Checkout evidence unavailable and no manual confirmation: blocked', async () => {
  const { evidence } = await evidenceWithoutCheckoutPermission()
  const w = world({ evidence })
  await assert.rejects(confirm(w), { code: 'EVIDENCE_REQUIRED' })
  await assert.rejects(confirm(w, { confirmInvoiceNumber: 'INV-043544', reason: 'short' }), { code: 'REASON_REQUIRED' })
  await assert.rejects(direct.confirmDirectPayment(PAYOUT, PI, { invoiceId: INV.invoiceId, reason: REASON, confirmInvoiceNumber: 'INV-043544' }, w.serviceDeps), { code: 'ACTOR_REQUIRED' })
  assert.equal(w.store.rows.length, 0)
})

test('Checkout evidence unavailable and a wrong invoice re-type: blocked', async () => {
  const { evidence } = await evidenceWithoutCheckoutPermission()
  const w = world({ evidence })
  await assert.rejects(confirm(w, { confirmInvoiceNumber: 'INV-043545' }), { code: 'EVIDENCE_REQUIRED' })
  await assert.rejects(confirm(w, { confirmInvoiceNumber: '20901' }), { code: 'EVIDENCE_REQUIRED' })
  assert.equal(w.store.rows.length, 0)
})

test('Checkout evidence unavailable does not relax the mandatory Stripe facts (refunded, disputed, other charge)', async () => {
  for (const [patch, key] of [[{ amount_refunded: 10000 }, 'charge_state'], [{ disputed: true }, 'charge_state'], [{ id: 'ch_3OTHERxxxxxxxxxxxxxx' }, 'stripe_payment']]) {
    const { evidence } = await evidenceWithoutCheckoutPermission(patch)
    const w = world({ evidence })
    const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
    assert.equal(v.blocking, true)
    assert.equal(v.checks.find((c) => c.key === key).blocking, true, key)
    await assert.rejects(confirm(w, { confirmInvoiceNumber: 'INV-043544' }), { code: 'DIRECT_MAPPING_BLOCKED' })
    assert.equal(w.store.rows.length, 0)
  }
})

test('an unreadable PaymentIntent (mandatory) blocks validation with a plain message', async () => {
  const w = world({ evidence: null })
  const u = (await w.run()).unassigned[0]
  assert.equal(u.evidenceError, 'Stripe/Zoho evidence could not be read. Manual verification is required.')
  await assert.rejects(direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps), { code: 'STRIPE_PAYMENT_UNREADABLE' })
  await assert.rejects(confirm(w, { confirmInvoiceNumber: 'INV-043544' }), { code: 'STRIPE_PAYMENT_UNREADABLE' })
  assert.equal(w.store.rows.length, 0)
})

test('a Stripe reference naming another PO contradicts the invoice and blocks the mapping', async () => {
  const other = { ...PAYMENT_LINK_EVIDENCE, sessions: [{ ...PAYMENT_LINK_EVIDENCE.sessions[0], products: [{ productName: 'Matjar meem #20977', productDescription: 'invoice #20977', amountMinor: 126100, quantity: 1 }] }] }
  const w = world({ evidence: other })
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.equal(v.evidenceStatus, directModel.EVIDENCE.CONFLICT)
  assert.equal(v.blocking, true)
  await assert.rejects(confirm(w), { code: 'DIRECT_MAPPING_BLOCKED' })
})

// ── 6 / 7: duplicates ──────────────────────────────────────────────────────

test('duplicate PaymentIntent mapping is blocked: once mapped the charge is no longer unassigned', async () => {
  const w = world()
  await confirm(w)
  await assert.rejects(confirm(w), { code: 'CHARGE_ALREADY_ASSIGNED' })
  await assert.rejects(w.store.insertMapping(null, mapped({ zohoInvoiceId: 'ZID-OTHER', zohoInvoiceNumber: 'INV-1' })), { code: 'DIRECT_MAPPING_EXISTS' })
  assert.equal(w.store.rows.length, 1)
})

test('an invoice already mapped to another PaymentIntent cannot be mapped again', async () => {
  const w = world({ mappings: [mapped({ paymentIntentId: 'pi_3OTHERDJogiiRoKP2ddNSqC5', chargeId: 'ch_3OTHERDJogiiRoKP2kd1Ng0X', payoutId: 'po_1OTHERDJogiiRoKPj4uB4mEL' })] })
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.equal(v.checks.find((c) => c.key === 'no_invoice_mapping').ok, false)
  await assert.rejects(confirm(w), { code: 'DIRECT_MAPPING_BLOCKED' })
})

test('same charge cannot clear both as a website order and a direct mapping', async () => {
  const order = { orderId: '99', orderNumber: '20901', orderStatus: 'delivered', paymentStatus: 'completed', stripePaymentIntentId: PI, shopOrder: false, finalAmount: 1261, refundAmount: 0, walletRedeemed: 0, deleted: false, sameNumberCount: 0 }
  const r = await world({ mappings: [mapped()], extraOrders: [order] }).run()
  const line = r.groups.flatMap((g) => g.lines).concat(r.unassigned).find((l) => l.paymentIntentId === PI)
  assert.equal(line.state, LINE_STATE.NEEDS_REVIEW)
  assert.match(line.reason, /both claim this PaymentIntent/)
  assert.equal(websiteGroup(r).postable, false)
})

test('a website order paid through another PaymentIntent for the same P.O.# blocks the mapping', async () => {
  const order = { orderId: '98', orderNumber: '20901', orderStatus: 'delivered', paymentStatus: 'completed', stripePaymentIntentId: 'pi_3ELSEDJogiiRoKP2ddNSqC5', shopOrder: false, finalAmount: 1261, refundAmount: 0, walletRedeemed: 0, deleted: false, sameNumberCount: 0 }
  const w = world({ extraOrders: [order] })
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.equal(v.checks.find((c) => c.key === 'no_competing_order').ok, false)
  await assert.rejects(confirm(w), { code: 'DIRECT_MAPPING_BLOCKED' })
})

test('an invoice already cleared by a website charge in the same payout cannot also take the direct payment', async () => {
  const r = await world({ mappings: [mapped({ zohoInvoiceId: 'ZID-INV-043551', zohoInvoiceNumber: 'INV-043551' })], extraInvoices: [] ,
    website: { 20905: { gross: 126100 } } }).run()
  const claimed = websiteGroup(r).lines.filter((l) => l.invoice && l.invoice.invoiceId === 'ZID-INV-043551')
  assert.ok(claimed.length >= 1)
  assert.ok(claimed.every((l) => l.state === LINE_STATE.NEEDS_REVIEW))
})

test('a charge or invoice already allocated by payout accounting elsewhere cannot be mapped', async () => {
  const w = world({ components: [{ id: 5, payoutId: 'po_1EARLIERJogiiRoKPj4uB4mEL', zohoCustomerId: WEB, component: 'NET', status: 'VERIFIED', allocations: [{ invoiceId: INV.invoiceId, amount: 1210.82 }] }] })
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.equal(v.checks.find((c) => c.key === 'not_allocated').ok, false)
  await assert.rejects(confirm(w), { code: 'DIRECT_MAPPING_BLOCKED' })
})

test('an existing Zoho payment or earlier clearing for the PaymentIntent blocks the mapping', async () => {
  const w1 = world({ zohoPayments: [{ paymentId: 'ZP1', referenceNumber: PI, amount: 1261 }] })
  assert.equal((await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w1.serviceDeps)).checks.find((c) => c.key === 'no_zoho_payment').ok, false)
  const w2 = world({ localClearing: { paymentIntentId: PI, status: 'POSTED' } })
  await assert.rejects(confirm(w2), { code: 'DIRECT_MAPPING_BLOCKED' })
})

// ── 8 / 9 / 10: invoice checks ─────────────────────────────────────────────

test('unsupported Zoho customer is blocked', async () => {
  const w = world({ invoice: { customerId: OTHER } })
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.equal(v.checks.find((c) => c.key === 'customer_supported').ok, false)
  await assert.rejects(confirm(w), { code: 'DIRECT_MAPPING_BLOCKED' })
  const search = await direct.searchInvoices({ q: 'INV-043544' }, w.serviceDeps)
  assert.equal(search.invoices[0].selectable, false)
  assert.match(search.invoices[0].notSelectableReasons.join(' '), /not a Stripe-clearing customer/)
})

test('an invoice that is already fully paid is blocked', async () => {
  const w = world({ invoice: { balance: 0, status: 'paid' } })
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.match(v.checks.find((c) => c.key === 'balance').detail, /already fully paid/)
  await assert.rejects(confirm(w), { code: 'DIRECT_MAPPING_BLOCKED' })
})

test('a partly paid invoice is blocked', async () => {
  const w = world({ invoice: { balance: 261, status: 'partially_paid' } })
  await assert.rejects(confirm(w), { code: 'DIRECT_MAPPING_BLOCKED' })
})

test('invoice amount mismatch (AED 1261 charge to a 1300 invoice) is blocked for explicit review', async () => {
  const w = world({ invoice: { total: 1300, balance: 1300 } })
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.match(v.checks.find((c) => c.key === 'amount').detail, /1261 ≠ invoice 1300/)
  await assert.rejects(confirm(w), { code: 'DIRECT_MAPPING_BLOCKED' })
})

test('a stored mapping no longer matching the live invoice sends the line to review', async () => {
  const r = await world({ mappings: [mapped()], invoice: { total: 1300, balance: 1300 } }).run()
  const line = r.groups.flatMap((g) => g.lines).find((l) => l.paymentIntentId === PI)
  assert.equal(line.state, LINE_STATE.NEEDS_REVIEW)
  assert.equal(websiteGroup(r).postable, false)
})

// ── 11: several candidates ─────────────────────────────────────────────────

test('multiple candidate invoices for the Stripe reference -> NEEDS_REVIEW, no suggestion', async () => {
  const twin = { ...INV, invoiceId: 'ZID-INV-043599', invoiceNumber: 'INV-043599' }
  const u = (await world({ extraInvoices: [twin] }).run()).unassigned[0]
  assert.equal(u.suggestion.status, directModel.SUGGESTION.NEEDS_REVIEW)
  assert.equal(u.suggestion.invoiceId, undefined)
  assert.deepEqual(u.suggestion.candidates.map((c) => c.invoiceNumber).sort(), ['INV-043544', 'INV-043599'])
})

// ── search ─────────────────────────────────────────────────────────────────

test('search by invoice number, P.O.# and amount finds INV-043544', async () => {
  const w = world()
  for (const [q, by, mode] of [['INV-043544', 'auto', 'invoice'], ['20901', 'auto', 'reference'], ['1261.00', 'auto', 'amount'], ['1261', 'amount', 'amount']]) {
    const out = await direct.searchInvoices({ q, by, customer: 'website' }, w.serviceDeps)
    assert.equal(out.mode, mode)
    assert.deepEqual(out.invoices.map((i) => [i.invoiceNumber, i.referenceNumber, i.customerName, i.selectable]), [['INV-043544', '20901', config.websiteCustomerName, true]], `${q} ${by}`)
  }
  assert.equal((await direct.searchInvoices({ q: '20901', customer: 'shop' }, w.serviceDeps)).invoices.length, 0)
})

// ── 17: frozen after accounting ────────────────────────────────────────────

test('a mapping can be released before any accounting exists', async () => {
  const w = world({ mappings: [mapped()] })
  const line = websiteGroup(await w.run()).lines.find((l) => l.paymentIntentId === PI)
  assert.equal(line.direct.removable, true)
  const out = await direct.releaseDirectPayment(PAYOUT, PI, { actor: ACTOR, reason: 'Mapped to the wrong invoice by mistake' }, w.serviceDeps)
  assert.equal(out.mapping.status, 'RELEASED')
  assert.equal(out.zohoWrites, 0)
  assert.equal((await w.run()).unassigned.length, 1)
})

test('mapping change is blocked once accounting for the payout customer exists', async () => {
  const w = world({
    mappings: [mapped()],
    components: [{ id: 1, payoutId: PAYOUT, zohoCustomerId: WEB, component: 'NET', status: 'VERIFIED', zohoRecordId: 'ZP9', allocations: [] }],
  })
  const line = websiteGroup(await w.run()).lines.find((l) => l.paymentIntentId === PI)
  assert.equal(line.direct.removable, false)
  assert.match(line.direct.lockedReason, /NET VERIFIED/)
  await assert.rejects(direct.releaseDirectPayment(PAYOUT, PI, { actor: ACTOR, reason: 'Trying to change it after posting' }, w.serviceDeps), { code: 'DIRECT_MAPPING_LOCKED' })
  assert.equal(w.store.rows[0].status, 'ACTIVE')
})

// ── 18: no writes ──────────────────────────────────────────────────────────

test('search, validation, mapping and release make no Zoho or Stripe writes and never load posting', async () => {
  const w = world()
  await direct.searchInvoices({ q: '20901' }, w.serviceDeps)
  await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  await confirm(w)
  await w.run()
  await direct.releaseDirectPayment(PAYOUT, PI, { actor: ACTOR, reason: 'Release in the no-writes test' }, w.serviceDeps)
  assert.deepEqual(w.writes, [])
  const loaded = Object.keys(require.cache).filter((p) => /stripeClearing\/stripePayoutPostingService|stripePayoutZohoWriter/.test(p))
  assert.deepEqual(loaded, [])
})

test('confirmation needs an admin and a reason', async () => {
  const w = world()
  await assert.rejects(direct.confirmDirectPayment(PAYOUT, PI, { invoiceId: INV.invoiceId, reason: REASON }, w.serviceDeps), { code: 'ACTOR_REQUIRED' })
  await assert.rejects(direct.confirmDirectPayment(PAYOUT, PI, { invoiceId: INV.invoiceId, reason: 'short', actor: ACTOR }, w.serviceDeps), { code: 'REASON_REQUIRED' })
  await assert.rejects(direct.confirmDirectPayment('po_bad', PI, { invoiceId: INV.invoiceId, reason: REASON, actor: ACTOR }, w.serviceDeps), { code: 'INVALID_PAYOUT_ID' })
  assert.equal(w.store.rows.length, 0)
})

// ── Reassigned payments: cancelled order, nothing refunded, funds reused for a replacement invoice ──

const REASSIGN_REASON = 'Customer cancelled original order and same Stripe funds were reused for replacement order.'
const ORIGINAL_ORDER = {
  orderId: '19870', orderNumber: '20890', orderStatus: 'cancelled', paymentStatus: 'completed', paymentMethod: 'stripe', stripePaymentIntentId: PI,
  shopOrder: false, finalAmount: 1261, refundAmount: 0, walletRedeemed: 0, deleted: false, sameNumberCount: 0, createdAt: '2026-08-30T09:00:00.000Z',
}
const ORIGINAL_INV = { invoiceId: 'ZID-INV-043530', invoiceNumber: 'INV-043530', referenceNumber: '20890', customerId: WEB, status: 'void', total: 1261, balance: 0, currencyCode: 'AED', date: '2026-08-30' }
// Staff re-created the order without a Stripe payment; its invoice INV-043544 (P.O.# 20901) is the replacement.
const REPLACEMENT_ORDER = {
  orderId: '19911', orderNumber: '20901', orderStatus: 'processing', paymentStatus: 'pending', paymentMethod: 'cashOnDelivery', stripePaymentIntentId: null,
  shopOrder: false, finalAmount: 1261, refundAmount: 0, walletRedeemed: 0, deleted: false, sameNumberCount: 0,
}
const ORIGINAL_EVIDENCE = { ...PAYMENT_LINK_EVIDENCE, sessions: [], description: 'Order #20890' }

function reassignWorld({ original = {}, originalInvoice = {}, extraOrders = [], extraInvoices = [], ...rest } = {}) {
  return world({
    evidence: ORIGINAL_EVIDENCE,
    ...rest,
    extraOrders: [{ ...ORIGINAL_ORDER, ...original }, REPLACEMENT_ORDER, ...extraOrders],
    extraInvoices: [{ ...ORIGINAL_INV, ...originalInvoice }, ...extraInvoices],
  })
}

function reassigned(patch = {}) {
  return mapped({
    mappingType: 'REASSIGNED_PAYMENT', originalOrderId: '19870', originalOrderNumber: '20890', originalOrderStatus: 'cancelled',
    originalInvoiceId: ORIGINAL_INV.invoiceId, originalInvoiceNumber: ORIGINAL_INV.invoiceNumber, evidence: 'No Stripe reference; invoice number re-typed by the admin.',
    reason: REASSIGN_REASON, ...patch,
  })
}

const reassign = (w, extra = {}) => direct.confirmDirectPayment(PAYOUT, PI, { invoiceId: INV.invoiceId, reason: REASSIGN_REASON, actor: ACTOR, confirmInvoiceNumber: 'INV-043544', ...extra }, w.serviceDeps)
const blockingKeys = (v) => v.checks.filter((c) => c.blocking).map((c) => c.key)

test('reassigned 1: cancelled original order + no refund + replacement invoice is mappable through "Assign to Zoho Invoice"', async () => {
  const w = reassignWorld()
  const r = await w.run()
  assert.equal(r.status, PAYOUT_STATUS.NEEDS_REVIEW)
  assert.equal(r.unassigned.length, 1)
  const u = r.unassigned[0]
  assert.equal(u.mappingType, 'REASSIGNED_PAYMENT')
  assert.equal(u.directEligible, true)
  assert.deepEqual([u.gross, u.fee, u.net], [1261, 50.18, 1210.82])
  assert.deepEqual([u.originalOrder.orderNumber, u.originalOrder.orderStatus, u.originalOrder.refundedThroughStripe, u.originalOrder.zohoCustomerId], ['20890', 'cancelled', 0, WEB])
  assert.deepEqual(u.originalInvoices.map((i) => [i.invoiceNumber, i.status]), [['INV-043530', 'void']])
  assert.match(u.reason, /20890 is cancelled but Stripe refunded nothing/)
  assert.equal(u.suggestion.status, directModel.SUGGESTION.NEEDS_REVIEW)
  assert.deepEqual(u.suggestion.candidates.map((c) => c.invoiceNumber), ['INV-043544'])
  assert.match(r.blockers[0], /Assign to Zoho Invoice/)

  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.equal(v.mappingType, 'REASSIGNED_PAYMENT')
  assert.equal(v.blocking, false, JSON.stringify(v.checks.filter((c) => c.blocking)))
  assert.ok(['original_order', 'no_stripe_refund', 'original_not_consumed', 'replacement_invoice', 'same_customer'].every((k) => v.checks.find((c) => c.key === k).ok))
  assert.equal(v.checks.find((c) => c.key === 'charge_unassigned'), undefined)
  // Stripe naming the original order is expected, not evidence for or against the replacement.
  assert.equal(v.evidenceStatus, directModel.EVIDENCE.NONE)
  assert.equal(v.requiresTypedInvoiceNumber, true)
  assert.equal(v.originalOrder.orderNumber, '20890')

  await assert.rejects(reassign(w, { confirmInvoiceNumber: '' }), { code: 'EVIDENCE_REQUIRED' })
  await assert.rejects(reassign(w, { reason: 'reused' }), { code: 'REASON_REQUIRED' })
  const out = await reassign(w)
  assert.deepEqual([out.zohoWrites, out.stripeWrites], [0, 0])
  const m = w.store.rows[0]
  assert.deepEqual(
    [m.mappingType, m.paymentIntentId, m.chargeId, m.zohoInvoiceNumber, m.originalOrderId, m.originalOrderNumber, m.originalOrderStatus, m.originalInvoiceId, m.originalInvoiceNumber, m.mappedBy, m.reason],
    ['REASSIGNED_PAYMENT', PI, CH, 'INV-043544', '19870', '20890', 'cancelled', 'ZID-INV-043530', 'INV-043530', ACTOR, REASSIGN_REASON],
  )
})

test('reassigned 2: an original Stripe refund blocks the reassignment', async () => {
  // Stripe amount_refunded > 0: the cancelled order stays a website-order review, never reassignable.
  // The manual option is still offered; the backend blocks the save.
  const w1 = reassignWorld({ directCharge: { refundedMinor: 126100 }, evidence: { ...ORIGINAL_EVIDENCE, refundedMinor: 126100 },
    refunds: [{ refundId: 're_1', chargeId: CH, amountMinor: 126100, status: 'succeeded', balanceTransaction: null }] })
  const r1 = await w1.run()
  assert.equal(r1.unassigned.length, 0)
  assert.equal(r1.reviewCharges.find((l) => l.paymentIntentId === PI).mappingType, 'MANUAL_INVOICE_MAPPING')
  await assert.rejects(reassign(w1), { code: 'DIRECT_MAPPING_BLOCKED' })
  // A refund listed on the charge (e.g. pending) blocks even while amount_refunded still reads 0.
  const w2 = reassignWorld({ refunds: [{ refundId: 're_pending', chargeId: CH, amountMinor: 126100, status: 'pending', balanceTransaction: null }] })
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w2.serviceDeps)
  assert.deepEqual(blockingKeys(v), ['no_stripe_refund'])
  await assert.rejects(reassign(w2), { code: 'DIRECT_MAPPING_BLOCKED' })
  // A refund recorded by the website (money or wallet credit back) is a financial reversal too.
  for (const original of [{ refundAmount: 1261 }, { paymentStatus: 'refunded' }]) {
    const w = reassignWorld({ original })
    assert.equal((await w.run()).unassigned.length, 0)
    assert.ok(blockingKeys(await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)).includes('no_website_refund'))
    await assert.rejects(reassign(w), { code: 'DIRECT_MAPPING_BLOCKED' })
    assert.equal(w.store.rows.length, 0)
  }
  for (const w of [w1, w2]) assert.equal(w.store.rows.length, 0)
})

test('reassigned 3: a disputed charge is blocked', async () => {
  const w1 = reassignWorld({ directCharge: { disputed: true }, evidence: { ...ORIGINAL_EVIDENCE, disputed: true } })
  assert.equal((await w1.run()).unassigned.length, 0)
  await assert.rejects(reassign(w1), { code: 'DIRECT_MAPPING_BLOCKED' })
  assert.equal(w1.store.rows.length, 0)
  const w2 = reassignWorld({ evidence: { ...ORIGINAL_EVIDENCE, disputed: true } })
  assert.deepEqual(blockingKeys(await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w2.serviceDeps)), ['charge_state', 'original_order'])
  await assert.rejects(reassign(w2), { code: 'DIRECT_MAPPING_BLOCKED' })
  assert.equal(w2.store.rows.length, 0)
})

test('reassigned 4: a target invoice that is already paid is blocked', async () => {
  for (const invoice of [{ balance: 0, status: 'paid' }, { balance: 261, status: 'partially_paid' }]) {
    const w = reassignWorld({ invoice })
    assert.ok(blockingKeys(await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)).includes('balance'))
    await assert.rejects(reassign(w), { code: 'DIRECT_MAPPING_BLOCKED' })
  }
})

test('reassigned 5: target amount mismatch is blocked (no partial reassignment)', async () => {
  const w = reassignWorld({ invoice: { total: 1300, balance: 1300 } })
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.deepEqual(blockingKeys(v), ['amount'])
  assert.match(v.checks.find((c) => c.key === 'amount').detail, /1261 ≠ invoice 1300/)
  await assert.rejects(reassign(w), { code: 'DIRECT_MAPPING_BLOCKED' })
})

test('reassigned 6: a replacement invoice under a different Zoho customer is NEEDS_REVIEW, not mappable', async () => {
  const w = reassignWorld({ invoice: { customerId: SHOP } })
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.deepEqual(blockingKeys(v), ['same_customer'])
  assert.match(v.checks.find((c) => c.key === 'same_customer').detail, /Website.*Burjman.*needs review/)
  await assert.rejects(reassign(w), { code: 'DIRECT_MAPPING_BLOCKED' })
  const r = await w.run()
  assert.equal(r.status, PAYOUT_STATUS.NEEDS_REVIEW)
  assert.equal(r.unassigned.length, 1)
})

test('reassigned 7: the same PaymentIntent cannot be mapped twice', async () => {
  const w = reassignWorld({ extraInvoices: [{ ...INV, invoiceId: 'ZID-INV-043600', invoiceNumber: 'INV-043600', referenceNumber: '20950' }] })
  await reassign(w)
  await assert.rejects(reassign(w, { invoiceId: 'ZID-INV-043600', confirmInvoiceNumber: 'INV-043600' }), { code: 'CHARGE_ALREADY_ASSIGNED' })
  await assert.rejects(w.store.insertMapping(null, reassigned({ zohoInvoiceId: 'ZID-INV-043600', zohoInvoiceNumber: 'INV-043600' })), { code: 'DIRECT_MAPPING_EXISTS' })
  assert.equal(w.store.rows.length, 1)
})

test('reassigned 8: the original and the replacement invoice can never both take the payment', async () => {
  // Target is the cancelled order's own invoice.
  const w1 = reassignWorld({ originalInvoice: { status: 'sent', balance: 1261 } })
  const v1 = await direct.validateDirectPayment(PAYOUT, PI, ORIGINAL_INV.invoiceId, w1.serviceDeps)
  assert.ok(blockingKeys(v1).includes('replacement_invoice'))
  // The original invoice already received a payment.
  const w2 = reassignWorld({ originalInvoice: { status: 'paid', balance: 0 } })
  const v2 = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w2.serviceDeps)
  assert.deepEqual(blockingKeys(v2), ['original_not_consumed'])
  await assert.rejects(reassign(w2), { code: 'DIRECT_MAPPING_BLOCKED' })
  // The original invoice is allocated by payout accounting.
  const w3 = reassignWorld({ components: [{ id: 3, payoutId: 'po_1EARLIERJogiiRoKPj4uB4mEL', zohoCustomerId: WEB, component: 'NET', status: 'VERIFIED', allocations: [{ invoiceId: ORIGINAL_INV.invoiceId, amount: 1210.82 }] }] })
  assert.deepEqual(blockingKeys(await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w3.serviceDeps)), ['original_not_consumed'])
  // The replacement invoice is already allocated to another Stripe clearing component.
  const w4 = reassignWorld({ components: [{ id: 4, payoutId: 'po_1EARLIERJogiiRoKPj4uB4mEL', zohoCustomerId: WEB, component: 'NET', status: 'VERIFIED', allocations: [{ invoiceId: INV.invoiceId, amount: 1210.82 }] }] })
  assert.deepEqual(blockingKeys(await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w4.serviceDeps)), ['not_allocated'])
  // An open original invoice is only a warning: this mapping does not clear it.
  const v5 = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w1.serviceDeps)
  assert.equal(v5.blocking, false)
  const warn = v5.checks.find((c) => c.key === 'original_invoice_open')
  assert.deepEqual([warn.ok, warn.blocking], [false, false])
  assert.match(warn.detail, /INV-043530.*stays open/)
})

test('reassigned 9: the mapped charge joins the normal grouped Website NET and FEE payments', async () => {
  const r = await reassignWorld({ mappings: [reassigned()] }).run()
  const g = websiteGroup(r)
  const line = g.lines.find((l) => l.paymentIntentId === PI)
  assert.equal(line.source, directModel.SOURCE.REASSIGNED_STRIPE_PAYMENT)
  assert.equal(line.matchStatus, 'REASSIGNED_PAYMENT_MAPPED')
  assert.equal(line.state, LINE_STATE.OPEN)
  assert.equal(line.website, null)
  assert.match(line.reason, /Reassigned Stripe payment from cancelled order 20890 for Zoho INV-043544/)
  assert.deepEqual([line.direct.mappingType, line.direct.originalOrderNumber, line.direct.originalInvoiceNumber, line.direct.invoiceNumber, line.direct.mappedBy, line.direct.reason],
    ['REASSIGNED_PAYMENT', '20890', 'INV-043530', 'INV-043544', ACTOR, REASSIGN_REASON])
  assert.deepEqual([line.invoiceTotal, line.netAllocation, line.feeAllocation, line.customerAdvance], [1261, 1210.82, 50.18, 0])
  assert.deepEqual(g.components.map((c) => c.component), ['NET', 'FEE'])
  const net = g.components.find((c) => c.component === 'NET')
  const fee = g.components.find((c) => c.component === 'FEE')
  assert.deepEqual([net.amount, net.account.accountCode, fee.amount, fee.account.accountCode], [2151.37, '1019', 80.33, '1013'])
  assert.deepEqual(net.allocations[2], { invoiceId: INV.invoiceId, invoiceNumber: 'INV-043544', orderNumber: null, paymentIntentId: PI, source: 'REASSIGNED_STRIPE_PAYMENT', amount: 1210.82 })
  assert.deepEqual(fee.allocations[2].amount, 50.18)
  assert.ok(!net.allocations.some((a) => a.invoiceId === ORIGINAL_INV.invoiceId))
  assert.equal(net.payload.notes, undefined)
  assert.deepEqual(r.groups.flatMap((x) => x.components).filter((c) => c.zohoRecordType === 'journal'), [])
})

test('reassigned 10: the payout reconciles after the reassignment', async () => {
  const w = reassignWorld()
  await reassign(w)
  const r = await w.run()
  assert.deepEqual(r.unassigned, [])
  assert.deepEqual(r.blockers, [])
  const g = websiteGroup(r)
  assert.equal(g.status, GROUP_STATUS.READY)
  assert.deepEqual(g.totals, { invoiceGross: 2231.7, netTo1019: 2151.37, customerAdvance: 0, total1019: 2151.37, feeTo1013: 80.33, stripeGross: 2231.7 })
  assert.equal(r.reconciliation.payoutMatches, true)
  assert.equal(r.reconciliation.grossMatches, true)
  assert.equal(r.feeJournal.amount, 80.33)
})

test('reassigned: a stored mapping stops holding when the original order is no longer cancelled or unrefunded', async () => {
  for (const [original, re] of [[{ orderStatus: 'delivered' }, /not cancelled/], [{ refundAmount: 1261 }, /records a refund/], [{ orderNumber: '20891' }, /confirmed for cancelled order 20890/]]) {
    const r = await reassignWorld({ original, mappings: [reassigned()] }).run()
    const line = r.groups.flatMap((g) => g.lines).find((l) => l.paymentIntentId === PI)
    assert.equal(line.state, LINE_STATE.NEEDS_REVIEW)
    assert.match(line.reason, re)
    assert.equal(websiteGroup(r).postable, false)
  }
})

test('reassigned 11: direct-payment mapping is unchanged (no website order, DIRECT_PAYMENT, no original evidence)', async () => {
  const w = world()
  const u = (await w.run()).unassigned[0]
  assert.equal(u.mappingType, 'DIRECT_PAYMENT')
  assert.equal(u.originalOrder, null)
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.equal(v.mappingType, 'DIRECT_PAYMENT')
  assert.ok(v.checks.find((c) => c.key === 'charge_unassigned').ok)
  assert.equal(v.checks.find((c) => c.key === 'original_order'), undefined)
  await confirm(w)
  const m = w.store.rows[0]
  assert.deepEqual([m.mappingType, m.originalOrderNumber, m.originalInvoiceNumber], ['DIRECT_PAYMENT', null, null])
  const line = websiteGroup(await w.run()).lines.find((l) => l.paymentIntentId === PI)
  assert.equal(line.source, directModel.SOURCE.DIRECT_STRIPE_PAYMENT)
  assert.equal(line.matchStatus, 'DIRECT_PAYMENT_MAPPED')
})

test('reassigned 12: creating the local mapping makes no Zoho, Stripe or website write', async () => {
  const w = reassignWorld()
  await direct.searchInvoices({ q: '1261.00', customer: 'website' }, w.serviceDeps)
  await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  await reassign(w)
  await w.run()
  await direct.releaseDirectPayment(PAYOUT, PI, { actor: ACTOR, reason: 'Release in the reassigned no-writes test' }, w.serviceDeps)
  assert.deepEqual(w.writes, [])
  assert.equal(w.locks(), 2)
  assert.deepEqual([...new Set(w.stripeReads)], [PI])
  assert.equal(ORIGINAL_ORDER.orderStatus, 'cancelled')
  const loaded = Object.keys(require.cache).filter((p) => /stripeClearing\/stripePayoutPostingService|stripePayoutZohoWriter/.test(p))
  assert.deepEqual(loaded, [])
})

test('reassignableOrigin: only a cancelled, completed, unrefunded, undisputed order qualifies', () => {
  const ok = directModel.reassignableOrigin(ORIGINAL_ORDER, { refundedMinor: 0, disputed: false })
  assert.equal(ok.ok, true)
  for (const [order, charge] of [
    [{ ...ORIGINAL_ORDER, orderStatus: 'delivered' }, null],
    [{ ...ORIGINAL_ORDER, orderStatus: 'returned' }, null],
    [{ ...ORIGINAL_ORDER, deleted: true }, null],
    [{ ...ORIGINAL_ORDER, paymentStatus: 'pending' }, null],
    [ORIGINAL_ORDER, { refundedMinor: 1 }],
    [ORIGINAL_ORDER, { disputed: true }],
    [null, null],
  ]) assert.equal(directModel.reassignableOrigin(order, charge).ok, false, JSON.stringify([order && order.orderStatus, charge]))
})

// ── Manual invoice mapping: the permanent "Assign to Zoho Invoice" fallback ──

const MANUAL_REASON = 'Stripe payment for order 20901; website status is wrong, verified with the customer.'
// The website order 20901 carries the PaymentIntent, but something keeps the matcher from clearing it.
const PI_ORDER = {
  orderId: '19911', orderNumber: '20901', orderStatus: 'cancelled', paymentStatus: 'pending', paymentMethod: 'stripe', stripePaymentIntentId: PI,
  shopOrder: false, finalAmount: 1261, refundAmount: 0, walletRedeemed: 0, deleted: false, sameNumberCount: 0, createdAt: '2026-09-01T09:00:00.000Z',
}

function manualWorld({ order = {}, ...rest } = {}) {
  return world({ ...rest, extraOrders: [{ ...PI_ORDER, ...order }, ...(rest.extraOrders || [])] })
}

function manualMapped(patch = {}) {
  return mapped({
    mappingType: 'MANUAL_INVOICE_MAPPING', originalOrderId: '19911', originalOrderNumber: '20901', originalOrderStatus: 'cancelled',
    originalInvoiceId: INV.invoiceId, originalInvoiceNumber: INV.invoiceNumber, matcherStatus: 'NEEDS_REVIEW', matcherReason: 'Website order status is cancelled.',
    evidence: 'No Stripe reference; invoice number re-typed by the admin.', reason: MANUAL_REASON, ...patch,
  })
}

const manualConfirm = (w, extra = {}) => direct.confirmDirectPayment(PAYOUT, PI, { invoiceId: INV.invoiceId, reason: MANUAL_REASON, actor: ACTOR, confirmInvoiceNumber: 'INV-043544', ...extra }, w.serviceDeps)

/** The card for the charge: unassigned or left in review inside its group. */
async function assignCard(w) {
  const r = await w.run()
  const card = [...r.unassigned, ...r.reviewCharges].find((l) => l.paymentIntentId === PI)
  return { r, card }
}

test('manual 1: a direct Stripe payment shows "Assign to Zoho Invoice" (DIRECT_PAYMENT)', async () => {
  const { card } = await assignCard(world())
  assert.deepEqual([card.mappingType, card.directEligible, card.matcherStatus], ['DIRECT_PAYMENT', true, LINE_STATE.NEEDS_REVIEW])
})

test('manual 2: a reassigned Stripe payment shows "Assign to Zoho Invoice" (REASSIGNED_PAYMENT)', async () => {
  const { card } = await assignCard(reassignWorld())
  assert.deepEqual([card.mappingType, card.directEligible], ['REASSIGNED_PAYMENT', true])
})

test('manual 3: a generic NEEDS_REVIEW website charge shows the option with the matcher status and reason', async () => {
  const w = manualWorld({ order: { orderStatus: 'delivered', paymentStatus: 'pending' } })
  const { r, card } = await assignCard(w)
  assert.equal(r.unassigned.length, 0)
  assert.equal(websiteGroup(r).lines.find((l) => l.paymentIntentId === PI).state, LINE_STATE.NEEDS_REVIEW)
  assert.deepEqual([card.mappingType, card.directEligible, card.matcherStatus, card.matcherReason],
    ['MANUAL_INVOICE_MAPPING', true, LINE_STATE.NEEDS_REVIEW, 'Website payment status is pending.'])
  // Every field the card shows.
  assert.deepEqual([card.paymentIntentId, card.chargeId, card.gross, card.fee, card.net, card.stripeRefunded, card.stripeDisputed], [PI, CH, 1261, 50.18, 1210.82, 0, false])
  assert.deepEqual([card.originalOrder.orderNumber, card.originalOrder.orderStatus, card.originalOrder.paymentStatus], ['20901', 'delivered', 'pending'])
  assert.deepEqual(card.originalInvoices.map((i) => i.invoiceNumber), ['INV-043544'])
})

test('manual 4: a cancelled website order shows the option ("Website order status is cancelled.")', async () => {
  const { card } = await assignCard(manualWorld())
  assert.deepEqual([card.mappingType, card.directEligible, card.matcherReason], ['MANUAL_INVOICE_MAPPING', true, 'Website order status is cancelled.'])
})

test('manual 5: a partiallyReturned website order in review shows the option', async () => {
  const { card } = await assignCard(manualWorld({ order: { orderStatus: 'partiallyReturned', paymentStatus: 'completed' } }))
  assert.deepEqual([card.mappingType, card.directEligible, card.matcherStatus], ['MANUAL_INVOICE_MAPPING', true, LINE_STATE.NEEDS_REVIEW])
  assert.match(card.matcherReason, /partiallyReturned/)
})

test('manual 6: a charge with no website order (missing website PI) shows the option', async () => {
  const w = world({ extraOrders: [{ ...PI_ORDER, stripePaymentIntentId: null, orderStatus: 'delivered', paymentStatus: 'completed' }] })
  const { card } = await assignCard(w)
  assert.deepEqual([card.mappingType, card.directEligible, card.originalOrder], ['DIRECT_PAYMENT', true, null])
})

test('manual 7: an unknown matcher failure (order number reused) shows the option', async () => {
  const { card } = await assignCard(manualWorld({ order: { orderStatus: 'delivered', paymentStatus: 'completed', sameNumberCount: 1 } }))
  assert.deepEqual([card.mappingType, card.directEligible], ['MANUAL_INVOICE_MAPPING', true])
  assert.match(card.matcherReason, /used by another website order/)
})

test('manual 8: a disputed charge shows the option but the save is blocked', async () => {
  const w = manualWorld({ directCharge: { disputed: true }, evidence: { ...PAYMENT_LINK_EVIDENCE, disputed: true } })
  const { card } = await assignCard(w)
  assert.deepEqual([card.directEligible, card.stripeDisputed], [true, true])
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.deepEqual(blockingKeys(v), ['charge_state'])
  assert.equal(v.checks.find((c) => c.key === 'charge_state').detail, 'Stripe charge is disputed.')
  await assert.rejects(manualConfirm(w), { code: 'DIRECT_MAPPING_BLOCKED' })
  assert.equal(w.store.rows.length, 0)
})

test('manual 9: a partially refunded charge shows the option but the unsafe save is blocked', async () => {
  const w = manualWorld({ directCharge: { refundedMinor: 10000 }, evidence: { ...PAYMENT_LINK_EVIDENCE, refundedMinor: 10000 },
    refunds: [{ refundId: 're_part', chargeId: CH, amountMinor: 10000, status: 'succeeded', balanceTransaction: null }] })
  const { card } = await assignCard(w)
  assert.deepEqual([card.directEligible, card.stripeRefunded], [true, 100])
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.deepEqual(blockingKeys(v), ['charge_state', 'no_stripe_refund'])
  assert.match(v.checks.find((c) => c.key === 'charge_state').detail, /Stripe charge has already been partially refunded AED 100\.00\./)
  await assert.rejects(manualConfirm(w), { code: 'DIRECT_MAPPING_BLOCKED' })
  assert.equal(w.store.rows.length, 0)
})

test('manual 10: a PaymentIntent cannot be mapped twice', async () => {
  const w = manualWorld({ extraInvoices: [{ ...INV, invoiceId: 'ZID-INV-043600', invoiceNumber: 'INV-043600', referenceNumber: '20950' }] })
  await manualConfirm(w)
  await assert.rejects(manualConfirm(w, { invoiceId: 'ZID-INV-043600', confirmInvoiceNumber: 'INV-043600' }), { code: 'CHARGE_ALREADY_ASSIGNED' })
  await assert.rejects(w.store.insertMapping(null, manualMapped({ zohoInvoiceId: 'ZID-INV-043600', zohoInvoiceNumber: 'INV-043600' })), { code: 'DIRECT_MAPPING_EXISTS' })
  assert.equal(w.store.rows.length, 1)
})

test('manual 11: an invoice already allocated or mapped elsewhere is blocked', async () => {
  const w1 = manualWorld({ components: [{ id: 5, payoutId: 'po_1EARLIERJogiiRoKPj4uB4mEL', zohoCustomerId: WEB, component: 'NET', status: 'VERIFIED', allocations: [{ invoiceId: INV.invoiceId, amount: 1210.82 }] }] })
  assert.deepEqual(blockingKeys(await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w1.serviceDeps)), ['not_allocated'])
  await assert.rejects(manualConfirm(w1), { code: 'DIRECT_MAPPING_BLOCKED' })
  const w2 = manualWorld({ mappings: [mapped({ paymentIntentId: 'pi_3OTHERDJogiiRoKP0000000', chargeId: 'ch_3OTHERDJogiiRoKP0000000' })] })
  assert.deepEqual(blockingKeys(await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w2.serviceDeps)), ['no_invoice_mapping'])
  await assert.rejects(manualConfirm(w2), { code: 'DIRECT_MAPPING_BLOCKED' })
  // A different amount or customer is never mapped.
  const w3 = manualWorld({ invoice: { total: 1300, balance: 1300 } })
  assert.deepEqual(blockingKeys(await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w3.serviceDeps)), ['amount'])
  const w4 = manualWorld({ invoice: { customerId: SHOP } })
  assert.deepEqual(blockingKeys(await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w4.serviceDeps)), ['same_customer'])
  for (const w of [w1, w2, w3, w4]) assert.equal(w.store.rows.filter((m) => m.paymentIntentId === PI).length, 0)
})

test('manual 12: a valid manual override maps the charge and the payout reconciles', async () => {
  const w = manualWorld()
  const v = await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  assert.equal(v.mappingType, 'MANUAL_INVOICE_MAPPING')
  assert.equal(v.blocking, false, JSON.stringify(v.checks.filter((c) => c.blocking)))
  assert.equal(v.requiresTypedInvoiceNumber, true)
  assert.deepEqual([v.matcherStatus, v.matcherReason], [LINE_STATE.NEEDS_REVIEW, 'Website order status is cancelled.'])
  await assert.rejects(manualConfirm(w, { confirmInvoiceNumber: '' }), { code: 'EVIDENCE_REQUIRED' })
  await assert.rejects(manualConfirm(w, { reason: 'too short' }), { code: 'REASON_REQUIRED' })
  const out = await manualConfirm(w)
  assert.deepEqual([out.zohoWrites, out.stripeWrites], [0, 0])
  const m = w.store.rows[0]
  assert.deepEqual(
    [m.mappingType, m.paymentIntentId, m.chargeId, m.payoutId, m.zohoInvoiceNumber, m.zohoCustomerId, m.stripeGross, m.originalOrderNumber, m.originalInvoiceNumber, m.matcherStatus, m.matcherReason, m.reason, m.mappedBy],
    ['MANUAL_INVOICE_MAPPING', PI, CH, PAYOUT, 'INV-043544', WEB, 1261, '20901', 'INV-043544', 'NEEDS_REVIEW', 'Website order status is cancelled.', MANUAL_REASON, ACTOR],
  )
  assert.equal(PI_ORDER.orderStatus, 'cancelled')
  const r = await w.run()
  assert.deepEqual([r.unassigned, r.reviewCharges, r.blockers], [[], [], []])
  assert.equal(websiteGroup(r).status, GROUP_STATUS.READY)
  assert.equal(r.reconciliation.payoutMatches, true)
  assert.equal(r.reconciliation.grossMatches, true)
})

test('manual 13: the mapped charge joins the grouped Website NET (1019) and FEE (1013) payments', async () => {
  const r = await manualWorld({ mappings: [manualMapped()] }).run()
  const g = websiteGroup(r)
  const line = g.lines.find((l) => l.paymentIntentId === PI)
  assert.deepEqual([line.source, line.matchStatus, line.state, line.website], ['MANUAL_INVOICE_MAPPING', 'MANUAL_INVOICE_MAPPED', LINE_STATE.OPEN, null])
  assert.match(line.reason, /Manual invoice mapping \(website order 20901\) for Zoho INV-043544/)
  assert.deepEqual([line.direct.matcherReason, line.direct.mappingType], ['Website order status is cancelled.', 'MANUAL_INVOICE_MAPPING'])
  assert.deepEqual(g.components.map((c) => c.component), ['NET', 'FEE'])
  const net = g.components.find((c) => c.component === 'NET')
  const fee = g.components.find((c) => c.component === 'FEE')
  assert.deepEqual([net.amount, net.account.accountCode, fee.amount, fee.account.accountCode], [2151.37, '1019', 80.33, '1013'])
  assert.deepEqual(net.allocations[2], { invoiceId: INV.invoiceId, invoiceNumber: 'INV-043544', orderNumber: null, paymentIntentId: PI, source: 'MANUAL_INVOICE_MAPPING', amount: 1210.82 })
  assert.equal(net.payload.notes, undefined)
  assert.deepEqual(r.groups.flatMap((x) => x.components).filter((c) => c.zohoRecordType === 'journal'), [])
  // A different website order now carrying the PaymentIntent sends the mapping back to review.
  const moved = await manualWorld({ order: { orderNumber: '20999' }, mappings: [manualMapped()] }).run()
  const stale = moved.groups.flatMap((x) => x.lines).find((l) => l.paymentIntentId === PI)
  assert.equal(stale.state, LINE_STATE.NEEDS_REVIEW)
  assert.match(stale.reason, /confirmed with website order 20901/)
})

test('manual 14: the mapping locks once accounting has been posted', async () => {
  const w = manualWorld({
    mappings: [manualMapped()],
    components: [{ id: 6, payoutId: PAYOUT, zohoCustomerId: WEB, component: 'NET', status: 'POSTED', zohoRecordId: 'ZP10', allocations: [{ invoiceId: INV.invoiceId, paymentIntentId: PI, amount: 1210.82 }] }],
  })
  const line = websiteGroup(await w.run()).lines.find((l) => l.paymentIntentId === PI)
  assert.equal(line.direct.removable, false)
  assert.match(line.direct.lockedReason, /^Mapping locked because accounting has already been posted/)
  await assert.rejects(direct.releaseDirectPayment(PAYOUT, PI, { actor: ACTOR, reason: 'Trying to change it after posting' }, w.serviceDeps), { code: 'DIRECT_MAPPING_LOCKED' })
  assert.equal(w.store.rows[0].status, 'ACTIVE')
})

test('manual 15: creating the local mapping makes no Zoho, Stripe or website write', async () => {
  const w = manualWorld()
  await direct.searchInvoices({ q: '20901', customer: 'website' }, w.serviceDeps)
  await direct.validateDirectPayment(PAYOUT, PI, INV.invoiceId, w.serviceDeps)
  await manualConfirm(w)
  await w.run()
  await direct.releaseDirectPayment(PAYOUT, PI, { actor: ACTOR, reason: 'Release in the manual no-writes test' }, w.serviceDeps)
  assert.deepEqual(w.writes, [])
  assert.equal(w.locks(), 2)
  const loaded = Object.keys(require.cache).filter((p) => /stripeClearing\/stripePayoutPostingService|stripePayoutZohoWriter/.test(p))
  assert.deepEqual(loaded, [])
})

test('manual: an already-accounted PaymentIntent keeps the card but explains why it cannot be mapped', async () => {
  const w = manualWorld({ components: [{ id: 7, payoutId: PAYOUT, zohoCustomerId: WEB, component: 'NET', status: 'PLANNED', allocations: [{ invoiceId: 'ZID-X', paymentIntentId: PI, amount: 1 }] }] })
  const { card } = await assignCard(w)
  assert.equal(card.directEligible, false)
  assert.match(card.directIneligibleReason, /Payout accounting already includes this PaymentIntent \(NET PLANNED\)/)
})
