/**
 * projectsApi.js
 *
 * Typed API service layer for the server-backed Team Planner.
 * All functions use the shared `api` client (credentials:include, no-store).
 *
 * Shape conventions
 * -----------------
 * Server returns snake_case (e.g. due_date, assignee_user_id).
 * This layer returns the raw server shape — let the UI/context normalise as needed.
 * Helper `normalizeTask` and `normalizeProject` provide camelCase views where useful.
 *
 * Error handling
 * --------------
 * All functions throw on non-2xx (the `api` client already does this).
 * Callers should catch and surface errors through their own state.
 */

import { api } from '../api/client'

// ─── Normalisation helpers ────────────────────────────────────────────────────

/**
 * Convert a server task row (snake_case) into a UI-friendly camelCase object.
 * Old AIPlannerContext tasks stay in their own format; this only applies to
 * server tasks fetched via projectsApi.
 */
export function normalizeTask(row) {
  if (!row) return null
  return {
    // Identity
    id:              row.id,
    projectId:       row.project_id,
    sectionId:       row.section_id,
    parentTaskId:    row.parent_task_id,

    // Content
    title:           row.title || '',
    description:     row.description || '',

    // Classification
    issueType:       row.issue_type || 'task',
    status:          row.status || 'Not Started',
    priority:        row.priority || 'Medium',
    labels:          Array.isArray(row.labels) ? row.labels : [],

    // People
    assigneeUserId:  row.assignee_user_id || null,
    reporterUserId:  row.reporter_user_id || null,
    reviewerUserId:  row.reviewer_user_id || null,

    // Sprint & estimation
    sprintId:        row.sprint_id || null,
    storyPoints:     row.story_points ?? null,
    estimatedHours:  row.estimated_hours ?? null,
    actualHours:     row.actual_hours ?? null,
    progressPercent: row.progress_percent ?? 0,

    // Dates
    startDate:       row.start_date || null,
    dueDate:         row.due_date || null,
    completedAt:     row.completed_at || null,

    // Blocker
    blockedReason:   row.blocked_reason || null,

    // Dev workflow metadata (Phase 6C)
    devMeta:         row.dev_meta && typeof row.dev_meta === 'object' ? row.dev_meta : {},

    // Meta
    sortOrder:       row.sort_order ?? 0,
    archived:        row.archived || false,
    createdBy:       row.created_by || null,
    createdAt:       row.created_at || null,
    updatedAt:       row.updated_at || null,

    // Relations loaded server-side
    subtasks:        Array.isArray(row.subtasks) ? row.subtasks.map(normalizeTask) : [],
    dependencies:    Array.isArray(row.dependencies) ? row.dependencies : [],
    attachments:     Array.isArray(row.attachments) ? row.attachments : [],
  }
}

/**
 * Convert a server project row into a camelCase object.
 */
export function normalizeProject(row) {
  if (!row) return null
  return {
    id:           row.id,
    name:         row.name || '',
    slug:         row.slug || '',
    description:  row.description || '',
    status:       row.status || 'Planning',
    priority:     row.priority || 'Medium',
    color:        row.color || '#8b5cf6',
    emoji:        row.emoji || null,
    projectType:  row.project_type || 'software',
    isPrivate:    row.is_private || false,
    startDate:    row.start_date || null,
    dueDate:      row.due_date || null,
    ownerUserId:  row.owner_user_id || null,
    archived:     row.archived || false,
    createdAt:    row.created_at || null,
    updatedAt:    row.updated_at || null,
    // Aggregates returned by dashboard/list endpoints
    taskCount:    row.task_count ?? null,
    doneCount:    row.done_count ?? null,
    sections:     Array.isArray(row.sections) ? row.sections : [],
    members:      Array.isArray(row.members)  ? row.members  : [],
  }
}

/**
 * Normalize a team member row from GET /api/team/members.
 */
