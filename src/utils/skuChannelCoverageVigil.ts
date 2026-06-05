import type { SkuCoverageRow } from '../api/skuChannelCoverage'

export interface VigilStockRow {
  itemCode: string
  normalizedItemCode?: string
  itemName?: string
  availableStock: number
  valid?: boolean
}

function normalizeSkuKey(value: unknown): string | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  return raw.replace(/\s+/g, ' ').toUpperCase()
}

function toVigilStockQty(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

export function attachVigilToCoverageRows(
  rows: SkuCoverageRow[],
  vigilRows: VigilStockRow[]
): SkuCoverageRow[] {
  const list = Array.isArray(vigilRows) ? vigilRows : []
  if (list.length === 0) {
    return rows.map((row) => ({
      ...row,
      vigilMatched: false,
      vigilSku: null,
      vigilStockQty: null,
      vigilItemName: null,
    }))
  }

  const index = new Map<
    string,
    { vigilSku: string; vigilStockQty: number | null; vigilItemName: string }
  >()
  for (const row of list) {
    const rawSku = String(row.itemCode || row.normalizedItemCode || '').trim()
    const key = normalizeSkuKey(rawSku)
    if (!key || index.has(key)) continue
    index.set(key, {
      vigilSku: rawSku,
      vigilStockQty: toVigilStockQty(row.availableStock),
      vigilItemName: String(row.itemName || '').trim(),
    })
  }

  return rows.map((row) => {
    const key =
      row.normalizedZohoKey || normalizeSkuKey(row.zohoSku) || normalizeSkuKey(row.zohoItemName)
    const vigil = key ? index.get(key) : undefined
    return {
      ...row,
      vigilMatched: Boolean(vigil),
      vigilSku: vigil?.vigilSku ?? null,
      vigilStockQty: vigil?.vigilStockQty ?? null,
      vigilItemName: vigil?.vigilItemName ?? null,
    }
  })
}

export function countVigilMatched(rows: SkuCoverageRow[]): number {
  return rows.filter((row) => row.vigilMatched).length
}
