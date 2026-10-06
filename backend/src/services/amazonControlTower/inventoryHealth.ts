'use strict'

/**
 * Inventory health classification and capacity-release opportunities. Everything here is a
 * recommendation for a human; nothing creates removals, changes listings or allocates capacity.
 *
 * Sales windows: the app's daily sales rollup when it covers the window, otherwise Amazon's own
 * units-shipped t30/t90 from the inventory planning report (labelled), otherwise unknown (DATA INCOMPLETE).
 *
 * Status precedence (first match wins; every applicable flag is still reported):
 *   DATA_INCOMPLETE  no FBA inventory snapshot, or 90-day sales unknown
 *   OUT_ZERO_FBA     0 fulfillable FBA units
 *   ZERO_SALES       no units sold in 90 days while FBA units > 0
 *   AGED             units in Amazon age buckets ≥ aged threshold
 *   EXCESS           days of cover > excess threshold
 *   SLOW             30-day units below the slow threshold
 *   WATCH            days of cover below the low-cover threshold or above max cover
 *   HEALTHY
 */

const { LISTING_STATUS } = require('./listingStatus.ts')

const HEALTH_STATUS = Object.freeze({
  HEALTHY: 'HEALTHY',
  WATCH: 'WATCH',
  SLOW: 'SLOW',
  EXCESS: 'EXCESS',
  AGED: 'AGED',
  ZERO_SALES: 'ZERO_SALES',
  OUT_ZERO_FBA: 'OUT_ZERO_FBA',
  DATA_INCOMPLETE: 'DATA_INCOMPLETE',
})

type HealthThresholds = {
  agedMinDays: number
  excessCoverDays: number
  lowCoverDays: number
  maxCoverDays: number
  slowUnitsPer30d: number
  veryLowUnitsPer30d: number
}

type AgeSummary = { oldestBucket: string | null; oldestMinDays: number | null; agedUnits: number; totalUnits: number } | null

type HealthSkuInput = {
  sellerSku: string
  listingStatus: string | null
  hasInventorySnapshot: boolean
  fulfillable: number | null
  reserved: number | null
  researching: number | null
  unfulfillable: number | null
  inbound: number | null
  units7d: number | null
  units30d: number | null
  units90d: number | null
  salesHistoryDays: number
  amazonUnitsShippedT30: number | null
  amazonUnitsShippedT90: number | null
  age: AgeSummary
  unitVolumeCm3: number | null
}

const n0 = (v: number | null | undefined) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0)

/** 30/90-day units with their source; null when neither our rollup nor Amazon covers the window. */
function salesWindows(sku: HealthSkuInput) {
  const pickWindow = (days: number, ours: number | null, amazon: number | null) => {
    if (sku.salesHistoryDays >= days && ours != null) return { units: ours, source: 'APP_DAILY_SALES' }
    if (amazon != null) return { units: amazon, source: 'AMAZON_PLANNING_UNITS_SHIPPED' }
    return { units: null as number | null, source: null as string | null }
  }
  const w7 = sku.salesHistoryDays >= 7 && sku.units7d != null ? sku.units7d : null
  return {
    units7d: w7,
    w30: pickWindow(30, sku.units30d, sku.amazonUnitsShippedT30),
    w90: pickWindow(90, sku.units90d, sku.amazonUnitsShippedT90),
  }
}

function physicalFbaUnits(sku: HealthSkuInput): number {
  return n0(sku.fulfillable) + n0(sku.reserved) + n0(sku.researching) + n0(sku.unfulfillable)
}

const RECOMMENDED_ACTION: Record<string, string> = {
  DATA_INCOMPLETE: 'Refresh data / extend sales history before deciding',
  OUT_ZERO_FBA: 'No sellable FBA units — check warehouse availability (manual)',
  ZERO_SALES: 'No sales in 90 days — review listing; consider a removal order in Seller Central',
  AGED: 'Aged units — review price/promotion or remove aged units in Seller Central',
  EXCESS: 'Excess cover — hold replenishment; consider removing the excess',
  SLOW: 'Slow seller — review price, content and visibility',
  WATCH: 'Watch days of cover',
  HEALTHY: 'No action',
}

