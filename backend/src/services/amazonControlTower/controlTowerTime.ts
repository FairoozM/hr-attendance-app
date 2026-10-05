'use strict'

/** Calendar-day helpers in a marketplace's own time zone (KSA = Asia/Riyadh). */

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatterCache.set(timeZone, f)
  }
  return f
}

function zonedParts(instant: Date, timeZone: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of partsFormatter(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return out
}

/** `YYYY-MM-DD` of `instant` as seen on a wall clock in `timeZone`. */
function zonedDateString(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone)
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

function parseDateString(dateStr: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''))
  if (!m) throw new Error(`Invalid date "${dateStr}" (expected YYYY-MM-DD)`)
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

/** UTC instant of local midnight that starts `dateStr` in `timeZone`. */
function zonedDayStartUtc(dateStr: string, timeZone: string): Date {
  const { y, m, d } = parseDateString(dateStr)
  const guess = Date.UTC(y, m - 1, d)
  const first = guess - offsetMs(new Date(guess), timeZone)
  return new Date(guess - offsetMs(new Date(first), timeZone))
}

function addDays(dateStr: string, days: number): string {
  const { y, m, d } = parseDateString(dateStr)
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10)
}

function daysBetween(fromDate: string, toDate: string): number {
  const a = parseDateString(fromDate)
  const b = parseDateString(toDate)
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS)
}

/** Start of the UTC hour: one inventory/stock snapshot per hour keeps reruns idempotent. */
function hourBucket(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / HOUR_MS) * HOUR_MS)
}

module.exports = {
  DAY_MS,
  HOUR_MS,
  zonedDateString,
  zonedDayStartUtc,
  addDays,
  daysBetween,
  hourBucket,
}
