'use strict'

/**
 * Payout + customer group posting to Zoho. Zoho is a stateful fake: customer payments
 * reduce invoice balances, journals are stored, and each POST can be scripted to succeed,
 * time out, fail with 5xx or be rejected. Figures are po_1UJNObDJogiiRoKPHtPAr3KE.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { getStripeClearingConfig } = require('../src/config/stripeClearing')
const { previewPayout } = require('../src/services/stripeClearing/stripePayoutPreviewService')
const { postPayoutCustomerGroup, postPayoutFeeJournal } = require('../src/services/stripeClearing/stripePayoutPostingService')
const { GROUP_STATUS, PAYOUT_STATUS, FEE_JOURNAL_STATUS: FJ } = require('../src/services/stripeClearing/stripePayoutClearingModel')

const BASE = getStripeClearingConfig()
const CFG = { ...BASE, postingEnabled: true }
const WEB = BASE.websiteZohoCustomerId
const SHOP = BASE.shopZohoCustomerId
const A1019 = '4265011000000984169'
const A1013 = '4265011000000699653'
const A1123 = BASE.advanceAccountId
const LIVE = { getSecretKey: () => 'placeholder', getMode: () => 'live', keyMode: () => 'live', redact: (s) => String(s) }
const TEST_MODE = { ...LIVE, getMode: () => 'test', keyMode: () => 'test' }

const ACCOUNTS = [
  { accountId: A1019, accountName: 'Stripe Undeposited Funds', accountCode: '1019', accountType: 'cash', isActive: true },
  { accountId: A1013, accountName: 'Stripe Processing Chg Un-Cleared', accountCode: '1013', accountType: 'cash', isActive: true },
  { accountId: A1123, accountName: 'Customer Advance Funds', accountCode: '1123', accountType: 'other_current_liability', isActive: true },
  { accountId: BASE.feeExpenseAccountId, accountName: 'Stripe Fees', accountCode: '2270', accountType: 'expense', isActive: true },
]

const PO = 'po_1UJNObDJogiiRoKPHtPAr3KE'
const ADVANCE_CHARGE = 'ch_3UIA7CDJogiiRoKP07RCqZKw'
const ADVANCE_PI = 'pi_3UIA7CDJogiiRoKP0Qy1oodM'
const REFUND_ID = 're_3UIA7CDJogiiRoKP0noUu0UZ'
const REFUND_BT = 'txn_3UIA7CDJogiiRoKP0qGO7307'
const r = (chargeId, paymentIntentId, orderNumber, invoiceNumber, gross, fee, customer, extra = {}) => ({ chargeId, paymentIntentId, orderNumber, invoiceNumber, gross, fee, customer, ...extra })
const ROWS = [
  r(ADVANCE_CHARGE, ADVANCE_PI, '21111', 'INV-044122', 110100, 3293, WEB, { orderTotal: 1066, refundedMinor: 3500 }),
  r('ch_3UI3iPDJogiiRoKP0wqqBVBj', 'pi_3UI3iPDJogiiRoKP0FqNKZix', '21106', 'INV-044102', 7650, 322, WEB),
  r('ch_3UHr0DDJogiiRoKP0DOHt4mN', 'pi_3UHr0DDJogiiRoKP0u6GFnN3', '21103', 'INV-044100', 18470, 636, WEB),
  r('ch_3UHdvUDJogiiRoKP0un4aWsk', 'pi_3UHdvUDJogiiRoKP0fgYt7ap', '21093', 'INV-044088', 109900, 3287, WEB),
  r('ch_3UHPbNDJogiiRoKP1DK9FRKO', 'pi_3UHPbNDJogiiRoKP153vf3hK', '21088', 'INV-044059', 42415, 1330, WEB),
  r('ch_3UHOC1DJogiiRoKP257imj3u', 'pi_3UHOC1DJogiiRoKP2w18Q8eG', '21083', 'INV-044062', 4760, 238, WEB),
  r('ch_3UHLX7DJogiiRoKP1UrcOHtJ', 'pi_3UHLX7DJogiiRoKP1cQpA7Zw', '21076', 'INV-044099', 52275, 1616, WEB),
  r('ch_3UI3rMDJogiiRoKP0BPo22cL', 'pi_3UI3rMDJogiiRoKP0sTJmeYL', '21107', 'INV-044103', 11730, 440, SHOP),
  r('ch_3UI1UgDJogiiRoKP2n8UXid3', 'pi_3UI1UgDJogiiRoKP2cU7VOKY', '21105', 'INV-044120', 78795, 2385, SHOP),
  r('ch_3UHiscDJogiiRoKP1kyrSWvP', 'pi_3UHiscDJogiiRoKP1s5LYmaF', '21098', 'INV-044093', 9690, 381, SHOP),
  r('ch_3UHJ78DJogiiRoKP02l6fPy3', 'pi_3UHJ78DJogiiRoKP0PMF4StJ', '21075', 'INV-044038', 24140, 800, SHOP),
]
const invoiceId = (n) => `ZID-${n}`

function confirmedCase(overrides = {}) {
  return {
    id: '1',
    payoutId: PO,
    zohoCustomerId: WEB,
    customerName: 'Website',
    orderNumber: '21111',
    invoiceId: invoiceId('INV-044122'),
    invoiceNumber: 'INV-044122',
    paymentIntentId: ADVANCE_PI,
    chargeId: ADVANCE_CHARGE,
    currency: 'AED',
    stripeGross: 1101,
    stripeNet: 1068.07,
    stripeFee: 32.93,
    invoiceTotal: 1066,
    overpaymentAmount: 35,
    netAllocation: 1033.07,
    customerAdvanceAccountId: A1123,
    advanceReference: `Stripe customer advance ${PO}`,
    status: 'CONFIRMED',
    adminConfirmed: true,
    confirmedBy: 'user:1',
    confirmedAt: '2026-09-28T13:00:00.000Z',
    refundStatus: 'REFUND_DETECTED',
    refundId: REFUND_ID,
    refundBalanceTransactionId: REFUND_BT,
    refundAmount: 35,
    ...overrides,
  }
}

function zohoError(kind) {
  const err = new Error(kind === 'reject' ? 'Invoice amount exceeds balance' : kind.startsWith('5xx') ? 'Zoho 503' : 'socket hang up / timeout')
  if (kind === 'reject') Object.assign(err, { httpStatus: 400, code: 'ZOHO_API_ERROR', zohoResponse: { code: 24016 } })
  else if (kind.startsWith('5xx')) err.httpStatus = 503
  else err.code = 'ETIMEDOUT'
  return err
}

/**
 * Stateful fake of Stripe (read-only), the website (read-only), Zoho and the local store.
 * `script[kind]` lists what successive POSTs of NET / FEE / JOURNAL / FEE_JOURNAL do.
 * `only: [customerId]` keeps just that customer's charges (payout amount follows).
 */
