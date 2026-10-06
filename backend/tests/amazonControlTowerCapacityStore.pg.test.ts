'use strict'

/**
 * Real PostgreSQL checks for capacity / inventory health / removals persistence (migration 062):
 * listing status + history (nothing deleted), append-only capacity periods with an audit trail,
 * age snapshots, unit volumes, usage snapshots, removals and deduplicated daily actions.
 *   CONTROL_TOWER_TEST_DATABASE_URL=postgres://…/scratch node --test tests/amazonControlTowerCapacityStore.pg.test.ts
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Pool } = require('pg')
const { ensureAmazonControlTowerTables } = require('../src/services/amazonControlTower/controlTowerSchema.ts')
const { createControlTowerStore } = require('../src/services/amazonControlTower/controlTowerStore.ts')
const { createCapacityHealthStore } = require('../src/services/amazonControlTower/capacityHealthStore.ts')
const { parseRemovalDetailRow, aggregateRemovalOrders } = require('../src/services/amazonControlTower/removalReportParser.ts')
const { parsePlanningRow } = require('../src/services/amazonControlTower/inventoryReportParsers.ts')
const { createCapacityHealthService } = require('../src/services/amazonControlTower/capacityHealthService.ts')

const url = process.env.CONTROL_TOWER_TEST_DATABASE_URL
const skip = url ? false : 'CONTROL_TOWER_TEST_DATABASE_URL not set'
const SCHEMA = 'amazon_control_tower_capacity_test'
const MIGRATIONS = path.join(__dirname, '../migrations')
const SOURCE = 'GET_MERCHANT_LISTINGS_ALL_DATA+GET_MERCHANTS_LISTINGS_FYP_REPORT'

let pool: any
let store: any
let ch: any

test.before(async () => {
  if (skip) return
  const admin = new Pool({ connectionString: url, max: 1 })
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await admin.query(`CREATE SCHEMA ${SCHEMA}`)
  await admin.end()
  pool = new Pool({ connectionString: url, max: 8, options: `-c search_path=${SCHEMA}` })
  for (const file of ['019_add_amazon_orders_cache.sql', '041_amazon_order_report_lines.sql', '061_amazon_control_tower_foundation.sql', '062_amazon_control_tower_capacity_health.sql']) {
    await pool.query(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'))
  }
  // Boot-time ensure on top of the migrations is a no-op (and idempotent).
  await ensureAmazonControlTowerTables((sql: string, params?: unknown[]) => pool.query(sql, params))
  await ensureAmazonControlTowerTables((sql: string, params?: unknown[]) => pool.query(sql, params))
  const db = { query: (t: string, p?: unknown[]) => pool.query(t, p), pool }
  store = createControlTowerStore(db)
  ch = createCapacityHealthStore(db)
})

test.after(async () => {
  if (pool) await pool.end()
})

const statusRow = (sellerSku: string, status: string, rawStatus: string | null, extra: Record<string, any> = {}) => ({
  sellerSku,
  normalizedSku: sellerSku.toUpperCase(),
  asin: `B-${sellerSku}`,
  title: `Title ${sellerSku}`,
  fulfillmentChannel: 'AMAZON',
  fulfillmentChannelRaw: 'AMAZON_EU',
  status,
  rawStatus,
  reason: status === 'ACTIVE' ? null : `${status} reason`,
  suppressed: status === 'SUPPRESSED',
  ...extra,
})

test('settings carry the health / capacity thresholds with migration defaults', { skip }, async () => {
  const s = await store.getSettings('ksa')
  assert.equal(s.healthAgedMinDays, 181)
  assert.equal(s.capacityWarnPct, 80)
  assert.equal(s.usageCoverageMinPct, 95)
  const updated = await store.updateSettings('ksa', { healthAgedMinDays: 271, capacityHighPct: 92 })
  assert.equal(updated.healthAgedMinDays, 271)
  assert.equal(updated.capacityHighPct, 92)
  await assert.rejects(() => pool.query(`UPDATE amazon_marketplace_settings SET health_aged_min_days = 100 WHERE marketplace_key = 'ksa'`))
  await store.updateSettings('ksa', { healthAgedMinDays: 181, capacityHighPct: 90 })
})

test('listing status: applied from the report, history appended only on change, missing SKUs become UNKNOWN, nothing deleted', { skip }, async () => {
  await store.upsertListings('ksa', [
    { sellerSku: 'A', normalizedSku: 'A', asin: 'B-A', title: 'A', fulfillmentChannel: 'AMAZON', listingStatus: 'ACTIVE' },
    { sellerSku: 'GONE', normalizedSku: 'GONE', asin: null, title: 'Gone', fulfillmentChannel: 'DEFAULT', listingStatus: 'ACTIVE' },
  ], new Date('2026-10-05T07:00:00Z'))

  const t1 = new Date('2026-10-05T08:00:00Z')
  const r1 = await ch.applyListingStatuses('ksa', [statusRow('A', 'ACTIVE', 'Active'), statusRow('B', 'INACTIVE', 'Inactive'), statusRow('S', 'SUPPRESSED', 'Active')], { observedAt: t1, runId: null, source: SOURCE })
  assert.equal(r1.upserted, 3)
  assert.equal(r1.notInReport, 1)
  const master = async () => (await pool.query(`SELECT seller_sku, amazon_listing_status, amazon_listing_status_raw, active, search_suppressed FROM amazon_sku_master WHERE marketplace_key = 'ksa' ORDER BY seller_sku`)).rows
  const m1 = await master()
  assert.deepEqual(m1.map((r: any) => [r.seller_sku, r.amazon_listing_status]), [['A', 'ACTIVE'], ['B', 'INACTIVE'], ['GONE', 'UNKNOWN'], ['S', 'SUPPRESSED']])
  assert.equal(m1.find((r: any) => r.seller_sku === 'B').active, false, 'new SKUs from the all-listings report are not "open listings"')
  assert.equal(m1.find((r: any) => r.seller_sku === 'S').amazon_listing_status_raw, 'Active', 'raw status kept')
  assert.equal(m1.find((r: any) => r.seller_sku === 'S').search_suppressed, true)
  const history = async () => Number((await pool.query(`SELECT COUNT(*) FROM amazon_listing_status_history`)).rows[0].count)
  assert.equal(await history(), 4)

  await ch.applyListingStatuses('ksa', [statusRow('A', 'ACTIVE', 'Active'), statusRow('B', 'INACTIVE', 'Inactive'), statusRow('S', 'SUPPRESSED', 'Active')], { observedAt: new Date('2026-10-05T09:00:00Z'), runId: null, source: SOURCE })
  assert.equal(await history(), 4, 'unchanged statuses add no history')

  await ch.applyListingStatuses('ksa', [statusRow('A', 'INACTIVE', 'Inactive'), statusRow('B', 'ACTIVE', 'Active'), statusRow('S', 'SUPPRESSED', 'Active'), statusRow('GONE', 'INACTIVE', 'Inactive', { fulfillmentChannel: 'DEFAULT' })], { observedAt: new Date('2026-10-05T10:00:00Z'), runId: null, source: SOURCE })
  assert.equal(await history(), 7)
  const m3 = await master()
  assert.equal(m3.length, 4, 'no SKU master row is ever deleted')
  assert.equal(m3.find((r: any) => r.seller_sku === 'GONE').amazon_listing_status, 'INACTIVE')
  const gone = (await pool.query(`SELECT listing_status FROM amazon_listing_status_history WHERE seller_sku = 'GONE' ORDER BY observed_at`)).rows
  assert.deepEqual(gone.map((r: any) => r.listing_status), ['UNKNOWN', 'INACTIVE'])
})

test('capacity periods are append-only: revisions supersede, events record every change', { skip }, async () => {
  const p1 = await ch.insertCapacityPeriod('ksa', { periodStart: '2026-10-01', periodEnd: '2026-12-31', storageType: 'ALL', capacityLimit: 1500, capacityUnit: 'CUBIC_FEET', amazonReportedUsage: 900, source: 'SELLER_CENTRAL_MANUAL', calculatedUsage: 850.5, notes: 'Q4 limit' }, 'user:1')
  assert.equal(p1.capacityLimit, 1500)
  assert.equal(p1.calculatedUsage, 850.5)
  assert.equal(p1.enteredBy, 'user:1')

  const rev = await ch.reviseCapacityPeriod('ksa', p1.id, { capacityLimit: 1700, calculatedUsage: 860 }, 'user:2')
  assert.equal(rev.period.capacityLimit, 1700)
  assert.equal(rev.period.amazonReportedUsage, 900, 'unchanged fields carried over')
  assert.equal(rev.period.supersedesId, p1.id)
  const old = await ch.getCapacityPeriod('ksa', p1.id)
  assert.equal(old.capacityLimit, 1500, 'history is never overwritten')
  assert.equal(old.supersededById, rev.period.id)
  assert.ok(old.supersededAt)

  assert.equal((await ch.reviseCapacityPeriod('ksa', p1.id, { capacityLimit: 1800 }, 'user:3')).error, 'SUPERSEDED')
  assert.equal((await ch.reviseCapacityPeriod('ksa', rev.period.id, { capacityLimit: 1700 }, 'user:3')).error, 'NO_CHANGES')
  assert.equal((await ch.reviseCapacityPeriod('ksa', 99999, { capacityLimit: 1 }, 'user:3')).error, 'NOT_FOUND')

  const verified = await ch.verifyCapacityPeriod('ksa', rev.period.id, 'user:4')
  assert.equal(verified.verifiedBy, 'user:4')
  assert.equal(await ch.verifyCapacityPeriod('ksa', p1.id, 'user:4'), null, 'superseded versions cannot be verified')

  const events = await ch.listCapacityEvents('ksa')
  assert.deepEqual(events.map((e: any) => e.action).reverse(), ['CREATED', 'REVISED', 'VERIFIED'])
  const revised = events.find((e: any) => e.action === 'REVISED')
  assert.deepEqual(revised.changes, { capacityLimit: { from: 1500, to: 1700 } }, 'calculated figures are not audited as user edits')
  assert.equal(revised.previousPeriodId, p1.id)
  assert.equal(revised.actor, 'user:2')

  await ch.insertCapacityPeriod('ksa', { periodStart: '2026-10-01', periodEnd: '2026-10-31', storageType: 'STANDARD', capacityLimit: 40, capacityUnit: 'CUBIC_METERS', source: 'SELLER_CENTRAL_MANUAL' }, 'user:1')
  const current = await ch.currentCapacityPeriods('ksa', '2026-10-05')
  assert.deepEqual(current.map((p: any) => [p.storageType, p.capacityLimit]), [['ALL', 1700], ['STANDARD', 40]])
  assert.deepEqual(await ch.currentCapacityPeriods('ksa', '2027-02-01'), [])
  assert.equal((await ch.listCapacityPeriods('ksa')).length, 3, 'superseded version stays listed')
  await assert.rejects(() => ch.insertCapacityPeriod('ksa', { periodStart: '2026-10-05', periodEnd: '2026-10-01', storageType: 'ALL', capacityLimit: 1, capacityUnit: 'UNITS', source: 'SELLER_CENTRAL_MANUAL' }, 'user:1'))
})

test('age snapshots, unit volumes and usage snapshots', { skip }, async () => {
  const planning = [
    parsePlanningRow({ 'snapshot-date': '2026-10-04', 'inventory age snapshot date': '2026-10-03', sku: 'A', 'inv-age-181-to-270-days': '12', 'units-shipped-t30': '4', 'storage-type': 'Standard', 'storage-volume': '0.01', 'volume-unit-measurement': 'cubic meters', 'item-volume': '0.001' }),
    parsePlanningRow({ 'snapshot-date': '2026-10-04', sku: 'B', 'inv-age-0-to-30-days': '3' }),
  ]
  assert.equal(await ch.writeAgeSnapshot('ksa', planning, { fetchedAt: new Date(), runId: null, reportId: 'rep1' }), 2)
  assert.equal(await ch.writeAgeSnapshot('ksa', planning, { fetchedAt: new Date(), runId: null, reportId: 'rep2' }), 2, 'same snapshot date upserts')
  const ages = await ch.latestAgeSnapshot('ksa')
  assert.equal(ages.length, 2)
  const a = ages.find((x: any) => x.sellerSku === 'A')
  assert.equal(a.ages.inv_age_181_to_270_days, 12)
  assert.equal(a.ages.inv_age_365_plus_days, null)
  assert.equal(a.unitsShippedT30, 4)
  assert.equal(a.inventoryAgeSnapshotDate, '2026-10-03')

  await ch.upsertDimensions('ksa', [
    { sellerSku: 'A', normalizedSku: 'A', source: 'AMAZON_PLANNING_ITEM_VOLUME', dimensionKind: 'STORAGE_UNIT_VOLUME', rawVolume: 0.001, rawVolumeUnit: 'cubic meters', unitVolumeCm3: 1000 },
    { sellerSku: 'A', normalizedSku: 'A', source: 'AMAZON_FEE_PREVIEW_PACKAGE', dimensionKind: 'PACKAGE', longestSide: 10, medianSide: 10, shortestSide: 9, dimensionUnit: 'centimeters', unitVolumeCm3: 900 },
    { sellerSku: 'B', normalizedSku: 'B', source: 'AMAZON_MYI_PER_UNIT_VOLUME', dimensionKind: 'STORAGE_UNIT_VOLUME', unitVolumeCm3: null },
  ], { observedAt: new Date(), runId: null, reportId: null })
  const dims = await ch.listDimensions('ksa')
  assert.equal(dims.length, 3)
  assert.equal(dims.find((d: any) => d.sellerSku === 'B').unitVolumeCm3, null, 'missing volume stays NULL')
  await assert.rejects(() => pool.query(`INSERT INTO amazon_sku_dimensions (marketplace_key, seller_sku, normalized_sku, source, dimension_kind, observed_at) VALUES ('ksa', 'C', 'C', 'PRODUCT_DIMENSIONS', 'PRODUCT', NOW())`), 'product dimensions are not an allowed source')

  const snap = await ch.insertUsageSnapshot('ksa', { computedAt: new Date('2026-10-05T09:00:00Z'), inventorySnapshotAt: new Date('2026-10-05T08:00:00Z'), onHandUnits: 10, onHandUnitsWithVolume: 8, onHandVolumeCm3: 8000, inboundWorkingVolumeCm3: 0, inboundShippedVolumeCm3: 100, inboundReceivingVolumeCm3: 0, coveragePct: 80, amazonPlanningStorageVolumeM3: 0.01, breakdown: { byStorageType: { STANDARD: { volumeCm3: 8100, units: 11 } } } })
  assert.equal(snap.onHandUnits, 10)
  assert.equal(snap.coveragePct, 80)
  assert.equal(snap.breakdown.byStorageType.STANDARD.units, 11)
  const list = await ch.listUsageSnapshots('ksa')
  assert.equal(list.length, 1)
})

test('health base rows join listing status, FBA buckets, mapped warehouse stock and sales windows', { skip }, async () => {
  await store.writeInventorySnapshot('ksa', [
    { sellerSku: 'A', normalizedSku: 'A', asin: 'B-A', fnsku: null, fulfillableQuantity: 5, inboundWorkingQuantity: 1, inboundShippedQuantity: null, inboundReceivingQuantity: null, reservedQuantity: 2, reservedCustomerOrders: null, reservedFcTransfer: null, reservedFcProcessing: null, unfulfillableQuantity: 1, researchingQuantity: 0, totalQuantity: 9, amazonLastUpdatedAt: null },
  ], { snapshotAt: new Date('2026-10-05T09:00:00Z'), snapshotDate: '2026-10-05', fetchedAt: new Date(), runId: null })
  await pool.query(`INSERT INTO amazon_sku_daily_sales (marketplace_key, sales_date, seller_sku, units_ordered) VALUES ('ksa', '2026-10-04', 'A', 3), ('ksa', '2026-08-01', 'A', 5)`)
  const rows = await ch.healthBaseRows('ksa', { from7: '2026-09-29', from30: '2026-09-06', from90: '2026-07-08', toDate: '2026-10-05' })
  const a = rows.find((r: any) => r.sellerSku === 'A')
  assert.equal(a.listingStatus, 'INACTIVE')
  assert.equal(a.fulfillable, 5)
  assert.equal(a.reserved, 2)
  assert.equal(a.unfulfillable, 1)
  assert.equal(a.inboundShipped, null, 'missing buckets stay NULL')
  assert.equal(a.units7d, 3)
  assert.equal(a.units30d, 3)
  assert.equal(a.units90d, 8)
  assert.equal(a.lastSaleDate, '2026-10-04')
  assert.equal(a.warehouseAvailable, null, 'unmapped SKU shows no warehouse stock')
  const b = rows.find((r: any) => r.sellerSku === 'B')
  assert.equal(b.hasInventorySnapshot, false)
})

test('removal orders upsert idempotently (read-only report data) with status filters', { skip }, async () => {
  const lines = [
    parseRemovalDetailRow({ 'order-id': 'R1', sku: 'A', fnsku: 'X1', disposition: 'Sellable', 'order-status': 'Pending', 'requested-quantity': '4', 'request-date': '2026-09-01T00:00:00Z', 'last-updated-date': '2026-09-02T00:00:00Z' }),
    parseRemovalDetailRow({ 'order-id': 'R2', sku: 'B', 'order-status': 'Completed', 'requested-quantity': '2', 'shipped-quantity': '2', 'request-date': '2026-08-01T00:00:00Z' }),
    parseRemovalDetailRow({ 'order-id': 'R3', sku: 'A', 'order-status': 'Cancelled', 'requested-quantity': '1', 'cancelled-quantity': '1' }),
  ]
  const orders = aggregateRemovalOrders(lines)
  const meta = { seenAt: new Date('2026-10-05T09:00:00Z'), runId: null, reportId: 'rr' }
  assert.deepEqual(await ch.upsertRemovals('ksa', orders, lines, meta), { ordersWritten: 3, linesWritten: 3 })
  await ch.upsertRemovals('ksa', orders, lines, { ...meta, seenAt: new Date('2026-10-06T09:00:00Z') })
  assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM amazon_removal_order_items`)).rows[0].count), 3, 'no duplicates on re-import')
  assert.deepEqual(await ch.removalCounts('ksa'), { OPEN: 1, COMPLETED: 1, CANCELLED: 1, UNKNOWN: 0 })
  const open = await ch.listRemovalItems('ksa', 'OPEN')
  assert.equal(open.length, 1)
  assert.equal(open[0].removalOrderId, 'R1')
  assert.equal((await ch.listRemovalItems('ksa', null)).length, 3)
  const openOrders = await ch.listOpenRemovalOrders('ksa')
  assert.deepEqual(openOrders.map((o: any) => o.removalOrderId), ['R1'])
})

test('service end-to-end over the real store: health defaults to active, capacity uses all physical stock', { skip }, async () => {
  const svc = createCapacityHealthService({ store, chStore: ch, now: () => new Date('2026-10-05T10:30:00Z') })
  const health = await svc.getInventoryHealth('ksa', {})
  assert.equal(health.filter, 'active')
  assert.ok(health.rows.every((r: any) => r.listingStatus === 'ACTIVE'))
  assert.ok(!health.rows.some((r: any) => r.sellerSku === 'A'), 'INACTIVE SKU A is not in the default view')
  const all = await svc.getInventoryHealth('ksa', { filter: 'all' })
  assert.ok(all.rows.some((r: any) => r.sellerSku === 'A'))
  const inactive = await svc.getInactiveWithStock('ksa')
  assert.ok(inactive.rows.some((r: any) => r.sellerSku === 'A'), 'inactive SKU with FBA stock is listed separately')

  const cap = await svc.getCapacity('ksa')
  assert.ok(cap.formula)
  const created = await svc.createCapacityPeriod('ksa', { periodStart: '2026-10-05', periodEnd: '2026-10-31', storageType: 'OVERSIZE', capacityLimit: 10, capacityUnit: 'CUBIC_METERS', source: 'SELLER_CENTRAL_MANUAL' }, 'user:9')
  assert.equal(created.storageType, 'OVERSIZE')
  assert.equal(created.source, 'SELLER_CENTRAL_MANUAL')

  const release = await svc.getCapacityRelease('ksa')
  assert.ok(release.rows.some((r: any) => r.sellerSku === 'A'), 'inactive stock is a removal / release candidate')
  const refreshed = await svc.refreshActions('ksa')
  assert.ok(refreshed)
  const actions = await svc.getActions('ksa', 'OPEN')
  assert.equal(new Set(actions.actions.map((a: any) => a.actionKey)).size, actions.actions.length, 'no duplicate action keys')
  const removals = await svc.getRemovalOrders('ksa', 'OPEN')
  assert.ok(removals)
})

test('daily actions: upsert by stable key, resolve when cleared, reopen when raised again', { skip }, async () => {
  // Separate marketplace key so actions raised by the service test above do not interfere.
  const mk = 'uae'
  const action = (key: string) => ({ actionKey: `${mk}:AGED_INVENTORY:${key}`, actionType: 'AGED_INVENTORY', severity: 'MEDIUM', title: key, detail: 'd', entityType: 'sku', entityId: key, metadata: {} })
  await ch.syncActions(mk, [action('A'), action('B')], new Date('2026-10-05T09:00:00Z'))
  await ch.syncActions(mk, [action('A'), action('B')], new Date('2026-10-05T10:00:00Z'))
  assert.equal((await ch.listActions(mk, null)).length, 2, 'no duplicates')
  const r = await ch.syncActions(mk, [action('A')], new Date('2026-10-05T11:00:00Z'))
  assert.equal(r.resolved, 1)
  assert.deepEqual((await ch.listActions(mk, 'OPEN')).map((a: any) => a.entityId), ['A'])
  assert.deepEqual((await ch.listActions(mk, 'RESOLVED')).map((a: any) => a.entityId), ['B'])
  await ch.syncActions(mk, [action('A'), action('B')], new Date('2026-10-05T12:00:00Z'))
  const all = await ch.listActions(mk, null)
  assert.equal(all.length, 2)
  assert.ok(all.every((a: any) => a.status === 'OPEN'))
  assert.equal(all.find((a: any) => a.entityId === 'A').firstSeenAt, '2026-10-05T09:00:00.000Z', 'first seen is kept')
})
