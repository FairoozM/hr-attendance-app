const test = require('node:test')
const assert = require('node:assert/strict')
const realStripeConfig = require('../src/config/stripe')
const { buildCustomerPaymentPayload } = require('../src/services/amazonPaymentClearingZohoPaymentService')
const { postStripeClearing, previewStripeClearing, postErrorKind } = require('../src/services/stripeClearing/stripeClearingPostingService')
const { CLEARING_STATUS, RETRYABLE } = require('../src/services/stripeClearing/stripeClearingStore')

const PI = 'pi_3UK1PQDJogiiRoKP0abcdef1'
const ACCOUNT = { accountId: 'ACC-1019', accountName: 'Stripe Undeposited Funds', accountCode: '1019', accountType: 'cash', isActive: true }

const CONFIG = {
  websiteZohoCustomerId: 'WEB',
  shopZohoCustomerId: 'SHOP',
  websiteCurrency: 'AED',
  amountTolerance: 0.01,
  maxRangeDays: 7,
  maxRows: 100,
  defaultRows: 50,
  timezoneOffset: '+04:00',
  postingEnabled: true,
  paymentMode: 'Stripe',
  depositAccountName: 'Stripe Undeposited Funds',
  depositAccountCode: '1019',
  depositAccountId: '',
}

function liveStripeConfig(overrides = {}) {
  return {
    ...realStripeConfig,
    getSecretKey: () => 'sk_live_FAKEKEYFORTESTS000',
    getMode: () => 'live',
    ...overrides,
  }
}

