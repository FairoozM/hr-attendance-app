import type {
  FamilyMoneyFrozenRow,
  InventoryHealthQuery,
  InventoryHealthRow,
  InventoryHealthSummary,
} from '../../../api/inventoryHealth'

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function normalizeRiskClassFilter(value: string | undefined) {
  const v = String(value || 'all').trim().toLowerCase()
  if (v === 'healthy') return 'Healthy'
  if (v === 'watch') return 'Watch'
  if (v === 'slow_moving' || v === 'slow moving') return 'Slow Moving'
  if (v === 'dead_stock' || v === 'dead stock') return 'Dead Stock'
  return 'all'
}

export function applyInventoryHealthFilters(
  rows: InventoryHealthRow[],
  filters: InventoryHealthQuery,
) {
  let out = rows

  if (!filters.includeZeroStock) {
    out = out.filter((r) => r.currentStockQty >= (filters.minStockQty ?? 1))
  } else if ((filters.minStockQty ?? 0) > 0) {
    out = out.filter((r) => r.currentStockQty >= (filters.minStockQty ?? 0))
  }

  if (filters.minInventoryValue != null && Number.isFinite(filters.minInventoryValue)) {
    out = out.filter((r) => r.inventoryValue >= filters.minInventoryValue!)
  }

  if (filters.familyType === 'slow_moving') {
    out = out.filter((r) => r.familyType === 'Slow Moving')
  } else if (filters.familyType === 'other') {
    out = out.filter((r) => r.familyType === 'Other')
  }

  const rc = normalizeRiskClassFilter(filters.riskClass)
  if (rc !== 'all') {
    out = out.filter((r) => r.riskClass === rc)
  }

  if (filters.hiddenOnly) {
    out = out.filter((r) => r.hiddenSlowMoving)
  }

  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase()
    out = out.filter(
      (r) =>
        String(r.sku || '').toLowerCase().includes(q) ||
        String(r.itemName || '').toLowerCase().includes(q) ||
        String(r.familyName || '').toLowerCase().includes(q),
    )
  }

  return out
}

export function sortInventoryHealthRows(
  rows: InventoryHealthRow[],
  sortBy: string | undefined,
  sortDirection: string | undefined,
) {
  const dir = String(sortDirection || 'desc').toLowerCase() === 'asc' ? 1 : -1
  const key = String(sortBy || 'riskScore')
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

  const getters: Record<string, (r: InventoryHealthRow) => string | number> = {
    riskScore: (r) => r.riskScore,
    inventoryValue: (r) => r.inventoryValue,
    monthsOfCover: (r) => Number(r.monthsOfCover) || 0,
    sku: (r) => r.sku,
    itemName: (r) => r.itemName,
    familyName: (r) => r.familyName,
  }
  const get = getters[key] || getters.riskScore

  return [...rows].sort((a, b) => {
    const av = get(a)
    const bv = get(b)
    if (typeof av === 'string' || typeof bv === 'string') {
      return collator.compare(String(av), String(bv)) * dir
    }
    if (av === bv) return 0
    return av > bv ? dir : -dir
  })
}

