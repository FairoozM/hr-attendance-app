'use strict'

/**
 * Payout-level Stripe clearing preview. Fixtures use the exact production figures of
 * po_1UJNObDJogiiRoKPHtPAr3KE (current, uncleared, with the order 21111 overpayment)
 * and po_1UBlP3DJogiiRoKPtaGU10or (historical, already cleared in Zoho).
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { getStripeClearingConfig } = require('../src/config/stripeClearing')
const { previewPayout, listPayoutSummaries, LINE_STATE } = require('../src/services/stripeClearing/stripePayoutPreviewService')
const { GROUP_STATUS, PAYOUT_STATUS, RECOVERY_ACTION, ZOHO_STATE, FEE_JOURNAL_STATUS } = require('../src/services/stripeClearing/stripePayoutClearingModel')

const config = getStripeClearingConfig()
const WEB = config.websiteZohoCustomerId
const SHOP = config.shopZohoCustomerId
const A1019 = '4265011000000984169'
const A1013 = '4265011000000699653'
const A1123 = config.advanceAccountId

const ACCOUNTS = [
  { accountId: A1019, accountName: 'Stripe Undeposited Funds', accountCode: '1019', accountType: 'cash', isActive: true },
  { accountId: A1013, accountName: 'Stripe Processing Chg Un-Cleared', accountCode: '1013', accountType: 'cash', isActive: true },
  { accountId: A1123, accountName: 'Customer Advance Funds', accountCode: '1123', accountType: 'other_current_liability', isActive: true },
  { accountId: 'A1260', accountName: 'Unearned Revenue', accountCode: '1260', accountType: 'other_current_liability', isActive: true },
  { accountId: config.feeExpenseAccountId, accountName: 'Stripe Fees', accountCode: '2270', accountType: 'expense', isActive: true },
]

function row(chargeId, paymentIntentId, orderNumber, invoiceNumber, gross, fee, customer, extra = {}) {
  return { chargeId, paymentIntentId, orderNumber, invoiceNumber, gross, fee, customer, ...extra }
}

const CURRENT_ID = 'po_1UJNObDJogiiRoKPHtPAr3KE'
const CURRENT = {
  payoutId: CURRENT_ID,
  amountMinor: 455197,
  arrivalDate: '2026-09-28T00:00:00.000Z',
  hold: 100000,
  rows: [
    row('ch_3UIA7CDJogiiRoKP07RCqZKw', 'pi_3UIA7CDJogiiRoKP0Qy1oodM', '21111', 'INV-044122', 110100, 3293, WEB, { orderTotal: 1066 }),
    row('ch_3UI3iPDJogiiRoKP0wqqBVBj', 'pi_3UI3iPDJogiiRoKP0FqNKZix', '21106', 'INV-044102', 7650, 322, WEB),
    row('ch_3UHr0DDJogiiRoKP0DOHt4mN', 'pi_3UHr0DDJogiiRoKP0u6GFnN3', '21103', 'INV-044100', 18470, 636, WEB),
    row('ch_3UHdvUDJogiiRoKP0un4aWsk', 'pi_3UHdvUDJogiiRoKP0fgYt7ap', '21093', 'INV-044088', 109900, 3287, WEB),
    row('ch_3UHPbNDJogiiRoKP1DK9FRKO', 'pi_3UHPbNDJogiiRoKP153vf3hK', '21088', 'INV-044059', 42415, 1330, WEB),
    row('ch_3UHOC1DJogiiRoKP257imj3u', 'pi_3UHOC1DJogiiRoKP2w18Q8eG', '21083', 'INV-044062', 4760, 238, WEB),
    row('ch_3UHLX7DJogiiRoKP1UrcOHtJ', 'pi_3UHLX7DJogiiRoKP1cQpA7Zw', '21076', 'INV-044099', 52275, 1616, WEB),
    row('ch_3UI3rMDJogiiRoKP0BPo22cL', 'pi_3UI3rMDJogiiRoKP0sTJmeYL', '21107', 'INV-044103', 11730, 440, SHOP, { status: 'overdue' }),
    row('ch_3UI1UgDJogiiRoKP2n8UXid3', 'pi_3UI1UgDJogiiRoKP2cU7VOKY', '21105', 'INV-044120', 78795, 2385, SHOP, { status: 'overdue' }),
    row('ch_3UHiscDJogiiRoKP1kyrSWvP', 'pi_3UHiscDJogiiRoKP1s5LYmaF', '21098', 'INV-044093', 9690, 381, SHOP, { status: 'overdue' }),
    row('ch_3UHJ78DJogiiRoKP02l6fPy3', 'pi_3UHJ78DJogiiRoKP0PMF4StJ', '21075', 'INV-044038', 24140, 800, SHOP, { status: 'overdue' }),
  ],
}
const ADVANCE_CHARGE = 'ch_3UIA7CDJogiiRoKP07RCqZKw'

const HISTORICAL_ID = 'po_1UBlP3DJogiiRoKPtaGU10or'
const HISTORICAL = {
  payoutId: HISTORICAL_ID,
  amountMinor: 1026198,
  arrivalDate: '2026-09-07T00:00:00.000Z',
  hold: 100000,
  rows: [
    row('ch_3UAZG3DJogiiRoKP2HRPhVqm', 'pi_3UAZG3DJogiiRoKP2JGUgBwg', '20890', 'INV-043456', 33065, 1059, WEB, { balance: 0 }),
    row('ch_3UAOotDJogiiRoKP0NYGOhoe', 'pi_3UAOotDJogiiRoKP0lgY6frO', '20869', 'INV-043454', 66900, 2040, WEB, { balance: 0 }),
    row('ch_3UAC7mDJogiiRoKP0BEnvcJQ', 'pi_3UAC7mDJogiiRoKP0AIi7hzu', '20856', 'INV-043406', 92700, 2788, WEB, { balance: 0 }),
    row('ch_3UABOfDJogiiRoKP0jrT3mZO', 'pi_3UABOfDJogiiRoKP0XYtyKbo', '20853', 'INV-043449', 85170, 2570, WEB, { balance: 0 }),
    row('ch_3UAB5KDJogiiRoKP1srzz4uK', 'pi_3UAB5KDJogiiRoKP1bSuyRlW', '20852', 'INV-043446', 255500, 7510, WEB, { balance: 0 }),
    row('ch_3UA4y5DJogiiRoKP2GNC7GB3', 'pi_3UA4y5DJogiiRoKP2aNmt2Bd', '20842', 'INV-043444', 50500, 1565, WEB, { balance: 0 }),
    row('ch_3U9hRTDJogiiRoKP15oEjfmf', 'pi_3U9hRTDJogiiRoKP1Y7dAiVg', '20823', 'INV-043417', 390500, 11425, WEB, { balance: 0 }),
    row('ch_3U9fidDJogiiRoKP0nZm6IK3', 'pi_3U9fidDJogiiRoKP0v46MMze', '20820', 'INV-043410', 55900, 1721, WEB, { balance: 0 }),
    row('ch_3U9hSDDJogiiRoKP0Euuh310', 'pi_3U9hSDDJogiiRoKP0RL3blU0', '20824', 'INV-043368', 27540, 899, SHOP, { balance: 0 }),
  ],
}

const invoiceId = (number) => `ZID-${number}`
const netRef = (p) => `Stripe funds received ${p}`
const feeRef = (p) => `Stripe processing fee ${p}`
const advRef = (p) => `Stripe customer advance ${p}`

function orderTotal(r) {
  return r.orderTotal ?? r.gross / 100
}

/**
 * Stubbed Stripe / website / Zoho / local records for one payout. Every Zoho or Stripe
 * write method records the attempt and throws.
 */
