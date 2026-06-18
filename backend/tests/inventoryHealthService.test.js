/**
 * Unit tests for inventoryHealthService — fast V1 pipeline.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  computeInventoryHealthMetrics,
  buildSummary,
  computeMonthsOfCover,
  clearInventoryHealthCache,
  applyRowFilters,
  parseFilters,
  getInventoryHealthDashboard,
  loadInventoryHealthBase,
  ZERO_SALES_MONTHS_OF_COVER,
  _internals: { emptyDebug },
} = require('../src/services/inventoryHealthService')

function baseInput(overrides = {}) {
  return {
    sku: 'TEST-SKU',
    itemId: '123',
    itemName: 'Test Item',
    familyName: 'Normal Family',
    familyType: 'Other',
    currentStockQty: 10,
    availableStockQty: 10,
    purchaseRate: 100,
    salesQty90: 0,
    salesQty180: 0,
    salesQty365: 0,
    ...overrides,
  }
}

test('endpoint pipeline does not call invoice / last-sold helpers', async () => {
  const { mockModule, freshRequire } = require('./_helpers')
  let invoiceListCalls = 0
  let invoiceDetailCalls = 0

  const restoreAdapter = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      {
        item_id: '1',
        sku: 'SKU-A',
        name: 'Item A',
        status: 'active',
        stock_on_hand: 5,
        purchase_rate: 10,
      },
    ],
    fetchItemsRawForWarehouse: async () => [],
  })

  const restoreSales = mockModule('../src/integrations/zoho/weeklyReportZohoTransactions', {
    getSales: async () => ({
      lines: [{ item_id: '1', sku: 'SKU-A', quantity: 0 }],
      list_truncated: false,
      list_pages: 1,
    }),
  })

  const restoreClient = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async () => {
      invoiceListCalls += 1
      return { rows: [], truncated: false, pages: 0 }
    },
    zohoApiRequest: async (path) => {
      if (String(path).includes('/invoices/')) invoiceDetailCalls += 1
      return {}
    },
  })

  const restoreGroups = mockModule('../src/services/itemReportGroupsService', {
    listMembersOfGroup: async () => [],
  })

  const restoreConfig = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: null, organizationId: '1' }),
    INVENTORY_V1: '/inventory/v1',
  })

  clearInventoryHealthCache()

  try {
    const svc = freshRequire('../src/services/inventoryHealthService')
    svc.clearInventoryHealthCache()
    const base = await svc.loadInventoryHealthBase({ refresh: true })
    assert.equal(invoiceListCalls, 0)
    assert.equal(invoiceDetailCalls, 0)
    assert.equal(base.debug.mode, 'fast_items_sales_only')
    assert.ok(base.rows.length >= 1)
  } finally {
    restoreConfig()
    restoreGroups()
    restoreClient()
    restoreSales()
    restoreAdapter()
    clearInventoryHealthCache()
  }
})

test('normal family + stock > 0 + salesQty180 = 0 => hiddenSlowMoving true', () => {
  const row = computeInventoryHealthMetrics(
    baseInput({
      familyType: 'Other',
      currentStockQty: 5,
      salesQty180: 0,
    }),
  )
  assert.equal(row.hiddenSlowMoving, true)
  assert.equal(row.riskClass, 'Dead Stock')
  assert.ok(row.tags.includes('Hidden Slow Moving'))
})

test('slow moving family + stock > 0 + salesQty180 = 0 => hiddenSlowMoving false', () => {
  const row = computeInventoryHealthMetrics(
    baseInput({
      familyType: 'Slow Moving',
      currentStockQty: 8,
      salesQty180: 0,
    }),
  )
  assert.equal(row.hiddenSlowMoving, false)
  assert.equal(row.riskClass, 'Dead Stock')
  assert.ok(row.tags.includes('Slow Family'))
})

test('healthy sales velocity => Healthy risk class', () => {
  const row = computeInventoryHealthMetrics(
    baseInput({
      currentStockQty: 12,
      salesQty90: 18,
      salesQty180: 30,
      salesQty365: 60,
      purchaseRate: 50,
    }),
  )
  assert.equal(row.riskClass, 'Healthy')
  assert.equal(row.recommendedAction, 'No action needed')
})

test('monthsOfCover handles zero sales safely as 999', () => {
  assert.equal(computeMonthsOfCover(10, 0), ZERO_SALES_MONTHS_OF_COVER)
  assert.equal(computeMonthsOfCover(0, 5), 0)
  assert.equal(computeMonthsOfCover(24, 6), 4)
  const row = computeInventoryHealthMetrics(
    baseInput({ currentStockQty: 24, salesQty180: 0 }),
  )
  assert.equal(row.monthsOfCover, 999)
  assert.equal(row.riskClass, 'Dead Stock')
})

test('endpoint response includes debug timings', async () => {
  const { mockModule, freshRequire } = require('./_helpers')

  const restoreAdapter = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      { item_id: '9', sku: 'X', name: 'X', status: 'active', stock_on_hand: 2, purchase_rate: 1 },
    ],
  })
  const restoreSales = mockModule('../src/integrations/zoho/weeklyReportZohoTransactions', {
    getSales: async () => ({ lines: [], list_truncated: false, list_pages: 1 }),
  })
  const restoreGroups = mockModule('../src/services/itemReportGroupsService', {
    listMembersOfGroup: async () => [],
  })
  const restoreConfig = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: null, organizationId: '1' }),
  })

  clearInventoryHealthCache()

  try {
    const svc = freshRequire('../src/services/inventoryHealthService')
    svc.clearInventoryHealthCache()
    const data = await svc.getInventoryHealthDashboard({ includeZeroStock: 'false' })
    assert.ok(data.debug)
    assert.equal(data.debug.mode, 'fast_items_sales_only')
    assert.ok(typeof data.debug.timingsMs.total === 'number')
    assert.ok(data.debug.activeItemsFetched >= 1)
  } finally {
    restoreConfig()
    restoreGroups()
    restoreSales()
    restoreAdapter()
    clearInventoryHealthCache()
  }
})

test('includeZeroStock=false excludes zero stock items', () => {
  const rows = [
    computeInventoryHealthMetrics(baseInput({ sku: 'A', currentStockQty: 0 })),
    computeInventoryHealthMetrics(baseInput({ sku: 'B', currentStockQty: 3, salesQty180: 1 })),
  ]
  const filters = parseFilters({ includeZeroStock: 'false', minStockQty: '1' })
  const out = applyRowFilters(rows, filters)
  assert.equal(out.length, 1)
  assert.equal(out[0].sku, 'B')
})

test('riskScore is explainable and within 0–100', () => {
  const row = computeInventoryHealthMetrics(
    baseInput({
      currentStockQty: 100,
      salesQty180: 0,
      purchaseRate: 200,
    }),
  )
  assert.ok(row.riskScore >= 0 && row.riskScore <= 100)
  assert.ok(row.reason.length > 0)
  assert.ok(row.recommendedAction.length > 0)
})

test('deadStockValue and hiddenSlowMovingValue summary totals are correct', () => {
  const rows = [
    computeInventoryHealthMetrics(
      baseInput({
        sku: 'HIDDEN-1',
        familyType: 'Other',
        currentStockQty: 10,
        purchaseRate: 100,
        salesQty180: 0,
      }),
    ),
    computeInventoryHealthMetrics(
      baseInput({
        sku: 'SLOW-FAM',
        familyType: 'Slow Moving',
        currentStockQty: 5,
        purchaseRate: 200,
        salesQty180: 0,
      }),
    ),
    computeInventoryHealthMetrics(
      baseInput({
        sku: 'OK-1',
        familyType: 'Other',
        currentStockQty: 4,
        purchaseRate: 50,
        salesQty90: 12,
        salesQty180: 20,
        salesQty365: 40,
      }),
    ),
  ]

  const summary = buildSummary(rows, { cacheStatus: 'miss' })
  const hiddenRows = rows.filter((r) => r.hiddenSlowMoving)
  const deadRows = rows.filter((r) => r.riskClass === 'Dead Stock')

  assert.equal(
    summary.hiddenSlowMovingValue,
    hiddenRows.reduce((s, r) => s + r.inventoryValue, 0),
  )
  assert.equal(
    summary.deadStockValue,
    deadRows.reduce((s, r) => s + r.inventoryValue, 0),
  )
})

test('cache does not expose stale errors after clear', () => {
  clearInventoryHealthCache()
  assert.doesNotThrow(() => clearInventoryHealthCache())
})

test('emptyDebug helper shape', () => {
  const d = emptyDebug()
  assert.equal(d.mode, 'fast_items_sales_only')
  assert.ok(d.timingsMs)
})

test('non-admin access is blocked at route layer', async () => {
  const { mockModule, freshRequire, makeReqRes } = require('./_helpers')
  const restoreSvc = mockModule('../src/services/inventoryHealthService', {
    getInventoryHealthDashboard: async () => ({ summary: {}, rows: [], debug: emptyDebug() }),
  })
  const restoreAuth = mockModule('../src/middleware/auth', {
    requireAuth: (req, _res, next) => {
      req.user = { id: 2, role: 'employee' }
      next()
    },
    requireAdmin: (_req, res) => res.status(403).json({ error: 'Admin only' }),
    requirePermission: () => (_req, _res, next) => next(),
  })
  try {
    const zohoRoutes = freshRequire('../src/routes/zoho')
    const layer = zohoRoutes.stack.find(
      (l) => l.route && l.route.path === '/inventory-health' && l.route.methods.get,
    )
    assert.ok(layer, 'inventory-health route exists')
    const handlers = layer.route.stack.map((s) => s.handle)
    const { req, res } = makeReqRes({ query: {} })
    let idx = 0
    const run = () => {
      if (idx >= handlers.length) return
      const fn = handlers[idx]
      idx += 1
      fn(req, res, run)
    }
    run()
    assert.equal(res.statusCode, 403)
  } finally {
    restoreAuth()
    restoreSvc()
  }
})

// silence unused import lint in node test file
void getInventoryHealthDashboard
void loadInventoryHealthBase
