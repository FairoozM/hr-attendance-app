/**
 * Document expiry utilities — pure functions for date/status logic.
 * All functions are stateless and reusable across components.
 * To change threshold rules, edit only this file.
 */

export const STATUS = {
  EXPIRED:  'Expired',
  URGENT:   'Urgent',
  DUE_SOON: 'Due Soon',
  OK:       'OK',
}

/**
 * Returns number of calendar days between today (midnight) and expiryDate.
 * Negative value means the date is already past.
 */
export function getDaysLeft(expiryDate) {
  if (!expiryDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exp = new Date(expiryDate)
  exp.setHours(0, 0, 0, 0)
  return Math.ceil((exp - today) / (1000 * 60 * 60 * 24))
}

/**
 * Returns the ISO date string on which a reminder should fire.
 */
export function getReminderDate(expiryDate, reminderDays) {
  if (!expiryDate || reminderDays == null) return null
  const exp = new Date(expiryDate)
  exp.setDate(exp.getDate() - Number(reminderDays))
  return exp.toISOString().slice(0, 10)
}

/**
 * Smart status rules:
 *   Expired  = daysLeft < 0
 *   Urgent   = 0 – 7 days
 *   Due Soon = 8 – 30 days
 *   OK       = > 30 days
 */
export function getSmartStatus(expiryDate) {
  const days = getDaysLeft(expiryDate)
  if (days === null) return STATUS.OK
  if (days < 0)     return STATUS.EXPIRED
  if (days <= 7)    return STATUS.URGENT
  if (days <= 30)   return STATUS.DUE_SOON
  return STATUS.OK
}

/** Format ISO date string as DD/MM/YYYY */
export function fmtDate(isoStr) {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('en-GB')
}
