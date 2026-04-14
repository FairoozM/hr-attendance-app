/**
 * Main shop visit must occur in the inclusive window:
 *   [leave_start - 5 calendar days, leave_start - 1 calendar day]
 * i.e. at most 5 days before leave starts, and strictly before the first leave day.
 */

function toIsoDateString(v) {
  if (v == null || v === '') return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim().slice(0, 10)
}

function addCalendarDays(isoDate, delta) {
  const t = toIsoDateString(isoDate)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const [y, m, d] = t.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

function shopVisitWindowISO(leaveStartDate) {
  const from = toIsoDateString(leaveStartDate)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return null
  return {
    min: addCalendarDays(from, -5),
    max: addCalendarDays(from, -1),
  }
}

/** @returns {string|null} Error message or null if valid */
function shopVisitDateRangeError(visitDate, leaveStartDate) {
  const v = toIsoDateString(visitDate)
  const w = shopVisitWindowISO(leaveStartDate)
  if (!w) return 'Invalid leave start date for shop visit validation'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Invalid shop visit date'
  if (v < w.min || v > w.max) {
    return `Shop visit must be between ${w.min} and ${w.max} (inclusive): at most 5 days before leave starts, and before the first day of leave.`
  }
  return null
}

module.exports = {
  shopVisitWindowISO,
  shopVisitDateRangeError,
  toIsoDateString,
}