export function buildInventoryHealthSummary(
  rows: InventoryHealthRow[],
  meta: Pick<InventoryHealthSummary, 'generatedAt' | 'cacheStatus' | 'warnings'>,
): InventoryHealthSummary {
  let totalStockQty = 0
  let totalInventoryValue = 0
  let deadStockCount = 0
  let deadStockValue = 0
  let slowMovingCount = 0
  let slowMovingValue = 0
  let hiddenSlowMovingCount = 0
  let hiddenSlowMovingValue = 0
  let zeroSales180Count = 0
  let zeroSales365Count = 0
  const familyRisk = new Map<string, { familyName: string; value: number; count: number }>()

  for (const row of rows) {
    totalStockQty += row.currentStockQty || 0
    totalInventoryValue += row.inventoryValue || 0

    if (row.riskClass === 'Dead Stock') {
      deadStockCount += 1
      deadStockValue += row.inventoryValue || 0
    }
    if (row.riskClass === 'Slow Moving' || row.riskClass === 'Dead Stock') {
      slowMovingCount += 1
      slowMovingValue += row.inventoryValue || 0
    }
    if (row.hiddenSlowMoving) {
      hiddenSlowMovingCount += 1
      hiddenSlowMovingValue += row.inventoryValue || 0
    }
    if (row.currentStockQty > 0 && row.salesQty180 === 0) zeroSales180Count += 1
    if (row.currentStockQty > 0 && row.salesQty365 === 0) zeroSales365Count += 1

    const fam = row.familyName || '(No family)'
    const fr = familyRisk.get(fam) || { familyName: fam, value: 0, count: 0 }
    if (row.riskClass === 'Slow Moving' || row.riskClass === 'Dead Stock') {
      fr.value += row.inventoryValue || 0
      fr.count += 1
    }
    familyRisk.set(fam, fr)
  }

  let topRiskFamily: InventoryHealthSummary['topRiskFamily'] = null
  for (const fr of familyRisk.values()) {
    if (!topRiskFamily || fr.value > topRiskFamily.riskValue) {
      topRiskFamily = {
        familyName: fr.familyName,
        riskValue: round2(fr.value),
        riskSkuCount: fr.count,
      }
    }
  }

  return {
    totalItemsChecked: rows.length,
    totalStockQty: round2(totalStockQty),
    totalInventoryValue: round2(totalInventoryValue),
    deadStockCount,
    deadStockValue: round2(deadStockValue),
    slowMovingCount,
    slowMovingValue: round2(slowMovingValue),
    hiddenSlowMovingCount,
    hiddenSlowMovingValue: round2(hiddenSlowMovingValue),
    zeroSales180Count,
    zeroSales365Count,
    topRiskFamily,
    generatedAt: meta.generatedAt,
    cacheStatus: meta.cacheStatus,
    warnings: meta.warnings,
  }
}

export function buildFamilyMoneyFrozen(rows: InventoryHealthRow[]): FamilyMoneyFrozenRow[] {
  const byFamily = new Map<string, FamilyMoneyFrozenRow>()
  for (const row of rows) {
    const fam = row.familyName || '(No family)'
    const entry = byFamily.get(fam) || {
      familyName: fam,
      totalInventoryValue: 0,
      deadStockValue: 0,
      hiddenSlowMovingValue: 0,
      numberOfRiskSkus: 0,
    }
    entry.totalInventoryValue += row.inventoryValue || 0
    if (row.riskClass === 'Dead Stock') entry.deadStockValue += row.inventoryValue || 0
    if (row.hiddenSlowMoving) entry.hiddenSlowMovingValue += row.inventoryValue || 0
    if (row.riskClass === 'Slow Moving' || row.riskClass === 'Dead Stock') {
      entry.numberOfRiskSkus += 1
    }
    byFamily.set(fam, entry)
  }
  return [...byFamily.values()]
    .map((e) => ({
      familyName: e.familyName,
      totalInventoryValue: round2(e.totalInventoryValue),
      deadStockValue: round2(e.deadStockValue),
      hiddenSlowMovingValue: round2(e.hiddenSlowMovingValue),
      numberOfRiskSkus: e.numberOfRiskSkus,
    }))
    .sort((a, b) => b.totalInventoryValue - a.totalInventoryValue)
}

/** Full dataset fetch — filters applied client-side to avoid extra Zoho/API load. */
export const INVENTORY_HEALTH_LOAD_QUERY: InventoryHealthQuery = {
  minStockQty: 0,
  includeZeroStock: true,
  sortBy: 'riskScore',
  sortDirection: 'desc',
}

/** Safe image sync: one small batch per click; Zoho 429 pauses all sync ~15 min. */
export const INVENTORY_HEALTH_IMAGE_SYNC_BATCH = {
  limit: 20,
  concurrency: 1,
  all: false as const,
}
