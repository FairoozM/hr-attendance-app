import { api, postBinary, downloadBlob } from './client'

const CLEARANCE_TIMEOUT_MS = 480_000

export type MarketplaceCode = 'UAE' | 'KSA'

export interface AmazonOosRow {
  marketplaceKey: string
  marketplace: string
  amazonSku: string
  normalizedSku?: string
  title?: string
  amazonTitle?: string
  amazonCurrentQty: number
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

const opts = { timeoutMs: CLEARANCE_TIMEOUT_MS }

export async function fetchAmazonOutOfStock(marketplace: MarketplaceCode) {
  return api.get(
    `/api/amazon/out-of-stock-clearance/out-of-stock?marketplace=${encodeURIComponent(marketplace)}`,
    opts
  )
}

export async function fetchZohoStockForClearance(marketplace: MarketplaceCode, skus: string[]) {
  return api.post('/api/amazon/out-of-stock-clearance/zoho-stock', { marketplace, skus }, opts)
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
  return api.postForm('/api/amazon/out-of-stock-clearance/vigil-preview', form, opts)
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
  return api.post('/api/amazon/out-of-stock-clearance/calculate', body, opts)
}

export async function exportClearanceRows(body: {
  rows: ClearanceResultRow[]
  exportKind: 'full' | 'ready' | 'manualReview' | 'updateResults'
}) {
  const { blob, filename } = await postBinary('/api/amazon/out-of-stock-clearance/export', body)
  downloadBlob(blob, filename || `amazon-oos-clearance-${body.exportKind}.xlsx`)
}

export async function updateAmazonInventoryStub(body: unknown) {
  return api.post('/api/amazon/out-of-stock-clearance/update-amazon', body, opts)
}
