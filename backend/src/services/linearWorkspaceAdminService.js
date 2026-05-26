const crypto = require('crypto')
const { query, pool } = require('../db')
const { logLinearAudit } = require('./linearAuditService')

const EXPORT_VERSION = 'linear-workspace-export-v1'
const DEFAULT_AUDIT_LIMIT = 1000
const MAX_AUDIT_LIMIT = 5000

const ALLOWED_SCOPES = new Set([
  'all',
  'issues',
  'docs',
  'intake',
  'releases',
  'deployments',
  'checklists',
  'audit',
])

const IMPORTABLE_SCOPE_KEYS = ['docs', 'intake', 'mobileReleases', 'deployments', 'checklistRuns']
const IMPORT_SCOPE_SET = new Set([...IMPORTABLE_SCOPE_KEYS, 'audit'])
const MODE_SET = new Set(['append_only', 'upsert'])
const CONFLICT_STRATEGY_SET = new Set(['skip', 'update_existing'])
const CONFIRMATION_TEXT = 'CONFIRM_IMPORT'

const ENTITY_KEYS = [
  'issues',
  'comments',
  'activity',
  'attachments',
  'docs',
  'intake',
  'mobileReleases',
  'deployments',
  'checklistRuns',
  'audit',
]

const INLINE_SECRET_RE = /\b(GITHUB_TOKEN|GITHUB_WEBHOOK_SECRET|OPENAI_API_KEY|PASSWORD|PASSWORD_HASH|SECRET|API_KEY)\b\s*[:=]\s*([^\s,;]+)/gi
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]+\b/gi
const SIGNED_URL_PARAM_RE = /(X-Amz-|AWSAccessKeyId|Signature=|Expires=|token=|signature=)/i
const SENSITIVE_KEY_RE = /(^|_)(token|secret|password|passwd|passphrase|api_key|apikey|authorization|cookie|credential|credentials)(_|$)/i
const ENV_KEY_RE = /(^|_)(env|environment_variables?|env_values?|secrets?)(_|$)/i

const SUPPORTED_FIELDS = {
  issues: [
    'id', 'project_id', 'section_id', 'parent_task_id', 'title', 'description', 'status', 'priority',
    'start_date', 'due_date', 'completed_at', 'estimated_hours', 'actual_hours', 'progress_percent',
    'sort_order', 'archived', 'created_by', 'created_at', 'updated_at', 'assignee_user_id',
    'reporter_user_id', 'reviewer_user_id', 'issue_type', 'sprint_id', 'story_points',
    'labels', 'blocked_reason', 'dev_meta',
  ],
  comments: ['id', 'task_id', 'user_id', 'parent_id', 'body', 'edited_at', 'created_at'],
  activity: ['id', 'task_id', 'user_id', 'action', 'old_value', 'new_value', 'meta', 'created_at'],
  attachments: ['id', 'projectId', 'taskId', 'fileName', 'fileType', 'fileSize', 'fileKey', 'fileUrl', 'kind', 'createdAt', 'uploadedBy'],
  docs: ['id', 'title', 'category', 'tags', 'summary', 'content', 'related_project_id', 'related_labels', 'created_by', 'updated_by', 'created_at', 'updated_at'],
  intake: [
    'id', 'title', 'source', 'type', 'platform', 'status', 'priority_suggestion', 'description',
    'url_or_screen', 'customer_reference', 'labels', 'template', 'structured_fields',
    'linked_issue_id', 'duplicate_of_intake_id', 'duplicate_reason', 'created_by', 'updated_by',
    'created_at', 'updated_at',
  ],
  mobileReleases: [
    'id', 'name', 'platform', 'version_number', 'build_number', 'status', 'target_date',
    'submitted_at', 'released_at', 'notes', 'store_links', 'linked_issue_ids', 'checklist',
    'created_by', 'updated_by', 'created_at', 'updated_at',
  ],
  deployments: [
    'id', 'name', 'deployment_type', 'environment', 'status', 'target_date', 'started_at',
    'deployed_at', 'verified_at', 'deployed_by', 'verified_by', 'notes', 'rollback_notes',
    'linked_issue_ids', 'checklist', 'created_by', 'updated_by', 'created_at', 'updated_at',
  ],
  checklistRuns: [
    'id', 'context_type', 'context_id', 'doc_id', 'doc_title', 'completed_items', 'notes',
    'created_by', 'updated_by', 'created_at', 'updated_at',
  ],
  audit: [
    'id', 'entity_type', 'entity_id', 'action', 'actor_user_id', 'actor_name', 'summary',
    'before_snapshot', 'after_snapshot', 'metadata', 'created_at',
  ],
}

