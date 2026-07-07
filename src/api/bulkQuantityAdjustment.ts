import { api, downloadBlob, fetchBinary } from './client'

export type BulkQtyAdjustmentSummary = {
  total_rows: number
  valid_rows: number
  unmatched_skus: number
  duplicate_skus: number
  invalid_quantities: number
  missing_warehouse: number
  missing_field: number
  error_rows: number
  ready_to_post: number
  posted_successfully: number
  failed: number
  pending_valuation: number
}

export type BulkQtyAdjustmentRow = {
  id: number
  batch_id: number
  row_number: number
  sku: string
  item_name: string
  zoho_item_id: string
  warehouse_id: string
  warehouse_name: string
  current_stock: number | null
  adjustment_qty: number
  expected_stock_after: number | null
  reason: string
  description: string
  reference_number: string
  remarks: string
  validation_status: string
  posting_status: string
  valuation_status: string
  error_message: string
  zoho_inventory_adjustment_id: string
}

export type BulkQtyAdjustmentBatch = {
  id: number
  batch_reference: string
  uploaded_file_name: string
  status: string
  total_rows: number
  valid_rows: number
  error_rows: number
  posted_rows: number
  failed_rows: number
  zoho_adjustment_ids: string[]
  notes: string
  created_at: string
  updated_at: string
}

export type UploadResponse = {
  batch_id: number
  batch_reference: string
  batch: BulkQtyAdjustmentBatch
  rows: BulkQtyAdjustmentRow[]
  parse_meta?: { truncated?: boolean }
}

export type BatchDetailResponse = {
  batch: BulkQtyAdjustmentBatch
  rows: BulkQtyAdjustmentRow[]
  summary: BulkQtyAdjustmentSummary
}

function safeError(err: unknown) {
  return err instanceof Error ? err.message : 'Request failed'
}

export async function downloadTemplate() {
  const { blob, filename } = await fetchBinary('/api/zoho/bulk-quantity-adjustments/template')
  downloadBlob(blob, filename || 'bulk_quantity_adjustment_template.csv')
}

export async function uploadBulkAdjustmentFile(file: File): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  return api.postForm('/api/zoho/bulk-quantity-adjustments/upload', form, {
    timeoutMs: 120_000,
  }) as Promise<UploadResponse>
}

export async function validateBulkAdjustmentBatch(batchId: number): Promise<BatchDetailResponse> {
  return api.post('/api/zoho/bulk-quantity-adjustments/validate', { batch_id: batchId }, {
    timeoutMs: 300_000,
  }) as Promise<BatchDetailResponse>
}

export async function postBulkAdjustmentBatch(
  batchId: number,
  opts?: { date?: string },
): Promise<BatchDetailResponse & { zoho_adjustment_ids?: string[] }> {
  return api.post('/api/zoho/bulk-quantity-adjustments/post', {
    batch_id: batchId,
    confirmed: true,
    date: opts?.date,
  }, {
    timeoutMs: 300_000,
  }) as Promise<BatchDetailResponse & { zoho_adjustment_ids?: string[] }>
}

export async function getBulkAdjustmentBatch(batchId: number): Promise<BatchDetailResponse> {
  return api.get(`/api/zoho/bulk-quantity-adjustments/${batchId}`, {
    timeoutMs: 120_000,
  }) as Promise<BatchDetailResponse>
}

export async function refreshBulkAdjustmentValuation(batchId: number): Promise<BatchDetailResponse> {
  return api.post(`/api/zoho/bulk-quantity-adjustments/${batchId}/refresh-valuation`, {}, {
    timeoutMs: 120_000,
  }) as Promise<BatchDetailResponse>
}

export async function downloadBulkAdjustmentErrors(batchId: number, fileName: string) {
  const { blob, filename } = await fetchBinary(`/api/zoho/bulk-quantity-adjustments/${batchId}/export-errors`)
  downloadBlob(blob, filename || fileName)
}

export async function downloadBulkAdjustmentResults(batchId: number, fileName: string) {
  const { blob, filename } = await fetchBinary(`/api/zoho/bulk-quantity-adjustments/${batchId}/export-results`)
  downloadBlob(blob, filename || fileName)
}

export { safeError }
