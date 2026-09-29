/**
 * Real PostgreSQL checks for the Tabby clearing store (schema, idempotent import, guarded
 * transitions, constraints, advisory lock, end-to-end posting against the fake Zoho).
 * Runs only against a disposable database, in its own schema:
 *   TABBY_CLEARING_TEST_DATABASE_URL=postgres://…/scratch node --test tests/tabbyClearingStore.pg.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Pool } = require('pg')
const tabbyStore = require('../src/services/tabbyClearing/tabbyClearingStore')
const { parseTabbyStatement } = require('../src/services/tabbyClearing/tabbyStatementParser')
const model = require('../src/services/tabbyClearing/tabbyClearingModel')
const { getTabbyClearingConfig } = require('../src/config/tabbyClearing')
const { buildTabbyPreview } = require('../src/services/tabbyClearing/tabbyClearingPreviewService')
const { postTabbyBatch } = require('../src/services/tabbyClearing/tabbyClearingPostingService')
const F = require('./fixtures/tabbyFakeZoho')

const url = process.env.TABBY_CLEARING_TEST_DATABASE_URL
const skip = url ? false : 'TABBY_CLEARING_TEST_DATABASE_URL not set'
const SCHEMA = 'tabby_clearing_test'
const SEP28 = fs.readFileSync(path.join(__dirname, 'fixtures', 'tabby', 'Tabby20260928AED.xlsx'))
const NOW = new Date('2026-09-29T08:00:00Z')

let pool
let store

test.before(async () => {
  if (skip) return
  const admin = new Pool({ connectionString: url, max: 1 })
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await admin.query(`CREATE SCHEMA ${SCHEMA}`)
  await admin.end()
  pool = new Pool({ connectionString: url, max: 6, options: `-c search_path=${SCHEMA}` })
  await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/057_tabby_settlement_clearing.sql'), 'utf8'))
  await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/058_tabby_posting_job.sql'), 'utf8'))
  await tabbyStore.ensureTabbyClearingTables((sql, params) => pool.query(sql, params))
  await tabbyStore.ensureTabbyClearingTables((sql, params) => pool.query(sql, params))
  store = tabbyStore.createPgTabbyStore(pool)
})

test.after(async () => {
  if (pool) await pool.end()
})

function analyzed(buffer) {
  const parsed = parseTabbyStatement(buffer, { fileName: 'f.xlsx' })
  return { parsed, analysis: model.analyzeStatement(parsed, getTabbyClearingConfig()) }
}

test('import is idempotent by statement # + SHA-256 and refuses changed content', { skip }, async () => {
  const a = analyzed(SEP28)
  const first = await store.importStatement({ ...a, fileName: 'a.xlsx', actor: 'user:1' })
  assert.equal(first.result, 'IMPORTED')
  assert.equal((await store.listRows(first.batch.id)).length, 9)
  assert.equal((await store.importStatement({ ...a, fileName: 'a.xlsx' })).result, 'ALREADY_IMPORTED')
  const changed = analyzed(F.buildStatementXlsx({ statementNumber: 'Tabby20260928AED', date: '2026-09-28', rows: [F.saleRow('1', '2', 10)] }))
  assert.equal((await store.importStatement({ ...changed, fileName: 'b.xlsx' })).result, 'STATEMENT_VERSION_CONFLICT')
  const { rows } = await pool.query('SELECT event_type FROM tabby_clearing_events WHERE batch_id = $1 ORDER BY id', [first.batch.id])
  assert.deepEqual(rows.map((r) => r.event_type), ['IMPORTED', 'ALREADY_IMPORTED', 'STATEMENT_VERSION_CONFLICT'])
})

test('posting job state round-trips and survives unrelated batch updates', { skip }, async () => {
  const batch = await store.getBatchByStatement('Tabby20260928AED')
  assert.equal(batch.postingJob, null)
  const job = { id: 'j1', status: 'RUNNING', progress: { phase: 'POSTING', done: 2, total: 14, current: 'x' } }
  assert.deepEqual((await store.updateBatch(batch.id, { postingJob: job })).postingJob, job)
  const after = await store.updateBatch(batch.id, { status: 'READY', postedAt: '2026-09-29T16:21:18.869Z' })
  assert.deepEqual(after.postingJob, job)
  assert.equal(after.postedAt, '2026-09-29T16:21:18.869Z')
})

test('components: unique key, guarded transitions, VERIFIED needs a record id, uncertain needs timestamps', { skip }, async () => {
  const batch = await store.getBatchByStatement('Tabby20260928AED')
  const c = { key: 'Tabby20260928AED|PAYOUT_FEE|STATEMENT', statementNumber: 'Tabby20260928AED', component: 'PAYOUT_FEE', scope: 'STATEMENT', zohoRecordType: 'journal', amount: 6.3, amountMinor: 630, currency: 'AED', reference: 'Tabby20260928AED/PAYOUT_FEE', lines: [], payload: { a: 1 } }
  const { component } = await store.upsertPlannedComponent(batch.id, c, 'user:1')
  assert.equal(component.status, 'PLANNED')
  assert.equal((await store.upsertPlannedComponent(batch.id, c, 'user:1')).component.id, component.id)
  await assert.rejects(store.transitionComponent(component.id, ['POSTING'], 'POSTED', {}), (e) => e.code === 'COMPONENT_STATE_CONFLICT')
  await assert.rejects(pool.query(`UPDATE tabby_clearing_components SET status = 'VERIFIED' WHERE id = $1`, [component.id]), /ck_tabby_clearing_components_verified/)
  await assert.rejects(pool.query(`UPDATE tabby_clearing_components SET status = 'POSTING_UNCERTAIN' WHERE id = $1`, [component.id]), /ck_tabby_clearing_components_uncertain/)
  const posting = await store.transitionComponent(component.id, ['PLANNED'], 'POSTING', { incrementAttempt: true, requestSnapshot: { x: 1 } }, 'go', 'user:1')
  assert.equal(posting.attemptCount, 1)
  assert.deepEqual(posting.requestSnapshot, { x: 1 })
  const unsure = await store.transitionComponent(component.id, ['POSTING'], 'POSTING_UNCERTAIN', { uncertainAt: NOW.toISOString(), recoveryCheckAt: NOW.toISOString(), recoveryStatus: 'AWAITING_RECHECK' }, 'unsure', 'user:1')
  assert.equal(unsure.recoveryCheckCount, 1)
  assert.equal(unsure.uncertainSince, NOW.toISOString())
  assert.equal((await store.upsertPlannedComponent(batch.id, { ...c, amount: 9 }, 'user:1')).changed, false, 'uncertain components are never replanned')
  await pool.query('DELETE FROM tabby_clearing_components WHERE id = $1', [component.id])
})

test('bank record can settle one statement only; advisory lock excludes a second poster', { skip }, async () => {
  const batch = await store.getBatchByStatement('Tabby20260928AED')
  const other = analyzed(F.buildStatementXlsx({ statementNumber: 'Tabby20261005AED', date: '2026-10-05', rows: [F.saleRow('1', '2', 10)] }))
  const b2 = (await store.importStatement({ ...other, fileName: 'c.xlsx' })).batch
  await store.setBankMatch(batch.id, { status: 'BANK_MATCHED', transactionId: 'TXN-1', evidence: {} })
  await assert.rejects(store.setBankMatch(b2.id, { status: 'BANK_MATCHED', transactionId: 'TXN-1', evidence: {} }), (e) => e.code === 'BANK_RECORD_ALREADY_CLAIMED')
  await store.setBankMatch(batch.id, { status: null, transactionId: null, evidence: null })
  const lock = await store.acquireStatementLock('Tabby20260928AED')
  await assert.rejects(store.acquireStatementLock('Tabby20260928AED'), (e) => e.code === 'STATEMENT_POSTING_IN_PROGRESS')
  await lock.release()
  const again = await store.acquireStatementLock('Tabby20260928AED')
  await again.release()
  await pool.query('DELETE FROM tabby_settlement_batches WHERE id = $1', [b2.id])
})

test('end to end on Postgres: 28 Sep posts once, rerun writes nothing', { skip }, async () => {
  const config = { ...getTabbyClearingConfig(), postingEnabled: true }
  const fake = F.createFakeZoho()
  const { analysis } = analyzed(SEP28)
  F.seedSales(fake, analysis.rows)
  fake.st.bank.push({ id: 'BANK-28', date: '2026-09-28', amount: 3077.85, from: F.IDS.UNDEPOSITED, to: F.IDS.RAK, reference: 'BRV-01157' })
  await store.saveAccountMapping({ role: 'FEES_EXPENSE', accountId: F.IDS.PAYOUT_FEE, accountName: 'Tabby Payout Fee', accountType: 'expense' }, 'user:1')
  const batch = await store.getBatchByStatement('Tabby20260928AED')
  const p = await buildTabbyPreview({ batchId: batch.id, store, sources: fake.sources, config, now: NOW })
  assert.deepEqual(p.blockers, [])
  const args = { batchId: batch.id, store, sources: fake.sources, writer: fake.writer, config, actor: 'user:1', now: () => NOW }
  const r = await postTabbyBatch({ ...args, fingerprint: p.fingerprint })
  assert.equal(r.status, 'POSTED')
  assert.equal(fake.writer.calls.length, 14)
  const again = await postTabbyBatch({ ...args, fingerprint: r.preview.fingerprint })
  assert.equal(again.status, 'POSTED')
  assert.equal(fake.writer.calls.length, 14)
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM tabby_clearing_components WHERE batch_id = $1 AND status = 'VERIFIED'", [batch.id])
  assert.equal(rows[0].n, 14)
  const b = await store.getBatch(batch.id)
  assert.equal(b.status, 'POSTED')
  assert.equal(b.bankTransactionId, 'BANK-28')
  assert.ok(b.postedAt)
})