export function normalizeComment(row) {
  if (!row) return null
  return {
    id:         row.id,
    taskId:     row.task_id,
    userId:     row.user_id,
    parentId:   row.parent_id,
    body:       row.body || '',
    createdAt:  row.created_at,
    authorName: row.author_name || row.username || 'Unknown',
  }
}

export function normalizeActivity(row) {
  if (!row) return null
  return {
    id:         row.id,
    taskId:     row.task_id,
    userId:     row.user_id,
    action:     row.action || '',
    oldValue:   row.old_value,
    newValue:   row.new_value,
    meta:       (() => {
      if (row.meta && typeof row.meta === 'object') return row.meta
      if (typeof row.meta === 'string') {
        try { return JSON.parse(row.meta) } catch { return {} }
      }
      return {}
    })(),
    createdAt:  row.created_at,
    actorName:  row.author_name || row.username || 'System',
  }
}

export function normalizeMember(row) {
  if (!row) return null
  return {
    id:          row.id,
    username:    row.username || '',
    displayName: row.display_name || row.username || '',
    role:        row.role || 'employee',
    plannerRole: row.planner_role || 'view',
    avatarUrl:   row.avatar_url || null,
    employeeId:  row.employee_id || null,
    department:  row.department || null,
    designation: row.designation || null,
  }
}

// ─── Projects ────────────────────────────────────────────────────────────────

export const projectsApi = {
  /** List all projects (non-archived by default). */
  list: (params = {}) => {
    const qs = new URLSearchParams()
    if (params.archived) qs.set('archived', 'true')
    const path = `/api/projects${qs.toString() ? `?${qs}` : ''}`
    return api.get(path).then((rows) =>
      Array.isArray(rows) ? rows.map(normalizeProject) : []
    )
  },

  /** Get a single project with its sections. */
  get: (id) =>
    api.get(`/api/projects/${id}`).then(normalizeProject),

  /** Create a new project. */
  create: (data) =>
    api.post('/api/projects', data).then(normalizeProject),

  /** Update a project. */
  update: (id, data) =>
    api.patch(`/api/projects/${id}`, data).then(normalizeProject),

  /** Delete a project. */
  delete: (id) =>
    api.delete(`/api/projects/${id}`),

  /** Get project dashboard stats. */
  getDashboard: () =>
    api.get('/api/projects/dashboard'),
}

// ─── Sections ────────────────────────────────────────────────────────────────

