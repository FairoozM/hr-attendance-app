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
const ExcelJS = require('exceljs')
const { clearReportCache } = require('../src/services/weeklyReportCache')
const { mockModule, freshRequire, makeReqRes, captureConsole } = require('./_helpers')

test.beforeEach(() => {
  clearReportCache()
})

function makeError(code, message, extra = {}) {
  const e = new Error(message)
  e.code = code
  Object.assign(e, extra)
  return e
}

function loadController({ getInventoryByGroup, listGroupKeys }) {
  mockModule('../src/services/zohoService', {
    getInventoryByGroup,
  })
  mockModule('../src/services/itemReportGroupsService', {
    listGroupKeys,
  })
  return freshRequire('../src/controllers/weeklyReportsController')
}

const VALID = { from_date: '2026-01-01', to_date: '2026-01-07' }

const emptyZoho = async () => ({ items: [], reportMeta: { warnings: [] } })
const wrapItems = (items) => async () => ({ items, reportMeta: { warnings: [] } })

// ---------------------------------------------------------------------------
// Date / group validation
// ---------------------------------------------------------------------------

test('weeklyReports: rejects missing date params with 400', async () => {
  const ctrl = loadController({
    getInventoryByGroup: emptyZoho,
    listGroupKeys: async () => ['slow_moving'],
  })
  const { req, res } = makeReqRes({ params: { group: 'slow_moving' }, query: {} })
  await ctrl.getReportByGroup(req, res)
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /from_date and to_date/)
})

test('weeklyReports: rejects malformed dates with 400', async () => {
  const ctrl = loadController({
    getInventoryByGroup: emptyZoho,
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
    getInventoryByGroup: emptyZoho,
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
    getInventoryByGroup: emptyZoho,
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
    getInventoryByGroup: emptyZoho,
    listGroupKeys: async () => ['slow_moving'],
  })
  const { req, res } = makeReqRes({ params: { group: 'slow_moving' }, query: VALID })
  await ctrl.getReportByGroup(req, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.items, [])
  assert.deepEqual(res.body.totals, {
    opening_stock: 0,
    closing_stock: 0,
    purchase_amount: 0,
    returned_to_wholesale: 0,
    sales_amount: 0,
  })
  assert.equal(res.body.report_group, 'slow_moving')
})

