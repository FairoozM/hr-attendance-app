'use strict'

/**
 * Pure capacity / inventory-health / removals logic: report parsers, listing status, the capacity
 * formula (official vs calculated, missing volumes, coverage), health classes, capacity release and
 * deduplicated daily actions.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  parseAllListingsRow,
  parseSuppressedRow,
  classifyListingStatus,
  isOperationallyActive,
  replenishmentEligibility,
  capacityListingClass,
} = require('../src/services/amazonControlTower/listingStatus.ts')
const {
  parsePlanningRow,
  parseMyiAllRow,
  parseFeePreviewRow,
  resolveUnitVolume,
  summarizeAge,
  volumeToCm3,
} = require('../src/services/amazonControlTower/inventoryReportParsers.ts')
const {
  removalStatusGroup,
  parseRemovalDetailRow,
  aggregateRemovalOrders,
  isRemovalStuck,
} = require('../src/services/amazonControlTower/removalReportParser.ts')
const {
  calculateCapacityUsage,
  capacityKpis,
  toCapacityUnit,
  CM3_PER_CUBIC_FOOT,
} = require('../src/services/amazonControlTower/capacityCalculator.ts')
const {
  classifyHealth,
  capacityReleaseOpportunity,
  rankReleaseOpportunities,
} = require('../src/services/amazonControlTower/inventoryHealth.ts')
const { buildActions } = require('../src/services/amazonControlTower/controlTowerActions.ts')

const THRESHOLDS = { agedMinDays: 181, excessCoverDays: 180, lowCoverDays: 14, maxCoverDays: 90, slowUnitsPer30d: 3, veryLowUnitsPer30d: 1 }

function sku(overrides: Record<string, any> = {}) {
  return {
    sellerSku: 'SKU-1',
    listingStatus: 'ACTIVE',
    storageType: 'Standard',
    unitVolumeCm3: 1000,
    volumeSource: 'AMAZON_PLANNING_ITEM_VOLUME',
    fulfillable: 0,
    reserved: 0,
    researching: 0,
    unfulfillable: 0,
    inboundWorking: 0,
    inboundShipped: 0,
    inboundReceiving: 0,
    ...overrides,
  }
}

function healthInput(overrides: Record<string, any> = {}) {
  return {
    sellerSku: 'SKU-1',
    listingStatus: 'ACTIVE',
    hasInventorySnapshot: true,
    fulfillable: 100,
    reserved: 0,
    researching: 0,
    unfulfillable: 0,
    inbound: 0,
    units7d: 10,
    units30d: 40,
    units90d: 120,
    salesHistoryDays: 365,
    amazonUnitsShippedT30: null,
    amazonUnitsShippedT90: null,
    age: { oldestBucket: '0–30 days', oldestMinDays: 0, agedUnits: 0, totalUnits: 100 },
    unitVolumeCm3: 1000,
    ...overrides,
  }
}

describe('listing status (authoritative Amazon status)', () => {
  const listing = (status: string, channel = 'AMAZON_EU') =>
    parseAllListingsRow({ 'seller-sku': ' sku-1 ', asin1: 'B01', 'item-name': 'Brush', 'fulfillment-channel': channel, status })

  it('parses the all-listings report row', () => {
    const l = listing('Active')
    assert.equal(l.sellerSku, 'sku-1')
    assert.equal(l.asin, 'B01')
    assert.equal(l.title, 'Brush')
    assert.equal(l.fulfillmentChannel, 'AMAZON')
    assert.equal(listing('Active', 'DEFAULT').fulfillmentChannel, 'DEFAULT')
    assert.equal(parseAllListingsRow({ status: 'Active' }), null)
  })

  it('classifies ACTIVE / INACTIVE / INCOMPLETE / CLOSED and keeps the raw status', () => {
    assert.deepEqual(classifyListingStatus({ listing: listing('Active'), suppressed: null }), { status: 'ACTIVE', rawStatus: 'Active', reason: null })
    const inactive = classifyListingStatus({ listing: listing('Inactive'), suppressed: null })
    assert.equal(inactive.status, 'INACTIVE')
    assert.equal(inactive.rawStatus, 'Inactive')
    assert.ok(inactive.reason)
    assert.equal(classifyListingStatus({ listing: listing('Incomplete'), suppressed: null }).status, 'INCOMPLETE')
    assert.equal(classifyListingStatus({ listing: listing('Closed'), suppressed: null }).status, 'CLOSED')
  })

  it('search-suppressed (FYP) wins over the raw status and keeps the reason', () => {
    const suppressed = parseSuppressedRow({ sku: 'SKU-1', status: 'Search Suppressed', reason: 'Missing image', 'issue description': 'Main image missing' })
    const c = classifyListingStatus({ listing: listing('Active'), suppressed })
    assert.equal(c.status, 'SUPPRESSED')
    assert.equal(c.rawStatus, 'Active')
    assert.match(c.reason, /Missing image/)
  })

  it('UNKNOWN is never ACTIVE: missing from the report or an unrecognised status', () => {
    assert.equal(classifyListingStatus({ listing: null, suppressed: null }).status, 'UNKNOWN')
    assert.equal(classifyListingStatus({ listing: listing('Weird'), suppressed: null }).status, 'UNKNOWN')
    assert.equal(classifyListingStatus({ listing: listing(''), suppressed: null }).status, 'UNKNOWN')
    for (const s of ['UNKNOWN', 'INACTIVE', 'SUPPRESSED', 'INCOMPLETE', 'CLOSED', null, undefined]) assert.equal(isOperationallyActive(s), false)
    assert.equal(isOperationallyActive('ACTIVE'), true)
  })

  it('replenishment rejects every listing that is not ACTIVE', () => {
    assert.equal(replenishmentEligibility({ listingStatus: 'ACTIVE' }).eligible, true)
    for (const s of ['INACTIVE', 'SUPPRESSED', 'INCOMPLETE', 'CLOSED', 'UNKNOWN', null]) {
      const r = replenishmentEligibility({ listingStatus: s })
      assert.equal(r.eligible, false, `${s} must be rejected`)
      assert.ok(r.reason)
    }
  })

  it('capacity listing classes', () => {
    assert.equal(capacityListingClass('ACTIVE'), 'ACTIVE')
    for (const s of ['INACTIVE', 'SUPPRESSED', 'INCOMPLETE', 'CLOSED']) assert.equal(capacityListingClass(s), 'INACTIVE')
    assert.equal(capacityListingClass('UNKNOWN'), 'OTHER_UNKNOWN')
    assert.equal(capacityListingClass(null), 'OTHER_UNKNOWN')
  })
})

describe('report parsers', () => {
  it('inventory planning: Amazon age buckets, units shipped, item volume; blanks and -1 stay null', () => {
    const p = parsePlanningRow({
      'snapshot-date': '2026-10-04',
      'inventory age snapshot date': '2026-10-03',
      sku: 'SKU-1',
      'inv-age-0-to-30-days': '5',
      'inv-age-181-to-270-days': '40',
      'inv-age-365-plus-days': '',
      'units-shipped-t30': '12',
      'units-shipped-t90': '-1',
      'item-volume': '0.0021',
      'volume-unit-measurement': 'cubic meters',
      'storage-type': 'Standard',
      'storage-volume': '0.105',
    })
    assert.equal(p.snapshotDate, '2026-10-04')
    assert.equal(p.inventoryAgeSnapshotDate, '2026-10-03')
    assert.equal(p.inv_age_0_to_30_days, 5)
    assert.equal(p.inv_age_181_to_270_days, 40)
    assert.equal(p.inv_age_365_plus_days, null, 'blank is unknown, not zero')
    assert.equal(p.unitsShippedT30, 12)
    assert.equal(p.unitsShippedT90, null, '-1 means not available')
    assert.equal(Math.round(p.itemVolumeCm3), 2100)
    assert.equal(p.storageType, 'Standard')
  })

  it('age summary uses non-overlapping buckets and the aged threshold', () => {
    const s = summarizeAge({ inv_age_0_to_30_days: 5, inv_age_91_to_180_days: 3, inv_age_181_to_270_days: 40, inv_age_0_to_90_days: 999 }, 181)
    assert.equal(s.agedUnits, 40)
    assert.equal(s.totalUnits, 48, 'the overlapping 0-90 bucket is ignored')
    assert.equal(s.oldestBucket, '181–270 days')
    assert.equal(summarizeAge({}, 181), null)
  })

  it('MYI per-unit volume and fee-preview package sides', () => {
    const m = parseMyiAllRow({ sku: 'SKU-1', 'afn-fulfillable-quantity': '7', 'afn-unsellable-quantity': '', 'per-unit-volume': '2100' })
    assert.equal(m.afnFulfillableQuantity, 7)
    assert.equal(m.afnUnsellableQuantity, null)
    assert.equal(m.perUnitVolumeCm3, 2100)
    const f = parseFeePreviewRow({ sku: 'SKU-1', 'longest-side': '20', 'median-side': '10', 'shortest-side': '5', 'unit-of-dimension': 'centimeters' })
    assert.equal(f.packageVolumeCm3, 1000)
    assert.equal(parseFeePreviewRow({ sku: 'SKU-1', 'longest-side': '20', 'median-side': '', 'shortest-side': '5', 'unit-of-dimension': 'cm' }).packageVolumeCm3, null)
    assert.equal(volumeToCm3(1, 'furlongs'), null, 'unknown units are never guessed')
  })

  it('unit volume follows the source hierarchy and never falls back to zero', () => {
    const records = [
      { source: 'AMAZON_MYI_PER_UNIT_VOLUME', unitVolumeCm3: 900 },
      { source: 'AMAZON_FEE_PREVIEW_PACKAGE', unitVolumeCm3: 1000 },
      { source: 'AMAZON_PLANNING_ITEM_VOLUME', unitVolumeCm3: null },
    ]
    assert.deepEqual(resolveUnitVolume(records), { unitVolumeCm3: 1000, source: 'AMAZON_FEE_PREVIEW_PACKAGE' })
    assert.equal(resolveUnitVolume([{ source: 'AMAZON_PLANNING_ITEM_VOLUME', unitVolumeCm3: 0 }]), null)
    assert.equal(resolveUnitVolume([{ source: 'PRODUCT_DIMENSIONS', unitVolumeCm3: 500 }]), null, 'product dimensions are not a source')
  })

  it('removal status groups and report rows', () => {
    assert.equal(removalStatusGroup('Completed'), 'COMPLETED')
    assert.equal(removalStatusGroup('Pending'), 'OPEN')
    assert.equal(removalStatusGroup('Cancelled'), 'CANCELLED')
    assert.equal(removalStatusGroup('Something new'), 'UNKNOWN')
    const row = parseRemovalDetailRow({
      'request-date': '2026-09-01T10:00:00+00:00',
      'order-id': 'R1',
      'order-type': 'Return',
      'order-status': 'Completed',
      'last-updated-date': '2026-09-05T10:00:00+00:00',
      sku: 'SKU-1',
      fnsku: 'X001',
      disposition: 'Sellable',
      'requested-quantity': '10',
      'cancelled-quantity': '2',
      'disposed-quantity': '0',
      'shipped-quantity': '8',
      'in-process-quantity': '0',
    })
    assert.equal(row.completedQuantity, 8, 'completed = shipped + disposed')
    assert.equal(row.statusGroup, 'COMPLETED')
    const allCancelled = parseRemovalDetailRow({ 'order-id': 'R2', sku: 'S', 'order-status': 'Completed', 'requested-quantity': '3', 'cancelled-quantity': '3', 'shipped-quantity': '0', 'disposed-quantity': '0' })
    assert.equal(allCancelled.statusGroup, 'CANCELLED')
  })

  it('removal orders aggregate per order; stuck = OPEN without update for N days', () => {
    const lines = [
      parseRemovalDetailRow({ 'order-id': 'R1', sku: 'A', 'order-status': 'Pending', 'requested-quantity': '2', 'last-updated-date': '2026-09-01T00:00:00Z' }),
      parseRemovalDetailRow({ 'order-id': 'R1', sku: 'B', 'order-status': 'Completed', 'requested-quantity': '3', 'shipped-quantity': '3' }),
      parseRemovalDetailRow({ 'order-id': 'R2', sku: 'C', 'order-status': 'Cancelled', 'requested-quantity': '1', 'cancelled-quantity': '1' }),
    ]
    const orders = aggregateRemovalOrders(lines)
    const r1 = orders.find((o: any) => o.removalOrderId === 'R1')
    assert.equal(r1.statusGroup, 'OPEN')
    assert.equal(r1.requestedQuantity, 5)
    assert.equal(r1.lineCount, 2)
    assert.equal(orders.find((o: any) => o.removalOrderId === 'R2').statusGroup, 'CANCELLED')
    assert.equal(isRemovalStuck(r1, new Date('2026-09-20T00:00:00Z'), 14), true)
    assert.equal(isRemovalStuck(r1, new Date('2026-09-10T00:00:00Z'), 14), false)
    assert.equal(isRemovalStuck({ ...r1, statusGroup: 'COMPLETED' }, new Date('2027-01-01T00:00:00Z'), 14), false)
  })
})

describe('capacity usage (calculated estimate)', () => {
  it('volume = unit volume × units per bucket; on-hand and inbound kept apart (no double counting)', () => {
    const u = calculateCapacityUsage([sku({ fulfillable: 10, reserved: 2, researching: 1, unfulfillable: 3, inboundWorking: 4, inboundShipped: 5, inboundReceiving: 6 })])
    assert.equal(u.onHand.units, 16)
    assert.equal(u.onHand.volumeCm3, 16_000)
    assert.equal(u.inbound.units, 15)
    assert.equal(u.inbound.volumeCm3, 15_000)
    assert.equal(u.total.units, 31)
    assert.equal(u.buckets.unfulfillable.units, 3)
    assert.equal(u.coveragePct, 100)
    assert.equal(u.onHand.isLowerBound, false)
  })

  it('missing volume is flagged, never zero, and coverage shows the partial basis', () => {
    const u = calculateCapacityUsage([sku({ fulfillable: 30 }), sku({ sellerSku: 'NO-VOL', unitVolumeCm3: null, volumeSource: null, fulfillable: 10 })])
    assert.equal(u.onHand.units, 40)
    assert.equal(u.onHand.unitsWithVolume, 30)
    assert.equal(u.onHand.volumeCm3, 30_000)
    assert.equal(u.coveragePct, 75)
    assert.equal(u.onHand.isLowerBound, true)
    assert.deepEqual(u.missingVolume.map((m: any) => m.sellerSku), ['NO-VOL'])
  })

  it('physical capacity counts every listing: active, inactive, unfulfillable and unknown are split', () => {
    const u = calculateCapacityUsage([
      sku({ sellerSku: 'A', listingStatus: 'ACTIVE', fulfillable: 10, unfulfillable: 1 }),
      sku({ sellerSku: 'I', listingStatus: 'INACTIVE', fulfillable: 5 }),
      sku({ sellerSku: 'S', listingStatus: 'SUPPRESSED', reserved: 2 }),
      sku({ sellerSku: 'U', listingStatus: 'UNKNOWN', fulfillable: 4, unfulfillable: 2 }),
    ])
    assert.equal(u.byListingClass.ACTIVE.units, 10)
    assert.equal(u.byListingClass.INACTIVE.units, 7, 'inactive stock still occupies capacity')
    assert.equal(u.byListingClass.UNFULFILLABLE.units, 3)
    assert.equal(u.byListingClass.OTHER_UNKNOWN.units, 4)
    assert.equal(u.onHand.units, 24)
  })

  it('unit conversion: cubic feet / cubic meters / units; OTHER is not comparable', () => {
    assert.equal(toCapacityUnit(CM3_PER_CUBIC_FOOT * 2, 5, 'CUBIC_FEET'), 2)
    assert.equal(toCapacityUnit(2_000_000, 5, 'CUBIC_METERS'), 2)
    assert.equal(toCapacityUnit(123, 5, 'UNITS'), 5)
    assert.equal(toCapacityUnit(123, 5, 'OTHER'), null)
  })

  it('KPIs keep official and calculated figures apart; required/shortfall are NOT CALCULATED YET', () => {
    const usage = calculateCapacityUsage([sku({ fulfillable: 10, inboundShipped: 5, unitVolumeCm3: CM3_PER_CUBIC_FOOT })])
    const period = { id: 1, storageType: 'ALL', capacityLimit: 100, capacityUnit: 'CUBIC_FEET', amazonReportedUsage: 60, source: 'SELLER_CENTRAL_MANUAL', enteredAt: '2026-10-01T00:00:00.000Z', verifiedAt: null }
    const k = capacityKpis(period, usage, { inventorySnapshotAt: '2026-10-05T09:00:00.000Z' })
    assert.equal(k.officialCapacity.value, 100)
    assert.equal(k.officialCapacity.confidence, 'OFFICIAL')
    const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`)
    assert.equal(k.used.official.value, 60)
    near(k.used.calculated.value, 10)
    assert.equal(k.used.calculated.source, 'CALCULATED')
    assert.equal(k.used.calculated.status, 'ESTIMATE')
    assert.equal(k.used.calculated.asOf, '2026-10-05T09:00:00.000Z')
    near(k.inboundCommitted.calculated.value, 5)
    assert.equal(k.available.official.value, 40)
    near(k.available.calculated.value, 85)
    assert.equal(k.utilizationPct.official.value, 60)
    near(k.utilizationPct.calculated.value, 15)
    assert.equal(k.requiredByHealthyReplenishment.status, 'NOT_CALCULATED_YET')
    assert.equal(k.shortfall.status, 'NOT_CALCULATED_YET')
  })

  it('no official usage entered → official used/available stay empty (never filled with the estimate)', () => {
    const usage = calculateCapacityUsage([sku({ fulfillable: 10 })])
    const k = capacityKpis({ id: 2, storageType: 'ALL', capacityLimit: 50, capacityUnit: 'CUBIC_METERS', amazonReportedUsage: null, source: 'SELLER_CENTRAL_MANUAL', enteredAt: null, verifiedAt: null }, usage, { inventorySnapshotAt: null })
    assert.equal(k.used.official, null)
    assert.equal(k.available.official, null)
    assert.ok(k.used.calculated.value > 0)
  })

  it('missing limit → LIMIT_MISSING', () => {
    const k = capacityKpis(null, calculateCapacityUsage([]), { inventorySnapshotAt: null })
    assert.equal(k.officialCapacity.status, 'LIMIT_MISSING')
    assert.equal(k.shortfall.status, 'NOT_CALCULATED_YET')
  })

  it('partial volume coverage lowers confidence and marks the figure as a lower bound', () => {
    const usage = calculateCapacityUsage([sku({ fulfillable: 50 }), sku({ sellerSku: 'X', unitVolumeCm3: null, fulfillable: 50 })])
    const k = capacityKpis({ id: 3, storageType: 'ALL', capacityLimit: 10, capacityUnit: 'CUBIC_METERS', amazonReportedUsage: null, source: 'SELLER_CENTRAL_MANUAL', enteredAt: null, verifiedAt: null }, usage, { inventorySnapshotAt: null })
    assert.equal(k.used.calculated.confidence, 'LOW')
    assert.equal(k.used.calculated.coveragePct, 50)
    assert.equal(k.used.calculated.isLowerBound, true)
  })
})

describe('inventory health classes', () => {
  const cls = (o: Record<string, any>) => classifyHealth(healthInput(o), THRESHOLDS)

  it('HEALTHY / WATCH / SLOW / EXCESS / AGED / ZERO SALES / OUT / DATA INCOMPLETE', () => {
    assert.equal(cls({}).status, 'HEALTHY')
    assert.equal(cls({ fulfillable: 10 }).status, 'WATCH', '10 units at 40/30d ≈ 7.5 days < 14')
    assert.equal(cls({ units30d: 2, units90d: 6, fulfillable: 5 }).status, 'SLOW')
    assert.equal(cls({ fulfillable: 300, units30d: 40 }).status, 'EXCESS', '300 / (40/30) = 225 days > 180')
    assert.equal(cls({ age: { oldestBucket: '181–270 days', oldestMinDays: 181, agedUnits: 20, totalUnits: 100 } }).status, 'AGED')
    assert.equal(cls({ units30d: 0, units90d: 0 }).status, 'ZERO_SALES')
    assert.equal(cls({ fulfillable: 0 }).status, 'OUT_ZERO_FBA')
    assert.equal(cls({ hasInventorySnapshot: false }).status, 'DATA_INCOMPLETE')
    const short = cls({ salesHistoryDays: 20, amazonUnitsShippedT90: null, amazonUnitsShippedT30: null })
    assert.equal(short.status, 'DATA_INCOMPLETE')
    assert.ok(short.flags.includes('INSUFFICIENT_SALES_HISTORY'))
  })

  it('short app history uses Amazon planning units shipped (labelled)', () => {
    const h = cls({ salesHistoryDays: 20, amazonUnitsShippedT30: 30, amazonUnitsShippedT90: 90 })
    assert.equal(h.units90d, 90)
    assert.equal(h.sales90Source, 'AMAZON_PLANNING_UNITS_SHIPPED')
    assert.ok(h.flags.includes('SALES_FROM_AMAZON_PLANNING_REPORT'))
  })

  it('thresholds are configurable', () => {
    const h = classifyHealth(healthInput({ fulfillable: 300, units30d: 40 }), { ...THRESHOLDS, excessCoverDays: 400, maxCoverDays: 400 })
    assert.equal(h.status, 'HEALTHY')
  })

  it('flags inactive listings with FBA stock, unknown status and missing volume', () => {
    const h = cls({ listingStatus: 'INACTIVE', unitVolumeCm3: null, unfulfillable: 2 })
    for (const f of ['INACTIVE_WITH_FBA_STOCK', 'VOLUME_DATA_MISSING', 'UNFULFILLABLE']) assert.ok(h.flags.includes(f), f)
    assert.ok(cls({ listingStatus: null }).flags.includes('LISTING_STATUS_UNKNOWN'))
  })
})

describe('capacity release opportunities (recommendations only)', () => {
  const opp = (o: Record<string, any>) => {
    const input = { ...healthInput(o), volumeSource: 'AMAZON_PLANNING_ITEM_VOLUME' }
    return capacityReleaseOpportunity({ ...input, health: classifyHealth(input, THRESHOLDS) }, THRESHOLDS)
  }

  it('inactive listing with Amazon stock is a high-priority candidate', () => {
    const o = opp({ listingStatus: 'INACTIVE', fulfillable: 20, unfulfillable: 3 })
    assert.equal(o.primaryReason, 'INACTIVE_LISTING_WITH_AMAZON_STOCK')
    assert.equal(o.priority, 'HIGH')
    assert.equal(o.potentialRemovalQty, 23)
    assert.equal(o.potentialCapacityReleasedCm3, 23_000)
  })

  it('zero sales 90d, unfulfillable and aged reasons; quantity is never the sum of reasons', () => {
    const o = opp({ units30d: 0, units90d: 0, fulfillable: 50, unfulfillable: 5, age: { oldestBucket: '181–270 days', oldestMinDays: 181, agedUnits: 30, totalUnits: 50 } })
    const reasons = o.reasons.map((r: any) => r.reason)
    for (const r of ['UNFULFILLABLE', 'ZERO_SALES_90D', 'AGED_INVENTORY']) assert.ok(reasons.includes(r), r)
    assert.equal(o.potentialRemovalQty, 50, 'max single-reason quantity, capped at fulfillable + unfulfillable')
  })

  it('excess cover keeps max cover days of stock', () => {
    const o = opp({ fulfillable: 300, units30d: 30, units90d: 90 })
    assert.equal(o.primaryReason, 'EXCESS_COVER')
    assert.equal(o.potentialRemovalQty, 300 - 90)
  })

  it('missing volume → potential capacity unknown (not zero)', () => {
    const o = opp({ listingStatus: 'INACTIVE', unitVolumeCm3: null })
    assert.equal(o.potentialCapacityReleasedCm3, null)
    assert.equal(o.volumeStatus, 'VOLUME_DATA_MISSING')
    assert.equal(o.confidence, 'LOW')
  })

  it('healthy active SKU has no opportunity; ranking puts inactive first', () => {
    assert.equal(opp({}), null)
    const ranked = rankReleaseOpportunities([
      { primaryReason: 'EXCESS_COVER', potentialCapacityReleasedCm3: 1e9, potentialRemovalQty: 1000 },
      { primaryReason: 'INACTIVE_LISTING_WITH_AMAZON_STOCK', potentialCapacityReleasedCm3: 10, potentialRemovalQty: 1 },
    ])
    assert.equal(ranked[0].primaryReason, 'INACTIVE_LISTING_WITH_AMAZON_STOCK')
  })
})

describe('daily actions', () => {
  const base = {
    marketplaceKey: 'ksa',
    thresholds: { warnPct: 80, highPct: 90, criticalPct: 100, coverageMinPct: 95 },
    capacity: [] as any[],
    storageTypesWithStock: ['STANDARD'],
    coveragePct: 100,
    missingVolume: [] as any[],
    health: [] as any[],
    stuckRemovals: [] as any[],
  }

  it('capacity bands are exclusive per period (only the highest is raised)', () => {
    const at = (pct: number) => buildActions({ ...base, capacity: [{ periodId: 1, storageType: 'ALL', utilizationPct: pct, basis: 'CALCULATED' }] }).map((a: any) => a.actionType)
    assert.deepEqual(at(85).filter((t: string) => t.startsWith('CAPACITY_')), ['CAPACITY_ABOVE_80'])
    assert.deepEqual(at(95).filter((t: string) => t.startsWith('CAPACITY_')), ['CAPACITY_ABOVE_90'])
    assert.deepEqual(at(101).filter((t: string) => t.startsWith('CAPACITY_')), ['CAPACITY_CRITICAL'])
    assert.deepEqual(at(50).filter((t: string) => t.startsWith('CAPACITY_')), [])
  })

  it('limit missing per storage type with stock unless an ALL period covers it', () => {
    assert.ok(buildActions(base).some((a: any) => a.actionKey === 'ksa:CAPACITY_LIMIT_MISSING:STANDARD'))
    const covered = buildActions({ ...base, capacity: [{ periodId: 1, storageType: 'ALL', utilizationPct: 10, basis: 'OFFICIAL' }] })
    assert.ok(!covered.some((a: any) => a.actionType === 'CAPACITY_LIMIT_MISSING'))
  })

  it('stable keys and no duplicates for repeated conditions', () => {
    const input = {
      ...base,
      coveragePct: 80,
      missingVolume: [{ sellerSku: 'X', onHandUnits: 3, inboundUnits: 0 }, { sellerSku: 'X', onHandUnits: 3, inboundUnits: 0 }],
      health: [
        { sellerSku: 'A', status: 'AGED', flags: ['INACTIVE_WITH_FBA_STOCK', 'UNFULFILLABLE'], agedUnits: 5, daysOfCover: 10, unfulfillable: 2, listingStatus: 'INACTIVE', physicalFbaUnits: 9 },
        { sellerSku: 'A', status: 'AGED', flags: [], agedUnits: 5, daysOfCover: 10, unfulfillable: 2, listingStatus: 'INACTIVE', physicalFbaUnits: 9 },
        { sellerSku: 'B', status: 'EXCESS', flags: [], agedUnits: 0, daysOfCover: 400, unfulfillable: 0, listingStatus: 'ACTIVE', physicalFbaUnits: 400 },
      ],
      stuckRemovals: [{ removalOrderId: 'R1', lastUpdatedAt: null, orderStatus: 'Pending' }],
    }
    const a1 = buildActions(input)
    const a2 = buildActions(input)
    assert.deepEqual(a1.map((a: any) => a.actionKey), a2.map((a: any) => a.actionKey))
    const keys = a1.map((a: any) => a.actionKey)
    assert.equal(new Set(keys).size, keys.length)
    for (const k of [
      'ksa:USAGE_COVERAGE_LOW:usage',
      'ksa:VOLUME_DATA_MISSING:X',
      'ksa:INACTIVE_WITH_FBA_STOCK:A',
      'ksa:AGED_INVENTORY:A',
      'ksa:UNFULFILLABLE_INVENTORY:A',
      'ksa:EXCESS_INVENTORY:B',
      'ksa:REMOVAL_ORDER_STUCK:R1',
    ]) assert.ok(keys.includes(k), k)
    assert.equal(a1[0].severity, 'HIGH', 'sorted by severity')
  })
})
