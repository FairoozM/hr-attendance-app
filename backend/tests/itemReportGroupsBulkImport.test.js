/**
 * Unit tests for the bulk-import flow on
 * backend/src/controllers/itemReportGroupsController.js.
 *
 * Both the service layer and the underlying pg pool are mocked so we can
 * assert the controller's planning + transactional commit behaviour
 * end-to-end without a live DB.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire, makeReqRes, captureConsole } = require('./_helpers')

const ADMIN = { userId: '42', role: 'admin' }

/**
 * Build a fake service module driven by an in-memory list of "existing" rows.
 * The controller's planImport calls `service.findMatch(value)`; we mimic the
 * priority sku → item_id → item_name within report_group.
 */
function makeServiceMock(existing = []) {
  const stub = {
    rows: existing.map((r) => ({ ...r })),
    importLog: [],
    IMPORT_LOG_KEEP: 10,
    recordImport: async (entry) => {
      const row = { id: stub.importLog.length + 1, created_at: new Date().toISOString(), ...entry }
      stub.importLog.unshift(row)
      // Mimic the DB-side "keep last N" prune.
      if (stub.importLog.length > stub.IMPORT_LOG_KEEP) {
        stub.importLog.length = stub.IMPORT_LOG_KEEP
      }
      return row
    },
    listRecentImports: async (limit = stub.IMPORT_LOG_KEEP) => stub.importLog.slice(0, limit),
    findMatch: async ({ sku, item_id, item_name, report_group }) => {
      const inGroup = stub.rows.filter((r) => r.report_group === report_group)
      if (sku) {
        const hit = inGroup.find((r) => r.sku && r.sku.toLowerCase() === sku.toLowerCase())
        if (hit) return hit
      }
      if (item_id) {
        const hit = inGroup.find((r) => r.item_id === item_id)
        if (hit) return hit
      }
      if (item_name) {
        const hit = inGroup.find((r) =>
          r.item_name && r.item_name.toLowerCase() === item_name.toLowerCase()
        )
        if (hit) return hit
      }
      return null
    },
    countActiveByGroups: async (groups) => {
      const map = new Map()
      for (const r of stub.rows) {
        if (r.active && groups.includes(r.report_group)) {
          map.set(r.report_group, (map.get(r.report_group) || 0) + 1)
        }
      }
      return groups.map((g) => ({ report_group: g, currently_active: map.get(g) || 0 }))
    },
    bulkUpsertTx: async (ops, options = {}) => {
      // Mirror the production signature, including the optional
      // `replaceGroups` deactivation step that runs *inside* the same tx.
      const replaceGroups = Array.isArray(options.replaceGroups) ? options.replaceGroups : []
      let replace_result = null
      if (replaceGroups.length > 0) {
        const groups = Array.from(new Set(replaceGroups))
        const byGroup = []
        let deactivated_total = 0
        for (const g of groups) {
          let n = 0
          for (const r of stub.rows) {
            if (r.report_group === g && r.active) {
              r.active = false
              n += 1
            }
          }
          byGroup.push({ report_group: g, deactivated: n })
          deactivated_total += n
        }
        replace_result = { groups, by_group: byGroup, deactivated_total }
      }
      const out = []
      for (const op of ops) {
        if (op.action === 'create') {
          const row = { id: stub.rows.length + 1, ...op.value }
          stub.rows.push(row)
          out.push({ action: 'create', id: row.id, row })
        } else if (op.action === 'update') {
          const idx = stub.rows.findIndex((r) => r.id === op.existing_id)
          stub.rows[idx] = { ...stub.rows[idx], ...op.value }
          out.push({ action: 'update', id: op.existing_id, row: stub.rows[idx] })
        }
      }
      return { results: out, replace_result }
    },
  }
  return stub
}

function loadController(serviceStub) {
  mockModule('../src/services/itemReportGroupsService', serviceStub)
  return freshRequire('../src/controllers/itemReportGroupsController')
}

const SAMPLE_CSV =
  'report_group,sku,item_id,item_name,active,notes\n' +
  'slow_moving,FL-SHINE-001,,FL SHINE,true,seeded item\n' +
  'slow_moving,LIFEP2N-001,,LIFEP2N,true,\n' +
  'other_family,LIFEP7S-001,,LIFEP7S,true,\n' +
  'other_family,,,LIFEP19,yes,name-only fallback\n'

