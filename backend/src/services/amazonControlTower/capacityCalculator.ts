'use strict'

/**
 * Calculated FBA capacity usage (an ESTIMATE, never presented as Amazon's official figure).
 *
 *   per SKU and bucket: volume = unit_volume_cm3 × units_in_bucket
 *
 *   on-hand (physical, in Amazon FCs) = fulfillable + reserved + researching + unfulfillable
 *   inbound                           = inbound_working + inbound_shipped + inbound_receiving
 *
 * Buckets come from the FBA Inventory API snapshot and do not overlap (Amazon's afn-warehouse-quantity
 * equals fulfillable + reserved + researching + unsellable), so nothing is counted twice. Inbound is kept
 * apart from on-hand.
 *
 * Physical on-hand capacity is split by listing class:
 *   ACTIVE         sellable on-hand units (fulfillable + reserved + researching) of ACTIVE listings
 *   INACTIVE       sellable on-hand units of INACTIVE / SUPPRESSED / INCOMPLETE / CLOSED listings
 *   UNFULFILLABLE  unfulfillable units of every listing
 *   OTHER_UNKNOWN  sellable on-hand units whose listing status is UNKNOWN or not refreshed
 *
 * A SKU without a unit volume is never counted as zero volume: its units are reported as
 * "volume data missing", coverage = units with volume / units, and the volume total is a lower bound.
 */

const { capacityListingClass } = require('./listingStatus.ts')

const CM3_PER_CUBIC_FOOT = 28_316.846592
const CM3_PER_CUBIC_METER = 1_000_000

const ON_HAND_BUCKETS = ['fulfillable', 'reserved', 'researching', 'unfulfillable'] as const
const INBOUND_BUCKETS = ['inboundWorking', 'inboundShipped', 'inboundReceiving'] as const
const ALL_BUCKETS = [...ON_HAND_BUCKETS, ...INBOUND_BUCKETS]
const LISTING_CLASSES = ['ACTIVE', 'INACTIVE', 'UNFULFILLABLE', 'OTHER_UNKNOWN'] as const

type CapacitySkuInput = {
  sellerSku: string
  listingStatus: string | null
  storageType: string | null
  unitVolumeCm3: number | null
  volumeSource: string | null
  fulfillable: number | null
  reserved: number | null
  researching: number | null
  unfulfillable: number | null
  inboundWorking: number | null
  inboundShipped: number | null
  inboundReceiving: number | null
}

type Tally = { units: number; unitsWithVolume: number; volumeCm3: number }

const emptyTally = (): Tally => ({ units: 0, unitsWithVolume: 0, volumeCm3: 0 })

function add(t: Tally, units: number, unitVolume: number | null) {
  if (!(units > 0)) return
  t.units += units
  if (unitVolume != null && unitVolume > 0) {
    t.unitsWithVolume += units
    t.volumeCm3 += units * unitVolume
  }
}

function coverage(t: Tally): number | null {
  return t.units > 0 ? (t.unitsWithVolume / t.units) * 100 : null
}

