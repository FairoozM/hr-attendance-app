import { STATUS_EXPLICIT_BLANK } from '../constants/attendance'

/**
 * Returns day of week (0 = Sunday, 6 = Saturday) for a given date.
 * @param {number} year - Full year
 * @param {number} month - Month 0–11 (January = 0)
 * @param {number} day - Day of month 1–31
 */
export function getDayOfWeek(year, month, day) {
  return new Date(year, month, day).getDay()
}

/**
 * Builds effective attendance: stored value, or WH for weekly-holiday days when not set.
 * Explicit blank ('-') stays empty (does not fall back to auto WH).
 */
export function deriveEffectiveAttendance(
  attendance,
  employees,
  year,
  month,
  daysInMonth,
  weeklyHolidayDay
) {
  const result = {}
  employees.forEach((emp) => {
    result[emp.id] = {}
    for (let day = 1; day <= daysInMonth; day++) {
      const stored = attendance[emp.id]?.[day]
      if (stored === STATUS_EXPLICIT_BLANK) {
        result[emp.id][day] = undefined
        continue
      }
      const dayOfWeek = getDayOfWeek(year, month, day)
      const isWeeklyHoliday = dayOfWeek === weeklyHolidayDay
      result[emp.id][day] = stored ?? (isWeeklyHoliday ? 'WH' : undefined)
    }
  })
  return result
}

/**
 * Effective status for a single cell: stored or auto WH for weekly holiday day.
 * Explicit blank ('-') shows as empty (not WH).
 */
export function getEffectiveStatus(
  attendance,
  employeeId,
  day,
  year,
  month,
  weeklyHolidayDay
) {
  const stored = attendance[employeeId]?.[day]
  if (stored === STATUS_EXPLICIT_BLANK) return null
  if (stored != null && stored !== '') return stored
  const dayOfWeek = getDayOfWeek(year, month, day)
  return dayOfWeek === weeklyHolidayDay ? 'WH' : null
}

/** Summary column order: P | A | SL | H | WH */
export const SUMMARY_STATUS_ORDER = ['P', 'A', 'SL', 'H', 'WH']

/**
 * Per-employee totals for the month (using effective status, so auto WH is counted).
 */
export function getEmployeeMonthSummary(
  attendance,
  employeeId,
  daysInMonth,
  year,
  month,
  weeklyHolidayDay
) {
  const counts = { P: 0, A: 0, SL: 0, H: 0, WH: 0 }
  for (let day = 1; day <= daysInMonth; day++) {
    const status = getEffectiveStatus(
      attendance,
      employeeId,
      day,
      year,
      month,
      weeklyHolidayDay
    )
    if (status && counts[status] !== undefined) counts[status]++
  }
  return counts
}