function world(spec, opts = {}) {
  const rows = spec.rows
    .filter((r) => !(opts.only && !opts.only.includes(r.customer)))
    .map((r) => ({ ...r, ...((opts.rows && opts.rows[r.orderNumber]) || {}) }))
  const txns = rows.map((r) => ({
    balanceTransactionId: `txn_${r.chargeId.slice(3)}`,
    type: 'charge',
    reportingCategory: 'charge',
    currency: 'AED',
    exchangeRate: null,
    amountMinor: r.gross,
    feeMinor: r.fee,
    netMinor: r.gross - r.fee,
    chargeId: r.chargeId,
    paymentIntentId: r.paymentIntentId,
    chargeRefundedMinor: r.refundedMinor || 0,
    chargeDisputed: r.disputed === true,
    chargeStatus: r.chargeStatus || 'succeeded',
    chargeFullyRefunded: r.fullyRefunded === true,
  }))
  if (spec.hold) {
    txns.push({ balanceTransactionId: 'txn_HOLD000000001', type: 'reserve_transaction', reportingCategory: 'risk_reserved_funds', currency: 'AED', amountMinor: -spec.hold, feeMinor: 0, netMinor: -spec.hold, description: 'Hold' })
    txns.push({ balanceTransactionId: 'txn_RELEASE00001', type: 'reserve_transaction', reportingCategory: 'risk_reserved_funds', currency: 'AED', amountMinor: spec.hold, feeMinor: 0, netMinor: spec.hold, description: 'Release' })
  }
  txns.push(...(opts.extraTxns || []))
  const chargeNet = txns.filter((t) => t.type !== 'payout').reduce((s, t) => s + t.netMinor, 0)
  const payoutAmount = opts.payoutAmount ?? (opts.only || opts.extraTxns ? chargeNet : spec.amountMinor)
  txns.push({ balanceTransactionId: 'txn_PAYOUT000001', type: 'payout', currency: 'AED', amountMinor: -payoutAmount, feeMinor: 0, netMinor: -payoutAmount })

  const orders = rows.map((r, i) => ({
    orderId: String(10000 + i),
    orderNumber: r.orderNumber,
    orderStatus: 'delivered',
    paymentStatus: 'completed',
    stripePaymentIntentId: r.paymentIntentId,
    shopOrder: r.customer === SHOP,
    finalAmount: orderTotal(r),
    refundAmount: 0,
    walletRedeemed: 0,
    deleted: false,
    sameNumberCount: 0,
    ...(r.order || {}),
  }))
  const invoices = {}
  for (const r of rows) {
    const total = r.invoiceTotal ?? orderTotal(r)
    const balance = (opts.balances && opts.balances[r.invoiceNumber]) ?? r.balance ?? total
    const status = balance === 0 ? 'paid' : balance < total ? 'partially_paid' : r.status || 'sent'
    invoices[r.orderNumber] = [{ invoiceId: invoiceId(r.invoiceNumber), invoiceNumber: r.invoiceNumber, referenceNumber: r.orderNumber, customerId: r.invoiceCustomer || r.customer, status, total, balance, currencyCode: 'AED' }]
  }

  const payments = opts.payments || []
  const journals = opts.journals || []
  const records = {
    cases: opts.cases || [],
    components: opts.components || [],
    events: opts.events || [],
  }
  const writes = []
  const refundLookups = []
  const journalRanges = []
  const deny = (name) => async () => { writes.push(name); throw new Error(`${name} attempted`) }
  const sources = {
    retrieveStripePayout: async (id) => (id === spec.payoutId
      ? { payoutId: spec.payoutId, status: opts.payoutStatus || 'paid', amountMinor: payoutAmount, currency: 'AED', arrivalDate: spec.arrivalDate, createdAt: spec.createdAt || '2026-09-25T00:53:49.000Z' }
      : null),
    listChargeRefunds: async (chargeId) => {
      refundLookups.push(chargeId)
      return (opts.chargeRefunds && opts.chargeRefunds[chargeId]) || []
    },
    listStripePayouts: async () => [{ payoutId: spec.payoutId, status: 'paid', amountMinor: payoutAmount, currency: 'AED', arrivalDate: spec.arrivalDate }],
    listPayoutBalanceTransactions: async () => txns,
    loadWebsiteOrdersByIntents: async (ids) => orders.filter((o) => ids.includes(o.stripePaymentIntentId)),
    findZohoInvoicesByReference: async (ref) => invoices[ref] || [],
    findZohoPaymentsByReference: async (ref) => payments.filter((p) => p.referenceNumber === ref).map(({ detail, ...p }) => p),
    findZohoJournalsByReference: async (ref) => journals.filter((j) => j.referenceNumber === ref).map((j) => ({ journalId: j.journalId, referenceNumber: j.referenceNumber })),
    getZohoJournal: async (id) => {
      const j = journals.find((x) => x.journalId === id)
      return j ? { journalId: j.journalId, referenceNumber: j.referenceNumber, journalDate: j.journalDate || '2026-09-28', status: j.status || 'published', lineItems: j.lineItems } : null
    },
    listZohoJournalsInRange: async (start, end) => {
      journalRanges.push([start, end])
      return journals
        .map((j) => ({ journalId: j.journalId, entryNumber: j.entryNumber || null, referenceNumber: j.referenceNumber, notes: j.notes || '', journalDate: j.journalDate || '2026-09-28', status: j.status || 'published', total: j.lineItems.filter((l) => l.debitOrCredit === 'debit').reduce((s, l) => s + l.amount, 0) }))
        .filter((j) => j.journalDate >= start && j.journalDate <= end)
    },
    createStripeRefund: deny('createStripeRefund'),
  }
  const zohoPayments = {
    listZohoChartAccounts: async () => opts.accounts || ACCOUNTS,
    getZohoCustomerPayment: async (id) => {
      const p = payments.find((x) => x.paymentId === id)
      return p ? p.detail : null
    },
    createZohoCustomerPayment: deny('createZohoCustomerPayment'),
    createZohoJournal: deny('createZohoJournal'),
    createZohoManualJournal: deny('createZohoManualJournal'),
  }
  const recordReaders = {
    loadAdvanceCases: async (chargeIds) => records.cases.filter((c) => chargeIds.includes(c.chargeId)),
    loadComponents: async (payoutId) => records.components.filter((c) => c.payoutId === payoutId),
    loadCaseEvents: async (ids) => records.events.filter((e) => ids.includes(e.entityId)),
  }
  const cfg = opts.config || config
  return { deps: { config: cfg, sources, zohoPayments, records: recordReaders }, writes, refundLookups, journalRanges, records, run: () => previewPayout(spec.payoutId, { config: cfg, sources, zohoPayments, records: recordReaders }) }
}

// ── The real AED 35 refund on order 21111 (after the payout, not in it) ────

const ADVANCE_PI = 'pi_3UIA7CDJogiiRoKP0Qy1oodM'
const REFUND_ID = 're_3UIA7CDJogiiRoKP0noUu0UZ'
const REFUND_BT = 'txn_3UIA7CDJogiiRoKP0qGO7307'

function realRefund(patch = {}, btPatch = {}) {
  return {
    refundId: REFUND_ID,
    chargeId: 'ch_3UIA7CDJogiiRoKP07RCqZKw',
    paymentIntentId: ADVANCE_PI,
    amountMinor: 3500,
    currency: 'AED',
    status: 'succeeded',
    createdAt: '2026-09-28T07:09:27.000Z',
    balanceTransaction: { balanceTransactionId: REFUND_BT, type: 'refund', currency: 'AED', amountMinor: -3500, feeMinor: 0, netMinor: -3500, ...btPatch },
    ...patch,
  }
}

/** World options for order 21111 with Stripe refunds already on the charge. */
function refunded(refunds = [realRefund()], refundedMinor = refunds.reduce((s, r) => s + (r.status === 'succeeded' ? r.amountMinor : 0), 0), rowPatch = {}) {
  return { rows: { 21111: { refundedMinor, ...rowPatch } }, chargeRefunds: { 'ch_3UIA7CDJogiiRoKP07RCqZKw': refunds } }
}

/** A Zoho customer payment exactly matching a preview component. */
function zohoPaymentFor(component, customerId, paymentId, patch = {}) {
  return {
    paymentId,
    customerId,
    referenceNumber: component.reference,
    amount: component.amount,
    detail: {
      payment_id: paymentId,
      customer_id: customerId,
      reference_number: component.reference,
      amount: component.amount,
      account_id: component.depositAccountId,
      invoices: component.allocations.map((a) => ({ invoice_id: a.invoiceId, amount_applied: a.amount })),
      ...patch,
    },
  }
}

function advanceJournal(journalId, customerId, amount, patch = {}) {
  return {
    journalId,
    referenceNumber: patch.referenceNumber || advRef(CURRENT_ID),
    lineItems: patch.lineItems || [
      { accountId: A1019, accountName: 'Stripe Undeposited Funds', debitOrCredit: 'debit', amount, customerId: '' },
      { accountId: patch.creditAccountId || A1123, accountName: 'Customer Advance Funds', debitOrCredit: 'credit', amount, customerId },
    ],
  }
}

function confirmedCase(overrides = {}) {
  return {
    id: '1',
    payoutId: CURRENT_ID,
    zohoCustomerId: WEB,
    customerName: 'Website',
    orderNumber: '21111',
    invoiceId: invoiceId('INV-044122'),
    invoiceNumber: 'INV-044122',
    paymentIntentId: 'pi_3UIA7CDJogiiRoKP0Qy1oodM',
    chargeId: ADVANCE_CHARGE,
    currency: 'AED',
    stripeGross: 1101,
    stripeNet: 1068.07,
    stripeFee: 32.93,
    invoiceTotal: 1066,
    overpaymentAmount: 35,
    netAllocation: 1033.07,
    customerAdvanceAccountId: A1123,
    status: 'CONFIRMED',
    adminConfirmed: true,
    confirmedBy: 'user:1',
    confirmedAt: '2026-09-27T10:00:00.000Z',
    reason: 'Paid product removed after payment before invoicing. No refund was issued.',
    refundStatus: 'NOT_REFUNDED',
    ...overrides,
  }
}

const group = (result, customerId) => result.groups.find((g) => g.customerId === customerId)
const component = (g, kind) => g.components.find((c) => c.component === kind)
const line = (g, chargeId) => g.lines.find((l) => l.chargeId === chargeId)

// ── Customer shapes ─────────────────────────────────────────────────────────

test('Website-only payout: one READY group, NET and FEE only', async () => {
  const w = world(CURRENT, { only: [WEB], rows: { 21111: { orderTotal: 1101 } } })
  const result = await w.run()
  assert.deepEqual(result.customersPresent, ['Website'])
  const web = group(result, WEB)
  assert.equal(web.status, GROUP_STATUS.READY)
  assert.deepEqual(web.components.map((c) => c.component), ['NET', 'FEE'])
  assert.equal(web.totals.netTo1019, 3348.48)
  assert.equal(web.totals.feeTo1013, 107.22)
  assert.equal(result.status, PAYOUT_STATUS.READY)
  assert.equal(result.reconciliation.payoutMatches, true)
  assert.deepEqual(w.writes, [])
})

test('Burjman-only payout: one READY group with exact figures', async () => {
  const w = world(CURRENT, { only: [SHOP] })
  const result = await w.run()
  assert.deepEqual(result.customersPresent, ['Burjman Shop - Web & App'])
  const shop = group(result, SHOP)
  assert.equal(shop.status, GROUP_STATUS.READY)
  assert.deepEqual(shop.totals, { invoiceGross: 1243.55, netTo1019: 1203.49, customerAdvance: 0, total1019: 1203.49, feeTo1013: 40.06, stripeGross: 1243.55 })
  assert.equal(result.reconciliation.payoutAmount, 1203.49)
  assert.equal(result.status, PAYOUT_STATUS.READY)
})

test('both customers: separate groups, invoices never mixed', async () => {
  const w = world(CURRENT, { rows: { 21111: { orderTotal: 1101 } } })
  const result = await w.run()
  const web = group(result, WEB)
  const shop = group(result, SHOP)
  assert.equal(web.status, GROUP_STATUS.READY)
  assert.equal(shop.status, GROUP_STATUS.READY)
  const webInvoices = new Set(component(web, 'NET').allocations.map((a) => a.invoiceNumber))
  const shopInvoices = new Set(component(shop, 'NET').allocations.map((a) => a.invoiceNumber))
  assert.deepEqual([...shopInvoices], ['INV-044103', 'INV-044120', 'INV-044093', 'INV-044038'])
  assert.ok([...webInvoices].every((n) => !shopInvoices.has(n)))
  assert.equal(component(web, 'NET').payload.customer_id, WEB)
  assert.equal(component(shop, 'NET').payload.customer_id, SHOP)
  assert.equal(component(shop, 'FEE').payload.customer_id, SHOP)
})