function world(opts = {}) {
  const ROWS_IN = opts.only ? ROWS.filter((x) => opts.only.includes(x.customer)) : ROWS
  const amountMinor = opts.only ? ROWS_IN.reduce((s, x) => s + x.gross - x.fee, 0) : 455197
  const state = {
    payout: { status: 'paid', arrivalDate: '2026-09-28T00:00:00.000Z', amountMinor, ...(opts.payout || {}) },
    payments: [...(opts.payments || [])],
    journals: [...(opts.journals || [])],
    externalApplied: {},
    cases: opts.cases ? opts.cases.map((c) => ({ ...c })) : [confirmedCase()],
    components: [...(opts.components || [])],
    events: [],
    posts: [],
    locked: false,
  }
  const script = { NET: [], FEE: [], JOURNAL: [], FEE_JOURNAL: [], ...(opts.script || {}) }
  let seq = 0

  const txns = ROWS_IN.map((x) => ({
    balanceTransactionId: `txn_${x.chargeId.slice(3)}`, type: 'charge', reportingCategory: 'charge', currency: 'AED', exchangeRate: null,
    amountMinor: x.gross, feeMinor: x.fee, netMinor: x.gross - x.fee, chargeId: x.chargeId, paymentIntentId: x.paymentIntentId,
    chargeRefundedMinor: x.refundedMinor || 0, chargeDisputed: false, chargeStatus: 'succeeded', chargeFullyRefunded: false,
  }))
  txns.push({ balanceTransactionId: 'txn_HOLD000000001', type: 'reserve_transaction', reportingCategory: 'risk_reserved_funds', currency: 'AED', amountMinor: -100000, feeMinor: 0, netMinor: -100000 })
  txns.push({ balanceTransactionId: 'txn_RELEASE00001', type: 'reserve_transaction', reportingCategory: 'risk_reserved_funds', currency: 'AED', amountMinor: 100000, feeMinor: 0, netMinor: 100000 })

  const orderTotal = (x) => x.orderTotal ?? x.gross / 100
  const applied = (id) => state.payments.reduce((s, p) => s + p.detail.invoices.filter((i) => i.invoice_id === id).reduce((a, i) => a + Math.round(i.amount_applied * 100), 0), 0)
  function invoiceFor(x) {
    const id = invoiceId(x.invoiceNumber)
    const total = orderTotal(x)
    const balance = (Math.round(total * 100) - applied(id) - (state.externalApplied[x.invoiceNumber] || 0)) / 100
    const status = balance === 0 ? 'paid' : balance < total ? 'partially_paid' : 'overdue'
    return { invoiceId: id, invoiceNumber: x.invoiceNumber, referenceNumber: x.orderNumber, customerId: x.customer, status, total, balance, currencyCode: 'AED' }
  }

  const sources = {
    retrieveStripePayout: async (id) => (id === PO ? { payoutId: PO, currency: 'AED', createdAt: '2026-09-25T00:53:49.000Z', ...state.payout } : null),
    listPayoutBalanceTransactions: async () => [...txns, { balanceTransactionId: 'txn_PAYOUT000001', type: 'payout', currency: 'AED', amountMinor: -state.payout.amountMinor, feeMinor: 0, netMinor: -state.payout.amountMinor }],
    listChargeRefunds: async (chargeId) => (chargeId === ADVANCE_CHARGE ? [{
      refundId: REFUND_ID, chargeId: ADVANCE_CHARGE, paymentIntentId: ADVANCE_PI, amountMinor: 3500, currency: 'AED', status: 'succeeded', createdAt: '2026-09-28T07:09:27.000Z',
      balanceTransaction: { balanceTransactionId: REFUND_BT, type: 'refund', currency: 'AED', amountMinor: -3500, feeMinor: 0, netMinor: -3500 },
    }] : []),
    loadWebsiteOrdersByIntents: async (ids) => ROWS_IN.filter((x) => ids.includes(x.paymentIntentId)).map((x, i) => ({
      orderId: String(10000 + i), orderNumber: x.orderNumber, orderStatus: 'delivered', paymentStatus: 'completed', stripePaymentIntentId: x.paymentIntentId,
      shopOrder: x.customer === SHOP, finalAmount: orderTotal(x), refundAmount: 0, walletRedeemed: 0, deleted: false, sameNumberCount: 0,
    })),
    findZohoInvoicesByReference: async (ref) => ROWS_IN.filter((x) => x.orderNumber === ref).map(invoiceFor),
    findZohoPaymentsByReference: async (ref) => state.payments.filter((p) => p.referenceNumber === ref).map(({ detail, ...p }) => p),
    findZohoJournalsByReference: async (ref) => state.journals.filter((j) => j.referenceNumber === ref).map((j) => ({ journalId: j.journalId, referenceNumber: j.referenceNumber })),
    getZohoJournal: async (id) => {
      const j = state.journals.find((x) => x.journalId === id)
      return j ? { journalId: j.journalId, referenceNumber: j.referenceNumber, journalDate: j.journalDate, status: j.status || 'published', lineItems: j.lineItems } : null
    },
    listZohoJournalsInRange: async (start, end) => state.journals
      .filter((j) => j.journalDate >= start && j.journalDate <= end)
      .map((j) => ({ journalId: j.journalId, entryNumber: j.entryNumber || null, referenceNumber: j.referenceNumber, notes: j.notes || '', journalDate: j.journalDate, status: j.status || 'published', total: j.lineItems.filter((l) => l.debitOrCredit === 'debit').reduce((s, l) => s + l.amount, 0) })),
  }
  const zohoPayments = {
    listZohoChartAccounts: async () => ACCOUNTS,
    getZohoCustomerPayment: async (id) => {
      const p = state.payments.find((x) => x.paymentId === id)
      return p ? p.detail : null
    },
  }

  function storePayment(payload, patch = {}) {
    const paymentId = `ZP-${++seq}`
    const amount = payload.amount + (patch.amountDelta || 0)
    state.payments.push({
      paymentId, customerId: payload.customer_id, referenceNumber: payload.reference_number, amount, accountId: payload.account_id,
      detail: { payment_id: paymentId, customer_id: payload.customer_id, reference_number: payload.reference_number, amount, account_id: payload.account_id, invoices: payload.invoices.map((i) => ({ ...i })) },
    })
    return paymentId
  }
  function storeJournal(payload) {
    const journalId = `ZJ-${++seq}`
    state.journals.push({
      journalId, referenceNumber: payload.reference_number, journalDate: payload.journal_date,
      lineItems: payload.line_items.map((li) => ({ accountId: li.account_id, debitOrCredit: li.debit_or_credit, amount: li.amount, customerId: li.customer_id || '' })),
    })
    return journalId
  }
  async function perform(kind, payload, create) {
    state.posts.push({ kind, payload })
    const step = script[kind].shift() || 'ok'
    if (typeof step === 'function') return step(payload, { create, state })
    if (step === 'ok') return { recordId: create(payload) }
    if (step === 'no-id') { create(payload); return { recordId: '' } }
    if (step === 'created-wrong') return { recordId: storePayment(payload, { amountDelta: 1 }) }
    if (step.endsWith('-created')) { create(payload); throw zohoError(step) }
    throw zohoError(step)
  }
  const writer = {
    createCustomerPayment: (payload) => perform(payload.reference_number.startsWith('Stripe funds received') ? 'NET' : 'FEE', payload, storePayment),
    createJournal: (payload) => perform(payload.reference_number.startsWith('Stripe processing fees') ? 'FEE_JOURNAL' : 'JOURNAL', payload, storeJournal),
  }

  let nextId = state.components.length + 1
  const store = {
    async acquirePayoutLock() {
      if (state.locked) throw Object.assign(new Error('locked'), { status: 409, code: 'PAYOUT_POSTING_IN_PROGRESS' })
      state.locked = true
      return { db: {}, release: async () => { state.locked = false } }
    },
    async upsertPlannedComponent(_db, c, actor) {
      const cur = state.components.find((x) => x.payoutId === c.payoutId && x.zohoCustomerId === c.zohoCustomerId && x.component === c.component)
      if (cur && !['PLANNED', 'FAILED'].includes(cur.status)) return { component: { ...cur }, changed: false }
      if (cur) {
        Object.assign(cur, c)
        return { component: { ...cur }, changed: true }
      }
      const row = { id: String(nextId++), ...c, status: 'PLANNED', zohoRecordId: null, attemptCount: 0, lastError: null, postedAt: null, verifiedAt: null }
      state.components.push(row)
      state.events.push({ entityId: row.id, component: c.component, customerId: c.zohoCustomerId, fromStatus: null, toStatus: 'PLANNED', actor })
      return { component: { ...row }, changed: true }
    },
    async transitionComponent(_db, id, from, to, patch = {}, detail, actor) {
      const cur = state.components.find((x) => x.id === id)
      if (!cur || !from.includes(cur.status)) throw Object.assign(new Error(`${cur && cur.status} not in ${from}`), { status: 409, code: 'COMPONENT_STATE_CONFLICT' })
      const prev = cur.status
      cur.status = to
      if (patch.zohoRecordId) cur.zohoRecordId = patch.zohoRecordId
      if (patch.incrementAttempt) cur.attemptCount += 1
      if (patch.lastError) cur.lastError = patch.lastError
      if (patch.postedAt) cur.postedAt = patch.postedAt
      if (patch.verifiedAt) cur.verifiedAt = patch.verifiedAt
      if (to === 'VERIFIED') assert.ok(cur.zohoRecordId && cur.verifiedAt, 'VERIFIED needs a Zoho ID and verified_at')
      state.events.push({ entityId: id, component: cur.component, customerId: cur.zohoCustomerId, fromStatus: prev, toStatus: to, detail, actor })
      return { ...cur }
    },
    async markAdvancePosted(_db, caseIds, journalId, actor) {
      const out = []
      for (const c of state.cases.filter((x) => caseIds.includes(x.id) && x.status === 'CONFIRMED')) {
        Object.assign(c, { status: 'ADVANCE_POSTED', zohoJournalId: journalId })
        state.events.push({ entityId: c.id, fromStatus: 'CONFIRMED', toStatus: 'ADVANCE_POSTED', actor })
        out.push({ ...c })
      }
      return out
    },
  }
  const records = {
    loadAdvanceCases: async (ids) => state.cases.filter((c) => ids.includes(c.chargeId)),
    loadComponents: async (id) => state.components.filter((c) => c.payoutId === id),
    loadCaseEvents: async () => [],
  }
  const previewDeps = { sources, zohoPayments, records }
  const deps = (patch = {}) => ({ config: CFG, stripeConfig: LIVE, store, writer, pool: {}, previewDeps, now: () => new Date('2026-09-28T14:00:00.000Z'), ...patch })
  return {
    state,
    script,
    preview: (patch = {}) => previewPayout(PO, { ...previewDeps, config: CFG, stripeConfig: LIVE, ...patch }),
    fingerprint: async (customerId) => (await previewPayout(PO, { ...previewDeps, config: CFG, stripeConfig: LIVE })).groups.find((g) => g.customerId === customerId).postingFingerprint,
    post: async (key, fingerprint, patch) => postPayoutCustomerGroup(PO, key, { actor: 'user:1', fingerprint }, deps(patch)),
    local: (customerId, kind) => state.components.find((c) => c.zohoCustomerId === customerId && c.component === kind),
    feeFingerprint: async () => (await previewPayout(PO, { ...previewDeps, config: CFG, stripeConfig: LIVE })).feeJournal.postingFingerprint,
    postFee: async (fingerprint, patch) => postPayoutFeeJournal(PO, { actor: 'user:1', fingerprint }, deps(patch)),
    localFee: () => state.components.find((c) => c.component === 'PAYOUT_FEE_JOURNAL'),
  }
}

