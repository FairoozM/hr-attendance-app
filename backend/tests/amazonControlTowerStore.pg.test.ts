'use strict'

/**
 * Real PostgreSQL checks for the Control Tower (migration 061, refresh runs, SKU master, snapshots,
 * daily sales, command center). Runs only against a disposable database, in its own schema:
 *   CONTROL_TOWER_TEST_DATABASE_URL=postgres://…/scratch node --test tests/amazonControlTowerStore.pg.test.ts
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Pool } = require('pg')
const { ensureAmazonControlTowerTables } = require('../src/services/amazonControlTower/controlTowerSchema.ts')
const { createPgRefreshStore } = require('../src/services/amazonControlTower/refreshRunStore.ts')
const { createControlTowerStore } = require('../src/services/amazonControlTower/controlTowerStore.ts')
const { createRefreshRunner } = require('../src/services/amazonControlTower/refreshRunner.ts')
const { createControlTowerJobs } = require('../src/services/amazonControlTower/controlTowerJobs.ts')
const { createControlTowerService } = require('../src/services/amazonControlTower/controlTowerService.ts')
const { createAdvisoryLock } = require('../src/services/amazonControlTower/refreshScheduler.ts')

const url = process.env.CONTROL_TOWER_TEST_DATABASE_URL
const skip = url ? false : 'CONTROL_TOWER_TEST_DATABASE_URL not set'
const SCHEMA = 'amazon_control_tower_test'
const MIGRATIONS = path.join(__dirname, '../migrations')
const quietLog = { info() {}, error() {} }

let pool: any
let refreshStore: any
let store: any

function uuid(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

test.before(async () => {
  if (skip) return
  const admin = new Pool({ connectionString: url, max: 1 })
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await admin.query(`CREATE SCHEMA ${SCHEMA}`)
  await admin.end()
  pool = new Pool({ connectionString: url, max: 8, options: `-c search_path=${SCHEMA}` })
  for (const file of ['019_add_amazon_orders_cache.sql', '041_amazon_order_report_lines.sql', '061_amazon_control_tower_foundation.sql']) {
    await pool.query(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'))
  }
  // Boot-time ensure must be a no-op on top of the migration (and idempotent itself).
  await ensureAmazonControlTowerTables((sql: string, params?: unknown[]) => pool.query(sql, params))
  await ensureAmazonControlTowerTables((sql: string, params?: unknown[]) => pool.query(sql, params))
  refreshStore = createPgRefreshStore(pool)
  store = createControlTowerStore({ query: (t: string, p?: unknown[]) => pool.query(t, p), pool })
})

test.after(async () => {
  if (pool) await pool.end()
})

test('migration seeds KSA settings and disabled schedules', { skip }, async () => {
  const settings = await store.getSettings('ksa')
  assert.equal(settings.timezone, 'Asia/Riyadh')
  assert.equal(settings.vatRate, 0.15)
  assert.equal(settings.schedulerEnabled, false)
  const schedules = await refreshStore.listSchedules('ksa')
  assert.ok(schedules.length >= 4)
  assert.ok(schedules.every((s: any) => s.enabled === false))
})

test('only one active run per marketplace + job type, even under concurrent claims', { skip }, async () => {
  const claims = await Promise.all(
    Array.from({ length: 8 }, (_, i) => refreshStore.claimRun({ id: uuid(100 + i), marketplaceKey: 'ksa', jobType: 'listings' }))
  )
  const winners = claims.filter((c: any) => c.claimed)
  assert.equal(winners.length, 1)
  assert.ok(claims.filter((c: any) => !c.claimed).every((c: any) => c.existing && c.existing.id === winners[0].run.id))
  const other = await refreshStore.claimRun({ id: uuid(200), marketplaceKey: 'ksa', jobType: 'fba_inventory' })
  assert.equal(other.claimed, true, 'unrelated job type is not blocked')
  await refreshStore.markRunning(winners[0].run.id, 'test')
  await refreshStore.finishRun(winners[0].run.id, { status: 'succeeded', recordsProcessed: 5 })
  await refreshStore.finishRun(other.run.id, { status: 'failed', errorMessage: 'x' })
  const again = await refreshStore.claimRun({ id: uuid(201), marketplaceKey: 'ksa', jobType: 'listings' })
  assert.equal(again.claimed, true, 'slot frees once the run is terminal')
  await refreshStore.finishRun(again.run.id, { status: 'skipped', errorMessage: 'test' })
})

test('stale runs become interrupted; terminal runs cannot be finished twice', { skip }, async () => {
  const c = await refreshStore.claimRun({ id: uuid(300), marketplaceKey: 'ksa', jobType: 'sales' })
  await refreshStore.markRunning(c.run.id, 'dead:1')
  await pool.query(`UPDATE amazon_refresh_runs SET heartbeat_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`, [c.run.id])
  assert.equal(await refreshStore.markStaleRunsInterrupted({ staleMs: 5 * 60_000 }), 1)
  const run = await refreshStore.getRun(c.run.id)
  assert.equal(run.status, 'interrupted')
  assert.ok(run.durationMs >= 0)
  assert.equal(await refreshStore.finishRun(c.run.id, { status: 'succeeded' }), null)
  const summary = await refreshStore.summarizeJobRuns('ksa', ['sales', 'listings'])
  assert.ok(summary.find((s: any) => s.jobType === 'sales').lastFailureAt)
  assert.ok(summary.find((s: any) => s.jobType === 'listings').lastSuccessAt)
})

test('heartbeat refreshes the running run and children queued behind it', { skip }, async () => {
  const parent = await refreshStore.claimRun({ id: uuid(400), marketplaceKey: 'ksa', jobType: 'refresh_all' })
  const child = await refreshStore.claimRun({ id: uuid(401), marketplaceKey: 'ksa', jobType: 'rollup', parentRunId: parent.run.id, triggerSource: 'parent' })
  await refreshStore.markRunning(parent.run.id, 'test')
  await pool.query(`UPDATE amazon_refresh_runs SET heartbeat_at = NOW() - INTERVAL '10 minutes', queued_at = NOW() - INTERVAL '10 minutes' WHERE id IN ($1, $2)`, [parent.run.id, child.run.id])
  await refreshStore.heartbeat(parent.run.id)
  assert.equal(await refreshStore.markStaleRunsInterrupted({ staleMs: 5 * 60_000 }), 0)
  assert.equal((await refreshStore.listChildRuns(parent.run.id)).length, 1)
  await refreshStore.finishRun(child.run.id, { status: 'skipped' })
  await refreshStore.finishRun(parent.run.id, { status: 'succeeded' })
})

test('advisory lock admits one holder at a time', { skip }, async () => {
  const withLock = createAdvisoryLock(pool, 99)
  let release: () => void = () => {}
  const held = withLock(() => new Promise<string>((r) => { release = () => r('first') }))
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(await withLock(async () => 'second'), null)
  release()
  assert.equal(await held, 'first')
  assert.equal(await withLock(async () => 'third'), 'third')
})

test('SKU master: listings upsert, deactivation, auto-match never overrides a human decision', { skip }, async () => {
  const seen1 = new Date('2026-10-01T00:00:00Z')
  await store.upsertListings('ksa', [
    { sellerSku: 'SKU-A', normalizedSku: 'SKU-A', asin: 'B0A', title: 'A', fulfillmentChannel: 'AMAZON_EU', listingStatus: 'ACTIVE' },
    { sellerSku: 'SKU-B', normalizedSku: 'SKU-B', asin: 'B0B', title: 'B', fulfillmentChannel: 'AMAZON_EU', listingStatus: 'ACTIVE' },
    { sellerSku: 'SKU-C', normalizedSku: 'SKU-C', asin: 'B0C', title: 'C', fulfillmentChannel: 'DEFAULT', listingStatus: 'ACTIVE' },
  ], seen1)
  const seen2 = new Date('2026-10-02T00:00:00Z')
  await store.upsertListings('ksa', [
    { sellerSku: 'SKU-A', normalizedSku: 'SKU-A', asin: null, title: null, fulfillmentChannel: null, listingStatus: 'ACTIVE' },
    { sellerSku: 'SKU-B', normalizedSku: 'SKU-B', asin: 'B0B', title: 'B', fulfillmentChannel: 'AMAZON_EU', listingStatus: 'ACTIVE' },
  ], seen2)
  assert.equal(await store.markListingsNotSeenInactive('ksa', seen2), 1)
  const list = await store.listSkuMaster('ksa', {})
  const a = list.rows.find((r: any) => r.sellerSku === 'SKU-A')
  assert.equal(a.asin, 'B0A', 'missing ASIN in a later report does not wipe the stored one')
  assert.equal(list.rows.find((r: any) => r.sellerSku === 'SKU-C').active, false)

  await store.upsertInventorySkus('ksa', [{ sellerSku: 'FBA-ONLY', normalizedSku: 'FBA-ONLY', asin: 'B0F', fnsku: 'X0F', productName: 'F' }], seen2)
  const fbaOnly = (await store.listSkuMaster('ksa', { search: 'FBA-ONLY' })).rows[0]
  assert.equal(fbaOnly.active, false)
  assert.equal(fbaOnly.fnsku, 'X0F')

  const b = list.rows.find((r: any) => r.sellerSku === 'SKU-B')
  await store.confirmMapping('ksa', b.id, { zohoItemId: 'z-manual', itemCode: 'M', itemName: 'Manual', method: 'MANUAL' }, 'user:1')
  const candidates = await store.listSkusForAutoMatch('ksa')
  assert.ok(!candidates.some((c: any) => c.id === b.id), 'confirmed SKU is not re-matched')
  const changed = await store.applyAutoMatches('ksa', [
    { id: a.id, status: 'AUTO_MATCHED', zohoItemId: 'z1', itemCode: 'SKU-A', itemName: 'A', method: 'EXACT_ITEM_CODE', confidence: 1, candidates: [{ zohoItemId: 'z1' }] },
    { id: b.id, status: 'UNMAPPED', zohoItemId: null, itemCode: null, itemName: null, method: null, confidence: null, candidates: [] },
  ])
  assert.equal(changed, 1)
  assert.equal(await store.applyAutoMatches('ksa', [
    { id: a.id, status: 'AUTO_MATCHED', zohoItemId: 'z1', itemCode: 'SKU-A', itemName: 'A', method: 'EXACT_ITEM_CODE', confidence: 1, candidates: [{ zohoItemId: 'z1' }] },
  ]), 0, 'identical suggestion is a no-op')
  const bAfter = await store.getSkuMasterRow('ksa', b.id)
  assert.equal(bAfter.mappingStatus, 'CONFIRMED')
  assert.equal(bAfter.zohoItemId, 'z-manual')
  assert.equal(bAfter.confirmedBy, 'user:1')

  const unmapped = await store.markUnmapped('ksa', a.id, 'user:2')
  assert.equal(unmapped.mappingStatus, 'UNMAPPED')
  assert.equal(unmapped.mappingMethod, 'MANUAL_UNMAPPED')
  assert.ok(!(await store.listSkusForAutoMatch('ksa')).some((c: any) => c.id === a.id), 'manual unmap is respected')

  const params = await store.updateSkuParameters('ksa', a.id, { packMultiplier: 2, cartonQuantity: 24 })
  assert.equal(params.packMultiplier, 2)
  assert.equal(params.cartonQuantity, 24)
  await assert.rejects(() => store.updateSkuParameters('ksa', a.id, { packMultiplier: 0 }))
})

test('snapshots are idempotent per hour and keep nulls; history is kept', { skip }, async () => {
  const meta = { snapshotAt: new Date('2026-10-05T09:00:00Z'), snapshotDate: '2026-10-05', fetchedAt: new Date('2026-10-05T09:12:00Z'), runId: null }
  const row = {
    sellerSku: 'SKU-A', normalizedSku: 'SKU-A', asin: 'B0A', fnsku: 'X0A',
    fulfillableQuantity: 0, inboundWorkingQuantity: null, inboundShippedQuantity: 4, inboundReceivingQuantity: null,
    reservedQuantity: 1, reservedCustomerOrders: 1, reservedFcTransfer: null, reservedFcProcessing: null,
    unfulfillableQuantity: 2, researchingQuantity: null, totalQuantity: 7, amazonLastUpdatedAt: null,
  }
  await store.writeInventorySnapshot('ksa', [row], meta)
  await store.writeInventorySnapshot('ksa', [{ ...row, fulfillableQuantity: 0, unfulfillableQuantity: 3 }], meta)
  await store.writeInventorySnapshot('ksa', [{ ...row, sellerSku: 'SKU-B', normalizedSku: 'SKU-B', fulfillableQuantity: 5 }], meta)
  const older = { ...meta, snapshotAt: new Date('2026-10-05T07:00:00Z') }
  await store.writeInventorySnapshot('ksa', [{ ...row, fulfillableQuantity: 9 }], older)
  const r = await pool.query(`SELECT seller_sku, snapshot_at, unfulfillable_quantity, inbound_working_quantity FROM amazon_inventory_snapshots ORDER BY snapshot_at, seller_sku`)
  assert.equal(r.rows.length, 3)
  const latestA = r.rows.find((x: any) => x.seller_sku === 'SKU-A' && x.snapshot_at.toISOString() === '2026-10-05T09:00:00.000Z')
  assert.equal(latestA.unfulfillable_quantity, 3)
  assert.equal(latestA.inbound_working_quantity, null)
  const totals = await store.inventoryTotals('ksa')
  assert.equal(totals.fulfillable, 5)
  assert.equal(totals.inbound, 8)

  const whMeta = { snapshotAt: new Date('2026-10-05T09:00:00Z'), snapshotDate: '2026-10-05', warehouseId: 'wh1', fetchedAt: new Date(), runId: null }
  await store.writeWarehouseSnapshot([{ zohoItemId: 'z1', itemCode: 'SKU-A', itemName: 'A', itemStatus: 'active', onHand: 10, availableForSale: 6, committedStock: null, stockScope: 'warehouse' }], whMeta)
  await store.writeWarehouseSnapshot([{ zohoItemId: 'z1', itemCode: 'SKU-A', itemName: 'A', itemStatus: 'active', onHand: 10, availableForSale: 4, committedStock: null, stockScope: 'warehouse' }], whMeta)
  const wh = await pool.query(`SELECT on_hand, available_for_sale, committed_stock FROM amazon_warehouse_stock_snapshots`)
  assert.equal(wh.rows.length, 1)
  assert.equal(Number(wh.rows[0].available_for_sale), 4)
  assert.equal(wh.rows[0].committed_stock, null)
  assert.deepEqual((await store.latestWarehouseCatalog()).map((c: any) => c.zohoItemId), ['z1'])
  assert.equal((await store.searchWarehouseItems('sku-a'))[0].availableForSale, 4)
})

test('daily sales: rollup job rebuilds a range idempotently from report lines', { skip }, async () => {
  const insert = `INSERT INTO amazon_order_report_lines (marketplace_key, amazon_order_id, order_item_id, purchase_date, order_status, item_status, seller_sku, asin, quantity, currency, item_price, item_tax, item_promotion_discount)
                  VALUES ('ksa', $1, $2, $3, 'Shipped', $4, $5, 'B0A', $6, 'SAR', $7, NULL, NULL)`
  await pool.query(insert, ['o1', 'i1', '2026-10-04T10:00:00Z', 'Shipped', 'SKU-A', 1, 115])
  await pool.query(insert, ['o2', 'i1', '2026-10-04T20:59:59Z', 'Shipped', 'SKU-A', 2, 230])
  await pool.query(insert, ['o3', 'i1', '2026-10-04T21:00:00Z', 'Shipped', 'SKU-A', 1, 115])
  await pool.query(insert, ['o4', 'i1', '2026-10-04T11:00:00Z', 'Cancelled', 'SKU-A', 0, null])
  const jobs = createControlTowerJobs({
    store,
    now: () => new Date('2026-10-05T09:30:00Z'),
    amazon: {} as any,
    orders: {} as any,
    zoho: {} as any,
  })
  const ctx = { run: { id: uuid(1) }, marketplaceKey: 'ksa', params: { fromDate: '2026-10-01', toDate: '2026-10-05' }, progress() {}, setRecords() {} }
  await jobs.handlers.rollup(ctx)
  await jobs.handlers.rollup(ctx)
  const rows = (await pool.query(`SELECT sales_date::text AS d, units_ordered, order_count, net_sales_ex_vat::float AS net FROM amazon_sku_daily_sales ORDER BY sales_date`)).rows
  assert.deepEqual(rows, [
    { d: '2026-10-04', units_ordered: 3, order_count: 2, net: 300 },
    { d: '2026-10-05', units_ordered: 1, order_count: 1, net: 100 },
  ])
  const totals = await store.salesTotals('ksa', '2026-10-04', '2026-10-05')
  assert.equal(totals.netSalesExVat, 400)
  assert.equal(totals.units, 4)
})

test('command center + freshness read the stored data', { skip }, async () => {
  const runnerStore = refreshStore
  const service = createControlTowerService({ store, refreshStore: runnerStore, now: () => new Date('2026-10-05T09:30:00Z') })
  const runner = createRefreshRunner({ store: runnerStore, handlers: { rollup: async () => ({ recordsProcessed: 2 }) }, log: quietLog })
  const started = await runner.start({ marketplaceKey: 'ksa', jobType: 'rollup' })
  await runner.drain()
  assert.equal((await runnerStore.getRun(started.runIds[0])).status, 'succeeded')

  const before = await service.getCommandCenter('ksa')
  assert.equal(before.listingStatus.operationalBasis, 'LISTING_STATUS_NOT_REFRESHED')
  assert.equal(before.kpis.activeSkus, null, 'no listing status yet: the active universe is unknown, not guessed')
  assert.equal(before.kpis.fbaFulfillableUnits, null)
  assert.equal(before.tables.outOfStock.total, 0)
  await pool.query(`UPDATE amazon_sku_master SET amazon_listing_status = CASE WHEN seller_sku IN ('SKU-A', 'SKU-B') THEN 'ACTIVE' ELSE 'INACTIVE' END WHERE marketplace_key = 'ksa'`)

  const cc = await service.getCommandCenter('ksa')
  assert.equal(cc.listingStatus.operationalBasis, 'AMAZON_LISTING_STATUS_ACTIVE')
  assert.equal(cc.currency, 'SAR')
  assert.equal(cc.today, '2026-10-05')
  assert.equal(cc.kpis.todaySales, 100)
  assert.equal(cc.kpis.yesterdaySales, 300)
  assert.equal(cc.kpis.last7DaysSales, 400)
  assert.equal(cc.kpis.unitsSold30d, 4)
  assert.equal(cc.kpis.fbaFulfillableUnits, 5)
  assert.equal(cc.kpis.activeSkus, 2)
  assert.equal(cc.inventorySource.fulfillmentModel, 'UNVERIFIED')
  assert.equal(cc.salesProvisional, true)
  assert.equal(cc.kpis.outOfStockSkus, 1)
  assert.equal(cc.tables.outOfStock.rows[0].sellerSku, 'SKU-A')
  assert.equal(cc.tables.outOfStock.rows[0].units30d, 4)
  assert.equal(cc.kpis.lowStockSkus, 1)
  assert.equal(cc.tables.lowStock.rows[0].sellerSku, 'SKU-B')
  assert.equal(cc.kpis.unmappedSkus, 1)
  const daily = cc.freshness.sources.find((s: any) => s.key === 'daily_sales')
  assert.equal(daily.status, 'FRESH')
  const fba = cc.freshness.sources.find((s: any) => s.key === 'fba_inventory')
  assert.equal(fba.status, 'ERROR', 'last fba run failed earlier in this suite')
  assert.equal(cc.freshness.sources.find((s: any) => s.key === 'warehouse_inventory').status, 'NEVER_SYNCED')
})