// ── Customer advance: candidate → confirmation → READY_WITH_CUSTOMER_ADVANCE ──

test('order 21111 is a customer advance candidate that requires admin confirmation', async () => {
  const w = world(CURRENT)
  const result = await w.run()
  const web = group(result, WEB)
  const l = line(web, ADVANCE_CHARGE)
  assert.equal(l.state, LINE_STATE.OPEN)
  assert.deepEqual(
    { gross: l.gross, invoiceTotal: l.invoiceTotal, customerAdvance: l.customerAdvance, netAllocation: l.netAllocation, feeAllocation: l.feeAllocation },
    { gross: 1101, invoiceTotal: 1066, customerAdvance: 35, netAllocation: 1033.07, feeAllocation: 32.93 },
  )
  assert.equal(l.invoice.invoiceNumber, 'INV-044122')
  assert.equal(l.paymentIntentId, 'pi_3UIA7CDJogiiRoKP0Qy1oodM')
  assert.equal(l.advance.caseStatus, 'CUSTOMER_ADVANCE_REVIEW_REQUIRED')
  assert.equal(l.advance.confirmed, false)
  assert.equal(l.advance.refundStatus, 'NOT_REFUNDED')
  assert.equal(l.advance.refund, null)
  assert.equal(l.refund, null)
  assert.deepEqual(w.refundLookups, [])
  assert.equal(web.status, GROUP_STATUS.NEEDS_REVIEW)
  assert.equal(web.advanceReviewRequired, true)
  assert.ok(web.reasons.some((r) => r.includes('needs admin confirmation')))
  assert.equal(web.postable, false)
  // Never auto-approved, and the proposed journal is still shown for the admin.
  const adv = component(web, 'CUSTOMER_ADVANCE')
  assert.equal(adv.amount, 35)
  assert.deepEqual(adv.advanceCaseIds, [])
  // Burjman is not blocked by the Website review.
  assert.equal(group(result, SHOP).status, GROUP_STATUS.READY)
  assert.equal(group(result, SHOP).postable, true)
  assert.equal(result.status, PAYOUT_STATUS.NEEDS_REVIEW)
  assert.deepEqual(w.writes, [])
})

test('a confirmed case makes the Website group READY_WITH_CUSTOMER_ADVANCE with exact figures', async () => {
  const w = world(CURRENT, { cases: [confirmedCase()] })
  const result = await w.run()
  const web = group(result, WEB)
  assert.equal(web.status, GROUP_STATUS.READY_WITH_CUSTOMER_ADVANCE)
  assert.equal(web.postable, true)
  assert.deepEqual(web.totals, { invoiceGross: 3420.7, netTo1019: 3313.48, customerAdvance: 35, total1019: 3348.48, feeTo1013: 107.22, stripeGross: 3455.7 })
  assert.deepEqual(web.checks, { total1019PlusFeeEqualsGross: true, netPlusFeeEqualsInvoices: true, everyLineBalances: true })
  const net = component(web, 'NET')
  const fee = component(web, 'FEE')
  assert.equal(net.allocations.find((a) => a.invoiceNumber === 'INV-044122').amount, 1033.07)
  assert.equal(fee.allocations.find((a) => a.invoiceNumber === 'INV-044122').amount, 32.93)
  assert.deepEqual(component(web, 'CUSTOMER_ADVANCE').advanceCaseIds, ['1'])
  assert.equal(line(web, ADVANCE_CHARGE).advance.confirmedBy, 'user:1')
  assert.equal(result.status, PAYOUT_STATUS.READY)
  assert.deepEqual(result.reconciliation, {
    netTo1019: 4516.97,
    customerAdvances: 35,
    total1019: 4551.97,
    advanceRefundsOutOf1019: 0,
    fees: 147.28,
    payoutAmount: 4551.97,
    stripeGross: 4699.25,
    total1019PlusFees: 4699.25,
    payoutMatches: true,
    grossMatches: true,
  })
})

test('the advance is not revenue: invoices get exactly their totals, 35.00 goes Dr 1019 / Cr 1123', async () => {
  const result = await world(CURRENT, { cases: [confirmedCase()] }).run()
  const web = group(result, WEB)
  const net = component(web, 'NET')
  const fee = component(web, 'FEE')
  const adv = component(web, 'CUSTOMER_ADVANCE')
  const applied = new Map()
  for (const a of [...net.allocations, ...fee.allocations]) applied.set(a.invoiceNumber, Math.round((applied.get(a.invoiceNumber) || 0) * 100 + a.amount * 100) / 100)
  assert.equal(applied.get('INV-044122'), 1066)
  assert.equal([...applied.values()].reduce((s, v) => s + Math.round(v * 100), 0), 342070)
  assert.equal(adv.allocations.length, 0)
  assert.equal(adv.creditAccountId, A1123)
  assert.equal(adv.creditAccount.accountCode, '1123')
  assert.equal(adv.debitAccountId, A1019)
  assert.equal(adv.reference, advRef(CURRENT_ID))
  assert.deepEqual(adv.payload, {
    journal_date: '2026-09-28',
    reference_number: advRef(CURRENT_ID),
    journal_type: 'both',
    line_items: [
      { account_id: A1019, debit_or_credit: 'debit', amount: 35 },
      { account_id: A1123, customer_id: WEB, debit_or_credit: 'credit', amount: 35 },
    ],
  })
  assert.ok(!JSON.stringify(adv.payload).includes('A1260'))
})

test('NET and FEE payloads are exact, neutral and carry no notes or description', async () => {
  const result = await world(CURRENT, { cases: [confirmedCase()] }).run()
  const web = group(result, WEB)
  const net = component(web, 'NET').payload
  const fee = component(web, 'FEE').payload
  assert.deepEqual(net, {
    customer_id: WEB,
    payment_mode: 'Stripe',
    amount: 3313.48,
    date: '2026-09-28',
    reference_number: netRef(CURRENT_ID),
    account_id: A1019,
    invoices: [
      { invoice_id: invoiceId('INV-044122'), amount_applied: 1033.07 },
      { invoice_id: invoiceId('INV-044102'), amount_applied: 73.28 },
      { invoice_id: invoiceId('INV-044100'), amount_applied: 178.34 },
      { invoice_id: invoiceId('INV-044088'), amount_applied: 1066.13 },
      { invoice_id: invoiceId('INV-044059'), amount_applied: 410.85 },
      { invoice_id: invoiceId('INV-044062'), amount_applied: 45.22 },
      { invoice_id: invoiceId('INV-044099'), amount_applied: 506.59 },
    ],
  })
  assert.equal(fee.amount, 107.22)
  assert.equal(fee.account_id, A1013)
  assert.equal(fee.reference_number, feeRef(CURRENT_ID))
  assert.deepEqual(fee.invoices.map((i) => i.amount_applied), [32.93, 3.22, 6.36, 32.87, 13.3, 2.38, 16.16])
  const all = result.groups.flatMap((g) => g.components.map((c) => c.payload))
  for (const p of all) {
    assert.ok(!('notes' in p) && !('description' in p))
    assert.doesNotMatch(JSON.stringify(p), /HR ?& ?BI|HR and BI|hr-attendance|Purchase Planning|Generated from/i)
  }
  const shop = group(result, SHOP)
  assert.equal(component(shop, 'NET').payload.amount, 1203.49)
  assert.equal(component(shop, 'FEE').payload.amount, 40.06)
})

test('the whole fee stays on invoice clearing (no proportional split on the advance)', async () => {
  const result = await world(CURRENT, { cases: [confirmedCase()] }).run()
  const l = line(group(result, WEB), ADVANCE_CHARGE)
  assert.equal(l.feeAllocation, l.fee)
  assert.equal(Math.round((l.netAllocation + l.customerAdvance) * 100), Math.round(l.net * 100))
})

test('a stored case whose figures no longer match Stripe/Zoho sends the group to review', async () => {
  const result = await world(CURRENT, { cases: [confirmedCase({ overpaymentAmount: 30, invoiceTotal: 1071 })] }).run()
  const web = group(result, WEB)
  assert.equal(line(web, ADVANCE_CHARGE).state, LINE_STATE.NEEDS_REVIEW)
  assert.match(line(web, ADVANCE_CHARGE).reason, /differs from Stripe\/Zoho now/)
  assert.equal(web.status, GROUP_STATUS.NEEDS_REVIEW)
})

test('overpayment candidates require every other check to pass', async () => {
  const cases = [
    ['underpayment is not an advance', { orderTotal: 1200 }],
    ['refund reported but Stripe lists none', { refundedMinor: 3500 }],
    ['disputed charge', { disputed: true }],
    ['invoice total differs from order total', { invoiceTotal: 1070 }],
    ['invoice under the other customer', { invoiceCustomer: SHOP }],
    ['website order refund recorded', { order: { refundAmount: 35 } }],
    ['wallet credit could explain the difference', { order: { walletRedeemed: 35 } }],
  ]
  for (const [label, patch] of cases) {
    const result = await world(CURRENT, { rows: { 21111: patch } }).run()
    const l = line(group(result, WEB), ADVANCE_CHARGE)
    assert.equal(l.state, LINE_STATE.NEEDS_REVIEW, label)
    assert.equal(l.advance, null, label)
    assert.equal(group(result, WEB).status, GROUP_STATUS.NEEDS_REVIEW, label)
  }
})

// ── Refund already on the charge before confirmation ────────────────────────