const group = (result, customerId) => result.groups.find((g) => g.customerId === customerId)
const kinds = (w) => w.state.posts.map((p) => p.kind)
const code = (c) => (err) => err.code === c

const SHOP_ALLOCATIONS = {
  NET: [['INV-044103', 112.9], ['INV-044120', 764.1], ['INV-044093', 93.09], ['INV-044038', 233.4]],
  FEE: [['INV-044103', 4.4], ['INV-044120', 23.85], ['INV-044093', 3.81], ['INV-044038', 8]],
}
const WEB_ALLOCATIONS = {
  NET: [['INV-044122', 1033.07], ['INV-044102', 73.28], ['INV-044100', 178.34], ['INV-044088', 1066.13], ['INV-044059', 410.85], ['INV-044062', 45.22], ['INV-044099', 506.59]],
  FEE: [['INV-044122', 32.93], ['INV-044102', 3.22], ['INV-044100', 6.36], ['INV-044088', 32.87], ['INV-044059', 13.3], ['INV-044062', 2.38], ['INV-044099', 16.16]],
}
const payload = (w, kind) => w.state.posts.find((p) => p.kind === kind).payload
const invoicesOf = (list) => list.map(([n, amount]) => ({ invoice_id: invoiceId(n), amount_applied: amount }))

// ── Gate and refusals ───────────────────────────────────────────────────────

test('posting disabled: refused before any read, lock or local record', async () => {
  const w = world()
  const fp = await w.fingerprint(SHOP)
  await assert.rejects(w.post('burjman', fp, { config: { ...CFG, postingEnabled: false } }), code('STRIPE_CLEARING_POSTING_DISABLED'))
  await assert.rejects(w.post('burjman', fp, { stripeConfig: TEST_MODE }), code('STRIPE_NOT_LIVE'))
  assert.deepEqual(w.state.posts, [])
  assert.deepEqual(w.state.components, [])
  const disabled = await w.preview({ config: { ...CFG, postingEnabled: false } })
  assert.equal(disabled.postingEnabled, false)
  assert.equal(disabled.postingBlockedReasons[0].code, 'STRIPE_CLEARING_POSTING_DISABLED')
  // The real server config: the flag is off unless explicitly enabled.
  assert.equal(BASE.postingEnabled, process.env.STRIPE_CLEARING_POSTING_ENABLED === 'true')
})

test('NEEDS_REVIEW never posts: an unconfirmed Website advance is refused', async () => {
  const w = world({ cases: [] })
  const before = await w.preview()
  assert.equal(group(before, WEB).status, GROUP_STATUS.NEEDS_REVIEW)
  await assert.rejects(w.post('website', group(before, WEB).postingFingerprint), code('GROUP_NOT_POSTABLE'))
  assert.deepEqual(w.state.posts, [])
  assert.deepEqual(w.state.components, [])
})

test('requests need a known customer, a payout ID, an admin and the reviewed fingerprint', async () => {
  const w = world()
  const fp = await w.fingerprint(SHOP)
  await assert.rejects(w.post('amazon', fp), code('INVALID_CUSTOMER'))
  await assert.rejects(postPayoutCustomerGroup('pi_123', 'burjman', { actor: 'user:1', fingerprint: fp }, { config: CFG, stripeConfig: LIVE }), code('INVALID_PAYOUT_ID'))
  await assert.rejects(w.post('burjman', ''), code('FINGERPRINT_REQUIRED'))
  await assert.rejects(postPayoutCustomerGroup(PO, 'burjman', { fingerprint: fp }, { config: CFG, stripeConfig: LIVE }), code('ACTOR_REQUIRED'))
  await assert.rejects(w.post('burjman', 'stale'), code('PREVIEW_CHANGED'))
  assert.deepEqual(w.state.posts, [])
})

// ── Standard READY group (first live test: Burjman only) ────────────────────

