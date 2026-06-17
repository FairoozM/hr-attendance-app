import { api, postBinary } from './client'

export async function uploadListingBatch(file, batchName = '') {
  const form = new FormData()
  form.append('file', file)
  if (batchName) form.append('batch_name', batchName)
  return api.postForm('/api/listings/batches/upload', form)
}

export function listListingBatches() {
  return api.get('/api/listings/batches')
}

export function getListingBatch(batchId, params = {}) {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') qs.set(key, value)
  }
  return api.get(`/api/listings/batches/${batchId}${qs.toString() ? `?${qs}` : ''}`)
}

export function getDefaultProfiles() {
  return api.get('/api/listings/default-profiles')
}

export function createDefaultProfile(body) {
  return api.post('/api/listings/default-profiles', body)
}

export function updateDefaultProfile(id, body) {
  return api.patch(`/api/listings/default-profiles/${id}`, body)
}

export function applyBatchDefaults(batchId, body) {
  return api.post(`/api/listings/batches/${batchId}/apply-defaults`, body)
}

export function validateListingBatch(batchId) {
  return api.post(`/api/listings/batches/${batchId}/validate`, {})
}

export function startBatchGeneration(batchId, body) {
  return api.post(`/api/listings/batches/${batchId}/generate`, body)
}

export function getBatchGenerationStatus(batchId) {
  return api.get(`/api/listings/batches/${batchId}/generate/status`)
}

export function cancelBatchGeneration(batchId) {
  return api.post(`/api/listings/batches/${batchId}/generate/cancel`, {})
}

export function generateListingRow(batchId, rowId, body = {}) {
  return api.post(`/api/listings/batches/${batchId}/rows/${rowId}/generate`, body)
}

export function updateListingRow(batchId, rowId, body) {
  return api.patch(`/api/listings/batches/${batchId}/rows/${rowId}`, body)
}

export function listingBatchBulkAction(batchId, body) {
  return api.post(`/api/listings/batches/${batchId}/rows/bulk-action`, body)
}

export function exportListingBatch(batchId, body = {}) {
  return postBinary(`/api/listings/batches/${batchId}/export`, body)
}
