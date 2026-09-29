/**
 * Real PostgreSQL checks for direct Stripe payment mappings.
 * Runs only against a disposable database, in its own schema:
 *   STRIPE_CLEARING_TEST_DATABASE_URL=postgres://…/scratch node --test tests/stripeDirectPaymentStore.pg.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Pool } = require('pg')
const directStore = require('../src/services/stripeClearing/stripeDirectPaymentStore')
const payoutStore = require('../src/services/stripeClearing/stripePayoutClearingStore')

const url = process.env.STRIPE_CLEARING_TEST_DATABASE_URL
const skip = url ? false : 'STRIPE_CLEARING_TEST_DATABASE_URL not set'
const SCHEMA = 'stripe_direct_payment_test'
const MIGRATION = path.join(__dirname, '../migrations/054_stripe_direct_payment_mapping.sql')

const PAYOUT = 'po_1UDDZ3DJogiiRoKPj4uB4mEL'
const PI = 'pi_3UB7cxDJogiiRoKP2ddNSqC5'
const CH = 'ch_3UB7cxDJogiiRoKP2kd1Ng0X'
const WEB = '4265011000000123456'

function mapping(patch = {}) {
  return {
    paymentIntentId: PI,
    chargeId: CH,
    zohoInvoiceId: 'ZID-INV-043544',
    zohoInvoiceNumber: 'INV-043544',
    zohoCustomerId: WEB,
    customerKey: 'WEBSITE',
    payoutId: PAYOUT,
    currency: 'AED',
    stripeGross: 1261,
    invoiceReference: '20901',
    evidence: 'Payment Link product "Matjar meem #20901" ↔ INV-043544 P.O.# 20901',
    reason: 'Payment Link Matjar meem #20901 for INV-043544',
    mappedBy: 'user:7',
    ...patch,
  }
}

let pool
const newPool = () => new Pool({ connectionString: url, max: 2, options: `-c search_path=${SCHEMA}` })

test.before(async () => {
  if (skip) return
  const admin = new Pool({ connectionString: url, max: 1 })
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await admin.query(`CREATE SCHEMA ${SCHEMA}`)
  await admin.end()
  pool = newPool()
  await payoutStore.ensureStripePayoutClearingTables((sql, params) => pool.query(sql, params))
  // The reference migration and the boot-time ensure must agree and both be re-runnable.
  await pool.query(fs.readFileSync(MIGRATION, 'utf8'))
  await directStore.ensureStripeDirectPaymentTables((sql, params) => pool.query(sql, params))
  await pool.query(fs.readFileSync(MIGRATION, 'utf8'))
})

test.after(async () => {
  if (pool) await pool.end()
})

test('a confirmed mapping persists and survives a new connection pool (backend restart)', { skip }, async () => {
  const m = await directStore.insertMapping(pool, mapping())
  assert.equal(m.status, 'ACTIVE')
  assert.equal(m.mappingType, 'DIRECT_PAYMENT')
  const restarted = newPool()
  try {
    const [again] = await directStore.listActiveByIntents(restarted, [PI])
    assert.deepEqual(
      [again.id, again.paymentIntentId, again.chargeId, again.zohoInvoiceNumber, again.zohoCustomerId, again.customerKey, again.payoutId, again.stripeGross, again.invoiceReference, again.mappedBy],
      [m.id, PI, CH, 'INV-043544', WEB, 'WEBSITE', PAYOUT, 1261, '20901', 'user:7'],
    )
    assert.ok(again.mappedAt)
    assert.equal((await directStore.getActiveByInvoice(restarted, 'ZID-INV-043544')).id, m.id)
  } finally {
    await restarted.end()
  }
})

test('one PaymentIntent, charge or invoice can have only one active mapping', { skip }, async () => {
  await assert.rejects(directStore.insertMapping(pool, mapping({ zohoInvoiceId: 'ZID-OTHER', zohoInvoiceNumber: 'INV-1' })), { code: 'DIRECT_MAPPING_EXISTS' })
  await assert.rejects(directStore.insertMapping(pool, mapping({ paymentIntentId: 'pi_3OTHER000000000000', chargeId: 'ch_3OTHER000000000000' })), { code: 'DIRECT_MAPPING_EXISTS' })
  await assert.rejects(directStore.insertMapping(pool, mapping({ paymentIntentId: 'pi_3OTHER000000000000', zohoInvoiceId: 'ZID-OTHER', zohoInvoiceNumber: 'INV-1' })), { code: 'DIRECT_MAPPING_EXISTS' })
  const { rows } = await pool.query('SELECT count(*)::int AS c FROM stripe_direct_payment_mappings')
  assert.equal(rows[0].c, 1)
})

test('the table refuses bad identities, an unsupported customer key and a missing reason', { skip }, async () => {
  for (const bad of [{ paymentIntentId: 'order_20901' }, { customerKey: 'OTHER' }, { reason: 'short' }, { payoutId: 'x' }]) {
    await assert.rejects(pool.query(
      `INSERT INTO stripe_direct_payment_mappings (stripe_payment_intent_id, zoho_invoice_id, zoho_invoice_number, zoho_customer_id, customer_key, payout_id, currency, stripe_gross, reason, mapped_by)
       VALUES ($1, 'Z9', 'INV-9', $2, $3, $4, 'AED', 10, $5, 'user:7')`,
      [bad.paymentIntentId || 'pi_3NEW0000000000000000', WEB, bad.customerKey || 'WEBSITE', bad.payoutId || PAYOUT, bad.reason || 'A reason long enough'],
    ), /violates check constraint/)
  }
})

test('release is refused once any component exists for the payout customer, and allowed before', { skip }, async () => {
  const [m] = await directStore.listActiveByIntents(pool, [PI])
  await pool.query(
    `INSERT INTO stripe_payout_clearing_components (payout_id, zoho_customer_id, component, zoho_record_type, amount, currency, reference, allocations, status)
     VALUES ($1, $2, 'NET', 'customer_payment', 2151.37, 'AED', 'Stripe funds received ${PAYOUT}', $3::jsonb, 'PLANNED')`,
    [PAYOUT, WEB, JSON.stringify([{ invoiceId: 'ZID-INV-043544', paymentIntentId: PI, amount: 1210.82 }])],
  )
  await assert.rejects(directStore.releaseMapping(pool, m.id, { actor: 'user:7', reason: 'Trying to change after planning' }), { code: 'DIRECT_MAPPING_LOCKED' })
  assert.equal(await directStore.countPayoutCustomerComponents(pool, PAYOUT, WEB), 1)
  const allocating = await directStore.listComponentsAllocating(pool, { zohoInvoiceId: 'ZID-INV-043544', paymentIntentId: 'pi_none' })
  assert.deepEqual(allocating.map((c) => [c.payoutId, c.component]), [[PAYOUT, 'NET']])
  assert.equal((await directStore.listComponentsAllocating(pool, { zohoInvoiceId: 'none', paymentIntentId: PI })).length, 1)

  await pool.query('DELETE FROM stripe_payout_clearing_components')
  const released = await directStore.releaseMapping(pool, m.id, { actor: 'user:7', reason: 'Mapped to the wrong invoice' })
  assert.equal(released.status, 'RELEASED')
  assert.deepEqual(await directStore.listActiveByIntents(pool, [PI]), [])
  const history = await directStore.listHistoryByIntent(pool, PI)
  assert.deepEqual(history.map((h) => [h.status, h.releasedBy, h.releaseReason]), [['RELEASED', 'user:7', 'Mapped to the wrong invoice']])
  // A released mapping is kept for audit and does not block a new one.
  const again = await directStore.insertMapping(pool, mapping())
  assert.equal(again.status, 'ACTIVE')
})

test('054 holds only mapping columns (no website order ID) and re-running it keeps the rows', { skip }, async () => {
  await pool.query(fs.readFileSync(MIGRATION, 'utf8'))
  const { rows: cols } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'stripe_direct_payment_mappings' ORDER BY ordinal_position`,
    [SCHEMA],
  )
  const names = cols.map((c) => c.column_name)
  assert.ok(!names.some((n) => /order/.test(n)), names.join(','))
  assert.equal((await directStore.listHistoryByIntent(pool, PI)).length, 2)
})