test('READY Burjman: NET then FEE with exact payloads; Website untouched', async () => {
  const w = world()
  const before = await w.preview()
  assert.equal(group(before, SHOP).status, GROUP_STATUS.READY)
  assert.equal(before.postingEnabled, true)
  const out = await w.post('burjman', group(before, SHOP).postingFingerprint)

  assert.equal(out.outcome, GROUP_STATUS.POSTED)
  assert.deepEqual(kinds(w), ['NET', 'FEE'])
  assert.deepEqual(payload(w, 'NET'), {
    customer_id: SHOP, payment_mode: 'Stripe', amount: 1203.49, date: '2026-09-28',
    reference_number: `Stripe funds received ${PO}`, account_id: A1019, invoices: invoicesOf(SHOP_ALLOCATIONS.NET),
  })
  assert.deepEqual(payload(w, 'FEE'), {
    customer_id: SHOP, payment_mode: 'Stripe', amount: 40.06, date: '2026-09-28',
    reference_number: `Stripe processing fee ${PO}`, account_id: A1013, invoices: invoicesOf(SHOP_ALLOCATIONS.FEE),
  })
  for (const p of w.state.posts) {
    assert.equal(p.payload.notes, undefined)
    assert.equal(p.payload.description, undefined)
  }
  assert.deepEqual(out.components.map((c) => [c.component, c.status, c.attemptCount]), [['NET', 'VERIFIED', 1], ['FEE', 'VERIFIED', 1]])
  assert.equal(out.zohoRequests, 2)
  assert.ok(out.components.every((c) => c.zohoRecordId && c.postedAt && c.verifiedAt))
  assert.deepEqual(w.state.events.filter((e) => e.component === 'NET').map((e) => e.toStatus), ['PLANNED', 'POSTING', 'POSTED', 'VERIFIED'])

  // Website: no Zoho record, no local row, still ready for its own later posting.
  assert.ok(w.state.posts.every((p) => p.payload.customer_id === SHOP))
  assert.ok(w.state.components.every((c) => c.zohoCustomerId === SHOP))
  const after = await w.preview()
  assert.equal(group(after, SHOP).status, GROUP_STATUS.POSTED)
  assert.equal(group(after, WEB).status, GROUP_STATUS.READY_WITH_CUSTOMER_ADVANCE)
  assert.equal(after.status, PAYOUT_STATUS.PARTIALLY_CLEARED)
  assert.deepEqual(w.state.cases.map((c) => c.status), ['CONFIRMED'])

  // Posting again is a no-op.
  const again = await w.post('burjman', group(after, SHOP).postingFingerprint)
  assert.equal(again.alreadyPosted, true)
  assert.equal(w.state.posts.length, 2)
})

// ── READY_WITH_CUSTOMER_ADVANCE (Website) ───────────────────────────────────

test('READY_WITH_CUSTOMER_ADVANCE Website: NET, FEE, then Dr 1019 / Cr 1123 journal; Burjman untouched', async () => {
  const w = world()
  const before = await w.preview()
  const web = group(before, WEB)
  assert.equal(web.status, GROUP_STATUS.READY_WITH_CUSTOMER_ADVANCE)
  const out = await w.post('website', web.postingFingerprint)

  assert.equal(out.outcome, GROUP_STATUS.POSTED)
  assert.deepEqual(kinds(w), ['NET', 'FEE', 'JOURNAL'])
  assert.deepEqual(payload(w, 'NET'), {
    customer_id: WEB, payment_mode: 'Stripe', amount: 3313.48, date: '2026-09-28',
    reference_number: `Stripe funds received ${PO}`, account_id: A1019, invoices: invoicesOf(WEB_ALLOCATIONS.NET),
  })
  assert.deepEqual(payload(w, 'FEE'), {
    customer_id: WEB, payment_mode: 'Stripe', amount: 107.22, date: '2026-09-28',
    reference_number: `Stripe processing fee ${PO}`, account_id: A1013, invoices: invoicesOf(WEB_ALLOCATIONS.FEE),
  })
  assert.deepEqual(payload(w, 'JOURNAL'), {
    journal_date: '2026-09-28',
    reference_number: `Stripe customer advance ${PO}`,
    journal_type: 'both',
    line_items: [
      { account_id: A1019, debit_or_credit: 'debit', amount: 35 },
      { account_id: A1123, customer_id: WEB, debit_or_credit: 'credit', amount: 35 },
    ],
  })

  // INV-044122 receives exactly 1033.07 + 32.93 = 1066.00; the 35.00 is only in the journal.
  const applied = w.state.posts.filter((p) => p.kind !== 'JOURNAL').flatMap((p) => p.payload.invoices).filter((i) => i.invoice_id === invoiceId('INV-044122'))
  assert.deepEqual(applied.map((i) => i.amount_applied), [1033.07, 32.93])
  const after = await w.preview()
  const posted = group(after, WEB)
  assert.equal(posted.lines.find((l) => l.chargeId === ADVANCE_CHARGE).invoice.balance, 0)
  assert.equal(posted.status, GROUP_STATUS.POSTED)
  assert.equal(group(after, SHOP).status, GROUP_STATUS.READY)
  assert.ok(w.state.components.every((c) => c.zohoCustomerId === WEB))

  // The advance case now records the verified journal; the refund stays detected, not posted.
  assert.deepEqual(out.advanceCasesPosted, [{ id: '1', status: 'ADVANCE_POSTED', zohoJournalId: out.components[2].zohoRecordId }])
  assert.equal(w.state.cases[0].refundStatus, 'REFUND_DETECTED')
})

test('the refund journal (Dr 1123 / Cr 1019) is never part of the original payout posting', async () => {
  const w = world()
  await w.post('website', await w.fingerprint(WEB))
  assert.equal(w.state.journals.length, 1)
  assert.ok(w.state.posts.every((p) => !p.payload.reference_number.includes('refund')))
  const journal = payload(w, 'JOURNAL')
  assert.equal(journal.line_items.find((l) => l.debit_or_credit === 'debit').account_id, A1019)
  assert.ok(!w.state.components.some((c) => c.component === 'CUSTOMER_ADVANCE_REFUND'))
})

test('customer separation: each group posts only its own customer and invoices', async () => {
  const w = world()
  await w.post('burjman', await w.fingerprint(SHOP))
  await w.post('website', await w.fingerprint(WEB))
  const shopInvoices = new Set(SHOP_ALLOCATIONS.NET.map(([n]) => invoiceId(n)))
  for (const p of w.state.posts.filter((x) => x.kind !== 'JOURNAL')) {
    const own = p.payload.invoices.every((i) => shopInvoices.has(i.invoice_id))
    assert.equal(own, p.payload.customer_id === SHOP)
  }
  const after = await w.preview()
  assert.equal(after.status, PAYOUT_STATUS.FEE_JOURNAL_PENDING)
})

// ── Duplicate protection ────────────────────────────────────────────────────

test('duplicate NET: an exact existing payment is verified and recorded, only FEE is posted', async () => {
  const w = world()
  const net = group(await w.preview(), SHOP).components.find((c) => c.component === 'NET').payload
  w.state.payments.push({ paymentId: 'ZP-EXIST', customerId: SHOP, referenceNumber: net.reference_number, amount: net.amount, accountId: A1019, detail: { payment_id: 'ZP-EXIST', customer_id: SHOP, reference_number: net.reference_number, amount: net.amount, account_id: A1019, invoices: net.invoices } })
  const before = await w.preview()
  assert.equal(group(before, SHOP).status, GROUP_STATUS.PARTIALLY_POSTED)
  const out = await w.post('burjman', group(before, SHOP).postingFingerprint)
  assert.deepEqual(kinds(w), ['FEE'])
  assert.equal(w.local(SHOP, 'NET').zohoRecordId, 'ZP-EXIST')
  assert.equal(w.local(SHOP, 'NET').attemptCount, 0)
  assert.equal(out.outcome, GROUP_STATUS.POSTED)
})

test('duplicate FEE and journal: everything already in Zoho is recorded with zero POSTs', async () => {
  const seed = world()
  await seed.post('website', await seed.fingerprint(WEB))
  const w = world({ payments: seed.state.payments, journals: seed.state.journals })
  const before = await w.preview()
  assert.equal(group(before, WEB).status, GROUP_STATUS.ALREADY_POSTED)
  const out = await w.post('website', group(before, WEB).postingFingerprint)
  assert.deepEqual(w.state.posts, [])
  assert.equal(out.zohoRequests, 0)
  assert.equal(out.outcome, GROUP_STATUS.POSTED)
  assert.deepEqual(w.state.components.map((c) => [c.component, c.status, c.attemptCount]), [['NET', 'VERIFIED', 0], ['FEE', 'VERIFIED', 0], ['CUSTOMER_ADVANCE', 'VERIFIED', 0]])
  assert.equal(w.state.cases[0].status, 'ADVANCE_POSTED')
  assert.equal(group(await w.preview(), WEB).status, GROUP_STATUS.POSTED)
})

