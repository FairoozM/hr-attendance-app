import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentReminder, NotificationInbox, SystemNotification } from '../types/notifications'

const fetchInbox = vi.fn()
const markNotificationsRead = vi.fn()
const markAllNotificationsRead = vi.fn()
const snoozeNotification = vi.fn()
const ignoreNotification = vi.fn()
const resolveNotification = vi.fn()
const restoreNotification = vi.fn()

vi.mock('../api/notifications', async () => {
  const actual = await vi.importActual<typeof import('../api/notifications')>('../api/notifications')
  return {
    ...actual,
    fetchInbox: (...args: unknown[]) => fetchInbox(...args),
    markNotificationsRead: (...args: unknown[]) => markNotificationsRead(...args),
    markAllNotificationsRead: (...args: unknown[]) => markAllNotificationsRead(...args),
    snoozeNotification: (...args: unknown[]) => snoozeNotification(...args),
    ignoreNotification: (...args: unknown[]) => ignoreNotification(...args),
    resolveNotification: (...args: unknown[]) => resolveNotification(...args),
    restoreNotification: (...args: unknown[]) => restoreNotification(...args),
  }
})

const { useNotifications } = await import('./useNotifications')

function reminder(key: string, isRead = false): DocumentReminder {
  return {
    id: key,
    notification_key: key,
    type: 'document_expiry',
    title: key,
    message: 'Expired 211 days ago — action required.',
    scheduled_for: '2025-12-26',
    is_read: isRead,
    read_at: null,
    source_type: 'document_expiry',
    source_id: '5',
    due_date: '2025-12-26',
    document_type: 'Trade License',
    company: 'Acme',
    urgency: 'expired',
    days_left: -211,
    action_status: 'active',
    snoozed_until: null,
    snooze_expired: false,
    _isDocReminder: true,
  }
}

function systemItem(id: number, isRead = false): SystemNotification {
  return {
    id,
    type: 'subscription_expiry',
    title: `system-${id}`,
    message: 'Expires soon.',
    is_read: isRead,
    read_at: null,
    scheduled_for: '2026-07-25',
    trigger_key: `subscription_expiry:${id}`,
  }
}