test('an exact later refund keeps order 21111 a customer advance candidate with REFUND_DETECTED', async () => {
  const w = world(CURRENT, refunded())
  const result = await w.run()
  const web = group(result, WEB)
  const l = line(web, ADVANCE_CHARGE)
  assert.deepEqual(w.refundLookups, [ADVANCE_CHARGE])
  assert.equal(l.state, LINE_STATE.OPEN)
  assert.equal(l.matchStatus, 'MATCHED_READY_TO_CLEAR')
  assert.deepEqual(
    { gross: l.gross, net: l.net, fee: l.fee, invoiceTotal: l.invoiceTotal, netAllocation: l.netAllocation, feeAllocation: l.feeAllocation, customerAdvance: l.customerAdvance },
    { gross: 1101, net: 1068.07, fee: 32.93, invoiceTotal: 1066, netAllocation: 1033.07, feeAllocation: 32.93, customerAdvance: 35 },
  )
  assert.equal(l.advance.caseStatus, 'CUSTOMER_ADVANCE_REVIEW_REQUIRED')
  assert.equal(l.advance.confirmed, false)
  assert.equal(l.advance.refundStatus, 'REFUND_DETECTED')
  assert.deepEqual(l.advance.refund, {
    refundId: REFUND_ID,
    balanceTransactionId: REFUND_BT,
    amount: 35,
    fee: 0,
    net: -35,
    currency: 'AED',
    status: 'succeeded',
    createdAt: '2026-09-28T07:09:27.000Z',
    refundPayoutId: null,
  })
  assert.equal(l.refund.matchesAdvance, true)
  assert.match(l.reason, /re_3UIA7CDJogiiRoKP0noUu0UZ/)
  // Detection alone never makes the group postable.
  assert.equal(web.status, GROUP_STATUS.NEEDS_REVIEW)
  assert.equal(web.postable, false)
  assert.equal(web.advanceReviewRequired, true)
  assert.ok(web.reasons.some((r) => r.includes('needs admin confirmation') && r.includes(REFUND_ID)))
  assert.equal(component(web, 'CUSTOMER_ADVANCE').amount, 35)
  assert.equal(group(result, SHOP).status, GROUP_STATUS.READY)
  assert.equal(result.status, PAYOUT_STATUS.NEEDS_REVIEW)
  assert.deepEqual(result.blockers, [])
  assert.deepEqual(result.advanceRefunds, [])
  assert.deepEqual(w.writes, [])
})

test('the later refund does not change the original payout figures or reconciliation', async () => {
  const before = await world(CURRENT).run()
  const after = await world(CURRENT, refunded()).run()
  for (const customerId of [WEB, SHOP]) {
    assert.deepEqual(group(after, customerId).totals, group(before, customerId).totals)
    assert.deepEqual(group(after, customerId).components.map((c) => c.payload), group(before, customerId).components.map((c) => c.payload))
  }
  assert.deepEqual(group(after, WEB).totals, { invoiceGross: 3420.7, netTo1019: 3313.48, customerAdvance: 35, total1019: 3348.48, feeTo1013: 107.22, stripeGross: 3455.7 })
  assert.deepEqual(group(after, SHOP).totals, { invoiceGross: 1243.55, netTo1019: 1203.49, customerAdvance: 0, total1019: 1203.49, feeTo1013: 40.06, stripeGross: 1243.55 })
  assert.deepEqual(after.reconciliation, before.reconciliation)
  assert.deepEqual(after.reconciliation, {
    netTo1019: 4516.97,
    customerAdvances: 35,
    total1019: 4551.97,
    advanceRefundsOutOf1019: 0,
    fees: 147.28,
    payoutAmount: 4551.97,
    stripeGross: 4699.25,
    total1019PlusFees: 4699.25,
    payoutMatches: true,
    grossMatches: true,
  })
  const l = line(group(after, WEB), ADVANCE_CHARGE)
  assert.equal(Math.round((l.netAllocation + l.customerAdvance) * 100), 106807)
  assert.equal(Math.round((l.netAllocation + l.customerAdvance + l.feeAllocation) * 100), 110100)
})

test('after confirmation the group is READY_WITH_CUSTOMER_ADVANCE even though the refund exists', async () => {
  const stored = confirmedCase({ refundStatus: 'REFUND_DETECTED', refundId: REFUND_ID, refundBalanceTransactionId: REFUND_BT, refundAmount: 35 })
  const result = await world(CURRENT, { ...refunded(), cases: [stored] }).run()
  const web = group(result, WEB)
  assert.equal(web.status, GROUP_STATUS.READY_WITH_CUSTOMER_ADVANCE)
  assert.equal(web.postable, true)
  assert.deepEqual(web.components.map((c) => [c.component, c.amount]), [['NET', 3313.48], ['FEE', 107.22], ['CUSTOMER_ADVANCE', 35]])
  assert.deepEqual(component(web, 'CUSTOMER_ADVANCE').advanceCaseIds, ['1'])
  const l = line(web, ADVANCE_CHARGE)
  assert.equal(l.advance.refundStatus, 'REFUND_DETECTED')
  assert.equal(l.advance.refund.refundPayoutId, null)
  assert.equal(result.status, PAYOUT_STATUS.READY)
  assert.equal(result.reconciliation.total1019, 4551.97)
})

test('a refund that is not exactly the later-returned overpayment sends the charge to review', async () => {
  const cases = [
    ['refund smaller than the overpayment', refunded([realRefund({ amountMinor: 3000 }, { amountMinor: -3000, netMinor: -3000 })]), /less than the overpayment 35/],
    ['refund larger than the overpayment', refunded([realRefund({ amountMinor: 4000 }, { amountMinor: -4000, netMinor: -4000 })]), /more than the overpayment 35/],
    ['refund on a different charge', refunded([realRefund({ chargeId: 'ch_3UI3iPDJogiiRoKP0wqqBVBj' })]), /is not on charge/],
    ['refund on a different PaymentIntent', refunded([realRefund({ paymentIntentId: 'pi_3UI3iPDJogiiRoKP0FqNKZix' })]), /is not on charge/],
    ['refund with a Stripe fee', refunded([realRefund({}, { feeMinor: 100, netMinor: -3600 })]), /has a fee of 1/],
    ['refund created before the original payout', refunded([realRefund({ createdAt: '2026-09-24T10:00:00.000Z' })]), /not created after the original payout/],
    ['two refunds adding up to the overpayment', refunded([realRefund({ amountMinor: 2000 }), realRefund({ refundId: 're_SECOND0000001', amountMinor: 1500 })]), /2 refunds exist/],
    ['pending refund', refunded([realRefund({ status: 'pending' })], 3500), /status is pending/],
    ['refund in another currency', refunded([realRefund({ currency: 'USD' })]), /in USD/],
    ['charge fully refunded', refunded([realRefund()], 3500, { fullyRefunded: true }), /fully refunded/],
    ['charge not succeeded', refunded([realRefund()], 3500, { chargeStatus: 'pending' }), /charge status is pending/],
    ['refund without a balance transaction', refunded([realRefund({ balanceTransaction: null })]), /no balance transaction/],
  ]
  for (const [label, opts, reason] of cases) {
    const result = await world(CURRENT, opts).run()
    const web = group(result, WEB)
    const l = line(web, ADVANCE_CHARGE)
    assert.equal(l.state, LINE_STATE.NEEDS_REVIEW, label)
    assert.equal(l.advance, null, label)
    assert.equal(l.refund.status, 'REFUND_MISMATCH', label)
    assert.equal(l.refund.matchesAdvance, false, label)
    assert.match(l.reason, reason, label)
    assert.equal(web.status, GROUP_STATUS.NEEDS_REVIEW, label)
    assert.equal(web.postable, false, label)
    assert.ok(!component(web, 'CUSTOMER_ADVANCE'), label)
  }
})

test('a refund whose balance transaction is inside the original payout is not a later refund', async () => {
  const inPayout = { balanceTransactionId: REFUND_BT, type: 'refund', reportingCategory: 'refund', currency: 'AED', amountMinor: -3500, feeMinor: 0, netMinor: -3500, sourceId: REFUND_ID, chargeId: ADVANCE_CHARGE, paymentIntentId: ADVANCE_PI, refundStatus: 'succeeded' }
  const result = await world(CURRENT, { ...refunded(), extraTxns: [inPayout] }).run()
  const l = line(group(result, WEB), ADVANCE_CHARGE)
  assert.equal(l.state, LINE_STATE.NEEDS_REVIEW)
  assert.equal(l.refund.status, 'REFUND_MISMATCH')
  assert.match(l.reason, /inside the original payout/)
  assert.equal(result.status, PAYOUT_STATUS.NEEDS_REVIEW)
})

test('a stored case whose recorded refund differs from Stripe now needs review', async () => {
  const other = confirmedCase({ refundStatus: 'REFUND_DETECTED', refundId: 're_SOMETHINGELSE1', refundBalanceTransactionId: REFUND_BT, refundAmount: 35 })
  const l1 = line(group(await world(CURRENT, { ...refunded(), cases: [other] }).run(), WEB), ADVANCE_CHARGE)
  assert.equal(l1.state, LINE_STATE.NEEDS_REVIEW)
  assert.match(l1.reason, /records refund re_SOMETHINGELSE1/)

  const gone = confirmedCase({ refundStatus: 'REFUND_DETECTED', refundId: REFUND_ID, refundBalanceTransactionId: REFUND_BT, refundAmount: 35 })
  const l2 = line(group(await world(CURRENT, { cases: [gone] }).run(), WEB), ADVANCE_CHARGE)
  assert.equal(l2.state, LINE_STATE.NEEDS_REVIEW)
  assert.match(l2.reason, /no longer shows it/)
})

// ── Duplicate protection ────────────────────────────────────────────────────

async function readyComponents() {
  const result = await world(CURRENT, { cases: [confirmedCase()] }).run()
  const web = group(result, WEB)
  return { net: component(web, 'NET'), fee: component(web, 'FEE'), adv: component(web, 'CUSTOMER_ADVANCE'), shop: group(result, SHOP) }
}

function balancesAfter(...components) {
  const out = {}
  for (const r of CURRENT.rows) out[r.invoiceNumber] = r.invoiceTotal ?? orderTotal(r)
  const byId = new Map(CURRENT.rows.map((r) => [invoiceId(r.invoiceNumber), r.invoiceNumber]))
  for (const c of components) for (const a of c.allocations) {
    const n = byId.get(a.invoiceId)
    out[n] = Math.round(out[n] * 100 - a.amount * 100) / 100
  }
  return out
}