test('ambiguous duplicate: two Zoho payments with the reference block the group', async () => {
  const w = world()
  const fp = await w.fingerprint(SHOP)
  for (const id of ['ZP-A', 'ZP-B']) {
    w.state.payments.push({ paymentId: id, customerId: SHOP, referenceNumber: `Stripe funds received ${PO}`, amount: 1, accountId: A1019, detail: { payment_id: id, customer_id: SHOP, reference_number: `Stripe funds received ${PO}`, amount: 1, account_id: A1019, invoices: [] } })
  }
  await assert.rejects(w.post('burjman', fp), code('GROUP_NOT_POSTABLE'))
  assert.deepEqual(w.state.posts, [])
})

test('a conflicting record appearing between components stops before the next POST', async () => {
  const w = world({
    script: {
      NET: [(p, { create, state }) => {
        const recordId = create(p)
        state.payments.push({ paymentId: 'ZP-ROGUE', customerId: SHOP, referenceNumber: `Stripe processing fee ${PO}`, amount: 99, accountId: A1013, detail: { payment_id: 'ZP-ROGUE', customer_id: SHOP, reference_number: `Stripe processing fee ${PO}`, amount: 99, account_id: A1013, invoices: [] } })
        return { recordId }
      }],
    },
  })
  const out = await w.post('burjman', await w.fingerprint(SHOP))
  assert.deepEqual(kinds(w), ['NET'])
  assert.equal(out.outcome, GROUP_STATUS.NEEDS_REVIEW)
  assert.equal(w.local(SHOP, 'FEE').status, 'NEEDS_REVIEW')
  assert.match(w.local(SHOP, 'FEE').lastError, /differs/)
})

// ── Uncertain Zoho responses ────────────────────────────────────────────────

test('NET timeout: found in Zoho → verified without re-posting; not found → retryable, then retried', async () => {
  const found = world({ script: { NET: ['timeout-created'] } })
  const out = await found.post('burjman', await found.fingerprint(SHOP))
  assert.deepEqual(kinds(found), ['NET', 'FEE'])
  assert.equal(out.outcome, GROUP_STATUS.POSTED)
  assert.equal(found.local(SHOP, 'NET').attemptCount, 1)
  assert.match(found.state.events.find((e) => e.component === 'NET' && e.toStatus === 'VERIFIED').detail, /result is unknown.*found exactly one/)

  const lost = world({ script: { NET: ['timeout-lost'] } })
  const fp = await lost.fingerprint(SHOP)
  const first = await lost.post('burjman', fp)
  assert.deepEqual(kinds(lost), ['NET'])
  assert.equal(first.outcome, 'NOT_POSTED')
  assert.deepEqual(first.notAttempted, ['FEE'])
  assert.equal(lost.local(SHOP, 'NET').status, 'FAILED')
  assert.match(lost.local(SHOP, 'NET').lastError, /not re-posted/)
  assert.equal(group(await lost.preview(), SHOP).status, GROUP_STATUS.READY)

  const retry = await lost.post('burjman', fp)
  assert.equal(retry.outcome, GROUP_STATUS.POSTED)
  assert.deepEqual(kinds(lost), ['NET', 'NET', 'FEE'])
  assert.equal(lost.local(SHOP, 'NET').attemptCount, 2)
  assert.equal(lost.state.payments.length, 2)
})

test('FEE timeout / 5xx: found → verified; lost → PARTIALLY_POSTED and the retry posts FEE only', async () => {
  const found = world({ script: { FEE: ['5xx-created'] } })
  assert.equal((await found.post('burjman', await found.fingerprint(SHOP))).outcome, GROUP_STATUS.POSTED)
  assert.deepEqual(kinds(found), ['NET', 'FEE'])

  const lost = world({ script: { FEE: ['5xx-lost'] } })
  const fp = await lost.fingerprint(SHOP)
  const first = await lost.post('burjman', fp)
  assert.equal(first.outcome, GROUP_STATUS.PARTIALLY_POSTED)
  assert.equal(group(await lost.preview(), SHOP).status, GROUP_STATUS.PARTIALLY_POSTED)
  const retry = await lost.post('burjman', fp)
  assert.equal(retry.outcome, GROUP_STATUS.POSTED)
  assert.deepEqual(kinds(lost), ['NET', 'FEE', 'FEE'])
  assert.equal(lost.state.payments.filter((p) => p.referenceNumber.startsWith('Stripe funds received')).length, 1)
})

test('journal timeout: found → verified; lost → retry posts only the journal', async () => {
  const found = world({ script: { JOURNAL: ['timeout-created'] } })
  assert.equal((await found.post('website', await found.fingerprint(WEB))).outcome, GROUP_STATUS.POSTED)
  assert.equal(found.state.journals.length, 1)

  const lost = world({ script: { JOURNAL: ['timeout-lost'] } })
  const fp = await lost.fingerprint(WEB)
  const first = await lost.post('website', fp)
  assert.equal(first.outcome, GROUP_STATUS.PARTIALLY_POSTED)
  assert.equal(lost.state.cases[0].status, 'CONFIRMED')
  const retry = await lost.post('website', fp)
  assert.equal(retry.outcome, GROUP_STATUS.POSTED)
  assert.deepEqual(kinds(lost), ['NET', 'FEE', 'JOURNAL', 'JOURNAL'])
  assert.equal(lost.state.journals.length, 1)
  assert.equal(lost.state.cases[0].status, 'ADVANCE_POSTED')
})

test('a POST answered without an ID is resolved by search, never re-posted', async () => {
  const w = world({ script: { NET: ['no-id'] } })
  const out = await w.post('burjman', await w.fingerprint(SHOP))
  assert.equal(out.outcome, GROUP_STATUS.POSTED)
  assert.deepEqual(kinds(w), ['NET', 'FEE'])
})

// ── Partial failure ─────────────────────────────────────────────────────────

test('NET succeeds, FEE rejected: PARTIALLY_POSTED; retry verifies NET and posts only FEE', async () => {
  const w = world({ script: { FEE: ['reject'] } })
  const fp = await w.fingerprint(SHOP)
  const first = await w.post('burjman', fp)
  assert.equal(first.outcome, GROUP_STATUS.PARTIALLY_POSTED)
  assert.equal(w.local(SHOP, 'FEE').status, 'FAILED')
  assert.match(w.local(SHOP, 'FEE').lastError, /did not accept/)
  const retry = await w.post('burjman', fp)
  assert.equal(retry.outcome, GROUP_STATUS.POSTED)
  assert.deepEqual(kinds(w), ['NET', 'FEE', 'FEE'])
  assert.equal(retry.components[0].requestSent, false)
})

test('NET + FEE succeed, journal rejected: retry posts only the journal', async () => {
  const w = world({ script: { JOURNAL: ['reject'] } })
  const fp = await w.fingerprint(WEB)
  const first = await w.post('website', fp)
  assert.equal(first.outcome, GROUP_STATUS.PARTIALLY_POSTED)
  assert.equal(group(await w.preview(), WEB).status, GROUP_STATUS.PARTIALLY_POSTED)
  const retry = await w.post('website', fp)
  assert.equal(retry.outcome, GROUP_STATUS.POSTED)
  assert.deepEqual(kinds(w), ['NET', 'FEE', 'JOURNAL', 'JOURNAL'])
  assert.deepEqual(retry.components.map((c) => c.requestSent), [false, false, true])
})

