/**
 * Unit tests for backend/src/controllers/itemReportGroupsController.js
 *
 * The service layer is mocked so we can drive the controller through every
 * branch (validation, 404, 409 duplicates, audit logging) without a DB.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire, makeReqRes, captureConsole } = require('./_helpers')

function makeServiceMock() {
  const calls = []
  const stub = {
    rows: new Map(),       // id -> row
    nextId: 1,
    reject: null,          // when set, the next mutating call rejects with this error
    adminList:           async (opts) => { calls.push(['adminList', opts]); return Array.from(stub.rows.values()) },
    adminListAllGroupKeys: async () => { calls.push(['adminListAllGroupKeys']); return [] },
    findById:            async (id)   => { calls.push(['findById', id]); return stub.rows.get(id) || null },
    create: async (payload) => {
      calls.push(['create', payload])
      if (stub.reject) { const e = stub.reject; stub.reject = null; throw e }
      const id = stub.nextId++
      const row = { id, ...payload, created_at: 'now', updated_at: 'now' }
      stub.rows.set(id, row)
      return row
    },
    update: async (id, payload) => {
      calls.push(['update', id, payload])
      if (stub.reject) { const e = stub.reject; stub.reject = null; throw e }
      const row = { ...stub.rows.get(id), ...payload, updated_at: 'now' }
      stub.rows.set(id, row)
      return row
    },
    setActive: async (id, active) => {
      calls.push(['setActive', id, active])
      const cur = stub.rows.get(id)
      if (!cur) return null
      const row = { ...cur, active, updated_at: 'now' }
      stub.rows.set(id, row)
      return row
    },
    remove: async (id) => {
      calls.push(['remove', id])
      const had = stub.rows.has(id)
      stub.rows.delete(id)
      return had
    },
  }
  return { calls, stub }
}

function loadController(serviceStub) {
  mockModule('../src/services/itemReportGroupsService', serviceStub)
  return freshRequire('../src/controllers/itemReportGroupsController')
}

const ADMIN = { userId: '42', role: 'admin' }

// ---------------------------------------------------------------------------
// Validation (normalisePayload)
// ---------------------------------------------------------------------------

test('controller: normalisePayload rejects empty report_group', () => {
  const { stub } = makeServiceMock()
  const ctrl = loadController(stub)
  const { errors } = ctrl._internals.normalisePayload({ sku: 'A', report_group: '' })
  assert.ok(errors.some((e) => /report_group is required/i.test(e)))
})

test('controller: normalisePayload rejects malformed group keys', () => {
  const { stub } = makeServiceMock()
  const ctrl = loadController(stub)
  // NOTE: uppercase keys are auto-lowercased before validation so they're not
  // in this list — that coercion is intentional (see normalisePayload).
  for (const bad of ['Slow Moving', 'slow moving', '_oops', 'a', '-leading', 'trailing-']) {
    const { errors } = ctrl._internals.normalisePayload({ sku: 'X', report_group: bad })
    assert.ok(
      errors.some((e) => /report_group must be/i.test(e)),
      `should reject ${JSON.stringify(bad)}, errors: ${JSON.stringify(errors)}`
    )
  }
})

test('controller: normalisePayload accepts well-formed group keys', () => {
  const { stub } = makeServiceMock()
  const ctrl = loadController(stub)
  for (const ok of ['slow_moving', 'other_family', 'a1', 'group-1', 'high_priority_2026']) {
    const { errors } = ctrl._internals.normalisePayload({ sku: 'X', report_group: ok })
    assert.equal(errors.length, 0, `should accept ${ok}`)
  }
})

test('controller: normalisePayload requires at least one identifier', () => {
  const { stub } = makeServiceMock()
  const ctrl = loadController(stub)
  const { errors } = ctrl._internals.normalisePayload({ report_group: 'slow_moving' })
  assert.ok(errors.some((e) => /At least one of sku/i.test(e)))
})

test('controller: normalisePayload lowercases group + trims identifiers', () => {
  const { stub } = makeServiceMock()
  const ctrl = loadController(stub)
  const { value, errors } = ctrl._internals.normalisePayload({
    sku: '  FL-001  ',
    report_group: 'Slow_Moving',
    item_name: '  FL Shine  ',
  })
  assert.equal(errors.length, 0)
  assert.equal(value.sku, 'FL-001')
  assert.equal(value.item_name, 'FL Shine')
  assert.equal(value.report_group, 'slow_moving')
})

// ---------------------------------------------------------------------------
// create flow
// ---------------------------------------------------------------------------

test('controller: create persists and writes an audit log', async () => {
  const { calls, stub } = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({
    user: ADMIN,
    body: { sku: 'FL-001', report_group: 'slow_moving', item_name: 'FL Shine' },
  })
  const captured = await captureConsole(() => ctrl.create(req, res))
  assert.equal(res.statusCode, 201)
  assert.equal(res.body.sku, 'FL-001')
  assert.equal(calls[0][0], 'create')
  const auditLine = captured.info.find((args) => String(args[0]).includes('[audit]'))
  assert.ok(auditLine, 'expected an audit log line')
  assert.match(String(auditLine[0]), /actor=user:42\/role:admin/)
  assert.match(String(auditLine[0]), /"action":"create"/)
})

test('controller: create rejects invalid payload with 400', async () => {
  const { stub } = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({
    user: ADMIN,
    body: { report_group: 'BAD KEY' },
  })
  await ctrl.create(req, res)
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /report_group must be/)
})

test('controller: create maps unique-violation 23505 to 409 + DUPLICATE_MAPPING (sku)', async () => {
  const { stub } = makeServiceMock()
  stub.reject = Object.assign(new Error('duplicate'), { code: '23505' })
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({
    user: ADMIN,
    body: { sku: 'FL-001', report_group: 'slow_moving' },
  })
  await captureConsole(() => ctrl.create(req, res))
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.code, 'DUPLICATE_MAPPING')
  assert.equal(res.body.field, 'sku')
  assert.match(res.body.error, /FL-001/)
})

test('controller: create unique-violation falls back to item_name when no SKU', async () => {
  const { stub } = makeServiceMock()
  stub.reject = Object.assign(new Error('duplicate'), { code: '23505' })
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({
    user: ADMIN,
    body: { item_name: 'FL Shine', report_group: 'slow_moving' },
  })
  await captureConsole(() => ctrl.create(req, res))
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.code, 'DUPLICATE_MAPPING')
  assert.equal(res.body.field, 'item_name')
})

// ---------------------------------------------------------------------------
// update flow
// ---------------------------------------------------------------------------

test('controller: update returns 404 when row not found', async () => {
  const { stub } = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({
    user: ADMIN,
    params: { id: '99' },
    body: { sku: 'A', report_group: 'slow_moving' },
  })
  await ctrl.update(req, res)
  assert.equal(res.statusCode, 404)
})

test('controller: update audit log includes previous values', async () => {
  const { calls, stub } = makeServiceMock()
  stub.rows.set(1, {
    id: 1, sku: 'OLD', item_name: 'Old', item_id: '',
    report_group: 'slow_moving', active: true,
  })
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({
    user: ADMIN,
    params: { id: '1' },
    body: { sku: 'NEW', item_name: 'New', report_group: 'other_family', active: false },
  })
  const captured = await captureConsole(() => ctrl.update(req, res))
  assert.equal(res.statusCode, 200)
  assert.equal(calls.find((c) => c[0] === 'update')[2].sku, 'NEW')
  const auditLine = captured.info.find((a) => String(a[0]).includes('"action":"update"'))
  assert.match(String(auditLine[0]), /"previous":/)
  assert.match(String(auditLine[0]), /"sku":"OLD"/)
})

// ---------------------------------------------------------------------------
// setActive (activate/deactivate) flow
// ---------------------------------------------------------------------------

test('controller: setActive toggles and logs the right action', async () => {
  const { stub } = makeServiceMock()
  stub.rows.set(5, {
    id: 5, sku: 'X', item_name: 'X', item_id: '',
    report_group: 'slow_moving', active: true,
  })
  const ctrl = loadController(stub)

  // deactivate
  let env = makeReqRes({ user: ADMIN, params: { id: '5' }, body: { active: false } })
  let captured = await captureConsole(() => ctrl.setActive(env.req, env.res))
  assert.equal(env.res.statusCode, 200)
  assert.equal(env.res.body.active, false)
  assert.ok(captured.info.find((a) => String(a[0]).includes('"action":"deactivate"')))

  // reactivate
  env = makeReqRes({ user: ADMIN, params: { id: '5' }, body: { active: true } })
  captured = await captureConsole(() => ctrl.setActive(env.req, env.res))
  assert.equal(env.res.body.active, true)
  assert.ok(captured.info.find((a) => String(a[0]).includes('"action":"activate"')))
})

test('controller: setActive rejects bodies missing the boolean flag', async () => {
  const { stub } = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN, params: { id: '5' }, body: {} })
  await ctrl.setActive(req, res)
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /\{ active: boolean \}/)
})

// ---------------------------------------------------------------------------
// remove flow
// ---------------------------------------------------------------------------

test('controller: remove returns 404 when row missing', async () => {
  const { stub } = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN, params: { id: '999' } })
  await ctrl.remove(req, res)
  assert.equal(res.statusCode, 404)
})

test('controller: remove deletes and audit-logs', async () => {
  const { stub } = makeServiceMock()
  stub.rows.set(8, {
    id: 8, sku: 'DEL', item_name: 'Del', item_id: '',
    report_group: 'slow_moving', active: true,
  })
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN, params: { id: '8' } })
  const captured = await captureConsole(() => ctrl.remove(req, res))
  assert.equal(res.statusCode, 204)
  assert.ok(captured.info.find((a) => String(a[0]).includes('"action":"delete"')))
  assert.ok(!stub.rows.has(8))
})

// ---------------------------------------------------------------------------
// list / filter flow
// ---------------------------------------------------------------------------

test('controller: list passes group, search and active filters to the service', async () => {
  const { calls, stub } = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({
    user: ADMIN,
    query: { group: 'slow_moving', search: 'shine', active: 'true' },
  })
  await ctrl.list(req, res)
  assert.equal(res.statusCode, 200)
  const adminListCall = calls.find((c) => c[0] === 'adminList')
  assert.deepEqual(adminListCall[1], { group: 'slow_moving', search: 'shine', active: true })
})

test('controller: list omits active filter when query.active is missing', async () => {
  const { calls, stub } = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN, query: {} })
  await ctrl.list(req, res)
  const adminListCall = calls.find((c) => c[0] === 'adminList')
  assert.equal(adminListCall[1].active, undefined)
})

test('controller: parseId rejects non-numeric ids with 400', async () => {
  const { stub } = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN, params: { id: 'abc' } })
  await ctrl.getOne(req, res)
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /Invalid id/)
})