test('duplicate NET: a matching payment is verified; reference alone is never enough', async () => {
  const { net } = await readyComponents()
  const match = world(CURRENT, { cases: [confirmedCase()], payments: [zohoPaymentFor(net, WEB, 'ZP-NET')], balances: balancesAfter(net) })
  const web = group(await match.run(), WEB)
  assert.equal(component(web, 'NET').zoho.state, ZOHO_STATE.VERIFIED)
  assert.equal(component(web, 'NET').recovery.action, RECOVERY_ACTION.SKIP_VERIFIED)

  const variants = [
    ['amount', { amount: 3313.47 }],
    ['account', { account_id: A1013 }],
    ['customer', { customer_id: SHOP }],
    ['allocation', { invoices: net.allocations.map((a, i) => ({ invoice_id: a.invoiceId, amount_applied: i === 0 ? 1068.07 : a.amount })) }],
  ]
  for (const [label, patch] of variants) {
    const w = world(CURRENT, { cases: [confirmedCase()], payments: [zohoPaymentFor(net, WEB, 'ZP-NET', patch)] })
    const g = group(await w.run(), WEB)
    assert.equal(component(g, 'NET').zoho.state, ZOHO_STATE.CONFLICT, label)
    assert.equal(component(g, 'NET').recovery.action, RECOVERY_ACTION.NEEDS_REVIEW, label)
    assert.equal(g.status, GROUP_STATUS.NEEDS_REVIEW, label)
  }

  const twice = world(CURRENT, { cases: [confirmedCase()], payments: [zohoPaymentFor(net, WEB, 'ZP-1'), zohoPaymentFor(net, WEB, 'ZP-2')] })
  assert.equal(component(group(await twice.run(), WEB), 'NET').zoho.state, ZOHO_STATE.CONFLICT)

  // Same reference under the other customer belongs to that customer's group only.
  const other = world(CURRENT, { cases: [confirmedCase()], payments: [{ ...zohoPaymentFor(net, SHOP, 'ZP-SHOP'), customerId: SHOP }] })
  const r = await other.run()
  assert.equal(component(group(r, WEB), 'NET').zoho.state, ZOHO_STATE.MISSING)
  assert.equal(component(group(r, SHOP), 'NET').zoho.state, ZOHO_STATE.CONFLICT)
})

test('duplicate FEE: verified only on reference + customer + account + amount + allocations', async () => {
  const { net, fee } = await readyComponents()
  const ok = world(CURRENT, { cases: [confirmedCase()], payments: [zohoPaymentFor(net, WEB, 'ZP-NET'), zohoPaymentFor(fee, WEB, 'ZP-FEE')], balances: balancesAfter(net, fee) })
  const web = group(await ok.run(), WEB)
  assert.equal(component(web, 'FEE').zoho.state, ZOHO_STATE.VERIFIED)
  assert.equal(component(web, 'FEE').zoho.recordId, 'ZP-FEE')

  const wrongAccount = world(CURRENT, { cases: [confirmedCase()], payments: [zohoPaymentFor(fee, WEB, 'ZP-FEE', { account_id: A1019 })] })
  const g = group(await wrongAccount.run(), WEB)
  assert.equal(component(g, 'FEE').zoho.state, ZOHO_STATE.CONFLICT)
  assert.ok(component(g, 'FEE').zoho.differences.some((d) => d.includes('Deposited to')))
})

test('duplicate journal: verified only with reference, customer tag, Dr 1019, Cr 1123 and amount', async () => {
  const { net, fee } = await readyComponents()
  const base = { cases: [confirmedCase()], payments: [zohoPaymentFor(net, WEB, 'ZP-NET'), zohoPaymentFor(fee, WEB, 'ZP-FEE')], balances: balancesAfter(net, fee) }
  const verified = group(await world(CURRENT, { ...base, journals: [advanceJournal('ZJ-1', WEB, 35)] }).run(), WEB)
  assert.equal(component(verified, 'CUSTOMER_ADVANCE').zoho.state, ZOHO_STATE.VERIFIED)
  assert.equal(verified.status, GROUP_STATUS.ALREADY_POSTED)

  const bad = [
    ['untagged', advanceJournal('ZJ-1', '', 35)],
    ['wrong credit account', advanceJournal('ZJ-1', WEB, 35, { creditAccountId: 'A1260' })],
    ['wrong amount', advanceJournal('ZJ-1', WEB, 30)],
    ['extra line', advanceJournal('ZJ-1', WEB, 35, { lineItems: [
      { accountId: A1019, debitOrCredit: 'debit', amount: 35 },
      { accountId: A1123, debitOrCredit: 'credit', amount: 20, customerId: WEB },
      { accountId: A1123, debitOrCredit: 'credit', amount: 15, customerId: WEB },
    ] })],
  ]
  for (const [label, journal] of bad) {
    const g = group(await world(CURRENT, { ...base, journals: [journal] }).run(), WEB)
    assert.equal(component(g, 'CUSTOMER_ADVANCE').zoho.state, ZOHO_STATE.CONFLICT, label)
    assert.equal(g.status, GROUP_STATUS.NEEDS_REVIEW, label)
  }

  // A journal tagged to Burjman does not satisfy Website, and is unexpected for Burjman.
  const r = await world(CURRENT, { ...base, journals: [advanceJournal('ZJ-SHOP', SHOP, 35)] }).run()
  assert.equal(component(group(r, WEB), 'CUSTOMER_ADVANCE').zoho.state, ZOHO_STATE.MISSING)
  assert.equal(group(r, SHOP).status, GROUP_STATUS.NEEDS_REVIEW)
  assert.ok(group(r, SHOP).reasons.some((x) => x.includes('customer advance journal')))
})

// ── Partial failure recovery ────────────────────────────────────────────────

test('partial recovery: verified NET is kept, FEE and journal are retry-eligible', async () => {
  const { net, fee, adv } = await readyComponents()
  const w = world(CURRENT, {
    cases: [confirmedCase()],
    payments: [zohoPaymentFor(net, WEB, 'ZP-NET')],
    balances: balancesAfter(net),
    components: [
      { payoutId: CURRENT_ID, zohoCustomerId: WEB, component: 'NET', status: 'VERIFIED', zohoRecordId: 'ZP-NET', attemptCount: 1 },
      { payoutId: CURRENT_ID, zohoCustomerId: WEB, component: 'FEE', status: 'FAILED', zohoRecordId: null, attemptCount: 1, lastError: 'Zoho 500' },
    ],
  })
  const web = group(await w.run(), WEB)
  assert.equal(web.status, GROUP_STATUS.PARTIALLY_POSTED)
  assert.deepEqual(web.components.map((c) => [c.component, c.recovery.action]), [
    ['NET', RECOVERY_ACTION.SKIP_VERIFIED],
    ['FEE', RECOVERY_ACTION.RETRY_ELIGIBLE],
    ['CUSTOMER_ADVANCE', RECOVERY_ACTION.POST_ELIGIBLE],
  ])
  assert.equal(web.postable, true)
  assert.equal(component(web, 'FEE').local.lastError, 'Zoho 500')
  assert.ok(fee && adv)

  // Invoices are partly paid by exactly the verified NET, so nothing looks external.
  assert.ok(web.lines.every((l) => l.state === LINE_STATE.PARTIALLY_CLEARED))
})

test('partial recovery: all verified is POSTED, unknown Zoho state or a removed record needs review', async () => {
  const { net, fee } = await readyComponents()
  const everything = { cases: [confirmedCase()], payments: [zohoPaymentFor(net, WEB, 'ZP-NET'), zohoPaymentFor(fee, WEB, 'ZP-FEE')], journals: [advanceJournal('ZJ-1', WEB, 35)], balances: balancesAfter(net, fee) }
  const tracked = ['NET', 'FEE', 'CUSTOMER_ADVANCE'].map((kind, i) => ({ payoutId: CURRENT_ID, zohoCustomerId: WEB, component: kind, status: 'VERIFIED', zohoRecordId: ['ZP-NET', 'ZP-FEE', 'ZJ-1'][i], attemptCount: 1 }))
  const posted = await world(CURRENT, { ...everything, components: tracked }).run()
  assert.equal(group(posted, WEB).status, GROUP_STATUS.POSTED)
  // Burjman is still open: the payout is partially cleared, not fully.
  assert.equal(posted.status, PAYOUT_STATUS.PARTIALLY_CLEARED)

  const inFlight = await world(CURRENT, { cases: [confirmedCase()], components: [{ payoutId: CURRENT_ID, zohoCustomerId: WEB, component: 'FEE', status: 'POSTING', zohoRecordId: null, attemptCount: 1 }] }).run()
  assert.equal(component(group(inFlight, WEB), 'FEE').recovery.action, RECOVERY_ACTION.NEEDS_REVIEW)
  assert.equal(group(inFlight, WEB).status, GROUP_STATUS.NEEDS_REVIEW)

  const removed = await world(CURRENT, { cases: [confirmedCase()], components: [{ payoutId: CURRENT_ID, zohoCustomerId: WEB, component: 'NET', status: 'VERIFIED', zohoRecordId: 'ZP-GONE', attemptCount: 1 }] }).run()
  assert.match(component(group(removed, WEB), 'NET').recovery.reason, /Zoho no longer has it/)

  const otherId = await world(CURRENT, { ...everything, components: [{ ...tracked[0], zohoRecordId: 'ZP-OTHER' }] }).run()
  assert.equal(component(group(otherId, WEB), 'NET').recovery.action, RECOVERY_ACTION.NEEDS_REVIEW)
})

test('an invoice paid outside this payout needs review even with no payout records', async () => {
  const result = await world(CURRENT, { cases: [confirmedCase()], balances: { 'INV-044102': 0 } }).run()
  const web = group(result, WEB)
  assert.equal(web.status, GROUP_STATUS.NEEDS_REVIEW)
  assert.ok(web.reasons.some((r) => r.includes('INV-044102 balance is 0')))
  assert.equal(group(result, SHOP).status, GROUP_STATUS.READY)
})

