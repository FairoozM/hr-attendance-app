/** Shared shapes for the admin notification pane (`GET /api/notifications/inbox`). */

export type NotificationUrgency = 'expired' | 'urgent' | 'due-soon'

export type NotificationActionStatus = 'active' | 'snoozed' | 'resolved' | 'ignored'

/** Dynamic compliance reminder computed from `document_expiry`; addressed by `notification_key`. */
export interface DocumentReminder {
  id: string
  notification_key: string
  type: 'document_expiry'
  title: string
  message: string
  scheduled_for: string | null
  is_read: boolean
  read_at: string | null
  source_type: string
  source_id: string
  due_date: string | null
  document_type: string
  company: string
  urgency: NotificationUrgency
  days_left: number | null
  action_status: NotificationActionStatus
  snoozed_until: string | null
  snooze_expired: boolean
  _isDocReminder: true
}

/** Persisted row from the `notifications` table; addressed by numeric id. */
export interface SystemNotification {
  id: number
  type: string
  title: string | null
  message: string
  is_read: boolean
  read_at: string | null
  scheduled_for: string | null
  trigger_key: string
  meta?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export type NotificationItem = DocumentReminder | SystemNotification

export interface NotificationCounts {
  total: number
  unread: number
  documentReminders: number
  documentRemindersUnread: number
  system: number
  systemUnread: number
}

export interface NotificationInbox {
  items: NotificationItem[]
  counts: NotificationCounts
  limit: number
  generatedAt: string
  today: string
}

export function isDocumentReminder(item: NotificationItem | null | undefined): item is DocumentReminder {
  if (!item) return false
  const candidate = item as Partial<DocumentReminder>
  return candidate.type === 'document_expiry' || candidate._isDocReminder === true
}

/** Stable identity across both kinds, safe to use as a React key or in a Set. */
export function notificationUid(item: NotificationItem): string {
  return isDocumentReminder(item) ? item.notification_key : `system:${item.id}`
}

export const EMPTY_COUNTS: NotificationCounts = {
  total: 0,
  unread: 0,
  documentReminders: 0,
  documentRemindersUnread: 0,
  system: 0,
  systemUnread: 0,
}
