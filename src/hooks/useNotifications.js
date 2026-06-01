import { useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'
import { PREF_NOTIFICATIONS_DISMISSED } from '../constants/userPreferenceKeys'
import { useUserPreferences } from '../contexts/UserPreferencesContext'

function dismissedArrayToSet(arr) {
  if (!Array.isArray(arr)) return new Set()
  return new Set(arr.map((id) => String(id)))
}

function isDocReminder(n) {
  return n?.type === 'document_expiry' || n?._isDocReminder === true
}

function encodeNotificationKey(key) {
  return encodeURIComponent(String(key || ''))
}

/**
 * Admin-only HR notifications (shop visit reminders + document expiry compliance).
 * No-op when `enabled` is false.
 */
export function useNotifications(enabled) {
  const { ready, getPref, setPref, prefsVersion } = useUserPreferences()
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [actionLoadingKey, setActionLoadingKey] = useState(null)

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
      const visible = all.filter((n) => isDocReminder(n) || !dismissedIds.has(String(n.id)))
      setItems(visible)

      const serverUnread = typeof uc?.unread === 'number' ? uc.unread : 0
      const hiddenUnread = all.filter(
        (n) => !isDocReminder(n) && dismissedIds.has(String(n.id)) && !n.is_read
      ).length
      setUnread(Math.max(0, serverUnread - hiddenUnread))
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

  const snooze = useCallback(async (notification, snoozedUntil) => {
    if (!enabled || !notification?.notification_key) return null
    const key = notification.notification_key
    setActionLoadingKey(key)
    try {
      await api.post(`/api/notifications/${encodeNotificationKey(key)}/snooze`, {
        snoozedUntil,
        sourceType: notification.source_type,
        sourceId: notification.source_id,
        dueDate: notification.due_date || notification.scheduled_for,
      })
      setItems((prev) => prev.filter((n) => n.notification_key !== key))
      setUnread((prev) => Math.max(0, prev - 1))
      return snoozedUntil
    } finally {
      setActionLoadingKey(null)
    }
  }, [enabled])

  const ignoreNotification = useCallback(async (notification, reason = '') => {
    if (!enabled || !notification?.notification_key) return null
    const key = notification.notification_key
    setActionLoadingKey(key)
    try {
      await api.post(`/api/notifications/${encodeNotificationKey(key)}/ignore`, {
        reason,
        sourceType: notification.source_type,
        sourceId: notification.source_id,
        dueDate: notification.due_date || notification.scheduled_for,
      })
      setItems((prev) => prev.filter((n) => n.notification_key !== key))
      setUnread((prev) => Math.max(0, prev - 1))
      return true
    } finally {
      setActionLoadingKey(null)
    }
  }, [enabled])

  const resolveNotification = useCallback(async (notification) => {
    if (!enabled || !notification?.notification_key) return null
    const key = notification.notification_key
    setActionLoadingKey(key)
    try {
      await api.post(`/api/notifications/${encodeNotificationKey(key)}/resolve`, {
        sourceType: notification.source_type,
        sourceId: notification.source_id,
        dueDate: notification.due_date || notification.scheduled_for,
      })
      setItems((prev) => prev.filter((n) => n.notification_key !== key))
      setUnread((prev) => Math.max(0, prev - 1))
      return true
    } finally {
      setActionLoadingKey(null)
    }
  }, [enabled])

  const docReminders = items.filter(isDocReminder)
  const systemItems = items.filter((n) => !isDocReminder(n))

  return {
    items,
    docReminders,
    systemItems,
    unread,
    loading,
    actionLoadingKey,
    refresh: load,
    markRead,
    markAllRead,
    dismiss,
    snooze,
    ignoreNotification,
    resolveNotification,
  }
}