test('the group is only POSTED once every required component verifies', async () => {
  const wrong = world({ script: { FEE: ['created-wrong'] } })
  const out = await wrong.post('burjman', await wrong.fingerprint(SHOP))
  assert.equal(out.outcome, GROUP_STATUS.NEEDS_REVIEW)
  assert.equal(wrong.local(SHOP, 'FEE').status, 'NEEDS_REVIEW')
  assert.match(wrong.local(SHOP, 'FEE').lastError, /does not verify/)
  assert.notEqual(group(await wrong.preview(), SHOP).status, GROUP_STATUS.POSTED)

  const stuck = world({ components: [{ id: '9', payoutId: PO, zohoCustomerId: SHOP, component: 'NET', status: 'POSTING', zohoRecordId: null, attemptCount: 1 }] })
  const fp = (await stuck.preview()).groups.find((g) => g.customerId === SHOP).postingFingerprint
  await assert.rejects(stuck.post('burjman', fp), code('GROUP_NOT_POSTABLE'))
  assert.deepEqual(stuck.state.posts, [])
})

// ── Live revalidation ───────────────────────────────────────────────────────

test('an invoice balance changed after the preview blocks posting', async () => {
  const w = world()
  const fp = await w.fingerprint(SHOP)
  w.state.externalApplied['INV-044120'] = 10000
  await assert.rejects(w.post('burjman', fp), code('GROUP_NOT_POSTABLE'))
  assert.deepEqual(w.state.posts, [])
})

test('a payout that changed after the preview blocks posting', async () => {
  const moved = world()
  const fp = await moved.fingerprint(SHOP)
  moved.state.payout.arrivalDate = '2026-09-29T00:00:00.000Z'
  await assert.rejects(moved.post('burjman', fp), code('PREVIEW_CHANGED'))

  const pending = world()
  const fp2 = await pending.fingerprint(SHOP)
  pending.state.payout.status = 'in_transit'
  await assert.rejects(pending.post('burjman', fp2), code('PAYOUT_NOT_PAID'))

  const amount = world()
  const fp3 = await amount.fingerprint(SHOP)
  amount.state.payout.amountMinor = 455000
  await assert.rejects(amount.post('burjman', fp3), (err) => ['PREVIEW_CHANGED', 'GROUP_NOT_POSTABLE'].includes(err.code))
  assert.deepEqual([...moved.state.posts, ...pending.state.posts, ...amount.state.posts], [])
})

test('a removed or rejected advance confirmation blocks the Website group', async () => {
  const removed = world()
  const fp = await removed.fingerprint(WEB)
  removed.state.cases = []
  // Without the confirmation the plan has no advance journal, so it no longer matches the review.
  await assert.rejects(removed.post('website', fp), (err) => err.code === 'PREVIEW_CHANGED' && err.groupStatus === GROUP_STATUS.NEEDS_REVIEW)
  assert.equal(group(await removed.preview(), WEB).status, GROUP_STATUS.NEEDS_REVIEW)
  await assert.rejects(removed.post('website', await removed.fingerprint(WEB)), code('GROUP_NOT_POSTABLE'))

  const rejected = world()
  const fp2 = await rejected.fingerprint(WEB)
  rejected.state.cases[0].status = 'REJECTED'
  await assert.rejects(rejected.post('website', fp2), code('PREVIEW_CHANGED'))
  // The rejected charge leaves the clearing, so the payout no longer reconciles at all.
  await assert.rejects(rejected.post('website', await rejected.fingerprint(WEB)), code('PAYOUT_NEEDS_REVIEW'))
  assert.deepEqual([...removed.state.posts, ...rejected.state.posts], [])
  assert.deepEqual([...removed.state.components, ...rejected.state.components], [])
})

test('one posting at a time per payout', async () => {
  const w = world()
  w.state.locked = true
  await assert.rejects(w.post('burjman', await w.fingerprint(SHOP)), code('PAYOUT_POSTING_IN_PROGRESS'))
  assert.deepEqual(w.state.posts, [])
})

// ── Payout fee journal (Dr Stripe Fees 2270 / Cr 1013, one per payout) ──────

const A2270 = BASE.feeExpenseAccountId
const FEE_REF = `Stripe processing fees ${PO}`

async function postGroups(w, keys = ['burjman', 'website']) {
  for (const key of keys) {
    const out = await w.post(key, await w.fingerprint(key === 'website' ? WEB : SHOP))
    assert.equal(out.outcome, GROUP_STATUS.POSTED)
  }
}
const feeJournalPosts = (w) => w.state.posts.filter((p) => p.kind === 'FEE_JOURNAL')
const exactFeeJournal = (patch = {}) => ({
  journalId: 'ZJ-FEE-EXIST', referenceNumber: FEE_REF, journalDate: '2026-09-28',
  lineItems: [{ accountId: A2270, debitOrCredit: 'debit', amount: 147.28, customerId: '' }, { accountId: A1013, debitOrCredit: 'credit', amount: 147.28, customerId: '' }],
  ...patch,
})

test('fee journal: one total journal per payout, Website 107.22 + Burjman 40.06 = Dr 2270 / Cr 1013 147.28', async () => {
  const w = world()
  await postGroups(w)
  const before = await w.preview()
  assert.equal(before.status, PAYOUT_STATUS.FEE_JOURNAL_PENDING)
  const fj = before.feeJournal
  assert.equal(fj.status, FJ.READY)
  assert.equal(fj.postable, true)
  assert.equal(fj.amount, 147.28)
  assert.equal(fj.stripeFeeTotal, 147.28)
  assert.equal(fj.verifiedFeeTotal, 147.28)
  assert.deepEqual(fj.feeComponents.map((f) => [f.customerId, f.amount, f.zohoState]), [[WEB, 107.22, 'VERIFIED'], [SHOP, 40.06, 'VERIFIED']])
  assert.equal(fj.reference, FEE_REF)
  assert.equal(fj.date, '2026-09-28')

  const out = await w.postFee(fj.postingFingerprint)
  assert.equal(out.outcome, FJ.VERIFIED)
  assert.equal(out.zohoRequests, 1)
  assert.equal(feeJournalPosts(w).length, 1)
  assert.deepEqual(feeJournalPosts(w)[0].payload, {
    journal_date: '2026-09-28',
    reference_number: FEE_REF,
    journal_type: 'both',
    line_items: [
      { account_id: A2270, debit_or_credit: 'debit', amount: 147.28 },
      { account_id: A1013, debit_or_credit: 'credit', amount: 147.28 },
    ],
  })
  const local = w.localFee()
  assert.equal(local.zohoCustomerId, null)
  assert.equal(local.status, 'VERIFIED')
  assert.equal(local.amount, 147.28)
  assert.equal(local.debitAccountId, A2270)
  assert.equal(local.creditAccountId, A1013)
  assert.deepEqual(local.allocations, [])
  assert.equal(w.state.components.filter((c) => c.component === 'PAYOUT_FEE_JOURNAL').length, 1)

  const after = await w.preview()
  assert.equal(after.feeJournal.status, FJ.VERIFIED)
  assert.equal(after.feeJournal.postable, false)
  assert.equal(after.status, PAYOUT_STATUS.FULLY_CLEARED)

  // Re-submitting the same review is a no-op.
  const again = await w.postFee(fj.postingFingerprint)
  assert.equal(again.alreadyPosted, true)
  assert.equal(feeJournalPosts(w).length, 1)
})

test('fee journal: never per customer, per invoice, pi_-referenced, tagged, noted or branded', async () => {
  const w = world()
  await postGroups(w)
  await w.postFee(await w.feeFingerprint())
  const [{ payload: p }] = feeJournalPosts(w)
  assert.equal(p.line_items.length, 2)
  assert.ok(p.line_items.every((l) => !l.customer_id))
  assert.ok(!('notes' in p) && !('description' in p))
  const text = JSON.stringify(p)
  assert.ok(!/pi_|ch_|INV-|HR|hr-attendance|Purchase Planning|Generated/i.test(text))
  assert.ok(!w.state.components.some((c) => c.component === 'PAYOUT_FEE_JOURNAL' && c.zohoCustomerId))
})

