/**
 * Cached Stripe payout list: GET reads the database only; Reload payouts reads Stripe
 * (read-only) and replaces the cache. No Zoho, no posting.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PAYOUT_LIST_SIZE,
  getCachedPayoutList,
  refreshPayoutList,
  canReuseComposition,
} = require('../src/services/stripeClearing/stripePayoutListService')

const DAY = 24 * 60 * 60 * 1000
const NEWEST = Date.parse('2026-09-29T00:00:00.000Z')

/** Stripe-side payouts newest first: index 0 is the newest (in transit). */
function stripePayouts(count, { prefix = 'po_T', statusOf = (i) => (i === 0 ? 'in_transit' : 'paid') } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const created = new Date(NEWEST - i * DAY).toISOString()
    return {
      payoutId: `${prefix}${String(i + 1).padStart(3, '0')}`,
      status: statusOf(i),
      amountMinor: 100000 + i,
      currency: 'AED',
      arrivalDate: created,
      createdAt: created,
      automatic: true,
      livemode: true,
    }
  })
}

function txnsFor(payout) {
  // Two charges and one refund whose nets add up to the payout amount.
  const refund = { balanceTransactionId: `txn_r_${payout.payoutId}`, type: 'refund', amountMinor: -500, feeMinor: 0, netMinor: -500 }
  const chargeNet = payout.amountMinor + 500
  return [
    { balanceTransactionId: `txn_a_${payout.payoutId}`, type: 'charge', amountMinor: chargeNet - 2000 + 600, feeMinor: 600, netMinor: chargeNet - 2000 },
    { balanceTransactionId: `txn_b_${payout.payoutId}`, type: 'payment', amountMinor: 2000 + 100, feeMinor: 100, netMinor: 2000 },
    refund,
    { balanceTransactionId: `txn_p_${payout.payoutId}`, type: 'payout', amountMinor: -payout.amountMinor, feeMinor: 0, netMinor: -payout.amountMinor },
  ]
}

const ZOHO_AND_POSTING = ['findZohoInvoicesByReference', 'findZohoPaymentsByReference', 'findZohoJournalsByReference', 'fetchZohoInvoiceById', 'listZohoJournalsInRange', 'loadWebsiteOrdersByIntents']

/** Fake Stripe sources that count every call; Zoho lookups throw. */
function fakeSources(payouts) {
  const calls = { listStripePayouts: [], listPayoutBalanceTransactions: [] }
  const sources = {
    calls,
    payouts,
    async listStripePayouts({ limit }) {
      calls.listStripePayouts.push(limit)
      return this.payouts.slice(0, limit)
    },
    async listPayoutBalanceTransactions(payoutId) {
      calls.listPayoutBalanceTransactions.push(payoutId)
      return txnsFor(this.payouts.find((p) => p.payoutId === payoutId))
    },
  }
  for (const name of ZOHO_AND_POSTING) sources[name] = async () => { throw new Error(`${name} must not be called`) }
  return sources
}

/** In-memory stand-in for stripe_payout_list_cache with the same replace semantics. */
function memoryStore(initial = []) {
  const store = {
    rows: new Map(initial.map((r) => [r.payoutId, r])),
    replaceCalls: 0,
    async list() {
      return [...this.rows.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, PAYOUT_LIST_SIZE)
    },
    async replace(payouts, refreshedAt) {
      this.replaceCalls += 1
      this.rows = new Map(payouts.map((p) => [p.payoutId, { ...p, refreshedAt }]))
    },
  }
  return store
}

const noStripe = {
  async listStripePayouts() { throw new Error('Stripe must not be called') },
  async listPayoutBalanceTransactions() { throw new Error('Stripe must not be called') },
}

test('Reload payouts keeps the latest 30 payouts, newest first', async () => {
  const sources = fakeSources(stripePayouts(45))
  const store = memoryStore()
  const out = await refreshPayoutList({ sources, store })

  assert.deepEqual(sources.calls.listStripePayouts, [30])
  assert.equal(out.rows.length, 30)
  assert.equal(out.count, 30)
  assert.equal(out.maxRows, 30)
  assert.equal(out.source, 'stripe')
  assert.equal(out.rows[0].payoutId, 'po_T001')
  assert.equal(out.rows[29].payoutId, 'po_T030')
  for (let i = 1; i < out.rows.length; i++) assert.ok(out.rows[i - 1].createdAt > out.rows[i].createdAt)
  assert.equal(store.rows.size, 30)
  assert.equal(store.replaceCalls, 1)
})

