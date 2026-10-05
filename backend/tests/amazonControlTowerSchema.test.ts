'use strict'

/**
 * Migration 061 mirrors the boot-time ensure, and the backfill path never deletes order lines that
 * an older report already stored.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { CONTROL_TOWER_DDL } = require('../src/services/amazonControlTower/controlTowerSchema.ts')

const MIGRATION = fs.readFileSync(path.join(__dirname, '../migrations/061_amazon_control_tower_foundation.sql'), 'utf8')

function squash(sql: string) {
  return sql.replace(/\s+/g, ' ').trim()
}

test('migration 061 contains every boot-time DDL statement', () => {
  const migration = squash(MIGRATION)
  assert.ok(CONTROL_TOWER_DDL.length >= 10)
  for (const statement of CONTROL_TOWER_DDL) {
    assert.ok(migration.includes(squash(statement)), `missing from 061: ${squash(statement).slice(0, 120)}`)
  }
})

test('schema is additive and safe by default', () => {
  const all = CONTROL_TOWER_DDL.join('\n')
  assert.doesNotMatch(all, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i)
  assert.doesNotMatch(all, /amazon_sync_log/, 'Control Tower jobs have their own tables')
  assert.match(all, /scheduler_enabled\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/i)
  assert.match(all, /enabled\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/i)
  assert.match(all, /WHERE\s+status\s+IN\s+\('queued',\s*'running'\)/i, 'one active run per job is enforced by the database')
  assert.match(all, /'ksa',\s*'Asia\/Riyadh'/)
})

function stubModule(relativePath: string, exports: unknown) {
  const resolved = require.resolve(relativePath)
  const previous = require.cache[resolved]
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as any
  return () => {
    if (previous) require.cache[resolved] = previous
    else delete require.cache[resolved]
  }
}

function freshModule(relativePath: string) {
  delete require.cache[require.resolve(relativePath)]
  return require(relativePath)
}

const WINDOW = { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-31T00:00:00Z') }
const LINES = [{ amazonOrderId: '406-1', orderItemId: '1', sellerSku: 'A', quantity: 1, currency: 'SAR', itemPrice: 100, lineAmount: 100 }]

test('preserve mode upserts report lines without deleting rows missing from the report', async () => {
  const sqls: string[] = []
  const restore = stubModule('../src/db', {
    query: async (sql: string) => {
      sqls.push(sql.trim())
      return { rows: [], rowCount: 0 }
    },
  })
  try {
    const store = freshModule('../src/services/amazonOrdersCacheStore')
    const result = await store.replaceOrderReportLines('ksa', WINDOW, LINES, 'r1', { removeMissing: false })
    assert.deepEqual(result, { saved: 1, removed: 0 })
    assert.equal(sqls.filter((s) => /^DELETE/i.test(s)).length, 0)
    assert.equal(sqls.filter((s) => /^INSERT/i.test(s)).length, 1)

    sqls.length = 0
    await store.replaceOrderReportLines('ksa', WINDOW, LINES, 'r1')
    assert.equal(sqls.filter((s) => /^DELETE/i.test(s)).length, 1, 'default (live sync) behaviour is unchanged')
  } finally {
    restore()
    delete require.cache[require.resolve('../src/services/amazonOrdersCacheStore')]
  }
})