export const sectionsApi = {
  create: (projectId, data) =>
    api.post(`/api/projects/${projectId}/sections`, data),

  update: (projectId, sectionId, data) =>
    api.patch(`/api/projects/${projectId}/sections/${sectionId}`, data),

  delete: (projectId, sectionId) =>
    api.delete(`/api/projects/${projectId}/sections/${sectionId}`),
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const tasksApi = {
  /** List tasks for a project (returns normalized task objects). */
  list: (projectId, params = {}) => {
    const qs = new URLSearchParams()
    if (params.sprintId)   qs.set('sprint_id',  String(params.sprintId))
    if (params.assigneeId) qs.set('assignee_id', String(params.assigneeId))
    if (params.issueType)  qs.set('issue_type',  params.issueType)
    if (params.status)     qs.set('status',       params.status)
    const path = `/api/projects/${projectId}/tasks${qs.toString() ? `?${qs}` : ''}`
    return api.get(path).then((rows) =>
      Array.isArray(rows) ? rows.map(normalizeTask) : []
    )
  },

  /** Create a task inside a project. */
  create: (projectId, data) =>
    api.post(`/api/projects/${projectId}/tasks`, data).then(normalizeTask),

  /** Update a task. */
  update: (projectId, taskId, data) =>
    api.patch(`/api/projects/${projectId}/tasks/${taskId}`, data).then(normalizeTask),

  /** Delete a task. */
  delete: (projectId, taskId) =>
    api.delete(`/api/projects/${projectId}/tasks/${taskId}`),
}

// ─── Comments ────────────────────────────────────────────────────────────────

export const commentsApi = {
  /**
   * List comments for a task.
   * Route not yet wired on the backend in Phase 1 — placeholder for Phase 3.
   */
  list: (projectId, taskId) =>
    api.get(`/api/projects/${projectId}/tasks/${taskId}/comments`).then((rows) =>
      Array.isArray(rows) ? rows.map(normalizeComment) : []
    ),

  create: (projectId, taskId, body) =>
    api.post(`/api/projects/${projectId}/tasks/${taskId}/comments`, { body }).then(normalizeComment),

  update: (projectId, taskId, commentId, body) =>
    api.patch(`/api/projects/${projectId}/tasks/${taskId}/comments/${commentId}`, { body }),

  delete: (projectId, taskId, commentId) =>
    api.delete(`/api/projects/${projectId}/tasks/${taskId}/comments/${commentId}`),
}

// ─── Activity log ────────────────────────────────────────────────────────────

export const activityApi = {
  /**
   * Fetch activity log for a task.
   * Route not yet wired in Phase 1 — placeholder for Phase 3.
   */
  list: (projectId, taskId) =>
    api.get(`/api/projects/${projectId}/tasks/${taskId}/activity`).then((rows) =>
      Array.isArray(rows) ? rows.map(normalizeActivity) : []
    ),
}

// ─── Cycles (Phase 4B) ───────────────────────────────────────────────────────
// User-facing: "Cycle". Backed by the `sprints` table internally.

/**
 * Normalise a server sprint row into a UI-friendly Cycle object.
 * Maps: sprint.status 'draft' → 'planned'; otherwise preserves value.
 */
export function normalizeCycle(row) {
  if (!row) return null
  const rawStatus = row.status || 'planned'
  const status = rawStatus === 'draft' ? 'planned' : rawStatus
  return {
    id:          row.id,
    projectId:   row.project_id,
    name:        row.name || '',
    goal:        row.goal || null,
    status,          // 'planned' | 'active' | 'completed'
    startDate:   row.start_date || null,
    endDate:     row.end_date || null,
    completedAt: row.completed_at || null,
    sortOrder:   row.sort_order ?? 0,
    createdBy:   row.created_by || null,
    createdAt:   row.created_at || null,
    updatedAt:   row.updated_at || null,
  }
}

export const cyclesApi = {
  /** List cycles for a project (GET /api/projects/:projectId/cycles). */
  list: (projectId) =>
    api.get(`/api/projects/${projectId}/cycles`).then((rows) =>
      Array.isArray(rows) ? rows.map(normalizeCycle) : []
    ),

  /** Create a cycle (POST /api/projects/:projectId/cycles). */
  create: (projectId, data) =>
    api.post(`/api/projects/${projectId}/cycles`, data).then(normalizeCycle),

  /** Update a cycle (PATCH /api/projects/:projectId/cycles/:cycleId). */
  update: (projectId, cycleId, data) =>
    api.patch(`/api/projects/${projectId}/cycles/${cycleId}`, data).then(normalizeCycle),
}

// ─── Sprints (legacy placeholder — superseded by cyclesApi above) ─────────────

export const sprintsApi = {
  /**
   * Legacy placeholder — superseded by cyclesApi.
   * Kept for backward-compatibility only; not used by the UI.
   */
  list: (projectId) =>
    api.get(`/api/sprints?project_id=${projectId}`),

  get: (sprintId) =>
    api.get(`/api/sprints/${sprintId}`),

  create: (data) =>
    api.post('/api/sprints', data),

  update: (sprintId, data) =>
    api.patch(`/api/sprints/${sprintId}`, data),

  start: (sprintId) =>
    api.post(`/api/sprints/${sprintId}/start`),

  complete: (sprintId) =>
    api.post(`/api/sprints/${sprintId}/complete`),

  delete: (sprintId) =>
    api.delete(`/api/sprints/${sprintId}`),
}

// ─── Issue AI Assistant (Phase 6B) ────────────────────────────────────────────

/**
 * Call the Issue AI Assistant backend.
 * @param {number|string} projectId
 * @param {number|string} taskId
 * @param {string} action  – improve_title | draft_description | acceptance_criteria | qa_checklist | cursor_prompt | release_note
 * @param {string} [extraContext] – optional extra context string
 * @returns {Promise<{ action: string, output: string }>}
 */
export async function linearIssueAiAssist(projectId, taskId, action, extraContext = '') {
  const res = await api.post(`/api/projects/${projectId}/tasks/${taskId}/ai/assist`, {
    action,
    extra_context: extraContext || '',
  })
  if (!res || !res.output) {
    throw new Error(res?.message || 'AI returned empty output')
  }
  return { action: res.action, output: res.output }
}

// ─── Attachments (Phase 8A) ───────────────────────────────────────────────────

export function listAttachmentsApi(projectId, taskId) {
  return api.get(`/api/projects/${projectId}/tasks/${taskId}/attachments`)
}

export function getAttachmentUploadUrlApi(projectId, taskId, { fileName, contentType, fileSize }) {
  return api.post(`/api/projects/${projectId}/tasks/${taskId}/attachments/upload-url`, {
    fileName, contentType, fileSize,
  })
}

export function saveAttachmentMetaApi(projectId, taskId, { s3Key, fileName, fileType, fileSize }) {
  return api.post(`/api/projects/${projectId}/tasks/${taskId}/attachments`, {
    s3Key, fileName, fileType, fileSize,
  })
}

export function deleteAttachmentApi(projectId, taskId, attachmentId) {
  return api.delete(`/api/projects/${projectId}/tasks/${taskId}/attachments/${attachmentId}`)
}

export function getAttachmentDownloadUrlApi(projectId, taskId, attachmentId) {
  return api.get(`/api/projects/${projectId}/tasks/${taskId}/attachments/${attachmentId}/download-url`)
}

// ─── GitHub PR Sync (Phase 7A) ────────────────────────────────────────────────

/**
 * Sync GitHub PR metadata into a task's dev_meta via the backend.
 * @param {number|string} projectId
 * @param {number|string} taskId
 * @param {string} prUrl  – full GitHub PR URL
 * @returns {Promise<{ devMeta: object }>}
 */
export async function syncIssueGithubPr(projectId, taskId, prUrl) {
  const res = await api.post(
    `/api/projects/${projectId}/tasks/${taskId}/github/sync-pr`,
    { prUrl }
  )
  if (!res || !res.devMeta) {
    throw new Error(res?.message || 'GitHub sync returned empty response')
  }
  return { devMeta: res.devMeta }
}

/**
 * Fetch GitHub integration diagnostics from the backend.
 * Never returns token/secret values — safe to display in UI.
 */
export async function getGithubIntegrationStatus() {
  return api.get('/api/projects/integrations/github/status')
}

/**
 * Fetch GitHub automation audit log (matched events from task_activity_log).
 * Never returns token/secret values.
 */
export async function getGithubAuditLog({ limit = 100, offset = 0 } = {}) {
  return api.get(`/api/projects/integrations/github/audit?limit=${limit}&offset=${offset}`)
}

// ─── Team members ─────────────────────────────────────────────────────────────

export const teamApi = {
  /** List users who have planner access. */
  listMembers: () =>
    api.get('/api/team/members').then((rows) =>
      Array.isArray(rows) ? rows.map(normalizeMember) : []
    ),
}

// ─── Convenience re-export ───────────────────────────────────────────────────

export default {
  projects:  projectsApi,
  sections:  sectionsApi,
  tasks:     tasksApi,
  comments:  commentsApi,
  activity:  activityApi,
  cycles:    cyclesApi,
  sprints:   sprintsApi,
  team:      teamApi,

  // Direct helpers for convenience
  normalizeTask,
  normalizeProject,
  normalizeMember,
  normalizeComment,
  normalizeActivity,
  normalizeCycle,
}