function classifyHealth(sku: HealthSkuInput, t: HealthThresholds) {
  const flags: string[] = []
  const sales = salesWindows(sku)
  const units30 = sales.w30.units
  const units90 = sales.w90.units
  const velocity30 = units30 == null ? null : units30 / 30
  const velocity7 = sales.units7d == null ? null : sales.units7d / 7
  const fulfillable = n0(sku.fulfillable)
  const daysOfCover = velocity30 && velocity30 > 0 ? fulfillable / velocity30 : null
  const physical = physicalFbaUnits(sku)

  if (n0(sku.unfulfillable) > 0) flags.push('UNFULFILLABLE')
  if (sku.listingStatus !== LISTING_STATUS.ACTIVE && physical + n0(sku.inbound) > 0) flags.push('INACTIVE_WITH_FBA_STOCK')
  if (!sku.listingStatus || sku.listingStatus === LISTING_STATUS.UNKNOWN) flags.push('LISTING_STATUS_UNKNOWN')
  if (physical > 0 && sku.unitVolumeCm3 == null) flags.push('VOLUME_DATA_MISSING')
  if (physical > 0 && !sku.age) flags.push('AGE_UNKNOWN')
  if (sales.w90.source === 'AMAZON_PLANNING_UNITS_SHIPPED' || sales.w30.source === 'AMAZON_PLANNING_UNITS_SHIPPED') flags.push('SALES_FROM_AMAZON_PLANNING_REPORT')

  let status: string
  let reason: string
  if (!sku.hasInventorySnapshot) {
    status = HEALTH_STATUS.DATA_INCOMPLETE
    reason = 'No FBA inventory snapshot for this SKU'
  } else if (fulfillable === 0) {
    status = HEALTH_STATUS.OUT_ZERO_FBA
    reason = physical > 0 ? 'No fulfillable units (only reserved/researching/unfulfillable)' : 'No FBA units'
  } else if (units90 == null) {
    status = HEALTH_STATUS.DATA_INCOMPLETE
    reason = `Sales history covers ${sku.salesHistoryDays} days (<90) and Amazon gave no 90-day shipped units`
    flags.push('INSUFFICIENT_SALES_HISTORY')
  } else if (units90 === 0) {
    status = HEALTH_STATUS.ZERO_SALES
    reason = `No units sold in 90 days with ${physical} FBA units on hand`
  } else if (sku.age && sku.age.agedUnits > 0) {
    status = HEALTH_STATUS.AGED
    reason = `${sku.age.agedUnits} units aged ≥ ${t.agedMinDays} days (oldest bucket ${sku.age.oldestBucket})`
  } else if (daysOfCover != null && daysOfCover > t.excessCoverDays) {
    status = HEALTH_STATUS.EXCESS
    reason = `${Math.round(daysOfCover)} days of cover > ${t.excessCoverDays}`
  } else if (units30 != null && units30 < t.slowUnitsPer30d) {
    status = HEALTH_STATUS.SLOW
    reason = `${units30} units in 30 days < ${t.slowUnitsPer30d}`
  } else if (daysOfCover != null && (daysOfCover < t.lowCoverDays || daysOfCover > t.maxCoverDays)) {
    status = HEALTH_STATUS.WATCH
    reason = daysOfCover < t.lowCoverDays ? `${Math.round(daysOfCover)} days of cover < ${t.lowCoverDays}` : `${Math.round(daysOfCover)} days of cover > max ${t.maxCoverDays}`
  } else {
    status = HEALTH_STATUS.HEALTHY
    reason = 'Within thresholds'
  }

  let recommendedAction = RECOMMENDED_ACTION[status]
  if (flags.includes('INACTIVE_WITH_FBA_STOCK')) recommendedAction = 'Listing is not ACTIVE but holds FBA stock — fix the listing or remove the stock (Seller Central)'
  else if (status === HEALTH_STATUS.OUT_ZERO_FBA && n0(sku.unfulfillable) > 0) recommendedAction = 'Only unfulfillable units — request removal/disposal in Seller Central'

  return {
    status,
    reason,
    flags,
    recommendedAction,
    units7d: sales.units7d,
    units30d: units30,
    units90d: units90,
    sales30Source: sales.w30.source,
    sales90Source: sales.w90.source,
    velocity7d: velocity7,
    velocity30d: velocity30,
    daysOfCover,
    physicalFbaUnits: physical,
  }
}

const RELEASE_REASON = Object.freeze({
  INACTIVE_LISTING_WITH_AMAZON_STOCK: 'INACTIVE_LISTING_WITH_AMAZON_STOCK',
  UNFULFILLABLE: 'UNFULFILLABLE',
  ZERO_SALES_90D: 'ZERO_SALES_90D',
  AGED_INVENTORY: 'AGED_INVENTORY',
  EXCESS_COVER: 'EXCESS_COVER',
  VERY_LOW_VELOCITY: 'VERY_LOW_VELOCITY',
})

const RELEASE_PRIORITY: Record<string, number> = {
  INACTIVE_LISTING_WITH_AMAZON_STOCK: 0,
  UNFULFILLABLE: 1,
  ZERO_SALES_90D: 2,
  AGED_INVENTORY: 3,
  EXCESS_COVER: 4,
  VERY_LOW_VELOCITY: 5,
}

type ReleaseInput = HealthSkuInput & { volumeSource: string | null; health: ReturnType<typeof classifyHealth> }

/**
 * One row per SKU with every applicable reason. Potential removal quantity is the largest single-reason
 * quantity (never the sum, so units are not counted twice), capped at fulfillable + unfulfillable.
 * Potential capacity released = quantity × unit volume; null (VOLUME DATA MISSING) without a volume.
 */
