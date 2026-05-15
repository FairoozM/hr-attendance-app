import { useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'
import { PREF_NOTIFICATIONS_DISMISSED } from '../constants/userPreferenceKeys'
import { useUserPreferences } from '../contexts/UserPreferencesContext'

function dismissedArrayToSet(arr) {
  if (!Array.isArray(arr)) return new Set()
  return new Set(arr.map((id) => String(id)))
}

/**
 * Admin-only HR notifications (e.g. main shop visit reminders).
 * No-op when `enabled` is false.
 */
export function useNotifications(enabled) {
  const { ready, getPref, setPref, prefsVersion } = useUserPreferences()
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
      const dismissedIds = ready ? dismissedArrayToSet(getPref(PREF_NOTIFICATIONS_DISMISSED, [])) : new Set()
      const all = Array.isArray(list) ? list : []
      const visible = all.filter((n) => !dismissedIds.has(String(n.id)))
      setItems(visible)

      const serverUnread = typeof uc?.unread === 'number' ? uc.unread : 0
      const visibleUnread = visible.filter((n) => !n.is_read).length
      setUnread(Math.min(serverUnread, visibleUnread))
    } catch {
      setItems([])
      setUnread(0)
    } finally {
      setLoading(false)
    }
  }, [enabled, ready, getPref, prefsVersion])

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
    const cur = ready ? getPref(PREF_NOTIFICATIONS_DISMISSED, []) : []
    const base = Array.isArray(cur) ? [...cur] : []
    if (!base.includes(idStr)) base.push(idStr)
    setPref(PREF_NOTIFICATIONS_DISMISSED, base)

    const target = items.find((n) => String(n.id) === idStr)
    setItems((prev) => prev.filter((n) => String(n.id) !== idStr))
    if (target && !target.is_read) {
      setUnread((prev) => Math.max(0, prev - 1))
    }

    try {
      await api.patch(`/api/notifications/${id}/read`, {})
    } catch {
      /* keep client dismissal */
    }
  }, [items, ready, getPref, setPref])

  return { items, unread, loading, refresh: load, markRead, markAllRead, dismiss }
}
