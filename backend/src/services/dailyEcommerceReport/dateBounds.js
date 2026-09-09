'use strict'

/**
 * UAE (Asia/Dubai) calendar-day boundaries for the Daily Ecommerce Report.
 * All channels use Dubai local midnight, per report requirements.
 */

const IANA_UAE = 'Asia/Dubai'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function pad2(n) {
  return String(n).padStart(2, '0')
}

function ymdInTimeZone(date, ianaKey = IANA_UAE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ianaKey,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const m = {}
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = p.value
  }
  return `${m.year}-${m.month}-${m.day}`
}

function todayUaeYmd(now = new Date()) {
  return ymdInTimeZone(now, IANA_UAE)
}

/**
 * Parse YYYY-MM-DD or throw.
 * @param {string} dateStr
 */
function assertYmd(dateStr) {
  const s = String(dateStr || '').trim()
  if (!DATE_RE.test(s)) {
    const err = new Error('date must be YYYY-MM-DD')
    err.code = 'BAD_REQUEST'
    throw err
  }
  const [y, mo, d] = s.split('-').map(Number)
  const check = new Date(Date.UTC(y, mo - 1, d))
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d
  ) {
    const err = new Error('date is not a valid calendar day')
    err.code = 'BAD_REQUEST'
    throw err
  }
  return s
}

/**
 * Dubai local midnight → UTC Date for [start, end) half-open range.
 * UAE does not observe DST; offset is fixed +04:00.
 */
function dubaiDayBounds(dateYmd) {
  const ymd = assertYmd(dateYmd)
  const [y, mo, d] = ymd.split('-').map(Number)
  const start = new Date(`${y}-${pad2(mo)}-${pad2(d)}T00:00:00.000+04:00`)
  const noon = new Date(`${y}-${pad2(mo)}-${pad2(d)}T12:00:00.000+04:00`)
  const next = new Date(noon.getTime() + 86400000)
  const nextYmd = ymdInTimeZone(next, IANA_UAE)
  const [y2, m2, d2] = nextYmd.split('-').map(Number)
  const end = new Date(`${y2}-${pad2(m2)}-${pad2(d2)}T00:00:00.000+04:00`)
  return { start, end, dateYmd: ymd, timezone: IANA_UAE }
}

function addDaysYmd(dateYmd, deltaDays) {
  const ymd = assertYmd(dateYmd)
  const [y, mo, d] = ymd.split('-').map(Number)
  const noon = new Date(`${y}-${pad2(mo)}-${pad2(d)}T12:00:00.000+04:00`)
  const shifted = new Date(noon.getTime() + deltaDays * 86400000)
  return ymdInTimeZone(shifted, IANA_UAE)
}

module.exports = {
  IANA_UAE,
  DATE_RE,
  ymdInTimeZone,
  todayUaeYmd,
  assertYmd,
  dubaiDayBounds,
  addDaysYmd,
}
