import { api, fetchBinary, downloadBlob } from './client'

export type MarketplaceCode = 'KSA' | 'UAE'

export interface AmazonReturnBatch {
  id: number
  title: string
  marketplace: MarketplaceCode
  agentName: string
  shippingTo: string
  publicToken: string
  sourceFileName: string
  status: string
  totalSkus: number
  totalQtyReceived: number
  oldStockQuantity: number
  createdAt: string
  updatedAt: string
}

export interface AmazonReturnLabel {
  id: number
  fileName: string
  fileMimeType: string
  uploadedAt: string
  replacedAt?: string | null
  status: 'Uploaded' | 'Replaced'
}

export interface ReturnedStockRow {
  id: number
  batchId: number
  workingSku: string
  originalSku: string
  alternativeSku: string
  removalOrderId: string
  qtyReceived: number | null
  receivingDate: string | null
  sectionType: 'RETURN_RECEIVED'
}

export interface OldStockRow {
  id: number
  batchId: number
  workingSku: string
  originalSku: string
  qtyReceived: number | null
  adminNotes: string
  sectionType: 'OLD_STOCK'
}

export interface IgnoredRow {
  id: number
  workingSku: string
  originalSku: string
  alternativeSku: string
  removalOrderId: string
  sectionType: 'IGNORED'
}

export interface CombinedStockRow {
  id: number
  batchId: number
  workingSku: string
  returnedQty: number
  oldStockQty: number
  totalAvailableQty: number
  labelDownloaded: boolean
  labelPrinted: boolean
  relabeled: boolean
  packed: boolean
  readyForShipment: boolean
  notes: string
  agentNotes: string
  label: AmazonReturnLabel | null
  labelStatus: 'Not Uploaded' | 'Uploaded' | 'Replaced'
}

export interface WorkflowSummary {
  totalReturnedSkus: number
  totalReturnedQty: number
  totalOldStockSkus: number
  totalOldStockQty: number
  totalAvailableSkus: number
  totalAvailableQty: number
  ignoredRowCount: number
  availableStockTotal: number
}

export interface AmazonReturnDetail {
  success?: boolean
  batch: AmazonReturnBatch
  summary: WorkflowSummary
  returnedStock: ReturnedStockRow[]
  oldStockItems: OldStockRow[]
  ignoredRows: IgnoredRow[]
  combinedStock: CombinedStockRow[]
  publicUrlPath: string
}

export interface AgentCombinedStockRow {
  id: number
  workingSku: string
  totalAvailableQty: number
  labelDownloaded: boolean
  labelPrinted: boolean
  relabeled: boolean
  packed: boolean
  readyForShipment: boolean
  agentNotes: string
  label: { id: number; fileName: string; status: string } | null
  labelStatus: 'Not Uploaded' | 'Uploaded' | 'Replaced'
}

export interface AgentReportDetail {
  success?: boolean
  batch: {
    title: string
    marketplace: MarketplaceCode
    agentName: string
  }
  summary: {
    totalAvailableSkus: number
    totalAvailableQty: number
  }
  combinedStock: AgentCombinedStockRow[]
}

export type ProcessingStatusPatch = Partial<
  Pick<CombinedStockRow, 'labelDownloaded' | 'labelPrinted' | 'relabeled' | 'packed' | 'readyForShipment' | 'notes' | 'agentNotes'>
>

export async function uploadAmazonReturnBatch(input: {
  file: File
  title: string
  marketplace: MarketplaceCode
  agentName: string
  shippingTo: string
}): Promise<AmazonReturnDetail> {
  const form = new FormData()
  form.append('file', input.file)
  form.append('title', input.title)
  form.append('marketplace', input.marketplace)
  form.append('agentName', input.agentName)
  form.append('shippingTo', input.shippingTo)
  return api.postForm('/api/amazon-return-reconciliation/upload', form, { timeoutMs: 120_000 })
}

export async function listAmazonReturnBatches(): Promise<{ success: boolean; batches: AmazonReturnBatch[] }> {
  return api.get('/api/amazon-return-reconciliation/batches')
}

export async function getAmazonReturnBatch(batchId: number | string): Promise<AmazonReturnDetail> {
  return api.get(`/api/amazon-return-reconciliation/batches/${encodeURIComponent(String(batchId))}`)
}

export async function updateCombinedStockRow(
  combinedSkuId: number | string,
  patch: ProcessingStatusPatch
): Promise<AmazonReturnDetail> {
  return api.patch(`/api/amazon-return-reconciliation/combined-skus/${encodeURIComponent(String(combinedSkuId))}`, patch)
}

export async function uploadCombinedStockLabel(combinedSkuId: number | string, file: File): Promise<AmazonReturnDetail> {
  const form = new FormData()
  form.append('file', file)
  return api.postForm(
    `/api/amazon-return-reconciliation/combined-skus/${encodeURIComponent(String(combinedSkuId))}/label`,
    form,
    { timeoutMs: 120_000 }
  )
}

export async function deleteAmazonReturnLabel(labelId: number | string): Promise<AmazonReturnDetail> {
  return api.delete(`/api/amazon-return-reconciliation/labels/${encodeURIComponent(String(labelId))}`)
}

export async function regenerateAmazonReturnLink(batchId: number | string): Promise<AmazonReturnDetail> {
  return api.post(`/api/amazon-return-reconciliation/batches/${encodeURIComponent(String(batchId))}/regenerate-link`, {})
}

export async function downloadAmazonReturnBatch(batchId: number | string) {
  const { blob, filename } = await fetchBinary(
    `/api/amazon-return-reconciliation/batches/${encodeURIComponent(String(batchId))}/export`
  )
  downloadBlob(blob, filename || `stock-relabeling-${batchId}.xlsx`)
}

export async function getPublicAmazonReturnReport(publicToken: string): Promise<AgentReportDetail> {
  return api.get(`/api/public/amazon-return-reconciliation/${encodeURIComponent(publicToken)}`)
}

export async function updatePublicCombinedStockRow(
  publicToken: string,
  combinedSkuId: number | string,
  patch: ProcessingStatusPatch
): Promise<AgentReportDetail> {
  return api.patch(
    `/api/public/amazon-return-reconciliation/${encodeURIComponent(publicToken)}/combined-skus/${encodeURIComponent(String(combinedSkuId))}/processing`,
    patch
  )
}

export async function downloadPublicAmazonReturnReport(publicToken: string) {
  const { blob, filename } = await fetchBinary(
    `/api/public/amazon-return-reconciliation/${encodeURIComponent(publicToken)}/export`
  )
  downloadBlob(blob, filename || 'stock-relabeling-report.xlsx')
}

export function publicAmazonReturnLabelUrl(publicToken: string, labelId: number | string) {
  return `/api/public/amazon-return-reconciliation/${encodeURIComponent(publicToken)}/labels/${encodeURIComponent(String(labelId))}/download`
}
