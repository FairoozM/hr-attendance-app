/**
 * Real PostgreSQL checks for the cached Stripe payout list.
 * Runs only against a disposable database, in its own schema:
 *   STRIPE_CLEARING_TEST_DATABASE_URL=postgres://…/scratch node --test tests/stripePayoutListCacheStore.pg.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Pool } = require('pg')
const cacheStore = require('../src/services/stripeClearing/stripePayoutListCacheStore')

const url = process.env.STRIPE_CLEARING_TEST_DATABASE_URL
const skip = url ? false : 'STRIPE_CLEARING_TEST_DATABASE_URL not set'
const SCHEMA = 'stripe_payout_list_cache_test'
const DAY = 24 * 60 * 60 * 1000

function payouts(count, prefix = 'po_T') {
  return Array.from({ length: count }, (_, i) => {
    const created = new Date(Date.parse('2026-09-29T00:00:00.000Z') - i * DAY).toISOString()
    return {
      payoutId: `${prefix}${String(i + 1).padStart(3, '0')}`,
      status: i === 0 ? 'in_transit' : 'paid',
      amountMinor: 100000 + i,
      currency: 'AED',
      arrivalDate: created,
      createdAt: created,
      automatic: true,
      livemode: true,
      composition: { chargeCount: 3, chargeGross: 1030, chargeFee: 30, chargeNet: 1000, otherCount: 0, otherNet: 0, contentNet: 1000, payoutAmount: 1000, reconciles: true },
      compositionFetchedAt: '2026-09-29T07:00:00.000Z',
    }
  })
}

let pool
const newPool = () => new Pool({ connectionString: url, max: 2, options: `-c search_path=${SCHEMA}` })

async function replace(db, rows, at) {
  const client = await db.connect()
  try {
    await cacheStore.replaceCachedPayouts(client, rows, at)
  } finally {
    client.release()
  }
}

test.before(async () => {
  if (skip) return
  const admin = new Pool({ connectionString: url, max: 1 })
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await admin.query(`CREATE SCHEMA ${SCHEMA}`)
  await admin.end()
  pool = newPool()
  // The reference migration and the boot-time ensure must agree and both be re-runnable.
  await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/053_stripe_payout_list_cache.sql'), 'utf8'))
  await cacheStore.ensureStripePayoutListCacheTables((sql, params) => pool.query(sql, params))
  await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/053_stripe_payout_list_cache.sql'), 'utf8'))
})

test.after(async () => {
  if (pool) await pool.end()
})

test('an empty cache lists nothing', { skip }, async () => {
  assert.deepEqual(await cacheStore.listCachedPayouts(pool), [])
})

test('stores 30 payouts newest first and they survive a new connection pool (backend restart)', { skip }, async () => {
  await replace(pool, payouts(30), '2026-09-29T07:00:00.000Z')
  const restarted = newPool()
  try {
    const rows = await cacheStore.listCachedPayouts(restarted)
    assert.equal(rows.length, 30)
    assert.equal(rows[0].payoutId, 'po_T001')
    assert.equal(rows[0].status, 'in_transit')
    assert.equal(rows[29].payoutId, 'po_T030')
    assert.equal(rows[1].amountMinor, 100001)
    assert.equal(rows[1].arrivalDate, '2026-09-28T00:00:00.000Z')
    assert.equal(rows[1].composition.chargeCount, 3)
    assert.equal(rows[1].composition.reconciles, true)
    assert.equal(rows[1].refreshedAt, '2026-09-29T07:00:00.000Z')
  } finally {
    await restarted.end()
  }
})

test('replace drops payouts that are no longer among the latest', { skip }, async () => {
  const next = [...payouts(2, 'po_N').map((p, i) => ({ ...p, createdAt: new Date(Date.parse('2026-10-01T00:00:00Z') - i * DAY).toISOString() })), ...payouts(28)]
  await replace(pool, next, '2026-09-29T08:00:00.000Z')
  const rows = await cacheStore.listCachedPayouts(pool)
  assert.equal(rows.length, 30)
  assert.deepEqual(rows.slice(0, 3).map((r) => r.payoutId), ['po_N001', 'po_N002', 'po_T001'])
  const { rows: gone } = await pool.query("SELECT payout_id FROM stripe_payout_list_cache WHERE payout_id IN ('po_T029', 'po_T030')")
  assert.deepEqual(gone, [])
})

test('a replace that fails part-way rolls back and keeps the previous cache', { skip }, async () => {
  const before = await cacheStore.listCachedPayouts(pool)
  const bad = [...payouts(5, 'po_Z'), { ...payouts(1)[0], payoutId: 'pi_not_a_payout' }]
  await assert.rejects(replace(pool, bad, '2026-09-29T09:00:00.000Z'))
  assert.deepEqual(await cacheStore.listCachedPayouts(pool), before)
})

test('the table holds only payout summary columns', { skip }, async () => {
  const { rows } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'stripe_payout_list_cache' ORDER BY ordinal_position",
    [SCHEMA],
  )
  assert.deepEqual(rows.map((r) => r.column_name), [
    'payout_id', 'status', 'amount_minor', 'currency', 'arrival_date', 'stripe_created_at', 'automatic', 'livemode',
    'composition', 'composition_fetched_at', 'refreshed_at',
  ])
})