function units(v: number | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Planning-report storage type → capacity storage type key. */
function storageTypeKey(raw: string | null | undefined): string {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return 'UNKNOWN'
  if (s.startsWith('standard')) return 'STANDARD'
  if (s.startsWith('oversize')) return 'OVERSIZE'
  if (s.startsWith('apparel')) return 'APPAREL'
  if (s.startsWith('footwear')) return 'FOOTWEAR'
  return 'OTHER'
}

function calculateCapacityUsage(skus: CapacitySkuInput[]) {
  const buckets: Record<string, Tally> = Object.fromEntries(ALL_BUCKETS.map((b) => [b, emptyTally()]))
  const byListingClass: Record<string, Tally> = Object.fromEntries(LISTING_CLASSES.map((c) => [c, emptyTally()]))
  const byStorageType: Record<string, { onHand: Tally; inbound: Tally }> = {}
  const onHand = emptyTally()
  const inbound = emptyTally()
  const missingVolume: { sellerSku: string; onHandUnits: number; inboundUnits: number; listingClass: string }[] = []
  const volumeSources: Record<string, number> = {}

  for (const sku of skus) {
    const vol = sku.unitVolumeCm3 != null && sku.unitVolumeCm3 > 0 ? Number(sku.unitVolumeCm3) : null
    const st = storageTypeKey(sku.storageType)
    if (!byStorageType[st]) byStorageType[st] = { onHand: emptyTally(), inbound: emptyTally() }
    const sellableClass = capacityListingClass(sku.listingStatus)
    let skuOnHand = 0
    let skuInbound = 0
    for (const b of ON_HAND_BUCKETS) {
      const u = units(sku[b])
      if (!u) continue
      skuOnHand += u
      add(buckets[b], u, vol)
      add(onHand, u, vol)
      add(byStorageType[st].onHand, u, vol)
      add(byListingClass[b === 'unfulfillable' ? 'UNFULFILLABLE' : sellableClass], u, vol)
    }
    for (const b of INBOUND_BUCKETS) {
      const u = units(sku[b])
      if (!u) continue
      skuInbound += u
      add(buckets[b], u, vol)
      add(inbound, u, vol)
      add(byStorageType[st].inbound, u, vol)
    }
    if (skuOnHand + skuInbound > 0) {
      if (vol == null) missingVolume.push({ sellerSku: sku.sellerSku, onHandUnits: skuOnHand, inboundUnits: skuInbound, listingClass: sellableClass })
      else volumeSources[sku.volumeSource || 'UNKNOWN'] = (volumeSources[sku.volumeSource || 'UNKNOWN'] || 0) + 1
    }
  }

  const all = emptyTally()
  all.units = onHand.units + inbound.units
  all.unitsWithVolume = onHand.unitsWithVolume + inbound.unitsWithVolume
  all.volumeCm3 = onHand.volumeCm3 + inbound.volumeCm3
  const withCoverage = (t: Tally) => ({ ...t, coveragePct: coverage(t), isLowerBound: t.unitsWithVolume < t.units })
  return {
    onHand: withCoverage(onHand),
    inbound: withCoverage(inbound),
    total: withCoverage(all),
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, t]) => [k, withCoverage(t)])),
    byListingClass: Object.fromEntries(Object.entries(byListingClass).map(([k, t]) => [k, withCoverage(t)])),
    byStorageType: Object.fromEntries(
      Object.entries(byStorageType).map(([k, v]) => [k, { onHand: withCoverage(v.onHand), inbound: withCoverage(v.inbound) }])
    ),
    missingVolume: missingVolume.sort((a, b) => b.onHandUnits + b.inboundUnits - (a.onHandUnits + a.inboundUnits)),
    volumeSources,
    coveragePct: coverage(all),
  }
}

/** Converts a cm³ volume (or a unit count) into a capacity unit; OTHER units cannot be compared (null). */
function toCapacityUnit(volumeCm3: number | null, unitCount: number | null, capacityUnit: string): number | null {
  if (capacityUnit === 'CUBIC_FEET') return volumeCm3 == null ? null : volumeCm3 / CM3_PER_CUBIC_FOOT
  if (capacityUnit === 'CUBIC_METERS') return volumeCm3 == null ? null : volumeCm3 / CM3_PER_CUBIC_METER
  if (capacityUnit === 'UNITS') return unitCount
  return null
}

function confidenceFor(coveragePct: number | null, volumeSources: Record<string, number>): 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' {
  if (coveragePct == null) return 'NONE'
  const amazonMeasured = (volumeSources.AMAZON_PLANNING_ITEM_VOLUME || 0) + (volumeSources.AMAZON_FEE_PREVIEW_PACKAGE || 0)
  const total = Object.values(volumeSources).reduce((a, b) => a + b, 0)
  if (coveragePct >= 99.999 && total > 0 && amazonMeasured === total) return 'HIGH'
  if (coveragePct >= 95) return 'MEDIUM'
  return 'LOW'
}

type UsageSlice = { onHand: Tally & { coveragePct: number | null; isLowerBound: boolean }; inbound: Tally & { coveragePct: number | null; isLowerBound: boolean } }

/** Usage slice (on-hand + inbound) that a capacity period's storage type applies to. */
function usageForStorageType(usage: ReturnType<typeof calculateCapacityUsage>, storageType: string): UsageSlice | null {
  if (storageType === 'ALL') return { onHand: usage.onHand, inbound: usage.inbound }
  return (usage.byStorageType[storageType] as UsageSlice) || null
}

