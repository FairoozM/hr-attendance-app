import { describe, expect, it } from 'vitest'
import {
  emptyStateCopy,
  filterNotifications,
  groupNotifications,
} from './notificationGrouping'
import { notificationRoute } from './notificationRouting'
import { notificationUid } from '../../types/notifications'
import type { DocumentReminder, NotificationItem, SystemNotification } from '../../types/notifications'

function reminder(
  key: string,
  urgency: DocumentReminder['urgency'],
  isRead = false
): DocumentReminder {
  return {
    id: key,
    notification_key: key,
    type: 'document_expiry',
    title: key,
    message: '',
    scheduled_for: '2026-07-25',
    is_read: isRead,
    read_at: isRead ? '2026-07-25T00:00:00.000Z' : null,
    source_type: 'document_expiry',
    source_id: '1',
    due_date: '2026-07-25',
    document_type: 'Trade License',
    company: 'Acme',
    urgency,
    days_left: 0,
    action_status: 'active',
    snoozed_until: null,
    snooze_expired: false,
    _isDocReminder: true,
  }
}

function systemItem(id: number, type = 'subscription_expiry', isRead = false): SystemNotification {
  return {
    id,
    type,
    title: `system-${id}`,
    message: '',
    is_read: isRead,
    read_at: null,
    scheduled_for: '2026-07-25',
    trigger_key: `${type}:${id}`,
  }
}

const items: NotificationItem[] = [
  reminder('expired-1', 'expired'),
  reminder('expired-2', 'expired', true),
  reminder('urgent-1', 'urgent'),
  reminder('soon-1', 'due-soon'),
  systemItem(1),
  systemItem(2, 'shop_visit_main_shop_reminder', true),
]

describe('filterNotifications', () => {
  it('returns everything for the All tab', () => {
    expect(filterNotifications(items, 'all')).toHaveLength(6)
  })

  it('returns only unread for the Unread tab', () => {
    const unread = filterNotifications(items, 'unread')
    expect(unread).toHaveLength(4)
    expect(unread.every((item) => !item.is_read)).toBe(true)
  })
})

describe('groupNotifications', () => {
  it('buckets expired and urgent reminders together, ahead of upcoming and system', () => {
    const groups = groupNotifications(items)
    expect(groups.map((g) => g.id)).toEqual(['attention', 'upcoming', 'system'])
    expect(groups[0].items.map(notificationUid)).toEqual(['expired-1', 'expired-2', 'urgent-1'])
    expect(groups[1].items.map(notificationUid)).toEqual(['soon-1'])
    expect(groups[2].items.map(notificationUid)).toEqual(['system:1', 'system:2'])
  })

  it('omits groups with no items rather than rendering an empty heading', () => {
    const groups = groupNotifications([reminder('soon-1', 'due-soon')])
    expect(groups.map((g) => g.id)).toEqual(['upcoming'])
  })

  it('returns no groups for an empty inbox', () => {
    expect(groupNotifications([])).toEqual([])
  })
})

describe('emptyStateCopy', () => {
  it('distinguishes "nothing unread" from "nothing at all"', () => {
    expect(emptyStateCopy('unread', 6).title).toBe('Nothing unread')
    expect(emptyStateCopy('unread', 6).body).toContain('6 notifications')
    expect(emptyStateCopy('all', 0).title).toBe('You are all caught up')
    expect(emptyStateCopy('unread', 0).title).toBe('You are all caught up')
  })
})

describe('notificationRoute', () => {
  it('routes each notification type to the page that can action it', () => {
    expect(notificationRoute(reminder('a', 'expired'))).toBe('/management/document-expiry')
    expect(notificationRoute(systemItem(1, 'subscription_expiry'))).toBe('/management/subscriptions')
    expect(notificationRoute(systemItem(2, 'subscription_invoice_missing'))).toBe(
      '/management/subscriptions'
    )
    expect(notificationRoute(systemItem(3, 'shop_visit_main_shop_reminder'))).toBe('/annual-leave')
  })
})

describe('notificationUid', () => {
  it('keeps reminder keys and system ids in separate namespaces', () => {
    expect(notificationUid(reminder('document_expiry:x:1:2026-01-01', 'expired'))).toBe(
      'document_expiry:x:1:2026-01-01'
    )
    expect(notificationUid(systemItem(7))).toBe('system:7')
  })
})
