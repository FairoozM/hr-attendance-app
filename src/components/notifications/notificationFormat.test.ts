import { describe, expect, it } from 'vitest'
import {
  addDaysIso,
  bellAriaLabel,
  daysBetween,
  formatBadge,
  isValidSnoozeDate,
  notificationSubtitle,
  notificationTitle,
  pluralize,
  relativeDayLabel,
  snoozeNote,
  snoozePresets,
  toIsoDate,
} from './notificationFormat'
import type { DocumentReminder, SystemNotification } from '../../types/notifications'

const TODAY = '2026-07-25'

function reminder(overrides: Partial<DocumentReminder> = {}): DocumentReminder {
  return {
    id: 'document_expiry:trade_license:5:2025-12-26',
    notification_key: 'document_expiry:trade_license:5:2025-12-26',
    type: 'document_expiry',
    title: 'Basmat Al Hayat General Trading LLC - 2025 (4th Qtr)',
    message: 'Expired 211 days ago — action required.',
    scheduled_for: '2025-12-26',
    is_read: false,
    read_at: null,
    source_type: 'document_expiry',
    source_id: '5',
    due_date: '2025-12-26',
    document_type: 'Trade License',
    company: 'Basmat Al Hayat General Trading LLC',
    urgency: 'expired',
    days_left: -211,
    action_status: 'active',
    snoozed_until: null,
    snooze_expired: false,
    _isDocReminder: true,
    ...overrides,
  }
}

function systemItem(overrides: Partial<SystemNotification> = {}): SystemNotification {
  return {
    id: 12,
    type: 'subscription_expiry',
    title: 'Subscription expiring soon: Figma',
    message: '3 days left (expires 2026-07-28).',
    is_read: false,
    read_at: null,
    scheduled_for: '2026-07-25',
    trigger_key: 'subscription_expiry:3:3:2026-07-28',
    ...overrides,
  }
}

describe('date helpers', () => {
  it('normalizes date-like values to ISO or null', () => {
    expect(toIsoDate('2026-07-25')).toBe('2026-07-25')
    expect(toIsoDate('2026-07-25T13:00:00.000Z')).toBe('2026-07-25')
    expect(toIsoDate(new Date(2026, 6, 25))).toBe('2026-07-25')
    expect(toIsoDate('')).toBeNull()
    expect(toIsoDate(null)).toBeNull()
    expect(toIsoDate('25/07/2026')).toBeNull()
  })

  it('counts whole calendar days regardless of DST', () => {
    expect(daysBetween(TODAY, TODAY)).toBe(0)
    expect(daysBetween(TODAY, '2026-07-26')).toBe(1)
    expect(daysBetween(TODAY, '2025-12-26')).toBe(-211)
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31)
    expect(daysBetween('nope', TODAY)).toBeNull()
  })

  it('adds days across month and year boundaries', () => {
    expect(addDaysIso('2026-07-25', 7)).toBe('2026-08-01')
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDaysIso('bad', 1)).toBeNull()
  })
})

describe('relativeDayLabel', () => {
  it('uses words for nearby days and a date for anything further out', () => {
    expect(relativeDayLabel(TODAY, TODAY)).toBe('Today')
    expect(relativeDayLabel('2026-07-26', TODAY)).toBe('Tomorrow')
    expect(relativeDayLabel('2026-07-24', TODAY)).toBe('Yesterday')
    expect(relativeDayLabel('2026-07-28', TODAY)).toBe('In 3 days')
    expect(relativeDayLabel('2026-07-20', TODAY)).toBe('5 days ago')
    expect(relativeDayLabel('2025-12-26', TODAY)).toBe('26/12/2025')
    expect(relativeDayLabel(null, TODAY)).toBe('')
  })
})

describe('row presentation', () => {
  it('builds the company · document type subtitle for reminders only', () => {
    expect(notificationSubtitle(reminder())).toBe(
      'Basmat Al Hayat General Trading LLC · Trade License'
    )
    expect(notificationSubtitle(reminder({ document_type: '' }))).toBe(
      'Basmat Al Hayat General Trading LLC'
    )
    expect(notificationSubtitle(systemItem())).toBe('')
  })

  it('falls back to a generic title when none is provided', () => {
    expect(notificationTitle(reminder())).toContain('Basmat Al Hayat')
    expect(notificationTitle(systemItem({ title: null }))).toBe('Notice')
    expect(notificationTitle(systemItem({ title: '   ' }))).toBe('Notice')
  })

  it('explains why a snoozed reminder is visible again', () => {
    expect(snoozeNote(reminder(), TODAY)).toBe('')
    expect(
      snoozeNote(reminder({ action_status: 'snoozed', snoozed_until: '2026-08-01' }), TODAY)
    ).toBe('Snoozed until 01/08/2026')
    // An elapsed snooze must say so; otherwise the item silently reappears.
    expect(
      snoozeNote(reminder({ action_status: 'snoozed', snoozed_until: '2026-07-24' }), TODAY)
    ).toBe('Snooze ended yesterday')
    expect(snoozeNote(systemItem(), TODAY)).toBe('')
  })
})

describe('snooze options', () => {
  it('offers presets that are all in the future', () => {
    const presets = snoozePresets(TODAY)
    expect(presets.map((p) => p.date)).toEqual([
      '2026-07-26',
      '2026-07-28',
      '2026-08-01',
      '2026-08-24',
    ])
    expect(presets[0].label).toBe('Tomorrow · 26/07/2026')
  })

  it('accepts today or later and rejects past or malformed dates', () => {
    expect(isValidSnoozeDate(TODAY, TODAY)).toBe(true)
    expect(isValidSnoozeDate('2026-07-26', TODAY)).toBe(true)
    expect(isValidSnoozeDate('2026-07-24', TODAY)).toBe(false)
    expect(isValidSnoozeDate('', TODAY)).toBe(false)
    expect(isValidSnoozeDate('nonsense', TODAY)).toBe(false)
  })
})

describe('badge and labels', () => {
  it('caps the badge and never renders a negative count', () => {
    expect(formatBadge(0)).toBe('0')
    expect(formatBadge(62)).toBe('62')
    expect(formatBadge(100)).toBe('99+')
    expect(formatBadge(-3)).toBe('0')
  })

  it('announces the unread count to screen readers', () => {
    expect(bellAriaLabel(0)).toBe('Notifications, none unread')
    expect(bellAriaLabel(1)).toBe('Notifications, 1 unread')
    expect(bellAriaLabel(62)).toBe('Notifications, 62 unread')
  })

  it('pluralizes counts', () => {
    expect(pluralize(1, 'notification')).toBe('1 notification')
    expect(pluralize(2, 'notification')).toBe('2 notifications')
    expect(pluralize(3, 'more', 'more')).toBe('3 more')
  })
})
