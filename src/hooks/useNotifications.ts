import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  actionMetaFor,
  fetchInbox,
  ignoreNotification as apiIgnore,
  markAllNotificationsRead,
  markNotificationsRead,
  resolveNotification as apiResolve,
  restoreNotification as apiRestore,
  snoozeNotification as apiSnooze,
} from '../api/notifications'
import { isAbortError } from '../api/client'
import { EMPTY_COUNTS, isDocumentReminder, notificationUid } from '../types/notifications'
import type {
  DocumentReminder,
  NotificationCounts,
  NotificationItem,
  SystemNotification,
} from '../types/notifications'

/** Background refresh cadence while the tab is visible. Paused when hidden to avoid idle load. */
const POLL_INTERVAL_MS = 90_000
/** Ignore a poll if a fetch already completed this recently (e.g. right after a window focus). */
const MIN_REFRESH_GAP_MS = 5_000
const CHANNEL_NAME = 'hr-notifications'

export interface UseNotificationsResult {
  items: NotificationItem[]
  docReminders: DocumentReminder[]
  systemItems: SystemNotification[]
  counts: NotificationCounts
  unread: number
  loading: boolean
  /** True only for the very first load, so the panel can show skeletons instead of a spinner. */
  initialLoading: boolean
  refreshing: boolean
  error: string
  pendingKeys: ReadonlySet<string>
  refresh: (options?: { silent?: boolean }) => Promise<void>
  markRead: (item: NotificationItem) => Promise<void>
  markUnread: (item: NotificationItem) => Promise<void>
  markAllRead: () => Promise<void>
  snooze: (reminder: DocumentReminder, snoozedUntil: string) => Promise<void>
  ignore: (reminder: DocumentReminder, reason?: string) => Promise<void>
  resolve: (reminder: DocumentReminder) => Promise<void>
  /** Reverse a snooze / ignore / resolve, putting the reminder back in the inbox. */
  undo: (reminder: DocumentReminder) => Promise<void>
}

function messageFor(err: unknown, fallback: string): string {
  const message = (err as { message?: string } | null)?.message
  return message && message.trim() ? message : fallback
}

function recountUnread(items: NotificationItem[]): number {
  return items.reduce((sum, item) => sum + (item.is_read ? 0 : 1), 0)
}

/** Derive counts from the current items so optimistic updates stay internally consistent. */
function deriveCounts(items: NotificationItem[]): NotificationCounts {
  const reminders = items.filter(isDocumentReminder)
  const system = items.filter((item) => !isDocumentReminder(item))
  return {
    total: items.length,
    unread: recountUnread(items),
    documentReminders: reminders.length,
    documentRemindersUnread: recountUnread(reminders),
    system: system.length,
    systemUnread: recountUnread(system),
  }
}

function createChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(CHANNEL_NAME)
  } catch {
    return null
  }
}

/**
 * Admin notification inbox: document expiry compliance reminders plus persisted system alerts.
 *
 * Loads everything in a single request, keeps only the newest response (older in-flight requests
 * are aborted so a slow reply can never overwrite fresh data), applies actions optimistically with
 * rollback on failure, and broadcasts changes so other tabs stay in sync.
 */