test('a local component the payout no longer proposes blocks the group', async () => {
  const w = world(CURRENT, { only: [SHOP], components: [{ payoutId: CURRENT_ID, zohoCustomerId: SHOP, component: 'CUSTOMER_ADVANCE', status: 'PLANNED', attemptCount: 0 }] })
  const shop = group(await w.run(), SHOP)
  assert.equal(shop.status, GROUP_STATUS.NEEDS_REVIEW)
})

// ── Reconciliation ──────────────────────────────────────────────────────────

test('hold and release are listed but excluded from clearing', async () => {
  const result = await world(CURRENT, { cases: [confirmedCase()] }).run()
  assert.deepEqual(result.otherTransactions.map((t) => t.net), [-1000, 1000])
  assert.equal(result.composition.otherNet, 0)
  assert.equal(result.composition.reconciles, true)
  assert.ok(result.groups.every((g) => g.components.every((c) => !c.allocations.some((a) => a.amount === 1000))))
  assert.deepEqual(result.advanceRefunds, [])
  assert.equal(result.reconciliation.payoutMatches, true)
})

test('NET + advances must equal the payout, and 1019 + fees must equal gross', async () => {
  const w = world(CURRENT, { cases: [confirmedCase()], payoutAmount: 455197, extraTxns: [{ balanceTransactionId: 'txn_ADJ', type: 'adjustment', currency: 'AED', amountMinor: -500, feeMinor: 0, netMinor: -500 }] })
  const result = await w.run()
  assert.equal(result.composition.reconciles, false)
  assert.equal(result.status, PAYOUT_STATUS.NEEDS_REVIEW)
  assert.ok(result.groups.every((g) => g.status === GROUP_STATUS.NEEDS_REVIEW && !g.postable))
})

test('unconfirmed advance: the figures reconcile, but the payout still needs review', async () => {
  const result = await world(CURRENT).run()
  assert.equal(result.reconciliation.total1019, 4551.97)
  assert.equal(result.reconciliation.grossMatches, true)
  assert.equal(result.status, PAYOUT_STATUS.NEEDS_REVIEW)
})

// ── Historical payout ───────────────────────────────────────────────────────

const A2270 = config.feeExpenseAccountId
function historicalPayments() {
  const webNet = HISTORICAL.rows.filter((r) => r.customer === WEB)
  const alloc = (rows, fn) => rows.map((r) => ({ invoice_id: invoiceId(r.invoiceNumber), amount_applied: fn(r) / 100 }))
  const pay = (id, customerId, ref, amount, accountId, invoices) => ({ paymentId: id, customerId, referenceNumber: ref, amount, detail: { payment_id: id, customer_id: customerId, reference_number: ref, amount, account_id: accountId, invoices } })
  const shopRows = HISTORICAL.rows.filter((r) => r.customer === SHOP)
  return [
    pay('4265011000042060301', WEB, netRef(HISTORICAL_ID), 9995.57, A1019, alloc(webNet, (r) => r.gross - r.fee)),
    pay('4265011000042060462', WEB, feeRef(HISTORICAL_ID), 306.78, A1013, alloc(webNet, (r) => r.fee)),
    pay('4265011000042060425', SHOP, netRef(HISTORICAL_ID), 266.41, A1019, alloc(shopRows, (r) => r.gross - r.fee)),
    pay('4265011000042060586', SHOP, feeRef(HISTORICAL_ID), 8.99, A1013, alloc(shopRows, (r) => r.fee)),
  ]
}
// Shape of the real legacy journal #3943: many Stripe Fees debits (two are this payout's
// Website and Burjman FEE amounts), one 1013 credit for the batch, no customer tags.
const OTHER_FEE_LINES = [120.5, 99.1, 80.25, 60, 49.2, 30.01, 25, 20, 15.5, 12.3, 10.2, 9.9, 7.1, 5.99, 4.5, 3.2, 0.5]
function legacy3943(patch = {}) {
  const debits = [306.78, 8.99, ...OTHER_FEE_LINES]
  const total = Math.round(debits.reduce((s, x) => s + x, 0) * 100) / 100
  return {
    journalId: '4265011000042060622',
    entryNumber: '3943',
    journalDate: '2026-09-04',
    referenceNumber: 'Website&Burjuman stripe transaction fee - 50 Invoices',
    notes: 'Website&Burjuman stripe transaction fee - 50 Invoices',
    lineItems: [...debits.map((amount) => ({ accountId: A2270, debitOrCredit: 'debit', amount })), { accountId: A1013, debitOrCredit: 'credit', amount: total }],
    ...patch,
  }
}
const HIST = { ...HISTORICAL, createdAt: '2026-09-04T00:54:49.000Z' }

