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
      .filter((c) => (c.allocations || []).some((a) => a.invoiceId === zohoInvoiceId || a.paymentIntentId === paymentIntentId)),
    insertMapping: async (_db, m) => {
      if (rows.some((r) => r.status === 'ACTIVE' && (r.paymentIntentId === m.paymentIntentId || r.zohoInvoiceId === m.zohoInvoiceId || (m.chargeId && r.chargeId === m.chargeId)))) {
        const err = new Error('exists')
        err.status = 409
        err.code = 'DIRECT_MAPPING_EXISTS'
        throw err
      }
      const row = { ...m, id: rows.length + 1, status: 'ACTIVE', mappingType: 'DIRECT_PAYMENT', mappedAt: '2026-09-29T09:00:00.000Z' }
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
    listChargeRefunds: async () => [],
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
