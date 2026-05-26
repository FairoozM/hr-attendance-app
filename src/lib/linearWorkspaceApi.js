/**
 * linearWorkspaceApi.js
 * Frontend API client for all linear_* shared workspace tables.
 * Uses the shared `api` client (credentials:include, no-store, JSON).
 */
import { api } from '../api/client'

const BASE = '/api/projects/linear'

// ── Smoke Tests ────────────────────────────────────────────────────────────────

export const getLinearWorkspaceSmokeTestsApi = () => api.get(`${BASE}/smoke-tests`)
export const runLinearWorkspaceSmokeTestsApi = (payload) => api.post(`${BASE}/smoke-tests/run`, payload)

// ── Workspace Health ───────────────────────────────────────────────────────────

export const getLinearWorkspaceHealthApi = () => api.get(`${BASE}/health`)

// ── Global Search ─────────────────────────────────────────────────────────────

export function searchLinearWorkspaceApi({ q, type = 'all', limit = 20 }, opts = {}) {
  const qs = new URLSearchParams()
  if (q != null) qs.set('q', String(q))
  if (type) qs.set('type', String(type))
  if (limit) qs.set('limit', String(limit))
  return api.get(`${BASE}/search?${qs.toString()}`, opts)
}

// ── Notification Preferences ─────────────────────────────────────────────────

export function getLinearNotificationPreferencesApi(userId = null) {
  const qs = new URLSearchParams()
  if (userId != null) qs.set('userId', String(userId))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return api.get(`${BASE}/notifications/preferences${suffix}`)
}

export function updateLinearNotificationPreferencesApi(payload, userId = null) {
  const body = userId == null ? payload : { ...payload, userId }
  return api.patch(`${BASE}/notifications/preferences`, body)
}

// ── Digest Outbox ─────────────────────────────────────────────────────────────

export const listLinearDigestOutboxApi = () => api.get(`${BASE}/notifications/digests`)
export const createLinearDigestOutboxApi = (payload) => api.post(`${BASE}/notifications/digests`, payload)
export const updateLinearDigestOutboxApi = (id, payload) => api.patch(`${BASE}/notifications/digests/${id}`, payload)
export const deleteLinearDigestOutboxApi = (id) => api.delete(`${BASE}/notifications/digests/${id}`)

// ── Docs ───────────────────────────────────────────────────────────────────

export const listDocsApi      = ()        => api.get(`${BASE}/docs`)
export const getDocApi        = (id)      => api.get(`${BASE}/docs/${id}`)
export const createDocApi     = (data)    => api.post(`${BASE}/docs`, data)
export const updateDocApi     = (id, d)   => api.patch(`${BASE}/docs/${id}`, d)
export const deleteDocApi     = (id)      => api.delete(`${BASE}/docs/${id}`)

// ── Intake ─────────────────────────────────────────────────────────────────

export const listIntakeApi    = ()        => api.get(`${BASE}/intake`)
export const createIntakeApi  = (data)    => api.post(`${BASE}/intake`, data)
export const updateIntakeApi  = (id, d)   => api.patch(`${BASE}/intake/${id}`, d)
export const deleteIntakeApi  = (id)      => api.delete(`${BASE}/intake/${id}`)

// ── Mobile Releases ────────────────────────────────────────────────────────

export const listMobileReleasesApi  = ()       => api.get(`${BASE}/mobile-releases`)
export const createMobileReleaseApi = (data)   => api.post(`${BASE}/mobile-releases`, data)
export const updateMobileReleaseApi = (id, d)  => api.patch(`${BASE}/mobile-releases/${id}`, d)
export const deleteMobileReleaseApi = (id)     => api.delete(`${BASE}/mobile-releases/${id}`)

// ── Deployments ────────────────────────────────────────────────────────────