test('historical po_1UBlP3 still matches the existing Zoho NET and FEE payments exactly', async () => {
  const w = world(HIST, { payments: historicalPayments(), journals: [legacy3943()] })
  const result = await w.run()
  const web = group(result, WEB)
  const shop = group(result, SHOP)
  assert.equal(component(web, 'NET').amount, 9995.57)
  assert.equal(component(web, 'FEE').amount, 306.78)
  assert.equal(component(shop, 'NET').amount, 266.41)
  assert.equal(component(shop, 'FEE').amount, 8.99)
  assert.equal(component(web, 'NET').zoho.recordId, '4265011000042060301')
  assert.equal(component(shop, 'FEE').zoho.recordId, '4265011000042060586')
  assert.equal(web.status, GROUP_STATUS.ALREADY_POSTED)
  assert.equal(shop.status, GROUP_STATUS.ALREADY_POSTED)
  assert.ok(web.lines.every((l) => l.state === LINE_STATE.CLEARED))
  assert.equal(result.feeJournal.status, FEE_JOURNAL_STATUS.LEGACY_VERIFIED)
  assert.equal(result.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(result.reconciliation.payoutMatches, true)
  assert.equal(result.reconciliation.total1019, 10261.98)
  assert.equal(result.proposedPaymentDate, '2026-09-07')
  assert.deepEqual(w.writes, [])
})

test('historical payout: the legacy #3943 journal is recognised and no new fee journal is offered', async () => {
  const w = world(HIST, { payments: historicalPayments(), journals: [legacy3943()] })
  const fj = (await w.run()).feeJournal
  assert.equal(fj.status, FEE_JOURNAL_STATUS.LEGACY_VERIFIED)
  assert.equal(fj.postable, false)
  assert.equal(fj.amount, 315.77)
  assert.equal(fj.stripeFeeTotal, 315.77)
  assert.equal(fj.verifiedFeeTotal, 315.77)
  assert.equal(fj.zoho.state, 'MISSING')
  assert.equal(fj.legacy.journals.length, 1)
  assert.equal(fj.legacy.journals[0].entryNumber, '3943')
  assert.equal(fj.legacy.journals[0].how, 'CUSTOMER_FEE_LINES')
  assert.deepEqual(fj.legacy.journals[0].matchedLines, [306.78, 8.99])
  assert.match(fj.reasons[0], /Legacy journal #3943/)
  assert.deepEqual(w.journalRanges, [['2026-08-28', '2026-11-06']])
  assert.deepEqual(w.writes, [])
})

test('historical payout without a provable legacy journal needs review and is never auto-posted', async () => {
  const none = (await world(HIST, { payments: historicalPayments() }).run())
  assert.equal(none.feeJournal.status, FEE_JOURNAL_STATUS.NEEDS_REVIEW)
  assert.equal(none.feeJournal.postable, false)
  assert.match(none.feeJournal.reasons[0], /posted outside this workflow/)
  assert.equal(none.status, PAYOUT_STATUS.NEEDS_REVIEW)

  const second = legacy3943({ journalId: 'ZJ-DUP', entryNumber: '3950', journalDate: '2026-09-06' })
  const two = (await world(HIST, { payments: historicalPayments(), journals: [legacy3943(), second] }).run()).feeJournal
  assert.equal(two.status, FEE_JOURNAL_STATUS.NEEDS_REVIEW)
  assert.equal(two.legacy.state, 'AMBIGUOUS')
  assert.equal(two.postable, false)

  const outside = (await world(HIST, { payments: historicalPayments(), journals: [legacy3943({ journalDate: '2026-12-01' })] }).run()).feeJournal
  assert.equal(outside.status, FEE_JOURNAL_STATUS.NEEDS_REVIEW)

  const draft = (await world(HIST, { payments: historicalPayments(), journals: [legacy3943({ status: 'draft' })] }).run()).feeJournal
  assert.equal(draft.status, FEE_JOURNAL_STATUS.NEEDS_REVIEW)
})

// ── Refund linkage (preview only) ───────────────────────────────────────────

const REFUND_PAYOUT = { payoutId: 'po_REFUNDPAYOUT0001', arrivalDate: '2026-10-05T00:00:00.000Z', rows: [CURRENT.rows[1]] }
const refundTxn = (amountMinor, patch = {}) => ({ balanceTransactionId: REFUND_BT, type: 'refund', reportingCategory: 'refund', currency: 'AED', amountMinor: -amountMinor, feeMinor: 0, netMinor: -amountMinor, sourceId: REFUND_ID, chargeId: ADVANCE_CHARGE, paymentIntentId: ADVANCE_PI, refundStatus: 'succeeded', ...patch })

test('a later refund of exactly the advance links charge → case and previews Dr 1123 / Cr 1019', async () => {
  const w = world(REFUND_PAYOUT, { cases: [confirmedCase({ status: 'ADVANCE_POSTED' })], extraTxns: [refundTxn(3500)] })
  const result = await w.run()
  assert.equal(result.advanceRefunds.length, 1)
  const r = result.advanceRefunds[0]
  assert.equal(r.status, 'REFUND_MATCHED')
  assert.equal(r.caseId, '1')
  assert.equal(r.originalPayoutId, CURRENT_ID)
  assert.deepEqual(r.proposedJournal.payload, {
    journal_date: '2026-10-05',
    reference_number: 'Stripe customer advance refund po_REFUNDPAYOUT0001',
    journal_type: 'both',
    line_items: [
      { account_id: A1123, customer_id: WEB, debit_or_credit: 'debit', amount: 35 },
      { account_id: A1019, debit_or_credit: 'credit', amount: 35 },
    ],
  })
  assert.equal(result.reconciliation.advanceRefundsOutOf1019, 35)
  assert.equal(result.reconciliation.payoutMatches, true)
  assert.equal(result.status, PAYOUT_STATUS.READY)
  assert.deepEqual(w.writes, [])
})

const detectedCase = (overrides = {}) => confirmedCase({ refundStatus: 'REFUND_DETECTED', refundId: REFUND_ID, refundBalanceTransactionId: REFUND_BT, refundAmount: 35, ...overrides })

test('a later payout containing the exact refund transaction links it as REFUND_MATCHED', async () => {
  const w = world(REFUND_PAYOUT, { cases: [detectedCase()], extraTxns: [refundTxn(3500)] })
  const result = await w.run()
  const [r] = result.advanceRefunds
  assert.equal(r.status, 'REFUND_MATCHED')
  assert.equal(r.matched, true)
  assert.deepEqual([r.refundId, r.balanceTransactionId, r.chargeId, r.amount, r.caseId, r.originalPayoutId], [REFUND_ID, REFUND_BT, ADVANCE_CHARGE, 35, '1', CURRENT_ID])
  assert.equal(r.proposedJournal.reference, 'Stripe customer advance refund po_REFUNDPAYOUT0001')
  assert.equal(r.proposedJournal.debitAccountId, A1123)
  assert.equal(r.proposedJournal.creditAccountId, A1019)
  assert.equal(r.proposedJournal.payload.line_items[0].customer_id, WEB)
  assert.equal(result.reconciliation.advanceRefundsOutOf1019, 35)
  assert.equal(result.reconciliation.payoutMatches, true)
  assert.deepEqual(result.blockers, [])
  assert.deepEqual(w.writes, [])
})

test('refund linking needs the same refund, transaction, charge, amount, currency, status and a later payout', async () => {
  const cases = [
    ['different refund ID', { cases: [detectedCase()], extraTxns: [refundTxn(3500, { sourceId: 're_OTHERREFUND01' })] }, /records refund re_3UIA7C/],
    ['different balance transaction', { cases: [detectedCase()], extraTxns: [refundTxn(3500, { balanceTransactionId: 'txn_OTHER0000001' })] }, /records refund balance transaction/],
    ['refund not succeeded', { cases: [detectedCase()], extraTxns: [refundTxn(3500, { refundStatus: 'pending' })] }, /status is pending/],
    ['refund with a fee', { cases: [detectedCase()], extraTxns: [refundTxn(3500, { feeMinor: 100, netMinor: -3600 })] }, /fee of 1/],
    ['refund in another currency', { cases: [detectedCase()], extraTxns: [refundTxn(3500, { currency: 'USD' })] }, /does not equal the customer advance/],
    ['case not confirmed', { cases: [detectedCase({ status: 'CUSTOMER_ADVANCE_REVIEW_REQUIRED', adminConfirmed: false })], extraTxns: [refundTxn(3500)] }, /is CUSTOMER_ADVANCE_REVIEW_REQUIRED/],
    ['refund in the advance payout itself', { cases: [detectedCase({ payoutId: REFUND_PAYOUT.payoutId })], extraTxns: [refundTxn(3500)] }, /same payout/],
  ]
  for (const [label, opts, reason] of cases) {
    const result = await world(REFUND_PAYOUT, opts).run()
    const [r] = result.advanceRefunds
    assert.equal(r.status, 'REFUND_MISMATCH', label)
    assert.equal(r.matched, false, label)
    assert.match(r.reason, reason, label)
    assert.equal(r.posting.allowed, false, label)
    assert.equal(r.proposedJournal, null, label)
    assert.equal(result.status, PAYOUT_STATUS.NEEDS_REVIEW, label)
  }
})

test('the refund journal can never post before the original advance journal is verified', async () => {
  const enabled = { ...config, postingEnabled: true }
  const advance = advanceJournal('ZJ-ADV', WEB, 35)

  const missing = await world(REFUND_PAYOUT, { cases: [detectedCase()], extraTxns: [refundTxn(3500)], config: enabled }).run()
  const [m] = missing.advanceRefunds
  assert.equal(m.status, 'REFUND_MATCHED')
  assert.equal(m.originalAdvanceJournal.reference, advRef(CURRENT_ID))
  assert.equal(m.originalAdvanceJournal.state, ZOHO_STATE.MISSING)
  assert.equal(m.posting.allowed, false)
  assert.deepEqual(m.posting.blockers, ['The original Customer Advance journal is not verified in Zoho yet.'])

  const wrong = await world(REFUND_PAYOUT, { cases: [detectedCase()], extraTxns: [refundTxn(3500)], config: enabled, journals: [advanceJournal('ZJ-ADV', WEB, 30)] }).run()
  assert.equal(wrong.advanceRefunds[0].originalAdvanceJournal.state, ZOHO_STATE.CONFLICT)
  assert.equal(wrong.advanceRefunds[0].posting.allowed, false)

  const verified = await world(REFUND_PAYOUT, { cases: [detectedCase({ status: 'ADVANCE_POSTED' })], extraTxns: [refundTxn(3500)], config: enabled, journals: [advance] }).run()
  assert.equal(verified.advanceRefunds[0].originalAdvanceJournal.state, ZOHO_STATE.VERIFIED)
  assert.equal(verified.advanceRefunds[0].originalAdvanceJournal.recordId, 'ZJ-ADV')
  assert.deepEqual(verified.advanceRefunds[0].posting, { allowed: true, blockers: [] })

  // With posting disabled (production), even a verified advance does not allow it.
  const disabled = await world(REFUND_PAYOUT, { cases: [detectedCase({ status: 'ADVANCE_POSTED' })], extraTxns: [refundTxn(3500)], journals: [advance] }).run()
  assert.equal(config.postingEnabled, false)
  assert.deepEqual(disabled.advanceRefunds[0].posting, { allowed: false, blockers: ['Posting is disabled.'] })
  assert.equal(disabled.postingEnabled, false)
})

test('a refund that differs from the advance needs review', async () => {
  const result = await world(REFUND_PAYOUT, { cases: [confirmedCase({ status: 'ADVANCE_POSTED' })], extraTxns: [refundTxn(3000)] }).run()
  assert.equal(result.advanceRefunds[0].status, 'REFUND_MISMATCH')
  assert.equal(result.status, PAYOUT_STATUS.NEEDS_REVIEW)
  assert.ok(result.groups.every((g) => !g.postable))
})

test('after the advance is refunded, the original payout still reads as a confirmed advance', async () => {
  const stored = confirmedCase({ status: 'REFUNDED', refundStatus: 'REFUNDED', refundId: REFUND_ID, refundBalanceTransactionId: REFUND_BT, refundPayoutId: REFUND_PAYOUT.payoutId })
  const result = await world(CURRENT, { ...refunded(), cases: [stored] }).run()
  const web = group(result, WEB)
  const l = line(web, ADVANCE_CHARGE)
  assert.equal(l.advance.confirmed, true)
  assert.equal(l.advance.refundStatus, 'REFUNDED')
  assert.equal(l.advance.refund.refundPayoutId, REFUND_PAYOUT.payoutId)
  assert.equal(web.status, GROUP_STATUS.READY_WITH_CUSTOMER_ADVANCE)
  assert.equal(web.totals.customerAdvance, 35)
})

// ── Misc ────────────────────────────────────────────────────────────────────

test('the Customer Advance account must match name, code, type and ID exactly', async () => {
  const accounts = ACCOUNTS.map((a) => (a.accountCode === '1123' ? { ...a, accountId: '999' } : a))
  const result = await world(CURRENT, { cases: [confirmedCase()], accounts }).run()
  assert.equal(result.accounts.advance, null)
  assert.equal(group(result, WEB).status, GROUP_STATUS.NEEDS_REVIEW)
  // Burjman has no advance, so it does not need 1123.
  assert.equal(group(result, SHOP).status, GROUP_STATUS.READY)
})

test('a payout that is not paid yet can post nothing', async () => {
  const result = await world(CURRENT, { cases: [confirmedCase()], payoutStatus: 'in_transit' }).run()
  assert.ok(result.groups.every((g) => g.status === GROUP_STATUS.NEEDS_REVIEW))
})

test('rejects anything that is not a payout ID', async () => {
  const { deps } = world(CURRENT)
  await assert.rejects(previewPayout('pi_123456789', deps), (err) => err.code === 'INVALID_PAYOUT_ID' && err.status === 400)
  await assert.rejects(previewPayout('po_DOESNOTEXIST1', deps), (err) => err.status === 404)
})

test('payout summaries show Stripe composition without Zoho calls', async () => {
  const { deps } = world(CURRENT)
  deps.sources.findZohoInvoicesByReference = async () => { throw new Error('Zoho must not be called') }
  const { rows } = await listPayoutSummaries({ limit: 5 }, deps)
  assert.equal(rows[0].composition.chargeCount, 11)
  assert.equal(rows[0].composition.chargeGross, 4699.25)
  assert.equal(rows[0].composition.chargeFee, 147.28)
  assert.equal(rows[0].composition.reconciles, true)
})

// ── Admin confirmation (local only) ─────────────────────────────────────────

const { confirmCustomerAdvance, markGrossClearingReversedExternally } = require('../src/services/stripeClearing/stripePayoutClearingService')

/** In-memory stand-in for the case store, sharing records with the preview world. */
function memoryCaseStore(records) {
  let nextId = 1
  return {
    calls: [],
    async confirmCase(_client, candidate, { actor, reason }) {
      this.calls.push({ candidate, actor, reason })
      let c = records.cases.find((x) => x.chargeId === candidate.chargeId)
      if (!c) {
        c = { id: String(nextId++), ...candidate, status: 'CUSTOMER_ADVANCE_REVIEW_REQUIRED', adminConfirmed: false, refundStatus: 'NOT_REFUNDED' }
        records.cases.push(c)
        records.events.push({ entityId: c.id, toStatus: c.status, actor })
      }
      if (c.status !== 'CUSTOMER_ADVANCE_REVIEW_REQUIRED') return { case: c, alreadyConfirmed: true }
      if (candidate.refund && !c.refundId) {
        Object.assign(c, { refundStatus: 'REFUND_DETECTED', refundId: candidate.refund.refundId, refundBalanceTransactionId: candidate.refund.balanceTransactionId, refundAmount: candidate.refund.amount })
        records.events.push({ entityId: c.id, fromStatus: 'NOT_REFUNDED', toStatus: 'REFUND_DETECTED', actor })
      }
      Object.assign(c, { status: 'CONFIRMED', adminConfirmed: true, confirmedBy: actor, confirmedAt: '2026-09-27T12:00:00.000Z', reason })
      records.events.push({ entityId: c.id, fromStatus: 'CUSTOMER_ADVANCE_REVIEW_REQUIRED', toStatus: 'CONFIRMED', actor })
      return { case: c, alreadyConfirmed: false }
    },
    async listEvents(_reader, _type, ids) {
      return records.events.filter((e) => ids.includes(e.entityId))
    },
  }
}

function confirmDeps(w) {
  const payoutStore = memoryCaseStore(w.records)
  return { payoutStore, deps: { payoutStore, reader: {}, withClient: (fn) => fn({}), previewPayout: (id) => previewPayout(id, w.deps) } }
}

const REASON = 'Paid product removed after payment before invoicing. No refund was issued.'

test('Confirm Customer Advance records the case locally and flips the group, with no Zoho writes', async () => {
  const w = world(CURRENT)
  const { payoutStore, deps } = confirmDeps(w)
  const out = await confirmCustomerAdvance(CURRENT_ID, ADVANCE_CHARGE, { actor: 'user:7', reason: REASON }, deps)
  assert.equal(out.alreadyConfirmed, false)
  assert.equal(out.zohoWrites, 0)
  assert.equal(out.case.status, 'CONFIRMED')
  assert.equal(out.case.confirmedBy, 'user:7')
  assert.ok(out.case.confirmedAt)
  assert.deepEqual(out.events.map((e) => e.toStatus), ['CUSTOMER_ADVANCE_REVIEW_REQUIRED', 'CONFIRMED'])
  const c = payoutStore.calls[0].candidate
  assert.deepEqual(
    [c.payoutId, c.zohoCustomerId, c.invoiceNumber, c.orderNumber, c.paymentIntentId, c.chargeId, c.stripeGross, c.invoiceTotal, c.overpaymentAmount, c.netAllocation, c.stripeFee, c.customerAdvanceAccountId, c.advanceReference],
    [CURRENT_ID, WEB, 'INV-044122', '21111', 'pi_3UIA7CDJogiiRoKP0Qy1oodM', ADVANCE_CHARGE, 1101, 1066, 35, 1033.07, 32.93, A1123, advRef(CURRENT_ID)],
  )
  assert.equal(payoutStore.calls[0].reason, REASON)

  const after = await w.run()
  assert.equal(group(after, WEB).status, GROUP_STATUS.READY_WITH_CUSTOMER_ADVANCE)
  assert.equal(after.status, PAYOUT_STATUS.READY)
  assert.deepEqual(w.writes, [])

  const again = await confirmCustomerAdvance(CURRENT_ID, ADVANCE_CHARGE, { actor: 'user:8', reason: REASON }, deps)
  assert.equal(again.alreadyConfirmed, true)
  assert.equal(payoutStore.calls.length, 1)
})

test('an admin can confirm a REFUND_DETECTED candidate; the refund is recorded and audited first', async () => {
  const w = world(CURRENT, refunded())
  const { payoutStore, deps } = confirmDeps(w)
  const out = await confirmCustomerAdvance(CURRENT_ID, ADVANCE_CHARGE, { actor: 'user:7', reason: 'Customer overpaid; the 35.00 difference was refunded in Stripe later.' }, deps)
  assert.equal(out.alreadyConfirmed, false)
  assert.equal(out.zohoWrites, 0)
  assert.deepEqual(payoutStore.calls[0].candidate.refund, { refundId: REFUND_ID, balanceTransactionId: REFUND_BT, amount: 35, createdAt: '2026-09-28T07:09:27.000Z' })
  assert.equal(out.case.status, 'CONFIRMED')
  assert.equal(out.case.refundStatus, 'REFUND_DETECTED')
  assert.equal(out.case.refundId, REFUND_ID)
  assert.deepEqual(out.events.map((e) => e.toStatus), ['CUSTOMER_ADVANCE_REVIEW_REQUIRED', 'REFUND_DETECTED', 'CONFIRMED'])

  const after = await w.run()
  const web = group(after, WEB)
  assert.equal(web.status, GROUP_STATUS.READY_WITH_CUSTOMER_ADVANCE)
  assert.equal(web.postable, true)
  assert.equal(line(web, ADVANCE_CHARGE).advance.refundStatus, 'REFUND_DETECTED')
  assert.deepEqual(web.totals, { invoiceGross: 3420.7, netTo1019: 3313.48, customerAdvance: 35, total1019: 3348.48, feeTo1013: 107.22, stripeGross: 3455.7 })
  assert.equal(after.status, PAYOUT_STATUS.READY)
  assert.deepEqual(w.writes, [])
})

test('Confirm Customer Advance refuses a charge whose refund does not match the overpayment', async () => {
  const w = world(CURRENT, refunded([realRefund({ amountMinor: 3000 }, { amountMinor: -3000, netMinor: -3000 })]))
  const { payoutStore, deps } = confirmDeps(w)
  await assert.rejects(
    confirmCustomerAdvance(CURRENT_ID, ADVANCE_CHARGE, { actor: 'user:1', reason: REASON }, deps),
    (err) => err.code === 'NOT_AN_ADVANCE_CANDIDATE',
  )
  assert.equal(payoutStore.calls.length, 0)
})

test('Confirm Customer Advance refuses non-candidates, missing reasons and changed figures', async () => {
  const w = world(CURRENT)
  const { deps, payoutStore } = confirmDeps(w)
  const code = (c) => (err) => err.code === c
  await assert.rejects(confirmCustomerAdvance(CURRENT_ID, 'ch_3UI3iPDJogiiRoKP0wqqBVBj', { actor: 'user:1', reason: REASON }, deps), code('NOT_AN_ADVANCE_CANDIDATE'))
  await assert.rejects(confirmCustomerAdvance(CURRENT_ID, ADVANCE_CHARGE, { actor: 'user:1', reason: 'ok' }, deps), code('REASON_REQUIRED'))
  await assert.rejects(confirmCustomerAdvance(CURRENT_ID, ADVANCE_CHARGE, { reason: REASON }, deps), code('ACTOR_REQUIRED'))
  await assert.rejects(confirmCustomerAdvance(CURRENT_ID, 'pi_3UIA7CDJogiiRoKP0Qy1oodM', { actor: 'user:1', reason: REASON }, deps), code('INVALID_CHARGE_ID'))

  const paidElsewhere = world(CURRENT, { balances: { 'INV-044122': 500 } })
  await assert.rejects(confirmCustomerAdvance(CURRENT_ID, ADVANCE_CHARGE, { actor: 'user:1', reason: REASON }, confirmDeps(paidElsewhere).deps), code('ADVANCE_CANDIDATE_NOT_OPEN'))

  const changed = world(CURRENT, { cases: [confirmedCase({ status: 'CUSTOMER_ADVANCE_REVIEW_REQUIRED', overpaymentAmount: 30 })] })
  await assert.rejects(confirmCustomerAdvance(CURRENT_ID, ADVANCE_CHARGE, { actor: 'user:1', reason: REASON }, confirmDeps(changed).deps), code('ADVANCE_CANDIDATE_NOT_OPEN'))
  assert.equal(payoutStore.calls.length, 0)
})

// ── GROSS_V1 stale row repair ───────────────────────────────────────────────

function repairDeps({ zohoPayment = null, status = 'POSTED' } = {}) {
  const record = { id: '1', stripePaymentIntentId: 'pi_3UJALVDJogiiRoKP2ugPotQ9', zohoInvoiceNumber: 'INV-044203', zohoPaymentId: '4265011000042471002', status, clearingModel: 'GROSS_V1' }
  const calls = []
  const clearingStore = {
    getByIntent: async () => record,
    markReversedExternally: async (_c, id, zohoId, detail, actor) => {
      calls.push({ id, zohoId, detail, actor })
      return { ...record, status: 'REVERSED_EXTERNALLY', reversalDetail: detail }
    },
    listEvents: async () => [],
  }
  const zohoPayments = { getZohoCustomerPayment: async () => zohoPayment, createZohoCustomerPayment: async () => { throw new Error('write attempted') } }
  return { calls, deps: { clearingStore, zohoPayments, reader: {}, withClient: (fn) => fn({}) } }
}

test('GROSS_V1 repair marks REVERSED_EXTERNALLY only when Zoho confirms the payment is gone', async () => {
  const gone = repairDeps()
  const out = await markGrossClearingReversedExternally('pi_3UJALVDJogiiRoKP2ugPotQ9', { zohoPaymentId: '4265011000042471002', actor: 'user:1' }, gone.deps)
  assert.equal(out.clearing.status, 'REVERSED_EXTERNALLY')
  assert.equal(out.zohoWrites, 0)
  assert.equal(gone.calls[0].zohoId, '4265011000042471002')
  assert.match(gone.calls[0].detail, /deleted manually in Zoho/)
  assert.match(gone.calls[0].detail, /INV-044203/)

  const present = repairDeps({ zohoPayment: { payment_id: '4265011000042471002' } })
  await assert.rejects(
    markGrossClearingReversedExternally('pi_3UJALVDJogiiRoKP2ugPotQ9', { zohoPaymentId: '4265011000042471002', actor: 'user:1' }, present.deps),
    (err) => err.code === 'ZOHO_PAYMENT_STILL_EXISTS',
  )
  assert.equal(present.calls.length, 0)

  const done = repairDeps({ status: 'REVERSED_EXTERNALLY' })
  const again = await markGrossClearingReversedExternally('pi_3UJALVDJogiiRoKP2ugPotQ9', { zohoPaymentId: '4265011000042471002', actor: 'user:1' }, done.deps)
  assert.equal(again.alreadyReversed, true)
  assert.equal(done.calls.length, 0)
})
