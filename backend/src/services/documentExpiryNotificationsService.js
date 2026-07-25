const documentExpiryService = require('./documentExpiryService')
const notificationActionsService = require('./notificationActionsService')

const SOURCE_TYPE = 'document_expiry'
const MS_PER_DAY = 24 * 60 * 60 * 1000
const DEFAULT_REMINDER_DAYS = 30

const { todayIso, toIsoDate, isIsoDate } = notificationActionsService

function docTypeSlug(documentType) {
  const raw = String(documentType || 'document').trim().toLowerCase()
  if (!raw) return 'document'
  if (raw.includes('trade license')) return 'trade_license'
  if (raw.includes('visa') || raw.includes('emirates')) return 'visa_emirates_id'
  if (raw.includes('vat')) return 'vat_filing'
  if (raw.includes('insurance')) return 'insurance'
  if (raw.includes('nicop') || raw.includes('id /')) return 'id_document'
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'document'
}

function buildNotificationKey(doc) {
  const expiry = toIsoDate(doc?.expiry_date) || ''
  const typeSlug = docTypeSlug(doc?.document_type)
  return `document_expiry:${typeSlug}:${doc?.id}:${expiry}`
}

/** Midnight UTC for an ISO date, so day arithmetic is never affected by DST or the server offset. */
function isoToUtcMs(iso) {
  if (!isIsoDate(iso)) return NaN
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Whole calendar days from `fromIso` to `toIso` (negative when `toIso` is in the past). */
function daysBetween(fromIso, toIso) {
  const from = isoToUtcMs(fromIso)
  const to = isoToUtcMs(toIso)
  if (Number.isNaN(from) || Number.isNaN(to)) return null
  return Math.round((to - from) / MS_PER_DAY)
}

function addDaysIso(iso, delta) {
  const base = isoToUtcMs(iso)
  if (Number.isNaN(base)) return null
  return new Date(base + Number(delta || 0) * MS_PER_DAY).toISOString().slice(0, 10)
}

/** Calendar days until `expiryDate`; 0 means "today", negative means already expired. */
function getDaysLeft(expiryDate, today = todayIso()) {
  const iso = toIsoDate(expiryDate)
  if (!iso) return null
  return daysBetween(today, iso)
}

/**
 * Lead time in days before expiry. `Number(null)` is 0 rather than NaN, so null/'' must be
 * rejected explicitly or a missing value silently collapses the reminder window to nothing.
 */
function normalizeReminderDays(reminderDays) {
  if (reminderDays === null || reminderDays === undefined || reminderDays === '') {
    return DEFAULT_REMINDER_DAYS
  }
  const days = Number(reminderDays)
  if (!Number.isFinite(days) || days < 0) return DEFAULT_REMINDER_DAYS
  return Math.floor(days)
}

/** The day the reminder starts appearing: `reminderDays` before expiry. */
function getReminderDate(expiryDate, reminderDays) {
  const iso = toIsoDate(expiryDate)
  if (!iso) return null
  return addDaysIso(iso, -normalizeReminderDays(reminderDays))
}

function getSmartStatus(expiryDate, today = todayIso()) {
  const days = getDaysLeft(expiryDate, today)
  if (days === null) return 'OK'
  if (days < 0) return 'Expired'
  if (days <= 7) return 'Urgent'
  if (days <= 30) return 'Due Soon'
  return 'OK'
}

/** DD/MM/YYYY without relying on the server's ICU locale data. */
function formatDmy(iso) {
  const value = toIsoDate(iso)
  if (!value) return ''
  const [y, m, d] = value.split('-')
  return `${d}/${m}/${y}`
}

function pluralDays(n) {
  return `${n} day${n === 1 ? '' : 's'}`
}

function buildMessage(expiryDate, today = todayIso()) {
  const daysLeft = getDaysLeft(expiryDate, today)
  if (daysLeft === null) return 'No expiry date recorded.'
  if (daysLeft < 0) return `Expired ${pluralDays(Math.abs(daysLeft))} ago — action required.`
  if (daysLeft === 0) return 'Expires today — immediate action required.'
  return `Expires in ${pluralDays(daysLeft)} on ${formatDmy(expiryDate)}.`
}

function mapUrgency(expiryDate, today = todayIso()) {
  const status = getSmartStatus(expiryDate, today)
  if (status === 'Expired') return 'expired'
  if (status === 'Urgent') return 'urgent'
  return 'due-soon'
}

function mapRow(doc, action, today = todayIso()) {
  const expiryDate = toIsoDate(doc.expiry_date)
  const notificationKey = buildNotificationKey(doc)
  const snoozedUntil = toIsoDate(action?.snoozed_until)
  return {
    id: notificationKey,
    notification_key: notificationKey,
    type: 'document_expiry',
    title: doc.name,
    message: buildMessage(expiryDate, today),
    scheduled_for: expiryDate,
    is_read: notificationActionsService.isActionRead(action),
    read_at: action?.read_at || null,
    source_type: SOURCE_TYPE,
    source_id: String(doc.id),
    due_date: expiryDate,
    document_type: doc.document_type || '',
    company: doc.company || '',
    urgency: mapUrgency(expiryDate, today),
    days_left: getDaysLeft(expiryDate, today),
    action_status: action?.status || 'active',
    snoozed_until: snoozedUntil,
    /** A snooze that has elapsed — surfaced so the UI can explain why the item came back. */
    snooze_expired: action?.status === 'snoozed' && Boolean(snoozedUntil) && snoozedUntil <= today,
    _isDocReminder: true,
  }
}

/** Documents whose reminder window has opened, regardless of snooze/ignore state. */
function selectDueDocuments(docs, today = todayIso()) {
  const due = []
  for (const doc of docs || []) {
    const expiryDate = toIsoDate(doc.expiry_date)
    if (!expiryDate) continue
    const reminderDate = getReminderDate(expiryDate, doc.reminder_days)
    if (!reminderDate) continue
    if (reminderDate > today) continue
    due.push(doc)
  }
  return due
}

const URGENCY_ORDER = { expired: 0, urgent: 1, 'due-soon': 2 }

function compareReminders(a, b) {
  const unread = Number(a.is_read) - Number(b.is_read)
  if (unread !== 0) return unread
  const urgency = (URGENCY_ORDER[a.urgency] ?? 3) - (URGENCY_ORDER[b.urgency] ?? 3)
  if (urgency !== 0) return urgency
  return String(a.scheduled_for || '').localeCompare(String(b.scheduled_for || ''))
}

async function listVisibleReminders({ today = todayIso() } = {}) {
  const docs = await documentExpiryService.findAll()
  const candidates = selectDueDocuments(docs, today)
  if (!candidates.length) return []

  const actions = await notificationActionsService.findByKeys(candidates.map(buildNotificationKey))

  const visible = []
  for (const doc of candidates) {
    const action = actions.get(buildNotificationKey(doc))
    if (!notificationActionsService.isActionVisible(action, today)) continue
    visible.push(mapRow(doc, action, today))
  }

  visible.sort(compareReminders)
  return visible
}

/** Mark every currently visible reminder read (used by "mark all read"). */
async function markAllRemindersRead({ userId = null } = {}) {
  const visible = await listVisibleReminders()
  const keys = visible.filter((r) => !r.is_read).map((r) => r.notification_key)
  if (!keys.length) return 0
  return notificationActionsService.markKeysRead({ keys, userId, sourceType: SOURCE_TYPE })
}

module.exports = {
  SOURCE_TYPE,
  DEFAULT_REMINDER_DAYS,
  buildNotificationKey,
  docTypeSlug,
  listVisibleReminders,
  markAllRemindersRead,
  selectDueDocuments,
  compareReminders,
  // Exported for unit tests and reuse.
  addDaysIso,
  daysBetween,
  formatDmy,
  getDaysLeft,
  getReminderDate,
  getSmartStatus,
  buildMessage,
  mapUrgency,
  normalizeReminderDays,
}