type PeriodLike = {
  id: number
  storageType: string
  capacityLimit: number | null
  capacityUnit: string
  amazonReportedUsage: number | null
  source: string
  enteredAt: string | null
  verifiedAt: string | null
}

/**
 * KPI figures for one capacity period. Official numbers (limit, Amazon-reported usage) and calculated
 * estimates are returned side by side and never mixed:
 *   calculated available = limit − calculated on-hand − calculated inbound
 *   official available   = limit − Amazon-reported usage (only when that usage was entered)
 */
function capacityKpis(
  period: PeriodLike | null,
  usage: ReturnType<typeof calculateCapacityUsage>,
  meta: { inventorySnapshotAt: string | null }
) {
  const NOT_CALCULATED = { status: 'NOT_CALCULATED_YET', reason: 'Replenishment engine is not built yet.' }
  if (!period) {
    return {
      periodId: null,
      unit: null,
      officialCapacity: { value: null, status: 'LIMIT_MISSING', source: null, asOf: null, confidence: 'NONE' },
      used: null,
      inboundCommitted: null,
      available: null,
      utilizationPct: null,
      requiredByHealthyReplenishment: NOT_CALCULATED,
      shortfall: NOT_CALCULATED,
    }
  }
  const slice = usageForStorageType(usage, period.storageType)
  const unit = period.capacityUnit
  const conf = confidenceFor(slice ? slice.onHand.coveragePct : null, usage.volumeSources)
  const calcOnHand = slice ? toCapacityUnit(slice.onHand.volumeCm3, slice.onHand.units, unit) : null
  const calcInbound = slice ? toCapacityUnit(slice.inbound.volumeCm3, slice.inbound.units, unit) : null
  const limit = period.capacityLimit
  const official = period.amazonReportedUsage
  const calcAvailable = limit != null && calcOnHand != null && calcInbound != null ? limit - calcOnHand - calcInbound : null
  const officialAvailable = limit != null && official != null ? limit - official : null
  const pct = (v: number | null) => (limit != null && limit > 0 && v != null ? (v / limit) * 100 : null)
  const calcStatus = !slice ? 'NO_USAGE_FOR_STORAGE_TYPE' : calcOnHand == null ? 'UNIT_NOT_COMPARABLE' : 'ESTIMATE'
  const calc = (value: number | null) => ({
    value,
    status: calcStatus,
    source: 'CALCULATED',
    asOf: meta.inventorySnapshotAt,
    confidence: calcStatus === 'ESTIMATE' ? conf : 'NONE',
    coveragePct: slice ? slice.onHand.coveragePct : null,
    isLowerBound: slice ? slice.onHand.isLowerBound || slice.inbound.isLowerBound : false,
  })
  const officialFigure = (value: number | null) =>
    value == null ? null : { value, status: 'OFFICIAL', source: period.source, asOf: period.verifiedAt || period.enteredAt, confidence: 'OFFICIAL' }
  return {
    periodId: period.id,
    unit,
    officialCapacity: {
      value: limit,
      status: limit == null ? 'LIMIT_MISSING' : 'OFFICIAL',
      source: period.source,
      asOf: period.verifiedAt || period.enteredAt,
      confidence: limit == null ? 'NONE' : 'OFFICIAL',
    },
    used: { official: officialFigure(official), calculated: calc(calcOnHand) },
    inboundCommitted: { calculated: calc(calcInbound) },
    available: { official: officialFigure(officialAvailable), calculated: calc(calcAvailable) },
    utilizationPct: {
      official: officialFigure(pct(official)),
      calculated: calc(calcOnHand != null && calcInbound != null ? pct(calcOnHand + calcInbound) : null),
    },
    requiredByHealthyReplenishment: NOT_CALCULATED,
    shortfall: NOT_CALCULATED,
  }
}

module.exports = {
  CM3_PER_CUBIC_FOOT,
  CM3_PER_CUBIC_METER,
  ON_HAND_BUCKETS,
  INBOUND_BUCKETS,
  storageTypeKey,
  calculateCapacityUsage,
  toCapacityUnit,
  confidenceFor,
  usageForStorageType,
  capacityKpis,
}
