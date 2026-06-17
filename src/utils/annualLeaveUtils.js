import { fmtDMY, fmtISO } from './dateFormat'

export function alDaysBetween(from, to) {
  if (!from || !to) return 0
  const diff = new Date(`${fmtISO(to)}T12:00:00Z`) - new Date(`${fmtISO(from)}T12:00:00Z`)
  return Math.max(0, Math.floor(diff / 86400000) + 1)
}

export function alPeriodDate(v) {
  return fmtDMY(v)
}
