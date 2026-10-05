'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createControlTowerJobs } = require('../src/services/amazonControlTower/controlTowerJobs.ts')

const NOW = new Date('2026-10-05T09:30:00Z') // 12:30 Riyadh

function fakeStore() {
  const calls: Record<string, any[]> = {}
  const record = (name: string, args: any) => {
    ;(calls[name] = calls[name] || []).push(args)
  }
  const store: any = {
    calls,
    skuRows: [] as any[],
    catalog: [] as any[],
    lines: [] as any[],
    async getSettings() {
      return { marketplaceKey: 'ksa', timezone: 'Asia/Riyadh', vatRate: 0.15, lowStockUnitsThreshold: 10 }
    },
    async upsertListings(mk: string, rows: any[], seenAt: Date) {
      record('upsertListings', { mk, rows, seenAt })
      return rows.length
    },
    async markListingsNotSeenInactive(mk: string, seenAt: Date) {
      record('markListingsNotSeenInactive', { mk, seenAt })
      return 2
    },
    async latestWarehouseCatalog() {
      return store.catalog
    },
    async listSkusForAutoMatch() {
      return store.skuRows
    },
    async applyAutoMatches(mk: string, updates: any[]) {
      record('applyAutoMatches', { mk, updates })
      return updates.length
    },
    async writeInventorySnapshot(mk: string, rows: any[], meta: any) {
      record('writeInventorySnapshot', { mk, rows, meta })
      return rows.length
    },
    async upsertInventorySkus(mk: string, rows: any[]) {
      record('upsertInventorySkus', { mk, rows })
      return rows.length
    },
    async writeWarehouseSnapshot(rows: any[], meta: any) {
      record('writeWarehouseSnapshot', { rows, meta })
      return rows.length
    },
    async selectOrderLinesForRollup(mk: string, start: Date, end: Date) {
      record('selectOrderLinesForRollup', { mk, start, end })
      return store.lines.filter((l: any) => new Date(l.purchase_date) >= start && new Date(l.purchase_date) < end)
    },
    async replaceDailySales(mk: string, fromDate: string, toDate: string, rows: any[]) {
      record('replaceDailySales', { mk, fromDate, toDate, rows })
      return { deleted: 0, written: rows.length }
    },
    async orderLineCoverage() {
      return { firstPurchaseAt: null, lastPurchaseAt: null, lineCount: 0 }
    },
  }
  return store
}

function ctxFor(params: Record<string, any> = {}) {
  const steps: string[] = []
  return {
    run: { id: 'run-1' },
    marketplaceKey: 'ksa',
    params,
    steps,
    progress(step: string) {
      steps.push(step)
    },
    setRecords() {},
  }
}

function makeJobs(store: any, overrides: Record<string, any> = {}) {
  return createControlTowerJobs({
    store,
    now: () => NOW,
    sleep: async () => {},
    amazon: {
      fetchActiveAmazonListings: async () => ({ listings: [], fetchedAt: NOW.toISOString() }),
      getAmazonFbaInventorySummaries: async () => ({ status: 200, data: { payload: { inventorySummaries: [] } } }),
      throwAmazonSpApiIfFailed: () => {},
      marketplaceIdForKey: () => 'A17E79C6D8DWNP',
      ...(overrides.amazon || {}),
    },
    orders: {
      syncAmazonOrderReport: async () => ({ rowsParsed: 0, rowsSaved: 0, reused: false }),
      findSuccessfulReportRunCoveringRange: async () => null,
      ...(overrides.orders || {}),
    },
    zoho: {
      resolveLifeSmileWarehouse: async () => ({ warehouseId: 'wh1', warehouseName: 'Life Smile Warehouse' }),
      fetchItemsRawForWarehouse: async () => [],
      ...(overrides.zoho || {}),
    },
    backfillCreateSpacingMs: 0,
  })
}

