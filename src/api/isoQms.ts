import { api, fetchBinary } from './client'
import type {
  IsoActivityLogEntry,
  IsoAudit,
  IsoAuditorAssignment,
  IsoAuditorRoomResponse,
  IsoCalibration,
  IsoCategory,
  IsoClause,
  IsoConfirmUploadPayload,
  IsoCorrectiveAction,
  IsoDashboardStats,
  IsoDocument,
  IsoDocumentFilters,
  IsoDocumentListResponse,
  IsoDocumentVersion,
  IsoEquipment,
  IsoExternalCertificate,
  IsoFinding,
  IsoMaintenanceLog,
  IsoManagementReview,
  IsoMasterDocumentRow,
  IsoMasterRecordRow,
  IsoPresignRequest,
  IsoPresignResponse,
  IsoQualityObjective,
  IsoRisk,
  IsoSearchResponse,
  IsoSettings,
  IsoSupplier,
} from '../pages/isoQms/types'

const BASE = '/api/iso-qms'

function toQuery(params?: Record<string, unknown> | IsoDocumentFilters): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    sp.set(key, String(value))
  }
  const q = sp.toString()
  return q ? `?${q}` : ''
}

function asList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.items)) return obj.items as T[]
    if (Array.isArray(obj.data)) return obj.data as T[]
    if (Array.isArray(obj.rows)) return obj.rows as T[]
  }
  return []
}

function asPagedDocuments(data: unknown): IsoDocumentListResponse {
  if (Array.isArray(data)) return { items: data as IsoDocument[], total: data.length }
  if (data && typeof data === 'object') {
    const obj = data as IsoDocumentListResponse & { documents?: IsoDocument[] }
    const items = obj.items || obj.documents || []
    return {
      items: Array.isArray(items) ? items : [],
      total: typeof obj.total === 'number' ? obj.total : items.length,
      page: obj.page,
      pageSize: obj.pageSize,
    }
  }
  return { items: [], total: 0 }
}

/* ── Dashboard ── */
export async function fetchIsoDashboard(): Promise<IsoDashboardStats> {
  const data = await api.get(`${BASE}/dashboard`)
  return (data || {}) as IsoDashboardStats
}

/* ── Documents ── */
export async function fetchIsoDocuments(
  filters?: IsoDocumentFilters
): Promise<IsoDocumentListResponse> {
  const data = await api.get(`${BASE}/documents${toQuery(filters as Record<string, unknown>)}`)
  return asPagedDocuments(data)
}

export async function fetchIsoDocument(id: number | string): Promise<IsoDocument> {
  return (await api.get(`${BASE}/documents/${id}`)) as IsoDocument
}

export async function createIsoDocument(payload: Record<string, unknown>): Promise<IsoDocument> {
  return (await api.post(`${BASE}/documents`, payload)) as IsoDocument
}

export async function updateIsoDocument(
  id: number | string,
  payload: Record<string, unknown>
): Promise<IsoDocument> {
  return (await api.patch(`${BASE}/documents/${id}`, payload)) as IsoDocument
}

export async function submitIsoDocumentReview(id: number | string): Promise<IsoDocument> {
  return (await api.post(`${BASE}/documents/${id}/submit-review`, {})) as IsoDocument
}

export async function approveIsoDocument(
  id: number | string,
  payload: Record<string, unknown> = {}
): Promise<IsoDocument> {
  return (await api.post(`${BASE}/documents/${id}/approve`, payload)) as IsoDocument
}

export async function rejectIsoDocument(
  id: number | string,
  payload: { comments?: string }
): Promise<IsoDocument> {
  return (await api.post(`${BASE}/documents/${id}/reject`, payload)) as IsoDocument
}

export async function uploadIsoRevision(
  id: number | string,
  payload: IsoConfirmUploadPayload
): Promise<IsoDocument> {
  return (await api.post(`${BASE}/documents/${id}/revisions`, payload)) as IsoDocument
}

export async function markIsoDocumentObsolete(
  id: number | string,
  payload: { reason?: string } = {}
): Promise<IsoDocument> {
  return (await api.post(`${BASE}/documents/${id}/obsolete`, payload)) as IsoDocument
}

export async function archiveIsoDocument(id: number | string): Promise<IsoDocument> {
  return (await api.post(`${BASE}/documents/${id}/archive`, {})) as IsoDocument
}

