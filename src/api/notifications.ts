import { api } from './client'
import { EMPTY_COUNTS } from '../types/notifications'
import type {
  DocumentReminder,
  NotificationCounts,
  NotificationInbox,
  NotificationItem,
} from '../types/notifications'

const BASE = '/api/notifications'

interface ActionMeta {
  notificationKey: string
  sourceType?: string
  sourceId?: string
  dueDate?: string | null
}

function coerceCounts(raw: unknown): NotificationCounts {
  const value = (raw ?? {}) as Partial<NotificationCounts>
  const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  return {
    total: num(value.total),
    unread: num(value.unread),
    documentReminders: num(value.documentReminders),
    documentRemindersUnread: num(value.documentRemindersUnread),
    system: num(value.system),
    systemUnread: num(value.systemUnread),
  }
}

/** Meta the server needs to create an action row for a reminder that has no persisted row yet. */
export function actionMetaFor(reminder: DocumentReminder): ActionMeta {
  return {
    notificationKey: reminder.notification_key,
    sourceType: reminder.source_type,
    sourceId: reminder.source_id,
    dueDate: reminder.due_date ?? reminder.scheduled_for ?? null,
  }
}

export async function fetchInbox(
  { limit = 60, signal }: { limit?: number; signal?: AbortSignal } = {}
): Promise<NotificationInbox> {
  const raw = (await api.get(`${BASE}/inbox?limit=${limit}`, { signal })) as Partial<NotificationInbox>
  const items = Array.isArray(raw?.items) ? (raw.items as NotificationItem[]) : []
  return {
    items,
    counts: raw?.counts ? coerceCounts(raw.counts) : EMPTY_COUNTS,
    limit: typeof raw?.limit === 'number' ? raw.limit : limit,
    generatedAt: raw?.generatedAt || new Date().toISOString(),
    today: raw?.today || '',
  }
}

/** Mark a mixed batch read/unread: persisted rows by id, dynamic reminders by key. */
export async function markNotificationsRead(
  { ids = [], keys = [], read = true }: { ids?: number[]; keys?: string[]; read?: boolean }
): Promise<void> {
  if (!ids.length && !keys.length) return
  await api.post(`${BASE}/mark-read`, { ids, keys, read })
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post(`${BASE}/mark-all-read`, {})
}

export async function snoozeNotification(meta: ActionMeta, snoozedUntil: string): Promise<void> {
  await api.post(`${BASE}/snooze`, { ...meta, snoozedUntil })
}

export async function ignoreNotification(meta: ActionMeta, reason = ''): Promise<void> {
  await api.post(`${BASE}/ignore`, { ...meta, reason })
}

export async function resolveNotification(meta: ActionMeta): Promise<void> {
  await api.post(`${BASE}/resolve`, meta)
}

/** Undo a snooze / ignore / resolve. */
export async function restoreNotification(meta: ActionMeta): Promise<void> {
  await api.post(`${BASE}/restore`, meta)
}
