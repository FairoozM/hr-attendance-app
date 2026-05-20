import { resolveApiUrl } from '../api/client'

export function looksLikeTemporaryS3SignedUrl(url) {
  const s = String(url || '')
  return s.includes('X-Amz-Signature=') || s.includes('X-Amz-Algorithm=')
}

/** Resolve photo URL for list/avatar UI (proxy path or legacy external URL). */
export function resolveEmployeePhotoUrl(row) {
  if (!row) return null
  if (row.photo_doc_key && row.id != null) {
    return resolveApiUrl(`/api/employees/${row.id}/photo`)
  }
  const signed = row.photo_url_signed
  if (signed) {
    return String(signed).startsWith('/api/') ? resolveApiUrl(signed) : signed
  }
  const raw = row.photo_url
  if (!raw || looksLikeTemporaryS3SignedUrl(raw)) return null
  return String(raw).startsWith('/api/') ? resolveApiUrl(raw) : raw
}