describe('Control Tower job handlers', () => {
  it('listings: refuses to touch the SKU master when Amazon returns no listings', async () => {
    const store = fakeStore()
    const jobs = makeJobs(store)
    await assert.rejects(() => jobs.handlers.listings(ctxFor()), /no active listings/)
    assert.equal(store.calls.upsertListings, undefined)
    assert.equal(store.calls.markListingsNotSeenInactive, undefined)
  })

  it('listings: upserts all KSA listings (not only Seller Flex) and suggests matches', async () => {
    const store = fakeStore()
    store.catalog = [{ zohoItemId: 'z1', itemCode: 'SKU-A', itemName: 'A' }]
    store.skuRows = [{ id: 1, sellerSku: 'SKU-A' }, { id: 2, sellerSku: 'SKU-Z' }]
    let sellerFlexOnly: unknown = 'unset'
    const jobs = makeJobs(store, {
      amazon: {
        fetchActiveAmazonListings: async (p: any) => {
          sellerFlexOnly = p.sellerFlexOnly
          return {
            fetchedAt: NOW.toISOString(),
            listings: [
              { sellerSku: 'SKU-A', normalizedSku: 'SKU-A', asin: 'B0A', title: 'A', fulfillmentChannel: 'AMAZON_EU' },
              { sellerSku: 'SKU-Z', normalizedSku: 'SKU-Z', asin: 'B0Z', title: 'Z', fulfillmentChannel: 'DEFAULT' },
            ],
          }
        },
      },
    })
    const out = await jobs.handlers.listings(ctxFor())
    assert.equal(sellerFlexOnly, false)
    assert.equal(out.recordsProcessed, 2)
    assert.equal(store.calls.upsertListings[0].rows.length, 2)
    const updates = store.calls.applyAutoMatches[0].updates
    assert.equal(updates.find((u: any) => u.id === 1).status, 'AUTO_MATCHED')
    assert.equal(updates.find((u: any) => u.id === 2).status, 'UNMAPPED')
    assert.equal(out.metadata.autoMatch.AUTO_MATCHED, 1)
  })

  it('auto-match is skipped until a warehouse snapshot exists', async () => {
    const store = fakeStore()
    const jobs = makeJobs(store)
    const res = await jobs.runAutoMatch('ksa')
    assert.match(res.skipped, /No warehouse stock snapshot/)
    assert.equal(store.calls.applyAutoMatches, undefined)
  })

  it('sales: requests the last 3 Riyadh days through the existing report sync (replace mode)', async () => {
    const store = fakeStore()
    let params: any = null
    const jobs = makeJobs(store, {
      orders: {
        syncAmazonOrderReport: async (p: any) => {
          params = p
          return { reportId: 'R1', rowsParsed: 10, rowsSaved: 10, rowsRemoved: 0, uniqueOrders: 7, reused: false }
        },
      },
    })
    const out = await jobs.handlers.sales(ctxFor())
    assert.equal(params.marketplaceKey, 'ksa')
    assert.equal(params.dataStartTime.toISOString(), '2026-10-02T21:00:00.000Z')
    assert.equal(params.dataEndTime.toISOString(), '2026-10-05T09:28:00.000Z')
    assert.equal(params.preserveExisting, undefined)
    assert.equal(out.recordsProcessed, 10)
  })

  it('rollup: rebuilds the requested local-date range from stored lines', async () => {
    const store = fakeStore()
    store.lines = [
      { amazon_order_id: 'o1', purchase_date: '2026-10-04T10:00:00Z', seller_sku: 'SKU-A', quantity: 1, item_price: '115', item_status: 'Shipped' },
      { amazon_order_id: 'o2', purchase_date: '2026-10-04T22:00:00Z', seller_sku: 'SKU-A', quantity: 2, item_price: '230', item_status: 'Shipped' },
    ]
    const jobs = makeJobs(store)
    const out = await jobs.handlers.rollup(ctxFor({ fromDate: '2026-10-04', toDate: '2026-10-05' }))
    const call = store.calls.replaceDailySales[0]
    assert.equal(call.fromDate, '2026-10-04')
    assert.equal(call.toDate, '2026-10-05')
    assert.deepEqual(call.rows.map((r: any) => [r.salesDate, r.unitsOrdered, r.netSalesExVat]), [
      ['2026-10-04', 1, 100],
      ['2026-10-05', 2, 200],
    ])
    assert.equal(out.recordsProcessed, 2)
  })

  it('fba_inventory: pages, keeps nulls, writes one hourly snapshot', async () => {
    const store = fakeStore()
    const pages = [
      { inventorySummaries: [{ sellerSku: 'A', totalQuantity: 3, inventoryDetails: { fulfillableQuantity: 3, unfulfillableQuantity: { totalUnfulfillableQuantity: 1 } } }], pagination: { nextToken: 'p2' } },
      { inventorySummaries: [{ sellerSku: 'B', totalQuantity: 0 }, { sellerSku: 'A', totalQuantity: 9 }] },
    ]
    const tokens: any[] = []
    const jobs = makeJobs(store, {
      amazon: {
        getAmazonFbaInventorySummaries: async (p: any) => {
          tokens.push(p.nextToken)
          return { status: 200, data: { payload: pages[tokens.length - 1] } }
        },
      },
    })
    const out = await jobs.handlers.fba_inventory(ctxFor())
    assert.deepEqual(tokens, [null, 'p2'])
    const snap = store.calls.writeInventorySnapshot[0]
    assert.equal(snap.meta.snapshotAt.toISOString(), '2026-10-05T09:00:00.000Z')
    assert.equal(snap.meta.snapshotDate, '2026-10-05')
    assert.equal(snap.rows.length, 2)
    const a = snap.rows.find((r: any) => r.sellerSku === 'A')
    const b = snap.rows.find((r: any) => r.sellerSku === 'B')
    assert.equal(a.unfulfillableQuantity, 1)
    assert.equal(b.fulfillableQuantity, null)
    assert.equal(out.metadata.duplicates, 1)
    assert.equal(out.metadata.missingValues.fulfillableQuantity, 1)
  })

  it('fba_inventory: no summaries → failure, nothing written', async () => {
    const store = fakeStore()
    const jobs = makeJobs(store)
    await assert.rejects(() => jobs.handlers.fba_inventory(ctxFor()), /no FBA inventory summaries/)
    assert.equal(store.calls.writeInventorySnapshot, undefined)
  })

  it('warehouse_stock: snapshots separate figures then re-suggests matches', async () => {
    const store = fakeStore()
    store.catalog = [{ zohoItemId: 'z1', itemCode: '629', itemName: 'SKU-A' }]
    store.skuRows = [{ id: 1, sellerSku: 'SKU-A' }]
    const jobs = makeJobs(store, {
      zoho: {
        fetchItemsRawForWarehouse: async () => [
          { item_id: 'z1', sku: '629', name: 'SKU-A', warehouse_stock_on_hand: 5, warehouse_available_for_sale_stock: 2 },
          { item_id: 'z1', sku: '629', name: 'dup' },
        ],
      },
    })
    const out = await jobs.handlers.warehouse_stock(ctxFor())
    const snap = store.calls.writeWarehouseSnapshot[0]
    assert.equal(snap.rows.length, 1)
    assert.equal(snap.rows[0].onHand, 5)
    assert.equal(snap.rows[0].availableForSale, 2)
    assert.equal(snap.rows[0].committedStock, null)
    assert.equal(snap.meta.warehouseId, 'wh1')
    assert.equal(out.metadata.autoMatch.AUTO_MATCHED, 1)
  })

  it('warehouse_stock: generic fields from the warehouse-filtered list are warehouse-scoped', async () => {
    const store = fakeStore()
    const jobs = makeJobs(store, {
      zoho: {
        fetchItemsRawForWarehouse: async () => [
          { item_id: 'z1', sku: '629', name: 'SKU-A', stock_on_hand: 870, available_for_sale: 870, actual_available_stock: 724 },
        ],
      },
    })
    const out = await jobs.handlers.warehouse_stock(ctxFor())
    const row = store.calls.writeWarehouseSnapshot[0].rows[0]
    assert.equal(row.onHand, 870)
    assert.equal(row.availableForSale, 870)
    assert.equal(row.committedStock, null)
    assert.equal(row.stockScope, 'warehouse')
    assert.equal(out.metadata.stockScope.warehouse, 1)
  })

  it('sales_backfill: skips covered windows, never deletes, waits between report creations', async () => {
    const store = fakeStore()
    const synced: any[] = []
    const sleeps: number[] = []
    // Windows (Riyadh) end where the live 3-day sales lookback starts (10-03):
    // [09-03, 10-03), [08-04, 09-03), [07-07, 08-04); the middle one was synced before.
    const covered = new Set(['2026-08-03T21:00:00.000Z'])
    const jobs = createControlTowerJobs({
      store,
      now: () => NOW,
      sleep: async (ms: number) => {
        sleeps.push(ms)
      },
      backfillCreateSpacingMs: 65_000,
      amazon: { fetchActiveAmazonListings: async () => ({}), getAmazonFbaInventorySummaries: async () => ({}), throwAmazonSpApiIfFailed: () => {}, marketplaceIdForKey: () => 'X' },
      zoho: { resolveLifeSmileWarehouse: async () => ({}), fetchItemsRawForWarehouse: async () => [] },
      orders: {
        findSuccessfulReportRunCoveringRange: async (_mk: string, start: Date) => (covered.has(start.toISOString()) ? { finished_at: NOW } : null),
        syncAmazonOrderReport: async (p: any) => {
          synced.push(p)
          return { rowsParsed: 5, rowsSaved: 5, reused: false }
        },
      },
    })
    const out = await jobs.handlers.sales_backfill(ctxFor({ days: 90, windowDays: 30 }))
    assert.equal(out.metadata.windows.length, 3)
    assert.equal(out.metadata.windows[0].status, 'synced')
    assert.equal(out.metadata.windows[1].status, 'already_covered')
    assert.equal(out.metadata.windows[2].status, 'synced')
    assert.equal(synced.length, 2)
    assert.ok(synced.every((p) => p.preserveExisting === true && p.reportTimeoutMs >= 10 * 60_000))
    assert.equal(synced[0].dataEndTime.toISOString(), '2026-10-02T21:00:00.000Z')
    assert.equal(sleeps.length, 1, 'waited once between the two report creations')
    assert.ok(store.calls.replaceDailySales.length >= 1, 'rebuilt the rollup for the backfilled range')
  })

  it('sales_backfill: stops after consecutive empty windows and reports the limitation', async () => {
    const store = fakeStore()
    let calls = 0
    const jobs = makeJobs(store, {
      orders: {
        syncAmazonOrderReport: async () => {
          calls += 1
          return { rowsParsed: calls === 1 ? 10 : 0, rowsSaved: calls === 1 ? 10 : 0, reused: false }
        },
      },
    })
    const out = await jobs.handlers.sales_backfill(ctxFor({ days: 365, windowDays: 30 }))
    assert.equal(calls, 4)
    assert.match(out.metadata.stoppedReason, /no orders for 3 consecutive windows/)
  })

  it('sales_backfill: a failed window is recorded and retried by the next run', async () => {
    const store = fakeStore()
    let calls = 0
    const jobs = makeJobs(store, {
      orders: {
        syncAmazonOrderReport: async () => {
          calls += 1
          if (calls === 2) throw Object.assign(new Error('timeout'), { code: 'AMAZON_ORDER_REPORT_TIMEOUT' })
          return { rowsParsed: 3, rowsSaved: 3, reused: true }
        },
      },
    })
    const out = await jobs.handlers.sales_backfill(ctxFor({ days: 60, windowDays: 30 }))
    assert.equal(out.metadata.failures, 1)
    assert.equal(out.metadata.windows[1].status, 'failed')
    assert.match(out.metadata.windows[1].error, /AMAZON_ORDER_REPORT_TIMEOUT/)
  })

  it('sales_backfill: every window failing fails the run', async () => {
    const store = fakeStore()
    const jobs = makeJobs(store, {
      orders: {
        syncAmazonOrderReport: async () => {
          throw new Error('403 Unauthorized')
        },
      },
    })
    await assert.rejects(() => jobs.handlers.sales_backfill(ctxFor({ days: 30 })), /Backfill failed for every window/)
  })

  it('sales_backfill: never overlaps the live sales lookback window', async () => {
    const store = fakeStore()
    const synced: any[] = []
    const jobs = makeJobs(store, {
      orders: {
        syncAmazonOrderReport: async (p: any) => {
          synced.push(p)
          return { rowsParsed: 1, rowsSaved: 1, reused: false }
        },
      },
    })
    const salesCtx = ctxFor()
    await jobs.handlers.sales(salesCtx)
    const liveStart = synced[0].dataStartTime.getTime()
    synced.length = 0
    await jobs.handlers.sales_backfill(ctxFor({ days: 120, windowDays: 30 }))
    assert.ok(synced.length > 0)
    assert.ok(synced.every((p) => p.dataEndTime.getTime() <= liveStart), 'backfill ends where the live sync begins')
  })

  it('every handler refuses non-KSA marketplaces before calling Amazon or Zoho', async () => {
    const store = fakeStore()
    let externalCalls = 0
    const count = async () => {
      externalCalls += 1
      return {}
    }
    const jobs = makeJobs(store, {
      amazon: { fetchActiveAmazonListings: count, getAmazonFbaInventorySummaries: count },
      orders: { syncAmazonOrderReport: count, findSuccessfulReportRunCoveringRange: count },
      zoho: { resolveLifeSmileWarehouse: count, fetchItemsRawForWarehouse: count },
    })
    for (const [name, handler] of Object.entries(jobs.handlers)) {
      const ctx = { ...ctxFor(), marketplaceKey: 'uae' }
      await assert.rejects(() => (handler as any)(ctx), /not enabled for marketplace "uae"/, name)
    }
    assert.equal(externalCalls, 0)
    assert.deepEqual(Object.keys(store.calls), [])
  })
})
