/**
 * Unit tests for backend/src/controllers/weeklyReportsController.js
 *
 * The Zoho service and the item-report-groups service are mocked. We focus on
 * the contract the frontend relies on:
 *   - Date validation (400)
 *   - Unknown report group (404)
 *   - Each Zoho error code maps to the documented HTTP status
 *   - Empty results still produce a well-formed response with a Grand Total
 *     row of zeros (export-friendly)
 *   - Inactive mappings are honoured (the controller delegates that to
 *     listGroupKeys / listMembersOfGroup, both of which already filter on
 *     active=true — covered in itemReportGroupsService.test.js)
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire, makeReqRes, captureConsole } = require('./_helpers')

function makeError(code, message, extra = {}) {
  const e = new Error(message)
  e.code = code
  Object.assign(e, extra)
  return e
}

function loadController({ getInventoryByGroup, getSlowMovingInventory, listGroupKeys }) {
  mockModule('../src/services/zohoService', {
    getInventoryByGroup,
    getSlowMovingInventory,
  })
  mockModule('../src/services/itemReportGroupsService', {
    listGroupKeys,
  })
  return freshRequire('../src/controllers/weeklyReportsController')
}

const VALID = { from_date: '2026-01-01', to_date: '2026-01-07' }

// ---------------------------------------------------------------------------
// Date / group validation
// ---------------------------------------------------------------------------

test('weeklyReports: rejects missing date params with 400', async () => {
  const ctrl = loadController({
    getInventoryByGroup: async () => [],
    listGroupKeys: async () => ['slow_moving'],
  })
  const { req, res } = makeReqRes({ params: { group: 'slow_moving' }, query: {} })
  await ctrl.getReportByGroup(req, res)
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /from_date and to_date/)
})

test('weeklyReports: rejects malformed dates with 400', async () => {
  const ctrl = loadController({
    getInventoryByGroup: async () => [],
    listGroupKeys: async () => ['slow_moving'],
  })
  const { req, res } = makeReqRes({
    params: { group: 'slow_moving' },
    query: { from_date: '2026-1-1', to_date: '2026-1-7' },
  })
  await ctrl.getReportByGroup(req, res)
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /YYYY-MM-DD/)
})

test('weeklyReports: rejects from_date > to_date with 400', async () => {
  const ctrl = loadController({
    getInventoryByGroup: async () => [],
    listGroupKeys: async () => ['slow_moving'],
  })
  const { req, res } = makeReqRes({
    params: { group: 'slow_moving' },
    query: { from_date: '2026-01-08', to_date: '2026-01-01' },
  })
  await ctrl.getReportByGroup(req, res)
  assert.equal(res.statusCode, 400)
})

test('weeklyReports: unknown report_group returns 404 with available groups listed', async () => {
  const ctrl = loadController({
    getInventoryByGroup: async () => [],
    listGroupKeys: async () => ['slow_moving', 'other_family'],
  })
  const { req, res } = makeReqRes({ params: { group: 'does_not_exist' }, query: VALID })
  await ctrl.getReportByGroup(req, res)
  assert.equal(res.statusCode, 404)
  assert.match(res.body.error, /Unknown report_group/)
  assert.match(res.body.error, /slow_moving/)
})

// ---------------------------------------------------------------------------
// Empty-result / Grand Total
// ---------------------------------------------------------------------------

test('weeklyReports: empty result returns 200 with all-zero Grand Total', async () => {
  const ctrl = loadController({
    getInventoryByGroup: async () => [],
    listGroupKeys: async () => ['slow_moving'],
  })
  const { req, res } = makeReqRes({ params: { group: 'slow_moving' }, query: VALID })
  await ctrl.getReportByGroup(req, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.items, [])
  assert.deepEqual(res.body.totals, {
    opening_stock: 0,
    purchases: 0,
    returned_to_wholesale: 0,
    closing_stock: 0,
    sold: 0,
  })
  assert.equal(res.body.report_group, 'slow_moving')
})

test('weeklyReports: Grand Total sums Zoho-provided numbers verbatim', async () => {
  const ctrl = loadController({
    getInventoryByGroup: async () => ([
      { sku: 'A', item_name: 'A', family: 'ZDS', opening_stock: 100, purchases: 10, returned_to_wholesale: 1, closing_stock: 109, sold: 0 },
      { sku: 'B', item_name: 'B', family: 'LIFEP', opening_stock:  50, purchases:  5, returned_to_wholesale: 0, closing_stock:  45, sold: 10 },
    ]),
    listGroupKeys: async () => ['slow_moving'],
  })
  const { req, res } = makeReqRes({ params: { group: 'slow_moving' }, query: VALID })
  await ctrl.getReportByGroup(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.items[0].family, 'ZDS')
  assert.equal(res.body.items[1].family, 'LIFEP')
  assert.deepEqual(res.body.totals, {
    opening_stock: 150,
    purchases: 15,
    returned_to_wholesale: 1,
    closing_stock: 154,
    sold: 10,
  })
})

// ---------------------------------------------------------------------------
// Zoho error → HTTP status mapping
// ---------------------------------------------------------------------------

const ERROR_CASES = [
  { code: 'ZOHO_NOT_CONFIGURED',      status: 503 },
  { code: 'ZOHO_WEBHOOK_TIMEOUT',     status: 504 },
  { code: 'ZOHO_WEBHOOK_HTTP_ERROR',  status: 502 },
  { code: 'ZOHO_WEBHOOK_NETWORK_ERROR', status: 502 },
]

for (const { code, status } of ERROR_CASES) {
  test(`weeklyReports: ${code} → HTTP ${status} with code in body`, async () => {
    const ctrl = loadController({
      getInventoryByGroup: async () => { throw makeError(code, `boom ${code}`) },
      listGroupKeys: async () => ['slow_moving'],
    })
    const { req, res } = makeReqRes({ params: { group: 'slow_moving' }, query: VALID })
    await captureConsole(() => ctrl.getReportByGroup(req, res))
    assert.equal(res.statusCode, status, `expected ${status} for ${code}`)
    assert.equal(res.body.code, code)
  })
}

test('weeklyReports: WEBHOOK_INVALID_RESPONSE → 502 with validation_errors[]', async () => {
  const ctrl = loadController({
    getInventoryByGroup: async () => {
      throw makeError('WEBHOOK_INVALID_RESPONSE', 'invalid', {
        validation_errors: ['items[0]: "sku" is required', 'items[1]: bad number'],
      })
    },
    listGroupKeys: async () => ['slow_moving'],
  })
  const { req, res } = makeReqRes({ params: { group: 'slow_moving' }, query: VALID })
  await captureConsole(() => ctrl.getReportByGroup(req, res))
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.code, 'WEBHOOK_INVALID_RESPONSE')
  assert.deepEqual(res.body.validation_errors, [
    'items[0]: "sku" is required',
    'items[1]: bad number',
  ])
})

test('weeklyReports: unknown error code falls back to 502 (and never 200)', async () => {
  const ctrl = loadController({
    getInventoryByGroup: async () => { throw makeError('SOMETHING_NEW', 'mystery') },
    listGroupKeys: async () => ['slow_moving'],
  })
  const { req, res } = makeReqRes({ params: { group: 'slow_moving' }, query: VALID })
  await captureConsole(() => ctrl.getReportByGroup(req, res))
  assert.equal(res.statusCode, 502)
})

// ---------------------------------------------------------------------------
// Legacy slow-moving route still works and shares the same error handling
// ---------------------------------------------------------------------------

test('weeklyReports: legacy /slow-moving keeps same response shape', async () => {
  const ctrl = loadController({
    getSlowMovingInventory: async () => ([
      { sku: 'A', item_name: 'A', family: '', opening_stock: 5, purchases: 0, returned_to_wholesale: 0, closing_stock: 5, sold: 0 },
    ]),
    listGroupKeys: async () => ['slow_moving'],
  })
  const { req, res } = makeReqRes({ query: VALID })
  await ctrl.getSlowMovingReport(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.items.length, 1)
  assert.equal(res.body.totals.opening_stock, 5)
})

test('weeklyReports: listAvailableGroups returns active groups', async () => {
  const ctrl = loadController({
    getInventoryByGroup: async () => [],
    listGroupKeys: async () => ['other_family', 'slow_moving'],
  })
  const { req, res } = makeReqRes({})
  await ctrl.listAvailableGroups(req, res)
  assert.deepEqual(res.body.groups, ['other_family', 'slow_moving'])
})