// ---------------------------------------------------------------------------
// Pure planner tests
// ---------------------------------------------------------------------------

test('bulkImport.planImport classifies all rows as create when DB is empty', async () => {
  const ctrl = loadController(makeServiceMock([]))
  const plan = await ctrl._internals.planImport(SAMPLE_CSV)
  assert.equal(plan.summary.total_rows, 4)
  assert.equal(plan.summary.to_create, 4)
  assert.equal(plan.summary.to_update, 0)
  assert.equal(plan.summary.invalid, 0)
  assert.equal(plan.rows[3].normalized.active, true) // "yes" parsed to true
})

test('bulkImport.planImport flags an existing SKU as update', async () => {
  const ctrl = loadController(makeServiceMock([
    { id: 11, sku: 'FL-SHINE-001', item_id: '', item_name: 'old name',
      report_group: 'slow_moving', active: true, notes: '' },
  ]))
  const plan = await ctrl._internals.planImport(SAMPLE_CSV)
  assert.equal(plan.summary.to_update, 1)
  assert.equal(plan.summary.to_create, 3)
  const updateRow = plan.rows.find((r) => r.action === 'update')
  assert.equal(updateRow.existing_id, 11)
  assert.equal(updateRow.existing.item_name, 'old name')
})

test('bulkImport.planImport prefers SKU over item_id over item_name when matching', async () => {
  const ctrl = loadController(makeServiceMock([
    { id: 1, sku: 'A1', item_id: 'X', item_name: 'Foo', report_group: 'slow_moving', active: true, notes: '' },
    { id: 2, sku: '',   item_id: 'X', item_name: 'Foo', report_group: 'slow_moving', active: true, notes: '' },
  ]))
  // Row 1 should match by SKU and pick id=1 (not id=2 even though item_id matches both).
  const plan = await ctrl._internals.planImport(
    'report_group,sku,item_id,item_name\n' +
    'slow_moving,A1,X,Foo\n'
  )
  assert.equal(plan.rows[0].existing_id, 1)
})

test('bulkImport.planImport rejects rows missing report_group / identifiers', async () => {
  const ctrl = loadController(makeServiceMock())
  const plan = await ctrl._internals.planImport(
    'report_group,sku,item_id,item_name\n' +
    ',FL-001,,FL\n' +                       // no report_group
    'slow_moving,,,\n'                      // no identifier
  )
  assert.equal(plan.summary.invalid, 2)
  assert.match(plan.rows[0].errors[0], /report_group is required/)
  assert.match(plan.rows[1].errors[0], /At least one of sku, item_id, or item_name/)
})

test('bulkImport.planImport rejects malformed report_group with the same regex as the API', async () => {
  const ctrl = loadController(makeServiceMock())
  const plan = await ctrl._internals.planImport(
    'report_group,sku\n' +
    'Slow Moving,FL-001\n'
  )
  assert.equal(plan.summary.invalid, 1)
  assert.match(plan.rows[0].errors[0], /report_group must be lowercase/)
})

test('bulkImport.planImport flags an "active" cell with a garbage value', async () => {
  const ctrl = loadController(makeServiceMock())
  const plan = await ctrl._internals.planImport(
    'report_group,sku,active\n' +
    'slow_moving,FL-001,maybe\n'
  )
  assert.equal(plan.summary.invalid, 1)
  assert.match(plan.rows[0].errors[0], /active.*true\/false/)
})

test('bulkImport.planImport defaults active to true when the cell is empty', async () => {
  const ctrl = loadController(makeServiceMock())
  const plan = await ctrl._internals.planImport(
    'report_group,sku\n' +
    'slow_moving,FL-001\n'
  )
  assert.equal(plan.rows[0].normalized.active, true)
})

test('bulkImport.planImport flags duplicate sku rows in the same CSV with the spec message', async () => {
  const ctrl = loadController(makeServiceMock())
  const plan = await ctrl._internals.planImport(
    'report_group,sku\n' +
    'slow_moving,FL-001\n' +
    'slow_moving,FL-001\n'  // duplicate
  )
  assert.equal(plan.summary.invalid, 1)
  assert.equal(plan.summary.duplicate_in_csv, 1)
  assert.equal(plan.rows[0].action, 'create')   // first occurrence stays valid
  assert.equal(plan.rows[1].action, 'invalid')
  assert.equal(plan.rows[1].duplicate_of_row, 2)
  assert.equal(plan.rows[1].duplicate_field, 'sku')
  assert.equal(plan.rows[1].errors[0], 'Duplicate row in file (same sku + report_group)')
  assert.match(plan.rows[1].errors[1], /First occurrence at row 2/)
})

