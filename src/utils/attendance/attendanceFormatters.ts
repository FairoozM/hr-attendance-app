/** DD/MM/YYYY (calendar order used across HR UI) */
export function formatDateDDMMMYYYY(year: number, monthIndex0: number, day: number): string {
  const d = String(day).padStart(2, '0')
  const m = String(monthIndex0 + 1).padStart(2, '0')
  return `${d}/${m}/${year}`
}

export function formatPercent(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(fractionDigits)}%`
}

export function clampDay(day: number, daysInMonth: number): number {
  if (!Number.isFinite(day) || daysInMonth < 1) return 1
  return Math.min(Math.max(1, Math.floor(day)), daysInMonth)
}
