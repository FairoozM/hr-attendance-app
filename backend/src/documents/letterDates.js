const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** DD-MMM-YYYY (e.g. 01-Sep-2026) for ISO date YYYY-MM-DD */
function formatDMYFromIso(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') return '—'
  const s = isoDate.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—'
  const [y, m, d] = s.split('-')
  const month = MONTHS[parseInt(m, 10) - 1]
  if (!month) return '—'
  return `${d}-${month}-${y}`
}

function isoDatePart(v) {
  if (v == null) return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  const head = s.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null
}

function formatDMY(v) {
  const iso = isoDatePart(v)
  return iso ? formatDMYFromIso(iso) : '—'
}

function calendarYearFromTimestamp(v) {
  const iso = isoDatePart(v)
  if (iso) return parseInt(iso.slice(0, 4), 10)
  const d = v instanceof Date ? v : new Date(String(v))
  if (Number.isNaN(d.getTime())) return new Date().getUTCFullYear()
  return d.getUTCFullYear()
}

module.exports = { formatDMY, formatDMYFromIso, isoDatePart, calendarYearFromTimestamp }