test('fee journal: Website-only and Burjman-only payouts post their own total', async () => {
  const web = world({ only: [WEB] })
  await postGroups(web, ['website'])
  const wfj = (await web.preview()).feeJournal
  assert.equal(wfj.status, FJ.READY)
  assert.equal(wfj.amount, 107.22)
  assert.deepEqual(wfj.feeComponents.map((f) => f.customerId), [WEB])
  await web.postFee(wfj.postingFingerprint)
  assert.equal(feeJournalPosts(web)[0].payload.line_items[0].amount, 107.22)
  assert.equal((await web.preview()).status, PAYOUT_STATUS.FULLY_CLEARED)

  const shop = world({ only: [SHOP] })
  await postGroups(shop, ['burjman'])
  const sfj = (await shop.preview()).feeJournal
  assert.equal(sfj.amount, 40.06)
  await shop.postFee(sfj.postingFingerprint)
  assert.deepEqual(feeJournalPosts(shop)[0].payload.line_items.map((l) => [l.account_id, l.amount]), [[A2270, 40.06], [A1013, 40.06]])
  assert.equal((await shop.preview()).status, PAYOUT_STATUS.FULLY_CLEARED)
})

test('fee journal waits for every group, every FEE and the advance journal to verify', async () => {
  const w = world({ script: { JOURNAL: ['reject'] } })
  const none = (await w.preview()).feeJournal
  assert.equal(none.status, FJ.WAITING)
  assert.equal(none.postable, false)
  await assert.rejects(w.postFee(none.postingFingerprint), code('FEE_JOURNAL_NOT_POSTABLE'))

  await postGroups(w, ['burjman'])
  const half = await w.preview()
  assert.equal(half.feeJournal.status, FJ.WAITING)
  assert.match(half.feeJournal.reasons.join(' '), /Website/)
  assert.equal(half.status, PAYOUT_STATUS.PARTIALLY_CLEARED)

  // Website NET + FEE verify, but its customer advance journal is rejected.
  const out = await w.post('website', await w.fingerprint(WEB))
  assert.equal(out.outcome, GROUP_STATUS.PARTIALLY_POSTED)
  const partial = (await w.preview()).feeJournal
  assert.equal(partial.status, FJ.WAITING)
  assert.equal(partial.feeComponents.every((f) => f.zohoState === 'VERIFIED'), true, 'both FEE payments are verified')
  await assert.rejects(w.postFee(partial.postingFingerprint), code('FEE_JOURNAL_NOT_POSTABLE'))
  assert.equal(feeJournalPosts(w).length, 0)

  // Once the advance journal verifies, the fee journal becomes ready.
  await w.post('website', await w.fingerprint(WEB))
  assert.equal((await w.preview()).feeJournal.status, FJ.READY)
})

test('fee journal: an exact existing journal is recovered and recorded without posting', async () => {
  const w = world()
  await postGroups(w)
  w.state.journals.push(exactFeeJournal())
  const fj = (await w.preview()).feeJournal
  assert.equal(fj.status, FJ.VERIFIED)
  assert.equal(fj.tracked, false)
  assert.equal(fj.postable, true)
  const out = await w.postFee(fj.postingFingerprint)
  assert.equal(out.outcome, FJ.VERIFIED)
  assert.equal(out.zohoRequests, 0)
  assert.equal(feeJournalPosts(w).length, 0)
  assert.equal(w.localFee().zohoRecordId, 'ZJ-FEE-EXIST')
  assert.equal((await w.preview()).status, PAYOUT_STATUS.FULLY_CLEARED)
})

test('fee journal: a same-reference journal with other accounts, amount or date is blocked', async () => {
  const variants = [
    exactFeeJournal({ lineItems: [{ accountId: A2270, debitOrCredit: 'debit', amount: 140, customerId: '' }, { accountId: A1013, debitOrCredit: 'credit', amount: 140, customerId: '' }] }),
    exactFeeJournal({ lineItems: [{ accountId: A1019, debitOrCredit: 'debit', amount: 147.28, customerId: '' }, { accountId: A1013, debitOrCredit: 'credit', amount: 147.28, customerId: '' }] }),
    exactFeeJournal({ lineItems: [{ accountId: A2270, debitOrCredit: 'debit', amount: 147.28, customerId: '' }, { accountId: A1123, debitOrCredit: 'credit', amount: 147.28, customerId: '' }] }),
    exactFeeJournal({ journalDate: '2026-09-27' }),
    exactFeeJournal({ lineItems: [{ accountId: A2270, debitOrCredit: 'debit', amount: 107.22, customerId: '' }, { accountId: A2270, debitOrCredit: 'debit', amount: 40.06, customerId: '' }, { accountId: A1013, debitOrCredit: 'credit', amount: 147.28, customerId: '' }] }),
    exactFeeJournal({ lineItems: [{ accountId: A2270, debitOrCredit: 'debit', amount: 147.28, customerId: WEB }, { accountId: A1013, debitOrCredit: 'credit', amount: 147.28, customerId: '' }] }),
  ]
  for (const journal of variants) {
    const w = world()
    await postGroups(w)
    w.state.journals.push(journal)
    const before = await w.preview()
    assert.equal(before.feeJournal.status, FJ.NEEDS_REVIEW, JSON.stringify(journal))
    assert.equal(before.feeJournal.postable, false)
    assert.equal(before.status, PAYOUT_STATUS.NEEDS_REVIEW)
    await assert.rejects(w.postFee(before.feeJournal.postingFingerprint), code('FEE_JOURNAL_NOT_POSTABLE'))
    assert.equal(feeJournalPosts(w).length, 0)
  }
})

test('fee journal: two journals with the payout fee reference are blocked', async () => {
  const w = world()
  await postGroups(w)
  w.state.journals.push(exactFeeJournal(), exactFeeJournal({ journalId: 'ZJ-FEE-TWO' }))
  const fj = (await w.preview()).feeJournal
  assert.equal(fj.status, FJ.NEEDS_REVIEW)
  assert.match(fj.reasons[0], /2 Zoho journals/)
  await assert.rejects(w.postFee(fj.postingFingerprint), code('FEE_JOURNAL_NOT_POSTABLE'))
  assert.equal(feeJournalPosts(w).length, 0)
})

test('fee journal timeout / no ID: found → verified without re-posting; lost → retryable, then posted once', async () => {
  const found = world({ script: { FEE_JOURNAL: ['timeout-created'] } })
  await postGroups(found)
  const out = await found.postFee(await found.feeFingerprint())
  assert.equal(out.outcome, FJ.VERIFIED)
  assert.equal(feeJournalPosts(found).length, 1)
  assert.match(out.component.reason, /found exactly one matching journal/)

  const noId = world({ script: { FEE_JOURNAL: ['no-id'] } })
  await postGroups(noId)
  assert.equal((await noId.postFee(await noId.feeFingerprint())).outcome, FJ.VERIFIED)
  assert.equal(feeJournalPosts(noId).length, 1)

  const lost = world({ script: { FEE_JOURNAL: ['timeout'] } })
  await postGroups(lost)
  const first = await lost.postFee(await lost.feeFingerprint())
  assert.equal(first.outcome, 'NOT_POSTED')
  assert.equal(lost.localFee().status, 'FAILED')
  const retry = (await lost.preview()).feeJournal
  assert.equal(retry.status, FJ.READY)
  assert.equal(retry.recovery.action, 'RETRY_ELIGIBLE')
  assert.equal((await lost.postFee(retry.postingFingerprint)).outcome, FJ.VERIFIED)
  assert.equal(feeJournalPosts(lost).length, 2)
  assert.equal(lost.localFee().attemptCount, 2)

  const rejected = world({ script: { FEE_JOURNAL: ['reject'] } })
  await postGroups(rejected)
  assert.equal((await rejected.postFee(await rejected.feeFingerprint())).outcome, 'NOT_POSTED')
  assert.equal(rejected.localFee().status, 'FAILED')
})