function capacityReleaseOpportunity(sku: ReleaseInput, t: HealthThresholds) {
  const h = sku.health
  const fulfillable = n0(sku.fulfillable)
  const unfulfillable = n0(sku.unfulfillable)
  const sellableOnHand = fulfillable + n0(sku.reserved) + n0(sku.researching)
  const reasons: { reason: string; quantity: number; detail: string }[] = []
  const keepForCover = (velocity: number) => Math.ceil(velocity * t.maxCoverDays)

  if (sku.listingStatus !== LISTING_STATUS.ACTIVE && sellableOnHand + unfulfillable > 0) {
    reasons.push({
      reason: RELEASE_REASON.INACTIVE_LISTING_WITH_AMAZON_STOCK,
      quantity: fulfillable + unfulfillable,
      detail: `Listing ${sku.listingStatus || 'status not refreshed'} with ${sellableOnHand + unfulfillable} FBA units`,
    })
  }
  if (unfulfillable > 0) reasons.push({ reason: RELEASE_REASON.UNFULFILLABLE, quantity: unfulfillable, detail: `${unfulfillable} unfulfillable units` })
  if (h.units90d === 0 && fulfillable > 0) reasons.push({ reason: RELEASE_REASON.ZERO_SALES_90D, quantity: fulfillable, detail: 'No sales in 90 days' })
  if (sku.age && sku.age.agedUnits > 0 && fulfillable > 0) {
    reasons.push({ reason: RELEASE_REASON.AGED_INVENTORY, quantity: Math.min(fulfillable, sku.age.agedUnits), detail: `${sku.age.agedUnits} units aged ≥ ${t.agedMinDays} days` })
  }
  if (h.daysOfCover != null && h.daysOfCover > t.excessCoverDays && h.velocity30d) {
    const q = fulfillable - keepForCover(h.velocity30d)
    if (q > 0) reasons.push({ reason: RELEASE_REASON.EXCESS_COVER, quantity: q, detail: `${Math.round(h.daysOfCover)} days of cover; keeps ${t.maxCoverDays} days` })
  }
  if (h.units30d != null && h.units30d > 0 && h.units30d < t.veryLowUnitsPer30d && h.velocity30d) {
    const q = fulfillable - keepForCover(h.velocity30d)
    if (q > 0) reasons.push({ reason: RELEASE_REASON.VERY_LOW_VELOCITY, quantity: q, detail: `${h.units30d} units in 30 days` })
  }
  if (!reasons.length) return null
  reasons.sort((a, b) => RELEASE_PRIORITY[a.reason] - RELEASE_PRIORITY[b.reason])
  const quantity = Math.min(Math.max(...reasons.map((r) => r.quantity)), fulfillable + unfulfillable)
  const volume = sku.unitVolumeCm3 != null && sku.unitVolumeCm3 > 0 ? Number(sku.unitVolumeCm3) : null
  const amazonMeasured = sku.volumeSource === 'AMAZON_PLANNING_ITEM_VOLUME' || sku.volumeSource === 'AMAZON_FEE_PREVIEW_PACKAGE'
  const salesKnown = h.units90d != null
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW'
  if (volume != null && salesKnown && sku.listingStatus && sku.listingStatus !== LISTING_STATUS.UNKNOWN) {
    confidence = amazonMeasured && h.sales90Source === 'APP_DAILY_SALES' ? 'HIGH' : 'MEDIUM'
  }
  return {
    primaryReason: reasons[0].reason,
    reasons,
    priority: reasons[0].reason === RELEASE_REASON.INACTIVE_LISTING_WITH_AMAZON_STOCK ? 'HIGH' : reasons[0].reason === RELEASE_REASON.UNFULFILLABLE ? 'MEDIUM_HIGH' : 'MEDIUM',
    potentialRemovalQty: quantity,
    capacityPerUnitCm3: volume,
    potentialCapacityReleasedCm3: volume == null ? null : quantity * volume,
    volumeStatus: volume == null ? 'VOLUME_DATA_MISSING' : 'OK',
    confidence,
  }
}

/** Ranked: inactive-with-stock first, then by reason priority, then by potential capacity released. */
function rankReleaseOpportunities<T extends { primaryReason: string; potentialCapacityReleasedCm3: number | null; potentialRemovalQty: number }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      RELEASE_PRIORITY[a.primaryReason] - RELEASE_PRIORITY[b.primaryReason] ||
      (b.potentialCapacityReleasedCm3 ?? -1) - (a.potentialCapacityReleasedCm3 ?? -1) ||
      b.potentialRemovalQty - a.potentialRemovalQty
  )
}

module.exports = {
  HEALTH_STATUS,
  RELEASE_REASON,
  salesWindows,
  classifyHealth,
  physicalFbaUnits,
  capacityReleaseOpportunity,
  rankReleaseOpportunities,
}
