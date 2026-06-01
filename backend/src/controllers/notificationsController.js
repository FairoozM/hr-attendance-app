const notificationsService = require('../services/notificationsService')
const notificationActionsService = require('../services/notificationActionsService')
const documentExpiryNotificationsService = require('../services/documentExpiryNotificationsService')

function parseActionMeta(body) {
  return {
    sourceType: String(body.sourceType || body.source_type || '').trim(),
    sourceId: String(body.sourceId || body.source_id || '').trim(),
    dueDate: String(body.dueDate || body.due_date || '').slice(0, 10) || null,
  }
}

async function list(req, res) {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50
    const rows = await notificationsService.listForAdmin({ limit })
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

async function markAllRead(req, res) {
  try {
    await notificationsService.markAllRead()
    res.json({ ok: true })
  } catch (err) {
    console.error('[notifications] markAllRead:', err)
    res.status(500).json({ error: 'Failed to mark all read' })
  }
}

async function snooze(req, res) {
  try {
    const key = decodeURIComponent(String(req.params.key || ''))
    const { snoozedUntil } = req.body || {}
    const meta = parseActionMeta(req.body || {})
    const row = await notificationActionsService.snooze({
      notificationKey: key,
      snoozedUntil,
      userId: req.user?.id ?? null,
      ...meta,
    })
    res.json(row)
  } catch (err) {
    console.error('[notifications] snooze:', err)
    res.status(400).json({ error: err.message || 'Failed to snooze notification' })
  }
}

async function ignoreNotification(req, res) {
  try {
    const key = decodeURIComponent(String(req.params.key || ''))
    const reason = String(req.body?.reason || '').trim()
    const meta = parseActionMeta(req.body || {})
    const row = await notificationActionsService.ignore({
      notificationKey: key,
      userId: req.user?.id ?? null,
      reason,
      ...meta,
    })
    res.json(row)
  } catch (err) {
    console.error('[notifications] ignore:', err)
    res.status(400).json({ error: err.message || 'Failed to ignore notification' })
  }
}

async function resolveNotification(req, res) {
  try {
    const key = decodeURIComponent(String(req.params.key || ''))
    const meta = parseActionMeta(req.body || {})
    const row = await notificationActionsService.resolve({
      notificationKey: key,
      userId: req.user?.id ?? null,
      ...meta,
    })
    res.json(row)
  } catch (err) {
    console.error('[notifications] resolve:', err)
    res.status(400).json({ error: err.message || 'Failed to resolve notification' })
  }
}

module.exports = {
  list,
  unreadCount,
  markRead,
  markAllRead,
  snooze,
  ignoreNotification,
  resolveNotification,
}
