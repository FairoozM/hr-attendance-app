/** Codes accepted by PUT /api/attendance. `-` marks a day as deliberately unmarked (overrides auto weekly holiday). */
const ATTENDANCE_STATUS_CODES = ['P', 'A', 'SL', 'AL', 'WH', '-'] as const

function isAttendanceStatus(value: unknown): boolean {
  return typeof value === 'string' && (ATTENDANCE_STATUS_CODES as readonly string[]).includes(value)
}

/** Strict calendar date `YYYY-MM-DD` (rejects 2026-02-30, timestamps, and locale formats). */
function isIsoCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

module.exports = { ATTENDANCE_STATUS_CODES, isAttendanceStatus, isIsoCalendarDate }
