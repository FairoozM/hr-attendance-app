const { query } = require('../db')

const VALID_STATUSES = new Set(['active', 'snoozed', 'resolved', 'ignored'])

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10)
}

function normalizeKey(key) {
  const k = String(key || '').trim()
  if (!k) return null
  return k.slice(0, 512)
}

async function findByKey(notificationKey) {
  const key = normalizeKey(notificationKey)
  if (!key) return null
  const result = await query(
    `SELECT *
     FROM notification_actions
     WHERE notification_key = $1`,
    [key]
  )
  return result.rows[0] || null
}

async function findByKeys(keys) {
  const list = [...new Set((keys || []).map(normalizeKey).filter(Boolean))]
  if (!list.length) return new Map()
  const result = await query(
    `SELECT *
     FROM notification_actions
     WHERE notification_key = ANY($1::text[])`,
    [list]
  )
  const map = new Map()
  for (const row of result.rows) map.set(row.notification_key, row)
  return map
}

async function upsertAction({
  notificationKey,
  status,
  snoozedUntil = null,
  resolvedBy = null,
  ignoredBy = null,
  ignoreReason = '',
  sourceType = '',
  sourceId = '',
  dueDate = null,
}) {
  const key = normalizeKey(notificationKey)
  if (!key) throw new Error('notification_key is required')
  if (!VALID_STATUSES.has(status)) throw new Error('Invalid status')

  const now = new Date()
  const resolvedAt = status === 'resolved' ? now : null
  const ignoredAt = status === 'ignored' ? now : null
  const snoozeDate = status === 'snoozed' ? snoozedUntil : null

  const result = await query(
    `INSERT INTO notification_actions (
       notification_key, source_type, source_id, status,
       snoozed_until, resolved_at, resolved_by,
       ignored_at, ignored_by, ignore_reason, due_date
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (notification_key) DO UPDATE SET
       source_type = EXCLUDED.source_type,
       source_id = EXCLUDED.source_id,
       status = EXCLUDED.status,
       snoozed_until = EXCLUDED.snoozed_until,
       resolved_at = EXCLUDED.resolved_at,
       resolved_by = EXCLUDED.resolved_by,
       ignored_at = EXCLUDED.ignored_at,
       ignored_by = EXCLUDED.ignored_by,
       ignore_reason = EXCLUDED.ignore_reason,
       due_date = EXCLUDED.due_date,
       updated_at = NOW()
     RETURNING *`,
    [
      key,
      String(sourceType || '').slice(0, 64),
      String(sourceId || '').slice(0, 64),
      status,
      snoozeDate,
      resolvedAt,
      resolvedBy,
      ignoredAt,
      ignoredBy,
      String(ignoreReason || '').slice(0, 2000),
      dueDate,
    ]
  )
  return result.rows[0]
}

function isActionVisible(action) {
  if (!action) return true
  if (action.status === 'ignored') return false
  if (action.status === 'resolved') return false
  if (action.status === 'snoozed') {
    if (!action.snoozed_until) return true
    return String(action.snoozed_until).slice(0, 10) <= todayUtcDate()
  }
  return true
}

async function snooze({ notificationKey, snoozedUntil, userId, sourceType, sourceId, dueDate }) {
  const until = String(snoozedUntil || '').slice(0, 10)
  if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    throw new Error('snoozedUntil must be YYYY-MM-DD')
  }
  if (until < todayUtcDate()) {
    throw new Error('snoozedUntil must be today or in the future')
  }
  return upsertAction({
    notificationKey,
    status: 'snoozed',
    snoozedUntil: until,
    sourceType,
    sourceId,
    dueDate,
  })
}

async function ignore({ notificationKey, userId, reason = '', sourceType, sourceId, dueDate }) {
  return upsertAction({
    notificationKey,
    status: 'ignored',
    ignoredBy: userId,
    ignoreReason: reason,
    sourceType,
    sourceId,
    dueDate,
  })
}

async function resolve({ notificationKey, userId, sourceType, sourceId, dueDate }) {
  return upsertAction({
    notificationKey,
    status: 'resolved',
    resolvedBy: userId,
    sourceType,
    sourceId,
    dueDate,
  })
}

module.exports = {
  findByKey,
  findByKeys,
  upsertAction,
  isActionVisible,
  snooze,
  ignore,
  resolve,
  todayUtcDate,
}