const IMPORT_SCOPE_CONFIG = {
  docs: {
    table: 'linear_docs',
    exportKey: 'docs',
    label: 'Docs',
    naturalField: 'title',
    createColumns: [
      'id', 'title', 'category', 'tags', 'summary', 'content',
      'related_project_id', 'related_labels', 'created_by', 'updated_by', 'created_at', 'updated_at',
    ],
    updateColumns: [
      'title', 'category', 'tags', 'summary', 'content',
      'related_project_id', 'related_labels', 'updated_by', 'updated_at',
    ],
    compareColumns: [
      'title', 'category', 'tags', 'summary', 'content', 'related_project_id', 'related_labels',
    ],
    timestampField: 'updated_at',
  },
  intake: {
    table: 'linear_intake_items',
    exportKey: 'intake',
    label: 'Intake',
    naturalField: 'title',
    createColumns: [
      'id', 'title', 'source', 'type', 'platform', 'status', 'priority_suggestion',
      'description', 'url_or_screen', 'customer_reference', 'labels', 'template',
      'structured_fields', 'linked_issue_id', 'duplicate_of_intake_id', 'duplicate_reason',
      'created_by', 'updated_by', 'created_at', 'updated_at',
    ],
    updateColumns: [
      'title', 'source', 'type', 'platform', 'status', 'priority_suggestion',
      'description', 'url_or_screen', 'customer_reference', 'labels', 'template',
      'structured_fields', 'linked_issue_id', 'duplicate_of_intake_id', 'duplicate_reason',
      'updated_by', 'updated_at',
    ],
    compareColumns: [
      'title', 'source', 'type', 'platform', 'status', 'priority_suggestion',
      'description', 'url_or_screen', 'customer_reference', 'labels', 'template',
      'structured_fields', 'linked_issue_id', 'duplicate_of_intake_id', 'duplicate_reason',
    ],
    timestampField: 'updated_at',
  },
  mobileReleases: {
    table: 'linear_mobile_releases',
    exportKey: 'mobileReleases',
    label: 'Mobile Releases',
    naturalField: 'name',
    createColumns: [
      'id', 'name', 'platform', 'version_number', 'build_number', 'status', 'target_date',
      'submitted_at', 'released_at', 'notes', 'store_links', 'linked_issue_ids', 'checklist',
      'created_by', 'updated_by', 'created_at', 'updated_at',
    ],
    updateColumns: [
      'name', 'platform', 'version_number', 'build_number', 'status', 'target_date',
      'submitted_at', 'released_at', 'notes', 'store_links', 'linked_issue_ids', 'checklist',
      'updated_by', 'updated_at',
    ],
    compareColumns: [
      'name', 'platform', 'version_number', 'build_number', 'status', 'target_date',
      'submitted_at', 'released_at', 'notes', 'store_links', 'linked_issue_ids', 'checklist',
    ],
    timestampField: 'updated_at',
  },
  deployments: {
    table: 'linear_deployments',
    exportKey: 'deployments',
    label: 'Deployments',
    naturalField: 'name',
    createColumns: [
      'id', 'name', 'deployment_type', 'environment', 'status', 'target_date',
      'started_at', 'deployed_at', 'verified_at', 'deployed_by', 'verified_by',
      'notes', 'rollback_notes', 'linked_issue_ids', 'checklist',
      'created_by', 'updated_by', 'created_at', 'updated_at',
    ],
    updateColumns: [
      'name', 'deployment_type', 'environment', 'status', 'target_date',
      'started_at', 'deployed_at', 'verified_at', 'deployed_by', 'verified_by',
      'notes', 'rollback_notes', 'linked_issue_ids', 'checklist',
      'updated_by', 'updated_at',
    ],
    compareColumns: [
      'name', 'deployment_type', 'environment', 'status', 'target_date',
      'started_at', 'deployed_at', 'verified_at', 'deployed_by', 'verified_by',
      'notes', 'rollback_notes', 'linked_issue_ids', 'checklist',
    ],
    timestampField: 'updated_at',
  },
  checklistRuns: {
    table: 'linear_checklist_runs',
    exportKey: 'checklistRuns',
    label: 'Checklist Runs',
    naturalField: 'context',
    createColumns: [
      'id', 'context_type', 'context_id', 'doc_id', 'doc_title',
      'completed_items', 'notes', 'created_by', 'updated_by', 'created_at', 'updated_at',
    ],
    updateColumns: [
      'context_type', 'context_id', 'doc_id', 'doc_title',
      'completed_items', 'notes', 'updated_by', 'updated_at',
    ],
    compareColumns: [
      'context_type', 'context_id', 'doc_id', 'doc_title', 'completed_items', 'notes',
    ],
    timestampField: 'updated_at',
  },
}

