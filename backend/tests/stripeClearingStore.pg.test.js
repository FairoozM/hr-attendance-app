/**
 * Real PostgreSQL checks for the Stripe clearing store: locks, unique claims and
 * guarded transitions. Runs only against a disposable database:
 *   STRIPE_CLEARING_TEST_DATABASE_URL=postgres://…/scratch node --test tests/stripeClearingStore.pg.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { Pool } = require('pg')
const store = require('../src/services/stripeClearing/stripeClearingStore')

const url = process.env.STRIPE_CLEARING_TEST_DATABASE_URL
const skip = url ? false : 'STRIPE_CLEARING_TEST_DATABASE_URL not set'

function fields(overrides = {}) {
  return {
    stripePaymentIntentId: 'pi_TESTINTENT0001',
    stripeChargeId: 'ch_1',
    stripeLivemode: true,
    websiteOrderId: '10700',
    websiteOrderNumber: '21152',
    zohoInvoiceId: 'Z1',
    zohoInvoiceNumber: 'INV-044276',
    zohoCustomerId: 'WEB',
    zohoAccountId: 'ACC-1019',
    amount: 664.99,
    currency: 'AED',
    paymentDate: '2026-09-26',
    stripeCreatedAt: '2026-09-25T20:00:00.000Z',
    ...overrides,
  }
}

let pool
test.before(async () => {
  if (skip) return
  pool = new Pool({ connectionString: url, max: 6 })
  await pool.query('DROP TABLE IF EXISTS stripe_payment_clearing_events, stripe_payment_clearings')
  await store.ensureStripeClearingTables((sql, params) => pool.query(sql, params))
  await store.ensureStripeClearingTables((sql, params) => pool.query(sql, params))
})
test.after(async () => {
  if (pool) await pool.end()
})

test('advisory lock admits one holder per PaymentIntent', { skip }, async () => {
  const a = await store.acquireIntentLock(pool, 'pi_LOCKTEST0001')
  await assert.rejects(store.acquireIntentLock(pool, 'pi_LOCKTEST0001'), (err) => err.code === 'CLEARING_IN_PROGRESS')
  const other = await store.acquireIntentLock(pool, 'pi_LOCKTEST0002')
  await other.release()
  await a.release()
  const b = await store.acquireIntentLock(pool, 'pi_LOCKTEST0001')
  await b.release()
})

test('claim, unique invoice, guarded transitions and history', { skip }, async () => {
  const db = { query: (sql, params) => pool.query(sql, params) }
  const client = await pool.connect()
  try {
    const first = await store.claimForPosting(client, fields(), 'user:1')
    assert.equal(first.claimed, true)
    assert.equal(first.row.status, 'POSTING')
    assert.equal(first.row.attemptCount, 1)

    const again = await store.claimForPosting(client, fields(), 'user:1')
    assert.equal(again.claimed, false)
    assert.equal(again.conflict, 'STATUS_POSTING')

    const otherIntent = await store.claimForPosting(client, fields({ stripePaymentIntentId: 'pi_TESTINTENT0002' }), 'user:1')
    assert.equal(otherIntent.claimed, false)
    assert.equal(otherIntent.conflict, 'INVOICE_CLAIMED')

    await assert.rejects(
      store.transition(client, first.row.id, ['POSTING'], 'POSTED', {}, 'no payment id'),
      (err) => err.code === '23514',
    )
    await assert.rejects(
      store.transition(client, first.row.id, ['READY'], 'FAILED', { lastError: 'x' }),
      (err) => err.code === 'CLEARING_STATE_CONFLICT',
    )

    const failed = await store.transition(client, first.row.id, ['POSTING'], 'FAILED', { lastError: 'Zoho said no' }, null, 'user:1')
    assert.equal(failed.lastError, 'Zoho said no')
    const retry = await store.claimForPosting(client, fields(), 'user:1')
    assert.equal(retry.claimed, true)
    assert.equal(retry.row.attemptCount, 2)
    const posted = await store.transition(client, first.row.id, ['POSTING'], 'POSTED', { zohoPaymentId: 'ZP-1', postedAt: new Date().toISOString() }, 'ok', 'user:1')
    assert.equal(posted.status, 'POSTED')
    assert.equal(posted.zohoPaymentId, 'ZP-1')
    assert.equal(posted.lastError, 'Zoho said no')

    const history = await store.listEvents(db, first.row.id)
    assert.deepEqual(history.map((e) => e.toStatus), ['READY', 'POSTING', 'FAILED', 'POSTING', 'POSTED'])

    const map = await store.getByIntents(db, ['pi_TESTINTENT0001', 'pi_missing'])
    assert.equal(map.get('pi_TESTINTENT0001').status, 'POSTED')
    assert.equal(map.has('pi_missing'), false)
  } finally {
    client.release()
  }
})

test('two connections claiming the same PaymentIntent at once: exactly one wins', { skip }, async () => {
  const f = fields({ stripePaymentIntentId: 'pi_RACEINTENT0001', zohoInvoiceId: 'Z-RACE', zohoInvoiceNumber: 'INV-RACE' })
  const [c1, c2] = [await pool.connect(), await pool.connect()]
  try {
    const results = await Promise.all([store.claimForPosting(c1, f, 'a'), store.claimForPosting(c2, f, 'b')])
    assert.equal(results.filter((r) => r.claimed).length, 1)
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM stripe_payment_clearings WHERE stripe_payment_intent_id = $1', [f.stripePaymentIntentId])
    assert.equal(rows[0].n, 1)
  } finally {
    c1.release()
    c2.release()
  }
})
