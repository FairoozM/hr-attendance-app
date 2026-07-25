import type { NotificationItem } from '../../types/notifications'
import { isDocumentReminder } from '../../types/notifications'
import { pluralize } from './notificationFormat'

export type NotificationFilter = 'all' | 'unread'

export interface NotificationGroup {
  id: string
  label: string
  items: NotificationItem[]
}

/**
 * Three scannable buckets instead of one flat list. With dozens of expired documents the old
 * single-section panel gave no sense of what actually needed attention first.
 */
const GROUP_ORDER: Array<{ id: string; label: string; match: (item: NotificationItem) => boolean }> = [
  {
    id: 'attention',
    label: 'Needs attention',
    match: (item) => isDocumentReminder(item) && (item.urgency === 'expired' || item.urgency === 'urgent'),
  },
  {
    id: 'upcoming',
    label: 'Coming up',
    match: (item) => isDocumentReminder(item) && item.urgency === 'due-soon',
  },
  {
    id: 'system',
    label: 'System alerts',
    match: (item) => !isDocumentReminder(item),
  },
]

export function filterNotifications(
  items: NotificationItem[],
  filter: NotificationFilter
): NotificationItem[] {
  if (filter === 'unread') return items.filter((item) => !item.is_read)
  return items
}

export function groupNotifications(items: NotificationItem[]): NotificationGroup[] {
  return GROUP_ORDER.flatMap(({ id, label, match }) => {
    const matched = items.filter(match)
    return matched.length ? [{ id, label, items: matched }] : []
  })
}

/** Empty-state copy that reflects why the list is empty. */
export function emptyStateCopy(
  filter: NotificationFilter,
  totalItems: number
): { title: string; body: string } {
  if (filter === 'unread' && totalItems > 0) {
    return {
      title: 'Nothing unread',
      body: `You have read all ${pluralize(totalItems, 'notification')}. Switch to All to see them again.`,
    }
  }
  return {
    title: 'You are all caught up',
    body: 'Document renewals and system alerts will appear here when they need attention.',
  }
}
