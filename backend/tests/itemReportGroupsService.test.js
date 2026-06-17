/**
 * Unit tests for backend/src/services/itemReportGroupsService.js
 *
 * The DB layer is mocked via require-cache injection so we can assert that the
 * SQL strings built by `adminList`, `setActive`, etc. include the right
 * filters and parameters without needing a live Postgres.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire } = require('./_helpers')

function setupDbMock() {
  const calls = []
  const responder = { rows: [], rowCount: 0 }
  // Pool / client used by transactional functions (recordImport, bulkUpsertTx).
  const txCalls = []
  const pool = {
    connect: async () => ({
      query: async (text, params) => {
        txCalls.push({ text, params })
        const next = responder.nextTxResponse?.(text, params)
        if (next) return next
        return { rows: responder.rows, rowCount: responder.rowCount }
      },
      release: () => {},
    }),
  }
  const restore = mockModule('../src/db', {
    query: async (text, params) => {
      calls.push({ text, params })
      const next = responder.nextResponse?.(text, params)
      if (next) return next
      return { rows: responder.rows, rowCount: responder.rowCount }
    },
    pool,
    testConnection: async () => {},
  })
  return { calls, txCalls, responder, restore }
}

test('itemReportGroupsService: adminList builds a query with no filters', async () => {
  const { calls, responder, restore } = setupDbMock()
  responder.rows = [{ id: 1, sku: 'A', report_group: 'slow_moving', active: true }]
  const svc = freshRequire('../src/services/itemReportGroupsService')

  const rows = await svc.adminList({})

  assert.equal(calls.length, 1)
  assert.match(calls[0].text, /FROM item_report_groups/)
  assert.doesNotMatch(calls[0].text, /WHERE/)
  assert.deepEqual(calls[0].params, [])
  assert.equal(rows.length, 1)
  restore()
})

test('itemReportGroupsService: adminList filters by group, search and active', async () => {
  const { calls, responder, restore } = setupDbMock()
  responder.rows = []
  const svc = freshRequire('../src/services/itemReportGroupsService')

  await svc.adminList({ group: 'slow_moving', search: 'Shine', active: true })

  const c = calls[0]
  assert.match(c.text, /report_group = \$1/)
  assert.match(c.text, /active = \$2/)
  assert.match(c.text, /LOWER\(COALESCE\(sku/)
  assert.deepEqual(c.params, ['slow_moving', true, '%shine%'])
  restore()
})

test('itemReportGroupsService: adminList with active=false filters inactive only', async () => {
  const { calls, responder, restore } = setupDbMock()
  responder.rows = []
  const svc = freshRequire('../src/services/itemReportGroupsService')

  await svc.adminList({ active: false })

  assert.match(calls[0].text, /WHERE active = \$1/)
  assert.deepEqual(calls[0].params, [false])
  restore()
})

test('itemReportGroupsService: setActive issues UPDATE with active flag', async () => {
  const { calls, responder, restore } = setupDbMock()
  responder.rows = [{ id: 7, active: false }]
  const svc = freshRequire('../src/services/itemReportGroupsService')

  const row = await svc.setActive(7, false)

  assert.match(calls[0].text, /UPDATE item_report_groups[\s\S]+SET active = \$1/)
  assert.deepEqual(calls[0].params, [false, 7])
  assert.equal(row.id, 7)
  assert.equal(row.active, false)
  restore()
})

test('itemReportGroupsService: remove returns true only when a row was deleted', async () => {
  const { calls, responder, restore } = setupDbMock()
  responder.rows = []
  responder.rowCount = 1
  const svc = freshRequire('../src/services/itemReportGroupsService')

  assert.equal(await svc.remove(11), true)
  assert.match(calls[0].text, /DELETE FROM item_report_groups WHERE id = \$1/)
  assert.deepEqual(calls[0].params, [11])

  responder.rowCount = 0
  assert.equal(await svc.remove(12), false)
  restore()
})

test('itemReportGroupsService: listMembersOfGroup is restricted to active rows', async () => {
  const { calls, responder, restore } = setupDbMock()
  responder.rows = [{ id: 1, sku: 'A', item_id: null, item_name: 'A', notes: '' }]
  const svc = freshRequire('../src/services/itemReportGroupsService')

  await svc.listMembersOfGroup('slow_moving')

  // Inactive mappings MUST never reach the report pipeline.
  assert.match(calls[0].text, /WHERE report_group = \$1 AND active = true/)
  assert.deepEqual(calls[0].params, ['slow_moving'])
  restore()
})

test('itemReportGroupsService: listGroupKeys returns distinct active groups only', async () => {
  const { calls, responder, restore } = setupDbMock()
  responder.rows = [{ report_group: 'other_family' }, { report_group: 'slow_moving' }]
  const svc = freshRequire('../src/services/itemReportGroupsService')

  const keys = await svc.listGroupKeys()

  assert.match(calls[0].text, /SELECT DISTINCT report_group/)
  assert.match(calls[0].text, /WHERE active = true/)
  assert.deepEqual(keys, ['other_family', 'slow_moving'])
  restore()
})

test('itemReportGroupsService: listAllActiveMemberRows returns all active rows across groups', async () => {
  const { calls, responder, restore } = setupDbMock()
  responder.rows = [
    { id: 1, sku: 'X', item_id: null, item_name: null, report_group: 'slow_moving', active: true, notes: '' },
  ]
  const svc = freshRequire('../src/services/itemReportGroupsService')

  const rows = await svc.listAllActiveMemberRows()

  assert.match(calls[0].text, /FROM item_report_groups/)
  assert.match(calls[0].text, /WHERE active = true/)
  assert.doesNotMatch(calls[0].text, /report_group =/)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].report_group, 'slow_moving')
  restore()
})

// ---------------------------------------------------------------------------
// Bulk-import audit log (recordImport + listRecentImports)
// ---------------------------------------------------------------------------

test('itemReportGroupsService: recordImport inserts then prunes to IMPORT_LOG_KEEP', async () => {
  const { txCalls, responder, restore } = setupDbMock()
  // The INSERT returns the row, the DELETE returns rowCount; we always return
  // a stub row for INSERT and an empty result for DELETE.
  responder.nextTxResponse = (text) => {
    if (/INSERT INTO item_report_groups_import_log/.test(text)) {
      return { rows: [{ id: 99, mode: 'upsert', total_rows: 4 }] }
    }
    return null
  }
  const svc = freshRequire('../src/services/itemReportGroupsService')

  const row = await svc.recordImport({
    user_id: 42,
    user_role: 'admin',
    mode: 'upsert',
    total_rows: 4,
    created_count: 3,
    updated_count: 1,
    invalid_count: 0,
    deactivated_count: 0,
    succeeded: true,
  })
  assert.equal(row.id, 99)

  const sqls = txCalls.map((c) => c.text)
  assert.ok(sqls.some((s) => /BEGIN/i.test(s)),  'expected BEGIN')
  assert.ok(sqls.some((s) => /INSERT INTO item_report_groups_import_log/.test(s)), 'expected INSERT')
  assert.ok(sqls.some((s) => /DELETE FROM item_report_groups_import_log/.test(s)), 'expected DELETE for prune')
  assert.ok(sqls.some((s) => /COMMIT/i.test(s)), 'expected COMMIT')

  // The prune step uses the documented retention cap.
  const pruneCall = txCalls.find((c) => /DELETE FROM item_report_groups_import_log/.test(c.text))
  assert.deepEqual(pruneCall.params, [svc.IMPORT_LOG_KEEP])
  restore()
})

test('itemReportGroupsService: recordImport rolls back on failure', async () => {
  const { txCalls, responder, restore } = setupDbMock()
  let inserted = false
  responder.nextTxResponse = (text) => {
    if (/INSERT INTO item_report_groups_import_log/.test(text)) {
      inserted = true
      throw new Error('boom')
    }
    return null
  }
  const svc = freshRequire('../src/services/itemReportGroupsService')

  await assert.rejects(
    () => svc.recordImport({ mode: 'upsert' }),
    /boom/
  )
  assert.ok(inserted, 'INSERT was attempted')
  assert.ok(txCalls.some((c) => /ROLLBACK/i.test(c.text)), 'ROLLBACK on failure')
  restore()
})

test('itemReportGroupsService: listRecentImports joins users and exposes user_label', async () => {
  const { calls, responder, restore } = setupDbMock()
  responder.rows = [
    { id: 2, mode: 'replace_group', total_rows: 5, user_id: 7, user_username: 'alice' },
    { id: 1, mode: 'upsert',        total_rows: 3, user_id: null, user_username: null },
  ]
  const svc = freshRequire('../src/services/itemReportGroupsService')

  const rows = await svc.listRecentImports(5)

  assert.equal(calls.length, 1)
  assert.match(calls[0].text, /FROM item_report_groups_import_log/)
  assert.match(calls[0].text, /LEFT JOIN users u ON u\.id = l\.user_id/)
  assert.match(calls[0].text, /ORDER BY l\.created_at DESC, l\.id DESC/)
  assert.deepEqual(calls[0].params, [5])
  assert.equal(rows[0].user_label, 'alice')
  assert.equal(rows[1].user_label, null)
  restore()
})

test('itemReportGroupsService: listRecentImports clamps the limit between 1 and 100', async () => {
  const { calls, responder, restore } = setupDbMock()
  responder.rows = []
  const svc = freshRequire('../src/services/itemReportGroupsService')

  await svc.listRecentImports(0)
  await svc.listRecentImports(9999)
  await svc.listRecentImports('not a number')

  assert.equal(calls[0].params[0], svc.IMPORT_LOG_KEEP) // 0 → default
  assert.equal(calls[1].params[0], 100)                  // upper clamp
  assert.equal(calls[2].params[0], svc.IMPORT_LOG_KEEP) // NaN → default
  restore()
})
