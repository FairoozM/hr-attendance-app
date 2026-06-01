import {
  buildPurchasePriceMap,
  expandMatchCandidates,
  findPurchaseMatchForComponent,
} from '../prices/compositeComponentPricingResolver.js'

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
 * Build All Prices lookup with the same SKU variant keys used in composite /
 * purchase planning (itemNo without color matches Zoho item names with color).
 */
export function buildCostLookup(rows: AllPricesCostRow[] | null | undefined) {
  return buildPurchasePriceMap(rows)
}

function salesRowMatchKeys(row: SalesByItemRow): string[] {
  const keys = [row?.item_name, row?.sku].filter((v) => v != null && String(v).trim() !== '')
  return keys.map((v) => String(v))
}

function findAllPricesCostForSalesRow(
  row: SalesByItemRow,
  purchaseMap: ReturnType<typeof buildPurchasePriceMap>
): number | null {
  const result = findPurchaseMatchForComponent(purchaseMap, {
    sku: row.sku,
    name: row.item_name,
    match_keys: salesRowMatchKeys(row),
  })
  if (result.status !== 'matched' || !result.match) return null
  const price = Number(result.match.purchasePrice)
  return Number.isFinite(price) && price > 0 ? price : null
}

/**
 * Build purchase-order cost lookups. Keys use the same expandMatchCandidates
 * variants as purchase planning so a colored Zoho sales name can match a PO line
 * keyed without color (and vice versa).
 */
export function buildPurchaseCostLookup(costs: PurchaseCost[] | null | undefined): PurchaseCostLookup {
  const byItemId = new Map<string, number>()
  const byKey = new Map<string, number>()
  for (const c of Array.isArray(costs) ? costs : []) {
    const rate = toFiniteNumber(c?.rate)
    if (rate == null || rate <= 0) continue
    const itemId = c?.item_id != null ? String(c.item_id).trim() : ''
    if (itemId && !byItemId.has(itemId)) byItemId.set(itemId, rate)
    for (const raw of [c?.item_name, c?.sku]) {
      if (raw == null || String(raw).trim() === '') continue
      for (const { key } of expandMatchCandidates(String(raw))) {
        if (!byKey.has(key)) byKey.set(key, rate)
      }
    }
  }
  return { byItemId, byKey }
}

function findPurchaseOrderCostForSalesRow(
  row: SalesByItemRow,
  lookup: PurchaseCostLookup
): number | null {
  const itemId = row?.item_id != null ? String(row.item_id).trim() : ''
  if (itemId) {
    const byId = lookup.byItemId.get(itemId)
    if (byId != null && byId > 0) return byId
  }
  const tried = new Set<string>()
  for (const raw of salesRowMatchKeys(row)) {
    for (const { key } of expandMatchCandidates(raw)) {
      if (tried.has(key)) continue
      tried.add(key)
      const rate = lookup.byKey.get(key)
      if (rate != null && rate > 0) return rate
    }
  }
  return null
}

/**
 * Join sales-by-item rows to cost prices and compute COGS. All Prices is matched
 * using the same color-stripping logic as purchase planning / composite pricing
 * (e.g. Zoho LIFEP17-14-BEIGE → All Prices LIFEP17-14). When missing, falls back
 * to the latest purchase-order cost. COGS per line = qty * unit cost.
 */
export function computeCogs(
  salesRows: SalesByItemRow[] | null | undefined,
  costLookup: ReturnType<typeof buildPurchasePriceMap>,
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

    let costPrice = findAllPricesCostForSalesRow(row, costLookup)
    let costSource: CostSource = 'all_prices'

    if (costPrice == null && purchaseCostLookup) {
      const poCost = findPurchaseOrderCostForSalesRow(row, purchaseCostLookup)
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
