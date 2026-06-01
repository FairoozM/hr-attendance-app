import { normalizeItemNo } from './allPricesVersioning'

/** Minimal sales-by-item row returned by GET /api/prices/cogs/sales-by-item. */
export interface SalesByItemRow {
  sku: string
  item_id: string
  item_name: string
  qty: number
  sales_amount: number
  unit_price: number
}

/** An All Prices row (subset) carrying the cost input. */
export interface AllPricesCostRow {
  itemNo?: string | null
  purchasePrice?: number | string | null
}

/** Latest purchase-order cost per item from GET /api/prices/cogs/purchase-costs. */
export interface PurchaseCost {
  item_id: string
  item_name: string
  sku: string
  rate: number
  date: string
}

/** Where a matched cost price came from. */
export type CostSource = 'all_prices' | 'purchase_order'

/** Fast lookups for purchase-order costs, keyed by item id and by normalized name/sku. */
export interface PurchaseCostLookup {
  byItemId: Map<string, number>
  byKey: Map<string, number>
}

/** A sales line matched to a cost price, with COGS computed. */
export interface CogsRow {
  sku: string
  itemId: string
  itemName: string
  qty: number
  unitPrice: number
  salesAmount: number
  costPrice: number
  costSource: CostSource
  cogs: number
  profit: number
  marginPct: number
}

export interface CogsTotals {
  totalQty: number
  totalRevenue: number
  totalCogs: number
  grossProfit: number
  marginPct: number
  matchedCount: number
  matchedFromAllPrices: number
  matchedFromPurchaseOrders: number
  unmatchedCount: number
  unmatchedQty: number
  unmatchedRevenue: number
}

export interface CogsResult {
  matched: CogsRow[]
  unmatched: SalesByItemRow[]
  totals: CogsTotals
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Build a lookup of normalized SKU (itemNo) -> unit purchase price.
 * Only rows with a positive, finite purchase price are included. When the same
 * itemNo appears more than once, the last valid value wins.
 */
export function buildCostLookup(rows: AllPricesCostRow[] | null | undefined): Map<string, number> {
  const lookup = new Map<string, number>()
  if (!Array.isArray(rows)) return lookup
  for (const row of rows) {
    const key = normalizeItemNo(row?.itemNo)
    if (!key) continue
    const price = toFiniteNumber(row?.purchasePrice)
    if (price == null || price <= 0) continue
    lookup.set(key, price)
  }
  return lookup
}

/**
 * Build purchase-order cost lookups: by Zoho item id (primary, most reliable)
 * and by normalized item name / sku (fallback). Only positive rates are kept.
 */
export function buildPurchaseCostLookup(costs: PurchaseCost[] | null | undefined): PurchaseCostLookup {
  const byItemId = new Map<string, number>()
  const byKey = new Map<string, number>()
  for (const c of Array.isArray(costs) ? costs : []) {
    const rate = toFiniteNumber(c?.rate)
    if (rate == null || rate <= 0) continue
    const itemId = c?.item_id != null ? String(c.item_id).trim() : ''
    if (itemId && !byItemId.has(itemId)) byItemId.set(itemId, rate)
    const nameKey = normalizeItemNo(c?.item_name)
    if (nameKey && !byKey.has(nameKey)) byKey.set(nameKey, rate)
    const skuKey = normalizeItemNo(c?.sku)
    if (skuKey && !byKey.has(skuKey)) byKey.set(skuKey, rate)
  }
  return { byItemId, byKey }
}

/**
 * Join sales-by-item rows to cost prices and compute COGS. Cost is taken from
 * All Prices first (matched by item number = the Zoho item name, since Zoho
 * `sku` is usually blank); when missing, it falls back to the latest
 * purchase-order cost (matched by Zoho item id, then by name/sku). COGS per
 * line = qty * unit cost. Rows with no cost from either source are returned
 * under `unmatched` so nothing is dropped.
 */
export function computeCogs(
  salesRows: SalesByItemRow[] | null | undefined,
  costLookup: Map<string, number>,
  purchaseCostLookup?: PurchaseCostLookup | null
): CogsResult {
  const matched: CogsRow[] = []
  const unmatched: SalesByItemRow[] = []

  let totalQty = 0
  let totalRevenue = 0
  let totalCogs = 0
  let matchedFromAllPrices = 0
  let matchedFromPurchaseOrders = 0
  let unmatchedQty = 0
  let unmatchedRevenue = 0

  for (const row of Array.isArray(salesRows) ? salesRows : []) {
    const qty = toFiniteNumber(row?.qty) ?? 0
    const salesAmount = toFiniteNumber(row?.sales_amount) ?? 0
    const unitPrice = toFiniteNumber(row?.unit_price) ?? 0
    // Zoho's `sku` is usually empty; the Zoho item name carries the code that
    // matches the All Prices `itemNo`. Match on item name first, sku as fallback.
    const normalizedKey = normalizeItemNo(row?.item_name) || normalizeItemNo(row?.sku)
    let costPrice = normalizedKey ? costLookup.get(normalizedKey) : undefined
    let costSource: CostSource = 'all_prices'

    if (costPrice == null && purchaseCostLookup) {
      const itemId = row?.item_id != null ? String(row.item_id).trim() : ''
      const poCost =
        (itemId && purchaseCostLookup.byItemId.get(itemId)) ||
        (normalizedKey ? purchaseCostLookup.byKey.get(normalizedKey) : undefined)
      if (poCost != null) {
        costPrice = poCost
        costSource = 'purchase_order'
      }
    }

    if (costPrice == null) {
      unmatched.push(row)
      unmatchedQty += qty
      unmatchedRevenue += salesAmount
      continue
    }

    const cogs = qty * costPrice
    const profit = salesAmount - cogs
    const marginPct = salesAmount > 0 ? (profit / salesAmount) * 100 : 0

    matched.push({
      sku: row.sku,
      itemId: row.item_id,
      itemName: row.item_name,
      qty,
      unitPrice,
      salesAmount,
      costPrice,
      costSource,
      cogs,
      profit,
      marginPct,
    })

    if (costSource === 'all_prices') matchedFromAllPrices += 1
    else matchedFromPurchaseOrders += 1

    totalQty += qty
    totalRevenue += salesAmount
    totalCogs += cogs
  }

  const grossProfit = totalRevenue - totalCogs
  const marginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0

  return {
    matched,
    unmatched,
    totals: {
      totalQty,
      totalRevenue,
      totalCogs,
      grossProfit,
      marginPct,
      matchedCount: matched.length,
      matchedFromAllPrices,
      matchedFromPurchaseOrders,
      unmatchedCount: unmatched.length,
      unmatchedQty,
      unmatchedRevenue,
    },
  }
}
