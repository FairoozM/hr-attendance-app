'use strict'

/**
 * Capacity / health service, Command Center active-only KPIs and the report jobs, with in-memory fakes:
 * ACTIVE inventory is operational stock; INACTIVE / SUPPRESSED / UNKNOWN are excluded from it but still
 * consume physical capacity and show up as removal candidates.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createCapacityHealthService } = require('../src/services/amazonControlTower/capacityHealthService.ts')
const { createControlTowerService } = require('../src/services/amazonControlTower/controlTowerService.ts')
const { createCapacityHealthJobs } = require('../src/services/amazonControlTower/capacityHealthJobs.ts')

const NOW = new Date('2026-10-05T09:30:00Z')
const SETTINGS = {
  marketplaceKey: 'ksa',
  timezone: 'Asia/Riyadh',
  vatRate: 0.15,
  lowStockUnitsThreshold: 10,
  targetCoverDays: 45,
  maxCoverDays: 90,
  healthAgedMinDays: 181,
  healthExcessCoverDays: 180,
  healthLowCoverDays: 14,
  healthSlowUnitsPer30d: 3,
  healthVeryLowUnitsPer30d: 1,
  removalStuckDays: 14,
  capacityWarnPct: 80,
  capacityHighPct: 90,
  capacityCriticalPct: 100,
  usageCoverageMinPct: 95,
}

function base(overrides: Record<string, any>) {
  return {
    id: 1,
    sellerSku: 'X',
    normalizedSku: 'X',
    asin: 'B0X',
    fnsku: null,
    title: 'Product',
    fulfillmentChannel: 'AMAZON',
    inOpenListingsReport: false,
    listingStatus: 'ACTIVE',
    listingStatusRaw: 'Active',
    listingStatusReason: null,
    listingStatusAt: '2026-10-05T08:00:00.000Z',
    searchSuppressed: false,
    mappingStatus: 'CONFIRMED',
    zohoItemId: 'z',
    zohoItemCode: 'X',
    hasInventorySnapshot: true,
    inventorySnapshotAt: '2026-10-05T09:00:00.000Z',
    fulfillable: 0,
    reserved: 0,
    researching: 0,
    unfulfillable: 0,
    inboundWorking: 0,
    inboundShipped: 0,
    inboundReceiving: 0,
    totalQuantity: 0,
    warehouseAvailable: 5,
    units7d: 0,
    units30d: 0,
    units90d: 0,
    lastSaleDate: null,
    ...overrides,
  }
}

const BASE_ROWS = [
  base({ id: 1, sellerSku: 'ACT', normalizedSku: 'ACT', fulfillable: 50, reserved: 5, inboundShipped: 10, units7d: 7, units30d: 30, units90d: 90, lastSaleDate: '2026-10-04' }),
  base({ id: 2, sellerSku: 'INA', normalizedSku: 'INA', listingStatus: 'INACTIVE', listingStatusRaw: 'Inactive', fulfillable: 20, unfulfillable: 2 }),
  base({ id: 3, sellerSku: 'SUP', normalizedSku: 'SUP', listingStatus: 'SUPPRESSED', fulfillable: 10, mappingStatus: 'REVIEW_REQUIRED' }),
  base({ id: 4, sellerSku: 'UNK', normalizedSku: 'UNK', listingStatus: 'UNKNOWN', fulfillable: 7, mappingStatus: 'UNMAPPED' }),
  base({ id: 5, sellerSku: 'MFN', normalizedSku: 'MFN', fulfillmentChannel: 'DEFAULT', hasInventorySnapshot: false, inventorySnapshotAt: null, fulfillable: null, reserved: null, researching: null, unfulfillable: null, inboundWorking: null, inboundShipped: null, inboundReceiving: null }),
]

function makeService(overrides: { rows?: any[]; periods?: any[] } = {}) {
  const calls: { method: string; args: any[] }[] = []
  const rec = (method: string, value: any) => async (...args: any[]) => {
    calls.push({ method, args })
    return typeof value === 'function' ? value(...args) : value
  }
  const store = {
    getSettings: async () => ({ ...SETTINGS }),
    orderLineCoverage: async () => ({ firstPurchaseAt: '2025-01-01T00:00:00Z', lastPurchaseAt: null, lineCount: 10 }),
  }
  const chStore = {
    healthBaseRows: async () => (overrides.rows || BASE_ROWS).map((r) => ({ ...r })),
    latestAgeSnapshot: async () => [
      { snapshotDate: '2026-10-04', normalizedSku: 'ACT', ages: { inv_age_0_to_30_days: 50 }, unitsShippedT30: 30, unitsShippedT90: 90, storageType: 'Standard', storageVolume: 0.05, volumeUnit: 'cubic meters' },
      { snapshotDate: '2026-10-04', normalizedSku: 'INA', ages: { inv_age_181_to_270_days: 20 }, unitsShippedT30: 0, unitsShippedT90: 0, storageType: 'Standard', storageVolume: 0.02, volumeUnit: 'cubic meters' },
      { snapshotDate: '2026-10-04', normalizedSku: 'SUP', ages: { inv_age_0_to_30_days: 10 }, unitsShippedT30: 0, unitsShippedT90: 0, storageType: 'Standard', storageVolume: 0.01, volumeUnit: 'cubic meters' },
      { snapshotDate: '2026-10-04', normalizedSku: 'UNK', ages: { inv_age_0_to_30_days: 7 }, unitsShippedT30: 0, unitsShippedT90: 0, storageType: 'Standard', storageVolume: null, volumeUnit: null },
    ],
    listDimensions: async () => [
      { normalizedSku: 'ACT', source: 'AMAZON_PLANNING_ITEM_VOLUME', unitVolumeCm3: 1000 },
      { normalizedSku: 'INA', source: 'AMAZON_FEE_PREVIEW_PACKAGE', unitVolumeCm3: 1000 },
      { normalizedSku: 'SUP', source: 'AMAZON_MYI_PER_UNIT_VOLUME', unitVolumeCm3: 1000 },
    ],
    currentCapacityPeriods: async () => overrides.periods || [],
    listCapacityPeriods: async () => overrides.periods || [],
    listUsageSnapshots: async () => [],
    listCapacityEvents: async () => [],
    insertUsageSnapshot: rec('insertUsageSnapshot', (_mk: string, s: any) => ({ id: 77, ...s })),
    insertCapacityPeriod: rec('insertCapacityPeriod', (_mk: string, p: any) => ({ id: 1, ...p })),
    getCapacityPeriod: async () => null,
    listOpenRemovalOrders: async () => [{ removalOrderId: 'R9', statusGroup: 'OPEN', orderStatus: 'Pending', requestDate: '2026-08-01T00:00:00.000Z', lastUpdatedAt: '2026-08-02T00:00:00.000Z' }],
    syncActions: rec('syncActions', (_mk: string, actions: any[]) => ({ upserted: actions.length, resolved: 0 })),
    listActions: async () => [],
    listRemovalItems: async () => [],
    removalCounts: async () => ({ OPEN: 0, COMPLETED: 0, CANCELLED: 0, UNKNOWN: 0 }),
  }
  return { service: createCapacityHealthService({ store, chStore, now: () => NOW }), calls }
}

describe('active Amazon KSA inventory only', () => {
  it('Inventory Health defaults to ACTIVE listings; inactive / suppressed / unknown are excluded', async () => {
    const { service } = makeService()
    const out = await service.getInventoryHealth('ksa')
    assert.equal(out.filter, 'active')
    assert.deepEqual(out.rows.map((r: any) => r.sellerSku).sort(), ['ACT', 'MFN'])
    const act = out.rows.find((r: any) => r.sellerSku === 'ACT')
    assert.equal(act.fulfillable, 50)
    assert.equal(act.replenishment.eligible, true)
    assert.equal(act.mappingIndicator, 'MAPPED')
    assert.equal(act.margin, null, 'margin is not shown until trustworthy')
  })

  it('other filters: inactive with stock, suppressed, all', async () => {
    const { service } = makeService()
    const inactive = await service.getInventoryHealth('ksa', { filter: 'inactive_with_stock' })
    assert.deepEqual(inactive.rows.map((r: any) => r.sellerSku).sort(), ['INA', 'SUP', 'UNK'])
    assert.ok(inactive.rows.every((r: any) => r.replenishment.eligible === false), 'replenishment rejects non-ACTIVE')
    assert.deepEqual((await service.getInventoryHealth('ksa', { filter: 'suppressed' })).rows.map((r: any) => r.sellerSku), ['SUP'])
    assert.equal((await service.getInventoryHealth('ksa', { filter: 'all' })).total, 5)
  })

  it('Command Center summary: active KPIs exclude inactive stock; warnings count it', async () => {
    const { service } = makeService()
    const s = await service.activeInventorySummary('ksa')
    assert.equal(s.listingStatusRefreshed, true)
    assert.equal(s.activeSkus, 2)
    assert.equal(s.activeFbaSkus, 1)
    assert.equal(s.activeMfnSkus, 1)
    assert.equal(s.activeFbaFulfillable, 50, 'INA/SUP/UNK fulfillable units are not operational stock')
    assert.equal(s.activeAmazonStockUnits, 50 + 5 + 10, 'ACTIVE AMAZON KSA STOCK = physical + inbound of ACTIVE listings only')
    assert.equal(s.activeFbaReserved, 5)
    assert.equal(s.activeFbaInbound, 10)
    assert.equal(s.activeFbaUnfulfillable, 0)
    assert.equal(s.inactiveSkusWithFbaStock, 3)
    assert.equal(s.unitsInInactiveSkus, 22 + 10 + 7)
    assert.equal(s.estimatedCapacityWastedByInactive.volumeCm3, 32_000)
    assert.equal(s.estimatedCapacityWastedByInactive.confidence, 'ESTIMATE')
    assert.ok(Math.abs(s.estimatedCapacityWastedByInactive.coveragePct - (32 / 39) * 100) < 1e-9)
  })

  it('listing status never refreshed → active KPIs are unknown, not guessed', async () => {
    const { service } = makeService({ rows: BASE_ROWS.map((r) => ({ ...r, listingStatus: null })) })
    const s = await service.activeInventorySummary('ksa')
    assert.equal(s.listingStatusRefreshed, false)
    assert.equal(s.activeSkus, null)
    assert.equal(s.activeFbaFulfillable, null)
    assert.equal(s.activeAmazonStockUnits, null)
    assert.equal((await service.getInventoryHealth('ksa')).rows.length, 0, 'not-refreshed is not ACTIVE')
  })

  it('physical capacity still counts inactive, unfulfillable and unknown stock (split by class)', async () => {
    const { service } = makeService()
    const c = await service.getCapacity('ksa')
    assert.equal(c.usage.byListingClass.ACTIVE.units, 55)
    assert.equal(c.usage.byListingClass.INACTIVE.units, 30)
    assert.equal(c.usage.byListingClass.UNFULFILLABLE.units, 2)
    assert.equal(c.usage.byListingClass.OTHER_UNKNOWN.units, 7)
    assert.equal(c.usage.onHand.units, 94)
    assert.equal(c.usage.onHand.unitsWithVolume, 87)
    assert.deepEqual(c.usage.missingVolume.map((m: any) => m.sellerSku), ['UNK'])
    assert.equal(c.usage.missingVolume[0].title, 'Product')
    assert.equal(c.kpis[0].officialCapacity.status, 'LIMIT_MISSING')
    assert.equal(c.kpis[0].requiredByHealthyReplenishment.status, 'NOT_CALCULATED_YET')
    assert.equal(c.officialCapacityApi.status, 'NOT_EXPOSED')
    assert.equal(c.amazonPlanningStorageVolume.source, 'AMAZON_REPORT')
    assert.ok(Math.abs(c.amazonPlanningStorageVolume.volumeCm3 - 80_000) < 1e-6)
    assert.match(c.formula, /unit volume/)
  })

  it('inactive listings with stock are the first removal candidates, with the mapping indicator', async () => {
    const { service } = makeService()
    const r = await service.getCapacityRelease('ksa')
    const top3 = r.rows.slice(0, 3).map((x: any) => x.sellerSku).sort()
    assert.deepEqual(top3, ['INA', 'SUP', 'UNK'])
    assert.ok(r.rows.slice(0, 3).every((x: any) => x.primaryReason === 'INACTIVE_LISTING_WITH_AMAZON_STOCK'))
    const ina = r.rows.find((x: any) => x.sellerSku === 'INA')
    assert.equal(ina.potentialRemovalQty, 22)
    assert.equal(ina.potentialCapacityReleasedCm3, 22_000)
    assert.equal(r.rows.find((x: any) => x.sellerSku === 'SUP').mappingIndicator, 'AMBIGUOUS')
    assert.equal(r.rows.find((x: any) => x.sellerSku === 'UNK').mappingIndicator, 'UNMAPPED')
    assert.equal(r.rows.find((x: any) => x.sellerSku === 'UNK').potentialCapacityReleasedCm3, null)
    assert.match(r.note, /Recommendations only/)
  })

  it('inactive-with-stock list carries status, age, last sale and potential capacity', async () => {
    const { service } = makeService()
    const out = await service.getInactiveWithStock('ksa')
    assert.equal(out.summary.skus, 3)
    const ina = out.rows.find((r: any) => r.sellerSku === 'INA')
    assert.equal(ina.listingStatus, 'INACTIVE')
    assert.equal(ina.listingStatusRaw, 'Inactive')
    assert.equal(ina.oldestAgeBucket, '181–270 days')
    assert.equal(ina.capacityUsedCm3, 22_000)
  })
})

describe('capacity periods and actions through the service', () => {
  it('a new period stores the calculated-at-entry figures separately from the official limit', async () => {
    const { service, calls } = makeService()
    await service.createCapacityPeriod('ksa', { periodStart: '2026-10-01', periodEnd: '2026-12-31', storageType: 'ALL', capacityLimit: 1, capacityUnit: 'CUBIC_METERS', source: 'SELLER_CENTRAL_MANUAL' }, 'user:1')
    const insert = calls.find((c) => c.method === 'insertCapacityPeriod')!
    const p = insert.args[1]
    assert.equal(p.capacityLimit, 1)
    assert.ok(Math.abs(p.calculatedUsage - 0.087) < 1e-9, 'lower-bound on-hand m³')
    assert.ok(Math.abs(p.inboundUsage - 0.01) < 1e-9)
    assert.equal(p.committedUsage, null, 'no committed-usage source: stored as NULL, not 0')
    assert.equal(p.calculationSnapshotId, 77)
    assert.equal(insert.args[2], 'user:1')
    assert.ok(calls.some((c) => c.method === 'syncActions'), 'daily actions refreshed after a capacity change')
  })

  it('actions: capacity band from the official usage first, plus inactive / aged / stuck removal; stable keys', async () => {
    const period = { id: 4, storageType: 'ALL', capacityLimit: 100, capacityUnit: 'CUBIC_FEET', amazonReportedUsage: 92, source: 'SELLER_CENTRAL_MANUAL', enteredAt: '2026-10-01T00:00:00.000Z', verifiedAt: null }
    const { service, calls } = makeService({ periods: [period] })
    await service.refreshActions('ksa')
    const actions = calls.find((c) => c.method === 'syncActions')!.args[1]
    const keys = actions.map((a: any) => a.actionKey)
    assert.ok(keys.includes('ksa:CAPACITY_ABOVE_90:period-4'))
    assert.ok(!keys.some((k: string) => k.includes('CAPACITY_ABOVE_80')), 'only the highest band')
    assert.ok(!keys.some((k: string) => k.includes('CAPACITY_LIMIT_MISSING')), 'ALL period covers every storage type')
    for (const k of ['ksa:INACTIVE_WITH_FBA_STOCK:INA', 'ksa:AGED_INVENTORY:INA', 'ksa:VOLUME_DATA_MISSING:UNK', 'ksa:USAGE_COVERAGE_LOW:usage', 'ksa:REMOVAL_ORDER_STUCK:R9', 'ksa:UNFULFILLABLE_INVENTORY:INA']) {
      assert.ok(keys.includes(k), k)
    }
    assert.equal(new Set(keys).size, keys.length)
  })
})

describe('Command Center operational KPIs', () => {
  function ccStore(rows: any[]) {
    return {
      getSettings: async () => ({ ...SETTINGS }),
      salesTotals: async () => ({ netSalesExVat: 0, units: 0 }),
      latestInventorySnapshotAt: async () => '2026-10-05T09:00:00.000Z',
      latestWarehouseSnapshotAt: async () => null,
      inventoryTotals: async () => ({ fulfillable: 77, inbound: 10, reserved: 5, unfulfillable: 2 }),
      skuStockView: async () => rows,
      orderLineCoverage: async () => ({ firstPurchaseAt: null, lastPurchaseAt: null, lineCount: 0 }),
      dailySalesCoverage: async () => ({ firstDate: null, lastDate: null, daysWithSales: 0 }),
      lastOrderReportSync: async () => ({ lastSuccessAt: null, lastFailureAt: null, lastError: null }),
    }
  }
  const refreshStore = { summarizeJobRuns: async () => [] }
  const row = (o: any) => ({ id: 1, sellerSku: 'X', asin: null, title: null, active: true, amazonListingStatus: 'ACTIVE', fulfillmentChannel: 'AMAZON', mappingStatus: 'CONFIRMED', mappingCandidates: [], hasInventorySnapshot: true, fbaFulfillable: 0, inbound: 0, reserved: 0, unfulfillable: 0, warehouseAvailable: null, units7d: 0, units30d: 0, ...o })

  it('primary KPIs and tables use ACTIVE listings only; the combined total is kept apart', async () => {
    const rows = [
      row({ id: 1, sellerSku: 'A', fbaFulfillable: 50, reserved: 5, inbound: 10 }),
      row({ id: 2, sellerSku: 'I', amazonListingStatus: 'INACTIVE', active: false, fbaFulfillable: 0, unfulfillable: 2 }),
      row({ id: 3, sellerSku: 'S', amazonListingStatus: 'SUPPRESSED', fbaFulfillable: 27 }),
      row({ id: 4, sellerSku: 'L', fbaFulfillable: 3 }),
      row({ id: 5, sellerSku: 'U', amazonListingStatus: 'UNKNOWN', fbaFulfillable: 11, reserved: 4 }),
    ]
    const svc = createControlTowerService({
      store: ccStore(rows),
      refreshStore,
      now: () => NOW,
      activeInventory: async () => ({ listingStatusRefreshedAt: '2026-10-05T08:00:00.000Z', statusCounts: { ACTIVE: 2 }, activeAmazonStockUnits: 68, inactiveSkusWithFbaStock: 2, unitsInInactiveSkus: 29, estimatedCapacityWastedByInactive: { volumeCm3: 1000 } }),
    })
    const cc = await svc.getCommandCenter('ksa')
    assert.equal(cc.listingStatus.operationalBasis, 'AMAZON_LISTING_STATUS_ACTIVE')
    assert.equal(cc.kpis.activeSkus, 2)
    assert.equal(cc.kpis.activeFbaSkus, 2)
    assert.equal(cc.kpis.activeAmazonStockUnits, 68, 'headline ACTIVE AMAZON KSA STOCK')
    assert.equal(cc.kpis.fbaFulfillableUnits, 53, 'suppressed 27 and unknown 11 units are not operational stock')
    assert.equal(cc.kpis.reservedUnits, 5, 'unknown reserved units excluded')
    assert.equal(cc.kpis.unfulfillableUnits, 0)
    assert.equal(cc.physicalAllListings.fulfillable, 77, 'combined total is reported separately, not as the primary figure')
    assert.equal(cc.kpis.inactiveSkusWithFbaStock, 2)
    assert.equal(cc.kpis.unitsInInactiveSkus, 29)
    assert.deepEqual(cc.tables.outOfStock.rows.map((r: any) => r.sellerSku), [], 'inactive zero-stock SKU is not in the operational out-of-stock table')
    assert.deepEqual(cc.tables.lowStock.rows.map((r: any) => r.sellerSku), ['L'])
    assert.equal(cc.tables.lowStock.rows[0].listingStatus, 'ACTIVE')
  })

  it('before the first listing-status refresh nothing is treated as active (no open-listings guess)', async () => {
    const svc = createControlTowerService({ store: ccStore([row({ amazonListingStatus: null, active: true, fbaFulfillable: 4 }), row({ id: 2, sellerSku: 'Z', amazonListingStatus: null, active: true, fbaFulfillable: 0 })]), refreshStore, now: () => NOW })
    const cc = await svc.getCommandCenter('ksa')
    assert.equal(cc.listingStatus.known, false)
    assert.equal(cc.listingStatus.operationalBasis, 'LISTING_STATUS_NOT_REFRESHED')
    for (const k of ['activeSkus', 'activeFbaSkus', 'activeMfnSkus', 'activeAmazonStockUnits', 'fbaFulfillableUnits', 'inboundUnits', 'reservedUnits', 'unfulfillableUnits', 'outOfStockSkus', 'lowStockSkus', 'unmappedSkus']) {
      assert.equal(cc.kpis[k], null, `${k} must be unknown, not guessed`)
    }
    assert.equal(cc.tables.outOfStock.total, 0)
    assert.equal(cc.tables.lowStock.total, 0)
    assert.equal(cc.kpis.inactiveSkusWithFbaStock, null)
    assert.equal(cc.physicalAllListings.fulfillable, 77, 'physical totals stay available for capacity')
  })
})

describe('capacity / health jobs (report generation + GET only)', () => {
  function makeJobs(outcomes: Record<string, any>) {
    const calls: { method: string; args: any[] }[] = []
    const rec = (method: string, value: any) => async (...args: any[]) => {
      calls.push({ method, args })
      return value
    }
    const fetcher = {
      fetchReports: async (_mk: string, specs: any[]) => {
        calls.push({ method: 'fetchReports', args: [specs] })
        return Object.fromEntries(specs.map((s: any) => [s.key, { key: s.key, reportType: s.reportType, rows: [], reportId: 'r', reused: false, amazonRequestId: 'req', error: null, ...outcomes[s.key] }]))
      },
    }
    const chStore = {
      applyListingStatuses: rec('applyListingStatuses', { upserted: 2, notInReport: 0, historyRows: 2 }),
      writeAgeSnapshot: rec('writeAgeSnapshot', 1),
      upsertDimensions: rec('upsertDimensions', 3),
      upsertRemovals: rec('upsertRemovals', { ordersWritten: 1, linesWritten: 1 }),
    }
    const capacityHealth = { refreshActions: rec('refreshActions', { actions: 0 }), recordUsageSnapshot: rec('recordUsageSnapshot', { id: 5, coveragePct: 100 }) }
    const jobs = createCapacityHealthJobs({ chStore, capacityHealth, fetcher, now: () => NOW })
    return { jobs, calls }
  }
  const ctx = (mk = 'ksa') => ({ run: { id: 'run-1' }, marketplaceKey: mk, params: {}, progress() {}, setRecords() {} })
  const ALL_ROWS = [
    { 'seller-sku': 'A', asin1: 'B1', 'item-name': 'A', 'fulfillment-channel': 'AMAZON_EU', status: 'Active' },
    { 'seller-sku': 'B', asin1: 'B2', 'item-name': 'B', 'fulfillment-channel': 'AMAZON_EU', status: 'Active' },
  ]

  it('refuses UAE before any Amazon call', async () => {
    const { jobs, calls } = makeJobs({})
    for (const h of ['listing_status', 'inventory_reports', 'removal_orders']) {
      await assert.rejects(() => jobs.handlers[h](ctx('uae')), /not enabled/)
    }
    assert.equal(calls.length, 0)
  })

  it('listing_status: suppressed (FYP) beats Active; a cancelled FYP report means none suppressed', async () => {
    const { jobs, calls } = makeJobs({ all: { status: 'DONE', rows: ALL_ROWS }, suppressed: { status: 'DONE', rows: [{ sku: 'B', status: 'Search Suppressed', reason: 'Missing image' }] } })
    const res = await jobs.handlers.listing_status(ctx())
    assert.deepEqual(res.metadata.statusCounts, { ACTIVE: 1, SUPPRESSED: 1 })
    const applied = calls.find((c) => c.method === 'applyListingStatuses')!.args[1]
    assert.equal(applied.find((r: any) => r.sellerSku === 'B').status, 'SUPPRESSED')
    const cancelled = makeJobs({ all: { status: 'DONE', rows: ALL_ROWS }, suppressed: { status: 'CANCELLED', rows: [] } })
    const ok = await cancelled.jobs.handlers.listing_status(ctx())
    assert.deepEqual(ok.metadata.statusCounts, { ACTIVE: 2 })
  })

  it('listing_status leaves statuses untouched when a report is unusable (with request ids in the error)', async () => {
    const noAll = makeJobs({ all: { status: 'FATAL', error: 'x' }, suppressed: { status: 'DONE' } })
    await assert.rejects(() => noAll.jobs.handlers.listing_status(ctx()), (err: any) => err.code === 'CONTROL_TOWER_LISTING_STATUS_UNAVAILABLE' && err.metadata.reports.all.amazonRequestId === 'req')
    assert.ok(!noAll.calls.some((c) => c.method === 'applyListingStatuses'))
    const noFyp = makeJobs({ all: { status: 'DONE', rows: ALL_ROWS }, suppressed: { status: 'TIMEOUT' } })
    await assert.rejects(() => noFyp.jobs.handlers.listing_status(ctx()), /suppressed listings are not shown as ACTIVE/)
    assert.ok(!noFyp.calls.some((c) => c.method === 'applyListingStatuses'))
  })

  it('inventory_reports: writes age rows and volumes per source; never product dimensions', async () => {
    const { jobs, calls } = makeJobs({
      planning: { status: 'DONE', rows: [{ 'snapshot-date': '2026-10-04', sku: 'A', 'item-volume': '0.001', 'volume-unit-measurement': 'cubic meters', 'inv-age-0-to-30-days': '3' }] },
      fees: { status: 'DONE', rows: [{ sku: 'A', 'longest-side': '10', 'median-side': '10', 'shortest-side': '10', 'unit-of-dimension': 'centimeters' }] },
      myi: { status: 'FATAL', rows: [] },
    })
    const res = await jobs.handlers.inventory_reports(ctx())
    const dims = calls.find((c) => c.method === 'upsertDimensions')!.args[1]
    assert.deepEqual(dims.map((d: any) => d.source).sort(), ['AMAZON_FEE_PREVIEW_PACKAGE', 'AMAZON_PLANNING_ITEM_VOLUME'])
    assert.ok(dims.every((d: any) => d.dimensionKind !== 'PRODUCT'))
    assert.equal(res.metadata.reports.myi.status, 'FATAL')
    assert.ok(calls.some((c) => c.method === 'recordUsageSnapshot'))
    const specs = calls.find((c) => c.method === 'fetchReports')!.args[0]
    assert.deepEqual(specs.map((s: any) => s.reportType), ['GET_FBA_INVENTORY_PLANNING_DATA', 'GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA', 'GET_FBA_MYI_ALL_INVENTORY_DATA'])
  })

  it('removal_orders: read-only report; CANCELLED means no removals in the window', async () => {
    const { jobs, calls } = makeJobs({ detail: { status: 'CANCELLED', rows: [] } })
    const res = await jobs.handlers.removal_orders(ctx())
    assert.equal(res.metadata.noData, true)
    assert.equal(res.metadata.orders, 0)
    assert.ok(!calls.some((c) => c.method === 'upsertRemovals'))
    const spec = calls.find((c) => c.method === 'fetchReports')!.args[0][0]
    assert.equal(spec.reportType, 'GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA')
    assert.ok(spec.dataStartTime < spec.dataEndTime)
    const failed = makeJobs({ detail: { status: 'FATAL' } })
    await assert.rejects(() => failed.jobs.handlers.removal_orders(ctx()), /not usable/)
  })
})