test('fee journal created but not matching on read-back needs review; the payout is not fully cleared', async () => {
  const wrong = (payload, { state }) => {
    state.journals.push({ journalId: 'ZJ-WRONG', referenceNumber: payload.reference_number, journalDate: payload.journal_date, lineItems: [{ accountId: A2270, debitOrCredit: 'debit', amount: 147.29, customerId: '' }, { accountId: A1013, debitOrCredit: 'credit', amount: 147.29, customerId: '' }] })
    return { recordId: 'ZJ-WRONG' }
  }
  const w = world({ script: { FEE_JOURNAL: [wrong] } })
  await postGroups(w)
  const out = await w.postFee(await w.feeFingerprint())
  assert.equal(out.outcome, FJ.NEEDS_REVIEW)
  assert.equal(w.localFee().status, 'NEEDS_REVIEW')
  const after = await w.preview()
  assert.equal(after.feeJournal.status, FJ.NEEDS_REVIEW)
  assert.notEqual(after.status, PAYOUT_STATUS.FULLY_CLEARED)
})

test('fee journal posting disabled / test key: refused before any read, lock or record', async () => {
  const w = world()
  await postGroups(w)
  const fp = await w.feeFingerprint()
  const locksBefore = w.state.locked
  await assert.rejects(w.postFee(fp, { config: BASE }), (err) => err.status === 403 && err.code === 'STRIPE_CLEARING_POSTING_DISABLED')
  await assert.rejects(w.postFee(fp, { stripeConfig: TEST_MODE }), (err) => err.status === 403)
  assert.equal(w.state.locked, locksBefore)
  assert.equal(feeJournalPosts(w).length, 0)
  assert.equal(w.localFee(), undefined)
})

test('fee journal needs an admin, a payout ID and the reviewed fingerprint', async () => {
  const w = world()
  await postGroups(w)
  await assert.rejects(postPayoutFeeJournal(PO, { fingerprint: 'x' }, { config: CFG, stripeConfig: LIVE }), code('ACTOR_REQUIRED'))
  await assert.rejects(postPayoutFeeJournal(PO, { actor: 'user:1' }, { config: CFG, stripeConfig: LIVE }), code('FINGERPRINT_REQUIRED'))
  await assert.rejects(postPayoutFeeJournal('pi_123', { actor: 'user:1', fingerprint: 'x' }, { config: CFG, stripeConfig: LIVE }), code('INVALID_PAYOUT_ID'))
  await assert.rejects(w.postFee('not-the-reviewed-plan'), code('PREVIEW_CHANGED'))
  assert.equal(feeJournalPosts(w).length, 0)
})

test('fee journal: a changed Stripe payout or a changed Zoho FEE payment blocks posting', async () => {
  const moved = world()
  await postGroups(moved)
  const fp = await moved.feeFingerprint()
  moved.state.payout.arrivalDate = '2026-09-29T00:00:00.000Z'
  await assert.rejects(moved.postFee(fp), code('PREVIEW_CHANGED'))

  const replaced = world()
  await postGroups(replaced)
  const fp2 = await replaced.feeFingerprint()
  const fee = replaced.state.payments.find((p) => p.customerId === SHOP && p.referenceNumber.startsWith('Stripe processing fee'))
  fee.paymentId = 'ZP-REPLACED'
  fee.detail.payment_id = 'ZP-REPLACED'
  await assert.rejects(replaced.postFee(fp2), (err) => ['PREVIEW_CHANGED', 'FEE_JOURNAL_NOT_POSTABLE'].includes(err.code))

  const deleted = world()
  await postGroups(deleted)
  const fp3 = await deleted.feeFingerprint()
  deleted.state.payments = deleted.state.payments.filter((p) => !(p.customerId === WEB && p.referenceNumber.startsWith('Stripe processing fee')))
  await assert.rejects(deleted.postFee(fp3), (err) => ['PREVIEW_CHANGED', 'FEE_JOURNAL_NOT_POSTABLE'].includes(err.code))
  assert.deepEqual([...feeJournalPosts(moved), ...feeJournalPosts(replaced), ...feeJournalPosts(deleted)], [])
})

test('fee journal: verified FEE payments must equal the Stripe fee total', async () => {
  const w = world()
  await postGroups(w)
  const fj = (await w.preview()).feeJournal
  assert.equal(fj.verifiedFeeTotal, fj.stripeFeeTotal)
  const m = require('../src/services/stripeClearing/stripePayoutClearingModel')
  const derived = m.deriveFeeJournalStatus({
    payoutBlockers: [], groups: [{ customerName: 'Website', status: 'POSTED', components: [{ component: 'FEE', zoho: { state: 'VERIFIED' } }] }],
    stripeFeeMinor: 14728, verifiedFeeMinor: 10722, accountProblems: [], zoho: { state: 'MISSING' }, local: null,
  })
  assert.equal(derived.status, FJ.NEEDS_REVIEW)
  assert.match(derived.reasons[0], /107\.22.*147\.28/)
})

test('historical-style payout (groups posted outside this workflow) is never given a second fee journal', async () => {
  const w = world()
  await postGroups(w)
  w.state.components = []
  const none = await w.preview()
  assert.ok(none.groups.every((g) => g.status === GROUP_STATUS.ALREADY_POSTED))
  assert.equal(none.feeJournal.status, FJ.NEEDS_REVIEW)
  assert.equal(none.feeJournal.postable, false)
  await assert.rejects(w.postFee(none.feeJournal.postingFingerprint), code('FEE_JOURNAL_NOT_POSTABLE'))

  w.state.journals.push({
    journalId: 'ZJ-LEGACY', entryNumber: '3990', journalDate: '2026-09-26', referenceNumber: 'Website&Burjuman stripe transaction fee - 30 Invoices',
    lineItems: [
      { accountId: A2270, debitOrCredit: 'debit', amount: 107.22, customerId: '' },
      { accountId: A2270, debitOrCredit: 'debit', amount: 40.06, customerId: '' },
      { accountId: A2270, debitOrCredit: 'debit', amount: 12.5, customerId: '' },
      { accountId: A1013, debitOrCredit: 'credit', amount: 159.78, customerId: '' },
    ],
  })
  const legacy = await w.preview()
  assert.equal(legacy.feeJournal.status, FJ.LEGACY_VERIFIED)
  assert.equal(legacy.status, PAYOUT_STATUS.FULLY_CLEARED)
  await assert.rejects(w.postFee(legacy.feeJournal.postingFingerprint), code('FEE_JOURNAL_NOT_POSTABLE'))
  assert.equal(feeJournalPosts(w).length, 0)
})

test('the customer advance refund (Dr 1123 / Cr 1019) is never part of the fee journal', async () => {
  const w = world()
  await postGroups(w)
  await w.postFee(await w.feeFingerprint())
  const accounts = feeJournalPosts(w)[0].payload.line_items.map((l) => l.account_id)
  assert.deepEqual(accounts, [A2270, A1013])
  assert.ok(!accounts.includes(A1123) && !accounts.includes(A1019))
  assert.equal(w.state.cases[0].refundStatus, 'REFUND_DETECTED')
  assert.ok(!w.state.components.some((c) => c.component === 'CUSTOMER_ADVANCE_REFUND'))
})

test('fee journal: one posting at a time per payout', async () => {
  const w = world()
  await postGroups(w)
  const fp = await w.feeFingerprint()
  w.state.locked = true
  await assert.rejects(w.postFee(fp), code('PAYOUT_POSTING_IN_PROGRESS'))
  assert.equal(feeJournalPosts(w).length, 0)
})
