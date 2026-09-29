/**
 * Real PostgreSQL checks for direct, reassigned and manual Stripe payment mappings.
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
const MIGRATION_055 = path.join(__dirname, '../migrations/055_stripe_reassigned_payment_mapping.sql')
const MIGRATION_056 = path.join(__dirname, '../migrations/056_stripe_manual_invoice_mapping.sql')

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
  // The reference migrations and the boot-time ensure must agree and all be re-runnable; 054
  // alone leaves the DIRECT_PAYMENT-only check that 055 replaces, and 055 the checks 056 replaces.
  await pool.query(fs.readFileSync(MIGRATION, 'utf8'))
  await pool.query(fs.readFileSync(MIGRATION_055, 'utf8'))
  await directStore.ensureStripeDirectPaymentTables((sql, params) => pool.query(sql, params))
  await pool.query(fs.readFileSync(MIGRATION_056, 'utf8'))
  await pool.query(fs.readFileSync(MIGRATION_055, 'utf8'))
  await pool.query(fs.readFileSync(MIGRATION, 'utf8'))
  await directStore.ensureStripeDirectPaymentTables((sql, params) => pool.query(sql, params))
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

const PI_REASSIGNED = 'pi_3UC1reDJogiiRoKP0reassign'
const CH_REASSIGNED = 'ch_3UC1reDJogiiRoKP0reassign'
const ORIGINAL = { originalOrderId: '19870', originalOrderNumber: '20890', originalOrderStatus: 'cancelled', originalInvoiceId: 'ZID-INV-043530', originalInvoiceNumber: 'INV-043530' }

test('a reassigned mapping persists the original order and invoice as audit evidence', { skip }, async () => {
  const m = await directStore.insertMapping(pool, mapping({
    mappingType: 'REASSIGNED_PAYMENT', paymentIntentId: PI_REASSIGNED, chargeId: CH_REASSIGNED, zohoInvoiceId: 'ZID-INV-043600', zohoInvoiceNumber: 'INV-043600',
    reason: 'Customer cancelled original order and same Stripe funds were reused for replacement order.', ...ORIGINAL,
  }))
  const restarted = newPool()
  try {
    const [again] = await directStore.listActiveByIntents(restarted, [PI_REASSIGNED])
    assert.deepEqual(
      [again.id, again.mappingType, again.originalOrderId, again.originalOrderNumber, again.originalOrderStatus, again.originalInvoiceId, again.originalInvoiceNumber, again.zohoInvoiceNumber],
      [m.id, 'REASSIGNED_PAYMENT', '19870', '20890', 'cancelled', 'ZID-INV-043530', 'INV-043530', 'INV-043600'],
    )
  } finally {
    await restarted.end()
  }
  const [direct] = await directStore.listActiveByIntents(pool, [PI])
  assert.deepEqual([direct.mappingType, direct.originalOrderNumber, direct.originalInvoiceNumber], ['DIRECT_PAYMENT', null, null])
})

test('mapping type and original order must agree; unknown types are refused', { skip }, async () => {
  const insert = (type, originalOrderNumber) => pool.query(
    `INSERT INTO stripe_direct_payment_mappings (stripe_payment_intent_id, zoho_invoice_id, zoho_invoice_number, zoho_customer_id, customer_key, payout_id,
       mapping_type, currency, stripe_gross, reason, mapped_by, original_order_number)
     VALUES ('pi_3TYPE000000000000000', 'Z8', 'INV-8', $1, 'WEBSITE', $2, $3, 'AED', 10, 'A reason long enough', 'user:7', $4)`,
    [WEB, PAYOUT, type, originalOrderNumber],
  )
  await assert.rejects(insert('REASSIGNED_PAYMENT', null), /ck_stripe_direct_payment_original_order/)
  await assert.rejects(insert('REASSIGNED_PAYMENT', ' '), /ck_stripe_direct_payment_original_order/)
  await assert.rejects(insert('DIRECT_PAYMENT', '20890'), /ck_stripe_direct_payment_original_order/)
  await assert.rejects(insert('REFUND', null), /stripe_direct_payment_mappings_mapping_type_check/)
  // A manual mapping may record the website order or have none.
  for (const originalOrderNumber of ['20901', null]) {
    await insert('MANUAL_INVOICE_MAPPING', originalOrderNumber)
    await pool.query("DELETE FROM stripe_direct_payment_mappings WHERE stripe_payment_intent_id = 'pi_3TYPE000000000000000'")
  }
})

const PI_MANUAL = 'pi_3UD1maDJogiiRoKP00manual'

test('a manual invoice mapping persists the matcher status and reason before the override', { skip }, async () => {
  const m = await directStore.insertMapping(pool, mapping({
    mappingType: 'MANUAL_INVOICE_MAPPING', paymentIntentId: PI_MANUAL, chargeId: 'ch_3UD1maDJogiiRoKP00manual', zohoInvoiceId: 'ZID-INV-043700', zohoInvoiceNumber: 'INV-043700',
    originalOrderId: '19911', originalOrderNumber: '20901', originalOrderStatus: 'cancelled', originalInvoiceId: 'ZID-INV-043544', originalInvoiceNumber: 'INV-043544',
    matcherStatus: 'NEEDS_REVIEW', matcherReason: 'Website order status is cancelled.', reason: 'Website status wrong; verified with the customer.',
  }))
  const restarted = newPool()
  try {
    const [again] = await directStore.listActiveByIntents(restarted, [PI_MANUAL])
    assert.deepEqual(
      [again.id, again.mappingType, again.matcherStatus, again.matcherReason, again.originalOrderNumber, again.originalInvoiceNumber, again.zohoInvoiceNumber],
      [m.id, 'MANUAL_INVOICE_MAPPING', 'NEEDS_REVIEW', 'Website order status is cancelled.', '20901', 'INV-043544', 'INV-043700'],
    )
  } finally {
    await restarted.end()
  }
  const [direct] = await directStore.listActiveByIntents(pool, [PI])
  assert.deepEqual([direct.matcherStatus, direct.matcherReason], [null, null])
})

test('an allocation lookup by invoice alone matches only that invoice', { skip }, async () => {
  await pool.query(
    `INSERT INTO stripe_payout_clearing_components (payout_id, zoho_customer_id, component, zoho_record_type, amount, currency, reference, allocations, status)
     VALUES ($1, $2, 'NET', 'customer_payment', 10, 'AED', 'Stripe funds received lookup', $3::jsonb, 'PLANNED')`,
    ['po_1LOOKUPDJogiiRoKPj4uB4mEL', WEB, JSON.stringify([{ invoiceId: 'ZID-INV-099999', paymentIntentId: 'pi_3LOOKUP', amount: 10 }])],
  )
  try {
    assert.deepEqual(await directStore.listComponentsAllocating(pool, { zohoInvoiceId: 'ZID-INV-043530' }), [])
    assert.equal((await directStore.listComponentsAllocating(pool, { zohoInvoiceId: 'ZID-INV-099999' })).length, 1)
    assert.deepEqual(await directStore.listComponentsAllocating(pool, {}), [])
  } finally {
    await pool.query('DELETE FROM stripe_payout_clearing_components')
  }
})

test('054 + 055 + 056 hold mapping columns plus original-order and matcher evidence only, and re-running them keeps the rows', { skip }, async () => {
  await pool.query(fs.readFileSync(MIGRATION, 'utf8'))
  await pool.query(fs.readFileSync(MIGRATION_055, 'utf8'))
  await pool.query(fs.readFileSync(MIGRATION_056, 'utf8'))
  const { rows: cols } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'stripe_direct_payment_mappings' ORDER BY ordinal_position`,
    [SCHEMA],
  )
  const names = cols.map((c) => c.column_name)
  assert.deepEqual(names.filter((n) => /order|original/.test(n)), ['original_order_id', 'original_order_number', 'original_order_status', 'original_invoice_id', 'original_invoice_number'])
  assert.deepEqual(names.filter((n) => /matcher/.test(n)), ['matcher_status', 'matcher_reason'])
  assert.equal((await directStore.listHistoryByIntent(pool, PI)).length, 2)
  assert.equal((await directStore.listHistoryByIntent(pool, PI_REASSIGNED)).length, 1)
  assert.equal((await directStore.listHistoryByIntent(pool, PI_MANUAL)).length, 1)
  const { rows: defs } = await pool.query(
    `SELECT conname FROM pg_constraint WHERE conrelid = 'stripe_direct_payment_mappings'::regclass AND contype = 'c' AND conname IN
       ('stripe_direct_payment_mappings_mapping_type_check', 'ck_stripe_direct_payment_original_order') ORDER BY conname`,
  )
  assert.deepEqual(defs.map((d) => d.conname), ['ck_stripe_direct_payment_original_order', 'stripe_direct_payment_mappings_mapping_type_check'])
})