function clearingError(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

/** In-memory stand-in with the same rules as stripeClearingStore. */
function memoryStore() {
  const rows = new Map()
  const events = []
  const locks = new Set()
  let seq = 0
  const copy = (row) => (row ? { ...row } : null)
  const byId = (id) => [...rows.values()].find((r) => r.id === id)
  return {
    rows,
    events,
    locks,
    failNextPostedTransition: false,
    async acquireIntentLock(_pool, pi) {
      if (locks.has(pi)) throw clearingError(409, 'CLEARING_IN_PROGRESS', `Another request is already clearing ${pi}.`)
      locks.add(pi)
      return { db: {}, release: async () => { locks.delete(pi) } }
    },
    async getByIntent(_db, pi) {
      return copy(rows.get(pi))
    },
    async listEvents(_db, id) {
      return events.filter((e) => e.clearingId === id)
    },
    async claimForPosting(_db, fields, actor) {
      const current = rows.get(fields.stripePaymentIntentId)
      if (current && !RETRYABLE.includes(current.status)) return { claimed: false, row: copy(current), conflict: `STATUS_${current.status}` }
      const owner = [...rows.values()].find((r) => r.zohoInvoiceId === fields.zohoInvoiceId && r.stripePaymentIntentId !== fields.stripePaymentIntentId)
      if (owner) return { claimed: false, row: copy(owner), conflict: 'INVOICE_CLAIMED' }
      let row = current
      if (!row) {
        seq += 1
        row = { id: String(seq), ...fields, status: CLEARING_STATUS.READY, attemptCount: 0, zohoPaymentId: null, lastError: null, postedAt: null, createdBy: actor }
        rows.set(fields.stripePaymentIntentId, row)
        events.push({ clearingId: row.id, fromStatus: null, toStatus: 'READY' })
      }
      const from = row.status
      Object.assign(row, fields, { status: CLEARING_STATUS.POSTING, attemptCount: row.attemptCount + 1 })
      events.push({ clearingId: row.id, fromStatus: from, toStatus: 'POSTING' })
      return { claimed: true, row: copy(row) }
    },
    async transition(_db, id, fromStatuses, toStatus, patch = {}, detail) {
      const row = byId(id)
      if (!row || !fromStatuses.includes(row.status)) throw clearingError(409, 'CLEARING_STATE_CONFLICT', 'state conflict')
      if (toStatus === CLEARING_STATUS.POSTED && this.failNextPostedTransition) {
        this.failNextPostedTransition = false
        throw new Error('connection terminated')
      }
      const from = row.status
      row.status = toStatus
      if (patch.zohoPaymentId) row.zohoPaymentId = patch.zohoPaymentId
      if (patch.lastError) row.lastError = patch.lastError
      if (patch.postedAt) row.postedAt = patch.postedAt
      events.push({ clearingId: id, fromStatus: from, toStatus, detail })
      return copy(row)
    },
    async recordExistingPosted(_db, fields, zohoPaymentId, postedAt, detail) {
      const current = rows.get(fields.stripePaymentIntentId)
      if (current && !RETRYABLE.includes(current.status)) return { recorded: false, row: copy(current), conflict: `STATUS_${current.status}` }
      seq += 1
      const row = { id: current ? current.id : String(seq), ...fields, status: CLEARING_STATUS.POSTED, zohoPaymentId, postedAt, attemptCount: 0, lastError: null }
      rows.set(fields.stripePaymentIntentId, row)
      events.push({ clearingId: row.id, fromStatus: current ? current.status : null, toStatus: 'POSTED', detail })
      return { recorded: true, row: copy(row) }
    },
  }
}

/**
 * Fake Stripe, website and Zoho. Zoho keeps real state: a created payment
 * reduces the invoice balance and becomes findable by reference.
 */
function setup(over = {}) {
  const calls = { posts: [], refLookups: 0, invoiceFetches: 0 }
  const stripe = over.stripe === null ? null : {
    paymentIntentId: PI,
    chargeId: 'ch_1',
    status: 'succeeded',
    amount: 664.99,
    amountReceived: 664.99,
    amountRefunded: 0,
    disputed: false,
    currency: 'AED',
    date: '2026-09-25T20:00:00.000Z',
    succeededAt: '2026-09-25T21:30:00.000Z',
    livemode: true,
    ...over.stripe,
  }
  const order = {
    orderId: '10700',
    orderNumber: '21152',
    orderStatus: 'confirmed',
    paymentStatus: 'completed',
    paymentMethod: 'card',
    stripePaymentIntentId: PI,
    shopOrder: false,
    finalAmount: 664.99,
    refundAmount: 0,
    walletRedeemed: 0,
    deleted: false,
    sameNumberCount: 0,
    currency: 'AED',
    ...over.order,
  }
  const zoho = {
    invoice: { invoiceId: 'Z1', invoiceNumber: 'INV-044276', referenceNumber: '21152', customerId: 'WEB', status: 'sent', total: 664.99, balance: 664.99, currencyCode: 'AED', ...over.invoice },
    payments: [...(over.zohoPayments || [])],
  }
  let paymentSeq = 0
  const createPayment = (payload) => {
    paymentSeq += 1
    const p = {
      payment_id: `ZP-${paymentSeq}`,
      reference_number: payload.reference_number,
      amount: payload.amount,
      customer_id: payload.customer_id,
      account_id: payload.account_id,
      date: payload.date,
      invoices: payload.invoices.map((i) => ({ invoice_id: i.invoice_id, amount_applied: i.amount_applied })),
    }
    zoho.payments.push(p)
    if (!over.balanceNotReduced) {
      zoho.invoice.balance = Math.round((zoho.invoice.balance - payload.amount) * 100) / 100
      if (zoho.invoice.balance <= 0.01) zoho.invoice.status = 'paid'
    }
    return p
  }
  const sources = {
    stripeAvailable: () => over.stripeAvailable !== false,
    retrieveStripePaymentIntent: async () => {
      if (over.stripeError) throw over.stripeError
      return stripe
    },
    loadWebsiteOrdersByIntents: async () => [order],
    findZohoInvoicesByReference: async () => [{ ...zoho.invoice }],
    fetchZohoInvoiceById: async () => {
      calls.invoiceFetches += 1
      if (over.onInvoiceFetch) over.onInvoiceFetch(zoho, calls.invoiceFetches)
      return { ...zoho.invoice }
    },
    findZohoPaymentsByReference: async (ref) => {
      calls.refLookups += 1
      return zoho.payments
        .filter((p) => p.reference_number === ref)
        .map((p) => ({ paymentId: p.payment_id, referenceNumber: p.reference_number, amount: p.amount, invoiceNumbers: 'INV-044276' }))
    },
  }
  const zohoPayments = {
    listZohoChartAccounts: async () => over.accounts || [ACCOUNT, { ...ACCOUNT, accountId: 'ACC-OTHER', accountName: 'Undeposited Funds', accountCode: '1015' }],
    buildCustomerPaymentPayload,
    createZohoCustomerPayment: async (payment, opts) => {
      const payload = buildCustomerPaymentPayload(payment, { depositToAccountId: payment.depositToAccountId })
      calls.posts.push({ payload, opts })
      if (over.beforePost) await over.beforePost()
      if (over.postBehaviour === 'reject') throw Object.assign(new Error('Zoho API HTTP 400: invalid account'), { code: 'ZOHO_API_ERROR', httpStatus: 400 })
      if (over.postBehaviour === 'timeout-created') {
        createPayment(payload)
        throw Object.assign(new Error('Zoho API timeout'), { code: 'ZOHO_API_TIMEOUT' })
      }
      if (over.postBehaviour === 'timeout-not-created') throw Object.assign(new Error('Zoho API timeout'), { code: 'ZOHO_API_TIMEOUT' })
      const p = createPayment(payload)
      return { zohoPaymentId: p.payment_id }
    },
    getZohoCustomerPayment: async (id) => zoho.payments.find((p) => p.payment_id === id) || null,
  }
  const store = over.store || memoryStore()
  const deps = {
    config: { ...CONFIG, ...over.config },
    stripeConfig: over.stripeConfig || liveStripeConfig(),
    sources,
    store,
    zohoPayments,
    pool: {},
    queryDb: {},
    now: () => new Date('2026-09-27T12:00:00.000Z'),
  }
  return { deps, calls, zoho, store }
}

async function rejects(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`)
    return true
  })
}

test('1/14: MATCHED_READY_TO_CLEAR posts once with the exact payload and records the Zoho payment ID', async () => {
  const { deps, calls, zoho, store } = setup()
  const out = await postStripeClearing(PI, { actor: 'user:1' }, deps)
  assert.equal(out.outcome, 'POSTED')
  assert.equal(out.clearing.status, 'POSTED')
  assert.equal(out.clearing.zohoPaymentId, 'ZP-1')
  assert.equal(out.invoiceBalanceBefore, 664.99)
  assert.equal(out.invoiceBalanceAfter, 0)
  assert.equal(calls.posts.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(calls.posts[0].payload)), {
    customer_id: 'WEB',
    payment_mode: 'Stripe',
    amount: 664.99,
    // Dated on the server's Asia/Dubai posting day (12:00 UTC = 16:00 Dubai), not the charge day.
    date: '2026-09-27',
    reference_number: PI,
    account_id: 'ACC-1019',
    invoices: [{ invoice_id: 'Z1', amount_applied: 664.99 }],
  })
  assert.equal(calls.posts[0].opts.retryTransport, false)
  assert.equal(zoho.invoice.status, 'paid')
  const row = store.rows.get(PI)
  assert.equal(row.status, 'POSTED')
  assert.equal(row.zohoPaymentId, 'ZP-1')
  assert.deepEqual(store.events.map((e) => e.toStatus), ['READY', 'POSTING', 'POSTED'])
})

test('shop orders post to the shop customer', async () => {
  const { deps, calls } = setup({ order: { shopOrder: true }, invoice: { customerId: 'SHOP' } })
  await postStripeClearing(PI, {}, deps)
  assert.equal(calls.posts[0].payload.customer_id, 'SHOP')
})

test('2: STRIPE_NOT_VERIFIED can never post', async () => {
  const noKey = setup({ stripeConfig: liveStripeConfig({ getSecretKey: () => '' }) })
  await rejects(postStripeClearing(PI, {}, noKey.deps), 'STRIPE_NOT_CONFIGURED')
  assert.equal(noKey.calls.posts.length, 0)

  const noClient = setup({ stripeAvailable: false })
  await rejects(postStripeClearing(PI, {}, noClient.deps), 'STRIPE_NOT_CONFIGURED')
  assert.equal(noClient.calls.posts.length, 0)

  const missing = setup({ stripe: null })
  await rejects(postStripeClearing(PI, {}, missing.deps), 'STRIPE_PAYMENT_INTENT_NOT_FOUND')
  assert.equal(missing.calls.posts.length, 0)

  const down = setup({ stripeError: new Error('connect ECONNREFUSED') })
  await rejects(postStripeClearing(PI, {}, down.deps), 'STRIPE_UNAVAILABLE')
  assert.equal(down.calls.posts.length, 0)
})

for (const [label, over, matchStatus] of [
  ['3: amount mismatch', { stripe: { amountReceived: 600 } }, 'AMOUNT_MISMATCH'],
  ['4: refunded payment', { stripe: { amountRefunded: 664.99 } }, 'REFUNDED'],
  ['5: partial refund', { stripe: { amountRefunded: 50 } }, 'PARTIALLY_REFUNDED'],
  ['5b: partially returned order', { order: { orderStatus: 'partiallyReturned' } }, 'PARTIALLY_REFUNDED'],
  ['6: cancelled website order', { order: { orderStatus: 'cancelled' } }, 'NEEDS_REVIEW'],
  ['7: wrong Zoho customer', { invoice: { customerId: 'SHOP' } }, 'NEEDS_REVIEW'],
  ['8: invoice already paid', { invoice: { status: 'paid', balance: 0 } }, 'ALREADY_CLEARED'],
  ['Stripe not succeeded', { stripe: { status: 'processing' } }, 'STRIPE_NOT_SUCCEEDED'],
  ['disputed charge', { stripe: { disputed: true } }, 'NEEDS_REVIEW'],
  ['partly paid invoice', { invoice: { balance: 300 } }, 'ZOHO_BALANCE_MISMATCH'],
]) {
  test(`${label} cannot post`, async () => {
    const { deps, calls, store } = setup(over)
    await assert.rejects(postStripeClearing(PI, {}, deps), (err) => {
      assert.equal(err.code, 'NOT_ELIGIBLE')
      assert.equal(err.matchStatus, matchStatus)
      return true
    })
    assert.equal(calls.posts.length, 0)
    assert.equal(store.rows.size, 0)
  })
}

test('invoice changes between the match and the post are caught by the re-fetch', async () => {
  for (const [change, code] of [
    [(z) => { z.invoice.status = 'paid'; z.invoice.balance = 0 }, 'ZOHO_INVOICE_ALREADY_PAID'],
    [(z) => { z.invoice.balance = 400 }, 'ZOHO_INVOICE_BALANCE_CHANGED'],
    [(z) => { z.invoice.customerId = 'OTHER' }, 'ZOHO_INVOICE_CUSTOMER_CHANGED'],
    [(z) => { z.invoice.status = 'void' }, 'ZOHO_INVOICE_VOID'],
  ]) {
    const { deps, calls } = setup({ onInvoiceFetch: (z, n) => { if (n === 1) change(z) } })
    await rejects(postStripeClearing(PI, {}, deps), code)
    assert.equal(calls.posts.length, 0)
  }
})

test('9: an existing Zoho payment with the PaymentIntent reference prevents a duplicate', async () => {
  const stray = { payment_id: 'ZP-OLD', reference_number: PI, amount: 664.99, customer_id: 'WEB', account_id: 'ACC-1019', invoices: [{ invoice_id: 'Z9', amount_applied: 664.99 }] }
  const open = setup({ zohoPayments: [stray] })
  await assert.rejects(postStripeClearing(PI, {}, open.deps), (err) => err.code === 'NOT_ELIGIBLE' && err.matchStatus === 'ALREADY_CLEARED')
  assert.equal(open.calls.posts.length, 0)

  // Reference appears only between the live match and the post.
  const race = setup()
  let lookups = 0
  const find = race.deps.sources.findZohoPaymentsByReference
  race.deps.sources.findZohoPaymentsByReference = async (ref, o) => {
    lookups += 1
    if (lookups === 2) race.zoho.payments.push(stray)
    return find(ref, o)
  }
  await rejects(postStripeClearing(PI, {}, race.deps), 'DUPLICATE_ZOHO_REFERENCE')
  assert.equal(race.calls.posts.length, 0)
})

test('9b: a paid invoice whose payment carries the reference is recorded, not re-posted', async () => {
  const existing = { payment_id: 'ZP-MANUAL', reference_number: PI, amount: 664.99, customer_id: 'WEB', account_id: 'ACC-1019', date: '2026-09-26', invoices: [{ invoice_id: 'Z1', amount_applied: 664.99 }] }
  const { deps, calls, store } = setup({ invoice: { status: 'paid', balance: 0 }, zohoPayments: [existing] })
  const out = await postStripeClearing(PI, {}, deps)
  assert.equal(out.outcome, 'ALREADY_CLEARED_RECORDED')
  assert.equal(out.clearing.zohoPaymentId, 'ZP-MANUAL')
  assert.equal(calls.posts.length, 0)
  assert.equal(store.rows.get(PI).status, 'POSTED')
})

test('10: a local POSTED record prevents a duplicate without touching Zoho', async () => {
  const { deps, calls } = setup()
  await postStripeClearing(PI, {}, deps)
  const lookupsAfterFirst = calls.refLookups
  const again = await postStripeClearing(PI, {}, deps)
  assert.equal(again.outcome, 'ALREADY_POSTED')
  assert.equal(calls.posts.length, 1)
  assert.equal(calls.refLookups, lookupsAfterFirst)
})

test('10b: an invoice already linked to another PaymentIntent is refused', async () => {
  const { deps, calls, store } = setup()
  store.rows.set('pi_OTHERINTENT000', { id: '99', stripePaymentIntentId: 'pi_OTHERINTENT000', zohoInvoiceId: 'Z1', status: 'FAILED', attemptCount: 1 })
  await rejects(postStripeClearing(PI, {}, deps), 'DUPLICATE_ZOHO_INVOICE_CLAIM')
  assert.equal(calls.posts.length, 0)
})

test('11: a concurrent attempt for the same PaymentIntent is blocked', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { deps, calls } = setup({ beforePost: () => gate })
  const first = postStripeClearing(PI, {}, deps)
  while (calls.posts.length === 0) await new Promise((r) => setImmediate(r))
  await rejects(postStripeClearing(PI, {}, deps), 'CLEARING_IN_PROGRESS')
  release()
  assert.equal((await first).outcome, 'POSTED')
  assert.equal(calls.posts.length, 1)
})

test('12: a missing Stripe Undeposited Funds account blocks posting', async () => {
  const missing = setup({ accounts: [{ ...ACCOUNT, accountName: 'Undeposited Funds', accountCode: '1015' }] })
  await rejects(postStripeClearing(PI, {}, missing.deps), 'STRIPE_DEPOSIT_ACCOUNT_MISSING')
  assert.equal(missing.calls.posts.length, 0)
  assert.equal(missing.store.locks.size, 0)

  const wrongCode = setup({ accounts: [{ ...ACCOUNT, accountCode: '9999' }] })
  await rejects(postStripeClearing(PI, {}, wrongCode.deps), 'STRIPE_DEPOSIT_ACCOUNT_CODE_MISMATCH')

  const pinned = setup({ config: { depositAccountId: 'ACC-ELSEWHERE' } })
  await rejects(postStripeClearing(PI, {}, pinned.deps), 'STRIPE_DEPOSIT_ACCOUNT_ID_MISMATCH')
})

test('13: test-mode Stripe can never clear production Zoho', async () => {
  const testMode = setup({ stripeConfig: liveStripeConfig({ getMode: () => 'test', getSecretKey: () => 'sk_test_FAKEKEY0000' }) })
  await rejects(postStripeClearing(PI, {}, testMode.deps), 'STRIPE_NOT_LIVE')

  const mixed = setup({ stripeConfig: liveStripeConfig({ getSecretKey: () => 'sk_test_FAKEKEY0000' }) })
  await rejects(postStripeClearing(PI, {}, mixed.deps), 'STRIPE_NOT_LIVE')

  const testPayment = setup({ stripe: { livemode: false } })
  await rejects(postStripeClearing(PI, {}, testPayment.deps), 'STRIPE_TEST_MODE_PAYMENT')

  const switchedOff = setup({ config: { postingEnabled: false } })
  await rejects(postStripeClearing(PI, {}, switchedOff.deps), 'STRIPE_CLEARING_POSTING_DISABLED')

  for (const s of [testMode, mixed, testPayment, switchedOff]) assert.equal(s.calls.posts.length, 0)
})

test('posting is off unless STRIPE_CLEARING_POSTING_ENABLED is exactly true', () => {
  const { getStripeClearingConfig } = require('../src/config/stripeClearing')
  const saved = process.env.STRIPE_CLEARING_POSTING_ENABLED
  try {
    for (const value of [undefined, '', 'false', 'FALSE', '0', '1', 'yes', 'on', 'enabled', 'true1']) {
      if (value === undefined) delete process.env.STRIPE_CLEARING_POSTING_ENABLED
      else process.env.STRIPE_CLEARING_POSTING_ENABLED = value
      assert.equal(getStripeClearingConfig().postingEnabled, false, `value ${value}`)
    }
    process.env.STRIPE_CLEARING_POSTING_ENABLED = 'true'
    assert.equal(getStripeClearingConfig().postingEnabled, true)
  } finally {
    if (saved === undefined) delete process.env.STRIPE_CLEARING_POSTING_ENABLED
    else process.env.STRIPE_CLEARING_POSTING_ENABLED = saved
  }
})

test('restricted live keys are live; restricted test keys are not', () => {
  const { postingGate } = require('../src/services/stripeClearing/stripeClearingGate')
  const enabled = { postingEnabled: true }
  assert.equal(realStripeConfig.keyMode('rk_live_FAKE0000'), 'live')
  assert.equal(realStripeConfig.keyMode('rk_test_FAKE0000'), 'test')
  assert.equal(postingGate(enabled, liveStripeConfig({ getSecretKey: () => 'rk_live_FAKE0000' })).allowed, true)
  assert.equal(postingGate(enabled, liveStripeConfig({ getSecretKey: () => 'rk_test_FAKE0000' })).reasons[0].code, 'STRIPE_NOT_LIVE')
  const off = postingGate({ postingEnabled: false }, liveStripeConfig({ getSecretKey: () => 'rk_live_FAKE0000' }))
  assert.equal(off.allowed, false)
  assert.equal(off.reasons[0].code, 'STRIPE_CLEARING_POSTING_DISABLED')
})

test('15: an ambiguous POST is recovered by reference, never re-posted', async () => {
  const lost = setup({ postBehaviour: 'timeout-created' })
  const out = await postStripeClearing(PI, {}, lost.deps)
  assert.equal(out.outcome, 'RECOVERED')
  assert.equal(out.clearing.status, 'POSTED')
  assert.equal(out.clearing.zohoPaymentId, 'ZP-1')
  assert.equal(lost.calls.posts.length, 1)
})

test('15b: an ambiguous POST with no payment found becomes FAILED_NEEDS_REVIEW and stays unposted', async () => {
  const { deps, calls, store } = setup({ postBehaviour: 'timeout-not-created' })
  await rejects(postStripeClearing(PI, {}, deps), 'ZOHO_POST_AMBIGUOUS')
  assert.equal(store.rows.get(PI).status, 'FAILED_NEEDS_REVIEW')
  assert.match(store.rows.get(PI).lastError, /timeout/)
  await rejects(postStripeClearing(PI, {}, deps), 'ZOHO_POST_AMBIGUOUS')
  assert.equal(calls.posts.length, 1)
})

test('a definite Zoho rejection is FAILED with its reason and may be retried after full re-validation', async () => {
  const over = { postBehaviour: 'reject' }
  const s = setup(over)
  await rejects(postStripeClearing(PI, {}, s.deps), 'ZOHO_REJECTED_PAYMENT')
  const failed = s.store.rows.get(PI)
  assert.equal(failed.status, 'FAILED')
  assert.match(failed.lastError, /invalid account/)

  over.postBehaviour = undefined
  const retried = await postStripeClearing(PI, {}, s.deps)
  assert.equal(retried.clearing.status, 'POSTED')
  assert.equal(retried.clearing.attemptCount, 2)
  assert.match(retried.clearing.lastError, /invalid account/)
  assert.deepEqual(s.store.events.map((e) => e.toStatus), ['READY', 'POSTING', 'FAILED', 'POSTING', 'POSTED'])
  assert.equal(postErrorKind({ code: 'ZOHO_API_TIMEOUT' }), 'ambiguous')
  assert.equal(postErrorKind({ code: 'ZOHO_API_ERROR', httpStatus: 503 }), 'ambiguous')
  assert.equal(postErrorKind({ code: 'ZOHO_DAILY_LIMIT' }), 'rejected')
})

test('verification failure after a successful POST is FAILED_NEEDS_REVIEW, not retried', async () => {
  const { deps, calls, store } = setup({ balanceNotReduced: true })
  await rejects(postStripeClearing(PI, {}, deps), 'ZOHO_PAYMENT_VERIFICATION_FAILED')
  const row = store.rows.get(PI)
  assert.equal(row.status, 'FAILED_NEEDS_REVIEW')
  assert.equal(row.zohoPaymentId, 'ZP-1')
  assert.match(row.lastError, /still has balance/)
  assert.equal(calls.posts.length, 1)
})

test('database failure after the Zoho POST is recovered by reference on the next request', async () => {
  const { deps, calls, store } = setup()
  store.failNextPostedTransition = true
  await assert.rejects(postStripeClearing(PI, {}, deps), (err) => err.code === 'LOCAL_RECORD_FAILED_AFTER_POST' && err.zohoPaymentId === 'ZP-1')
  assert.equal(store.rows.get(PI).status, 'POSTING')
  const again = await postStripeClearing(PI, {}, deps)
  assert.equal(again.outcome, 'RECOVERED')
  assert.equal(again.clearing.zohoPaymentId, 'ZP-1')
  assert.equal(calls.posts.length, 1)
})

test('preview returns the exact payload and writes nothing', async () => {
  const { deps, calls, store } = setup({ config: { postingEnabled: false } })
  const preview = await previewStripeClearing(PI, deps)
  assert.equal(preview.outcome, 'PREVIEW')
  assert.equal(preview.postingEnabled, false)
  assert.equal(preview.zohoAccount.accountName, 'Stripe Undeposited Funds')
  assert.equal(preview.zohoPayload.reference_number, PI)
  assert.equal(calls.posts.length, 0)
  assert.equal(store.rows.size, 0)
})

test('16: secrets never reach responses or logs', async () => {
  const secret = 'sk_live_51ABCDEFsecretvalue999'
  const logged = []
  const original = console.error
  console.error = (...args) => logged.push(args.join(' '))
  try {
    const { deps } = setup({ stripeError: new Error(`Invalid API Key provided: ${secret}`) })
    const err = await postStripeClearing(PI, {}, deps).catch((e) => e)
    assert.equal(err.code, 'STRIPE_UNAVAILABLE')
    assert.ok(!err.message.includes(secret))
    assert.match(err.message, /sk_live_\[redacted\]/)

    const ok = setup()
    const out = await postStripeClearing(PI, {}, ok.deps)
    assert.ok(!JSON.stringify(out).includes('sk_'))
  } finally {
    console.error = original
  }
  assert.ok(logged.every((line) => !line.includes(secret)))
})
