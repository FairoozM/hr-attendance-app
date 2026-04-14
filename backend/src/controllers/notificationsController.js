const notificationsService = require('../services/notificationsService')

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

module.exports = { list, unreadCount, markRead, markAllRead }
