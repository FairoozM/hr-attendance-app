/**
 * Format any date value to DD/MM/YYYY (calendar order used across the app).
 * Accepts ISO strings (YYYY-MM-DD), Date/timestamps (first 10 chars used when YYYY-MM-DD), or null/undefined.
 * Returns '—' for empty/invalid values.
 */
export function fmtDMY(v) {
  if (v == null || v === '') return '—'
  const iso = String(v).slice(0, 10)
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/**
 * Main shop visit: inclusive window [leave_start - 5 days, leave_start - 1 day]
 * (strictly before the first day of leave).
 * @returns {{ min: string, max: string } | null}
 */
export function shopVisitAllowedWindowISO(leaveStartIso) {
  const from = fmtISO(leaveStartIso)
  if (!from) return null
  const min = addCalendarDaysToIso(from, -5)
  const max = addCalendarDaysToIso(from, -1)
  if (!min || !max) return null
  return { min, max }
}

function addCalendarDaysToIso(isoDate, delta) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

/** @returns {string|null} Error message or null if valid */
export function shopVisitDateValidationError(visitIso, leaveStartIso) {
  const v = fmtISO(visitIso)
  const w = shopVisitAllowedWindowISO(leaveStartIso)
  if (!w) return 'Invalid leave dates'
  if (!v) return 'Visit date is required'
  if (v < w.min || v > w.max) {
    return `Visit must be between ${fmtDMY(w.min)} and ${fmtDMY(w.max)} (up to 5 days before leave starts, before the first leave day).`
  }
  return null
}

/**
 * Return the ISO YYYY-MM-DD part of any date-like value, or '' if invalid.
 */
export function fmtISO(v) {
  if (v == null || v === '') return ''
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}
