import { fmtDMY } from '../../utils/dateFormat'
import type { NotificationItem, NotificationUrgency } from '../../types/notifications'
import { isDocumentReminder } from '../../types/notifications'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export const URGENCY_LABEL: Record<NotificationUrgency, string> = {
  expired: 'Expired',
  urgent: 'Urgent',
  'due-soon': 'Due soon',
}

/** Calendar-day arithmetic on ISO dates, immune to timezone offsets and DST. */
function isoToUtcMs(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return Number.NaN
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

export function toIsoDate(value: unknown): string | null {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const iso = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null
}

export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDaysIso(iso: string, delta: number): string | null {
  const base = isoToUtcMs(iso)
  if (Number.isNaN(base)) return null
  return new Date(base + delta * MS_PER_DAY).toISOString().slice(0, 10)
}

export function daysBetween(fromIso: string, toIso: string): number | null {
  const from = isoToUtcMs(fromIso)
  const to = isoToUtcMs(toIso)
  if (Number.isNaN(from) || Number.isNaN(to)) return null
  return Math.round((to - from) / MS_PER_DAY)
}

/** "Today" / "Yesterday" / "In 3 days" / "12 Jul" — the date phrasing users scan for. */
export function relativeDayLabel(value: unknown, today: string = todayIso()): string {
  const iso = toIsoDate(value)
  if (!iso) return ''
  const diff = daysBetween(today, iso)
  if (diff === null) return ''
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 1 && diff <= 7) return `In ${diff} days`
  if (diff < -1 && diff >= -7) return `${Math.abs(diff)} days ago`
  return fmtDMY(iso)
}

/** Short bucket label used to group the inbox into scannable sections. */
export function urgencyBucket(item: NotificationItem): NotificationUrgency | 'system' {
  return isDocumentReminder(item) ? item.urgency : 'system'
}

export function notificationSubtitle(item: NotificationItem): string {
  if (!isDocumentReminder(item)) return ''
  return [item.company, item.document_type].filter(Boolean).join(' · ')
}

export function notificationTitle(item: NotificationItem): string {
  const title = String(item.title || '').trim()
  return title || 'Notice'
}

/**
 * Why a snoozed reminder is back in the list. Without this the item silently reappears and looks
 * like the snooze never worked.
 */
export function snoozeNote(item: NotificationItem, today: string = todayIso()): string {
  if (!isDocumentReminder(item)) return ''
  if (item.action_status !== 'snoozed' || !item.snoozed_until) return ''
  const until = toIsoDate(item.snoozed_until)
  if (!until) return ''
  if (until <= today) return `Snooze ended ${relativeDayLabel(until, today).toLowerCase()}`
  return `Snoozed until ${fmtDMY(until)}`
}

export interface SnoozePreset {
  id: string
  label: string
  date: string
}

/** Preset snooze targets, computed from an injectable "today" so they are testable. */
export function snoozePresets(today: string = todayIso()): SnoozePreset[] {
  const presets: Array<{ id: string; label: string; days: number }> = [
    { id: 'tomorrow', label: 'Tomorrow', days: 1 },
    { id: '3-days', label: 'In 3 days', days: 3 },
    { id: 'next-week', label: 'Next week', days: 7 },
    { id: 'next-month', label: 'In 30 days', days: 30 },
  ]
  return presets.flatMap(({ id, label, days }) => {
    const date = addDaysIso(today, days)
    return date ? [{ id, label: `${label} · ${fmtDMY(date)}`, date }] : []
  })
}

export function isValidSnoozeDate(value: string, today: string = todayIso()): boolean {
  const iso = toIsoDate(value)
  return Boolean(iso) && (iso as string) >= today
}

/** Accessible bell label — screen readers otherwise get no hint about the badge. */
export function bellAriaLabel(unread: number): string {
  if (unread <= 0) return 'Notifications, none unread'
  return `Notifications, ${unread} unread`
}

export function formatBadge(unread: number): string {
  if (unread > 99) return '99+'
  return String(Math.max(0, unread))
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
