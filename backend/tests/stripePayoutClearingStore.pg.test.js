/**
 * Real PostgreSQL checks for payout clearing records and the GROSS_V1 upgrade.
 * Runs only against a disposable database, in its own schema:
 *   STRIPE_CLEARING_TEST_DATABASE_URL=postgres://…/scratch node --test tests/stripePayoutClearingStore.pg.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Pool } = require('pg')
const clearingStore = require('../src/services/stripeClearing/stripeClearingStore')
const payoutStore = require('../src/services/stripeClearing/stripePayoutClearingStore')

const url = process.env.STRIPE_CLEARING_TEST_DATABASE_URL
const skip = url ? false : 'STRIPE_CLEARING_TEST_DATABASE_URL not set'
const SCHEMA = 'stripe_payout_clearing_test'

function candidate(overrides = {}) {
  return {
    payoutId: 'po_1UJNObDJogiiRoKPHtPAr3KE',
    zohoCustomerId: '4265011000000160061',
    customerName: 'Website',
    orderNumber: '21111',
    invoiceId: '4265011000042000001',
    invoiceNumber: 'INV-044122',
    paymentIntentId: 'pi_3UIA7CDJogiiRoKP0Qy1oodM',
    chargeId: 'ch_3UIA7CDJogiiRoKP07RCqZKw',
    balanceTransactionId: 'txn_3UIA7CDJogiiRoKP0',
    currency: 'AED',
    stripeGross: 1101,
    stripeNet: 1068.07,
    stripeFee: 32.93,
    invoiceTotal: 1066,
    overpaymentAmount: 35,
    netAllocation: 1033.07,
    customerAdvanceAccountId: '4265011000015681205',
    customerAdvanceAccountCode: '1123',
    advanceReference: 'Stripe customer advance po_1UJNObDJogiiRoKPHtPAr3KE',
    ...overrides,
  }
}

let pool
const q = (sql, params) => pool.query(sql, params)

test.before(async () => {
  if (skip) return
  const admin = new Pool({ connectionString: url, max: 1 })
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await admin.query(`CREATE SCHEMA ${SCHEMA}`)
  await admin.end()
  pool = new Pool({ connectionString: url, max: 4, options: `-c search_path=${SCHEMA}` })
  // Start from the original 047 schema with a POSTED gross-only row, then upgrade twice.
  await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/047_stripe_payment_clearings.sql'), 'utf8'))
  await pool.query(
    `INSERT INTO stripe_payment_clearings (stripe_payment_intent_id, stripe_charge_id, stripe_livemode, website_order_id, website_order_number,
       zoho_invoice_id, zoho_invoice_number, zoho_customer_id, zoho_account_id, amount, currency, payment_date, status, zoho_payment_id,
       attempt_count, created_by, posted_at, updated_at)
     VALUES ('pi_3UJALVDJogiiRoKP2ugPotQ9', 'ch_1', true, '10749', '21150', '4265011000042433105', 'INV-044203', '4265011000000160061',
       '4265011000000984169', 207.50, 'AED', '2026-09-27', 'POSTED', '4265011000042471002', 1, 'user:1',
       '2026-09-27T16:52:35Z', '2026-09-27T16:52:35Z')`,
  )
  const id = (await pool.query('SELECT id FROM stripe_payment_clearings')).rows[0].id
  for (const [from, to] of [[null, 'READY'], ['READY', 'POSTING'], ['POSTING', 'POSTED']]) {
    await pool.query('INSERT INTO stripe_payment_clearing_events (clearing_id, from_status, to_status, actor) VALUES ($1, $2, $3, $4)', [id, from, to, 'user:1'])
  }
  // Production today: the 048 schema with an existing case, before REFUND_DETECTED (049).
  await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/048_stripe_payout_clearing.sql'), 'utf8'))
  await pool.query(
    `INSERT INTO stripe_customer_advance_cases (payout_id, zoho_customer_id, customer_name, order_number, invoice_id, invoice_number,
       charge_id, currency, stripe_gross, stripe_net, stripe_fee, invoice_total, overpayment_amount, net_allocation,
       customer_advance_account_id, customer_advance_account_code, advance_reference, status, admin_confirmed, confirmed_by, confirmed_at, reason)
     VALUES ('po_LEGACY0000001', 'C', 'Website', '9', 'I9', 'INV-9', 'ch_LEGACY0000001', 'AED', 100, 97, 3, 90, 10, 87,
       'A', '1123', 'Stripe customer advance po_LEGACY0000001', 'CONFIRMED', true, 'user:1', '2026-09-20T10:00:00Z', 'legacy reason')`,
  )
  for (let i = 0; i < 2; i++) {
    await clearingStore.ensureStripeClearingTables(q)
    await payoutStore.ensureStripePayoutClearingTables(q)
  }
  // The reference migration files must also apply cleanly on top, repeatedly.
  for (const file of ['048_stripe_payout_clearing.sql', '049_stripe_advance_refund_detected.sql', '049_stripe_advance_refund_detected.sql']) {
    await pool.query(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'))
  }
})
test.after(async () => {
  if (!pool) return
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await pool.end()
})

test('GROSS_V1 repair keeps payment ID, posting time and history, and adds one event', { skip }, async () => {
  const before = await clearingStore.getByIntent({ query: q }, 'pi_3UJALVDJogiiRoKP2ugPotQ9')
  assert.equal(before.clearingModel, 'GROSS_V1')
  assert.equal(before.status, 'POSTED')
  const client = await pool.connect()
  try {
    await assert.rejects(
      clearingStore.markReversedExternally(client, before.id, 'SOME_OTHER_ID', 'x', 'user:1'),
      (err) => err.code === 'ZOHO_PAYMENT_ID_MISMATCH',
    )
    const after = await clearingStore.markReversedExternally(client, before.id, '4265011000042471002', 'Zoho payment deleted manually in Zoho.', 'user:1')
    assert.equal(after.status, 'REVERSED_EXTERNALLY')
    assert.equal(after.zohoPaymentId, '4265011000042471002')
    assert.equal(after.postedAt, before.postedAt)
    assert.equal(after.createdAt, before.createdAt)
    assert.equal(after.attemptCount, before.attemptCount)
    assert.ok(after.reversedAt)
    assert.equal(after.reversalDetail, 'Zoho payment deleted manually in Zoho.')
    await assert.rejects(
      clearingStore.markReversedExternally(client, before.id, '4265011000042471002', 'again', 'user:1'),
      (err) => err.code === 'CLEARING_STATE_CONFLICT',
    )
  } finally {
    client.release()
  }
  const events = await clearingStore.listEvents({ query: q }, before.id)
  assert.deepEqual(events.map((e) => e.toStatus), ['READY', 'POSTING', 'POSTED', 'REVERSED_EXTERNALLY'])
  await assert.rejects(q("UPDATE stripe_payment_clearings SET status = 'BOGUS'"), (err) => err.code === '23514')
})

test('customer advance case: candidate then confirmation, idempotent, audited', { skip }, async () => {
  const client = await pool.connect()
  try {
    const first = await payoutStore.confirmCase(client, candidate(), { actor: 'user:7', reason: 'Paid product removed after payment before invoicing. No refund was issued.' })
    assert.equal(first.alreadyConfirmed, false)
    assert.equal(first.case.status, 'CONFIRMED')
    assert.equal(first.case.adminConfirmed, true)
    assert.equal(first.case.confirmedBy, 'user:7')
    assert.ok(first.case.confirmedAt)
    assert.equal(first.case.overpaymentAmount, 35)
    assert.equal(first.case.netAllocation, 1033.07)
    assert.equal(first.case.refundStatus, 'NOT_REFUNDED')
    assert.equal(first.case.refundRequired, true)

    const again = await payoutStore.confirmCase(client, candidate(), { actor: 'user:8', reason: 'second click on the button' })
    assert.equal(again.alreadyConfirmed, true)
    assert.equal(again.case.confirmedBy, 'user:7')

    await assert.rejects(
      payoutStore.confirmCase(client, candidate({ overpaymentAmount: 30, invoiceTotal: 1071, netAllocation: 1038.07 }), { actor: 'user:7', reason: 'figures changed since' }),
      (err) => err.code === 'ADVANCE_CASE_CHANGED',
    )
    const events = await payoutStore.listEvents({ query: q }, payoutStore.ENTITY.ADVANCE_CASE, [first.case.id])
    assert.deepEqual(events.map((e) => [e.fromStatus, e.toStatus, e.actor]), [
      [null, 'CUSTOMER_ADVANCE_REVIEW_REQUIRED', 'user:7'],
      ['CUSTOMER_ADVANCE_REVIEW_REQUIRED', 'CONFIRMED', 'user:7'],
    ])
    const listed = await payoutStore.listCasesForPayout({ query: q }, 'po_1UJNObDJogiiRoKPHtPAr3KE')
    assert.equal(listed.length, 1)
  } finally {
    client.release()
  }
})

test('049 upgrade keeps existing cases and replaces the refund_status check exactly once', { skip }, async () => {
  const { rows } = await q("SELECT * FROM stripe_customer_advance_cases WHERE charge_id = 'ch_LEGACY0000001'")
  const legacy = payoutStore.mapCase(rows[0])
  assert.equal(legacy.status, 'CONFIRMED')
  assert.equal(legacy.confirmedBy, 'user:1')
  assert.equal(legacy.reason, 'legacy reason')
  assert.equal(legacy.overpaymentAmount, 10)
  assert.equal(legacy.refundStatus, 'NOT_REFUNDED')
  assert.equal(legacy.refundId, null)
  assert.equal(legacy.refundDetectedAt, null)
  const checks = await q(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid = 'stripe_customer_advance_cases'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%NOT_REFUNDED%'`,
  )
  assert.equal(checks.rows.length, 1)
  assert.match(checks.rows[0].def, /REFUND_DETECTED/)
  await assert.rejects(q("UPDATE stripe_customer_advance_cases SET refund_status = 'BOGUS' WHERE charge_id = 'ch_LEGACY0000001'"), (err) => err.code === '23514')
  // REFUND_DETECTED needs the refund identity; MATCHED also needs a later payout.
  await assert.rejects(q("UPDATE stripe_customer_advance_cases SET refund_status = 'REFUND_DETECTED' WHERE charge_id = 'ch_LEGACY0000001'"), (err) => err.code === '23514')
  const detect = `UPDATE stripe_customer_advance_cases SET refund_status = $1, refund_id = 're_L', refund_balance_transaction_id = 'txn_L',
    refund_amount = $2, refund_detected_at = NOW(), refund_payout_id = $3 WHERE charge_id = 'ch_LEGACY0000001'`
  await assert.rejects(q(detect, ['REFUND_DETECTED', 9, null]), (err) => err.code === '23514')
  await assert.rejects(q(detect, ['REFUND_MATCHED', 10, null]), (err) => err.code === '23514')
  await assert.rejects(q(detect, ['REFUND_MATCHED', 10, 'po_LEGACY0000001']), (err) => err.code === '23514')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(detect, ['REFUND_DETECTED', 10, null])
    await client.query(detect, ['REFUND_MATCHED', 10, 'po_LATER00000001'])
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
})

test('confirming a candidate whose refund already exists records REFUND_DETECTED, then CONFIRMED', { skip }, async () => {
  const refund = { refundId: 're_3UIA7CDJogiiRoKP0noUu0UZ', balanceTransactionId: 'txn_3UIA7CDJogiiRoKP0qGO7307', amount: 35, createdAt: '2026-09-28T07:09:27.000Z' }
  const c = candidate({ payoutId: 'po_REFUNDDETECT01', chargeId: 'ch_REFUNDDETECT01', advanceReference: 'Stripe customer advance po_REFUNDDETECT01', refund })
  const client = await pool.connect()
  try {
    const out = await payoutStore.confirmCase(client, c, { actor: 'user:7', reason: 'Customer overpaid; refunded in Stripe later.' })
    assert.equal(out.case.status, 'CONFIRMED')
    assert.equal(out.case.refundStatus, 'REFUND_DETECTED')
    assert.equal(out.case.refundId, refund.refundId)
    assert.equal(out.case.refundBalanceTransactionId, refund.balanceTransactionId)
    assert.equal(out.case.refundAmount, 35)
    assert.equal(out.case.refundPayoutId, null)
    assert.ok(out.case.refundDetectedAt)
    const events = await payoutStore.listEvents({ query: q }, payoutStore.ENTITY.ADVANCE_CASE, [out.case.id])
    assert.deepEqual(events.map((e) => [e.fromStatus, e.toStatus]), [
      [null, 'CUSTOMER_ADVANCE_REVIEW_REQUIRED'],
      ['NOT_REFUNDED', 'REFUND_DETECTED'],
      ['CUSTOMER_ADVANCE_REVIEW_REQUIRED', 'CONFIRMED'],
    ])
    assert.match(events[1].detail, /re_3UIA7CDJogiiRoKP0noUu0UZ/)
    assert.match(events[2].detail, /already detected/)

    const again = await payoutStore.confirmCase(client, c, { actor: 'user:8', reason: 'second click on the button' })
    assert.equal(again.alreadyConfirmed, true)
    const after = await payoutStore.listEvents({ query: q }, payoutStore.ENTITY.ADVANCE_CASE, [out.case.id])
    assert.equal(after.length, 3)
  } finally {
    client.release()
  }
})

test('a stored refund that no longer matches the candidate blocks confirmation', { skip }, async () => {
  const refund = { refundId: 're_FIRST00000001', balanceTransactionId: 'txn_FIRST0000001', amount: 35, createdAt: '2026-09-28T07:09:27.000Z' }
  const base = { payoutId: 'po_REFUNDCHANGE1', chargeId: 'ch_REFUNDCHANGE1', advanceReference: 'Stripe customer advance po_REFUNDCHANGE1' }
  await q(
    `INSERT INTO stripe_customer_advance_cases (payout_id, zoho_customer_id, customer_name, order_number, invoice_id, invoice_number,
       payment_intent_id, charge_id, currency, stripe_gross, stripe_net, stripe_fee, invoice_total, overpayment_amount, net_allocation,
       customer_advance_account_id, customer_advance_account_code, advance_reference, status,
       refund_status, refund_id, refund_balance_transaction_id, refund_amount, refund_detected_at)
     VALUES ($1, '4265011000000160061', 'Website', '21111', '4265011000042000001', 'INV-044122', 'pi_3UIA7CDJogiiRoKP0Qy1oodM', $2, 'AED',
       1101, 1068.07, 32.93, 1066, 35, 1033.07, '4265011000015681205', '1123', $3, 'CUSTOMER_ADVANCE_REVIEW_REQUIRED',
       'REFUND_DETECTED', $4, $5, 35, NOW())`,
    [base.payoutId, base.chargeId, base.advanceReference, refund.refundId, refund.balanceTransactionId],
  )
  const client = await pool.connect()
  try {
    for (const changed of [{ ...refund, refundId: 're_OTHER00000001' }, null]) {
      await assert.rejects(
        payoutStore.confirmCase(client, candidate({ ...base, refund: changed }), { actor: 'user:7', reason: 'refund changed since detection' }),
        (err) => err.code === 'ADVANCE_CASE_REFUND_CHANGED',
      )
    }
    const { rows } = await q('SELECT status FROM stripe_customer_advance_cases WHERE charge_id = $1', [base.chargeId])
    assert.equal(rows[0].status, 'CUSTOMER_ADVANCE_REVIEW_REQUIRED')
  } finally {
    client.release()
  }
})

test('case constraints: figures must add up and confirmation needs who and when', { skip }, async () => {
  const insert = (patch) => q(
    `INSERT INTO stripe_customer_advance_cases (payout_id, zoho_customer_id, customer_name, order_number, invoice_id, invoice_number,
       charge_id, currency, stripe_gross, stripe_net, stripe_fee, invoice_total, overpayment_amount, net_allocation,
       customer_advance_account_id, customer_advance_account_code, advance_reference, status, admin_confirmed)
     VALUES ('po_X', 'C', 'Website', '1', 'I', 'INV', $1, 'AED', $2, $3, $4, $5, $6, $7, 'A', '1123', 'r', $8, false)`,
    [patch.charge, patch.gross, patch.net, patch.fee, patch.invoice, patch.over, patch.alloc, patch.status || 'CUSTOMER_ADVANCE_REVIEW_REQUIRED'],
  )
  const ok = { charge: 'ch_A', gross: 100, net: 97, fee: 3, invoice: 90, over: 10, alloc: 87 }
  await insert(ok)
  await assert.rejects(insert({ ...ok, charge: 'ch_A' }), (err) => err.code === '23505')
  await assert.rejects(insert({ ...ok, charge: 'ch_B', over: 11 }), (err) => err.code === '23514')
  await assert.rejects(insert({ ...ok, charge: 'ch_C', alloc: 88 }), (err) => err.code === '23514')
  await assert.rejects(insert({ ...ok, charge: 'ch_D', status: 'CONFIRMED' }), (err) => err.code === '23514')
})

test('components: unique per payout + customer + component, guarded transitions', { skip }, async () => {
  const client = await pool.connect()
  const c = {
    payoutId: 'po_1UJNObDJogiiRoKPHtPAr3KE',
    zohoCustomerId: '4265011000000160061',
    component: 'CUSTOMER_ADVANCE',
    zohoRecordType: 'journal',
    amount: 35,
    currency: 'AED',
    debitAccountId: '4265011000000984169',
    creditAccountId: '4265011000015681205',
    reference: 'Stripe customer advance po_1UJNObDJogiiRoKPHtPAr3KE',
    advanceCaseIds: ['1'],
  }
  try {
    const planned = await payoutStore.upsertPlannedComponent(client, c, 'user:1')
    assert.equal(planned.component.status, 'PLANNED')
    const replanned = await payoutStore.upsertPlannedComponent(client, { ...c, amount: 36 }, 'user:1')
    assert.equal(replanned.component.amount, 36)
    const posting = await payoutStore.transitionComponent(client, planned.component.id, ['PLANNED', 'FAILED'], 'POSTING', { incrementAttempt: true }, 'claim', 'user:1')
    assert.equal(posting.attemptCount, 1)
    const frozen = await payoutStore.upsertPlannedComponent(client, { ...c, amount: 99 }, 'user:1')
    assert.equal(frozen.changed, false)
    assert.equal(frozen.component.amount, 36)
    await assert.rejects(
      payoutStore.transitionComponent(client, planned.component.id, ['POSTING'], 'VERIFIED', {}, 'no id'),
      (err) => err.code === '23514',
    )
    const verified = await payoutStore.transitionComponent(client, planned.component.id, ['POSTING'], 'VERIFIED', { zohoRecordId: 'ZJ-1', postedAt: new Date().toISOString(), verifiedAt: new Date().toISOString() }, 'verified', 'user:1')
    assert.equal(verified.zohoJournalId, 'ZJ-1')
    await assert.rejects(
      payoutStore.transitionComponent(client, planned.component.id, ['PLANNED'], 'POSTING', {}, 'again'),
      (err) => err.code === 'COMPONENT_STATE_CONFLICT',
    )
    const listed = await payoutStore.listComponents({ query: q }, c.payoutId)
    assert.equal(listed.length, 1)
    const events = await payoutStore.listEvents({ query: q }, payoutStore.ENTITY.COMPONENT, [planned.component.id])
    assert.deepEqual(events.map((e) => e.toStatus), ['PLANNED', 'POSTING', 'VERIFIED'])
  } finally {
    client.release()
  }
})