test('bulkImport.planImport detects duplicates by item_id + report_group', async () => {
  const ctrl = loadController(makeServiceMock())
  const plan = await ctrl._internals.planImport(
    'report_group,item_id\n' +
    'slow_moving,89121200000123\n' +
    'slow_moving,89121200000123\n'
  )
  assert.equal(plan.summary.invalid, 1)
  assert.equal(plan.rows[1].duplicate_field, 'item_id')
  assert.equal(plan.rows[1].errors[0], 'Duplicate row in file (same item_id + report_group)')
})

test('bulkImport.planImport detects duplicates by item_name + report_group', async () => {
  const ctrl = loadController(makeServiceMock())
  const plan = await ctrl._internals.planImport(
    'report_group,item_name\n' +
    'slow_moving,LIFEP19\n' +
    'slow_moving,lifep19\n'  // case-insensitive name match
  )
  assert.equal(plan.summary.invalid, 1)
  assert.equal(plan.rows[1].duplicate_field, 'item_name')
  assert.equal(plan.rows[1].errors[0], 'Duplicate row in file (same item_name + report_group)')
})

test('bulkImport.planImport: same sku in different report_groups is not a duplicate', async () => {
  const ctrl = loadController(makeServiceMock())
  const plan = await ctrl._internals.planImport(
    'report_group,sku\n' +
    'slow_moving,FL-001\n' +
    'other_family,FL-001\n'
  )
  assert.equal(plan.summary.invalid, 0)
  assert.equal(plan.summary.to_create, 2)
})

test('bulkImport.planImport surfaces unknown_headers without failing the whole import', async () => {
  const ctrl = loadController(makeServiceMock())
  const plan = await ctrl._internals.planImport(
    'report_group,sku,extra_col\n' +
    'slow_moving,FL-001,whatever\n'
  )
  assert.deepEqual(plan.summary.unknown_headers, ['extra_col'])
  assert.equal(plan.summary.invalid, 0)
})

test('bulkImport.parseActiveCell accepts the documented values', () => {
  const ctrl = loadController(makeServiceMock())
  const f = ctrl._internals.parseActiveCell
  assert.equal(f('').value, true)
  for (const v of ['true', 'TRUE', 'yes', 'Y', '1']) assert.equal(f(v).value, true)
  for (const v of ['false', 'no', 'N', '0']) assert.equal(f(v).value, false)
  assert.match(f('?').error, /must be true\/false/)
})

// ---------------------------------------------------------------------------
// HTTP-layer tests for the dry-run endpoint
// ---------------------------------------------------------------------------

test('bulkImportDryRun: returns mode dry_run + plan + summary', async () => {
  const ctrl = loadController(makeServiceMock())
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv: SAMPLE_CSV } })
  await ctrl.bulkImportDryRun(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.mode, 'dry_run')
  assert.equal(res.body.summary.total_rows, 4)
  assert.equal(res.body.summary.to_create, 4)
})

test('bulkImportDryRun: rejects empty body with CSV_BODY_MISSING', async () => {
  const ctrl = loadController(makeServiceMock())
  const { req, res } = makeReqRes({ user: ADMIN, body: {} })
  await ctrl.bulkImportDryRun(req, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.code, 'CSV_BODY_MISSING')
})

test('bulkImportDryRun: maps CSV parse errors to 400 + code', async () => {
  const ctrl = loadController(makeServiceMock())
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv: 'a,b\n"oops' } })
  await ctrl.bulkImportDryRun(req, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.code, 'CSV_PARSE_ERROR')
})

test('bulkImportDryRun: header missing required columns → 400 + CSV_MISSING_HEADERS', async () => {
  const ctrl = loadController(makeServiceMock())
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv: 'sku,item_name\nA,FL Shine' } })
  await ctrl.bulkImportDryRun(req, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.code, 'CSV_MISSING_HEADERS')
})