test('weeklyReports: Grand Total sums Zoho-provided numbers verbatim', async () => {
  const ctrl = loadController({
    getInventoryByGroup: wrapItems([
      { family: 'ZDS', opening_stock: 100, purchase_amount: 10, returned_to_wholesale: 1, closing_stock: 109, sales_amount: 0 },
      { family: 'LIFEP', opening_stock:  50, purchase_amount:  5, returned_to_wholesale: 0, closing_stock:  45, sales_amount: 10 },
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
    purchase_amount: 15,
    returned_to_wholesale: 1,
    closing_stock: 154,
    sales_amount: 10,
  })
})

test('weeklyReports: family-details filters cached report itemDetails without a second Zoho fetch', async () => {
  const invCalls = []
  const getInventoryByGroup = async (group, from, to, warehouseId, excludeWarehouseId, options) => {
    invCalls.push({ group, from, to, warehouseId, excludeWarehouseId, options })
    return {
      items: [
        { family: 'LIFEP17S', opening_stock: 1, purchase_amount: 0, returned_to_wholesale: 0, closing_stock: 1, sales_amount: 0 },
      ],
      itemDetails: [
        { family: 'LIFEP17S', family_display: 'LIFEP17S', sku: 'A', item_name: 'A', opening_qty: 1 },
        { family: 'OTHER', family_display: 'OTHER', sku: 'B', item_name: 'B', opening_qty: 1 },
      ],
      reportMeta: { warnings: [] },
    }
  }
  const ctrl = loadController({
    getInventoryByGroup,
    listGroupKeys: async () => ['slow_moving'],
  })
  {
    const { req, res } = makeReqRes({
      params: { group: 'slow_moving' },
      query: { ...VALID, exclude_warehouse_id: 'damaged' },
    })
    await ctrl.getReportByGroup(req, res)
    assert.equal(res.statusCode, 200)
  }
  {
    const { req, res } = makeReqRes({
      params: { group: 'slow_moving' },
      query: { ...VALID, exclude_warehouse_id: 'damaged', family: 'LIFEP17S' },
    })
    await ctrl.getFamilyDetailsByGroupController(req, res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body.items.map((r) => r.sku), ['A'])
  }
  assert.equal(invCalls.length, 1)
  assert.equal(invCalls[0].options.includeItemDetails, true)
})

test('weeklyReports: export.xlsx uses the same getInventoryByGroup + items as JSON (adapter pipeline)', async () => {
  const sharedItems = [
    {
      family: 'Fam',
      opening_stock: 1,
      purchase_amount: 2,
      returned_to_wholesale: 0,
      closing_stock: 4,
      sales_amount: 3,
      _zoho: { from_date: '2026-01-01', to_date: '2026-01-07', family: 'Fam' },
    },
  ]
  const invCalls = []
  const getInventoryByGroup = async (group, from, to) => {
    invCalls.push({ group, from, to })
    return { items: sharedItems, reportMeta: { warnings: [] } }
  }
  const ctrl = loadController({
    getInventoryByGroup,
    listGroupKeys: async () => ['slow_moving', 'other_family'],
  })
  const { req, res } = makeReqRes({ params: { group: 'slow_moving' }, query: VALID })
  await ctrl.getReportByGroup(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.items.length, 1)
  assert.equal(res.body.items[0].family, 'Fam')
  const expected = { group: 'slow_moving', from: '2026-01-01', to: '2026-01-07' }
  assert.deepEqual(invCalls[0], expected)
  clearReportCache('slow_moving', '2026-01-01', '2026-01-07')

  const { req: req2, res: res2 } = makeReqRes({ params: { group: 'slow_moving' }, query: VALID })
  res2.setHeader = () => {}
  await ctrl.exportReportByGroupXlsx(req2, res2)
  assert.equal(res2.statusCode, 200)
  assert.equal(invCalls.length, 2)
  assert.deepEqual(invCalls[1], expected)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(res2.body)
  const sheet = wb.getWorksheet('Report')
  assert.equal(String(sheet.getCell('B5').value), 'Fam')
  // C = Photo, D = Zoho item id, E..I = monetary columns (ending with Sales in I)
  assert.equal(Number(sheet.getCell('I5').value), 3) // sales_amount
  const totalRow = 5 + res.body.items.length
  assert.equal(Number(sheet.getCell(`E${totalRow}`).value), res.body.totals.opening_stock)
  assert.equal(Number(sheet.getCell(`F${totalRow}`).value), res.body.totals.purchase_amount)
  assert.equal(Number(sheet.getCell(`G${totalRow}`).value), res.body.totals.returned_to_wholesale)
  assert.equal(Number(sheet.getCell(`H${totalRow}`).value), res.body.totals.closing_stock)
  assert.equal(Number(sheet.getCell(`I${totalRow}`).value), res.body.totals.sales_amount)
})

test('weeklyReports: other_family export.xlsx uses same getInventoryByGroup + totals as JSON', async () => {
  const invCalls = []
  const getInventoryByGroup = async (group, from, to) => {
    invCalls.push({ group, from, to })
    return {
      items: [
        { family: 'X', opening_stock: 0, purchase_amount: 0, returned_to_wholesale: 0, closing_stock: 0, sales_amount: 0 },
      ],
      reportMeta: { warnings: [] },
    }
  }
  const ctrl = loadController({
    getInventoryByGroup,
    listGroupKeys: async () => ['slow_moving', 'other_family'],
  })
  const { req, res } = makeReqRes({ params: { group: 'other_family' }, query: VALID })
  await ctrl.getReportByGroup(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.report_group, 'other_family')
  clearReportCache('other_family', '2026-01-01', '2026-01-07')
  const { req: req2, res: res2 } = makeReqRes({ params: { group: 'other_family' }, query: VALID })
  res2.setHeader = () => {}
  await ctrl.exportReportByGroupXlsx(req2, res2)
  assert.equal(invCalls.length, 2)
  assert.deepEqual(invCalls[0], { group: 'other_family', from: '2026-01-01', to: '2026-01-07' })
  assert.deepEqual(invCalls[1], { group: 'other_family', from: '2026-01-01', to: '2026-01-07' })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(res2.body)
  const sheet = wb.getWorksheet('Report')
  const totalRow = 5 + res.body.items.length
  assert.equal(Number(sheet.getCell(`E${totalRow}`).value), res.body.totals.opening_stock)
  assert.equal(Number(sheet.getCell(`I${totalRow}`).value), res.body.totals.sales_amount)
})

test('weeklyReports: empty export xlsx grand total matches API totals (all zeros)', async () => {
  const ctrl = loadController({
    getInventoryByGroup: emptyZoho,
    listGroupKeys: async () => ['other_family', 'slow_moving'],
  })
  const { req, res } = makeReqRes({ params: { group: 'other_family' }, query: VALID })
  await ctrl.getReportByGroup(req, res)
  const { req: req2, res: res2 } = makeReqRes({ params: { group: 'other_family' }, query: VALID })
  res2.setHeader = () => {}
  await ctrl.exportReportByGroupXlsx(req2, res2)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(res2.body)
  const sheet = wb.getWorksheet('Report')
  assert.equal(String(sheet.getCell('B5').value), 'Grand Total')
  assert.equal(Number(sheet.getCell('E5').value), res.body.totals.opening_stock)
  assert.equal(Number(sheet.getCell('F5').value), res.body.totals.purchase_amount)
  assert.equal(Number(sheet.getCell('G5').value), res.body.totals.returned_to_wholesale)
  assert.equal(Number(sheet.getCell('H5').value), res.body.totals.closing_stock)
  assert.equal(Number(sheet.getCell('I5').value), res.body.totals.sales_amount)
})

// ---------------------------------------------------------------------------
// Zoho error → HTTP status mapping
// ---------------------------------------------------------------------------

const ERROR_CASES = [
  { code: 'ZOHO_NOT_CONFIGURED',      status: 503 },
  { code: 'ZOHO_OAUTH_ERROR',         status: 502 },
  { code: 'ZOHO_API_ERROR',           status: 502 },
  { code: 'ZOHO_API_NETWORK_ERROR',   status: 502 },
  { code: 'ZOHO_API_TIMEOUT',         status: 504 },
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
    getInventoryByGroup: async (group) =>
      group === 'slow_moving'
        ? { items: [{ sku: 'A', item_name: 'A', family: '', opening_stock: 5, purchase_amount: 0, returned_to_wholesale: 0, closing_stock: 5, sales_amount: 0 }], reportMeta: { warnings: [] } }
        : { items: [], reportMeta: { warnings: [] } },
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
    getInventoryByGroup: emptyZoho,
    listGroupKeys: async () => ['other_family', 'slow_moving'],
  })
  const { req, res } = makeReqRes({})
  await ctrl.listAvailableGroups(req, res)
  assert.deepEqual(res.body.groups, ['other_family', 'slow_moving'])
})