export async function setIsoDocumentAuditorPublish(
  id: number | string,
  payload: { publishToAuditorRoom: boolean; auditorDownloadAllowed?: boolean }
): Promise<IsoDocument> {
  return (await api.post(`${BASE}/documents/${id}/publish-auditor`, payload)) as IsoDocument
}

export async function fetchIsoDocumentVersions(
  id: number | string
): Promise<IsoDocumentVersion[]> {
  const data = await api.get(`${BASE}/documents/${id}/versions`)
  return asList<IsoDocumentVersion>(data)
}

export async function fetchIsoVersionDownloadUrl(
  versionId: number | string
): Promise<{ url: string; filename?: string }> {
  return (await api.get(`${BASE}/versions/${versionId}/download-url`)) as {
    url: string
    filename?: string
  }
}

export async function fetchIsoVersionPreviewUrl(
  versionId: number | string
): Promise<{ url: string; contentType?: string; extractedText?: string; sheets?: unknown }> {
  return (await api.get(`${BASE}/versions/${versionId}/preview-url`)) as {
    url: string
    contentType?: string
    extractedText?: string
    sheets?: unknown
  }
}

export async function retryIsoExtraction(versionId: number | string): Promise<unknown> {
  return api.post(`${BASE}/versions/${versionId}/retry-extraction`, {})
}

/* ── Uploads ── */
export async function presignIsoUpload(payload: IsoPresignRequest): Promise<IsoPresignResponse> {
  return (await api.post(`${BASE}/uploads/presign`, payload)) as IsoPresignResponse
}

export async function confirmIsoUpload(payload: IsoConfirmUploadPayload): Promise<IsoDocument> {
  return (await api.post(`${BASE}/uploads/confirm`, payload)) as IsoDocument
}

export async function confirmIsoBulkUpload(
  items: IsoConfirmUploadPayload[]
): Promise<{ items: IsoDocument[]; errors?: { index: number; error: string }[] }> {
  return (await api.post(`${BASE}/uploads/bulk-confirm`, { items })) as {
    items: IsoDocument[]
    errors?: { index: number; error: string }[]
  }
}