test('refresh sorts newest first even if Stripe returns another order', async () => {
  const payouts = stripePayouts(5)
  const sources = fakeSources([payouts[3], payouts[0], payouts[4], payouts[1], payouts[2]])
  const out = await refreshPayoutList({ sources, store: memoryStore() })
  assert.deepEqual(out.rows.map((r) => r.payoutId), ['po_T001', 'po_T002', 'po_T003', 'po_T004', 'po_T005'])
})

test('rows carry the table summary: status, arrival, amount, charges, gross, fees and the Stripe check', async () => {
  const sources = fakeSources(stripePayouts(2))
  const out = await refreshPayoutList({ sources, store: memoryStore() })
  const row = out.rows[1]
  assert.equal(row.status, 'paid')
  assert.equal(row.amount, 1000.01)
  assert.equal(row.arrivalDate, '2026-09-28T00:00:00.000Z')
  assert.equal(row.composition.chargeCount, 2)
  assert.equal(row.composition.chargeGross, 1012.01)
  assert.equal(row.composition.chargeFee, 7)
  assert.equal(row.composition.otherCount, 1)
  assert.equal(row.composition.reconciles, true)
  assert.ok(out.refreshedAt)
})

test('the normal list read uses the cache and never calls Stripe', async () => {
  const store = memoryStore()
  await refreshPayoutList({ sources: fakeSources(stripePayouts(30)), store })

  const first = await getCachedPayoutList({ sources: noStripe, store })
  const again = await getCachedPayoutList({ sources: noStripe, store })
  assert.equal(first.source, 'cache')
  assert.equal(first.rows.length, 30)
  assert.equal(first.rows[0].payoutId, 'po_T001')
  assert.deepEqual(again, first)
})

test('an empty cache returns no rows and no refresh time, without calling Stripe', async () => {
  const out = await getCachedPayoutList({ sources: noStripe, store: memoryStore() })
  assert.deepEqual(out, { rows: [], refreshedAt: null, count: 0, maxRows: 30, source: 'cache' })
})

test('Reload payouts replaces the cache: new payouts in, payouts older than the latest 30 out', async () => {
  const store = memoryStore()
  const sources = fakeSources(stripePayouts(30))
  await refreshPayoutList({ sources, store })

  // Two new payouts arrive at the top.
  const newer = stripePayouts(2, { prefix: 'po_N' }).map((p, i) => ({ ...p, createdAt: new Date(NEWEST + (2 - i) * DAY).toISOString() }))
  sources.payouts = [...newer, ...stripePayouts(30)]
  const out = await refreshPayoutList({ sources, store })

  assert.deepEqual(out.rows.slice(0, 3).map((r) => r.payoutId), ['po_N001', 'po_N002', 'po_T001'])
  assert.equal(out.rows.length, 30)
  assert.ok(!store.rows.has('po_T029'))
  assert.ok(!store.rows.has('po_T030'))
})

test('a failed refresh leaves the previous cache untouched', async () => {
  const store = memoryStore()
  await refreshPayoutList({ sources: fakeSources(stripePayouts(30)), store })
  const before = await getCachedPayoutList({ sources: noStripe, store })

  const broken = fakeSources(stripePayouts(30, { prefix: 'po_X' }))
  broken.listPayoutBalanceTransactions = async () => { throw new Error('Stripe timeout') }
  await assert.rejects(refreshPayoutList({ sources: broken, store }), /Stripe timeout/)

  const listFails = fakeSources([])
  listFails.listStripePayouts = async () => { throw new Error('Stripe unavailable') }
  await assert.rejects(refreshPayoutList({ sources: listFails, store }), /Stripe unavailable/)

  assert.equal(store.replaceCalls, 1)
  assert.deepEqual(await getCachedPayoutList({ sources: noStripe, store }), before)
})