test('getZohoItemImage: proxies Zoho image buffer with 200', async (t) => {
  const zohoItemImageCache = require('../src/services/zohoItemImageCache')
  zohoItemImageCache.clear()
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchZohoItemImageBuffer: async (id) => {
      assert.equal(id, '4815000000044208')
      return { buffer: Buffer.from([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }
    },
  })
  t.after(() => {
    r1()
    zohoItemImageCache.clear()
  })
  const ctrl = freshRequire('../src/controllers/weeklyReportsController')
  const { req, res } = makeReqRes({ params: { itemId: '4815000000044208' } })
  res.setHeader = () => {}
  await ctrl.getZohoItemImage(req, res)
  assert.equal(res.statusCode, 200)
  assert.ok(Buffer.isBuffer(res.body))
  assert.equal(res.body.length, 3)
})

test('getZohoItemImage: 404 when Zoho has no image', async (t) => {
  const zohoItemImageCache = require('../src/services/zohoItemImageCache')
  zohoItemImageCache.clear()
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchZohoItemImageBuffer: async () => null,
  })
  t.after(() => {
    r1()
    zohoItemImageCache.clear()
  })
  const ctrl = freshRequire('../src/controllers/weeklyReportsController')
  const { req, res } = makeReqRes({ params: { itemId: '999' } })
  res.setHeader = () => {}
  res.end = () => {
    res.headersSent = true
  }
  await ctrl.getZohoItemImage(req, res)
  assert.equal(res.statusCode, 404)
})

test('getZohoItemImage: second GET serves from in-memory cache (one Zoho fetch)', async (t) => {
  const zohoItemImageCache = require('../src/services/zohoItemImageCache')
  zohoItemImageCache.clear()
  let zohoFetches = 0
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchZohoItemImageBuffer: async (id) => {
      zohoFetches += 1
      assert.equal(id, '111')
      return { buffer: Buffer.from([1, 2, 3]), contentType: 'image/png' }
    },
  })
  t.after(() => {
    r1()
    zohoItemImageCache.clear()
  })
  const ctrl = freshRequire('../src/controllers/weeklyReportsController')
  const { req, res: res1 } = makeReqRes({ params: { itemId: '111' } })
  res1.setHeader = () => {}
  await ctrl.getZohoItemImage(req, res1)
  const res2 = { ...res1, body: undefined, statusCode: 200, headersSent: false, send(payload) { this.body = payload; this.headersSent = true; return this } }
  res2.setHeader = () => {}
  res2.status = (c) => { res2.statusCode = c; return res2 }
  await ctrl.getZohoItemImage(req, res2)
  assert.equal(
    zohoFetches,
    zohoItemImageCache.IMAGE_CACHE_ENABLED ? 1 : 2,
    zohoItemImageCache.IMAGE_CACHE_ENABLED
      ? 'Zoho should only be called once for the same item id when in-memory image cache is on'
      : 'Zoho is called on each request when in-memory image cache is off'
  )
  assert.ok(Buffer.isBuffer(res2.body))
  assert.equal(res2.body.length, 3)
})
