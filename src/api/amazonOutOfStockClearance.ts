import { api, postBinary, downloadBlob } from './client'

const CLEARANCE_TIMEOUT_MS = 480_000

export type MarketplaceCode = 'UAE' | 'KSA'

/** amazonFbaZero = active listings with FBA on-hand 0; sellerCentralInactiveOos = SC Inactive→OOS report */
export type AmazonOosFilter = 'amazonFbaZero' | 'sellerCentralInactiveOos'

export interface AmazonOosRow {
  marketplaceKey: string
  marketplace: string
  amazonSku: string
  normalizedSku?: string
  title?: string
  amazonTitle?: string
  amazonCurrentQty: number
  amazonFulfillableQty?: number
  listingStatus?: string
  asin?: string
}

export interface ZohoStockRow {
  sku: string
  normalizedSku?: string
  itemName?: string
  availableQty: number
  warehouseName?: string
}

export interface VigilParsedRow {
  itemCode: string
  itemName?: string
  normalizedItemCode?: string
  availableStock: number
  valid?: boolean
}

export interface ClearanceResultRow {
  id: string
  marketplace: string
  marketplaceKey: string
  amazonSku: string
  amazonTitle: string
  amazonCurrentQty: number
  zohoSku: string
  zohoItemName: string
  zohoLifeSmileQty: number
  vigilMatchedCode: string
  vigilMatchedName: string
  vigilQty: number
  totalAvailableQty: number
  recommendedAmazonUpdateQty: number
  matchMethod: string
  status: string
  notes: string
  manuallyEdited: boolean
  zohoMatched?: boolean
  vigilMatched?: boolean
}

export interface ClearanceSummary {
  totalOutOfStock: number
  readyToUpdate: number
  noStockAvailable: number
  zohoNotMatched: number
  vigilNotMatched: number
  needsManualReview: number
  colorBaseMatchUsed: number
  totalRecommendedUnits: number
}

export interface ManualMapping {
  locked?: boolean
  zohoSku?: string
  vigilCode?: string
  vigilName?: string
  recommendedQty?: number
  zohoQty?: number
  vigilQty?: number
}

export interface VigilPreviewSummary {
  rows: number
  validRows: number
  invalidRows: number
  itemCodeHeader: string | null
  stockHeader: string | null
  itemNameHeader?: string | null
}

export interface VigilPreviewResponse {
  success: boolean
  preview: {
    headers: string[]
    rows: Array<{
      rowNumber: number
      itemCode: string
      itemName?: string
      availableStock: number
      valid: boolean
      errors: string[]
    }>
    summary: VigilPreviewSummary
    needsColumnMapping?: boolean
    availableHeaders?: string[]
  }
  needsColumnMapping?: boolean
  message?: string
}

const longOpts = { timeoutMs: CLEARANCE_TIMEOUT_MS }

export interface OutOfStockFetchJob {
  success?: boolean
  jobId: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress?: { step: string; current: number; total: number }
  error?: string
  rows?: AmazonOosRow[]
  zohoRowsFromCache?: ZohoStockRow[]
  fetchedAt?: string
  warnings?: string[]
  source?: 'cache' | 'live'
  message?: string
}

/** Fast: reads PostgreSQL cache from Amazon + Zoho Stock refresh (seconds). */
export async function fetchAmazonOutOfStockFromCache(
  marketplace: MarketplaceCode,
  oosFilter: AmazonOosFilter = 'sellerCentralInactiveOos'
) {
  const qs = new URLSearchParams({
    marketplace,
    oosFilter,
  })
  return api.get(
    `/api/amazon/out-of-stock-clearance/out-of-stock?${qs.toString()}`
  ) as Promise<OutOfStockFetchJob & { outOfStockCount?: number; oosFilter?: AmazonOosFilter }>
}

export type AmazonOosFetchMode = 'fast' | 'fba' | 'listings-report'

/** Starts background SP-API job; poll with getAmazonOutOfStockFetchStatus. */
export async function startAmazonOutOfStockFetch(
  marketplace: MarketplaceCode,
  mode: AmazonOosFetchMode = 'fast'
) {
  return api.post('/api/amazon/out-of-stock-clearance/out-of-stock/fetch', { marketplace, mode }) as Promise<
    OutOfStockFetchJob
  >
}

export async function getAmazonOutOfStockFetchStatus(jobId: string) {
  return api.get(
    `/api/amazon/out-of-stock-clearance/out-of-stock/fetch/${encodeURIComponent(jobId)}`
  ) as Promise<OutOfStockFetchJob>
}

export async function fetchZohoStockForClearance(marketplace: MarketplaceCode, skus: string[]) {
  return api.post('/api/amazon/out-of-stock-clearance/zoho-stock', { marketplace, skus }, longOpts)
}

export async function previewVigilStockFile(
  file: File,
  columnMapping?: { itemCodeHeader?: string; stockHeader?: string; itemNameHeader?: string }
): Promise<VigilPreviewResponse> {
  const form = new FormData()
  form.append('file', file)
  if (columnMapping) {
    form.append('columnMapping', JSON.stringify(columnMapping))
  }
  return api.postForm('/api/amazon/out-of-stock-clearance/vigil-preview', form, longOpts)
}

export async function calculateClearance(body: {
  marketplace: MarketplaceCode
  amazonRows: AmazonOosRow[]
  zohoRows: ZohoStockRow[]
  vigilRows: VigilParsedRow[]
  manualMappings?: Record<string, ManualMapping>
  maxRecommendedQty?: number | null
  respectManualOverrides?: boolean
  confirmOverwriteManual?: boolean
}) {
  return api.post('/api/amazon/out-of-stock-clearance/calculate', body, longOpts)
}

export async function exportClearanceRows(body: {
  rows: ClearanceResultRow[]
  exportKind: 'full' | 'ready' | 'manualReview' | 'updateResults'
}) {
  const { blob, filename } = await postBinary('/api/amazon/out-of-stock-clearance/export', body)
  downloadBlob(blob, filename || `amazon-oos-clearance-${body.exportKind}.xlsx`)
}

export async function updateAmazonInventoryStub(body: unknown) {
  return api.post('/api/amazon/out-of-stock-clearance/update-amazon', body, longOpts)
}
