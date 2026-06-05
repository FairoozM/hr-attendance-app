import { api } from './client'
import type { VigilStockRow } from '../utils/skuChannelCoverageVigil'

export type VigilZohoStockAlert =
  | 'IN_STOCK'
  | 'VIGIL_ZERO'
  | 'ZOHO_ZERO'
  | 'BOTH_ZERO'
  | 'ZOHO_NOT_FOUND'

export type VigilZohoFilter =
  | 'all'
  | 'matched'
  | 'unmatched'
  | 'vigilZero'
  | 'zohoZero'
  | 'bothZero'

export interface VigilZohoCompareRow {
  vigilSku: string
  vigilItemName: string
  vigilStockQty: number
  zohoMatched: boolean
  zohoSku: string | null
  zohoItemName: string | null
  zohoItemId: string | null
  zohoStockQty: number | null
  zohoStockStatus: string | null
  matchType: string
  matchedKey: string | null
  stockAlert: VigilZohoStockAlert
  notes: string
}

export interface VigilZohoCompareSummary {
  totalVigilRows: number
  matchedZoho: number
  unmatchedZoho: number
  vigilZero: number
  zohoZero: number
  bothZero: number
  inStock: number
}

export interface VigilZohoCompareMeta {
  generatedAt: string
  vigilRowCount: number
  zohoWarehouseName: string
  zohoWarehouseId: string
  zohoItemCount: number
  zohoFetchedAt: string
  filteredCount: number
  totalCount: number
  fromCache: boolean
}

export interface VigilZohoCompareResponse {
  success: boolean
  rows: VigilZohoCompareRow[]
  summary: VigilZohoCompareSummary
  meta: VigilZohoCompareMeta
  error?: string
}

export interface VigilZohoCompareQuery {
  filter?: VigilZohoFilter
  search?: string
  refresh?: boolean
}

const VIGIL_ZOHO_TIMEOUT_MS = 120_000

export async function compareVigilZohoStock(
  vigilRows: VigilStockRow[],
  params: VigilZohoCompareQuery = {}
): Promise<VigilZohoCompareResponse> {
  return api.post(
    '/api/sku-coverage/vigil-zoho',
    {
      vigilRows,
      filter: params.filter,
      search: params.search,
      refresh: params.refresh ? true : undefined,
    },
    { timeoutMs: VIGIL_ZOHO_TIMEOUT_MS }
  )
}
