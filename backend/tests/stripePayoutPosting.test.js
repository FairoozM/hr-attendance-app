'use strict'

/**
 * Payout + customer group posting to Zoho. Zoho is a stateful fake: customer payments
 * reduce invoice balances, journals are stored, and each POST can be scripted to succeed,
 * time out, fail with 5xx or be rejected. Figures are po_1UJNObDJogiiRoKPHtPAr3KE.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { getStripeClearingConfig } = require('../src/config/stripeClearing')
const { previewPayout, componentZohoState } = require('../src/services/stripeClearing/stripePayoutPreviewService')
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

// Zoho visibility in the fakes: `hidden` records exist in Zoho but no read path shows them yet
// (lag); `unindexed` ones are missing only from the reference search (direct evidence shows them).
const seen = (state, id) => !state.hidden.has(id)
const indexed = (state, id) => !state.hidden.has(id) && !state.unindexed.has(id)
const LAG_STEPS = { 'timeout-hidden': 'hidden', 'no-id-hidden': 'hidden', 'timeout-unindexed': 'unindexed', 'no-id-unindexed': 'unindexed' }
function lagStep(step, state, create, payload) {
  const id = create(payload)
  state[LAG_STEPS[step]].add(id)
  if (step.startsWith('no-id')) return { recordId: '' }
  throw zohoError('timeout')
}

/** Extra recovery fields both fake stores keep, like the Postgres store. */
function applyRecoveryPatch(cur, to, patch) {
  if (patch.uncertainAt) { cur.uncertainSince = patch.uncertainAt; cur.firstUncertainAt = cur.firstUncertainAt || patch.uncertainAt }
  if (patch.recoveryCheckAt) { cur.lastRecoveryCheckAt = patch.recoveryCheckAt; cur.recoveryCheckCount = (cur.recoveryCheckCount || 0) + 1 }
  if (patch.retryAuthorization) {
    Object.assign(cur, { retryAuthorizedAt: patch.retryAuthorization.at, retryAuthorizedBy: patch.retryAuthorization.by, retryAuthorizationReason: patch.retryAuthorization.reason, retryAuthorizationEvidence: patch.retryAuthorization.evidence })
  }
  if (patch.requestSnapshot) cur.requestSnapshot = JSON.parse(JSON.stringify(patch.requestSnapshot))
  if (to === 'POSTING_UNCERTAIN') assert.ok(cur.uncertainSince && cur.firstUncertainAt, 'POSTING_UNCERTAIN needs uncertain_since')
  if (patch.retryAuthorization) assert.ok(cur.retryAuthorizedBy && cur.retryAuthorizationReason && cur.retryAuthorizationEvidence, 'retry authorization needs admin + reason + evidence')
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
    hidden: new Set(),
    unindexed: new Set(),
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
    findZohoPaymentsByReference: async (ref) => state.payments.filter((p) => p.referenceNumber === ref && indexed(state, p.paymentId)).map(({ detail, ...p }) => p),
    listZohoInvoicePayments: async (id) => state.payments
      .filter((p) => seen(state, p.paymentId) && p.detail.invoices.some((i) => i.invoice_id === id))
      .map((p) => ({ paymentId: p.paymentId, invoiceId: id, referenceNumber: p.referenceNumber, amount: p.amount, date: p.detail.date || '' })),
    findZohoJournalsByReference: async (ref) => state.journals.filter((j) => j.referenceNumber === ref && indexed(state, j.journalId)).map((j) => ({ journalId: j.journalId, referenceNumber: j.referenceNumber })),
    getZohoJournal: async (id) => {
      const j = state.journals.find((x) => x.journalId === id && seen(state, x.journalId))
      return j ? { journalId: j.journalId, referenceNumber: j.referenceNumber, journalDate: j.journalDate, status: j.status || 'published', lineItems: j.lineItems } : null
    },
    listZohoJournalsInRange: async (start, end) => state.journals
      .filter((j) => j.journalDate >= start && j.journalDate <= end && seen(state, j.journalId))
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
      detail: { payment_id: paymentId, customer_id: payload.customer_id, reference_number: payload.reference_number, date: payload.date, amount, account_id: payload.account_id, invoices: payload.invoices.map((i) => ({ ...i })) },
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
    if (LAG_STEPS[step]) return lagStep(step, state, create, payload)
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
      applyRecoveryPatch(cur, to, patch)
      if (to === 'VERIFIED') assert.ok(cur.zohoRecordId && cur.verifiedAt, 'VERIFIED needs a Zoho ID and verified_at')
      state.events.push({ entityId: id, component: cur.component, customerId: cur.zohoCustomerId, fromStatus: prev, toStatus: to, detail, actor, eventType: patch.event || null, evidence: patch.evidence || null })
      return { ...cur }
    },
    async getComponent(_db, id) {
      const cur = state.components.find((x) => x.id === id)
      return cur ? { ...cur } : null
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
    deps,
    sources,
    payoutId: PO,
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
  w.state.payments.push({ paymentId: 'ZP-EXIST', customerId: SHOP, referenceNumber: net.reference_number, amount: net.amount, accountId: A1019, detail: { payment_id: 'ZP-EXIST', customer_id: SHOP, reference_number: net.reference_number, date: net.date, amount: net.amount, account_id: A1019, invoices: net.invoices } })
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

test('NET timeout: found in Zoho → verified without re-posting; not found → POSTING_UNCERTAIN, never re-sent', async () => {
  const found = world({ script: { NET: ['timeout-created'] } })
  const out = await found.post('burjman', await found.fingerprint(SHOP))
  assert.deepEqual(kinds(found), ['NET', 'FEE'])
  assert.equal(out.outcome, GROUP_STATUS.POSTED)
  assert.equal(found.local(SHOP, 'NET').attemptCount, 1)
  assert.match(found.state.events.find((e) => e.component === 'NET' && e.toStatus === 'VERIFIED').detail, /result is unknown.*exactly one matching/)

  const lost = world({ script: { NET: ['timeout-lost'] } })
  const first = await lost.post('burjman', await lost.fingerprint(SHOP))
  assert.deepEqual(kinds(lost), ['NET'])
  assert.equal(first.outcome, GROUP_STATUS.POSTING_UNCERTAIN)
  assert.deepEqual(first.notAttempted, ['FEE'])
  assert.equal(lost.local(SHOP, 'NET').status, 'POSTING_UNCERTAIN')
  assert.match(lost.local(SHOP, 'NET').lastError, /do not repost/)
  const p = await lost.preview()
  assert.deepEqual([group(p, SHOP).status, group(p, SHOP).postable, p.status], [GROUP_STATUS.POSTING_UNCERTAIN, false, PAYOUT_STATUS.POSTING_UNCERTAIN])

  await assert.rejects(lost.post('burjman', await lost.fingerprint(SHOP)), code('GROUP_NOT_POSTABLE'))
  assert.deepEqual(kinds(lost), ['NET'], 'no second NET POST')
  assert.equal(lost.local(SHOP, 'NET').attemptCount, 1)
})

test('FEE timeout / 5xx: found → verified; lost → POSTING_UNCERTAIN with NET kept, FEE never re-sent', async () => {
  const found = world({ script: { FEE: ['5xx-created'] } })
  assert.equal((await found.post('burjman', await found.fingerprint(SHOP))).outcome, GROUP_STATUS.POSTED)
  assert.deepEqual(kinds(found), ['NET', 'FEE'])

  const lost = world({ script: { FEE: ['5xx-lost'] } })
  const first = await lost.post('burjman', await lost.fingerprint(SHOP))
  assert.equal(first.outcome, GROUP_STATUS.POSTING_UNCERTAIN)
  assert.deepEqual([lost.local(SHOP, 'NET').status, lost.local(SHOP, 'FEE').status], ['VERIFIED', 'POSTING_UNCERTAIN'])
  assert.equal(group(await lost.preview(), SHOP).status, GROUP_STATUS.POSTING_UNCERTAIN)
  await assert.rejects(lost.post('burjman', await lost.fingerprint(SHOP)), code('GROUP_NOT_POSTABLE'))
  assert.deepEqual(kinds(lost), ['NET', 'FEE'])
  assert.equal(lost.state.payments.filter((p) => p.referenceNumber.startsWith('Stripe funds received')).length, 1)
})

test('journal timeout: found → verified; lost → POSTING_UNCERTAIN, advance journal never re-sent', async () => {
  const found = world({ script: { JOURNAL: ['timeout-created'] } })
  assert.equal((await found.post('website', await found.fingerprint(WEB))).outcome, GROUP_STATUS.POSTED)
  assert.equal(found.state.journals.length, 1)

  const lost = world({ script: { JOURNAL: ['timeout-lost'] } })
  const first = await lost.post('website', await lost.fingerprint(WEB))
  assert.equal(first.outcome, GROUP_STATUS.POSTING_UNCERTAIN)
  assert.equal(lost.state.cases[0].status, 'CONFIRMED')
  await assert.rejects(lost.post('website', await lost.fingerprint(WEB)), code('GROUP_NOT_POSTABLE'))
  assert.deepEqual(kinds(lost), ['NET', 'FEE', 'JOURNAL'])
  assert.equal(lost.local(WEB, 'CUSTOMER_ADVANCE').status, 'POSTING_UNCERTAIN')
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

test('fee journal timeout / no ID: found → verified without re-posting; lost → POSTING_UNCERTAIN, never re-sent', async () => {
  const found = world({ script: { FEE_JOURNAL: ['timeout-created'] } })
  await postGroups(found)
  const out = await found.postFee(await found.feeFingerprint())
  assert.equal(out.outcome, FJ.VERIFIED)
  assert.equal(feeJournalPosts(found).length, 1)
  assert.match(out.component.reason, /exactly one matching journal/)

  const noId = world({ script: { FEE_JOURNAL: ['no-id'] } })
  await postGroups(noId)
  assert.equal((await noId.postFee(await noId.feeFingerprint())).outcome, FJ.VERIFIED)
  assert.equal(feeJournalPosts(noId).length, 1)

  const lost = world({ script: { FEE_JOURNAL: ['timeout'] } })
  await postGroups(lost)
  const first = await lost.postFee(await lost.feeFingerprint())
  assert.equal(first.outcome, FJ.POSTING_UNCERTAIN)
  assert.equal(lost.localFee().status, 'POSTING_UNCERTAIN')
  const after = await lost.preview()
  assert.deepEqual([after.feeJournal.status, after.feeJournal.recovery.action, after.feeJournal.postable, after.status], [FJ.POSTING_UNCERTAIN, 'POSTING_UNCERTAIN', false, PAYOUT_STATUS.POSTING_UNCERTAIN])
  await assert.rejects(lost.postFee(after.feeJournal.postingFingerprint), code('FEE_JOURNAL_NOT_POSTABLE'))
  assert.equal(feeJournalPosts(lost).length, 1)
  assert.equal(lost.localFee().attemptCount, 1)

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

// ── Normal invoice refunds ──────────────────────────────────────────────────
// Stateful fake of Stripe refunds, website orders, Zoho invoices, credit notes, credit note
// refunds and journals. Warehouse credit notes exist already (numbered by order, linked to the
// invoice and its lines); Stripe refunds are paid from them. Figures follow po_1U8V40 (order
// 20717: 76.70 refunded of 382.59) and po_1U9Dr2 (order 20723).

const { postPayoutRefund } = require('../src/services/stripeClearing/stripePayoutPostingService')
const { NORMAL_REFUND_STATUS: NR, REFUND_KIND } = require('../src/services/stripeClearing/stripePayoutClearingModel')

const RPO = 'po_1U8V40RefundTest0001'
const A2270_ID = BASE.feeExpenseAccountId

const cnLine = (order, qty = 1, extra = {}) => ({ itemId: 'ITEM-ALIGNER', invoiceItemId: `IL-${order}-1`, name: 'Aligner', sku: 'SKU-1', quantity: qty, rate: 76.7, itemTotal: 73.05, ...extra })
const creditNote = (number, total, extra = {}) => ({ number, total, status: 'open', lines: [cnLine(number.split('-')[0])], refunds: [], ...extra })
const refundOf = (id, amount, extra = {}) => ({ id, amount, fee: 0, inPayout: true, status: 'succeeded', createdAt: '2026-09-01T10:00:00.000Z', ...extra })

/** A website sale: its charge may be in this payout (cleared here) or in an earlier one (invoice already paid). */
function sale(key, o) {
  const chargeInPayout = o.chargeInPayout === true
  return {
    key,
    chargeId: `ch_${key}`,
    pi: `pi_${key}`,
    order: o.order,
    invoiceNumber: o.invoiceNumber || `INV-0${o.order}`,
    customer: o.customer || WEB,
    gross: o.gross,
    fee: o.fee ?? 0,
    orderTotal: o.orderTotal ?? o.gross / 100,
    chargeInPayout,
    paidExternally: o.paidExternally ?? !chargeInPayout,
    orderStatus: o.orderStatus || 'delivered',
    paymentStatus: o.paymentStatus || 'completed',
    noInvoice: o.noInvoice === true,
    noOrder: o.noOrder === true,
    invoiceCustomer: o.invoiceCustomer || o.customer || WEB,
    invoiceLines: o.invoiceLines || [
      { lineItemId: `IL-${o.order}-1`, itemId: 'ITEM-ALIGNER', name: 'Aligner', quantity: 2 },
      { lineItemId: `IL-${o.order}-2`, itemId: 'ITEM-COURIER', name: 'Courier Charges', quantity: 1 },
    ],
    refunds: o.refunds || [],
    creditNotes: o.creditNotes || [],
  }
}

const CARRIER = () => sale('CARRIER30001', { order: '30001', gross: 50000, fee: 1500, chargeInPayout: true })
const S20717 = (o = {}) => sale('SALE20717xx', {
  order: '20717',
  gross: 38259,
  refunds: [refundOf('re_3U6IwD20717a', 7670)],
  creditNotes: [creditNote('20717', 76.7)],
  ...o,
})

function refundWorld(opts = {}) {
  const sales = opts.sales || [CARRIER(), S20717()]
  const state = {
    payments: [],
    journals: [...(opts.journals || [])],
    creditNotes: [],
    cases: (opts.cases || []).map((c) => ({ ...c })),
    components: [],
    refundComponents: [...(opts.refundComponents || [])],
    events: [],
    posts: [],
    locked: false,
    hidden: new Set(),
    unindexed: new Set(),
  }
  const script = { NET: [], FEE: [], JOURNAL: [], FEE_JOURNAL: [], CN_REFUND: [], REFUND_FEE: [], ...(opts.script || {}) }
  let seq = 0
  const liveRefunds = (s) => s.refunds.filter((x) => ['succeeded', 'pending'].includes(x.status))
  const btOf = (refundId) => `txn_${refundId.slice(3)}`

  for (const s of sales) {
    for (const n of s.creditNotes) {
      state.creditNotes.push({
        creditNoteId: `CN-${n.number}`,
        creditNoteNumber: n.number,
        customerId: n.customer || s.customer,
        status: n.status,
        total: n.total,
        invoiceId: n.invoiceId === undefined ? invoiceId(s.invoiceNumber) : n.invoiceId,
        invoiceNumber: n.invoiceNumber || s.invoiceNumber,
        lineItems: n.lines,
        refunds: n.refunds.map((r) => ({ ...r })),
      })
    }
  }

  const txns = []
  for (const s of sales) {
    const refundedMinor = liveRefunds(s).reduce((t, x) => t + x.amount, 0)
    if (s.chargeInPayout) {
      txns.push({
        balanceTransactionId: `txn_${s.key}`, type: 'charge', reportingCategory: 'charge', currency: 'AED', exchangeRate: null,
        amountMinor: s.gross, feeMinor: s.fee, netMinor: s.gross - s.fee, chargeId: s.chargeId, paymentIntentId: s.pi,
        chargeRefundedMinor: refundedMinor, chargeDisputed: false, chargeStatus: 'succeeded', chargeFullyRefunded: refundedMinor === s.gross,
      })
    }
    for (const x of s.refunds.filter((y) => y.inPayout)) {
      txns.push({
        balanceTransactionId: btOf(x.id), type: 'refund', reportingCategory: 'refund', currency: 'AED', exchangeRate: null,
        amountMinor: -x.amount, feeMinor: x.fee, netMinor: -x.amount - x.fee, sourceId: x.id, sourceObject: 'refund',
        chargeId: s.chargeId, paymentIntentId: s.pi, refundStatus: x.status,
      })
    }
  }
  txns.push(...(opts.extraTxns || []))
  const payout = { payoutId: RPO, status: 'paid', currency: 'AED', arrivalDate: '2026-09-03T00:00:00.000Z', createdAt: '2026-09-02T00:30:00.000Z', amountMinor: txns.reduce((t, x) => t + x.netMinor, 0), ...(opts.payout || {}) }

  const applied = (id) => state.payments.reduce((t, p) => t + p.detail.invoices.filter((i) => i.invoice_id === id).reduce((a, i) => a + Math.round(i.amount_applied * 100), 0), 0)
  function invoiceFor(s) {
    const id = invoiceId(s.invoiceNumber)
    const total = s.orderTotal
    const balance = s.paidExternally ? 0 : (Math.round(total * 100) - applied(id)) / 100
    const status = balance === 0 ? 'paid' : balance < total ? 'partially_paid' : 'overdue'
    return { invoiceId: id, invoiceNumber: s.invoiceNumber, referenceNumber: s.order, customerId: s.invoiceCustomer, status, total, balance, currencyCode: 'AED' }
  }
  const cnBalance = (n) => Math.round(n.total * 100 - n.refunds.reduce((t, r) => t + Math.round(r.amount * 100), 0)) / 100
  const cnListRow = (n) => {
    const balance = cnBalance(n)
    return { creditNoteId: n.creditNoteId, creditNoteNumber: n.creditNoteNumber, referenceNumber: '✅ Grade A – Brand New', customerId: n.customerId, status: n.status === 'open' && balance === 0 ? 'closed' : n.status, date: '2026-08-30', total: n.total, balance, currencyCode: 'AED' }
  }
  const saleByCharge = (chargeId) => sales.find((s) => s.chargeId === chargeId)

  const sources = {
    retrieveStripePayout: async (id) => (id === RPO ? { ...payout } : null),
    listPayoutBalanceTransactions: async () => [...txns, { balanceTransactionId: 'txn_PAYOUT', type: 'payout', currency: 'AED', amountMinor: -payout.amountMinor, feeMinor: 0, netMinor: -payout.amountMinor }],
    listChargeRefunds: async (chargeId) => {
      const s = saleByCharge(chargeId)
      return s ? s.refunds.map((x) => ({
        refundId: x.id, chargeId, paymentIntentId: s.pi, amountMinor: x.amount, currency: 'AED', status: x.status, createdAt: x.createdAt,
        balanceTransaction: { balanceTransactionId: btOf(x.id), type: 'refund', currency: 'AED', amountMinor: -x.amount, feeMinor: x.fee, netMinor: -x.amount - x.fee },
      })) : []
    },
    retrieveStripePaymentIntent: async (pi) => {
      const s = sales.find((x) => x.pi === pi)
      return s ? { paymentIntentId: pi, chargeId: s.chargeId, status: 'succeeded', amount: s.gross / 100, amountReceived: s.gross / 100, amountRefunded: liveRefunds(s).reduce((t, x) => t + x.amount, 0) / 100, disputed: false, currency: 'AED' } : null
    },
    loadWebsiteOrdersByIntents: async (ids) => sales.filter((s) => !s.noOrder && ids.includes(s.pi)).map((s, i) => ({
      orderId: String(20000 + i), orderNumber: s.order, orderStatus: s.orderStatus, paymentStatus: s.paymentStatus, stripePaymentIntentId: s.pi,
      shopOrder: s.customer === SHOP, finalAmount: s.orderTotal, refundAmount: 0, walletRedeemed: 0, deleted: false, sameNumberCount: 0,
    })),
    findZohoInvoicesByReference: async (ref) => sales.filter((s) => s.order === ref && !s.noInvoice).map(invoiceFor),
    getZohoInvoiceDetail: async (id) => {
      const s = sales.find((x) => invoiceId(x.invoiceNumber) === id)
      return s ? { ...invoiceFor(s), lineItems: s.invoiceLines } : null
    },
    findZohoPaymentsByReference: async (ref) => state.payments.filter((p) => p.referenceNumber === ref && indexed(state, p.paymentId)).map(({ detail, ...p }) => p),
    listZohoInvoicePayments: async (id) => state.payments
      .filter((p) => seen(state, p.paymentId) && p.detail.invoices.some((i) => i.invoice_id === id))
      .map((p) => ({ paymentId: p.paymentId, invoiceId: id, referenceNumber: p.referenceNumber, amount: p.amount, date: '' })),
    findZohoJournalsByReference: async (ref) => state.journals.filter((j) => j.referenceNumber === ref && indexed(state, j.journalId)).map((j) => ({ journalId: j.journalId, referenceNumber: j.referenceNumber })),
    getZohoJournal: async (id) => {
      const j = state.journals.find((x) => x.journalId === id && seen(state, x.journalId))
      return j ? { journalId: j.journalId, referenceNumber: j.referenceNumber, journalDate: j.journalDate, status: 'published', lineItems: j.lineItems } : null
    },
    // Legacy journals are only listed when a test asks for them; this workflow's own always are.
    listZohoJournalsInRange: async (start, end) => state.journals
      .filter((j) => (opts.legacyInRange || j.created) && seen(state, j.journalId) && j.journalDate >= start && j.journalDate <= end)
      .map((j) => ({
        journalId: j.journalId, entryNumber: j.entryNumber || null, referenceNumber: j.referenceNumber, journalDate: j.journalDate, status: 'published', notes: '',
        total: j.lineItems.filter((l) => l.debitOrCredit === 'debit').reduce((t, l) => t + l.amount, 0),
      })),
    findZohoCreditNotesForOrder: async (order, customerId) => state.creditNotes
      .filter((n) => n.customerId === customerId && n.creditNoteNumber.startsWith(order) && (n.creditNoteNumber === order || /^\D/.test(n.creditNoteNumber.slice(order.length))))
      .map(cnListRow),
    getZohoCreditNote: async (id) => {
      const n = state.creditNotes.find((x) => x.creditNoteId === id)
      return n ? { ...cnListRow(n), invoiceId: n.invoiceId, invoiceNumber: n.invoiceNumber, salesReturnNumber: 'RMA-04320', lineItems: n.lineItems } : null
    },
    listZohoCreditNoteRefunds: async (id) => {
      const n = state.creditNotes.find((x) => x.creditNoteId === id)
      return n ? n.refunds.filter((r) => seen(state, r.creditNoteRefundId)).map((r) => ({ creditNoteRefundId: r.creditNoteRefundId, creditNoteId: id, date: r.date, referenceNumber: r.referenceNumber, amount: r.amount, refundMode: 'Stripe' })) : []
    },
    getZohoCreditNoteRefund: async (id, rid) => {
      const n = state.creditNotes.find((x) => x.creditNoteId === id)
      const r = n && n.refunds.find((x) => x.creditNoteRefundId === rid && seen(state, rid))
      return r ? { creditNoteRefundId: rid, creditNoteId: id, date: r.date, referenceNumber: r.referenceNumber, amount: r.amount, refundMode: 'Stripe', fromAccountId: r.fromAccountId, fromAccountName: r.fromAccountId === A1019 ? 'Stripe Undeposited Funds' : 'Other' } : null
    },
  }
  const zohoPayments = {
    listZohoChartAccounts: async () => ACCOUNTS,
    getZohoCustomerPayment: async (id) => {
      const p = state.payments.find((x) => x.paymentId === id)
      return p ? p.detail : null
    },
  }

  function storePayment(payload) {
    const paymentId = `ZP-${++seq}`
    state.payments.push({
      paymentId, customerId: payload.customer_id, referenceNumber: payload.reference_number, amount: payload.amount, accountId: payload.account_id,
      detail: { payment_id: paymentId, customer_id: payload.customer_id, reference_number: payload.reference_number, date: payload.date, amount: payload.amount, account_id: payload.account_id, invoices: payload.invoices.map((i) => ({ ...i })) },
    })
    return paymentId
  }
  function storeJournal(payload) {
    const journalId = `ZJ-${++seq}`
    state.journals.push({
      journalId, referenceNumber: payload.reference_number, journalDate: payload.journal_date, created: true,
      lineItems: payload.line_items.map((li) => ({ accountId: li.account_id, debitOrCredit: li.debit_or_credit, amount: li.amount, customerId: li.customer_id || '' })),
    })
    return journalId
  }
  const storeCnRefund = (creditNoteId, delta = 0) => (payload) => {
    const n = state.creditNotes.find((x) => x.creditNoteId === creditNoteId)
    const amount = Math.round((payload.amount + delta) * 100) / 100
    // Zoho refuses more than the credit note has left (a scripted wrong record bypasses this).
    if (!delta && Math.round(amount * 100) > Math.round(cnBalance(n) * 100)) throw Object.assign(new Error('Refund exceeds credit note balance'), { httpStatus: 400, code: 'ZOHO_API_ERROR' })
    const id = `ZCR-${++seq}`
    n.refunds.push({ creditNoteRefundId: id, date: payload.date, referenceNumber: payload.reference_number, amount, fromAccountId: payload.from_account_id })
    return id
  }
  async function perform(kind, payload, create, createWrong) {
    state.posts.push({ kind, payload })
    const step = script[kind].shift() || 'ok'
    if (typeof step === 'function') return step(payload, { create, state })
    if (step === 'ok') return { recordId: create(payload) }
    if (LAG_STEPS[step]) return lagStep(step, state, create, payload)
    if (step === 'no-id') { create(payload); return { recordId: '' } }
    if (step === 'created-wrong') return { recordId: createWrong(payload) }
    if (step.endsWith('-created')) { create(payload); throw zohoError(step) }
    throw zohoError(step)
  }
  const journalKind = (ref) => (ref.startsWith('Stripe processing fees') ? 'FEE_JOURNAL' : ref.startsWith('Stripe refund fee') ? 'REFUND_FEE' : 'JOURNAL')
  const writer = {
    createCustomerPayment: (payload) => perform(payload.reference_number.startsWith('Stripe funds received') ? 'NET' : 'FEE', payload, storePayment),
    createJournal: (payload) => perform(journalKind(payload.reference_number), payload, storeJournal),
    createCreditNoteRefund: (creditNoteId, payload) => perform('CN_REFUND', { creditNoteId, ...payload }, (p) => storeCnRefund(creditNoteId)(payload), () => storeCnRefund(creditNoteId, 0.01)(payload)),
  }

  let nextId = 1
  const upsert = (table, key) => async (_db, c, actor) => {
    const cur = state[table].find((x) => key(x, c))
    if (cur && !['PLANNED', 'FAILED'].includes(cur.status)) return { component: { ...cur }, changed: false }
    if (cur) { Object.assign(cur, c); return { component: { ...cur }, changed: true } }
    const row = { id: String(nextId++), ...c, status: 'PLANNED', zohoRecordId: null, attemptCount: 0, lastError: null, postedAt: null, verifiedAt: null }
    state[table].push(row)
    state.events.push({ table, entityId: row.id, component: c.component, fromStatus: null, toStatus: 'PLANNED', actor })
    return { component: { ...row }, changed: true }
  }
  const transition = (table) => async (_db, id, from, to, patch = {}, detail, actor) => {
    const cur = state[table].find((x) => x.id === id)
    if (!cur || !from.includes(cur.status)) throw Object.assign(new Error(`${cur && cur.status} not in ${from}`), { status: 409, code: 'COMPONENT_STATE_CONFLICT' })
    const prev = cur.status
    cur.status = to
    if (patch.zohoRecordId) cur.zohoRecordId = patch.zohoRecordId
    if (patch.incrementAttempt) cur.attemptCount += 1
    if (patch.lastError) cur.lastError = patch.lastError
    if (patch.postedAt) cur.postedAt = patch.postedAt
    if (patch.verifiedAt) cur.verifiedAt = patch.verifiedAt
    applyRecoveryPatch(cur, to, patch)
    if (to === 'VERIFIED') assert.ok(cur.zohoRecordId && cur.verifiedAt, 'VERIFIED needs a Zoho ID and verified_at')
    state.events.push({ table, entityId: id, component: cur.component, fromStatus: prev, toStatus: to, detail, actor, eventType: patch.event || null, evidence: patch.evidence || null })
    return { ...cur }
  }
  const getRow = (table) => async (_db, id) => {
    const cur = state[table].find((x) => x.id === id)
    return cur ? { ...cur } : null
  }
  const store = {
    async acquirePayoutLock() {
      if (state.locked) throw Object.assign(new Error('locked'), { status: 409, code: 'PAYOUT_POSTING_IN_PROGRESS' })
      state.locked = true
      return { db: {}, release: async () => { state.locked = false } }
    },
    upsertPlannedComponent: upsert('components', (x, c) => x.payoutId === c.payoutId && x.zohoCustomerId === c.zohoCustomerId && x.component === c.component),
    transitionComponent: transition('components'),
    upsertPlannedRefundComponent: upsert('refundComponents', (x, c) => x.refundId === c.refundId && x.component === c.component),
    transitionRefundComponent: transition('refundComponents'),
    getComponent: getRow('components'),
    getRefundComponent: getRow('refundComponents'),
    async markAdvancePosted() { return [] },
  }
  const records = {
    loadAdvanceCases: async (ids) => state.cases.filter((c) => ids.includes(c.chargeId)),
    loadComponents: async (id) => state.components.filter((c) => c.payoutId === id),
    loadCaseEvents: async () => [],
    loadRefundComponents: async (ids) => state.refundComponents.filter((c) => ids.includes(c.refundId)),
  }
  const config = { ...CFG, ...(opts.config || {}) }
  // With a real pool, local records, events and the advisory lock are real Postgres; Zoho and Stripe stay fake.
  const pgStore = opts.pool ? require('../src/services/stripeClearing/stripePayoutClearingStore') : null
  const pgRecords = opts.pool ? {
    loadAdvanceCases: (ids) => pgStore.listCasesByChargeIds(opts.pool, ids),
    loadComponents: (id) => pgStore.listComponents(opts.pool, id),
    loadCaseEvents: (ids) => pgStore.listEvents(opts.pool, pgStore.ENTITY.ADVANCE_CASE, ids),
    loadRefundComponents: (ids) => pgStore.listRefundComponents(opts.pool, ids),
  } : null
  const previewDeps = { sources, zohoPayments, records: pgRecords || records }
  const deps = (patch = {}) => ({ config, stripeConfig: LIVE, store: pgStore || store, writer, pool: opts.pool || {}, previewDeps, now: () => new Date('2026-09-28T14:00:00.000Z'), ...patch })
  const preview = (patch = {}) => previewPayout(RPO, { ...previewDeps, config, stripeConfig: LIVE, ...patch })
  const w = {
    state,
    script,
    sales,
    preview,
    refund: async (id) => (await preview()).normalRefunds.find((x) => x.refundId === id),
    postRefund: async (id, fingerprint, patch) => {
      const current = fingerprint ?? ((await w.refund(id)) || {}).postingFingerprint ?? 'none'
      return postPayoutRefund(RPO, id, { actor: 'user:1', fingerprint: current }, deps(patch))
    },
    postGroup: async (key) => {
      const p = await preview()
      const g = p.groups.find((x) => x.customerId === (key === 'website' ? WEB : SHOP))
      return postPayoutCustomerGroup(RPO, key, { actor: 'user:1', fingerprint: g.postingFingerprint }, deps())
    },
    postFee: async (fingerprint) => postPayoutFeeJournal(RPO, { actor: 'user:1', fingerprint: fingerprint ?? (await preview()).feeJournal.postingFingerprint }, deps()),
    posts: (kind) => state.posts.filter((p) => p.kind === kind),
    deps,
    sources,
    payoutId: RPO,
    /** Movement of an account from every Zoho record this payout's workflow can create. */
    ledger(accountId) {
      let minor = 0
      for (const p of state.payments) if (p.accountId === accountId) minor += Math.round(p.amount * 100)
      for (const j of state.journals) {
        for (const l of j.lineItems) if (l.accountId === accountId) minor += (l.debitOrCredit === 'debit' ? 1 : -1) * Math.round(l.amount * 100)
      }
      for (const n of state.creditNotes) {
        for (const r of n.refunds) if (r.fromAccountId === accountId && r.referenceNumber.startsWith('Stripe refund re_')) minor -= Math.round(r.amount * 100)
      }
      return minor
    },
  }
  return w
}

async function clearEverything(w) {
  const p = await w.preview()
  for (const g of p.groups) if (g.postable) await w.postGroup(g.customerId === WEB ? 'website' : 'burjman')
  for (const r of (await w.preview()).normalRefunds) if (r.postable) await w.postRefund(r.refundId)
  const fj = (await w.preview()).feeJournal
  if (fj.postable) await w.postFee()
  return w.preview()
}

const REFUND_20717 = 're_3U6IwD20717a'

test('partial refund: credit note refund from 1019 for the Stripe gross, then FULLY_CLEARED with 1019 = payout', async () => {
  const w = refundWorld()
  const p = await w.preview()
  const r = p.normalRefunds.find((x) => x.refundId === REFUND_20717)
  assert.equal(r.status, NR.READY)
  assert.equal(r.kind, REFUND_KIND.PARTIAL_REFUND)
  assert.deepEqual([r.gross, r.stripeFee, r.feeAdjustment, r.net], [76.7, 0, 0, -76.7])
  assert.deepEqual([r.cumulativeRefunded, r.remainingRefundable, r.chargeGross], [76.7, 305.89, 382.59])
  assert.deepEqual([r.website.orderNumber, r.invoice.invoiceNumber, r.customerId, r.creditNote.creditNoteNumber, r.creditNote.matchedBy], ['20717', 'INV-020717', WEB, '20717', 'CREDIT_NOTE_TOTAL'])
  assert.deepEqual(r.clearingImpact, { stripeUndepositedFunds: -76.7, processingChargesUncleared: 0 })
  assert.deepEqual(r.components.map((c) => c.component), ['REFUND_CREDIT_NOTE_REFUND'])
  assert.deepEqual(r.components[0].payload, { date: '2026-09-03', refund_mode: 'Stripe', reference_number: `Stripe refund ${REFUND_20717}`, amount: 76.7, from_account_id: A1019 })
  assert.equal(r.postable, true)
  assert.equal(p.reconciliation.payoutMatches, true)
  assert.deepEqual([p.reconciliation.normalRefundsGross, p.reconciliation.normalRefundsNetOutOf1019, p.payout.amount], [76.7, 76.7, 408.3])
  assert.equal(p.groups.length, 1)
  assert.equal(p.status, PAYOUT_STATUS.READY)
  assert.deepEqual(p.refundBlockers, [])

  const out = await w.postRefund(REFUND_20717)
  assert.equal(out.outcome, NR.VERIFIED)
  assert.deepEqual(w.posts('CN_REFUND').map((x) => x.payload), [{ creditNoteId: 'CN-20717', date: '2026-09-03', refund_mode: 'Stripe', reference_number: `Stripe refund ${REFUND_20717}`, amount: 76.7, from_account_id: A1019 }])
  assert.deepEqual(w.state.refundComponents.map((c) => [c.refundId, c.component, c.status, c.creditNoteId, c.invoiceId, c.zohoCustomerId, c.payoutId]), [[REFUND_20717, 'REFUND_CREDIT_NOTE_REFUND', 'VERIFIED', 'CN-20717', invoiceId('INV-020717'), WEB, RPO]])
  const mid = await w.preview()
  assert.equal(mid.normalRefunds[0].status, NR.VERIFIED)
  assert.equal(mid.status, PAYOUT_STATUS.PARTIALLY_CLEARED, 'refund verified, sales not yet posted')

  const done = await clearEverything(w)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(w.ledger(A1019), done.payout.amount * 100, '1019 moved by exactly the payout amount')
  assert.equal(w.ledger(A1013), 0, '1013 is fully cleared to Stripe Fees')
  assert.equal(w.posts('CN_REFUND').length, 1, 'never posted twice')
})

test('full refund of a sale from an earlier payout: FULL_REFUND against the whole invoice', async () => {
  const w = refundWorld({ sales: [CARRIER(), S20717({ refunds: [refundOf('re_3U6IwD20717a', 38259)], creditNotes: [creditNote('20717', 382.59, { lines: [cnLine('20717', 2), { itemId: 'ITEM-COURIER', invoiceItemId: '', name: 'Courier Charges', quantity: 1, rate: 30, itemTotal: 28.57 }] })], orderStatus: 'returned', paymentStatus: 'refunded' })] })
  const r = await w.refund(REFUND_20717)
  assert.equal(r.status, NR.READY)
  assert.equal(r.kind, REFUND_KIND.FULL_REFUND)
  assert.deepEqual([r.cumulativeRefunded, r.remainingRefundable], [382.59, 0])
  assert.deepEqual(r.returnedItems.map((i) => [i.name, i.quantity, i.linkedBy]), [['Aligner', 2, 'INVOICE_LINE'], ['Courier Charges', 1, 'INVOICE_ITEM']])
  assert.equal((await w.postRefund(REFUND_20717)).outcome, NR.VERIFIED)
  const done = await clearEverything(w)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(w.ledger(A1019), done.payout.amount * 100)
})

test('multiple partial refunds in one payout: one credit note each, sequence and cumulative tracked', async () => {
  const w = refundWorld({ sales: [CARRIER(), S20717({
    refunds: [refundOf('re_first20717', 10000, { createdAt: '2026-09-01T09:00:00Z' }), refundOf('re_second20717', 5000, { createdAt: '2026-09-01T11:00:00Z' })],
    creditNotes: [creditNote('20717', 100), creditNote('20717-2', 50)],
  })] })
  const p = await w.preview()
  const [a, b] = ['re_first20717', 're_second20717'].map((id) => p.normalRefunds.find((x) => x.refundId === id))
  assert.deepEqual([a.status, a.kind, a.sequence, a.cumulativeRefunded, a.creditNote.creditNoteNumber], [NR.READY, REFUND_KIND.PARTIAL_REFUND, 1, 100, '20717'])
  assert.deepEqual([b.status, b.kind, b.sequence, b.cumulativeRefunded, b.creditNote.creditNoteNumber], [NR.READY, REFUND_KIND.PARTIAL_REFUND, 2, 150, '20717-2'])
  await w.postRefund('re_first20717')
  await w.postRefund('re_second20717')
  assert.deepEqual(w.posts('CN_REFUND').map((x) => [x.payload.creditNoteId, x.payload.amount, x.payload.reference_number]), [['CN-20717', 100, 'Stripe refund re_first20717'], ['CN-20717-2', 50, 'Stripe refund re_second20717']])
  const done = await clearEverything(w)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(w.ledger(A1019), done.payout.amount * 100)
})

test('cumulative full refund: the refund that completes an earlier partial one is FULL_REFUND', async () => {
  const prior = refundOf('re_prior20717', 20000, { inPayout: false, createdAt: '2026-08-20T00:00:00Z' })
  const w = refundWorld({ sales: [CARRIER(), S20717({
    refunds: [prior, refundOf('re_final20717', 18259)],
    creditNotes: [
      creditNote('20717', 200, { refunds: [{ creditNoteRefundId: 'ZCR-OLD', date: '2026-08-21', referenceNumber: 'Stripe refund re_prior20717', amount: 200, fromAccountId: A1019 }] }),
      creditNote('20717-2', 182.59),
    ],
  })] })
  const r = await w.refund('re_final20717')
  assert.deepEqual([r.status, r.kind, r.sequence, r.priorRefunded, r.cumulativeRefunded, r.remainingRefundable], [NR.READY, REFUND_KIND.FULL_REFUND, 2, 200, 382.59, 0])
  assert.deepEqual(r.priorRefunds.map((x) => x.refundId), ['re_prior20717'])
  assert.equal(r.creditNote.creditNoteNumber, '20717-2')
  assert.equal((await w.postRefund('re_final20717')).outcome, NR.VERIFIED)
})

test('refund exceeding the invoice is NEEDS_REVIEW and blocks FULLY_CLEARED, not the sales', async () => {
  // Stripe shows more refunded on the charge than its invoice (inconsistent data): never allocated away.
  const w = refundWorld({ sales: [CARRIER(), S20717({
    refunds: [refundOf('re_big20717xx', 30000, { inPayout: false, createdAt: '2026-08-01T00:00:00Z' }), refundOf('re_over20717x', 10000)],
    creditNotes: [creditNote('20717', 100)],
  })] })
  const p = await w.preview()
  const r = p.normalRefunds[0]
  assert.deepEqual([r.status, r.reasonCode, r.postable], [NR.NEEDS_REVIEW, 'REFUND_EXCEEDS_INVOICE', false])
  assert.match(r.reason, /400\.00, more than the invoice total 382\.59/)
  assert.equal(p.status, PAYOUT_STATUS.NEEDS_REVIEW)
  assert.equal(p.refundBlockers.length, 1)
  assert.equal(p.groups[0].postable, true, 'the unrelated sale still posts')
  await assert.rejects(w.postRefund('re_over20717x'), code('REFUND_NOT_POSTABLE'))
  const after = await clearEverything(w)
  assert.equal(after.status, PAYOUT_STATUS.NEEDS_REVIEW)
  assert.equal(w.posts('CN_REFUND').length, 0)
})

test('zero Stripe fee on the refund: no fee journal; the payout fee journal is the charge fees only', async () => {
  const w = refundWorld()
  const r = await w.refund(REFUND_20717)
  assert.equal(r.components.some((c) => c.component === 'REFUND_FEE_ADJUSTMENT'), false)
  const done = await clearEverything(w)
  assert.equal(done.feeJournal.amount, 15)
  assert.deepEqual(done.feeJournal.refundFeeAdjustments, [])
  assert.equal(w.posts('REFUND_FEE').length, 0)
})

test('fee returned on the refund: Dr 1019 / Cr 1013 journal; fee journal counts it once; 1019 and 1013 reconcile', async () => {
  const w = refundWorld({ sales: [CARRIER(), S20717({ refunds: [refundOf(REFUND_20717, 7670, { fee: -230 })] })] })
  const p = await w.preview()
  const r = p.normalRefunds[0]
  assert.deepEqual([r.gross, r.stripeFee, r.feeAdjustment, r.net], [76.7, -2.3, 2.3, -74.4])
  assert.deepEqual(r.clearingImpact, { stripeUndepositedFunds: -74.4, processingChargesUncleared: -2.3 })
  const adj = r.components.find((c) => c.component === 'REFUND_FEE_ADJUSTMENT')
  assert.deepEqual([adj.amount, adj.debitAccountId, adj.creditAccountId, adj.reference, adj.direction], [2.3, A1019, A1013, `Stripe refund fee ${REFUND_20717}`, 'FEE_RETURNED'])
  assert.deepEqual(adj.payload.line_items.map((l) => [l.account_id, l.debit_or_credit, l.amount, l.customer_id]), [[A1019, 'debit', 2.3, undefined], [A1013, 'credit', 2.3, undefined]])
  assert.equal(p.reconciliation.payoutMatches, true)
  assert.equal(p.feeJournal.amount, 12.7, 'Stripe fees 15.00 − 2.30 returned')

  await w.postGroup('website')
  const waiting = await w.preview()
  assert.equal(waiting.feeJournal.status, FJ.WAITING)
  assert.match(waiting.feeJournal.reasons.join(' '), /Refund fee adjustment\(s\) not verified yet/)
  await assert.rejects(w.postFee(), code('FEE_JOURNAL_NOT_POSTABLE'))

  const out = await w.postRefund(REFUND_20717)
  assert.equal(out.outcome, NR.VERIFIED)
  assert.deepEqual(out.components.map((c) => [c.component, c.status]), [['REFUND_CREDIT_NOTE_REFUND', 'VERIFIED'], ['REFUND_FEE_ADJUSTMENT', 'VERIFIED']])
  const ready = await w.preview()
  assert.deepEqual([ready.feeJournal.status, ready.feeJournal.amount, ready.feeJournal.verifiedFeeTotal], [FJ.READY, 12.7, 12.7])
  await w.postFee()
  const done = await w.preview()
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(w.ledger(A1019), done.payout.amount * 100)
  assert.equal(w.ledger(A1013), 0)
  assert.deepEqual(w.posts('FEE_JOURNAL')[0].payload.line_items.map((l) => [l.account_id, l.amount]), [[A2270_ID, 12.7], [A1013, 12.7]])
})

test('extra fee charged on the refund: Dr 1013 / Cr 1019 journal and the payout still reconciles', async () => {
  const w = refundWorld({ sales: [CARRIER(), S20717({ refunds: [refundOf(REFUND_20717, 7670, { fee: 50 })] })] })
  const r = await w.refund(REFUND_20717)
  const adj = r.components.find((c) => c.component === 'REFUND_FEE_ADJUSTMENT')
  assert.deepEqual([r.net, adj.amount, adj.debitAccountId, adj.creditAccountId, adj.direction], [-77.2, 0.5, A1013, A1019, 'FEE_CHARGED'])
  const done = await clearEverything(w)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(done.feeJournal.amount, 15.5)
  assert.equal(w.ledger(A1019), done.payout.amount * 100)
  assert.equal(w.ledger(A1013), 0)
})

test('Website and Burjman refunds stay with their own invoice customer', async () => {
  const shop = sale('SALE21200xx', { order: '21200', gross: 16000, customer: SHOP, refunds: [refundOf('re_shop21200x', 16000)], creditNotes: [creditNote('21200', 160, { lines: [cnLine('21200', 2)] })] })
  const w = refundWorld({ sales: [CARRIER(), S20717(), shop] })
  const p = await w.preview()
  const web = p.normalRefunds.find((x) => x.refundId === REFUND_20717)
  const bur = p.normalRefunds.find((x) => x.refundId === 're_shop21200x')
  assert.deepEqual([web.customerId, web.creditNote.customerId, web.invoice.customerId], [WEB, WEB, WEB])
  assert.deepEqual([bur.customerId, bur.customerName, bur.creditNote.customerId, bur.invoice.customerId, bur.status], [SHOP, 'Burjman Shop - Web & App', SHOP, SHOP, NR.READY])
  await w.postRefund('re_shop21200x')
  assert.deepEqual(w.state.refundComponents.map((c) => [c.refundId, c.zohoCustomerId]), [['re_shop21200x', SHOP]])
  assert.equal(w.posts('CN_REFUND')[0].payload.creditNoteId, 'CN-21200')
})

test('customer mismatch: an invoice or credit note under the other customer is never used', async () => {
  const invoiceWrong = refundWorld({ sales: [CARRIER(), S20717({ customer: SHOP, invoiceCustomer: WEB })] })
  const a = await invoiceWrong.refund(REFUND_20717)
  assert.deepEqual([a.status, a.reasonCode], [NR.NEEDS_REVIEW, 'CUSTOMER_MISMATCH'])
  // The credit note sits under Website but the order is a Burjman order: the Burjman search finds none.
  const cnWrong = refundWorld({ sales: [CARRIER(), S20717({ customer: SHOP, creditNotes: [creditNote('20717', 76.7, { customer: WEB })] })] })
  assert.equal((await cnWrong.refund(REFUND_20717)).reasonCode, 'CREDIT_NOTE_MISSING')
  await assert.rejects(cnWrong.postRefund(REFUND_20717), code('REFUND_NOT_POSTABLE'))
  assert.equal(cnWrong.posts('CN_REFUND').length, 0)
})

test('invoice missing (cancelled order never invoiced) and order missing stop at NEEDS_REVIEW', async () => {
  // po_1U49Q0: orders 20566/20567 were refunded but never invoiced in Zoho.
  const noInvoice = refundWorld({ sales: [CARRIER(), S20717({ noInvoice: true, creditNotes: [] })] })
  assert.deepEqual([(await noInvoice.refund(REFUND_20717)).reasonCode], ['INVOICE_MISSING'])
  const noOrder = refundWorld({ sales: [CARRIER(), S20717({ noOrder: true })] })
  const r = await noOrder.refund(REFUND_20717)
  assert.deepEqual([r.status, r.reasonCode], [NR.NEEDS_REVIEW, 'ORDER_MISSING'])
  assert.equal((await noOrder.preview()).status, PAYOUT_STATUS.NEEDS_REVIEW)
})

test('item-level partial return is proven through invoice lines; over-returned quantities are not', async () => {
  const w = refundWorld()
  const r = await w.refund(REFUND_20717)
  assert.equal(r.itemsProven, true)
  assert.deepEqual(r.returnedItems.map((i) => [i.name, i.quantity, i.invoiceLineItemId, i.linkedBy]), [['Aligner', 1, 'IL-20717-1', 'INVOICE_LINE']])
  const over = refundWorld({ sales: [CARRIER(), S20717({ creditNotes: [creditNote('20717', 76.7, { lines: [cnLine('20717', 3)] })] })] })
  const bad = await over.refund(REFUND_20717)
  assert.deepEqual([bad.status, bad.reasonCode, bad.itemsProven], [NR.NEEDS_REVIEW, 'ITEMS_NOT_PROVEN', false])
})

test('monetary-only credit note (no invoice-line link) is NEEDS_REVIEW; items are never guessed', async () => {
  const lump = { itemId: '', invoiceItemId: '', name: 'Refund', quantity: 1, rate: 76.7, itemTotal: 76.7 }
  const w = refundWorld({ sales: [CARRIER(), S20717({ creditNotes: [creditNote('20717', 76.7, { lines: [lump] })] })] })
  const r = await w.refund(REFUND_20717)
  assert.deepEqual([r.status, r.reasonCode], [NR.NEEDS_REVIEW, 'ITEMS_NOT_PROVEN'])
  assert.match(r.reason, /items are never guessed/)
})

test('no Stripe refund ever creates a credit note: missing, draft, other-invoice and short credit notes stop', async () => {
  const missing = refundWorld({ sales: [CARRIER(), S20717({ creditNotes: [] })] })
  assert.equal((await missing.refund(REFUND_20717)).reasonCode, 'CREDIT_NOTE_MISSING')
  const draft = refundWorld({ sales: [CARRIER(), S20717({ creditNotes: [creditNote('20717', 76.7, { status: 'draft' })] })] })
  assert.equal((await draft.refund(REFUND_20717)).reasonCode, 'CREDIT_NOTE_DRAFT')
  const other = refundWorld({ sales: [CARRIER(), S20717({ creditNotes: [creditNote('20717', 76.7, { invoiceId: 'ZID-OTHER', invoiceNumber: 'INV-099999' })] })] })
  assert.equal((await other.refund(REFUND_20717)).reasonCode, 'CREDIT_NOTE_INVOICE_MISMATCH')
  const short = refundWorld({ sales: [CARRIER(), S20717({ creditNotes: [creditNote('20717', 50)] })] })
  const s = await short.refund(REFUND_20717)
  assert.deepEqual([s.status, s.reasonCode], [NR.MISMATCH, 'CREDIT_NOTE_AMOUNT_MISMATCH'])
  const exceeds = refundWorld({ sales: [CARRIER(), S20717({ creditNotes: [creditNote('20717', 76.7), creditNote('20717-2', 320)] })] })
  assert.equal((await exceeds.refund(REFUND_20717)).reasonCode, 'CREDIT_NOTES_EXCEED_INVOICE')
  for (const w of [missing, draft, other, short, exceeds]) assert.equal(w.posts('CN_REFUND').length, 0)
})

test('duplicate existing credit notes: two equal candidates are never chosen between', async () => {
  const w = refundWorld({ sales: [CARRIER(), S20717({ creditNotes: [creditNote('20717', 76.7), creditNote('20717-2', 76.7)] })] })
  const r = await w.refund(REFUND_20717)
  assert.deepEqual([r.status, r.reasonCode], [NR.NEEDS_REVIEW, 'CREDIT_NOTE_AMBIGUOUS'])
  assert.equal(r.creditNoteCandidates.length, 2)
})

test('duplicate existing refund: our reference already in Zoho is recorded, not re-sent; two copies need review', async () => {
  const existing = { creditNoteRefundId: 'ZCR-MANUAL', date: '2026-09-03', referenceNumber: `Stripe refund ${REFUND_20717}`, amount: 76.7, fromAccountId: A1019 }
  const w = refundWorld({ sales: [CARRIER(), S20717({ creditNotes: [creditNote('20717', 76.7, { refunds: [existing] })] })] })
  const r = await w.refund(REFUND_20717)
  assert.deepEqual([r.status, r.reasonCode, r.tracked, r.postable], [NR.VERIFIED, 'ALREADY_IN_ZOHO', false, true])
  const out = await w.postRefund(REFUND_20717)
  assert.deepEqual([out.outcome, out.zohoRequests], [NR.VERIFIED, 0])
  assert.equal(w.posts('CN_REFUND').length, 0)
  assert.deepEqual(w.state.refundComponents.map((c) => [c.status, c.zohoRecordId]), [['VERIFIED', 'ZCR-MANUAL']])
  const again = await w.postRefund(REFUND_20717)
  assert.deepEqual([again.alreadyPosted, again.zohoRequests], [true, 0])

  const two = refundWorld({ sales: [CARRIER(), S20717({ creditNotes: [creditNote('20717', 153.4, { refunds: [existing, { ...existing, creditNoteRefundId: 'ZCR-2' }] })] })] })
  assert.equal((await two.refund(REFUND_20717)).reasonCode, 'ZOHO_DUPLICATE_REFUND')
})

test('uncertain Zoho response: search, never resend (FOUND → VERIFIED, MISSING → POSTING_UNCERTAIN)', async () => {
  const created = refundWorld({ script: { CN_REFUND: ['timeout-created'] } })
  const a = await created.postRefund(REFUND_20717)
  assert.equal(a.outcome, NR.VERIFIED)
  assert.equal(created.posts('CN_REFUND').length, 1)
  assert.match(a.components[0].reason, /exactly one matching credit note refund/)

  const lost = refundWorld({ script: { CN_REFUND: ['timeout'] } })
  const b = await lost.postRefund(REFUND_20717)
  assert.equal(b.outcome, NR.POSTING_UNCERTAIN)
  assert.equal(lost.posts('CN_REFUND').length, 1)
  const retry = await lost.refund(REFUND_20717)
  assert.deepEqual([retry.status, retry.postable], [NR.POSTING_UNCERTAIN, false])
  await assert.rejects(lost.postRefund(REFUND_20717), code('REFUND_NOT_POSTABLE'))
  assert.equal(lost.posts('CN_REFUND').length, 1)

  const noId = refundWorld({ script: { CN_REFUND: ['no-id'] } })
  assert.equal((await noId.postRefund(REFUND_20717)).outcome, NR.VERIFIED)
  assert.equal(noId.state.creditNotes[0].refunds.length, 1)

  const rejected = refundWorld({ script: { CN_REFUND: ['reject'] } })
  assert.equal((await rejected.postRefund(REFUND_20717)).outcome, NR.FAILED)
})

test('ambiguous Zoho documents after posting are NEEDS_REVIEW, never re-posted', async () => {
  const wrong = refundWorld({ script: { CN_REFUND: ['created-wrong'] } })
  await wrong.preview()
  const out = await wrong.postRefund(REFUND_20717, undefined)
  assert.equal(out.outcome, NR.NEEDS_REVIEW)
  const r = await wrong.refund(REFUND_20717)
  assert.equal(r.status, NR.NEEDS_REVIEW)
  await assert.rejects(wrong.postRefund(REFUND_20717), code('REFUND_NOT_POSTABLE'))
  assert.equal(wrong.posts('CN_REFUND').length, 1)

  // Our reference on a second credit note of the same order is a conflict, not a second record.
  const w = refundWorld({ sales: [CARRIER(), S20717({ creditNotes: [creditNote('20717', 76.7), creditNote('20717-2', 20, { refunds: [{ creditNoteRefundId: 'ZCR-X', date: '2026-09-03', referenceNumber: `Stripe refund ${REFUND_20717}`, amount: 20, fromAccountId: A1019 }] })] })] })
  const x = await w.refund(REFUND_20717)
  assert.equal(x.status, NR.NEEDS_REVIEW)
})

test('two refunds against the same invoice share one credit note; each posts once with its own reference', async () => {
  const w = refundWorld({ sales: [CARRIER(), S20717({
    refunds: [refundOf('re_one20717xx', 10000, { createdAt: '2026-09-01T09:00:00Z' }), refundOf('re_two20717xx', 5000, { createdAt: '2026-09-01T10:00:00Z' })],
    creditNotes: [creditNote('20717', 150, { lines: [cnLine('20717', 2)] })],
  })] })
  const p = await w.preview()
  assert.deepEqual(p.normalRefunds.map((r) => [r.refundId, r.status, r.creditNote.matchedBy]), [['re_one20717xx', NR.READY, 'SHARED_CREDIT_NOTE'], ['re_two20717xx', NR.READY, 'SHARED_CREDIT_NOTE']])
  await w.postRefund('re_one20717xx')
  const mid = await w.preview()
  assert.deepEqual(mid.normalRefunds.map((r) => r.status), [NR.VERIFIED, NR.READY])
  await w.postRefund('re_two20717xx')
  const n = w.state.creditNotes[0]
  assert.deepEqual(n.refunds.map((r) => [r.referenceNumber, r.amount]), [['Stripe refund re_one20717xx', 100], ['Stripe refund re_two20717xx', 50]])
  const done = await clearEverything(w)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(w.ledger(A1019), done.payout.amount * 100)
})

test('customer advance refund stays separate from normal invoice refunds', async () => {
  const EARLIER = 'po_1UJNObEarlierAdv01'
  const adv = sale('ADV21111xxx', { order: '21111', gross: 110100, fee: 3293, orderTotal: 1066, refunds: [refundOf('re_adv21111xx', 3500)], creditNotes: [] })
  const w = refundWorld({
    sales: [CARRIER(), S20717(), adv],
    cases: [{ ...confirmedCase(), id: '7', payoutId: EARLIER, chargeId: adv.chargeId, paymentIntentId: adv.pi, status: 'ADVANCE_POSTED', refundId: 're_adv21111xx', refundBalanceTransactionId: 'txn_adv21111xx' }],
    journals: [{ journalId: 'ZJ-ADV', referenceNumber: `Stripe customer advance ${EARLIER}`, journalDate: '2026-09-28', lineItems: [
      { accountId: A1019, debitOrCredit: 'debit', amount: 35, customerId: '' },
      { accountId: A1123, debitOrCredit: 'credit', amount: 35, customerId: WEB },
    ] }],
  })
  const p = await w.preview()
  assert.deepEqual(p.advanceRefunds.map((r) => [r.refundId, r.status, r.matched]), [['re_adv21111xx', 'REFUND_MATCHED', true]])
  assert.deepEqual(p.advanceRefunds[0].proposedJournal.payload.line_items.map((l) => [l.account_id, l.debit_or_credit]), [[A1123, 'debit'], [A1019, 'credit']])
  assert.deepEqual(p.normalRefunds.map((r) => r.refundId), [REFUND_20717])
  assert.equal(p.reconciliation.payoutMatches, true)
  await assert.rejects(w.postRefund('re_adv21111xx', 'x'), code('REFUND_IS_CUSTOMER_ADVANCE'))
  const done = await clearEverything(w)
  // The advance refund journal (Dr 1123 / Cr 1019) is not posted by this workflow yet: not fully cleared.
  assert.equal(done.status, PAYOUT_STATUS.PARTIALLY_CLEARED)
  assert.equal(done.advanceRefunds[0].refundJournal.state, 'MISSING')
  assert.ok(!w.state.posts.some((x) => (x.payload.line_items || []).some((l) => l.account_id === A1123)))
})

test('charges + partial refund of one of them in the same payout: the sale clears in full, then its refund', async () => {
  const same = sale('SALE21300xx', { order: '21300', gross: 20000, fee: 600, chargeInPayout: true, refunds: [refundOf('re_same21300x', 5000)], creditNotes: [creditNote('21300', 50)] })
  const w = refundWorld({ sales: [CARRIER(), same] })
  const p = await w.preview()
  const line = p.groups[0].lines.find((l) => l.chargeId === same.chargeId)
  assert.equal(line.state, 'OPEN')
  assert.equal(line.invoiceTotal, 200, 'the sale clears at its full invoice value')
  assert.deepEqual(line.normalRefunds.map((r) => [r.refundId, r.inThisPayout]), [['re_same21300x', true]])
  const r = p.normalRefunds[0]
  assert.deepEqual([r.status, r.reasonCode], [NR.MATCHED, 'WAITING_FOR_SALE_CLEARING'])
  assert.equal(r.postable, false)
  await assert.rejects(w.postRefund('re_same21300x'), code('REFUND_NOT_POSTABLE'))
  await w.postGroup('website')
  assert.equal((await w.refund('re_same21300x')).status, NR.READY)
  const done = await clearEverything(w)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(w.ledger(A1019), done.payout.amount * 100)
  assert.equal(w.ledger(A1013), 0)
})

test('charges + full refund (cancelled order) in the same payout: invoice paid in full, credit note refunded in full', async () => {
  const cancelled = sale('SALE21126xx', { order: '21126', gross: 16090, fee: 500, chargeInPayout: true, orderStatus: 'cancelled', paymentStatus: 'refunded', refunds: [refundOf('re_3UIuCq21126', 16090)], creditNotes: [creditNote('21126', 160.9)] })
  const w = refundWorld({ sales: [CARRIER(), cancelled] })
  const p = await w.preview()
  assert.equal(p.groups[0].lines.find((l) => l.chargeId === cancelled.chargeId).state, 'OPEN')
  assert.equal(p.normalRefunds[0].kind, REFUND_KIND.FULL_REFUND)
  const done = await clearEverything(w)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(done.normalRefunds[0].status, NR.VERIFIED)
  assert.equal(w.state.creditNotes[0].refunds[0].amount, 160.9)
  assert.equal(w.ledger(A1019), done.payout.amount * 100)
  // A cancelled order that Stripe did not fully refund still needs review.
  const partly = refundWorld({ sales: [CARRIER(), sale('SALE21127xx', { order: '21127', gross: 16090, chargeInPayout: true, orderStatus: 'cancelled', refunds: [refundOf('re_part21127x', 1000)], creditNotes: [creditNote('21127', 10)] })] })
  assert.equal((await partly.preview()).groups[0].lines.find((l) => l.chargeId === 'ch_SALE21127xx').state, 'NEEDS_REVIEW')
})

test('refund-only payout reconciles and clears when every refund is verified', async () => {
  const w = refundWorld({ sales: [S20717()] })
  const p = await w.preview()
  assert.deepEqual([p.groups.length, p.payout.amount, p.reconciliation.payoutMatches, p.blockers.length], [0, -76.7, true, 0])
  assert.deepEqual([p.status, p.feeJournal.status], [PAYOUT_STATUS.READY, FJ.NOT_REQUIRED])
  await w.postRefund(REFUND_20717)
  const done = await w.preview()
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(w.ledger(A1019), -7670)
})

test('payout is never FULLY_CLEARED early: sales and fee journal done, refund pending or under review', async () => {
  const w = refundWorld()
  await w.postGroup('website')
  await w.postFee()
  const p = await w.preview()
  assert.equal(p.feeJournal.status, FJ.VERIFIED)
  assert.equal(p.status, PAYOUT_STATUS.PARTIALLY_CLEARED)
  const review = refundWorld({ sales: [CARRIER(), S20717({ creditNotes: [] })] })
  await clearEverything(review)
  assert.equal((await review.preview()).status, PAYOUT_STATUS.NEEDS_REVIEW)
  // Unexplained money in the payout blocks every posting, refunds included.
  const extra = refundWorld({ extraTxns: [{ balanceTransactionId: 'txn_ADJ', type: 'adjustment', reportingCategory: 'other_adjustment', currency: 'AED', amountMinor: -500, feeMinor: 0, netMinor: -500 }] })
  const x = await extra.preview()
  assert.equal(x.reconciliation.payoutMatches, false)
  assert.equal(x.normalRefunds[0].postable, false)
  await assert.rejects(extra.postRefund(REFUND_20717), code('PAYOUT_NEEDS_REVIEW'))
})

test('refund posting disabled, test mode, bad IDs, stale fingerprint and a held lock send nothing', async () => {
  const w = refundWorld()
  const fp = (await w.refund(REFUND_20717)).postingFingerprint
  await assert.rejects(w.postRefund(REFUND_20717, fp, { config: { ...CFG, postingEnabled: false } }), code('STRIPE_CLEARING_POSTING_DISABLED'))
  await assert.rejects(w.postRefund(REFUND_20717, fp, { stripeConfig: TEST_MODE }), code('STRIPE_NOT_LIVE'))
  await assert.rejects(w.postRefund('ch_notarefund1', fp), code('INVALID_REFUND_ID'))
  await assert.rejects(w.postRefund(REFUND_20717, 'stale'), code('PREVIEW_CHANGED'))
  await assert.rejects(w.postRefund('re_unknown00000', fp), code('REFUND_NOT_IN_PAYOUT'))
  await assert.rejects(postPayoutRefund(RPO, REFUND_20717, { fingerprint: fp }, { config: CFG, stripeConfig: LIVE }), code('ACTOR_REQUIRED'))
  w.state.locked = true
  await assert.rejects(w.postRefund(REFUND_20717, fp), code('PAYOUT_POSTING_IN_PROGRESS'))
  assert.deepEqual(w.state.posts, [])
  assert.deepEqual(w.state.refundComponents, [])
  assert.equal(BASE.postingEnabled, process.env.STRIPE_CLEARING_POSTING_ENABLED === 'true')
})

test('historical refunds are not duplicated: a manual credit note refund from 1019 is LEGACY_VERIFIED', async () => {
  // po_1U9Dr2 / order 20723: CN 20723 (167.45) refunded 137.45 by hand from 1019, rest applied elsewhere.
  const s = sale('SALE20723xx', {
    order: '20723', gross: 36210, refunds: [refundOf('re_3U6nlO20723', 13745)],
    creditNotes: [creditNote('20723', 167.45, { status: 'closed', refunds: [{ creditNoteRefundId: 'ZCR-LEGACY', date: '2026-09-03', referenceNumber: 'Stripe refund 043117 pi_3U6nlODJogiiRoKP2bfCeiMY', amount: 137.45, fromAccountId: A1019 }] })],
  })
  const w = refundWorld({ sales: [CARRIER(), s] })
  const r = await w.refund('re_3U6nlO20723')
  assert.deepEqual([r.status, r.reasonCode, r.postable, r.legacyRefund.creditNoteRefundId], [NR.LEGACY_VERIFIED, 'LEGACY_MANUAL_REFUND', false, 'ZCR-LEGACY'])
  await assert.rejects(w.postRefund('re_3U6nlO20723'), code('REFUND_NOT_POSTABLE'))
  const done = await clearEverything(w)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(w.posts('CN_REFUND').length, 0)
  // A manual Stripe refund of a different amount is never assumed to be this one.
  const odd = refundWorld({ sales: [CARRIER(), S20717({ creditNotes: [creditNote('20717', 150, { refunds: [{ creditNoteRefundId: 'ZCR-M', date: '2026-09-01', referenceNumber: 'manual', amount: 73.3, fromAccountId: A1019 }] })] })] })
  assert.equal((await odd.refund(REFUND_20717)).reasonCode, 'MANUAL_STRIPE_REFUND_UNEXPLAINED')
})

test('overpaid charge without an advance case is not treated as an invoice refund', async () => {
  const over = sale('SALE21400xx', { order: '21400', gross: 11000, orderTotal: 100, refunds: [refundOf('re_over21400x', 1000)], creditNotes: [creditNote('21400', 10)] })
  const w = refundWorld({ sales: [CARRIER(), over] })
  const r = await w.refund('re_over21400x')
  assert.deepEqual([r.status, r.reasonCode], [NR.NEEDS_REVIEW, 'POSSIBLE_CUSTOMER_ADVANCE'])
})

test('refund payloads carry no app branding, notes or description', async () => {
  const w = refundWorld({ sales: [CARRIER(), S20717({ refunds: [refundOf(REFUND_20717, 7670, { fee: -230 })] })] })
  await clearEverything(w)
  const text = JSON.stringify(w.state.posts)
  for (const banned of ['HR & BI', 'HR&BI', 'hr-attendance', 'Purchase Planning', 'Generated from']) assert.ok(!text.includes(banned), banned)
  for (const p of w.state.posts) {
    assert.equal(p.payload.notes, undefined)
    assert.equal(p.payload.description, undefined)
  }
})

test('credit note lookup is exact per order and customer; the writer posts one credit note refund without transport retry', async () => {
  const apiPath = require.resolve('../src/services/zohoApiClient')
  const sourcesPath = require.resolve('../src/services/stripeClearing/stripeClearingSources')
  const writerPath = require.resolve('../src/services/stripeClearing/stripePayoutZohoWriter')
  const api = require(apiPath)
  const original = api.zohoBooksJsonRequest
  const calls = []
  let rows = []
  api.zohoBooksJsonRequest = async (path, params, method, body, opts) => {
    calls.push({ path, params: Object.fromEntries(params), method, body, opts })
    if (method === 'POST') return { creditnote_refund: { creditnote_refund_id: 'ZCR-NEW' } }
    return { creditnotes: rows }
  }
  delete require.cache[sourcesPath]
  delete require.cache[writerPath]
  try {
    const sources = require(sourcesPath)
    const writer = require(writerPath)
    const row = (n, customer = WEB) => ({ creditnote_id: `CN-${n}`, creditnote_number: n, customer_id: customer, status: 'open', total: 10, balance: 10 })
    rows = [row('20717'), row('20717-2'), row('207171')]
    const found = await sources.findZohoCreditNotesForOrder('20717', WEB)
    assert.deepEqual(found.map((n) => n.creditNoteNumber), ['20717', '20717-2'])
    assert.deepEqual(calls[0].params, { creditnote_number_startswith: '20717', customer_id: WEB, per_page: '200', page: '1' })
    rows = [row('20717'), row('30001')]
    await assert.rejects(sources.findZohoCreditNotesForOrder('20717', WEB), code('ZOHO_REFERENCE_FILTER_IGNORED'))
    rows = [row('20717', SHOP)]
    await assert.rejects(sources.findZohoCreditNotesForOrder('20717', WEB), code('ZOHO_REFERENCE_FILTER_IGNORED'))

    const payload = { date: '2026-09-03', refund_mode: 'Stripe', reference_number: 'Stripe refund re_1', amount: 76.7, from_account_id: A1019 }
    assert.deepEqual(await writer.createCreditNoteRefund('CN-20717', payload), { recordId: 'ZCR-NEW' })
    const post = calls[calls.length - 1]
    assert.equal(post.path, '/books/v3/creditnotes/CN-20717/refunds')
    assert.equal(post.opts.retryTransport, false)
    assert.deepEqual(JSON.parse(new URLSearchParams(post.body).get('JSONString')), payload)
  } finally {
    api.zohoBooksJsonRequest = original
    delete require.cache[sourcesPath]
    delete require.cache[writerPath]
  }
})

/** Sources module against a fake paged Zoho: `pages[path]` is a list of page bodies. */
async function withPagedZoho(pages, run) {
  const apiPath = require.resolve('../src/services/zohoApiClient')
  const sourcesPath = require.resolve('../src/services/stripeClearing/stripeClearingSources')
  const api = require(apiPath)
  const original = api.zohoBooksJsonRequest
  const calls = []
  api.zohoBooksJsonRequest = async (path, params, method) => {
    assert.equal(method, 'GET', 'lookups only read')
    const q = Object.fromEntries(params)
    calls.push({ path, ...q })
    const body = pages[path]
    if (typeof body === 'function') return body(q)
    const list = body || []
    const at = Number(q.page || 1) - 1
    if (at >= list.length) throw new Error(`unexpected page ${q.page} of ${path}`)
    return list[at]
  }
  delete require.cache[sourcesPath]
  try {
    return await run(require(sourcesPath), calls)
  } finally {
    api.zohoBooksJsonRequest = original
    delete require.cache[sourcesPath]
  }
}
const more = (page) => ({ page, per_page: 200, has_more_page: true })
const last = (page) => ({ page, per_page: 200, has_more_page: false })

test('Zoho lookups read every page and refuse partial or malformed lists: payments, journals, credit notes, credit note refunds', async () => {
  const pay = (id) => ({ payment_id: id, reference_number: 'Stripe NET po_1', customer_id: WEB, amount: 1 })
  const jr = (id) => ({ journal_id: id, reference_number: 'Stripe processing fees po_1', journal_date: '2026-09-28', total: 1 })
  const cnr = (id) => ({ creditnote_refund_id: id, reference_number: 'Stripe refund re_1', amount_bcy: 1, date: '2026-09-28' })
  await withPagedZoho({
    '/books/v3/customerpayments': [{ customerpayments: [pay('P1')], page_context: more(1) }, { customerpayments: [pay('P2')], page_context: last(2) }],
    '/books/v3/journals': [{ journals: [jr('J1')], page_context: more(1) }, { journals: [jr('J2')], page_context: last(2) }],
    '/books/v3/creditnotes/CN1/refunds': [{ creditnote_refunds: [cnr('R1')], page_context: more(1) }, { creditnote_refunds: [cnr('R2')], page_context: last(2) }],
  }, async (sources, calls) => {
    assert.deepEqual((await sources.findZohoPaymentsByReference('Stripe NET po_1')).map((p) => p.paymentId), ['P1', 'P2'], 'second page read: a duplicate there is not missed')
    assert.deepEqual((await sources.findZohoJournalsByReference('Stripe processing fees po_1')).map((j) => j.journalId), ['J1', 'J2'])
    assert.deepEqual((await sources.listZohoCreditNoteRefunds('CN1')).map((r) => r.creditNoteRefundId), ['R1', 'R2'])
    assert.ok(calls.every((c) => c.per_page === '200'))
  })
  const endless = (key, row) => (q) => ({ [key]: [row(`X${q.page}`)], page_context: more(Number(q.page)) })
  await withPagedZoho({
    '/books/v3/customerpayments': endless('customerpayments', pay),
    '/books/v3/journals': endless('journals', jr),
    '/books/v3/creditnotes/CN1/refunds': endless('creditnote_refunds', cnr),
    '/books/v3/creditnotes': endless('creditnotes', (id) => ({ creditnote_id: id, creditnote_number: '20717', customer_id: WEB })),
  }, async (sources, calls) => {
    await assert.rejects(sources.findZohoPaymentsByReference('Stripe NET po_1'), code('ZOHO_LOOKUP_INCOMPLETE'))
    await assert.rejects(sources.findZohoJournalsByReference('Stripe processing fees po_1'), code('ZOHO_LOOKUP_INCOMPLETE'))
    await assert.rejects(sources.listZohoCreditNoteRefunds('CN1'), code('ZOHO_LOOKUP_INCOMPLETE'))
    await assert.rejects(sources.findZohoCreditNotesForOrder('20717', WEB), code('ZOHO_LOOKUP_INCOMPLETE'))
    await assert.rejects(sources.listZohoJournalsInRange('2026-09-28', '2026-09-28'), code('ZOHO_JOURNAL_RANGE_TOO_LARGE'))
    assert.ok(calls.length <= 5 * 4 + 10, 'bounded by the page caps')
  })
  await withPagedZoho({
    '/books/v3/customerpayments': [{ message: 'success' }],
    '/books/v3/journals': [{ code: 0 }],
    '/books/v3/creditnotes/CN1/refunds': [{ creditnote_refunds: null }],
  }, async (sources) => {
    await assert.rejects(sources.findZohoPaymentsByReference('Stripe NET po_1'), code('ZOHO_LOOKUP_MALFORMED'), 'a malformed answer is never "no payments"')
    await assert.rejects(sources.findZohoJournalsByReference('Stripe processing fees po_1'), code('ZOHO_LOOKUP_MALFORMED'))
    await assert.rejects(sources.listZohoJournalsInRange('2026-09-28', '2026-09-28'), code('ZOHO_LOOKUP_MALFORMED'))
    await assert.rejects(sources.listZohoCreditNoteRefunds('CN1'), code('ZOHO_LOOKUP_MALFORMED'))
  })
})

test('invoice payment evidence: the whole list, or an error for a missing invoice, a malformed answer or a paged answer', async () => {
  const notFound = () => { const e = new Error('not found'); e.httpStatus = 404; throw e }
  await withPagedZoho({
    '/books/v3/invoices/INV1/payments': [{ payments: [{ payment_id: 'P1', reference_number: 'Stripe NET po_1', amount: 5, date: '2026-09-28' }] }],
    '/books/v3/invoices/GONE/payments': notFound,
    '/books/v3/invoices/BAD/payments': [{ code: 0, message: 'success' }],
    '/books/v3/invoices/PAGED/payments': [{ payments: [], page_context: more(1) }],
  }, async (sources) => {
    assert.deepEqual(await sources.listZohoInvoicePayments('INV1'), [{ paymentId: 'P1', invoiceId: 'INV1', referenceNumber: 'Stripe NET po_1', amount: 5, date: '2026-09-28' }])
    await assert.rejects(sources.listZohoInvoicePayments('GONE'), code('ZOHO_INVOICE_NOT_FOUND'))
    await assert.rejects(sources.listZohoInvoicePayments('BAD'), code('ZOHO_LOOKUP_MALFORMED'))
    await assert.rejects(sources.listZohoInvoicePayments('PAGED'), code('ZOHO_LOOKUP_INCOMPLETE'))
    await assert.rejects(sources.listZohoInvoicePayments(''), code('ZOHO_LOOKUP_INCOMPLETE'))
  })
})

test('a refund that belongs to a later payout never changes this payout: the sale clears in full here', async () => {
  const later = sale('SALE21500xx', { order: '21500', gross: 20000, fee: 600, chargeInPayout: true, refunds: [refundOf('re_later21500', 5000, { inPayout: false })], creditNotes: [creditNote('21500', 50)] })
  const w = refundWorld({ sales: [CARRIER(), later] })
  const p = await w.preview()
  const line = p.groups[0].lines.find((l) => l.chargeId === later.chargeId)
  assert.deepEqual([line.state, line.invoiceTotal, line.netAllocation], ['OPEN', 200, 194])
  assert.deepEqual(line.normalRefunds.map((r) => [r.refundId, r.inThisPayout]), [['re_later21500', false]])
  assert.deepEqual(p.normalRefunds, [], 'the refund is processed only in the payout that carries it')
  const done = await clearEverything(w)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(w.posts('CN_REFUND').length, 0)
})

// ---------------------------------------------------------------------------
// Signed payout fee journal: + Dr 2270 / Cr 1013, 0 none, − Dr 1013 / Cr 2270
// ---------------------------------------------------------------------------

const SIGNED_FEE_REF = `Stripe processing fees ${RPO}`
const chargeSale = (fee) => sale('CHARGE30001', { order: '30001', gross: 50000, fee, chargeInPayout: true })
const refundSale20717 = (fee) => S20717({ refunds: [refundOf(REFUND_20717, 7670, { fee })] })
const refundSale21400 = (fee) => sale('SALE21400xx', { order: '21400', gross: 20000, refunds: [refundOf('re_second21400', 5000, { fee })], creditNotes: [creditNote('21400', 50)] })
const feeLines = (j) => j.lineItems.map((l) => [l.debitOrCredit, l.accountId, l.amount, l.customerId])

/** Sum of FEE payments into 1013 plus signed refund fee adjustments equals Stripe's signed fee total. */
function assertFeeIdentity(p) {
  const fj = p.feeJournal
  const feePayments = p.groups.reduce((t, g) => t + g.components.filter((c) => c.component === 'FEE').reduce((a, c) => a + Math.round(c.amount * 100), 0), 0)
  const refundFees = (fj.refundFeeAdjustments || []).reduce((t, a) => t + Math.round(a.fee * 100), 0)
  assert.equal(feePayments + refundFees, Math.round(fj.stripeFeeTotal * 100), 'FEE components + signed refund fee adjustments = signed payout fee total')
  assert.equal(Math.round(fj.amount * 100), Math.abs(Math.round(fj.stripeFeeTotal * 100)), 'journal amount = |signed total|')
}

/** After everything posts, 1013 is exactly cleared, 2270 carries the net fee and 1019 equals the payout. */
function assertCleared(w, p, expectedFeeMinor) {
  assert.equal(w.ledger(A1013), 0, '1013 fully cleared')
  assert.equal(w.ledger(A2270), expectedFeeMinor, '2270 = signed net Stripe fee')
  assert.equal(w.ledger(A1019), Math.round(p.payout.amount * 100), '1019 = payout amount, untouched by the fee journal')
}

test('signed fee: positive net fee (charge fees 10.00, refund fee returned 3.00) posts Dr 2270 / Cr 1013 7.00', async () => {
  const w = refundWorld({ sales: [chargeSale(1000), refundSale20717(-300)] })
  const p = await w.preview()
  assertFeeIdentity(p)
  assert.deepEqual([p.feeJournal.stripeFeeTotal, p.feeJournal.amount, p.feeJournal.direction], [7, 7, 'FEE_EXPENSE'])
  assert.deepEqual([p.feeJournal.debitAccountId, p.feeJournal.creditAccountId], [A2270, A1013])
  const done = await clearEverything(w)
  assert.equal(done.feeJournal.status, FJ.VERIFIED)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  const [j] = w.state.journals.filter((x) => x.referenceNumber === SIGNED_FEE_REF)
  assert.deepEqual(feeLines(j), [['debit', A2270, 7, ''], ['credit', A1013, 7, '']])
  assertCleared(w, done, 700)
})

test('signed fee: zero net fee (charge fees 3.00, refund fee returned 3.00) needs no fee journal', async () => {
  const w = refundWorld({ sales: [chargeSale(300), refundSale20717(-300)] })
  const p = await w.preview()
  assertFeeIdentity(p)
  assert.deepEqual([p.feeJournal.stripeFeeTotal, p.feeJournal.direction, p.feeJournal.payload, p.feeJournal.postable], [0, null, null, false])
  assert.equal(p.feeJournal.status, FJ.WAITING, 'the charge FEE and refund fee adjustment must verify first')
  const done = await clearEverything(w)
  assert.equal(done.feeJournal.status, FJ.NOT_REQUIRED)
  assert.match(done.feeJournal.reasons[0], /net to 0\.00; 1013 is already cleared/)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(w.posts('FEE_JOURNAL').length, 0)
  await assert.rejects(w.postFee(), code('FEE_JOURNAL_NOT_POSTABLE'))
  assertCleared(w, done, 0)
})

test('signed fee: a journal under the fee reference on a zero-fee payout is a conflict, not NOT_REQUIRED', async () => {
  const w = refundWorld({
    sales: [chargeSale(300), refundSale20717(-300)],
    journals: [{ journalId: 'ZJ-STRAY', referenceNumber: SIGNED_FEE_REF, journalDate: '2026-09-03', lineItems: [{ accountId: A2270, debitOrCredit: 'debit', amount: 3, customerId: '' }, { accountId: A1013, debitOrCredit: 'credit', amount: 3, customerId: '' }] }],
  })
  const done = await clearEverything(w)
  assert.equal(done.feeJournal.status, FJ.NEEDS_REVIEW)
  assert.notEqual(done.status, PAYOUT_STATUS.FULLY_CLEARED)
})

test('signed fee: negative net fee is a reversal Dr 1013 / Cr 2270 for the absolute amount, never NEEDS_REVIEW', async () => {
  const w = refundWorld({ sales: [refundSale20717(-300)] })
  const p = await w.preview()
  assertFeeIdentity(p)
  const fj = p.feeJournal
  assert.deepEqual([fj.stripeFeeTotal, fj.signedAmount, fj.amount, fj.direction], [-3, -3, 3, 'FEE_REVERSAL'])
  assert.deepEqual([fj.debitAccountId, fj.creditAccountId, fj.debitAccount.accountId, fj.creditAccount.accountId], [A1013, A2270, A1013, A2270])
  assert.deepEqual(fj.payload, {
    journal_date: '2026-09-03',
    journal_type: 'both',
    reference_number: SIGNED_FEE_REF,
    line_items: [{ account_id: A1013, debit_or_credit: 'debit', amount: 3 }, { account_id: A2270, debit_or_credit: 'credit', amount: 3 }],
  })
  assert.equal(fj.status, FJ.WAITING)
})

test('signed fee: refund-only payout with returned Stripe fee clears 1013 through the reversal and becomes FULLY_CLEARED', async () => {
  const w = refundWorld({ sales: [refundSale20717(-300)] })
  await w.postRefund(REFUND_20717)
  const ready = await w.preview()
  assert.equal(ready.groups.length, 0)
  assert.equal(ready.feeJournal.status, FJ.READY)
  assert.match(ready.feeJournal.reasons[0], /Stripe returned 3\.00 more fees than it charged; it is ready to move from Stripe Fees back to 1013/)
  assert.equal(ready.feeJournal.postable, true)
  assert.equal(ready.status, PAYOUT_STATUS.FEE_JOURNAL_PENDING)
  const out = await w.postFee()
  assert.equal(out.outcome, FJ.VERIFIED)
  const [post] = w.posts('FEE_JOURNAL')
  assert.deepEqual(post.payload.line_items, [{ account_id: A1013, debit_or_credit: 'debit', amount: 3 }, { account_id: A2270, debit_or_credit: 'credit', amount: 3 }])
  assert.ok(!('notes' in post.payload) && !post.payload.line_items.some((l) => l.customer_id))
  const done = await w.preview()
  assert.equal(done.feeJournal.status, FJ.VERIFIED)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assertCleared(w, done, -300)
  const local = w.state.components.find((c) => c.component === 'PAYOUT_FEE_JOURNAL')
  assert.deepEqual([local.status, local.debitAccountId, local.creditAccountId, local.amount], ['VERIFIED', A1013, A2270, 3])
})

test('signed fee: mixed payout where refund fee reversals reduce but do not exceed charge fees stays Dr 2270 / Cr 1013', async () => {
  const w = refundWorld({ sales: [chargeSale(1500), refundSale20717(-300), refundSale21400(-230)] })
  const p = await w.preview()
  assertFeeIdentity(p)
  assert.deepEqual([p.feeJournal.stripeFeeTotal, p.feeJournal.amount, p.feeJournal.direction], [9.7, 9.7, 'FEE_EXPENSE'])
  assert.deepEqual(p.feeJournal.refundFeeAdjustments.map((a) => [a.refundId, a.fee]), [[REFUND_20717, -3], ['re_second21400', -2.3]])
  const done = await clearEverything(w)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(w.posts('REFUND_FEE').length, 2)
  assertCleared(w, done, 970)
})

test('signed fee: mixed payout where refund fee reversals exceed the charge fees reverses the difference', async () => {
  const w = refundWorld({ sales: [chargeSale(200), refundSale20717(-300), refundSale21400(-200)] })
  const p = await w.preview()
  assertFeeIdentity(p)
  assert.deepEqual([p.feeJournal.stripeFeeTotal, p.feeJournal.amount, p.feeJournal.direction], [-3, 3, 'FEE_REVERSAL'])
  assert.equal(p.reconciliation.payoutMatches, true)
  const done = await clearEverything(w)
  assert.equal(done.feeJournal.status, FJ.VERIFIED)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  const [j] = w.state.journals.filter((x) => x.referenceNumber === SIGNED_FEE_REF)
  assert.deepEqual(feeLines(j), [['debit', A1013, 3, ''], ['credit', A2270, 3, '']])
  assertCleared(w, done, -300)
})

test('signed fee: reverse-direction duplicates are detected; a posted reversal is never re-sent', async () => {
  const w = refundWorld({ sales: [refundSale20717(-300)] })
  await w.postRefund(REFUND_20717)
  await w.postFee()
  const again = await w.postFee()
  assert.deepEqual([again.outcome, again.alreadyPosted, again.zohoRequests], [FJ.VERIFIED, true, 0])
  assert.equal(w.posts('FEE_JOURNAL').length, 1)

  // A journal under our reference in the other direction is a conflict, not a match.
  const wrongWay = refundWorld({
    sales: [refundSale20717(-300)],
    journals: [{ journalId: 'ZJ-FWD', referenceNumber: SIGNED_FEE_REF, journalDate: '2026-09-03', lineItems: [{ accountId: A2270, debitOrCredit: 'debit', amount: 3, customerId: '' }, { accountId: A1013, debitOrCredit: 'credit', amount: 3, customerId: '' }] }],
  })
  await wrongWay.postRefund(REFUND_20717)
  const p = await wrongWay.preview()
  assert.equal(p.feeJournal.status, FJ.NEEDS_REVIEW)
  assert.match(p.feeJournal.reasons.join(' '), /Debit account is .*not Stripe Processing Chg Un-Cleared/)
  assert.equal(p.feeJournal.postable, false)
  await assert.rejects(wrongWay.postFee(), code('FEE_JOURNAL_NOT_POSTABLE'))
  assert.equal(wrongWay.posts('FEE_JOURNAL').length, 0)

  // Two reversals under the same reference: never pick one, never post a third.
  const twice = refundWorld({
    sales: [refundSale20717(-300)],
    journals: ['ZJ-R1', 'ZJ-R2'].map((journalId) => ({ journalId, referenceNumber: SIGNED_FEE_REF, journalDate: '2026-09-03', lineItems: [{ accountId: A1013, debitOrCredit: 'debit', amount: 3, customerId: '' }, { accountId: A2270, debitOrCredit: 'credit', amount: 3, customerId: '' }] })),
  })
  await twice.postRefund(REFUND_20717)
  assert.equal((await twice.preview()).feeJournal.status, FJ.NEEDS_REVIEW)
  await assert.rejects(twice.postFee(), code('FEE_JOURNAL_NOT_POSTABLE'))
  assert.equal(twice.posts('FEE_JOURNAL').length, 0)
})

test('signed fee: uncertain Zoho response on a reversal is searched, never resent (found → VERIFIED, lost → POSTING_UNCERTAIN)', async () => {
  const found = refundWorld({ sales: [refundSale20717(-300)], script: { FEE_JOURNAL: ['timeout-created'] } })
  await found.postRefund(REFUND_20717)
  const out = await found.postFee()
  assert.equal(out.outcome, FJ.VERIFIED)
  assert.equal(found.posts('FEE_JOURNAL').length, 1)
  assert.equal((await found.preview()).status, PAYOUT_STATUS.FULLY_CLEARED)

  const lost = refundWorld({ sales: [refundSale20717(-300)], script: { FEE_JOURNAL: ['timeout'] } })
  await lost.postRefund(REFUND_20717)
  assert.equal((await lost.postFee()).outcome, FJ.POSTING_UNCERTAIN)
  const uncertain = await lost.preview()
  assert.deepEqual([uncertain.feeJournal.status, uncertain.feeJournal.recovery.action, uncertain.feeJournal.direction, uncertain.status], [FJ.POSTING_UNCERTAIN, 'POSTING_UNCERTAIN', 'FEE_REVERSAL', PAYOUT_STATUS.POSTING_UNCERTAIN])
  await assert.rejects(lost.postFee(), code('FEE_JOURNAL_NOT_POSTABLE'))
  assert.equal(lost.posts('FEE_JOURNAL').length, 1)

  // Created in the wrong direction and read back: needs review, never re-posted.
  const flipped = (payload, { state }) => {
    state.journals.push({ journalId: 'ZJ-FLIP', referenceNumber: payload.reference_number, journalDate: payload.journal_date, lineItems: [{ accountId: A2270, debitOrCredit: 'debit', amount: 3, customerId: '' }, { accountId: A1013, debitOrCredit: 'credit', amount: 3, customerId: '' }] })
    return { recordId: 'ZJ-FLIP' }
  }
  const wrong = refundWorld({ sales: [refundSale20717(-300)], script: { FEE_JOURNAL: [flipped] } })
  await wrong.postRefund(REFUND_20717)
  assert.equal((await wrong.postFee()).outcome, FJ.NEEDS_REVIEW)
  const after = await wrong.preview()
  assert.equal(after.feeJournal.status, FJ.NEEDS_REVIEW)
  assert.notEqual(after.status, PAYOUT_STATUS.FULLY_CLEARED)
  await assert.rejects(wrong.postFee(), code('FEE_JOURNAL_NOT_POSTABLE'))
  assert.equal(wrong.posts('FEE_JOURNAL').length, 1)
})

test('signed fee: a historical manual reversal (Dr 1013 / Cr 2270) is LEGACY_VERIFIED; a forward manual journal is not', async () => {
  const manual = (journalId, drAccount, crAccount) => ({
    journalId, entryNumber: '9001', referenceNumber: 'Stripe fee refund Sep', journalDate: '2026-09-04',
    lineItems: [{ accountId: drAccount, debitOrCredit: 'debit', amount: 3, customerId: '' }, { accountId: crAccount, debitOrCredit: 'credit', amount: 3, customerId: '' }],
  })
  const w = refundWorld({ sales: [refundSale20717(-300)], legacyInRange: true, journals: [manual('ZJ-MANUAL', A1013, A2270)] })
  await w.postRefund(REFUND_20717)
  const p = await w.preview()
  assert.equal(p.feeJournal.status, FJ.LEGACY_VERIFIED)
  assert.equal(p.feeJournal.legacy.journals[0].journalId, 'ZJ-MANUAL')
  assert.equal(p.status, PAYOUT_STATUS.FULLY_CLEARED)
  await assert.rejects(w.postFee(), code('FEE_JOURNAL_NOT_POSTABLE'))
  assert.equal(w.posts('FEE_JOURNAL').length, 0)

  const forward = refundWorld({ sales: [refundSale20717(-300)], legacyInRange: true, journals: [manual('ZJ-FWD', A2270, A1013)] })
  await forward.postRefund(REFUND_20717)
  const f = await forward.preview()
  assert.equal(f.feeJournal.status, FJ.READY, 'an expense journal never covers a reversal')
})

test('signed fee: fingerprint covers direction; a stale fingerprint from the other direction is refused', async () => {
  const w = refundWorld({ sales: [refundSale20717(-300)] })
  await w.postRefund(REFUND_20717)
  const fp = (await w.preview()).feeJournal.postingFingerprint
  const positive = refundWorld({ sales: [chargeSale(600), refundSale20717(-300)] })
  await clearEverything(positive)
  assert.notEqual(fp, (await positive.preview()).feeJournal.postingFingerprint)
  await assert.rejects(w.postFee('stale'), code('PREVIEW_CHANGED'))
  await assert.rejects(w.postFee((await positive.preview()).feeJournal.postingFingerprint), code('PREVIEW_CHANGED'))
  assert.equal(w.posts('FEE_JOURNAL').length, 0)
  assert.equal((await w.postFee(fp)).outcome, FJ.VERIFIED)
})

// ---------------------------------------------------------------------------
// Uncertain Zoho writes (shared by every writer): a POST whose result is unknown and that no
// read path shows yet is POSTING_UNCERTAIN. It is never re-sent until an admin rechecks Zoho
// and explicitly confirms it was not created; a later recheck that finds it records it.
// ---------------------------------------------------------------------------

const { recheckUncertainComponent, confirmUncertainNotCreated } = require('../src/services/stripeClearing/stripePayoutPostingService')

const T0 = '2026-09-28T14:00:00.000Z'
const at = (minutes) => ({ now: () => new Date(Date.parse(T0) + minutes * 60 * 1000) })
const REFUND_FEE_SALES = () => [CARRIER(), S20717({ refunds: [refundOf(REFUND_20717, 7670, { fee: -230 })] })]
const fingerprintOr = (value) => value || 'none'

/**
 * One descriptor per Zoho writer. `make(step)` builds a world whose next POST of this writer
 * does `step`; `setup` posts whatever must be verified first; `attempt` is the ordinary post
 * button (fresh preview + fingerprint, like the UI).
 */
const WRITERS = [
  {
    name: 'NET customer payment', kind: 'NET', component: 'NET', scope: 'component',
    make: (step) => world({ script: { NET: [step] } }),
    setup: async () => {},
    attempt: async (w, patch) => w.post('burjman', fingerprintOr(await w.fingerprint(SHOP)), patch),
  },
  {
    name: 'FEE customer payment', kind: 'FEE', component: 'FEE', scope: 'component',
    make: (step) => world({ script: { FEE: [step] } }),
    setup: async () => {},
    attempt: async (w, patch) => w.post('burjman', fingerprintOr(await w.fingerprint(SHOP)), patch),
  },
  {
    name: 'Customer Advance journal', kind: 'JOURNAL', component: 'CUSTOMER_ADVANCE', scope: 'component',
    make: (step) => world({ script: { JOURNAL: [step] } }),
    setup: async () => {},
    attempt: async (w, patch) => w.post('website', fingerprintOr(await w.fingerprint(WEB)), patch),
  },
  {
    name: 'payout fee journal', kind: 'FEE_JOURNAL', component: 'PAYOUT_FEE_JOURNAL', scope: 'component',
    make: (step) => world({ script: { FEE_JOURNAL: [step] } }),
    setup: (w) => postGroups(w),
    attempt: async (w, patch) => w.postFee(fingerprintOr(await w.feeFingerprint()), patch),
  },
  {
    name: 'credit note refund', kind: 'CN_REFUND', component: 'REFUND_CREDIT_NOTE_REFUND', scope: 'refund-component',
    make: (step) => refundWorld({ script: { CN_REFUND: [step] } }),
    setup: async () => {},
    attempt: (w, patch) => w.postRefund(REFUND_20717, undefined, patch),
  },
  {
    name: 'refund fee-adjustment journal', kind: 'REFUND_FEE', component: 'REFUND_FEE_ADJUSTMENT', scope: 'refund-component',
    make: (step) => refundWorld({ sales: REFUND_FEE_SALES(), script: { REFUND_FEE: [step] } }),
    setup: async () => {},
    attempt: (w, patch) => w.postRefund(REFUND_20717, undefined, patch),
  },
]

/** Status of the group / fee journal / refund that owns this writer's component in a preview. */
function ownerOf(W, p) {
  if (W.scope === 'refund-component') return p.normalRefunds.find((r) => r.refundId === REFUND_20717)
  if (W.component === 'PAYOUT_FEE_JOURNAL') return p.feeJournal
  return p.groups.find((g) => g.customerId === (W.component === 'CUSTOMER_ADVANCE' ? WEB : SHOP))
}
const rowOf = (W, w) => (W.scope === 'refund-component' ? w.state.refundComponents : w.state.components).find((c) => c.component === W.component)
const postsOf = (W, w) => w.state.posts.filter((p) => p.kind === W.kind).length
/** Records in Zoho (visible or not) under this component's reference. */
function zohoRecords(w, reference) {
  const payments = w.state.payments.filter((p) => p.referenceNumber === reference).length
  const journals = w.state.journals.filter((j) => j.referenceNumber === reference).length
  const refunds = (w.state.creditNotes || []).reduce((t, n) => t + n.refunds.filter((r) => r.referenceNumber === reference).length, 0)
  return payments + journals + refunds
}
async function ordinaryRetry(W, w, patch) {
  try {
    return { outcome: (await W.attempt(w, patch)).outcome }
  } catch (err) {
    return { refused: err.code }
  }
}
const recheck = (W, w, patch) => recheckUncertainComponent(w.payoutId, W.scope, rowOf(W, w).id, { actor: 'user:9' }, w.deps(patch))
/** The admin's own Zoho check, made at the time of the confirmation unless overridden. */
const ownCheck = (W, w, patch, over = {}) => ({
  checkedAt: patch.now().toISOString(),
  zohoLocation: 'Zoho Books search: payments, journals, credit note refunds',
  searchedFor: `reference "${rowOf(W, w).reference}" on the payout date`,
  recordsFound: 0,
  ...over,
})
const confirmNotCreated = (W, w, patch, opts = {}) => confirmUncertainNotCreated(
  w.payoutId, W.scope, rowOf(W, w).id,
  { actor: 'user:9', reason: 'Checked Zoho by hand: no record with this reference.', acknowledged: true, verification: ownCheck(W, w, patch), ...opts },
  w.deps(patch),
)
const eventTypes = (W, w) => w.state.events.filter((e) => e.entityId === rowOf(W, w).id && e.component === W.component && e.eventType).map((e) => e.eventType)
const reveal = (w) => { w.state.hidden.clear(); w.state.unindexed.clear() }

/** POST created the record, the response is uncertain and no read path shows it yet. */
async function uncertainAfterLaggedPost(W) {
  const w = W.make('timeout-hidden')
  await W.setup(w)
  const first = await W.attempt(w)
  const row = rowOf(W, w)
  assert.equal(row.status, 'POSTING_UNCERTAIN', `${W.name}: uncertain, not FAILED`)
  assert.notEqual(first.outcome, 'NOT_POSTED')
  assert.equal(postsOf(W, w), 1)
  assert.equal(zohoRecords(w, row.reference), 1)
  return w
}

for (const W of WRITERS) {
  test(`uncertain write, original bug (${W.name}): created but not visible → POSTING_UNCERTAIN; ordinary retries send nothing; one record in Zoho`, async () => {
    const w = await uncertainAfterLaggedPost(W)
    const p = await w.preview()
    assert.equal(p.status, PAYOUT_STATUS.POSTING_UNCERTAIN)
    assert.deepEqual(p.uncertainComponents.map((u) => [u.component, u.status, u.canConfirm]), [[W.component, 'POSTING_UNCERTAIN', false]])
    // Ordinary retries, including long after the settle window, never re-send.
    for (const minutes of [0, 5, 60, 24 * 60]) {
      const retry = await ordinaryRetry(W, w, at(minutes))
      assert.ok(retry.refused || retry.outcome !== 'VERIFIED', `${W.name}: retry at +${minutes}m`)
    }
    assert.equal(postsOf(W, w), 1, `${W.name}: zero additional POSTs`)
    assert.equal(zohoRecords(w, rowOf(W, w).reference), 1, `${W.name}: exactly one record in Zoho`)
    assert.equal(rowOf(W, w).status, 'POSTING_UNCERTAIN')
    assert.equal(rowOf(W, w).attemptCount, 1)
    const after = await w.preview()
    assert.deepEqual([ownerOf(W, after).status, ownerOf(W, after).postable], ['POSTING_UNCERTAIN', false], `${W.name}: blocked because it is uncertain`)
    assert.equal(after.status, PAYOUT_STATUS.POSTING_UNCERTAIN)
    assert.deepEqual(eventTypes(W, w).slice(0, 3), ['POSTING_STARTED', 'POSTING_RESPONSE_UNCERTAIN', 'RECOVERY_STILL_MISSING'])
    assert.ok(!w.state.events.some((e) => e.entityId === rowOf(W, w).id && e.component === W.component && e.toStatus === 'FAILED'), 'never labelled FAILED')
  })

  test(`uncertain write, visibility lag (${W.name}): hidden at t0 and at the first recheck, visible later → VERIFIED with one POST`, async () => {
    const w = await uncertainAfterLaggedPost(W)
    const r1 = await recheck(W, w, at(2))
    assert.deepEqual([r1.outcome, r1.zohoWrites], ['POSTING_UNCERTAIN', 0])
    assert.equal(rowOf(W, w).recoveryCheckCount, 1)
    await assert.rejects(confirmNotCreated(W, w, at(3)), code('SETTLE_WINDOW_OPEN'))
    reveal(w)
    const r2 = await recheck(W, w, at(4))
    assert.equal(r2.outcome, 'VERIFIED')
    const row = rowOf(W, w)
    assert.deepEqual([row.status, row.attemptCount, row.recoveryCheckCount], ['VERIFIED', 1, 2])
    assert.ok(row.zohoRecordId && row.verifiedAt && row.firstUncertainAt === T0)
    assert.equal(postsOf(W, w), 1, `${W.name}: POST count exactly 1`)
    assert.equal(zohoRecords(w, row.reference), 1)
    assert.deepEqual(eventTypes(W, w), ['POSTING_STARTED', 'POSTING_RESPONSE_UNCERTAIN', 'RECOVERY_STILL_MISSING', 'RECOVERY_STILL_MISSING', 'RECOVERY_MATCH_FOUND'])
    const found = w.state.events.find((e) => e.eventType === 'RECOVERY_MATCH_FOUND')
    assert.deepEqual([found.evidence.state, found.evidence.recordId, found.actor], ['VERIFIED', row.zohoRecordId, 'user:9'])
    if (W.component === 'CUSTOMER_ADVANCE') assert.equal(w.state.cases[0].status, 'ADVANCE_POSTED')
  })

  test(`uncertain write, manual retry (${W.name}): not created → recheck missing → retry blocked → admin confirms → one POST → VERIFIED`, async () => {
    const w = W.make('timeout')
    await W.setup(w)
    await W.attempt(w)
    assert.equal(rowOf(W, w).status, 'POSTING_UNCERTAIN')
    assert.equal(zohoRecords(w, rowOf(W, w).reference), 0)

    await assert.rejects(confirmNotCreated(W, w, at(20)), code('RECHECK_REQUIRED'))
    assert.equal((await recheck(W, w, at(1))).outcome, 'POSTING_UNCERTAIN')
    assert.ok((await ordinaryRetry(W, w, at(2))).refused || rowOf(W, w).status === 'POSTING_UNCERTAIN')
    assert.equal(postsOf(W, w), 1, 'ordinary retry blocked')
    await assert.rejects(confirmNotCreated(W, w, at(14)), code('SETTLE_WINDOW_OPEN'))
    assert.equal(rowOf(W, w).status, 'POSTING_UNCERTAIN', 'the settle window alone never makes it retryable')

    const confirmed = await confirmNotCreated(W, w, at(15))
    assert.deepEqual([confirmed.outcome, confirmed.component.retryAllowed, confirmed.zohoWrites], ['FAILED', true, 0])
    assert.equal(postsOf(W, w), 1, 'confirming sends nothing')
    const row = rowOf(W, w)
    assert.deepEqual([row.retryAuthorizedBy, row.retryAuthorizedAt], ['user:9', at(15).now().toISOString()])
    assert.match(row.retryAuthorizationReason, /Checked Zoho by hand/)

    const retried = await W.attempt(w, at(16))
    assert.notEqual(retried.outcome, 'NOT_POSTED')
    assert.equal(postsOf(W, w), 2, 'exactly one retry POST')
    assert.deepEqual([rowOf(W, w).status, rowOf(W, w).attemptCount], ['VERIFIED', 2])
    assert.equal(zohoRecords(w, row.reference), 1)
    assert.deepEqual(eventTypes(W, w), [
      'POSTING_STARTED', 'POSTING_RESPONSE_UNCERTAIN', 'RECOVERY_STILL_MISSING', 'RECOVERY_STILL_MISSING',
      'ADMIN_CONFIRMED_NOT_CREATED', 'RETRY_ALLOWED', 'POSTING_RETRIED', 'VERIFIED',
    ])
    const allowed = w.state.events.find((e) => e.eventType === 'RETRY_ALLOWED')
    assert.deepEqual(
      [allowed.fromStatus, allowed.toStatus, allowed.actor, allowed.evidence.acknowledged, allowed.evidence.serverLookup.state, allowed.evidence.serverLookup.complete],
      ['POSTING_UNCERTAIN', 'FAILED', 'user:9', true, 'MISSING', true],
    )
    assert.deepEqual(allowed.evidence.adminVerification, { ...ownCheck(W, w, at(15)), searchedFor: `reference "${row.reference}" on the payout date` })
    assert.deepEqual(row.retryAuthorizationEvidence, allowed.evidence, 'the evidence is stored with the authorization')
  })

  test(`uncertain write, direct evidence (${W.name}): success without ID and missing from the search index → found by the direct read, VERIFIED`, async () => {
    const w = W.make('no-id-unindexed')
    await W.setup(w)
    await W.attempt(w)
    const row = rowOf(W, w)
    assert.equal(row.status, 'VERIFIED')
    assert.deepEqual([postsOf(W, w), zohoRecords(w, row.reference)], [1, 1])
    assert.ok(eventTypes(W, w).includes('RECOVERY_MATCH_FOUND'))
  })
}

test('uncertain write: a record that appears with different figures → NEEDS_REVIEW (RECOVERY_CONFLICT), never re-sent', async () => {
  const W = WRITERS.find((x) => x.component === 'PAYOUT_FEE_JOURNAL')
  const w = await uncertainAfterLaggedPost(W)
  reveal(w)
  const journal = w.state.journals.find((j) => j.referenceNumber === rowOf(W, w).reference)
  journal.lineItems = journal.lineItems.map((l) => ({ ...l, amount: l.amount + 1 }))
  const out = await recheck(W, w, at(5))
  assert.equal(out.outcome, 'NEEDS_REVIEW')
  assert.equal(eventTypes(W, w).at(-1), 'RECOVERY_CONFLICT')
  await assert.rejects(confirmNotCreated(W, w, at(30)), code('COMPONENT_NOT_UNCERTAIN'))
  assert.ok((await ordinaryRetry(W, w, at(31))).refused)
  assert.equal(postsOf(W, w), 1)
  assert.equal((await w.preview()).status, PAYOUT_STATUS.NEEDS_REVIEW)
})

test('uncertain write: confirmation needs an admin, the acknowledgement, a reason, and a fresh Zoho check', async () => {
  const W = WRITERS.find((x) => x.component === 'REFUND_CREDIT_NOTE_REFUND')
  const w = await uncertainAfterLaggedPost(W)
  await recheck(W, w, at(1))
  await assert.rejects(confirmNotCreated(W, w, at(20), { acknowledged: false }), code('ACKNOWLEDGEMENT_REQUIRED'))
  await assert.rejects(confirmNotCreated(W, w, at(20), { reason: 'no' }), code('REASON_REQUIRED'))
  await assert.rejects(confirmNotCreated(W, w, at(20), { actor: '' }), code('ACTOR_REQUIRED'))
  await assert.rejects(recheckUncertainComponent(w.payoutId, 'bogus', rowOf(W, w).id, { actor: 'user:9' }, w.deps()), code('INVALID_RECOVERY_SCOPE'))
  // The record shows up between the admin's own check and the confirmation: recorded, no retry.
  reveal(w)
  const out = await confirmNotCreated(W, w, at(20))
  assert.deepEqual([out.outcome, out.component.retryAllowed], ['VERIFIED', false])
  assert.equal(rowOf(W, w).retryAuthorizedAt, undefined)
  assert.equal(postsOf(W, w), 1)
  await assert.rejects(recheck(W, w, at(21)), code('COMPONENT_NOT_UNCERTAIN'))
})

test('uncertain write: recheck and confirm take the payout lock; a held lock changes nothing and sends nothing', async () => {
  const W = WRITERS.find((x) => x.component === 'NET')
  const w = await uncertainAfterLaggedPost(W)
  w.state.locked = true
  await assert.rejects(recheck(W, w, at(1)), code('PAYOUT_POSTING_IN_PROGRESS'))
  await assert.rejects(confirmNotCreated(W, w, at(20)), code('PAYOUT_POSTING_IN_PROGRESS'))
  await assert.rejects(W.attempt(w, at(20)), code('PAYOUT_POSTING_IN_PROGRESS'))
  w.state.locked = false
  assert.deepEqual([rowOf(W, w).status, rowOf(W, w).recoveryCheckCount || 0, postsOf(W, w)], ['POSTING_UNCERTAIN', 0, 1])
})

test('uncertain write: an authorized retry that is uncertain again starts a new episode and needs a new recheck + confirmation', async () => {
  const W = WRITERS.find((x) => x.component === 'PAYOUT_FEE_JOURNAL')
  const w = W.make('timeout')
  w.script.FEE_JOURNAL.push('timeout')
  await W.setup(w)
  await W.attempt(w)
  await recheck(W, w, at(1))
  await confirmNotCreated(W, w, at(15))
  await W.attempt(w, at(16))
  const row = rowOf(W, w)
  assert.deepEqual([row.status, row.attemptCount, row.firstUncertainAt, row.uncertainSince], ['POSTING_UNCERTAIN', 2, T0, at(16).now().toISOString()])
  await assert.rejects(confirmNotCreated(W, w, at(40)), code('RECHECK_REQUIRED'))
  assert.ok((await ordinaryRetry(W, w, at(40))).refused)
  assert.equal(postsOf(W, w), 2)
})

/** A lookup source that fails the way a real one does: throwing, malformed or incomplete. */
function failingSource(w, name, code) {
  const original = w.sources[name]
  w.sources[name] = async () => {
    const err = new Error(`${name}: ${code}`)
    err.code = code
    throw err
  }
  return () => { w.sources[name] = original }
}
const SOURCE_OF = {
  NET: 'listZohoInvoicePayments',
  FEE: 'listZohoInvoicePayments',
  CUSTOMER_ADVANCE: 'listZohoJournalsInRange',
  PAYOUT_FEE_JOURNAL: 'listZohoJournalsInRange',
  REFUND_CREDIT_NOTE_REFUND: 'listZohoCreditNoteRefunds',
  REFUND_FEE_ADJUSTMENT: 'listZohoJournalsInRange',
}

for (const W of WRITERS) {
  test(`uncertain write, incomplete lookup (${W.name}): a failed or partial Zoho read never counts as a recheck and never authorizes a retry`, async () => {
    const w = W.make('timeout')
    await W.setup(w)
    await W.attempt(w)
    assert.equal(rowOf(W, w).status, 'POSTING_UNCERTAIN')
    const restore = failingSource(w, SOURCE_OF[W.component], 'ZOHO_LOOKUP_INCOMPLETE')
    const r = await recheck(W, w, at(1))
    assert.deepEqual([r.outcome, r.zohoWrites], ['POSTING_UNCERTAIN', 0])
    assert.equal(rowOf(W, w).recoveryCheckCount || 0, 0, 'a failed lookup is not a recheck')
    assert.equal(eventTypes(W, w).at(-1), 'RECOVERY_LOOKUP_FAILED')
    const failed = w.state.events.filter((e) => e.eventType === 'RECOVERY_LOOKUP_FAILED').at(-1)
    assert.equal(failed.evidence.complete, false)
    // Even long after the settle window, with a perfect admin check, no retry.
    await assert.rejects(confirmNotCreated(W, w, at(60)), code('RECHECK_REQUIRED'))
    restore()
    // A complete recheck, then the confirmation's own lookup fails: refused, no retry.
    assert.equal((await recheck(W, w, at(61))).outcome, 'POSTING_UNCERTAIN')
    const restore2 = failingSource(w, SOURCE_OF[W.component], 'ZOHO_LOOKUP_MALFORMED')
    const out = await confirmNotCreated(W, w, at(90))
    assert.deepEqual([out.outcome, out.component.retryAllowed], ['POSTING_UNCERTAIN', false])
    restore2()
    const row = rowOf(W, w)
    assert.deepEqual([row.status, row.retryAuthorizedAt || null], ['POSTING_UNCERTAIN', null])
    assert.ok(!eventTypes(W, w).includes('RETRY_ALLOWED'))
    assert.ok((await ordinaryRetry(W, w, at(91))).refused || rowOf(W, w).status === 'POSTING_UNCERTAIN')
    assert.equal(postsOf(W, w), 1, 'nothing re-sent')
  })
}

test('recovery lookups never silently weaken: no invoice to read, no allocation or no journal date is an error, not "missing"', async () => {
  const empty = async () => []
  const sources = {
    findZohoPaymentsByReference: empty,
    findZohoJournalsByReference: empty,
    listZohoJournalsInRange: empty,
    listZohoInvoicePayments: async () => [],
  }
  const deps = { sources, config: CFG, zohoPayments: {} }
  const payment = { component: 'NET', zohoRecordType: 'customer_payment', reference: 'Stripe NET po_x', amount: 5, allocations: [{ invoiceId: 'INV1', amount: 5 }] }
  const journal = { component: 'PAYOUT_FEE_JOURNAL', zohoRecordType: 'journal', reference: 'Stripe processing fees po_x', amount: 5, date: '2026-09-28' }
  assert.equal((await componentZohoState(payment, SHOP, 'po_x', deps, { deep: true })).state, 'MISSING', 'complete evidence, nothing found')
  assert.equal((await componentZohoState(journal, null, 'po_x', deps, { deep: true })).state, 'MISSING')
  await assert.rejects(componentZohoState({ ...payment, allocations: [] }, SHOP, 'po_x', deps, { deep: true }), code('RECOVERY_LOOKUP_INCOMPLETE'))
  await assert.rejects(componentZohoState({ ...payment, allocations: [{ invoiceId: '', amount: 5 }] }, SHOP, 'po_x', deps, { deep: true }), code('RECOVERY_LOOKUP_INCOMPLETE'))
  await assert.rejects(componentZohoState({ ...journal, date: undefined }, null, 'po_x', deps, { deep: true }), code('RECOVERY_LOOKUP_INCOMPLETE'))
  const { listZohoInvoicePayments, ...noInvoiceSource } = sources
  await assert.rejects(componentZohoState(payment, SHOP, 'po_x', { ...deps, sources: noInvoiceSource }, { deep: true }), code('RECOVERY_LOOKUP_INCOMPLETE'))
  const { listZohoJournalsInRange, ...noListing } = sources
  await assert.rejects(componentZohoState(journal, null, 'po_x', { ...deps, sources: noListing }, { deep: true }), code('RECOVERY_LOOKUP_INCOMPLETE'))
  // The ordinary (non-recovery) duplicate check keeps working without the deep sources.
  assert.equal((await componentZohoState(journal, null, 'po_x', { ...deps, sources: noListing })).state, 'MISSING')
})

test('uncertain write: the admin must record an independent Zoho check made after the settle window, naming the reference', async () => {
  const W = WRITERS.find((x) => x.component === 'NET')
  const w = W.make('timeout')
  await W.setup(w)
  await W.attempt(w)
  await recheck(W, w, at(1))
  const ref = rowOf(W, w).reference
  const noCheck = { verification: undefined }
  await assert.rejects(confirmNotCreated(W, w, at(20), noCheck), code('VERIFICATION_REQUIRED'))
  await assert.rejects(confirmNotCreated(W, w, at(20), { verification: ownCheck(W, w, at(20), { recordsFound: 1 }) }), code('VERIFICATION_FOUND_RECORDS'))
  await assert.rejects(confirmNotCreated(W, w, at(20), { verification: ownCheck(W, w, at(20), { recordsFound: undefined }) }), code('VERIFICATION_FOUND_RECORDS'))
  await assert.rejects(confirmNotCreated(W, w, at(20), { verification: ownCheck(W, w, at(20), { checkedAt: 'yesterday-ish' }) }), code('VERIFICATION_TIME_REQUIRED'))
  await assert.rejects(confirmNotCreated(W, w, at(20), { verification: ownCheck(W, w, at(20), { zohoLocation: 'Zo' }) }), code('VERIFICATION_LOCATION_REQUIRED'))
  await assert.rejects(confirmNotCreated(W, w, at(20), { verification: ownCheck(W, w, at(20), { searchedFor: 'po' }) }), code('VERIFICATION_SEARCH_REQUIRED'))
  // A check made inside the settle window (before Zoho had time to index) does not count.
  await assert.rejects(confirmNotCreated(W, w, at(20), { verification: ownCheck(W, w, at(20), { checkedAt: at(10).now().toISOString() }) }), code('VERIFICATION_TOO_EARLY'))
  await assert.rejects(confirmNotCreated(W, w, at(20), { verification: ownCheck(W, w, at(20), { checkedAt: at(40).now().toISOString() }) }), code('VERIFICATION_IN_FUTURE'))
  await assert.rejects(confirmNotCreated(W, w, at(20), { verification: ownCheck(W, w, at(20), { searchedFor: 'Stripe payments on 2026-09-28' }) }), code('VERIFICATION_REFERENCE_MISSING'))
  assert.deepEqual([rowOf(W, w).status, rowOf(W, w).retryAuthorizedAt || null, postsOf(W, w)], ['POSTING_UNCERTAIN', null, 1])
  const ok = await confirmNotCreated(W, w, at(20), { verification: ownCheck(W, w, at(20), { checkedAt: at(18).now().toISOString(), searchedFor: `${ref} and the invoice payment history` }) })
  assert.deepEqual([ok.outcome, ok.component.retryAllowed, postsOf(W, w)], ['FAILED', true, 1])
})

// ---------------------------------------------------------------------------
// Real PostgreSQL: posting service + store + advisory lock (Zoho/Stripe faked).
//   STRIPE_CLEARING_TEST_DATABASE_URL=postgres://…/scratch node --test tests/stripePayoutPosting.test.js
// ---------------------------------------------------------------------------

const PG_URL = process.env.STRIPE_CLEARING_TEST_DATABASE_URL
const pgSkip = PG_URL ? false : 'STRIPE_CLEARING_TEST_DATABASE_URL not set'
const PG_SCHEMA = 'stripe_payout_posting_pg_test'
let pgPool

test.before(async () => {
  if (pgSkip) return
  const { Pool } = require('pg')
  const admin = new Pool({ connectionString: PG_URL, max: 1 })
  await admin.query(`DROP SCHEMA IF EXISTS ${PG_SCHEMA} CASCADE`)
  await admin.query(`CREATE SCHEMA ${PG_SCHEMA}`)
  await admin.end()
  pgPool = new Pool({ connectionString: PG_URL, max: 6, options: `-c search_path=${PG_SCHEMA}` })
  const q = (sql, params) => pgPool.query(sql, params)
  await require('../src/services/stripeClearing/stripeClearingStore').ensureStripeClearingTables(q)
  await require('../src/services/stripeClearing/stripePayoutClearingStore').ensureStripePayoutClearingTables(q)
})
test.after(async () => {
  if (!pgPool) return
  await pgPool.query(`DROP SCHEMA IF EXISTS ${PG_SCHEMA} CASCADE`)
  await pgPool.end()
})

async function pgReset() {
  await pgPool.query('TRUNCATE stripe_payout_clearing_components, stripe_payout_refund_components, stripe_payout_clearing_events RESTART IDENTITY')
}
const pgRows = async (sql, params) => (await pgPool.query(sql, params)).rows

test('pg: negative-fee reversal saves Dr 1013 / Cr 2270 on the payout fee journal row and clears the payout', { skip: pgSkip }, async () => {
  await pgReset()
  const w = refundWorld({ sales: [refundSale20717(-300)], pool: pgPool })
  assert.equal((await w.postRefund(REFUND_20717)).outcome, NR.VERIFIED)
  const out = await w.postFee()
  assert.equal(out.outcome, FJ.VERIFIED)
  const [row] = await pgRows("SELECT * FROM stripe_payout_clearing_components WHERE component = 'PAYOUT_FEE_JOURNAL'")
  assert.deepEqual(
    [row.payout_id, row.zoho_customer_id, row.status, row.debit_account_id, row.credit_account_id, Number(row.amount), row.reference, row.attempt_count],
    [RPO, null, 'VERIFIED', A1013, A2270, 3, SIGNED_FEE_REF, 1],
  )
  assert.equal(row.zoho_record_id, row.zoho_journal_id)
  assert.ok(row.verified_at && row.posted_at)
  const events = await pgRows("SELECT from_status, to_status FROM stripe_payout_clearing_events WHERE entity_type = 'COMPONENT' AND entity_id = $1 ORDER BY id", [row.id])
  assert.deepEqual(events.map((e) => [e.from_status, e.to_status]), [[null, 'PLANNED'], ['PLANNED', 'POSTING'], ['POSTING', 'POSTED'], ['POSTED', 'VERIFIED']])
  const refunds = await pgRows('SELECT component, status, debit_account_id, credit_account_id, amount FROM stripe_payout_refund_components ORDER BY component')
  assert.deepEqual(refunds.map((r) => [r.component, r.status, r.debit_account_id, r.credit_account_id, Number(r.amount)]), [
    ['REFUND_CREDIT_NOTE_REFUND', 'VERIFIED', null, null, 76.7],
    ['REFUND_FEE_ADJUSTMENT', 'VERIFIED', A1019, A1013, 3],
  ])
  const done = await w.preview()
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assertCleared(w, done, -300)
})

test('pg: duplicates are refused by the database and by the service; a verified reversal is never re-sent', { skip: pgSkip }, async () => {
  await pgReset()
  const w = refundWorld({ sales: [refundSale20717(-300)], pool: pgPool })
  await w.postRefund(REFUND_20717)
  await w.postFee()
  const again = await w.postFee()
  assert.deepEqual([again.outcome, again.alreadyPosted, again.zohoRequests], [FJ.VERIFIED, true, 0])
  assert.equal(w.posts('FEE_JOURNAL').length, 1)
  const refundAgain = await w.postRefund(REFUND_20717)
  assert.deepEqual([refundAgain.outcome, refundAgain.alreadyPosted, refundAgain.zohoRequests], [NR.VERIFIED, true, 0])
  assert.equal(w.posts('CN_REFUND').length, 1)

  const insertFee = () => pgPool.query(
    `INSERT INTO stripe_payout_clearing_components (payout_id, zoho_customer_id, component, zoho_record_type, amount, currency, debit_account_id, credit_account_id, reference, status)
     VALUES ($1, NULL, 'PAYOUT_FEE_JOURNAL', 'journal', 3, 'AED', $2, $3, $4, 'PLANNED')`, [RPO, A2270, A1013, SIGNED_FEE_REF])
  await assert.rejects(insertFee(), (err) => err.code === '23505', 'second fee journal for the payout, even in the other direction')
  const [adj] = await pgRows("SELECT * FROM stripe_payout_refund_components WHERE component = 'REFUND_FEE_ADJUSTMENT'")
  await assert.rejects(pgPool.query(
    `INSERT INTO stripe_payout_refund_components (payout_id, refund_id, balance_transaction_id, charge_id, zoho_customer_id, invoice_id, credit_note_id,
       component, zoho_record_type, amount, currency, debit_account_id, credit_account_id, reference, status)
     SELECT payout_id, refund_id, balance_transaction_id, charge_id, zoho_customer_id, invoice_id, credit_note_id, component, zoho_record_type,
       amount, currency, credit_account_id, debit_account_id, reference, 'PLANNED' FROM stripe_payout_refund_components WHERE id = $1`, [adj.id]),
  (err) => err.code === '23505', 'second fee adjustment for the refund, even reversed')
  const [fee] = await pgRows("SELECT zoho_record_id FROM stripe_payout_clearing_components WHERE component = 'PAYOUT_FEE_JOURNAL'")
  await assert.rejects(pgPool.query(
    `INSERT INTO stripe_payout_clearing_components (payout_id, zoho_customer_id, component, zoho_record_type, amount, currency, deposit_account_id, reference, status, zoho_record_id)
     VALUES ('po_OTHER000000001', '4265011000000160061', 'FEE', 'customer_payment', 3, 'AED', $1, 'x', 'POSTED', $2)`, [A1013, fee.zoho_record_id],
  ), (err) => err.code === '23505', 'one Zoho record ID can back only one local component')
})

test('pg: the payout advisory lock admits one poster; a concurrent or held lock sends nothing', { skip: pgSkip }, async () => {
  await pgReset()
  const store = require('../src/services/stripeClearing/stripePayoutClearingStore')
  const w = refundWorld({ sales: [refundSale20717(-300)], pool: pgPool })
  await w.postRefund(REFUND_20717)
  const fp = (await w.preview()).feeJournal.postingFingerprint

  const held = await store.acquirePayoutLock(pgPool, RPO)
  try {
    await assert.rejects(w.postFee(fp), code('PAYOUT_POSTING_IN_PROGRESS'))
    await assert.rejects(store.acquirePayoutLock(pgPool, RPO), code('PAYOUT_POSTING_IN_PROGRESS'))
    const other = await store.acquirePayoutLock(pgPool, 'po_ANOTHERPAYOUT01')
    await other.release()
  } finally {
    await held.release()
  }
  assert.equal(w.posts('FEE_JOURNAL').length, 0)
  assert.equal((await pgRows("SELECT count(*)::int AS n FROM stripe_payout_clearing_components WHERE component = 'PAYOUT_FEE_JOURNAL'"))[0].n, 0)

  const results = await Promise.allSettled([w.postFee(fp), w.postFee(fp), w.postFee(fp)])
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
  const refused = results.filter((r) => r.status === 'rejected').map((r) => r.reason.code)
  assert.ok(ok.length >= 1)
  assert.ok(refused.every((c) => c === 'PAYOUT_POSTING_IN_PROGRESS'), `unexpected: ${refused}`)
  if (process.env.PG_LOCK_TRACE) console.log(`lock race: ${ok.length} ran, ${refused.length} refused`)
  assert.equal(w.posts('FEE_JOURNAL').length, 1, 'exactly one Zoho POST however the calls interleave')
  assert.equal(w.state.journals.filter((j) => j.referenceNumber === SIGNED_FEE_REF).length, 1)
  assert.equal((await pgRows("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'"))[0].n, 0, 'every lock released')
})

test('pg: uncertain response on a reversal — found → VERIFIED without resend; lost → POSTING_UNCERTAIN row, never re-sent', { skip: pgSkip }, async () => {
  await pgReset()
  const found = refundWorld({ sales: [refundSale20717(-300)], pool: pgPool, script: { FEE_JOURNAL: ['timeout-created'] } })
  await found.postRefund(REFUND_20717)
  assert.equal((await found.postFee()).outcome, FJ.VERIFIED)
  let [row] = await pgRows("SELECT status, attempt_count, zoho_record_id, debit_account_id, credit_account_id FROM stripe_payout_clearing_components WHERE component = 'PAYOUT_FEE_JOURNAL'")
  assert.deepEqual([row.status, row.attempt_count, row.debit_account_id, row.credit_account_id], ['VERIFIED', 1, A1013, A2270])
  assert.equal(found.posts('FEE_JOURNAL').length, 1)

  await pgReset()
  const lost = refundWorld({ sales: [refundSale20717(-300)], pool: pgPool, script: { FEE_JOURNAL: ['timeout'] } })
  await lost.postRefund(REFUND_20717)
  assert.equal((await lost.postFee()).outcome, FJ.POSTING_UNCERTAIN)
  ;[row] = await pgRows("SELECT status, attempt_count, last_error, uncertain_since, first_uncertain_at FROM stripe_payout_clearing_components WHERE component = 'PAYOUT_FEE_JOURNAL'")
  assert.deepEqual([row.status, row.attempt_count], ['POSTING_UNCERTAIN', 1])
  assert.match(row.last_error, /result is unknown.*do not repost/)
  assert.ok(row.uncertain_since && row.first_uncertain_at)
  await assert.rejects(lost.postFee(), code('FEE_JOURNAL_NOT_POSTABLE'))
  assert.equal(lost.posts('FEE_JOURNAL').length, 1)
})

const pgRow = async (table, component) => (await pgRows(`SELECT * FROM ${table} WHERE component = $1`, [component]))[0]
const pgEventTypes = async (entityType, id) => (await pgRows(
  'SELECT event_type FROM stripe_payout_clearing_events WHERE entity_type = $1 AND entity_id = $2 AND event_type IS NOT NULL ORDER BY id', [entityType, id],
)).map((e) => e.event_type)

test('pg: original bug + visibility lag — lagged credit note refund is POSTING_UNCERTAIN, retries send nothing, a later recheck verifies it', { skip: pgSkip }, async () => {
  await pgReset()
  const w = refundWorld({ sales: REFUND_FEE_SALES(), pool: pgPool, script: { CN_REFUND: ['timeout-hidden'] } })
  await w.postGroup('website')
  assert.equal((await w.postRefund(REFUND_20717)).outcome, NR.POSTING_UNCERTAIN)
  let row = await pgRow('stripe_payout_refund_components', 'REFUND_CREDIT_NOTE_REFUND')
  assert.deepEqual([row.status, row.attempt_count, row.recovery_check_count, row.request_snapshot.reference, row.request_snapshot.creditNoteId], ['POSTING_UNCERTAIN', 1, 0, `Stripe refund ${REFUND_20717}`, row.credit_note_id])
  assert.equal(row.first_uncertain_at.toISOString(), T0)

  for (const minutes of [1, 30, 24 * 60]) await assert.rejects(w.postRefund(REFUND_20717, undefined, at(minutes)), code('REFUND_NOT_POSTABLE'))
  assert.equal(w.posts('CN_REFUND').length, 1, 'zero additional POSTs')
  assert.equal(zohoRecords(w, `Stripe refund ${REFUND_20717}`), 1, 'exactly one credit note refund in Zoho')
  assert.equal((await w.preview()).status, PAYOUT_STATUS.POSTING_UNCERTAIN)

  const id = String(row.id)
  const r1 = await recheckUncertainComponent(w.payoutId, 'refund-component', id, { actor: 'user:9' }, w.deps(at(3)))
  assert.equal(r1.outcome, 'POSTING_UNCERTAIN')
  reveal(w)
  const r2 = await recheckUncertainComponent(w.payoutId, 'refund-component', id, { actor: 'user:9' }, w.deps(at(6)))
  assert.equal(r2.outcome, 'VERIFIED')
  row = await pgRow('stripe_payout_refund_components', 'REFUND_CREDIT_NOTE_REFUND')
  assert.deepEqual([row.status, row.attempt_count, row.recovery_check_count, row.last_recovery_check_at.toISOString()], ['VERIFIED', 1, 2, at(6).now().toISOString()])
  assert.ok(row.zoho_record_id && row.verified_at)
  assert.deepEqual(await pgEventTypes('REFUND_COMPONENT', id), ['POSTING_STARTED', 'POSTING_RESPONSE_UNCERTAIN', 'RECOVERY_STILL_MISSING', 'RECOVERY_STILL_MISSING', 'RECOVERY_MATCH_FOUND'])
  const [match] = await pgRows("SELECT evidence, actor FROM stripe_payout_clearing_events WHERE event_type = 'RECOVERY_MATCH_FOUND'")
  assert.deepEqual([match.evidence.state, match.evidence.recordId, match.actor], ['VERIFIED', row.zoho_record_id, 'user:9'])
  assert.equal(w.posts('CN_REFUND').length, 1, 'POST count exactly 1')

  // The rest of the refund and the payout then clear normally.
  const done = await clearEverything(w)
  assert.equal(done.status, PAYOUT_STATUS.FULLY_CLEARED)
  assert.equal(w.posts('CN_REFUND').length, 1)
})

test('pg: manual retry — not created, rechecked, admin confirms (audited), then one POST verifies', { skip: pgSkip }, async () => {
  await pgReset()
  const w = refundWorld({ sales: [refundSale20717(-300)], pool: pgPool, script: { FEE_JOURNAL: ['timeout'] } })
  await w.postRefund(REFUND_20717)
  await w.postFee()
  const id = String((await pgRow('stripe_payout_clearing_components', 'PAYOUT_FEE_JOURNAL')).id)
  const verification = (minutes) => ({ checkedAt: at(minutes).now().toISOString(), zohoLocation: 'Zoho Books > Manual Journals', searchedFor: SIGNED_FEE_REF, recordsFound: 0 })
  const confirm = (minutes, extra = {}) => confirmUncertainNotCreated(w.payoutId, 'component', id, { actor: 'user:9', reason: 'Checked Zoho journals for the reference: none.', acknowledged: true, verification: verification(minutes), ...extra }, w.deps(at(minutes)))
  await assert.rejects(confirm(20), code('RECHECK_REQUIRED'))
  await recheckUncertainComponent(w.payoutId, 'component', id, { actor: 'user:9' }, w.deps(at(1)))
  await assert.rejects(w.postFee(), code('FEE_JOURNAL_NOT_POSTABLE'))
  await assert.rejects(confirm(10), code('SETTLE_WINDOW_OPEN'))
  const out = await confirm(15)
  assert.deepEqual([out.outcome, out.component.retryAllowed], ['FAILED', true])
  let row = await pgRow('stripe_payout_clearing_components', 'PAYOUT_FEE_JOURNAL')
  assert.deepEqual([row.status, row.retry_authorized_by, row.retry_authorized_at.toISOString(), row.retry_authorization_reason], ['FAILED', 'user:9', at(15).now().toISOString(), 'Checked Zoho journals for the reference: none.'])
  assert.deepEqual(row.retry_authorization_evidence.adminVerification, verification(15))
  assert.deepEqual([row.retry_authorization_evidence.serverLookup.complete, row.retry_authorization_evidence.serverLookup.state], [true, 'MISSING'])
  assert.equal(w.posts('FEE_JOURNAL').length, 1)

  assert.equal((await w.postFee()).outcome, FJ.VERIFIED)
  row = await pgRow('stripe_payout_clearing_components', 'PAYOUT_FEE_JOURNAL')
  assert.deepEqual([row.status, row.attempt_count], ['VERIFIED', 2])
  assert.equal(w.posts('FEE_JOURNAL').length, 2)
  assert.equal(w.state.journals.filter((j) => j.referenceNumber === SIGNED_FEE_REF).length, 1)
  assert.deepEqual(await pgEventTypes('COMPONENT', id), [
    'POSTING_STARTED', 'POSTING_RESPONSE_UNCERTAIN', 'RECOVERY_STILL_MISSING', 'RECOVERY_STILL_MISSING',
    'ADMIN_CONFIRMED_NOT_CREATED', 'RETRY_ALLOWED', 'POSTING_RETRIED', 'VERIFIED',
  ])
  const [allowed] = await pgRows("SELECT from_status, to_status, actor, evidence FROM stripe_payout_clearing_events WHERE event_type = 'RETRY_ALLOWED'")
  assert.deepEqual([allowed.from_status, allowed.to_status, allowed.actor, allowed.evidence.acknowledged, allowed.evidence.serverLookup.state], ['POSTING_UNCERTAIN', 'FAILED', 'user:9', true, 'MISSING'])
  assert.deepEqual(allowed.evidence, row.retry_authorization_evidence)
  assertCleared(w, await w.preview(), -300)
})

test('pg: concurrency — rechecks, posts and confirmations racing on one uncertain payout send nothing and authorize at most once', { skip: pgSkip }, async () => {
  let lockRefusals = 0
  for (let round = 0; round < 5; round++) {
    await pgReset()
    const w = refundWorld({ pool: pgPool, script: { CN_REFUND: ['timeout-hidden'] } })
    await w.postRefund(REFUND_20717)
    const id = String((await pgRow('stripe_payout_refund_components', 'REFUND_CREDIT_NOTE_REFUND')).id)
    const racers = [
      ...Array.from({ length: 3 }, () => recheckUncertainComponent(w.payoutId, 'refund-component', id, { actor: 'user:9' }, w.deps(at(1)))),
      ...Array.from({ length: 3 }, () => w.postRefund(REFUND_20717, undefined, at(1))),
    ]
    const settled = await Promise.allSettled(racers)
    const refused = settled.filter((x) => x.status === 'rejected').map((x) => x.reason.code)
    assert.ok(refused.every((c) => ['PAYOUT_POSTING_IN_PROGRESS', 'REFUND_NOT_POSTABLE'].includes(c)), refused.join(','))
    lockRefusals += refused.filter((c) => c === 'PAYOUT_POSTING_IN_PROGRESS').length
    assert.equal(w.posts('CN_REFUND').length, 1, `round ${round}: zero additional POSTs`)
    const row = await pgRow('stripe_payout_refund_components', 'REFUND_CREDIT_NOTE_REFUND')
    const rechecks = settled.slice(0, 3).filter((x) => x.status === 'fulfilled').length
    assert.deepEqual([row.status, row.recovery_check_count], ['POSTING_UNCERTAIN', rechecks])

    // Two admins confirming at once: exactly one authorization, still no POST.
    const confirms = await Promise.allSettled([0, 1].map(() => confirmUncertainNotCreated(
      w.payoutId, 'refund-component', id,
      {
        actor: 'user:9',
        reason: 'Checked the credit note refunds: none.',
        acknowledged: true,
        verification: { checkedAt: at(20).now().toISOString(), zohoLocation: 'Credit note 20717 > Refunds', searchedFor: `Stripe refund ${REFUND_20717}`, recordsFound: 0 },
      },
      w.deps(at(20)),
    )))
    const confirmErrors = confirms.filter((x) => x.status === 'rejected').map((x) => x.reason.code)
    assert.ok(confirmErrors.every((c) => ['PAYOUT_POSTING_IN_PROGRESS', 'RECHECK_REQUIRED', 'COMPONENT_NOT_UNCERTAIN'].includes(c)), confirmErrors.join(','))
    const authorized = (await pgRows("SELECT count(*)::int AS n FROM stripe_payout_clearing_events WHERE event_type = 'RETRY_ALLOWED'"))[0].n
    const rows = await pgRow('stripe_payout_refund_components', 'REFUND_CREDIT_NOTE_REFUND')
    if (rechecks === 0) {
      assert.equal(authorized, 0)
      assert.ok(confirms.every((x) => x.status === 'rejected'))
    } else {
      // Still hidden, so a confirmation that runs finds nothing and authorizes one retry.
      assert.ok(authorized <= 1, `round ${round}: ${authorized} authorizations`)
      assert.equal(rows.status, authorized === 1 ? 'FAILED' : 'POSTING_UNCERTAIN')
    }
    assert.equal(w.posts('CN_REFUND').length, 1)
  }
  assert.ok(lockRefusals > 0, 'the advisory lock refused concurrent requests')
})
