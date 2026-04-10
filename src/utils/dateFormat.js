const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * Format any date value to DD-MMM-YYYY (e.g. 01-Sep-2026).
 * Accepts ISO strings (YYYY-MM-DD), Date objects, or null/undefined.
 * Returns '—' for empty/invalid values.
 */
export function fmtDMY(v) {
  if (v == null || v === '') return '—'
  const iso = String(v).slice(0, 10)
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—'
  const [y, m, d] = iso.split('-')
  const month = MONTHS[parseInt(m, 10) - 1]
  if (!month) return '—'
  return `${d}-${month}-${y}`
}

/**
 * Return the ISO YYYY-MM-DD part of any date-like value, or '' if invalid.
 */
export function fmtISO(v) {
  if (v == null || v === '') return ''
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}