export async function putFileToPresignedUrl(
  uploadUrl: string,
  file: File,
  headers?: Record<string, string>
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      ...(headers || {}),
    },
    body: file,
  })
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`)
  }
}

/* ── Search ── */
export async function searchIsoQms(
  params: Record<string, unknown>
): Promise<IsoSearchResponse> {
  const data = await api.get(`${BASE}/search${toQuery(params)}`)
  if (Array.isArray(data)) return { items: data, total: data.length }
  const obj = (data || {}) as IsoSearchResponse
  return {
    items: Array.isArray(obj.items) ? obj.items : [],
    total: typeof obj.total === 'number' ? obj.total : 0,
    page: obj.page,
    pageSize: obj.pageSize,
  }
}

/* ── Master lists ── */
export async function fetchMasterDocuments(
  filters?: Record<string, unknown>
): Promise<IsoMasterDocumentRow[]> {
  const data = await api.get(`${BASE}/master-documents${toQuery(filters)}`)
  return asList<IsoMasterDocumentRow>(data)
}

export async function fetchMasterRecords(
  filters?: Record<string, unknown>
): Promise<IsoMasterRecordRow[]> {
  const data = await api.get(`${BASE}/master-records${toQuery(filters)}`)
  return asList<IsoMasterRecordRow>(data)
}

export async function exportMasterDocuments(filters?: Record<string, unknown>) {
  return fetchBinary(`${BASE}/master-documents/export${toQuery(filters)}`)
}

export async function exportMasterRecords(filters?: Record<string, unknown>) {
  return fetchBinary(`${BASE}/master-records/export${toQuery(filters)}`)
}

/* ── Clauses ── */
export async function fetchIsoClauses(): Promise<IsoClause[]> {
  const data = await api.get(`${BASE}/clauses`)
  return asList<IsoClause>(data)
}

export async function fetchIsoClauseEvidence(id: number | string): Promise<IsoDocument[]> {
  const data = await api.get(`${BASE}/clauses/${id}/evidence`)
  return asList<IsoDocument>(data)
}

export async function fetchIsoCategories(): Promise<IsoCategory[]> {
  const data = await api.get(`${BASE}/categories`)
  return asList<IsoCategory>(data)
}

/* ── Audits ── */
export async function fetchIsoAudits(filters?: Record<string, unknown>): Promise<IsoAudit[]> {
  const data = await api.get(`${BASE}/audits${toQuery(filters)}`)
  return asList<IsoAudit>(data)
}

export async function fetchIsoAudit(id: number | string): Promise<IsoAudit> {
  return (await api.get(`${BASE}/audits/${id}`)) as IsoAudit
}

export async function createIsoAudit(payload: Record<string, unknown>): Promise<IsoAudit> {
  return (await api.post(`${BASE}/audits`, payload)) as IsoAudit
}

export async function updateIsoAudit(
  id: number | string,
  payload: Record<string, unknown>
): Promise<IsoAudit> {
  return (await api.patch(`${BASE}/audits/${id}`, payload)) as IsoAudit
}

export async function updateIsoChecklistItem(
  auditId: number | string,
  itemId: number | string,
  payload: Record<string, unknown>
): Promise<unknown> {
  return api.patch(`${BASE}/audits/${auditId}/checklist/${itemId}`, payload)
}

export async function linkIsoAuditEvidence(
  auditId: number | string,
  payload: Record<string, unknown>
): Promise<unknown> {
  return api.post(`${BASE}/audits/${auditId}/evidence`, payload)
}

/* ── Findings & CA ── */
export async function fetchIsoFindings(filters?: Record<string, unknown>): Promise<IsoFinding[]> {
  const data = await api.get(`${BASE}/findings${toQuery(filters)}`)
  return asList<IsoFinding>(data)
}

export async function createIsoFinding(payload: Record<string, unknown>): Promise<IsoFinding> {
  return (await api.post(`${BASE}/findings`, payload)) as IsoFinding
}

export async function fetchIsoCorrectiveActions(
  filters?: Record<string, unknown>
): Promise<IsoCorrectiveAction[]> {
  const data = await api.get(`${BASE}/corrective-actions${toQuery(filters)}`)
  return asList<IsoCorrectiveAction>(data)
}

export async function createIsoCorrectiveAction(
  payload: Record<string, unknown>
): Promise<IsoCorrectiveAction> {
  return (await api.post(`${BASE}/corrective-actions`, payload)) as IsoCorrectiveAction
}

export async function updateIsoCorrectiveAction(
  id: number | string,
  payload: Record<string, unknown>
): Promise<IsoCorrectiveAction> {
  return (await api.patch(`${BASE}/corrective-actions/${id}`, payload)) as IsoCorrectiveAction
}

/* ── Auditor room ── */
export async function fetchAuditorRoom(opts?: {
  auditorView?: boolean
}): Promise<IsoAuditorRoomResponse> {
  const data = await api.get(`${BASE}/auditor-room${toQuery(opts as Record<string, unknown>)}`)
  const obj = (data || {}) as IsoAuditorRoomResponse
  return {
    sections: Array.isArray(obj.sections) ? obj.sections : [],
    settings: obj.settings || null,
    auditorView: obj.auditorView,
  }
}

export async function fetchAuditorRoomSection(
  section: string,
  opts?: { auditorView?: boolean }
): Promise<{ section: IsoAuditorRoomResponse['sections'][0]; documents: IsoDocument[] }> {
  const data = await api.get(
    `${BASE}/auditor-room/${encodeURIComponent(section)}${toQuery(opts as Record<string, unknown>)}`
  )
  const obj = data as {
    section?: IsoAuditorRoomResponse['sections'][0]
    documents?: IsoDocument[]
    items?: IsoDocument[]
  }
  return {
    section: obj.section as IsoAuditorRoomResponse['sections'][0],
    documents: obj.documents || obj.items || [],
  }
}

/* ── Activity ── */
export async function fetchIsoActivityLog(
  filters?: Record<string, unknown>
): Promise<IsoActivityLogEntry[]> {
  const data = await api.get(`${BASE}/activity-log${toQuery(filters)}`)
  return asList<IsoActivityLogEntry>(data)
}

/* ── Phase 2 entities ── */
export async function fetchManagementReviews(
  filters?: Record<string, unknown>
): Promise<IsoManagementReview[]> {
  const data = await api.get(`${BASE}/management-reviews${toQuery(filters)}`)
  return asList<IsoManagementReview>(data)
}

export async function createManagementReview(
  payload: Record<string, unknown>
): Promise<IsoManagementReview> {
  return (await api.post(`${BASE}/management-reviews`, payload)) as IsoManagementReview
}

export async function fetchIsoRisks(filters?: Record<string, unknown>): Promise<IsoRisk[]> {
  const data = await api.get(`${BASE}/risks${toQuery(filters)}`)
  return asList<IsoRisk>(data)
}

export async function createIsoRisk(payload: Record<string, unknown>): Promise<IsoRisk> {
  return (await api.post(`${BASE}/risks`, payload)) as IsoRisk
}

export async function fetchIsoObjectives(
  filters?: Record<string, unknown>
): Promise<IsoQualityObjective[]> {
  const data = await api.get(`${BASE}/objectives${toQuery(filters)}`)
  return asList<IsoQualityObjective>(data)
}

export async function createIsoObjective(
  payload: Record<string, unknown>
): Promise<IsoQualityObjective> {
  return (await api.post(`${BASE}/objectives`, payload)) as IsoQualityObjective
}

export async function fetchIsoSuppliers(
  filters?: Record<string, unknown>
): Promise<IsoSupplier[]> {
  const data = await api.get(`${BASE}/suppliers${toQuery(filters)}`)
  return asList<IsoSupplier>(data)
}

export async function createIsoSupplier(payload: Record<string, unknown>): Promise<IsoSupplier> {
  return (await api.post(`${BASE}/suppliers`, payload)) as IsoSupplier
}

export async function fetchIsoEquipment(
  filters?: Record<string, unknown>
): Promise<IsoEquipment[]> {
  const data = await api.get(`${BASE}/equipment${toQuery(filters)}`)
  return asList<IsoEquipment>(data)
}

export async function createIsoEquipment(payload: Record<string, unknown>): Promise<IsoEquipment> {
  return (await api.post(`${BASE}/equipment`, payload)) as IsoEquipment
}

export async function fetchIsoMaintenanceLogs(
  filters?: Record<string, unknown>
): Promise<IsoMaintenanceLog[]> {
  const data = await api.get(`${BASE}/maintenance-logs${toQuery(filters)}`)
  return asList<IsoMaintenanceLog>(data)
}

export async function fetchIsoCalibrations(
  filters?: Record<string, unknown>
): Promise<IsoCalibration[]> {
  const data = await api.get(`${BASE}/calibrations${toQuery(filters)}`)
  return asList<IsoCalibration>(data)
}

export async function createIsoCalibration(
  payload: Record<string, unknown>
): Promise<IsoCalibration> {
  return (await api.post(`${BASE}/calibrations`, payload)) as IsoCalibration
}

export async function fetchIsoCertificates(
  filters?: Record<string, unknown>
): Promise<IsoExternalCertificate[]> {
  const data = await api.get(`${BASE}/certificates${toQuery(filters)}`)
  return asList<IsoExternalCertificate>(data)
}

export async function createIsoCertificate(
  payload: Record<string, unknown>
): Promise<IsoExternalCertificate> {
  return (await api.post(`${BASE}/certificates`, payload)) as IsoExternalCertificate
}

/* ── Settings & auditor assignments ── */
export async function fetchIsoSettings(): Promise<IsoSettings> {
  return ((await api.get(`${BASE}/settings`)) || {}) as IsoSettings
}

export async function updateIsoSettings(payload: IsoSettings): Promise<IsoSettings> {
  return (await api.put(`${BASE}/settings`, payload)) as IsoSettings
}

export async function fetchAuditorAssignments(): Promise<IsoAuditorAssignment[]> {
  const data = await api.get(`${BASE}/auditor-assignments`)
  return asList<IsoAuditorAssignment>(data)
}

export async function createAuditorAssignment(
  payload: Record<string, unknown>
): Promise<IsoAuditorAssignment> {
  return (await api.post(`${BASE}/auditor-assignments`, payload)) as IsoAuditorAssignment
}

export async function createAuditorAccount(
  payload: Record<string, unknown>
): Promise<{ user: { id: number; username: string; role: string }; assignment?: IsoAuditorAssignment | null }> {
  return (await api.post(`${BASE}/auditor-accounts`, payload)) as {
    user: { id: number; username: string; role: string }
    assignment?: IsoAuditorAssignment | null
  }
}

export async function updateAuditorAssignment(
  id: number | string,
  payload: Record<string, unknown>
): Promise<IsoAuditorAssignment> {
  return (await api.patch(`${BASE}/auditor-assignments/${id}`, payload)) as IsoAuditorAssignment
}

export async function revokeAuditorAssignment(id: number | string): Promise<unknown> {
  return api.post(`${BASE}/auditor-assignments/${id}/revoke`, {})
}
