'use strict'

/**
 * Parsers for the Amazon FBA inventory reports used by capacity and inventory health.
 *
 *   GET_FBA_MYI_ALL_INVENTORY_DATA       per-SKU AFN buckets, listing-exists flags, `per-unit-volume` (cm³ in KSA)
 *   GET_FBA_INVENTORY_PLANNING_DATA      Amazon's inventory age buckets, units shipped t7–t90, `item-volume`
 *                                        (+ `volume-unit-measurement`), `storage-type`, `storage-volume`
 *   GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA  Amazon-measured package sides (longest/median/shortest)
 *
 * Blank cells stay null (never 0). Amazon's -1 "not applicable" sentinel is null too.
 */

const { normalizeSku } = require('../../utils/normalizeSku')

type Row = Record<string, string>

function pick(row: Row, keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

/** Number or null; blank, "--", "-" and non-numeric stay null. */
function num(value: unknown): number | null {
  const s = String(value ?? '').trim().replace(/,/g, '')
  if (!s || s === '-' || s === '--') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function nonNegative(value: unknown): number | null {
  const n = num(value)
  return n == null || n < 0 ? null : n
}

function int(value: unknown): number | null {
  const n = nonNegative(value)
  return n == null ? null : Math.round(n)
}

function dateOnly(value: unknown): string | null {
  const s = String(value ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  return null
}

function yesNo(value: unknown): boolean | null {
  const s = String(value ?? '').trim().toLowerCase()
  if (s === 'yes' || s === 'y' || s === 'true') return true
  if (s === 'no' || s === 'n' || s === 'false') return false
  return null
}

const CM3_PER = Object.freeze({
  'cubic centimeters': 1,
  'cubic centimeter': 1,
  cm3: 1,
  'cubic meters': 1_000_000,
  'cubic meter': 1_000_000,
  m3: 1_000_000,
  'cubic feet': 28_316.846592,
  'cubic foot': 28_316.846592,
  ft3: 28_316.846592,
  'cubic inches': 16.387064,
  'cubic inch': 16.387064,
  in3: 16.387064,
} as Record<string, number>)

/** Converts a volume in a named Amazon unit to cm³; unknown units return null (never guessed). */
function volumeToCm3(value: number | null, unit: string | null | undefined): number | null {
  if (value == null || !(value > 0)) return null
  const factor = CM3_PER[String(unit || '').trim().toLowerCase()]
  return factor ? value * factor : null
}

const CM_PER = Object.freeze({ centimeters: 1, centimeter: 1, cm: 1, millimeters: 0.1, millimeter: 0.1, mm: 0.1, inches: 2.54, inch: 2.54, in: 2.54, meters: 100, meter: 100, m: 100 } as Record<string, number>)

function sidesToCm3(sides: (number | null)[], unit: string | null | undefined): number | null {
  const factor = CM_PER[String(unit || '').trim().toLowerCase()]
  if (!factor || sides.some((s) => s == null || !((s as number) > 0))) return null
  return sides.reduce((acc: number, s) => acc * (s as number) * factor, 1)
}

function parseMyiAllRow(row: Row) {
  const sellerSku = pick(row, ['sku', 'seller-sku'])
  const normalizedSku = normalizeSku(sellerSku)
  if (!sellerSku || !normalizedSku) return null
  return {
    sellerSku,
    normalizedSku,
    fnsku: pick(row, ['fnsku']) || null,
    asin: pick(row, ['asin']) || null,
    productName: pick(row, ['product-name']) || null,
    condition: pick(row, ['condition']) || null,
    afnListingExists: yesNo(row['afn-listing-exists']),
    mfnListingExists: yesNo(row['mfn-listing-exists']),
    afnWarehouseQuantity: int(row['afn-warehouse-quantity']),
    afnFulfillableQuantity: int(row['afn-fulfillable-quantity']),
    afnUnsellableQuantity: int(row['afn-unsellable-quantity']),
    afnReservedQuantity: int(row['afn-reserved-quantity']),
    afnResearchingQuantity: int(row['afn-researching-quantity']),
    afnTotalQuantity: int(row['afn-total-quantity']),
    afnInboundWorkingQuantity: int(row['afn-inbound-working-quantity']),
    afnInboundShippedQuantity: int(row['afn-inbound-shipped-quantity']),
    afnInboundReceivingQuantity: int(row['afn-inbound-receiving-quantity']),
    /** KSA report value is cm³ (verified against the planning report's cubic-meter item volume). */
    perUnitVolumeCm3: nonNegative(row['per-unit-volume']) || null,
  }
}

const PLANNING_AGE_COLUMNS: Record<string, string> = {
  inv_age_0_to_30_days: 'inv-age-0-to-30-days',
  inv_age_31_to_60_days: 'inv-age-31-to-60-days',
  inv_age_61_to_90_days: 'inv-age-61-to-90-days',
  inv_age_0_to_90_days: 'inv-age-0-to-90-days',
  inv_age_91_to_180_days: 'inv-age-91-to-180-days',
  inv_age_181_to_270_days: 'inv-age-181-to-270-days',
  inv_age_181_to_330_days: 'inv-age-181-to-330-days',
  inv_age_271_to_365_days: 'inv-age-271-to-365-days',
  inv_age_331_to_365_days: 'inv-age-331-to-365-days',
  inv_age_365_plus_days: 'inv-age-365-plus-days',
}

function parsePlanningRow(row: Row) {
  const sellerSku = pick(row, ['sku', 'seller-sku'])
  const normalizedSku = normalizeSku(sellerSku)
  const snapshotDate = dateOnly(row['snapshot-date'])
  if (!sellerSku || !normalizedSku || !snapshotDate) return null
  const ages: Record<string, number | null> = {}
  for (const [key, col] of Object.entries(PLANNING_AGE_COLUMNS)) ages[key] = int(row[col])
  const itemVolume = nonNegative(row['item-volume'])
  const volumeUnit = pick(row, ['volume-unit-measurement']) || null
  return {
    snapshotDate,
    inventoryAgeSnapshotDate: dateOnly(row['inventory age snapshot date']),
    sellerSku,
    normalizedSku,
    fnsku: pick(row, ['fnsku']) || null,
    asin: pick(row, ['asin']) || null,
    productName: pick(row, ['product-name']) || null,
    condition: pick(row, ['condition']) || null,
    available: int(row.available),
    inventorySupplyAtFba: int(row['inventory supply at fba']),
    pendingRemovalQuantity: int(row['pending-removal-quantity']),
    ...ages,
    unitsShippedT7: int(row['units-shipped-t7']),
    unitsShippedT30: int(row['units-shipped-t30']),
    unitsShippedT60: int(row['units-shipped-t60']),
    unitsShippedT90: int(row['units-shipped-t90']),
    itemVolume: itemVolume && itemVolume > 0 ? itemVolume : null,
    volumeUnit,
    itemVolumeCm3: volumeToCm3(itemVolume, volumeUnit),
    storageType: pick(row, ['storage-type']) || null,
    storageVolume: nonNegative(row['storage-volume']),
    daysOfSupply: int(row['days-of-supply']),
    weeksOfCoverT30: nonNegative(row['weeks-of-cover-t30']),
    weeksOfCoverT90: nonNegative(row['weeks-of-cover-t90']),
    estimatedExcessQuantity: int(row['estimated-excess-quantity']),
    recommendedAction: pick(row, ['recommended-action']) || null,
    alert: pick(row, ['alert']) || null,
    sellThrough: nonNegative(row['sell-through']),
    inboundQuantity: int(row['inbound-quantity']),
    reservedQuantity: int(row['total reserved quantity']),
    unfulfillableQuantity: int(row['unfulfillable-quantity']),
    raw: row,
  }
}

function parseFeePreviewRow(row: Row) {
  const sellerSku = pick(row, ['sku', 'seller-sku'])
  const normalizedSku = normalizeSku(sellerSku)
  if (!sellerSku || !normalizedSku) return null
  const longest = nonNegative(row['longest-side'])
  const median = nonNegative(row['median-side'])
  const shortest = nonNegative(row['shortest-side'])
  const unit = pick(row, ['unit-of-dimension']) || null
  return {
    sellerSku,
    normalizedSku,
    asin: pick(row, ['asin']) || null,
    fnsku: pick(row, ['fnsku']) || null,
    longestSide: longest,
    medianSide: median,
    shortestSide: shortest,
    dimensionUnit: unit,
    packageWeight: nonNegative(row['item-package-weight']),
    weightUnit: pick(row, ['unit-of-weight']) || null,
    packageVolumeCm3: sidesToCm3([longest, median, shortest], unit),
  }
}

/**
 * Unit-volume sources, most authoritative first. Every source is Amazon's package/storage measurement;
 * product (unpackaged) dimensions are never substituted.
 */
const VOLUME_SOURCE_PRIORITY = [
  'AMAZON_PLANNING_ITEM_VOLUME',
  'AMAZON_FEE_PREVIEW_PACKAGE',
  'AMAZON_MYI_PER_UNIT_VOLUME',
  'ZOHO_PACKAGE_DETAILS',
  'MANUAL',
]

const VOLUME_SOURCE_LABEL: Record<string, string> = {
  AMAZON_PLANNING_ITEM_VOLUME: 'Amazon inventory planning report (item volume)',
  AMAZON_FEE_PREVIEW_PACKAGE: 'Amazon fee preview (measured package sides)',
  AMAZON_MYI_PER_UNIT_VOLUME: 'Amazon manage-inventory report (per-unit volume)',
  ZOHO_PACKAGE_DETAILS: 'Zoho item package details',
  MANUAL: 'Manual entry',
}

type DimensionRecord = { source: string; unitVolumeCm3: number | null; observedAt?: string | null }

/** Picks the most authoritative usable unit volume, or null when no source has one. */
function resolveUnitVolume(records: DimensionRecord[]): { unitVolumeCm3: number; source: string } | null {
  for (const source of VOLUME_SOURCE_PRIORITY) {
    const hit = records.find((r) => r.source === source && r.unitVolumeCm3 != null && r.unitVolumeCm3 > 0)
    if (hit) return { unitVolumeCm3: Number(hit.unitVolumeCm3), source }
  }
  return null
}

/** Non-overlapping Amazon age buckets, youngest → oldest, with the lower bound of each bucket. */
const AGE_BUCKETS = [
  { key: 'inv_age_0_to_30_days', label: '0–30 days', minDays: 0 },
  { key: 'inv_age_31_to_60_days', label: '31–60 days', minDays: 31 },
  { key: 'inv_age_61_to_90_days', label: '61–90 days', minDays: 61 },
  { key: 'inv_age_91_to_180_days', label: '91–180 days', minDays: 91 },
  { key: 'inv_age_181_to_270_days', label: '181–270 days', minDays: 181 },
  { key: 'inv_age_271_to_365_days', label: '271–365 days', minDays: 271 },
  { key: 'inv_age_365_plus_days', label: '365+ days', minDays: 366 },
]

/** Oldest Amazon bucket holding units, and the units at or beyond `agedMinDays`. Null when Amazon gave no age data. */
function summarizeAge(ages: Record<string, number | null | undefined>, agedMinDays: number) {
  const known = AGE_BUCKETS.filter((b) => ages[b.key] != null)
  if (!known.length) return null
  let oldest: (typeof AGE_BUCKETS)[number] | null = null
  let agedUnits = 0
  let totalUnits = 0
  for (const b of known) {
    const qty = Number(ages[b.key]) || 0
    totalUnits += qty
    if (qty > 0) oldest = b
    if (qty > 0 && b.minDays >= agedMinDays) agedUnits += qty
  }
  return {
    oldestBucket: oldest ? oldest.label : null,
    oldestMinDays: oldest ? oldest.minDays : null,
    agedUnits,
    totalUnits,
  }
}

module.exports = {
  num,
  volumeToCm3,
  sidesToCm3,
  parseMyiAllRow,
  parsePlanningRow,
  parseFeePreviewRow,
  resolveUnitVolume,
  summarizeAge,
  VOLUME_SOURCE_PRIORITY,
  VOLUME_SOURCE_LABEL,
  AGE_BUCKETS,
  PLANNING_AGE_COLUMNS,
}
