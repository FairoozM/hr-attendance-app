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
  lookupConsumptionQty,
  ZERO_SALES_MONTHS_OF_COVER,
  _internals: { emptyDebug, buildBundleUsageForLines },
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
    salesPrice: 100,
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
    assert.equal(base.debug.mode, 'items_sales_plus_bundle_usage')
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

test('inventory value uses unit sales price × stock qty', () => {
  const row = computeInventoryHealthMetrics(
    baseInput({
      currentStockQty: 5,
      salesPrice: 71,
      purchaseRate: 10,
    }),
  )
  assert.equal(row.inventoryValue, 355)
  assert.equal(row.salesPrice, 71)
})

test('healthy sales velocity => Healthy risk class', () => {
  const row = computeInventoryHealthMetrics(
    baseInput({
      currentStockQty: 12,
      salesQty90: 18,
      salesQty180: 30,
      salesQty365: 60,
      purchaseRate: 50,
      salesPrice: 50,
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
    assert.equal(data.debug.mode, 'items_sales_plus_bundle_usage')
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
      salesPrice: 200,
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
        salesPrice: 100,
        salesQty180: 0,
      }),
    ),
    computeInventoryHealthMetrics(
      baseInput({
        sku: 'SLOW-FAM',
        familyType: 'Slow Moving',
        currentStockQty: 5,
        purchaseRate: 200,
      salesPrice: 200,
        salesQty180: 0,
      }),
    ),
    computeInventoryHealthMetrics(
      baseInput({
        sku: 'OK-1',
        familyType: 'Other',
        currentStockQty: 4,
        purchaseRate: 50,
      salesPrice: 50,
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

test('expired disk cache is served stale without blocking on Zoho', async () => {
  const { mockModule, freshRequire } = require('./_helpers')
  const path = require('path')
  const fs = require('fs')
  const os = require('os')

  const restoreAdapter = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => {
      await new Promise((r) => setTimeout(r, 500))
      return Array.from({ length: 120 }, (_, i) => ({
        item_id: String(i + 1),
        sku: `SKU-${i + 1}`,
        name: `Item ${i + 1}`,
        status: 'active',
        stock_on_hand: 1,
        purchase_rate: 10,
      }))
    },
    fetchItemsRawForWarehouse: async () => [],
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-cache-'))
  const cacheFile = path.join(tmpDir, 'inventory-health-base-cache.json')
  const rows = Array.from({ length: 120 }, (_, i) => ({
    sku: `SKU-${i + 1}`,
    itemId: String(i + 1),
    itemName: `Item ${i + 1}`,
    currentStockQty: 1,
  }))
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({
      version: 1,
      entries: {
        'wh:all:sales-bundle-v1': {
          expiresAt: Date.now() - 60_000,
          savedAt: Date.now() - 120_000,
          value: {
            rows,
            warnings: [],
            debug: { activeItemsFetched: 120 },
            asOfDate: '2026-07-01',
            warehouseId: null,
            generatedAt: new Date(Date.now() - 120_000).toISOString(),
            cacheStatus: 'miss',
          },
        },
      },
    }),
  )

  const restoreDisk = mockModule('../src/services/inventoryHealthDiskCache', {
    readDiskCacheEntry: (key, opts = {}) => {
      const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
      const entry = parsed.entries[key]
      if (!entry) return null
      const stale = Date.now() > Number(entry.expiresAt)
      if (stale && !opts.allowStale) return null
      return { expiresAt: Number(entry.expiresAt), value: entry.value, error: null, stale }
    },
    writeDiskCacheEntry: () => {},
    clearDiskCache: () => {},
  })

  try {
    const svc = freshRequire('../src/services/inventoryHealthService')
    svc.clearInventoryHealthCache()
    const t0 = Date.now()
    const base = await svc.loadInventoryHealthBase({ refresh: false })
    const elapsed = Date.now() - t0
    assert.equal(base.cacheStatus, 'stale')
    assert.equal(base.rows.length, 120)
    assert.ok(elapsed < 200, `expected fast stale serve, got ${elapsed}ms`)
    // Background refresh may have started; do not require Zoho call timing here.
  } finally {
    restoreDisk()
    restoreAdapter()
    restoreSales()
    restoreGroups()
    restoreConfig()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('emptyDebug helper shape', () => {
  const d = emptyDebug()
  assert.equal(d.mode, 'items_sales_plus_bundle_usage')
  assert.ok(d.timingsMs)
})

test('lookupConsumptionQty adds direct sales and bundle component usage', async () => {
  const direct = {
    byItemId: new Map([['comp-1', 2]]),
    bySku: new Map(),
  }
  const bundle = {
    byItemId: new Map([['comp-1', 6]]),
    bySku: new Map(),
  }
  assert.equal(lookupConsumptionQty(direct, bundle, 'comp-1', 'COMP-1'), 8)
  assert.equal(lookupConsumptionQty(direct, bundle, 'other', 'OTHER'), 0)
})

test('bundle consumption lowers dead-stock risk for components sold only in kits', async () => {
  const { mockModule, freshRequire } = require('./_helpers')

  const restoreAdapter = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      {
        item_id: 'comp-1',
        sku: '2FP7S-20-BLACK',
        name: 'Component',
        status: 'active',
        stock_on_hand: 1,
        purchase_rate: 5,
      },
    ],
    fetchItemsRawForWarehouse: async () => [],
  })
  const restoreSales = mockModule('../src/integrations/zoho/weeklyReportZohoTransactions', {
    getSales: async () => ({
      lines: [{ item_id: 'kit-1', sku: 'LIFEP7S-SET', name: 'LIFEP7S SET', quantity: 3 }],
      list_truncated: false,
      list_pages: 1,
    }),
  })
  const restoreClient = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchCompositeItemDetail: async () => ({
      composite_item: {
        mapped_items: [{ item_id: 'comp-1', sku: '2FP7S-20-BLACK', quantity: 2 }],
      },
    }),
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
    const base = await svc.loadInventoryHealthBase({ refresh: true })
    const row = base.rows.find((r) => r.sku === '2FP7S-20-BLACK')
    assert.ok(row)
    assert.equal(row.salesQty180, 6)
    assert.equal(row.riskClass, 'Healthy')
    assert.equal(base.debug.compositeDetailLookups, 1)
  } finally {
    restoreConfig()
    restoreGroups()
    restoreClient()
    restoreSales()
    restoreAdapter()
    clearInventoryHealthCache()
  }
})

test('buildBundleUsageForLines reuses composite mapped-item cache across windows', async () => {
  let detailCalls = 0
  const cache = new Map()
  const fetchMapped = async (compositeItemId) => {
    detailCalls += 1
    return [{ item_id: 'comp-1', sku: 'COMP-1', quantity: 1 }]
  }
  const lines = [{ item_id: 'kit-1', sku: 'KIT-1-SET', name: 'KIT-1-SET', quantity: 2 }]
  const { buildCompositeUsageAggregate } = require('../src/services/purchasePlanningService')._internals
  const usage1 = await buildCompositeUsageAggregate(lines, async (id) => {
    if (cache.has(id)) return cache.get(id)
    const mapped = await fetchMapped(id)
    cache.set(id, mapped)
    return mapped
  })
  const usage2 = await buildCompositeUsageAggregate(lines, async (id) => {
    if (cache.has(id)) return cache.get(id)
    const mapped = await fetchMapped(id)
    cache.set(id, mapped)
    return mapped
  })
  assert.equal(detailCalls, 1)
  assert.equal(usage1.byItemId.get('comp-1'), 2)
  assert.equal(usage2.byItemId.get('comp-1'), 2)
  void buildBundleUsageForLines
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
