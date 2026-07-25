const { query } = require('../db')

const VALID_STATUSES = new Set(['active', 'snoozed', 'resolved', 'ignored'])
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Business calendar used for every "is it due today" decision. The API server often runs in UTC
 * while the business day is UTC+4, so a plain UTC date flips reminders a day early for four hours
 * every night. Overridable for deployments in another region.
 */
const BUSINESS_TIME_ZONE = process.env.APP_TIMEZONE || 'Asia/Dubai'

/** Current calendar day in the business timezone as YYYY-MM-DD. */
function todayIso(timeZone = BUSINESS_TIME_ZONE) {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function isIsoDate(value) {
  return ISO_DATE_RE.test(String(value || ''))
}

/**
 * Normalize pg DATE / Date / ISO input to YYYY-MM-DD.
 * node-pg returns DATE columns as Date objects at *local* midnight, so `toISOString()` would
 * shift the day in negative UTC offsets — read the local calendar fields instead.
 */
function toIsoDate(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const iso = String(value).trim().slice(0, 10)
  return isIsoDate(iso) ? iso : null
}

function normalizeKey(key) {
  const k = String(key || '').trim()
  if (!k) return null
  return k.slice(0, 512)
}

function normalizeKeys(keys) {
  return [...new Set((Array.isArray(keys) ? keys : []).map(normalizeKey).filter(Boolean))]
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
  const list = normalizeKeys(keys)
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

/**
 * Write a status transition. `read_at` / `read_by` are deliberately left out of the conflict
 * update so that snoozing or ignoring an already-read reminder does not resurrect it as unread.
 */
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
  const snoozeDate = status === 'snoozed' ? toIsoDate(snoozedUntil) : null

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
      toIsoDate(dueDate),
    ]
  )
  return result.rows[0]
}

/**
 * Should a reminder with this action row still appear in the inbox?
 * A snooze that has elapsed becomes visible again (and reports `snooze_expired`).
 */
function isActionVisible(action, today = todayIso()) {
  if (!action) return true
  if (action.status === 'ignored') return false
  if (action.status === 'resolved') return false
  if (action.status === 'snoozed') {
    const until = toIsoDate(action.snoozed_until)
    if (!until) return true
    return until <= today
  }
  return true
}

function isActionRead(action) {
  return Boolean(action?.read_at)
}

async function snooze({ notificationKey, snoozedUntil, userId, sourceType, sourceId, dueDate }) {
  const until = toIsoDate(snoozedUntil)
  if (!until) throw new Error('snoozedUntil must be a valid YYYY-MM-DD date')
  if (until < todayIso()) throw new Error('snoozedUntil must be today or in the future')
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

/** Undo a snooze / ignore / resolve, putting the reminder back into the inbox. */
async function reactivate({ notificationKey, sourceType, sourceId, dueDate }) {
  return upsertAction({
    notificationKey,
    status: 'active',
    sourceType,
    sourceId,
    dueDate,
  })
}

/**
 * Mark dynamic reminders read without altering their status, so they stay visible but stop
 * inflating the bell badge. Returns the number of rows touched.
 */
async function markKeysRead({ keys, userId = null, sourceType = '', read = true }) {
  const list = normalizeKeys(keys)
  if (!list.length) return 0

  if (!read) {
    const cleared = await query(
      `UPDATE notification_actions
       SET read_at = NULL, read_by = NULL, updated_at = NOW()
       WHERE notification_key = ANY($1::text[])`,
      [list]
    )
    return cleared.rowCount
  }

  const result = await query(
    `INSERT INTO notification_actions (notification_key, source_type, status, read_at, read_by)
     SELECT k, $2, 'active', NOW(), $3
     FROM UNNEST($1::text[]) AS k
     ON CONFLICT (notification_key) DO UPDATE SET
       read_at = COALESCE(notification_actions.read_at, NOW()),
       read_by = COALESCE(notification_actions.read_by, EXCLUDED.read_by),
       updated_at = NOW()`,
    [list, String(sourceType || '').slice(0, 64), userId]
  )
  return result.rowCount
}

module.exports = {
  BUSINESS_TIME_ZONE,
  findByKey,
  findByKeys,
  upsertAction,
  isActionVisible,
  isActionRead,
  snooze,
  ignore,
  resolve,
  reactivate,
  markKeysRead,
  todayIso,
  isIsoDate,
  toIsoDate,
  /** @deprecated Use `todayIso()` — kept so existing callers keep working. */
  todayUtcDate: todayIso,
}
