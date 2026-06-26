import { api } from './client'

const PREFIX = '/api/amazon/ksa-rto-labeling'

export type KsaRtoRowStatus =
  | 'Ready'
  | 'Missing Product Code'
  | 'Missing FNSKU'
  | 'Missing Image'
  | 'Missing PDF'
  | 'Invalid Qty'
export type KsaRtoFileType = 'batch_header' | 'header_image' | 'fnsku_pdf' | 'product_image' | 'fnsku_label_pdf'

export interface KsaRtoLabelRow {
  id?: number | string
  batchId?: number
  productCode: string
  fnskuNo: string
  quantity: number
  notes?: string
  status?: KsaRtoRowStatus
  productImage?: KsaRtoLabelFile | null
  labelPdf?: KsaRtoLabelFile | null
  files?: KsaRtoLabelFile[]
  createdAt?: string
  updatedAt?: string
}

export interface KsaRtoLabelFile {
  id: number
  batchId: number
  rowId?: number | null
  fileType: KsaRtoFileType
  fileName: string
  fileUrl: string
  downloadUrl: string
  fileSize: number
  mimeType: string
  uploadedBy?: number | null
  createdAt: string
  status: string
}

export interface KsaRtoLabelBatch {
  id: number
  batchTitle: string
  referenceNo: string
  agentName: string
  destination: string
  notes: string
  headerImageUrl: string
  createdBy?: number | null
  createdAt: string
  updatedAt: string
  totalLines: number
  totalQuantity: number
  missingFnskuCount: number
  missingImageCount: number
  missingPdfCount: number
  pdfFileCount: number
  rows?: KsaRtoLabelRow[]
  files?: KsaRtoLabelFile[]
}

export interface KsaRtoBatchPayload {
  batchTitle: string
  referenceNo: string
  agentName: string
  destination: string
  notes: string
  headerImageUrl?: string
  rows: KsaRtoLabelRow[]
}

export async function listKsaRtoLabelBatches(params: { search?: string; from?: string; to?: string } = {}) {
  const q = new URLSearchParams()
  if (params.search) q.set('search', params.search)
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  return api.get(`${PREFIX}/batches${q.toString() ? `?${q}` : ''}`) as Promise<{ batches: KsaRtoLabelBatch[] }>
}

export async function getKsaRtoLabelBatch(id: number | string) {
  return api.get(`${PREFIX}/batches/${id}`) as Promise<{ batch: KsaRtoLabelBatch }>
}

export async function createKsaRtoLabelBatch(payload: KsaRtoBatchPayload) {
  return api.post(`${PREFIX}/batches`, payload) as Promise<{ batch: KsaRtoLabelBatch }>
}

export async function updateKsaRtoLabelBatch(id: number | string, payload: KsaRtoBatchPayload) {
  return api.put(`${PREFIX}/batches/${id}`, payload) as Promise<{ batch: KsaRtoLabelBatch }>
}

export async function deleteKsaRtoLabelBatch(id: number | string) {
  return api.delete(`${PREFIX}/batches/${id}`) as Promise<{ success: boolean }>
}

export async function uploadKsaRtoLabelFile(id: number | string, fileType: KsaRtoFileType, file: File) {
  const form = new FormData()
  form.set('file_type', fileType)
  form.set('file', file)
  return api.postForm(`${PREFIX}/batches/${id}/files`, form, { timeoutMs: 120_000 }) as Promise<{ file: KsaRtoLabelFile }>
}

export async function uploadKsaRtoLabelRowFile(
  batchId: number | string,
  rowId: number | string,
  fileType: 'product_image' | 'fnsku_label_pdf',
  file: File
) {
  const form = new FormData()
  form.set('file_type', fileType)
  form.set('file', file)
  return api.postForm(`${PREFIX}/batches/${batchId}/rows/${rowId}/files`, form, {
    timeoutMs: 120_000,
  }) as Promise<{ file: KsaRtoLabelFile; row: KsaRtoLabelRow }>
}

export async function deleteKsaRtoLabelFile(fileId: number | string) {
  return api.delete(`${PREFIX}/files/${fileId}`) as Promise<{ success: boolean }>
}

export async function deleteKsaRtoLabelRowFile(fileId: number | string) {
  return api.delete(`${PREFIX}/row-files/${fileId}`) as Promise<{ success: boolean; row: KsaRtoLabelRow | null }>
}

export async function parseKsaRtoLabelFile(file: File) {
  const form = new FormData()
  form.set('file', file)
  return api.postForm(`${PREFIX}/parse`, form, { timeoutMs: 120_000 }) as Promise<{ rows: KsaRtoLabelRow[] }>
}
