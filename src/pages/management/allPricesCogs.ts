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

/** A sales line matched to an All Prices cost price, with COGS computed. */
export interface CogsRow {
  sku: string
  itemId: string
  itemName: string
  qty: number
  unitPrice: number
  salesAmount: number
  costPrice: number
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
 * Join sales-by-item rows to All Prices cost prices by SKU and compute COGS.
 * COGS per line = qty * purchasePrice. Rows whose SKU has no matching cost
 * price are returned under `unmatched` so nothing is silently dropped.
 */
export function computeCogs(
  salesRows: SalesByItemRow[] | null | undefined,
  costLookup: Map<string, number>
): CogsResult {
  const matched: CogsRow[] = []
  const unmatched: SalesByItemRow[] = []

  let totalQty = 0
  let totalRevenue = 0
  let totalCogs = 0
  let unmatchedQty = 0
  let unmatchedRevenue = 0

  for (const row of Array.isArray(salesRows) ? salesRows : []) {
    const qty = toFiniteNumber(row?.qty) ?? 0
    const salesAmount = toFiniteNumber(row?.sales_amount) ?? 0
    const unitPrice = toFiniteNumber(row?.unit_price) ?? 0
    const normalizedSku = normalizeItemNo(row?.sku)
    const costPrice = normalizedSku ? costLookup.get(normalizedSku) : undefined

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
      cogs,
      profit,
      marginPct,
    })

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
      unmatchedCount: unmatched.length,
      unmatchedQty,
      unmatchedRevenue,
    },
  }
}
