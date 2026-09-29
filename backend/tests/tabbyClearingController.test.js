'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { makeReqRes } = require('./_helpers')
const ctrl = require('../src/controllers/tabbyClearingController')
const router = require('../src/routes/tabbyClearing.routes')
const { createMemoryTabbyStore } = require('../src/services/tabbyClearing/tabbyClearingMemoryStore')
const F = require('./fixtures/tabbyFakeZoho')
const { parseTabbyStatement } = require('../src/services/tabbyClearing/tabbyStatementParser')
const model = require('../src/services/tabbyClearing/tabbyClearingModel')
const { getTabbyClearingConfig } = require('../src/config/tabbyClearing')

const SEP28 = fs.readFileSync(path.join(__dirname, 'fixtures', 'tabby', 'Tabby20260928AED.xlsx'))
const ADMIN = { userId: 7, role: 'admin' }

function wire() {
  const fake = F.createFakeZoho()
  const store = createMemoryTabbyStore()
  const parsed = parseTabbyStatement(SEP28)
  F.seedSales(fake, model.analyzeStatement(parsed, getTabbyClearingConfig()).rows)
  ctrl.setDeps({ store, sources: fake.sources, writer: fake.writer })
  return { fake, store }
}

async function call(handler, input) {
  const { req, res } = makeReqRes(input)
  if (input && input.file) req.file = input.file
  await handler(req, res)
  return res
}

test('every Tabby clearing route is behind requireAuth + requireAdmin', () => {
  const guards = router.stack.filter((l) => !l.route).map((l) => l.handle.name)
  assert.deepEqual(guards, ['requireAuth', 'requireAdmin'])
  const routes = router.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`)
  assert.ok(routes.includes('POST /upload'))
  assert.ok(routes.includes('POST /batches/:id/post'))
  assert.ok(routes.includes('PUT /accounts/:role'))
})

test('upload: imports, previews, is idempotent by hash and refuses a changed file with the same statement #', async () => {
  const { store } = wire()
  const file = { buffer: SEP28, originalname: 'Tabby20260928AED.xlsx' }
  const first = await call(ctrl.upload, { user: ADMIN, file })
  assert.equal(first.statusCode, 201)
  assert.equal(first.body.result, 'IMPORTED')
  assert.equal(first.body.preview.statementNumber, 'Tabby20260928AED')
  assert.equal(first.body.preview._plan, undefined)
  assert.equal(first.body.preview.sections.vat.inputVat, 11.39)
  const again = await call(ctrl.upload, { user: ADMIN, file })
  assert.equal(again.statusCode, 200)
  assert.equal(again.body.result, 'ALREADY_IMPORTED')
  const changed = F.buildStatementXlsx({ statementNumber: 'Tabby20260928AED', date: '2026-09-28', rows: [F.saleRow('1', '2', 10)] })
  const conflict = await call(ctrl.upload, { user: ADMIN, file: { buffer: changed, originalname: 'other.xlsx' } })
  assert.equal(conflict.statusCode, 409)
  assert.equal(conflict.body.code, 'STATEMENT_VERSION_CONFLICT')
  assert.equal((await store.listBatches()).length, 1)
})

test('upload rejects non-xlsx and unreadable statements', async () => {
  wire()
  const wrongType = await call(ctrl.upload, { user: ADMIN, file: { buffer: Buffer.from('a,b'), originalname: 'x.csv' } })
  assert.equal(wrongType.statusCode, 400)
  const noHeaders = await call(ctrl.upload, { user: ADMIN, file: { buffer: F.buildStatementXlsx({ statementNumber: 'Tabby20261001AED', date: '2026-10-01', headers: ['A', 'B'], rows: [] }), originalname: 'x.xlsx' } })
  assert.equal(noHeaders.statusCode, 400)
  assert.equal(noHeaders.body.code, 'STATEMENT_UNREADABLE')
})

test('account mapping: validates type against the role and saves locally only', async () => {
  const { fake, store } = wire()
  const bad = await call(ctrl.putAccount, { user: ADMIN, params: { role: 'FEES_EXPENSE' }, body: { accountId: F.IDS.RAK } })
  assert.equal(bad.statusCode, 400)
  assert.equal(bad.body.code, 'ACCOUNT_TYPE_INVALID')
  const ok = await call(ctrl.putAccount, { user: ADMIN, params: { role: 'FEES_EXPENSE' }, body: { accountId: F.IDS.PAYOUT_FEE } })
  assert.equal(ok.statusCode, 200)
  assert.equal((await store.listAccountMappings())[0].accountName, 'Tabby Payout Fee')
  const roles = await call(ctrl.getAccounts, { user: ADMIN })
  assert.equal(roles.body.roles.find((r) => r.role === 'FEES_EXPENSE').resolved.source, 'MAPPING')
  assert.equal(fake.writer.calls.length, 0)
})

test('post endpoint enforces the server posting gate', async () => {
  const { fake } = wire()
  const up = await call(ctrl.upload, { user: ADMIN, file: { buffer: SEP28, originalname: 'a.xlsx' } })
  const prev = process.env.TABBY_CLEARING_POSTING_ENABLED
  delete process.env.TABBY_CLEARING_POSTING_ENABLED
  try {
    const res = await call(ctrl.post, { user: ADMIN, params: { id: up.body.batchId }, body: { fingerprint: up.body.preview.fingerprint } })
    assert.equal(res.statusCode, 403)
    assert.equal(res.body.code, 'POSTING_DISABLED')
    assert.equal(fake.writer.calls.length, 0)
  } finally {
    if (prev !== undefined) process.env.TABBY_CLEARING_POSTING_ENABLED = prev
  }
})
