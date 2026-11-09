/** Calendar helpers for attendance. All dates are plain calendar days in the business time zone. */

export const BUSINESS_TIME_ZONE = 'Asia/Dubai'

export interface CalendarDate {
  year: number
  /** 0 = January */
  month: number
  day: number
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Today's calendar date in the business time zone, independent of the browser's zone. */
export function businessToday(now: Date = new Date(), timeZone: string = BUSINESS_TIME_ZONE): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { year: get('year'), month: get('month') - 1, day: get('day') }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

export function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month, date.day)).getUTCDay()
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day
}

export function isSameDate(a: CalendarDate, b: CalendarDate): boolean {
  return compareDates(a, b) === 0
}

export function isSameMonth(a: { year: number; month: number }, b: { year: number; month: number }): boolean {
  return a.year === b.year && a.month === b.month
}

export function addDays(date: CalendarDate, delta: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month, date.day + delta))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() }
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + month + delta
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 }
}

/** Keeps the day valid for the target month (31 Jan → 28/29 Feb). */
export function clampToMonth(year: number, month: number, day: number): CalendarDate {
  const max = daysInMonth(year, month)
  const safeDay = Number.isFinite(day) ? Math.min(Math.max(1, Math.floor(day)), max) : 1
  return { year, month, day: safeDay }
}

export function toIsoDate(date: CalendarDate): string {
  return `${date.year}-${String(date.month + 1).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

/** Parses `YYYY-MM-DD` (or the date part of an ISO timestamp) without any time-zone conversion. */
export function parseIsoDate(value: unknown): CalendarDate | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const date = { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) }
  if (date.month < 0 || date.month > 11 || date.day < 1 || date.day > daysInMonth(date.year, date.month)) return null
  return date
}

/** `9 Nov 2026`, or `Mon, 9 Nov 2026` with `weekday`. */
export function formatDate(date: CalendarDate, options: { weekday?: boolean; year?: boolean } = {}): string {
  const { weekday = false, year = true } = options
  const base = `${date.day} ${MONTH_SHORT[date.month]}${year ? ` ${date.year}` : ''}`
  return weekday ? `${WEEKDAY_SHORT[weekdayOf(date)]}, ${base}` : base
}

export function formatMonth(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`
}

/**
 * Employee profile `weekly_off_day` is stored as a lowercase weekday name (`friday`).
 * Numeric strings 0–6 are accepted for older rows. Anything else means "not set".
 */
export function parseWeeklyOffDay(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 6 ? value : null
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  if (!text) return null
  if (/^[0-6]$/.test(text)) return Number(text)
  const index = WEEKDAY_NAMES.findIndex((name) => name.toLowerCase() === text || name.slice(0, 3).toLowerCase() === text)
  return index >= 0 ? index : null
}