// ---------------------------------------------------------------------------
// HTTP-layer tests for the real import endpoint
// ---------------------------------------------------------------------------

test('bulkImport: refuses to commit when any row is invalid (returns 422 + plan)', async () => {
  const ctrl = loadController(makeServiceMock())
  const csv =
    'report_group,sku,active\n' +
    'slow_moving,FL-001,maybe\n' // invalid `active`
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv } })
  await captureConsole(() => ctrl.bulkImport(req, res))
  assert.equal(res.statusCode, 422)
  assert.equal(res.body.code, 'IMPORT_HAS_INVALID_ROWS')
  assert.equal(res.body.summary.invalid, 1)
})

test('bulkImport: commits creates and updates atomically + writes audit log', async () => {
  const stub = makeServiceMock([
    { id: 11, sku: 'FL-SHINE-001', item_id: '', item_name: 'old',
      report_group: 'slow_moving', active: true, notes: '' },
  ])
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv: SAMPLE_CSV } })
  const captured = await captureConsole(() => ctrl.bulkImport(req, res))
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.committed, true)
  assert.equal(res.body.summary.to_create, 3)
  assert.equal(res.body.summary.to_update, 1)
  assert.ok(res.body.rows.every((r) => r.id))
  const audit = captured.info.find((a) => String(a[0]).includes('"action":"bulk_import"'))
  assert.ok(audit, 'expected bulk_import audit line')
  assert.match(String(audit[0]), /actor=user:42\/role:admin/)
  assert.match(String(audit[0]), /"created":3/)
  assert.match(String(audit[0]), /"updated":1/)
})

test('bulkImport: rolls back on commit error and surfaces 500 (or 409 for unique-violation)', async () => {
  const stub = makeServiceMock()
  stub.bulkUpsertTx = async () => {
    const e = new Error('duplicate')
    e.code = '23505'
    throw e
  }
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv: SAMPLE_CSV } })
  await captureConsole(() => ctrl.bulkImport(req, res))
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.code, 'IMPORT_UNIQUE_VIOLATION')
})

test('bulkImport: generic commit failure → 500 with rollback message', async () => {
  const stub = makeServiceMock()
  stub.bulkUpsertTx = async () => { throw new Error('connection lost') }
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv: SAMPLE_CSV } })
  await captureConsole(() => ctrl.bulkImport(req, res))
  assert.equal(res.statusCode, 500)
  assert.match(res.body.error, /rolled back/)
})

// ---------------------------------------------------------------------------
// Replace-group import mode
// ---------------------------------------------------------------------------

test('parseImportMode: defaults, accepts upsert/replace_group, rejects others', () => {
  const ctrl = loadController(makeServiceMock())
  const { parseImportMode } = ctrl._internals
  assert.equal(parseImportMode(undefined), 'upsert')
  assert.equal(parseImportMode(''), 'upsert')
  assert.equal(parseImportMode('upsert'), 'upsert')
  assert.equal(parseImportMode('REPLACE_GROUP'), 'replace_group')
  assert.throws(() => parseImportMode('wipe'), (err) => err.code === 'INVALID_IMPORT_MODE')
})

test('affectedGroupsFromPlan: skips invalid rows, dedupes, sorts', async () => {
  const ctrl = loadController(makeServiceMock())
  const plan = await ctrl._internals.planImport(
    'report_group,sku,active\n' +
    'other_family,FL-A,true\n' +
    'slow_moving,FL-B,true\n' +
    'slow_moving,FL-C,true\n' +
    'slow_moving,,maybe\n' // invalid → must NOT contribute slow_moving alone
  )
  const groups = ctrl._internals.affectedGroupsFromPlan(plan)
  assert.deepEqual(groups, ['other_family', 'slow_moving'])
})