export const listDeploymentsApi   = ()       => api.get(`${BASE}/deployments`)
export const createDeploymentApi  = (data)   => api.post(`${BASE}/deployments`, data)
export const updateDeploymentApi  = (id, d)  => api.patch(`${BASE}/deployments/${id}`, d)
export const deleteDeploymentApi  = (id)     => api.delete(`${BASE}/deployments/${id}`)

// ── Launch Records ──────────────────────────────────────────────────────────

export const listLaunchRecordsApi   = ()       => api.get(`${BASE}/launch-records`)
export const createLaunchRecordApi  = (data)   => api.post(`${BASE}/launch-records`, data)
export const updateLaunchRecordApi  = (id, d)  => api.patch(`${BASE}/launch-records/${id}`, d)
export const deleteLaunchRecordApi  = (id)     => api.delete(`${BASE}/launch-records/${id}`)

// ── Checklist Runs ─────────────────────────────────────────────────────────

export function listChecklistRunsApi(params = {}) {
  const qs = new URLSearchParams()
  if (params.context_type) qs.set('context_type', params.context_type)
  if (params.context_id)   qs.set('context_id',   params.context_id)
  const suffix = qs.toString() ? `?${qs}` : ''
  return api.get(`${BASE}/checklist-runs${suffix}`)
}
export const upsertChecklistRunApi  = (data)  => api.post(`${BASE}/checklist-runs`, data)
export const deleteChecklistRunApi  = (id)    => api.delete(`${BASE}/checklist-runs/${id}`)

// ── Audit Log ────────────────────────────────────────────────────────────────

export function listAuditLogApi(params = {}) {
  const qs = new URLSearchParams()
  if (params.entityType) qs.set('entityType', params.entityType)
  if (params.entityId) qs.set('entityId', params.entityId)
  if (params.relatedIssueId) qs.set('relatedIssueId', params.relatedIssueId)
  if (params.actorUserId) qs.set('actorUserId', params.actorUserId)
  if (params.action) qs.set('action', params.action)
  if (params.from) qs.set('from', params.from)
  if (params.to) qs.set('to', params.to)
  if (params.search) qs.set('search', params.search)
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.offset) qs.set('offset', String(params.offset))
  const suffix = qs.toString() ? `?${qs}` : ''
  return api.get(`${BASE}/audit${suffix}`)
}

// ── Admin Backup / Export ─────────────────────────────────────────────────────

export function exportLinearWorkspaceApi(scope = 'all') {
  const qs = new URLSearchParams({ scope, format: 'json' })
  return api.get(`${BASE}/admin/export?${qs.toString()}`)
}

export function validateLinearWorkspaceExportApi(payload) {
  return api.post(`${BASE}/admin/import/dry-run`, payload)
}

export function previewLinearWorkspaceImportApi(payload) {
  return api.post(`${BASE}/admin/import/preview`, payload)
}

export function applyLinearWorkspaceImportApi(payload) {
  return api.post(`${BASE}/admin/import/apply`, payload)
}

// ── Admin Users / Roles ──────────────────────────────────────────────────────

export const listLinearWorkspaceUsersApi = () => api.get(`${BASE}/admin/users`)
export const updateLinearWorkspaceUserRoleApi = (userId, linearWorkspaceRole) =>
  api.patch(`${BASE}/admin/users/${userId}/role`, { linearWorkspaceRole })

export const getLinearPermissionsAuditApi = () => api.get(`${BASE}/admin/permissions/audit`)
export const simulateLinearPermissionsApi = (role) =>
  api.post(`${BASE}/admin/permissions/simulate`, { role })

// ── Migration helpers ──────────────────────────────────────────────────────

const MIGRATION_FLAG_KEY = 'lifesmile.linear.sharedMigration.v1'

export function isMigrated() {
  try { return !!localStorage.getItem(MIGRATION_FLAG_KEY) } catch { return false }
}

export function markMigrated() {
  try {
    localStorage.setItem(MIGRATION_FLAG_KEY, JSON.stringify({ migratedAt: new Date().toISOString() }))
  } catch {}
}