test('fewer than 30 payouts are cached as they are', async () => {
  const store = memoryStore()
  const out = await refreshPayoutList({ sources: fakeSources(stripePayouts(7)), store })
  assert.equal(out.rows.length, 7)
  assert.equal((await getCachedPayoutList({ store })).rows.length, 7)
})

test('an in-transit payout among the latest 30 is kept and re-read on the next refresh', async () => {
  const store = memoryStore()
  const sources = fakeSources(stripePayouts(30))
  const first = await refreshPayoutList({ sources, store })
  assert.equal(first.rows[0].status, 'in_transit')
  assert.equal(first.balanceTransactionFetches, 30)

  sources.calls.listPayoutBalanceTransactions.length = 0
  const second = await refreshPayoutList({ sources, store })
  // Paid payouts are final in Stripe: their cached composition is reused; the in-transit one is re-read.
  assert.deepEqual(sources.calls.listPayoutBalanceTransactions, ['po_T001'])
  assert.equal(second.balanceTransactionFetches, 1)
  assert.equal(second.rows[0].status, 'in_transit')
  assert.deepEqual(second.rows.map((r) => r.composition), first.rows.map((r) => r.composition))

  // Once it is paid, it is re-read one more time and then reused.
  sources.payouts = sources.payouts.map((p, i) => (i === 0 ? { ...p, status: 'paid' } : p))
  sources.calls.listPayoutBalanceTransactions.length = 0
  await refreshPayoutList({ sources, store })
  assert.deepEqual(sources.calls.listPayoutBalanceTransactions, ['po_T001'])
  sources.calls.listPayoutBalanceTransactions.length = 0
  await refreshPayoutList({ sources, store })
  assert.deepEqual(sources.calls.listPayoutBalanceTransactions, [])
})

test('a cached composition is only reused when the paid payout is unchanged and reconciled', () => {
  const payout = { payoutId: 'po_1', status: 'paid', amountMinor: 100, currency: 'AED' }
  const cached = { ...payout, composition: { reconciles: true } }
  assert.equal(canReuseComposition(cached, payout), true)
  assert.equal(canReuseComposition(undefined, payout), false)
  assert.equal(canReuseComposition(cached, { ...payout, status: 'in_transit' }), false)
  assert.equal(canReuseComposition({ ...cached, status: 'in_transit' }, payout), false)
  assert.equal(canReuseComposition(cached, { ...payout, amountMinor: 101 }), false)
  assert.equal(canReuseComposition({ ...cached, composition: { reconciles: false } }, payout), false)
})

test('concurrent Reload clicks share one Stripe refresh', async () => {
  const sources = fakeSources(stripePayouts(3))
  const store = memoryStore()
  const [a, b] = await Promise.all([refreshPayoutList({ sources, store }), refreshPayoutList({ sources, store })])
  assert.equal(sources.calls.listStripePayouts.length, 1)
  assert.equal(store.replaceCalls, 1)
  assert.deepEqual(a, b)
})

test('the list never loads posting services and never calls Zoho', async () => {
  const zoho = require('../src/services/zohoApiClient')
  const zohoCalls = []
  const originals = {}
  for (const [name, fn] of Object.entries(zoho)) {
    if (typeof fn !== 'function') continue
    originals[name] = fn
    zoho[name] = (...args) => { zohoCalls.push(name); return fn(...args) }
  }
  try {
    const store = memoryStore()
    await refreshPayoutList({ sources: fakeSources(stripePayouts(30)), store })
    await getCachedPayoutList({ store })
  } finally {
    Object.assign(zoho, originals)
  }
  assert.deepEqual(zohoCalls, [])
  const loaded = Object.keys(require.cache).map((p) => p.replace(/\\/g, '/'))
  for (const forbidden of ['stripePayoutPostingService', 'stripeClearingPostingService', 'stripePayoutClearingService']) {
    assert.ok(!loaded.some((p) => p.includes(`/${forbidden}.js`)), `${forbidden} must not be loaded by the payout list`)
  }
})