test('bulkImportDryRun (replace_group): includes replace_preview with current active counts', async () => {
  const stub = makeServiceMock([
    { id: 1, sku: 'OLD-1', report_group: 'slow_moving', active: true },
    { id: 2, sku: 'OLD-2', report_group: 'slow_moving', active: true },
    { id: 3, sku: 'OLD-3', report_group: 'slow_moving', active: false }, // inactive: not counted
    { id: 4, sku: 'OLD-4', report_group: 'other_family', active: true },
  ])
  const ctrl = loadController(stub)
  const csv =
    'report_group,sku\n' +
    'slow_moving,FL-NEW-1\n' +
    'slow_moving,FL-NEW-2\n' +
    'other_family,LIFEP-1\n'
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv, mode: 'replace_group' } })
  await ctrl.bulkImportDryRun(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.import_mode, 'replace_group')
  assert.deepEqual(res.body.replace_preview.groups, ['other_family', 'slow_moving'])
  assert.equal(res.body.replace_preview.currently_active_total, 3) // 2 + 1
  const slow = res.body.replace_preview.by_group.find((g) => g.report_group === 'slow_moving')
  assert.equal(slow.currently_active, 2)
  assert.equal(slow.in_csv, 2)
})

test('bulkImportDryRun (upsert): does NOT include replace_preview', async () => {
  const ctrl = loadController(makeServiceMock())
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv: SAMPLE_CSV /* no mode */ } })
  await ctrl.bulkImportDryRun(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.import_mode, 'upsert')
  assert.equal(res.body.replace_preview, undefined)
})

test('bulkImportDryRun: rejects invalid mode with 400 + INVALID_IMPORT_MODE', async () => {
  const ctrl = loadController(makeServiceMock())
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv: SAMPLE_CSV, mode: 'wipe' } })
  await ctrl.bulkImportDryRun(req, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.code, 'INVALID_IMPORT_MODE')
})

test('bulkImport (replace_group): deactivates affected groups, then upserts, atomically', async () => {
  const stub = makeServiceMock([
    { id: 1, sku: 'OLD-1',  report_group: 'slow_moving', active: true },
    { id: 2, sku: 'OLD-2',  report_group: 'slow_moving', active: true },
    { id: 3, sku: 'KEEP-1', report_group: 'untouched',   active: true }, // different group: must NOT change
  ])
  const ctrl = loadController(stub)
  const csv =
    'report_group,sku\n' +
    'slow_moving,FL-NEW\n' +
    'slow_moving,OLD-1\n' // re-asserts an existing row, will flip back to active
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv, mode: 'replace_group' } })
  const captured = await captureConsole(() => ctrl.bulkImport(req, res))

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.import_mode, 'replace_group')
  assert.equal(res.body.committed, true)
  assert.equal(res.body.replace_result.deactivated_total, 2) // OLD-1 + OLD-2

  const finalRows = stub.rows
  const old1 = finalRows.find((r) => r.sku === 'OLD-1')
  const old2 = finalRows.find((r) => r.sku === 'OLD-2')
  const keep = finalRows.find((r) => r.sku === 'KEEP-1')
  const fresh = finalRows.find((r) => r.sku === 'FL-NEW')
  assert.equal(old1.active, true,  'OLD-1 was re-asserted by CSV → re-activated')
  assert.equal(old2.active, false, 'OLD-2 not in CSV → stays deactivated')
  assert.equal(keep.active, true,  'untouched group must not be modified')
  assert.equal(fresh.active, true, 'new row was created and active')

  const audit = captured.info.find((a) => String(a[0]).includes('"action":"bulk_import"'))
  assert.ok(audit, 'expected bulk_import audit line')
  assert.match(String(audit[0]), /"mode":"replace_group"/)
  assert.match(String(audit[0]), /"deactivated":2/)
})

// ---------------------------------------------------------------------------
// Import log
// ---------------------------------------------------------------------------

test('bulkImport: writes a successful entry to the import log', async () => {
  const stub = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv: SAMPLE_CSV } })
  await captureConsole(() => ctrl.bulkImport(req, res))
  assert.equal(res.statusCode, 200)
  assert.equal(stub.importLog.length, 1)
  const entry = stub.importLog[0]
  assert.equal(entry.user_id, '42')
  assert.equal(entry.user_role, 'admin')
  assert.equal(entry.mode, 'upsert')
  assert.equal(entry.total_rows, 4)
  assert.equal(entry.created_count, 4)
  assert.equal(entry.updated_count, 0)
  assert.equal(entry.invalid_count, 0)
  assert.equal(entry.succeeded, true)
  assert.equal(entry.error_code, null)
})