export function useNotifications(enabled: boolean): UseNotificationsResult {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [counts, setCounts] = useState<NotificationCounts>(EMPTY_COUNTS)
  const [initialLoading, setInitialLoading] = useState(enabled)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set<string>())

  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const lastFetchAtRef = useRef(0)
  const channelRef = useRef<BroadcastChannel | null>(null)
  /**
   * Mirror of `items` that is updated synchronously. A `setState` updater does not run before the
   * next render, so it cannot be used to capture a rollback snapshot for an action that fails on
   * the very next microtask.
   */
  const itemsRef = useRef<NotificationItem[]>([])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  /** Single write path for items + derived counts, keeping the ref and state in step. */
  const applyItems = useCallback((next: NotificationItem[]) => {
    itemsRef.current = next
    setItems(next)
    setCounts(deriveCounts(next))
  }, [])

  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!enabled) return

      // Abort any request still in flight: only the newest response may be applied.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      if (!silent) setRefreshing(true)
      try {
        const inbox = await fetchInbox({ signal: controller.signal })
        if (!mountedRef.current || controller.signal.aborted) return
        itemsRef.current = inbox.items
        setItems(inbox.items)
        setCounts(inbox.counts)
        setError('')
        lastFetchAtRef.current = Date.now()
      } catch (err) {
        if (isAbortError(err) || controller.signal.aborted) return
        if (!mountedRef.current) return
        // Surface the failure instead of rendering an empty inbox, which reads as "all clear".
        setError(messageFor(err, 'Could not load notifications.'))
      } finally {
        if (mountedRef.current && abortRef.current === controller) {
          abortRef.current = null
          setRefreshing(false)
          setInitialLoading(false)
        }
      }
    },
    [enabled]
  )

  const refresh = useCallback(
    (options?: { silent?: boolean }) => load(options),
    [load]
  )

  /** Tell other tabs to reload; guarded so a broadcast never loops back into a broadcast. */
  const broadcast = useCallback(() => {
    try {
      channelRef.current?.postMessage({ type: 'notifications:changed' })
    } catch {
      /* channel closed — local state is still correct */
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    const channel = createChannel()
    channelRef.current = channel
    if (!channel) return undefined

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'notifications:changed') void load({ silent: true })
    }
    channel.addEventListener('message', onMessage)
    return () => {
      channel.removeEventListener('message', onMessage)
      channel.close()
      channelRef.current = null
    }
  }, [enabled, load])

  useEffect(() => {
    if (!enabled) {
      applyItems([])
      setInitialLoading(false)
      return
    }
    void load()
  }, [applyItems, enabled, load])

  // Poll while visible, and catch up immediately when the tab regains focus.
  useEffect(() => {
    if (!enabled) return undefined

    const tick = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastFetchAtRef.current < MIN_REFRESH_GAP_MS) return
      void load({ silent: true })
    }

    const timer = window.setInterval(tick, POLL_INTERVAL_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [enabled, load])

  const withPending = useCallback(
    async <T,>(key: string, run: () => Promise<T>): Promise<T> => {
      setPendingKeys((current) => new Set(current).add(key))
      try {
        return await run()
      } finally {
        if (mountedRef.current) {
          setPendingKeys((current) => {
            const next = new Set(current)
            next.delete(key)
            return next
          })
        }
      }
    },
    []
  )

  /** Optimistically apply `optimistic`, run `commit`, and restore the snapshot if it fails. */
  const runAction = useCallback(
    async (
      key: string,
      optimistic: (current: NotificationItem[]) => NotificationItem[],
      commit: () => Promise<void>
    ) => {
      const snapshot = itemsRef.current
      applyItems(optimistic(snapshot))

      try {
        await withPending(key, commit)
        broadcast()
      } catch (err) {
        if (mountedRef.current) applyItems(snapshot)
        throw err
      }
    },
    [applyItems, broadcast, withPending]
  )

  const setReadFlag = useCallback(
    (uid: string, read: boolean) => (current: NotificationItem[]) =>
      current.map((item) =>
        notificationUid(item) === uid ? ({ ...item, is_read: read } as NotificationItem) : item
      ),
    []
  )

  const setRead = useCallback(
    async (item: NotificationItem, read: boolean) => {
      if (Boolean(item.is_read) === read) return
      const uid = notificationUid(item)
      const payload = isDocumentReminder(item)
        ? { keys: [item.notification_key], read }
        : { ids: [Number(item.id)], read }

      await runAction(uid, setReadFlag(uid, read), () => markNotificationsRead(payload))
    },
    [runAction, setReadFlag]
  )

  const markRead = useCallback((item: NotificationItem) => setRead(item, true), [setRead])
  const markUnread = useCallback((item: NotificationItem) => setRead(item, false), [setRead])

  const markAllRead = useCallback(async () => {
    await runAction(
      'mark-all-read',
      (current) => current.map((item) => ({ ...item, is_read: true }) as NotificationItem),
      markAllNotificationsRead
    )
  }, [runAction])

  /** Snooze / ignore / resolve all remove the reminder from the inbox. */
  const removeReminder = useCallback(
    (reminder: DocumentReminder, commit: () => Promise<void>) =>
      runAction(
        reminder.notification_key,
        (current) =>
          current.filter(
            (item) => !(isDocumentReminder(item) && item.notification_key === reminder.notification_key)
          ),
        commit
      ),
    [runAction]
  )

  const snooze = useCallback(
    (reminder: DocumentReminder, snoozedUntil: string) =>
      removeReminder(reminder, () => apiSnooze(actionMetaFor(reminder), snoozedUntil)),
    [removeReminder]
  )

  const ignore = useCallback(
    (reminder: DocumentReminder, reason = '') =>
      removeReminder(reminder, () => apiIgnore(actionMetaFor(reminder), reason)),
    [removeReminder]
  )

  const resolve = useCallback(
    (reminder: DocumentReminder) =>
      removeReminder(reminder, () => apiResolve(actionMetaFor(reminder))),
    [removeReminder]
  )

  const undo = useCallback(
    async (reminder: DocumentReminder) => {
      await withPending(reminder.notification_key, () => apiRestore(actionMetaFor(reminder)))
      broadcast()
      await load({ silent: true })
    },
    [broadcast, load, withPending]
  )

  const docReminders = useMemo(() => items.filter(isDocumentReminder), [items])
  const systemItems = useMemo(
    () => items.filter((item): item is SystemNotification => !isDocumentReminder(item)),
    [items]
  )

  return {
    items,
    docReminders,
    systemItems,
    counts,
    unread: counts.unread,
    loading: initialLoading || refreshing,
    initialLoading,
    refreshing,
    error,
    pendingKeys,
    refresh,
    markRead,
    markUnread,
    markAllRead,
    snooze,
    ignore,
    resolve,
    undo,
  }
}
