import { useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'

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
      setItems(Array.isArray(list) ? list : [])
      setUnread(typeof uc?.unread === 'number' ? uc.unread : 0)
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

  const dismiss = useCallback((id) => {
    setItems((prev) => prev.filter((n) => n.id !== id))
    setUnread((prev) => Math.max(0, prev - 1))
  }, [])

  return { items, unread, loading, refresh: load, markRead, markAllRead, dismiss }
}
