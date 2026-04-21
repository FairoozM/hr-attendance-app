import { useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'

const DISMISSED_NOTIFICATIONS_KEY = 'hr-dismissed-notification-ids-v1'

function loadDismissedIds() {
  try {
    const raw = localStorage.getItem(DISMISSED_NOTIFICATIONS_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.map((id) => String(id)))
  } catch {
    return new Set()
  }
}

function saveDismissedIds(ids) {
  try {
    localStorage.setItem(DISMISSED_NOTIFICATIONS_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    // ignore storage failures
  }
}

/**
 * Admin-only HR notifications (e.g. main shop visit reminders).
 * No-op when `enabled` is false.
 */
export function useNotifications(enabled) {
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const [list, uc] = await Promise.all([
        api.get('/api/notifications?limit=40'),
        api.get('/api/notifications/unread-count'),
      ])
      const dismissedIds = loadDismissedIds()
      const all = Array.isArray(list) ? list : []
      const visible = all.filter((n) => !dismissedIds.has(String(n.id)))
      setItems(visible)

      // Keep badge consistent with what is actually visible in this panel.
      const serverUnread = typeof uc?.unread === 'number' ? uc.unread : 0
      const visibleUnread = visible.filter((n) => !n.is_read).length
      setUnread(Math.min(serverUnread, visibleUnread))
    } catch {
      setItems([])
      setUnread(0)
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    load()
  }, [load])

  const markRead = useCallback(
    async (id) => {
      if (!enabled) return
      await api.patch(`/api/notifications/${id}/read`, {})
      await load()
    },
    [enabled, load]
  )

  const markAllRead = useCallback(async () => {
    if (!enabled) return
    await api.post('/api/notifications/mark-all-read', {})
    await load()
  }, [enabled, load])

  const dismiss = useCallback(async (id) => {
    const idStr = String(id)
    const dismissedIds = loadDismissedIds()
    dismissedIds.add(idStr)
    saveDismissedIds(dismissedIds)

    const target = items.find((n) => String(n.id) === idStr)
    setItems((prev) => prev.filter((n) => String(n.id) !== idStr))
    if (target && !target.is_read) {
      setUnread((prev) => Math.max(0, prev - 1))
    }

    // Persist dismissal server-side as read so it doesn't return as unread.
    try {
      await api.patch(`/api/notifications/${id}/read`, {})
    } catch {
      // keep local dismissal even if network update fails
    }
  }, [items])

  return { items, unread, loading, refresh: load, markRead, markAllRead, dismiss }
}