test('bulkImport: writes a failed entry (succeeded=false) on commit error', async () => {
  const stub = makeServiceMock()
  stub.bulkUpsertTx = async () => {
    const e = new Error('boom')
    e.code = '23505'
    throw e
  }
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv: SAMPLE_CSV } })
  await captureConsole(() => ctrl.bulkImport(req, res))
  assert.equal(res.statusCode, 409)
  assert.equal(stub.importLog.length, 1)
  const entry = stub.importLog[0]
  assert.equal(entry.succeeded, false)
  assert.equal(entry.error_code, 'IMPORT_UNIQUE_VIOLATION')
  assert.equal(entry.created_count, 0)
  assert.equal(entry.updated_count, 0)
})

test('bulkImport: replace_group writes deactivated_count to the import log', async () => {
  const stub = makeServiceMock([
    { id: 1, sku: 'OLD-1', report_group: 'slow_moving', active: true },
    { id: 2, sku: 'OLD-2', report_group: 'slow_moving', active: true },
  ])
  const ctrl = loadController(stub)
  const csv = 'report_group,sku\nslow_moving,FL-NEW\n'
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv, mode: 'replace_group' } })
  await captureConsole(() => ctrl.bulkImport(req, res))
  assert.equal(res.statusCode, 200)
  assert.equal(stub.importLog.length, 1)
  assert.equal(stub.importLog[0].mode, 'replace_group')
  assert.equal(stub.importLog[0].deactivated_count, 2)
})

test('bulkImport: rejected (422) imports are NOT written to the log', async () => {
  const stub = makeServiceMock()
  const ctrl = loadController(stub)
  const csv = 'report_group,sku,active\nslow_moving,FL-001,maybe\n'
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv } })
  await captureConsole(() => ctrl.bulkImport(req, res))
  assert.equal(res.statusCode, 422)
  assert.equal(stub.importLog.length, 0)
})

test('bulkImport: a recordImport failure does not break a successful import response', async () => {
  const stub = makeServiceMock()
  stub.recordImport = async () => { throw new Error('log table missing') }
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv: SAMPLE_CSV } })
  await captureConsole(() => ctrl.bulkImport(req, res))
  assert.equal(res.statusCode, 200, 'caller still gets 200 even if log write fails')
  assert.equal(res.body.committed, true)
})

test('listImportLog: returns recent entries with kept count, defaults to IMPORT_LOG_KEEP', async () => {
  const stub = makeServiceMock()
  stub.importLog = [
    { id: 3, created_at: 't3', mode: 'upsert', total_rows: 1 },
    { id: 2, created_at: 't2', mode: 'upsert', total_rows: 2 },
    { id: 1, created_at: 't1', mode: 'upsert', total_rows: 3 },
  ]
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN, query: {} })
  await ctrl.listImportLog(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.kept, 10)
  assert.equal(res.body.entries.length, 3)
  assert.equal(res.body.entries[0].id, 3)
})

test('listImportLog: honours ?limit= when valid', async () => {
  const stub = makeServiceMock()
  stub.importLog = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, mode: 'upsert' }))
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN, query: { limit: '2' } })
  await ctrl.listImportLog(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.entries.length, 2)
})

test('bulkImport (replace_group): an all-invalid CSV is rejected with 422 *before* any group is touched', async () => {
  // Safety property: even in replace_group mode, the planner's 422 guard
  // wins. We never deactivate a group based on a row that itself failed
  // validation — confirmed by the fact that affectedGroupsFromPlan ignores
  // invalid rows entirely.
  const stub = makeServiceMock([
    { id: 1, sku: 'OLD-1', report_group: 'slow_moving', active: true },
  ])
  const ctrl = loadController(stub)
  const csv =
    'report_group,sku\n' +
    'slow_moving,\n' // missing identifiers → invalid row
  const { req, res } = makeReqRes({ user: ADMIN, body: { csv, mode: 'replace_group' } })
  await captureConsole(() => ctrl.bulkImport(req, res))
  assert.equal(res.statusCode, 422)
  assert.equal(res.body.code, 'IMPORT_HAS_INVALID_ROWS')
  assert.equal(stub.rows[0].active, true, 'no DB write should have happened')

  // And the helper underlying the empty-CSV guard agrees.
  const { affectedGroupsFromPlan } = ctrl._internals
  assert.deepEqual(
    affectedGroupsFromPlan({ rows: [{ action: 'invalid', normalized: { report_group: 'slow_moving' } }] }),
    [],
  )
})
