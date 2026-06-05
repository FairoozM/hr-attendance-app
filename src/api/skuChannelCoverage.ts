import { api, postBinary, downloadBlob } from './client'
import type { VigilStockRow } from '../utils/skuChannelCoverageVigil'

export type CoverageStatus =
  | 'COMPLETE'
  | 'AMAZON_ONLY'
  | 'NOON_ONLY'
  | 'MISSING_AMAZON'
  | 'MISSING_ALL_CHANNELS'

export type CoverageFilter =
  | 'all'
  | 'missingAmazon'
  | 'missingNoon'
  | 'missingAllChannels'
  | 'complete'
  | 'amazonUaeMatched'

export interface SkuCoverageRow {
  zohoItemId: string
  zohoItemName: string
  zohoSku: string
  normalizedZohoKey: string | null
  matchKeySource?: 'sku' | 'item_name' | null
  amazonUaeMatched: boolean
  amazonMatchedAny: boolean
  noonMatched: boolean
  amazonUaeSku: string | null
  noonSku: string | null
  amazonUaeStatus: string | null
  noonStatus: string | null
  coverageStatus: CoverageStatus
  notes: string
  vigilMatched?: boolean
  vigilSku?: string | null
  vigilStockQty?: number | null
  vigilItemName?: string | null
}

export interface SkuCoverageSummary {
  totalActiveZohoItems: number
  matchedAmazonUae: number
  matchedAmazonAny: number
  matchedNoon: number
  missingAmazon: number
  missingNoon: number
  missingAllChannels: number
}

export interface SkuCoverageMeta {
  generatedAt: string
  zohoItemCount: number
  amazonUaeListingCount: number
  noonItemCount: number
  noonSource: string
  warnings: string[]
  cacheExpiresAt: string | null
  filteredCount: number
  totalCount: number
  fromCache: boolean
}

export interface SkuCoverageSummaryResponse {
  success: boolean
  summary: SkuCoverageSummary
  rows: SkuCoverageRow[]
  meta: SkuCoverageMeta
  error?: string
}

export interface SkuCoverageQuery {
  filter?: CoverageFilter
  search?: string
  refresh?: boolean
}

function buildQuery(params: SkuCoverageQuery): string {
  const qs = new URLSearchParams()
  if (params.filter && params.filter !== 'all') qs.set('filter', params.filter)
  if (params.search) qs.set('search', params.search)
  if (params.refresh) qs.set('refresh', '1')
  const s = qs.toString()
  return s ? `?${s}` : ''
}

const SKU_COVERAGE_TIMEOUT_MS = 120_000

export async function getSkuChannelCoverageSummary(
  params: SkuCoverageQuery = {}
): Promise<SkuCoverageSummaryResponse> {
  return api.get(`/api/sku-coverage/summary${buildQuery(params)}`, {
    timeoutMs: SKU_COVERAGE_TIMEOUT_MS,
  })
}

export async function refreshSkuChannelCoverage(): Promise<{
  success: boolean
  refreshedAt?: string
  summary?: SkuCoverageSummary
  meta?: SkuCoverageMeta
  error?: string
}> {
  return api.post('/api/sku-coverage/refresh', {}, { timeoutMs: SKU_COVERAGE_TIMEOUT_MS })
}

export async function exportSkuChannelCoverageXlsx(
  params: SkuCoverageQuery = {},
  vigilRows: VigilStockRow[] = []
): Promise<{ blob: Blob; filename: string }> {
  const result = await postBinary('/api/sku-coverage/export', {
    ...params,
    vigilRows,
  })
  return {
    blob: result.blob,
    filename: result.filename || 'sku-channel-coverage.xlsx',
  }
}

export function downloadSkuChannelCoverageXlsx(blob: Blob, filename: string): void {
  downloadBlob(blob, filename)
}
