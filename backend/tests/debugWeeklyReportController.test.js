/**
 * GET /api/debug/weekly-report/by-group/:group — non-prod; mocked services.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { mockModule, freshRequire, makeReqRes } = require('./_helpers')

function pathToTests(relative) {
  return path.join(__dirname, relative)
}

test('getWeeklyReportDebugByGroup: 404 in production', async (t) => {
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  t.after(() => {
    if (prev === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prev
  })
  const { getWeeklyReportDebugByGroup } = require('../src/controllers/debugWeeklyReportController')
  const { req, res } = makeReqRes({
    params: { group: 'slow_moving' },
    query: { from_date: '2026-01-01', to_date: '2026-01-31' },
  })
  await getWeeklyReportDebugByGroup(req, res)
  assert.equal(res.statusCode, 404)
  assert.match(res.body.error, /disabled in production|production/i)
})

test('getWeeklyReportDebugByGroup: rows, totals, row_debug, zoho, report_debug', async (t) => {
  const prevN = process.env.NODE_ENV
  if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'test'
  t.after(() => {
    if (prevN === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevN
    for (const rel of [
      '../src/services/zohoService.js',
      '../src/services/itemReportGroupsService.js',
      '../src/controllers/weeklyReportsController.js',
      '../src/controllers/debugWeeklyReportController.js',
    ]) {
      try {
        delete require.cache[require.resolve(pathToTests(rel))]
      } catch {
        // ignore
      }
    }
  })

  const r1 = mockModule('../src/services/zohoService', {
    getInventoryByGroup: async () => ({
      items: [
        {
          sku: 'A',
          item_name: 'A',
          item_id: '1',
          family: 'F',
          opening_stock: 1,
          purchase_amount: 0,
          returned_to_wholesale: 0,
          closing_stock: 1,
          sales_amount: 0,
          _zoho: { from_date: '2026-01-01', to_date: '2026-01-31', family: 'F' },
        },
      ],
      reportMeta: {
        warnings: ['w1'],
        transaction_debug: { sales_source_count: 1 },
      },
    }),
  })
  const r2 = mockModule('../src/services/itemReportGroupsService', {
    listGroupKeys: async () => ['slow_moving', 'other_family'],
  })
  const r3 = mockModule('../src/services/zohoApiClient', {
    getDailySuccessCount: async () => 0,
    getZohoGuardStatus: () => ({
      syncPausedUntil: null,
      perMinuteLimit: 70,
      dailyLimit: 9000,
      warningLimit: 7000,
      safeStopLimit: 8500,
      cacheEnabled: true,
      limits: { minuteWindowSize: 0 },
    }),
  })
  t.after(() => {
    r1()
    r2()
    r3()
  })

  delete require.cache[require.resolve(pathToTests('../src/controllers/weeklyReportsController.js'))]
  const { getWeeklyReportDebugByGroup } = freshRequire('../src/controllers/debugWeeklyReportController')

  const { req, res } = makeReqRes({
    params: { group: 'slow_moving' },
    query: { from_date: '2026-01-01', to_date: '2026-01-31' },
  })
  await getWeeklyReportDebugByGroup(req, res)
  assert.equal(res.statusCode, 200, JSON.stringify(res.body))
  assert.equal(res.body.rows.length, 1)
  assert.equal(res.body.totals.closing_stock, 1)
  assert.equal(res.body.rows[0].sku, 'A')
  assert.ok(res.body.rows[0].row_debug && res.body.rows[0].row_debug._zoho)
  assert.equal(res.body.rows[0].row_debug._zoho.from_date, '2026-01-01')
  assert.equal(res.body.zoho && res.body.zoho.data_source, 'zoho_inventory_rest_v1')
  assert.equal(res.body.zoho && res.body.zoho.transaction_debug && res.body.zoho.transaction_debug.sales_source_count, 1)
  assert.equal(res.body.zoho.api_usage_today.successful_calls, 0)
  assert.equal(res.body.zoho.api_usage_today.daily_limit, 9000)
  assert.equal(res.body.report_debug.transaction_debug.sales_source_count, 1)
  assert.ok(res.body.report_debug.warnings.includes('w1'))
})

test('getWeeklyReportDebugByGroup: 400 on bad dates', async (t) => {
  if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'test'
  const { getWeeklyReportDebugByGroup } = require('../src/controllers/debugWeeklyReportController')
  const { req, res } = makeReqRes({
    params: { group: 'slow_moving' },
    query: {},
  })
  await getWeeklyReportDebugByGroup(req, res)
  assert.equal(res.statusCode, 400)
})