function inbox(items: Array<DocumentReminder | SystemNotification>): NotificationInbox {
  const reminders = items.filter((i) => 'notification_key' in i) as DocumentReminder[]
  const system = items.filter((i) => !('notification_key' in i)) as SystemNotification[]
  const unread = items.filter((i) => !i.is_read).length
  return {
    items,
    counts: {
      total: items.length,
      unread,
      documentReminders: reminders.length,
      documentRemindersUnread: reminders.filter((r) => !r.is_read).length,
      system: system.length,
      systemUnread: system.filter((s) => !s.is_read).length,
    },
    limit: 60,
    generatedAt: '2026-07-25T08:00:00.000Z',
    today: '2026-07-25',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchInbox.mockResolvedValue(inbox([reminder('doc-a'), reminder('doc-b'), systemItem(1)]))
  markNotificationsRead.mockResolvedValue(undefined)
  markAllNotificationsRead.mockResolvedValue(undefined)
  snoozeNotification.mockResolvedValue(undefined)
  ignoreNotification.mockResolvedValue(undefined)
  restoreNotification.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useNotifications', () => {
  it('loads the inbox in a single request and splits reminders from system alerts', async () => {
    const { result } = renderHook(() => useNotifications(true))

    await waitFor(() => expect(result.current.initialLoading).toBe(false))

    expect(fetchInbox).toHaveBeenCalledTimes(1)
    expect(result.current.items).toHaveLength(3)
    expect(result.current.docReminders).toHaveLength(2)
    expect(result.current.systemItems).toHaveLength(1)
    expect(result.current.unread).toBe(3)
    expect(result.current.error).toBe('')
  })

  it('does not fetch at all when disabled', async () => {
    const { result } = renderHook(() => useNotifications(false))
    await waitFor(() => expect(result.current.initialLoading).toBe(false))
    expect(fetchInbox).not.toHaveBeenCalled()
    expect(result.current.items).toEqual([])
  })

  it('surfaces a load failure instead of rendering an empty inbox', async () => {
    fetchInbox.mockRejectedValueOnce(new Error('API server unreachable'))
    const { result } = renderHook(() => useNotifications(true))

    await waitFor(() => expect(result.current.error).toBe('API server unreachable'))
    expect(result.current.items).toEqual([])

    // Retrying recovers and clears the error banner.
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.error).toBe('')
    expect(result.current.items).toHaveLength(3)
  })

  it('marks a reminder read by key and a system alert by id', async () => {
    const { result } = renderHook(() => useNotifications(true))
    await waitFor(() => expect(result.current.initialLoading).toBe(false))

    await act(async () => {
      await result.current.markRead(result.current.docReminders[0])
    })
    expect(markNotificationsRead).toHaveBeenCalledWith({ keys: ['doc-a'], read: true })
    expect(result.current.unread).toBe(2)

    await act(async () => {
      await result.current.markRead(result.current.systemItems[0])
    })
    expect(markNotificationsRead).toHaveBeenCalledWith({ ids: [1], read: true })
    expect(result.current.unread).toBe(1)
  })

  it('supports marking an item unread again', async () => {
    fetchInbox.mockResolvedValue(inbox([reminder('doc-a', true)]))
    const { result } = renderHook(() => useNotifications(true))
    await waitFor(() => expect(result.current.initialLoading).toBe(false))
    expect(result.current.unread).toBe(0)

    await act(async () => {
      await result.current.markUnread(result.current.docReminders[0])
    })
    expect(markNotificationsRead).toHaveBeenCalledWith({ keys: ['doc-a'], read: false })
    expect(result.current.unread).toBe(1)
  })

  it('skips the request when the read state already matches', async () => {
    fetchInbox.mockResolvedValue(inbox([reminder('doc-a', true)]))
    const { result } = renderHook(() => useNotifications(true))
    await waitFor(() => expect(result.current.initialLoading).toBe(false))

    await act(async () => {
      await result.current.markRead(result.current.docReminders[0])
    })
    expect(markNotificationsRead).not.toHaveBeenCalled()
  })

  it('clears the badge when marking everything read', async () => {
    const { result } = renderHook(() => useNotifications(true))
    await waitFor(() => expect(result.current.initialLoading).toBe(false))
    expect(result.current.unread).toBe(3)

    await act(async () => {
      await result.current.markAllRead()
    })

    expect(markAllNotificationsRead).toHaveBeenCalledTimes(1)
    expect(result.current.unread).toBe(0)
    expect(result.current.items).toHaveLength(3)
    expect(result.current.items.every((item) => item.is_read)).toBe(true)
  })

  it('removes a snoozed reminder optimistically', async () => {
    const { result } = renderHook(() => useNotifications(true))
    await waitFor(() => expect(result.current.initialLoading).toBe(false))

    await act(async () => {
      await result.current.snooze(result.current.docReminders[0], '2026-08-01')
    })

    expect(snoozeNotification).toHaveBeenCalledWith(
      expect.objectContaining({ notificationKey: 'doc-a' }),
      '2026-08-01'
    )
    expect(result.current.docReminders.map((r) => r.notification_key)).toEqual(['doc-b'])
    expect(result.current.unread).toBe(2)
  })

  it('restores the previous list when an action fails', async () => {
    ignoreNotification.mockRejectedValueOnce(new Error('Server said no'))
    const { result } = renderHook(() => useNotifications(true))
    await waitFor(() => expect(result.current.initialLoading).toBe(false))

    await act(async () => {
      await expect(result.current.ignore(result.current.docReminders[0])).rejects.toThrow(
        'Server said no'
      )
    })

    // The optimistic removal is rolled back, so the badge and list stay truthful.
    expect(result.current.docReminders.map((r) => r.notification_key)).toEqual(['doc-a', 'doc-b'])
    expect(result.current.unread).toBe(3)
  })

  it('undo restores the reminder and reloads', async () => {
    const { result } = renderHook(() => useNotifications(true))
    await waitFor(() => expect(result.current.initialLoading).toBe(false))
    const target = result.current.docReminders[0]

    await act(async () => {
      await result.current.snooze(target, '2026-08-01')
    })
    expect(result.current.docReminders).toHaveLength(1)

    await act(async () => {
      await result.current.undo(target)
    })

    expect(restoreNotification).toHaveBeenCalledWith(
      expect.objectContaining({ notificationKey: 'doc-a' })
    )
    expect(result.current.docReminders).toHaveLength(2)
  })

  it('applies only the newest response when refreshes overlap', async () => {
    let resolveSlow: ((value: NotificationInbox) => void) | null = null
    const slow = new Promise<NotificationInbox>((resolve) => {
      resolveSlow = resolve
    })

    fetchInbox.mockReset()
    // First call hangs; the second resolves immediately with fresher data.
    fetchInbox
      .mockImplementationOnce(() => slow)
      .mockResolvedValue(inbox([reminder('fresh')]))

    const { result } = renderHook(() => useNotifications(true))

    await act(async () => {
      await result.current.refresh()
    })

    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(result.current.docReminders[0].notification_key).toBe('fresh')

    // The stale response arrives last but must not overwrite the newer state.
    await act(async () => {
      resolveSlow?.(inbox([reminder('stale-a'), reminder('stale-b'), reminder('stale-c')]))
      await slow
    })

    expect(result.current.docReminders.map((r) => r.notification_key)).toEqual(['fresh'])
  })

  it('tracks in-flight actions so rows can be disabled', async () => {
    let release: (() => void) | null = null
    markNotificationsRead.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )

    const { result } = renderHook(() => useNotifications(true))
    await waitFor(() => expect(result.current.initialLoading).toBe(false))

    let pending: Promise<void> | null = null
    act(() => {
      pending = result.current.markRead(result.current.docReminders[0])
    })

    await waitFor(() => expect(result.current.pendingKeys.has('doc-a')).toBe(true))

    await act(async () => {
      release?.()
      await pending
    })

    expect(result.current.pendingKeys.has('doc-a')).toBe(false)
  })
})
