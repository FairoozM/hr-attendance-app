const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** DD-MMM-YYYY (e.g. 11-Apr-2026) */
export function formatDateDDMMMYYYY(year: number, monthIndex0: number, day: number): string {
  const d = String(day).padStart(2, '0')
  const mon = MONTHS_SHORT[monthIndex0] ?? '—'
  return `${d}-${mon}-${year}`
}

export function formatPercent(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(fractionDigits)}%`
}

export function clampDay(day: number, daysInMonth: number): number {
  if (!Number.isFinite(day) || daysInMonth < 1) return 1
  return Math.min(Math.max(1, Math.floor(day)), daysInMonth)
}
