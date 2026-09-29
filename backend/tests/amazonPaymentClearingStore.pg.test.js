/**
 * Real PostgreSQL checks for the Amazon clearing posting write-ahead rows and batch lock.
 * Runs only against a disposable database, in its own schema:
 *   AMAZON_CLEARING_TEST_DATABASE_URL=postgres://…/scratch node --test tests/amazonPaymentClearingStore.pg.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { Pool } = require('pg')

const url = process.env.AMAZON_CLEARING_TEST_DATABASE_URL
const skip = url ? false : 'AMAZON_CLEARING_TEST_DATABASE_URL not set'
const SCHEMA = 'amazon_clearing_store_test'

let store
let admin
let batchId

function scopedUrl() {
  const u = new URL(url)
  u.searchParams.set('options', `-c search_path=${SCHEMA}`)
  return u.toString()
}

function grouped(paymentType, patch = {}) {
  return {
    batchId,
    invoiceId: null,
    orderId: null,
    paymentType,
    postingGroupKey: `APC-${batchId}-${paymentType}`,
    amount: 100,
    accountCode: '1016',
    invoiceAllocations: [{ invoiceId: 'INV-1', invoiceNumber: 'INV-1', orderId: 'o-1', amountApplied: 100 }],
    referenceNumber: 'ref',
    description: 'd',
    mappingSnapshot: { attempted: true, request: { date: '2026-09-30' } },
    ...patch,
  }
}

test.before(async () => {
  if (skip) return
  admin = new Pool({ connectionString: url, max: 1 })
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await admin.query(`CREATE SCHEMA ${SCHEMA}`)
  process.env.DATABASE_URL = scopedUrl()
  store = require('../src/services/amazonPaymentClearingStore')
  await store.ensureAmazonPaymentClearingTables()
  await store.ensureAmazonPaymentClearingTables()
  const { rows } = await admin.query(
    `INSERT INTO ${SCHEMA}.amazon_payment_clearing_batches (marketplace, status) VALUES ('UAE', 'approved') RETURNING id`
  )
  batchId = Number(rows[0].id)
})

test.after(async () => {
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await admin.end()
  }
  if (store) await require('../src/db').pool?.end?.()
})

test('a write-ahead row is pending, blocks a second claim, and records the outcome', { skip }, async () => {
  const pending = await store.beginPosting(grouped('net_balance'))
  assert.equal(pending.status, 'pending')
  assert.equal(pending.zohoPaymentId, '')
  await assert.rejects(store.beginPosting(grouped('net_balance')), { code: 'AMAZON_PAYMENT_CLEARING_POSTING_CONFLICT', status: 409 })

  const posted = await store.updatePostingOutcome(pending.id, {
    status: 'posted',
    zohoPaymentId: 'Z-1',
    snapshotPatch: { verification: { outcome: 'exact' } },
  })
  assert.equal(posted.status, 'posted')
  assert.equal(posted.zohoPaymentId, 'Z-1')
  assert.equal(posted.mappingSnapshot.attempted, true)
  assert.equal(posted.mappingSnapshot.verification.outcome, 'exact')

  const kept = await store.updatePostingOutcome(pending.id, { status: 'posted', errorMessage: null })
  assert.equal(kept.zohoPaymentId, 'Z-1', 'a later update without an id never clears the recorded Zoho id')
  const found = await store.findPostingByKey(batchId, { paymentType: 'net_balance' })
  assert.equal(found.id, pending.id)
})

test('a failed row can be re-armed once; other states cannot', { skip }, async () => {
  const first = await store.beginPosting(grouped('commission'))
  await store.updatePostingOutcome(first.id, { status: 'failed', errorMessage: 'HTTP 400' })
  const rearmed = await store.beginPosting(grouped('commission', { mappingSnapshot: { attempted: true, retry: 1 } }))
  assert.equal(rearmed.id, first.id)
  assert.equal(rearmed.status, 'pending')
  await store.updatePostingOutcome(first.id, { status: 'verification_required', errorMessage: 'timeout' })
  await assert.rejects(store.beginPosting(grouped('commission')), { code: 'AMAZON_PAYMENT_CLEARING_POSTING_CONFLICT' })
})

test('credit-note rows are unique per invoice, not per payment type', { skip }, async () => {
  const cn = (invoiceId) => grouped('credit_note_refund', { invoiceId, orderId: `o-${invoiceId}`, postingGroupKey: null })
  const a = await store.beginPosting(cn('INV-A'))
  const b = await store.beginPosting(cn('INV-B'))
  assert.notEqual(a.id, b.id)
  await assert.rejects(store.beginPosting(cn('INV-A')), { code: 'AMAZON_PAYMENT_CLEARING_POSTING_CONFLICT' })
  const create = await store.beginPosting(grouped('credit_note_create', { invoiceId: 'INV-A', postingGroupKey: null }))
  assert.equal(create.status, 'pending')
  const rows = await store.listPostingsForBatch(batchId)
  assert.equal(rows.filter((row) => row.paymentType.startsWith('credit_note')).length, 3)
})

test('stable fee journal identities get their own rows', { skip }, async () => {
  const one = await store.beginPosting(grouped('fee_journal:0123456789abcdef'))
  const two = await store.beginPosting(grouped('fee_journal:fedcba9876543210'))
  assert.notEqual(one.id, two.id)
  const longest = await store.beginPosting(grouped(`return_fee_journal:${'x'.repeat(45)}`))
  assert.equal(longest.paymentType.length, 64)
})

test('the batch posting lock admits one run at a time and releases afterwards', { skip }, async () => {
  let release
  const holding = store.withBatchPostingLock(batchId, () => new Promise((resolve) => (release = resolve)))
  await new Promise((resolve) => setTimeout(resolve, 100))
  await assert.rejects(store.withBatchPostingLock(batchId, async () => 'second'), {
    code: 'AMAZON_PAYMENT_CLEARING_POSTING_IN_PROGRESS',
    status: 409,
  })
  assert.equal(await store.withBatchPostingLock(batchId + 1, async () => 'other batch'), 'other batch')
  release('first')
  assert.equal(await holding, 'first')
  assert.equal(await store.withBatchPostingLock(batchId, async () => 'after'), 'after')
})

test('the lock is released when the run throws', { skip }, async () => {
  await assert.rejects(store.withBatchPostingLock(batchId, async () => { throw new Error('boom') }), /boom/)
  assert.equal(await store.withBatchPostingLock(batchId, async () => 'again'), 'again')
})
