/**
 * linearWorkspaceApi.js
 * Frontend API client for all linear_* shared workspace tables.
 * Uses the shared `api` client (credentials:include, no-store, JSON).
 */
import { api } from '../api/client'

const BASE = '/api/projects/linear'

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