function redactText(value) {
  return String(value || '')
    .replace(INLINE_SECRET_RE, '$1=[REDACTED]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
}

function isSensitiveKey(key) {
  return SENSITIVE_KEY_RE.test(key) || ENV_KEY_RE.test(key)
}

function sanitizeExportValue(value, key = '') {
  if (value == null) return value

  if (typeof value === 'string') {
    if (isSensitiveKey(key)) return '[REDACTED]'
    if (/^https?:\/\//i.test(value) && SIGNED_URL_PARAM_RE.test(value)) {
      return sanitizeUrlForExport(value)
    }
    return redactText(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value

  if (Array.isArray(value)) return value.map((item) => sanitizeExportValue(item, key))

  if (typeof value === 'object') {
    const out = {}
    for (const [entryKey, entryValue] of Object.entries(value)) {
      out[entryKey] = isSensitiveKey(entryKey)
        ? '[REDACTED]'
        : sanitizeExportValue(entryValue, entryKey)
    }
    return out
  }

  return redactText(String(value))
}

function ensureValidScope(scope) {
  const safeScope = String(scope || 'all')
  if (!ALLOWED_SCOPES.has(safeScope)) {
    const err = new Error('Unsupported export scope')
    err.status = 400
    throw err
  }
  return safeScope
}

function parseAuditLimit(scope, limit) {
  if (scope !== 'audit') return DEFAULT_AUDIT_LIMIT
  const parsed = parseInt(limit, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AUDIT_LIMIT
  return Math.min(parsed, MAX_AUDIT_LIMIT)
}

async function resolveActor(actorUserId) {
  if (actorUserId == null || actorUserId === '') {
    return { userId: null, name: null, username: null }
  }
  const id = Number(actorUserId)
  if (!Number.isFinite(id)) return { userId: null, name: null, username: null }
  const result = await query(
    `SELECT
       u.id,
       u.username,
       COALESCE(NULLIF(TRIM(e.full_name), ''), NULLIF(TRIM(u.username), ''), CONCAT('User #', u.id)) AS actor_name
     FROM users u
     LEFT JOIN employees e ON e.id = u.employee_id
     WHERE u.id = $1
     LIMIT 1`,
    [id]
  )
  const row = result.rows[0]
  return {
    userId: row?.id || null,
    name: row?.actor_name || null,
    username: row?.username || null,
  }
}

function sanitizeUrlForExport(value) {
  if (!value || typeof value !== 'string') return null
  if (!/^https?:\/\//i.test(value)) {
    return SIGNED_URL_PARAM_RE.test(value) ? value.split('?')[0] : value
  }
  try {
    const url = new URL(value)
    if (SIGNED_URL_PARAM_RE.test(url.search)) {
      url.search = ''
      return `${url.origin}${url.pathname}`
    }
    return url.toString()
  } catch {
    return value.split('?')[0]
  }
}

function publicAttachmentUrl(value) {
  if (!value || typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null
  return SIGNED_URL_PARAM_RE.test(value) ? null : sanitizeUrlForExport(value)
}

function fileKeyForExport(value) {
  if (!value || typeof value !== 'string') return null
  return sanitizeUrlForExport(value)
}

function emptyExportData() {
  return {
    issues: [],
    comments: [],
    activity: [],
    attachments: [],
    docs: [],
    intake: [],
    mobileReleases: [],
    deployments: [],
    checklistRuns: [],
    audit: [],
  }
}

async function fetchIssuesBundle() {
  const [issues, comments, activity, attachments] = await Promise.all([
    query(`SELECT * FROM project_tasks ORDER BY id ASC`),
    query(`SELECT * FROM task_comments ORDER BY id ASC`),
    query(`SELECT * FROM task_activity_log ORDER BY id ASC`),
    query(
      `SELECT
         ta.id,
         pt.project_id,
         ta.task_id,
         ta.file_name,
         ta.file_type,
         ta.file_size,
         ta.s3_key,
         ta.kind,
         ta.uploaded_at,
         ta.uploaded_by
       FROM task_attachments ta
       JOIN project_tasks pt ON pt.id = ta.task_id
       ORDER BY ta.id ASC`
    ),
  ])

  return {
    issues: issues.rows.map((row) => sanitizeExportValue(row)),
    comments: comments.rows.map((row) => sanitizeExportValue(row)),
    activity: activity.rows.map((row) => sanitizeExportValue(row)),
    attachments: attachments.rows.map((row) => sanitizeExportValue({
      id: row.id,
      projectId: row.project_id,
      taskId: row.task_id,
      fileName: row.file_name,
      fileType: row.file_type,
      fileSize: row.file_size,
      fileKey: fileKeyForExport(row.s3_key),
      fileUrl: publicAttachmentUrl(row.s3_key),
      kind: row.kind,
      createdAt: row.uploaded_at,
      uploadedBy: row.uploaded_by,
    })),
  }
}

async function fetchDocs() {
  const result = await query(`SELECT * FROM linear_docs ORDER BY id ASC`)
  return result.rows.map((row) => sanitizeExportValue(row))
}

async function fetchIntake() {
  const result = await query(`SELECT * FROM linear_intake_items ORDER BY id ASC`)
  return result.rows.map((row) => sanitizeExportValue(row))
}

async function fetchMobileReleases() {
  const result = await query(`SELECT * FROM linear_mobile_releases ORDER BY id ASC`)
  return result.rows.map((row) => sanitizeExportValue(row))
}

async function fetchDeployments() {
  const result = await query(`SELECT * FROM linear_deployments ORDER BY id ASC`)
  return result.rows.map((row) => sanitizeExportValue(row))
}

async function fetchChecklistRuns() {
  const result = await query(`SELECT * FROM linear_checklist_runs ORDER BY id ASC`)
  return result.rows.map((row) => sanitizeExportValue(row))
}

async function fetchAuditRows(limit) {
  const result = await query(
    `SELECT * FROM linear_audit_log ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit]
  )
  return result.rows.map((row) => sanitizeExportValue(row))
}

async function exportLinearWorkspaceData({ scope = 'all', actorUserId = null, auditLimit }) {
  const safeScope = ensureValidScope(scope)
  const safeAuditLimit = parseAuditLimit(safeScope, auditLimit)
  const actor = await resolveActor(actorUserId)
  const data = emptyExportData()

  if (safeScope === 'all' || safeScope === 'issues') {
    Object.assign(data, await fetchIssuesBundle())
  }
  if (safeScope === 'all' || safeScope === 'docs') {
    data.docs = await fetchDocs()
  }
  if (safeScope === 'all' || safeScope === 'intake') {
    data.intake = await fetchIntake()
  }
  if (safeScope === 'all' || safeScope === 'releases') {
    data.mobileReleases = await fetchMobileReleases()
  }
  if (safeScope === 'all' || safeScope === 'deployments') {
    data.deployments = await fetchDeployments()
  }
  if (safeScope === 'all' || safeScope === 'checklists') {
    data.checklistRuns = await fetchChecklistRuns()
  }
  if (safeScope === 'all' || safeScope === 'audit') {
    data.audit = await fetchAuditRows(safeAuditLimit)
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    exportedBy: sanitizeExportValue({
      userId: actor.userId,
      name: actor.name,
      username: actor.username,
    }),
    version: EXPORT_VERSION,
    scope: safeScope,
    data,
  }

  await logLinearAudit({
    entityType: 'admin',
    action: 'exported',
    actorUserId: actor.userId,
    summary: `Exported Linear workspace data: ${safeScope}`,
    metadata: {
      scope: safeScope,
      counts: ENTITY_KEYS.reduce((acc, key) => {
        acc[key] = Array.isArray(data[key]) ? data[key].length : 0
        return acc
      }, {}),
    },
  })

  return payload
}

function normalizeImportPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const err = new Error('Export JSON object is required')
    err.status = 400
    throw err
  }
  if (body.version && body.data) return body
  if (body.payload && typeof body.payload === 'object') return body.payload
  if (body.export && typeof body.export === 'object') return body.export
  const err = new Error('Export JSON must include version and data')
  err.status = 400
  throw err
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function unique(values) {
  return Array.from(new Set(values))
}

function normalizeScopeKey(value) {
  const key = String(value || '').trim()
  if (!key) return null
  if (key === 'releases') return 'mobileReleases'
  if (key === 'checklists') return 'checklistRuns'
  return key
}

function normalizeImportScopes(scopes, includeAudit = false) {
  const raw = Array.isArray(scopes) ? scopes : []
  const next = unique(raw.map(normalizeScopeKey).filter(Boolean))
  for (const scope of next) {
    if (!IMPORT_SCOPE_SET.has(scope)) {
      const err = new Error(`Unsupported import scope: ${scope}`)
      err.status = 400
      throw err
    }
  }
  const filtered = next.filter((scope) => scope !== 'audit')
  if (includeAudit && !filtered.includes('audit')) filtered.push('audit')
  return filtered
}

function normalizeImportOptions(options = {}) {
  const mode = String(options.mode || 'append_only')
  const conflictStrategy = String(options.conflictStrategy || 'skip')
  const includeAudit = !!options.includeAudit

  if (!MODE_SET.has(mode)) {
    const err = new Error('Unsupported import mode')
    err.status = 400
    throw err
  }
  if (!CONFLICT_STRATEGY_SET.has(conflictStrategy)) {
    const err = new Error('Unsupported conflict strategy')
    err.status = 400
    throw err
  }
  if (includeAudit && mode !== 'append_only') {
    const err = new Error('Audit import is only allowed in append_only mode')
    err.status = 400
    throw err
  }

  const scopes = normalizeImportScopes(options.scopes, includeAudit)
  if (!scopes.length) {
    const err = new Error('Select at least one import scope')
    err.status = 400
    throw err
  }

  return { scopes, mode, conflictStrategy, includeAudit }
}

function ensureValidImportPayload(payload) {
  ensureValidScope(payload.scope || 'all')
  if (payload.version !== EXPORT_VERSION) {
    const err = new Error(`Unsupported export version: ${payload.version || 'missing'}`)
    err.status = 400
    throw err
  }
  return payload
}

async function existingIds(table, ids) {
  if (!ids.length) return []
  const result = await query(`SELECT id FROM ${table} WHERE id = ANY($1::int[])`, [ids])
  return result.rows.map((row) => Number(row.id))
}

function extraFields(rows, allowedFields) {
  const extras = new Set()
  for (const row of rows.slice(0, 50)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    Object.keys(row).forEach((key) => {
      if (!allowedFields.includes(key)) extras.add(key)
    })
  }
  return Array.from(extras).sort()
}

function toIntOrNull(value) {
  if (value == null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function normalizeString(value) {
  if (value == null) return null
  const str = String(value).trim()
  return str ? redactText(str) : null
}

function normalizeStringArray(value) {
  return asArray(value)
    .map((item) => normalizeString(item))
    .filter(Boolean)
}

function normalizeIntArray(value) {
  return asArray(value)
    .map((item) => toIntOrNull(item))
    .filter((item) => item != null)
}

function normalizeJson(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  return sanitizeExportValue(value)
}

function normalizeDateLike(value) {
  if (value == null || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return String(value)
}

function normalizeTextKey(value) {
  return String(value || '').trim().toLowerCase()
}

function parseTimestampValue(value) {
  if (value == null || value === '') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.getTime()
}

function normalizeComparableValue(value) {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => normalizeComparableValue(item))
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = normalizeComparableValue(value[key])
      return acc
    }, {})
  }
  return value == null ? null : value
}

function stableStringify(value) {
  return JSON.stringify(normalizeComparableValue(value))
}

function buildNaturalKey(scopeKey, row) {
  if (!row) return ''
  if (scopeKey === 'checklistRuns') {
    return [
      normalizeTextKey(row.context_type),
      String(row.context_id || ''),
      String(row.doc_id || 0),
    ].join('::')
  }
  const field = IMPORT_SCOPE_CONFIG[scopeKey]?.naturalField
  return normalizeTextKey(row?.[field])
}

function comparableRecord(scopeKey, row) {
  const fields = IMPORT_SCOPE_CONFIG[scopeKey]?.compareColumns || []
  return fields.reduce((acc, key) => {
    acc[key] = normalizeComparableValue(row?.[key] ?? null)
    return acc
  }, {})
}

function rowsEqualForImport(scopeKey, incomingRow, existingRow) {
  return stableStringify(comparableRecord(scopeKey, incomingRow)) === stableStringify(comparableRecord(scopeKey, existingRow))
}

function recordDisplayName(scopeKey, row) {
  if (!row) return `#${row?.id || 'unknown'}`
  if (scopeKey === 'checklistRuns') {
    return `${row.context_type || 'context'} ${row.context_id || row.id || ''}`.trim()
  }
  return row.title || row.name || `#${row.id || 'unknown'}`
}

function createCounts() {
  return { incoming: 0, create: 0, update: 0, skip: 0, conflict: 0 }
}

function visiblePreviewResponse(result) {
  return {
    success: true,
    previewToken: result.previewToken,
    version: result.version,
    exportedAt: result.exportedAt,
    scope: result.scope,
    counts: result.counts,
    warnings: result.warnings,
    conflicts: result.conflicts,
  }
}

function buildPreviewToken(payload) {
  const normalized = sanitizeExportValue({
    version: payload.version,
    exportedAt: payload.exportedAt || null,
    scope: payload.scope || null,
    data: payload.data || {},
  })
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 24)
}

async function fetchImportState() {
  const [
    usersResult,
    projectsResult,
    issuesResult,
    docsResult,
    intakeResult,
    mobileReleasesResult,
    deploymentsResult,
    checklistRunsResult,
  ] = await Promise.all([
    query(`SELECT id FROM users`),
    query(`SELECT id FROM projects`),
    query(`SELECT id FROM project_tasks`),
    query(`SELECT * FROM linear_docs ORDER BY id ASC`),
    query(`SELECT * FROM linear_intake_items ORDER BY id ASC`),
    query(`SELECT * FROM linear_mobile_releases ORDER BY id ASC`),
    query(`SELECT * FROM linear_deployments ORDER BY id ASC`),
    query(`SELECT * FROM linear_checklist_runs ORDER BY id ASC`),
  ])

  return {
    userIds: new Set(usersResult.rows.map((row) => Number(row.id)).filter(Number.isFinite)),
    projectIds: new Set(projectsResult.rows.map((row) => Number(row.id)).filter(Number.isFinite)),
    issueIds: new Set(issuesResult.rows.map((row) => Number(row.id)).filter(Number.isFinite)),
    existingRows: {
      docs: docsResult.rows || [],
      intake: intakeResult.rows || [],
      mobileReleases: mobileReleasesResult.rows || [],
      deployments: deploymentsResult.rows || [],
      checklistRuns: checklistRunsResult.rows || [],
    },
  }
}

function buildScopeIndexes(scopeKey, rows) {
  const byId = new Map()
  const byNaturalKey = new Map()
  for (const row of rows || []) {
    const id = toIntOrNull(row?.id)
    if (id != null) byId.set(id, row)
    const naturalKey = buildNaturalKey(scopeKey, row)
    if (!naturalKey) continue
    const list = byNaturalKey.get(naturalKey) || []
    list.push(row)
    byNaturalKey.set(naturalKey, list)
  }
  return { byId, byNaturalKey }
}

function addConflict(conflicts, scopeKey, row, type, message) {
  conflicts.push({
    scope: scopeKey,
    id: row?.id ?? null,
    type,
    message,
  })
}

function normalizeUserRef(value, userIds) {
  const id = toIntOrNull(value)
  return id != null && userIds.has(id) ? id : null
}

function normalizeBaseRow(raw, allowedFields) {
  const sanitized = sanitizeExportValue(raw)
  const row = {}
  for (const field of allowedFields) {
    row[field] = sanitized?.[field]
  }
  return row
}

function normalizeScopeRow(scopeKey, raw, context) {
  const issues = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { row: null, issues: [{ type: 'invalid_shape', message: `${scopeKey} row must be an object` }] }
  }

  const base = normalizeBaseRow(raw, SUPPORTED_FIELDS[scopeKey] || [])
  const id = toIntOrNull(base.id)
  if (id == null) {
    issues.push({ type: 'invalid_shape', message: `${scopeKey} row is missing a numeric id` })
  }

  if (scopeKey === 'docs') {
    const row = {
      id,
      title: normalizeString(base.title),
      category: normalizeString(base.category),
      tags: normalizeStringArray(base.tags),
      summary: normalizeString(base.summary),
      content: normalizeString(base.content),
      related_project_id: toIntOrNull(base.related_project_id),
      related_labels: normalizeStringArray(base.related_labels),
      created_by: normalizeUserRef(base.created_by, context.userIds),
      updated_by: normalizeUserRef(base.updated_by, context.userIds),
      created_at: normalizeDateLike(base.created_at),
      updated_at: normalizeDateLike(base.updated_at),
    }
    if (!row.title) issues.push({ type: 'invalid_shape', message: 'Doc title is required' })
    if (row.related_project_id != null && !context.projectIds.has(row.related_project_id)) {
      issues.push({
        type: 'missing_project_reference',
        message: `Doc "${row.title || row.id}" references missing project #${row.related_project_id}`,
      })
    }
    return { row, issues }
  }

  if (scopeKey === 'intake') {
    const row = {
      id,
      title: normalizeString(base.title),
      source: normalizeString(base.source),
      type: normalizeString(base.type),
      platform: normalizeString(base.platform),
      status: normalizeString(base.status),
      priority_suggestion: normalizeString(base.priority_suggestion),
      description: normalizeString(base.description),
      url_or_screen: normalizeString(base.url_or_screen),
      customer_reference: normalizeString(base.customer_reference),
      labels: normalizeStringArray(base.labels),
      template: normalizeString(base.template),
      structured_fields: normalizeJson(base.structured_fields, {}),
      linked_issue_id: toIntOrNull(base.linked_issue_id),
      duplicate_of_intake_id: toIntOrNull(base.duplicate_of_intake_id),
      duplicate_reason: normalizeString(base.duplicate_reason),
      created_by: normalizeUserRef(base.created_by, context.userIds),
      updated_by: normalizeUserRef(base.updated_by, context.userIds),
      created_at: normalizeDateLike(base.created_at),
      updated_at: normalizeDateLike(base.updated_at),
    }
    if (!row.title) issues.push({ type: 'invalid_shape', message: 'Intake title is required' })
    if (row.linked_issue_id != null && !context.issueIds.has(row.linked_issue_id)) {
      issues.push({
        type: 'missing_issue_reference',
        message: `Intake "${row.title || row.id}" references missing issue #${row.linked_issue_id}`,
      })
    }
    if (
      row.duplicate_of_intake_id != null &&
      !context.availableIntakeIds.has(row.duplicate_of_intake_id)
    ) {
      issues.push({
        type: 'missing_intake_reference',
        message: `Intake "${row.title || row.id}" references missing intake #${row.duplicate_of_intake_id}`,
      })
    }
    return { row, issues }
  }

  if (scopeKey === 'mobileReleases') {
    const linkedIssueIds = normalizeIntArray(base.linked_issue_ids)
    const row = {
      id,
      name: normalizeString(base.name),
      platform: normalizeString(base.platform),
      version_number: normalizeString(base.version_number),
      build_number: normalizeString(base.build_number),
      status: normalizeString(base.status),
      target_date: normalizeDateLike(base.target_date),
      submitted_at: normalizeDateLike(base.submitted_at),
      released_at: normalizeDateLike(base.released_at),
      notes: normalizeString(base.notes),
      store_links: normalizeJson(base.store_links, {}),
      linked_issue_ids: linkedIssueIds,
      checklist: normalizeJson(base.checklist, {}),
      created_by: normalizeUserRef(base.created_by, context.userIds),
      updated_by: normalizeUserRef(base.updated_by, context.userIds),
      created_at: normalizeDateLike(base.created_at),
      updated_at: normalizeDateLike(base.updated_at),
    }
    if (!row.name) issues.push({ type: 'invalid_shape', message: 'Mobile release name is required' })
    for (const issueId of linkedIssueIds) {
      if (!context.issueIds.has(issueId)) {
        issues.push({
          type: 'missing_issue_reference',
          message: `Mobile release "${row.name || row.id}" references missing issue #${issueId}`,
        })
      }
    }
    return { row, issues }
  }

  if (scopeKey === 'deployments') {
    const linkedIssueIds = normalizeIntArray(base.linked_issue_ids)
    const row = {
      id,
      name: normalizeString(base.name),
      deployment_type: normalizeString(base.deployment_type),
      environment: normalizeString(base.environment),
      status: normalizeString(base.status),
      target_date: normalizeDateLike(base.target_date),
      started_at: normalizeDateLike(base.started_at),
      deployed_at: normalizeDateLike(base.deployed_at),
      verified_at: normalizeDateLike(base.verified_at),
      deployed_by: normalizeUserRef(base.deployed_by, context.userIds),
      verified_by: normalizeUserRef(base.verified_by, context.userIds),
      notes: normalizeString(base.notes),
      rollback_notes: normalizeString(base.rollback_notes),
      linked_issue_ids: linkedIssueIds,
      checklist: normalizeJson(base.checklist, {}),
      created_by: normalizeUserRef(base.created_by, context.userIds),
      updated_by: normalizeUserRef(base.updated_by, context.userIds),
      created_at: normalizeDateLike(base.created_at),
      updated_at: normalizeDateLike(base.updated_at),
    }
    if (!row.name) issues.push({ type: 'invalid_shape', message: 'Deployment name is required' })
    for (const issueId of linkedIssueIds) {
      if (!context.issueIds.has(issueId)) {
        issues.push({
          type: 'missing_issue_reference',
          message: `Deployment "${row.name || row.id}" references missing issue #${issueId}`,
        })
      }
    }
    return { row, issues }
  }

  if (scopeKey === 'checklistRuns') {
    const contextType = normalizeString(base.context_type)
    const contextId = base.context_id == null ? null : String(base.context_id).trim()
    const docId = toIntOrNull(base.doc_id)
    const row = {
      id,
      context_type: contextType,
      context_id: contextId,
      doc_id: docId,
      doc_title: normalizeString(base.doc_title),
      completed_items: normalizeJson(base.completed_items, {}),
      notes: normalizeString(base.notes),
      created_by: normalizeUserRef(base.created_by, context.userIds),
      updated_by: normalizeUserRef(base.updated_by, context.userIds),
      created_at: normalizeDateLike(base.created_at),
      updated_at: normalizeDateLike(base.updated_at),
    }
    if (!row.context_type || !row.context_id) {
      issues.push({ type: 'invalid_shape', message: 'Checklist run context_type and context_id are required' })
    }
    if (row.doc_id != null && !context.availableDocIds.has(row.doc_id)) {
      issues.push({
        type: 'missing_doc_reference',
        message: `Checklist run "${recordDisplayName('checklistRuns', row)}" references missing doc #${row.doc_id}`,
      })
    }
    if (row.context_type === 'issue') {
      const issueId = toIntOrNull(row.context_id)
      if (issueId == null || !context.issueIds.has(issueId)) {
        issues.push({
          type: 'missing_issue_reference',
          message: `Checklist run "${recordDisplayName('checklistRuns', row)}" references missing issue #${row.context_id}`,
        })
      }
    }
    if (row.context_type === 'project') {
      const projectId = toIntOrNull(row.context_id)
      if (projectId == null || !context.projectIds.has(projectId)) {
        issues.push({
          type: 'missing_project_reference',
          message: `Checklist run "${recordDisplayName('checklistRuns', row)}" references missing project #${row.context_id}`,
        })
      }
    }
    if (row.context_type === 'doc') {
      const linkedDocId = toIntOrNull(row.context_id)
      if (linkedDocId == null || !context.availableDocIds.has(linkedDocId)) {
        issues.push({
          type: 'missing_doc_reference',
          message: `Checklist run "${recordDisplayName('checklistRuns', row)}" references missing doc #${row.context_id}`,
        })
      }
    }
    return { row, issues }
  }

  return {
    row: null,
    issues: [{ type: 'unsupported_scope', message: `Unsupported import scope: ${scopeKey}` }],
  }
}

function buildPreviewWarnings(payload, unsupportedFields, selectedScopes, includeAudit) {
  const warnings = []
  if (asArray(payload.data?.issues).length || asArray(payload.data?.comments).length || asArray(payload.data?.activity).length) {
    warnings.push('Issues, comments, and activity are not restored in Phase 15C.')
  }
  if (asArray(payload.data?.attachments).length) {
    warnings.push('Attachment metadata is not restored in Phase 15C.')
  }
  if (asArray(payload.data?.audit).length && !includeAudit) {
    warnings.push('Audit rows are not imported unless includeAudit is explicitly enabled in the API request.')
  }
  if (selectedScopes.includes('checklistRuns') && !selectedScopes.includes('docs')) {
    warnings.push('Checklist runs that reference docs require those docs to already exist or be imported in the same operation.')
  }
  for (const [scopeKey, fields] of Object.entries(unsupportedFields)) {
    warnings.push(`${IMPORT_SCOPE_CONFIG[scopeKey]?.label || scopeKey} contains unsupported fields that will be ignored: ${fields.join(', ')}`)
  }
  warnings.push('Restore does not delete existing data.')
  warnings.push('Append-only is the safest import mode.')
  return warnings
}

function buildPreviewContext(importState, payload, selectedScopes) {
  const selectedSet = new Set(selectedScopes)
  const incomingDocIds = new Set(
    selectedSet.has('docs')
      ? asArray(payload.data?.docs).map((row) => toIntOrNull(row?.id)).filter((id) => id != null)
      : []
  )
  const incomingIntakeIds = new Set(
    selectedSet.has('intake')
      ? asArray(payload.data?.intake).map((row) => toIntOrNull(row?.id)).filter((id) => id != null)
      : []
  )

  return {
    userIds: importState.userIds,
    projectIds: importState.projectIds,
    issueIds: importState.issueIds,
    availableDocIds: new Set([
      ...importState.existingRows.docs.map((row) => Number(row.id)).filter(Number.isFinite),
      ...incomingDocIds,
    ]),
    availableIntakeIds: new Set([
      ...importState.existingRows.intake.map((row) => Number(row.id)).filter(Number.isFinite),
      ...incomingIntakeIds,
    ]),
  }
}

async function analyzeImportPreview(body, options = {}) {
  const payload = ensureValidImportPayload(normalizeImportPayload(body))
  const selectedScopes = normalizeImportScopes(options.selectedScopes || IMPORTABLE_SCOPE_KEYS, !!options.includeAudit)
  const importState = await fetchImportState()
  const context = buildPreviewContext(importState, payload, selectedScopes)
  const previewToken = buildPreviewToken(payload)
  const counts = {}
  const conflicts = []
  const plans = {}
  const unsupportedFields = {}

  for (const scopeKey of IMPORTABLE_SCOPE_KEYS) {
    counts[scopeKey] = createCounts()
    plans[scopeKey] = []

    const rows = asArray(payload.data?.[IMPORT_SCOPE_CONFIG[scopeKey].exportKey])
    counts[scopeKey].incoming = rows.length
    const extras = extraFields(rows, SUPPORTED_FIELDS[scopeKey] || [])
    if (extras.length) unsupportedFields[scopeKey] = extras

    const existingRows = importState.existingRows[scopeKey] || []
    const existingIndexes = buildScopeIndexes(scopeKey, existingRows)

    for (const rawRow of rows) {
      const { row, issues } = normalizeScopeRow(scopeKey, rawRow, context)
      if (!row || issues.length > 0) {
        counts[scopeKey].conflict += 1
        const messages = issues.map((issue) => issue.message)
        for (const issue of issues) addConflict(conflicts, scopeKey, rawRow, issue.type, issue.message)
        plans[scopeKey].push({
          scope: scopeKey,
          status: 'conflict',
          reason: messages.join('; '),
          incoming: row || rawRow,
          existing: null,
        })
        continue
      }

      const naturalKey = buildNaturalKey(scopeKey, row)
      if (naturalKey) {
        const naturalMatches = (existingIndexes.byNaturalKey.get(naturalKey) || [])
          .filter((existingRow) => Number(existingRow.id) !== Number(row.id))
        if (naturalMatches.length > 0) {
          counts[scopeKey].conflict += 1
          const message = `${IMPORT_SCOPE_CONFIG[scopeKey].label} "${recordDisplayName(scopeKey, row)}" conflicts with existing record #${naturalMatches[0].id} by ${IMPORT_SCOPE_CONFIG[scopeKey].naturalField}`
          addConflict(conflicts, scopeKey, row, 'natural_key_conflict', message)
          plans[scopeKey].push({
            scope: scopeKey,
            status: 'conflict',
            reason: message,
            incoming: row,
            existing: naturalMatches[0],
          })
          continue
        }
      }

      const existing = existingIndexes.byId.get(Number(row.id)) || null
      if (!existing) {
        counts[scopeKey].create += 1
        plans[scopeKey].push({
          scope: scopeKey,
          status: 'create',
          reason: 'Record does not exist yet',
          incoming: row,
          existing: null,
        })
        continue
      }

      if (rowsEqualForImport(scopeKey, row, existing)) {
        counts[scopeKey].skip += 1
        plans[scopeKey].push({
          scope: scopeKey,
          status: 'skip',
          reason: 'Existing record already matches export',
          incoming: row,
          existing,
        })
        continue
      }

      const incomingTs = parseTimestampValue(row[IMPORT_SCOPE_CONFIG[scopeKey].timestampField])
      const existingTs = parseTimestampValue(existing[IMPORT_SCOPE_CONFIG[scopeKey].timestampField])

      if (incomingTs != null && existingTs != null && incomingTs > existingTs) {
        counts[scopeKey].update += 1
        plans[scopeKey].push({
          scope: scopeKey,
          status: 'update',
          reason: 'Exported record is newer than the current record',
          incoming: row,
          existing,
        })
        continue
      }

      counts[scopeKey].conflict += 1
      const message = incomingTs != null && existingTs != null && incomingTs < existingTs
        ? `${IMPORT_SCOPE_CONFIG[scopeKey].label} "${recordDisplayName(scopeKey, row)}" is older than the current record`
        : `${IMPORT_SCOPE_CONFIG[scopeKey].label} "${recordDisplayName(scopeKey, row)}" differs from the current record`
      addConflict(conflicts, scopeKey, row, 'content_conflict', message)
      plans[scopeKey].push({
        scope: scopeKey,
        status: 'conflict',
        reason: message,
        incoming: row,
        existing,
      })
    }
  }

  for (const attachment of asArray(payload.data?.attachments)) {
    const taskId = toIntOrNull(attachment?.taskId)
    if (taskId != null && !importState.issueIds.has(taskId)) {
      addConflict(
        conflicts,
        'attachments',
        attachment,
        'missing_issue_reference',
        `Attachment metadata "${attachment?.fileName || attachment?.id || 'attachment'}" references missing issue #${taskId}`
      )
    }
  }

  const warnings = buildPreviewWarnings(payload, unsupportedFields, selectedScopes, !!options.includeAudit)

  return {
    success: true,
    previewToken,
    version: payload.version,
    exportedAt: payload.exportedAt || null,
    scope: payload.scope || null,
    counts,
    warnings,
    conflicts: conflicts.slice(0, 200),
    plans,
    payload,
    unsupportedFields,
  }
}

async function previewLinearWorkspaceImport(body) {
  const result = await analyzeImportPreview(body, { selectedScopes: IMPORTABLE_SCOPE_KEYS })
  return visiblePreviewResponse(result)
}

async function dryRunLinearWorkspaceImport(body) {
  const result = await analyzeImportPreview(body, { selectedScopes: IMPORTABLE_SCOPE_KEYS })
  const possibleConflicts = {}
  const missingReferences = []

  for (const scopeKey of IMPORTABLE_SCOPE_KEYS) {
    possibleConflicts[scopeKey] = {
      count: result.counts[scopeKey].conflict + result.counts[scopeKey].update,
      ids: result.plans[scopeKey]
        .filter((plan) => plan.status === 'conflict' || plan.status === 'update')
        .map((plan) => plan.incoming?.id)
        .filter((id) => id != null)
        .slice(0, 20),
    }
  }

  for (const conflict of result.conflicts) {
    if (String(conflict.type || '').startsWith('missing_')) {
      missingReferences.push({
        entity: conflict.scope,
        id: conflict.id,
        field: conflict.type,
        missing: conflict.message,
      })
    }
  }

  return {
    dryRun: true,
    restoreImplemented: true,
    previewToken: result.previewToken,
    version: result.version,
    validVersion: result.version === EXPORT_VERSION,
    scope: result.scope,
    counts: Object.fromEntries(
      Object.entries(result.counts).map(([scopeKey, value]) => [scopeKey, value.incoming])
    ),
    possibleConflicts,
    missingReferences: missingReferences.slice(0, 100),
    unsupportedFields: result.unsupportedFields,
    warnings: result.warnings,
  }
}

function ensureConfirmation(value) {
  if (String(value || '') !== CONFIRMATION_TEXT) {
    const err = new Error(`Confirmation text must be ${CONFIRMATION_TEXT}`)
    err.status = 400
    throw err
  }
}

async function insertScopeRow(client, scopeKey, row) {
  const config = IMPORT_SCOPE_CONFIG[scopeKey]
  const values = config.createColumns.map((column) => {
    if (column === 'created_at') return row.created_at || row.updated_at || new Date().toISOString()
    if (column === 'updated_at') return row.updated_at || row.created_at || new Date().toISOString()
    return row[column] ?? null
  })
  const placeholders = config.createColumns.map((_, index) => `$${index + 1}`).join(', ')
  const result = await client.query(
    `INSERT INTO ${config.table} (${config.createColumns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    values
  )
  return result.rows[0] || null
}

async function updateScopeRow(client, scopeKey, id, row, existing) {
  const config = IMPORT_SCOPE_CONFIG[scopeKey]
  const values = config.updateColumns.map((column) => {
    if (column === 'updated_at') return row.updated_at || existing?.updated_at || new Date().toISOString()
    return row[column] ?? null
  })
  values.push(id)
  const assignments = config.updateColumns.map((column, index) => `${column} = $${index + 1}`).join(', ')
  const result = await client.query(
    `UPDATE ${config.table} SET ${assignments} WHERE id = $${values.length} RETURNING *`,
    values
  )
  return result.rows[0] || null
}

async function syncScopeSequence(client, scopeKey) {
  const table = IMPORT_SCOPE_CONFIG[scopeKey]?.table
  if (!table) return
  await client.query(
    `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`
  )
}

async function fetchExistingImportedAuditIds(exportedAt, ids) {
  if (!exportedAt || !ids.length) return new Set()
  const result = await query(
    `SELECT metadata->>'importedFromAuditId' AS source_id
     FROM linear_audit_log
     WHERE metadata->>'importedAudit' = 'true'
       AND metadata->>'importedFromExportedAt' = $1
       AND metadata->>'importedFromAuditId' = ANY($2::text[])`,
    [String(exportedAt), ids.map((id) => String(id))]
  )
  return new Set(result.rows.map((row) => String(row.source_id)))
}

async function appendImportedAuditRows(client, payload) {
  const rows = asArray(payload.data?.audit)
  const counts = createCounts()
  counts.incoming = rows.length
  if (!rows.length) return counts

  const existingImportedIds = await fetchExistingImportedAuditIds(payload.exportedAt || null, rows.map((row) => row?.id).filter((id) => id != null))
  for (const row of rows) {
    const sourceId = row?.id == null ? null : String(row.id)
    if (!sourceId || existingImportedIds.has(sourceId)) {
      counts.skip += 1
      continue
    }
    await client.query(
      `INSERT INTO linear_audit_log
         (entity_type, entity_id, action, actor_user_id, actor_name, summary, before_snapshot, after_snapshot, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)`,
      [
        normalizeString(row.entity_type) || 'imported_audit',
        row.entity_id == null ? null : String(row.entity_id),
        normalizeString(row.action) || 'imported',
        null,
        row.actor_name ? `${String(row.actor_name)} (imported)` : 'Imported audit',
        row.summary ? `[Imported] ${String(row.summary)}` : '[Imported] Audit row',
        JSON.stringify(sanitizeExportValue(row.before_snapshot || {})),
        JSON.stringify(sanitizeExportValue(row.after_snapshot || {})),
        JSON.stringify(sanitizeExportValue({
          ...(row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {}),
          importedAudit: true,
          importedFromAuditId: sourceId,
          importedFromExportedAt: payload.exportedAt || null,
          importedAt: new Date().toISOString(),
        })),
        normalizeDateLike(row.created_at) || new Date().toISOString(),
      ]
    )
    counts.create += 1
  }
  await syncScopeSequence(client, 'audit')
  return counts
}

async function applyLinearWorkspaceImport({
  exportData,
  options = {},
  confirmation,
  previewToken,
  actorUserId = null,
}) {
  ensureConfirmation(confirmation)
  const safeOptions = normalizeImportOptions(options)
  const payload = ensureValidImportPayload(normalizeImportPayload(exportData))
  const expectedPreviewToken = buildPreviewToken(payload)
  if (!previewToken || String(previewToken) !== expectedPreviewToken) {
    const err = new Error('Preview token is required. Run Preview Import again before applying changes.')
    err.status = 400
    throw err
  }

  const preview = await analyzeImportPreview(payload, {
    selectedScopes: safeOptions.scopes,
    includeAudit: safeOptions.includeAudit,
  })

  const selectedScopes = safeOptions.scopes.filter((scope) => scope !== 'audit')
  const resultCounts = {}
  const warnings = [...preview.warnings]
  const conflicts = [...preview.conflicts]
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    for (const scopeKey of selectedScopes) {
      resultCounts[scopeKey] = createCounts()
      const plans = preview.plans[scopeKey] || []
      resultCounts[scopeKey].incoming = plans.length
      let createdInScope = false

      for (const plan of plans) {
        if (plan.status === 'create') {
          await insertScopeRow(client, scopeKey, plan.incoming)
          resultCounts[scopeKey].create += 1
          createdInScope = true
          continue
        }

        if (plan.status === 'update') {
          if (safeOptions.mode === 'upsert' && safeOptions.conflictStrategy === 'update_existing') {
            await updateScopeRow(client, scopeKey, plan.existing?.id, plan.incoming, plan.existing)
            resultCounts[scopeKey].update += 1
          } else {
            resultCounts[scopeKey].skip += 1
          }
          continue
        }

        if (plan.status === 'skip') {
          resultCounts[scopeKey].skip += 1
          continue
        }

        resultCounts[scopeKey].conflict += 1
      }

      if (createdInScope) await syncScopeSequence(client, scopeKey)
    }

    if (safeOptions.includeAudit) {
      resultCounts.audit = await appendImportedAuditRows(client, payload)
    }

    await client.query('COMMIT')
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* noop */ }
    throw error
  } finally {
    client.release()
  }

  await logLinearAudit({
    entityType: 'admin',
    action: 'imported',
    actorUserId,
    summary: 'Imported Linear workspace data',
    metadata: {
      scopes: safeOptions.scopes,
      mode: safeOptions.mode,
      conflictStrategy: safeOptions.conflictStrategy,
      includeAudit: safeOptions.includeAudit,
      counts: resultCounts,
    },
  })

  return {
    success: true,
    importedAt: new Date().toISOString(),
    previewToken: expectedPreviewToken,
    version: payload.version,
    scope: payload.scope || null,
    mode: safeOptions.mode,
    conflictStrategy: safeOptions.conflictStrategy,
    includeAudit: safeOptions.includeAudit,
    counts: resultCounts,
    warnings,
    conflicts: conflicts.slice(0, 200),
  }
}

module.exports = {
  EXPORT_VERSION,
  exportLinearWorkspaceData,
  dryRunLinearWorkspaceImport,
  previewLinearWorkspaceImport,
  applyLinearWorkspaceImport,
}
