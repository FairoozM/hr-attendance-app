const { query } = require('../db')

const DEFAULT_JSON = {}
const MAX_STRING_LENGTH = 280
const MAX_ARRAY_ITEMS = 50
const MAX_OBJECT_KEYS = 50
const MAX_DEPTH = 5

const SENSITIVE_KEY_RE = /(^|_)(token|secret|password|passwd|passphrase|api_key|apikey|authorization|cookie|credential|credentials)(_|$)/i
const ENV_KEY_RE = /(^|_)(env|environment_variables?|env_values?|secrets?)(_|$)/i
const LARGE_TEXT_KEY_RE = /(^|_)(content|body|markdown|html|text|description|notes|summary|rollback_notes)(_|$)/i
const INLINE_SECRET_RE = /\b(GITHUB_TOKEN|GITHUB_WEBHOOK_SECRET|OPENAI_API_KEY|PASSWORD|PASSWORD_HASH|SECRET|API_KEY)\b\s*[:=]\s*([^\s,;]+)/gi
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]+\b/gi

function normalizeUserId(value) {
  if (value == null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function truncateString(value, maxLength = MAX_STRING_LENGTH) {
  const str = String(value || '')
  if (str.length <= maxLength) return str
  return `${str.slice(0, maxLength)}…`
}

function redactSensitiveText(value) {
  return String(value || '')
    .replace(INLINE_SECRET_RE, '$1=[REDACTED]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
}

function isSensitiveKey(key) {
  return SENSITIVE_KEY_RE.test(key) || ENV_KEY_RE.test(key)
}

function sanitizeValue(value, key = '', depth = 0) {
  if (value == null) return value
  if (depth > MAX_DEPTH) return '[Truncated]'

  if (typeof value === 'string') {
    if (isSensitiveKey(key)) return '[REDACTED]'
    const redacted = redactSensitiveText(value)
    if (LARGE_TEXT_KEY_RE.test(key)) return truncateString(redacted, 400)
    return truncateString(redacted, MAX_STRING_LENGTH)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    const limited = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, key, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) {
      limited.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`)
    }
    return limited
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS)
    const out = {}
    for (const [entryKey, entryValue] of entries) {
      if (isSensitiveKey(entryKey)) {
        out[entryKey] = '[REDACTED]'
        continue
      }
      out[entryKey] = sanitizeValue(entryValue, entryKey, depth + 1)
    }
    if (Object.keys(value).length > MAX_OBJECT_KEYS) {
      out.__truncatedKeys = Object.keys(value).length - MAX_OBJECT_KEYS
    }
    return out
  }

  return truncateString(String(value))
}

async function resolveActorName(actorUserId, explicitName) {
  if (explicitName && String(explicitName).trim()) return truncateString(explicitName.trim(), 120)
  const userId = normalizeUserId(actorUserId)
  if (!userId) return null
  const result = await query(
    `SELECT
       COALESCE(NULLIF(TRIM(e.full_name), ''), NULLIF(TRIM(u.username), ''), CONCAT('User #', u.id)) AS actor_name
     FROM users u
     LEFT JOIN employees e ON e.id = u.employee_id
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  )
  return result.rows[0]?.actor_name || null
}

function sanitizePayload(payload = {}) {
  return sanitizeValue(payload, '')
}

async function logLinearAudit({
  entityType,
  entityId = null,
  action,
  actorUserId = null,
  actorName = null,
  summary = '',
  beforeSnapshot = DEFAULT_JSON,
  afterSnapshot = DEFAULT_JSON,
  metadata = DEFAULT_JSON,
}) {
  if (!entityType || !action) return

  try {
    const safeActorUserId = normalizeUserId(actorUserId)
    const safeActorName = await resolveActorName(safeActorUserId, actorName)
    const safeSummary = truncateString(summary || `${entityType} ${action}`, 240)

    await query(
      `INSERT INTO linear_audit_log
         (entity_type, entity_id, action, actor_user_id, actor_name, summary, before_snapshot, after_snapshot, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)`,
      [
        String(entityType),
        entityId == null ? null : String(entityId),
        String(action),
        safeActorUserId,
        safeActorName,
        safeSummary,
        JSON.stringify(sanitizePayload(beforeSnapshot)),
        JSON.stringify(sanitizePayload(afterSnapshot)),
        JSON.stringify(sanitizePayload(metadata)),
      ]
    )
  } catch (error) {
    console.warn('[linearAudit] log failed:', error.message || error)
  }
}

async function listLinearAudit({
  entityType,
  entityId,
  relatedIssueId,
  actorUserId,
  action,
  from,
  to,
  search,
  limit = 50,
  offset = 0,
} = {}) {
  const where = []
  const params = []

  function add(sql, value) {
    params.push(value)
    where.push(`${sql} $${params.length}`)
  }

  if (entityType) add('entity_type =', entityType)
  if (entityId) add('entity_id =', entityId)
  if (relatedIssueId != null && relatedIssueId !== '') {
    params.push(String(relatedIssueId))
    const idx = params.length
    where.push(`(
      (entity_type = 'issue' AND entity_id = $${idx})
      OR COALESCE(metadata->>'taskId', metadata->>'issueId') = $${idx}
    )`)
  }
  const safeActorUserId = normalizeUserId(actorUserId)
  if (safeActorUserId != null) add('actor_user_id =', safeActorUserId)
  if (action) add('action =', action)
  if (from) add('created_at >=', from)
  if (to) add('created_at <=', to)
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`)
    const idx = params.length
    where.push(`(
      summary ILIKE $${idx}
      OR COALESCE(actor_name, '') ILIKE $${idx}
      OR COALESCE(entity_id, '') ILIKE $${idx}
      OR COALESCE(metadata::text, '') ILIKE $${idx}
    )`)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0)

  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM linear_audit_log
     ${whereSql}`,
    params
  )

  params.push(safeLimit, safeOffset)
  const rowsResult = await query(
    `SELECT *
     FROM linear_audit_log
     ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  )

  return {
    items: rowsResult.rows || [],
    total: countResult.rows[0]?.total || 0,
    limit: safeLimit,
    offset: safeOffset,
  }
}

module.exports = {
  logLinearAudit,
  listLinearAudit,
}
