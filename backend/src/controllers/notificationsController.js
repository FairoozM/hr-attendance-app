const notificationsService = require('../services/notificationsService')
const notificationActionsService = require('../services/notificationActionsService')
const documentExpiryNotificationsService = require('../services/documentExpiryNotificationsService')

/**
 * Express has already percent-decoded `req.params`, so the previous extra `decodeURIComponent`
 * threw a URIError (surfacing as a confusing 400) for any key containing a literal `%`.
 * Prefer the body value, which needs no decoding at all.
 */
function readNotificationKey(req) {
  const fromBody = req.body?.notificationKey ?? req.body?.notification_key
  if (fromBody) return String(fromBody).trim()
  return String(req.params?.key || '').trim()
}

function parseActionMeta(body = {}) {
  return {
    sourceType: String(body.sourceType || body.source_type || '').trim(),
    sourceId: String(body.sourceId || body.source_id || '').trim(),
    dueDate: notificationActionsService.toIsoDate(body.dueDate || body.due_date),
  }
}

function toArray(value) {
  if (Array.isArray(value)) return value
  if (value == null || value === '') return []
  return [value]
}

/** Single round trip for the notification pane: items + the counts the badge/tabs need. */
async function inbox(req, res) {
  try {
    const data = await notificationsService.getInbox({ limit: req.query.limit })
    res.json(data)
  } catch (err) {
    console.error('[notifications] inbox:', err)
    res.status(500).json({ error: 'Failed to load notifications' })
  }
}

async function list(req, res) {
  try {
    const rows = await notificationsService.listForAdmin({ limit: req.query.limit })
    res.json(rows)
  } catch (err) {
    console.error('[notifications] list:', err)
    res.status(500).json({ error: 'Failed to load notifications' })
  }
}

async function unreadCount(req, res) {
  try {
    const count = await notificationsService.unreadCountForAdmin()
    res.json({ unread: count })
  } catch (err) {
    console.error('[notifications] unreadCount:', err)
    res.status(500).json({ error: 'Failed to load unread count' })
  }
}

async function markRead(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const row = await notificationsService.markRead(id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    res.json(row)
  } catch (err) {
    console.error('[notifications] markRead:', err)
    res.status(500).json({ error: 'Failed to update notification' })
  }
}

/**
 * Mark a mixed batch read or unread. Persisted notifications are addressed by numeric `ids`,
 * dynamic document reminders by their notification `keys`.
 */
async function markMany(req, res) {
  try {
    const body = req.body || {}
    const read = body.read === undefined ? true : Boolean(body.read)
    const result = await notificationsService.markManyRead({
      ids: toArray(body.ids),
      keys: toArray(body.keys),
      userId: req.user?.id ?? null,
      read,
    })
    res.json({ ok: true, read, ...result })
  } catch (err) {
    console.error('[notifications] markMany:', err)
    res.status(500).json({ error: 'Failed to update notifications' })
  }
}

async function markAllRead(req, res) {
  try {
    const result = await notificationsService.markAllRead({ userId: req.user?.id ?? null })
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[notifications] markAllRead:', err)
    res.status(500).json({ error: 'Failed to mark all read' })
  }
}

function actionHandler(label, run) {
  return async function handle(req, res) {
    try {
      const notificationKey = readNotificationKey(req)
      if (!notificationKey) return res.status(400).json({ error: 'notificationKey is required' })
      const row = await run({
        notificationKey,
        userId: req.user?.id ?? null,
        body: req.body || {},
        ...parseActionMeta(req.body || {}),
      })
      res.json(row)
    } catch (err) {
      console.error(`[notifications] ${label}:`, err)
      res.status(400).json({ error: err.message || `Failed to ${label} notification` })
    }
  }
}

const snooze = actionHandler('snooze', ({ body, ...rest }) =>
  notificationActionsService.snooze({ ...rest, snoozedUntil: body.snoozedUntil || body.snoozed_until })
)

const ignoreNotification = actionHandler('ignore', ({ body, ...rest }) =>
  notificationActionsService.ignore({ ...rest, reason: String(body.reason || '').trim() })
)

const resolveNotification = actionHandler('resolve', ({ body: _body, ...rest }) =>
  notificationActionsService.resolve(rest)
)

/** Undo a snooze / ignore / resolve so the reminder returns to the inbox. */
const reactivateNotification = actionHandler('restore', ({ body: _body, ...rest }) =>
  notificationActionsService.reactivate({
    ...rest,
    sourceType: rest.sourceType || documentExpiryNotificationsService.SOURCE_TYPE,
  })
)

module.exports = {
  inbox,
  list,
  unreadCount,
  markRead,
  markMany,
  markAllRead,
  snooze,
  ignoreNotification,
  resolveNotification,
  reactivateNotification,
}
