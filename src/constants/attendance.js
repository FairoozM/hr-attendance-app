/** Stored in DB / state to mean user chose "—" (overrides auto weekly holiday for that cell). */
export const STATUS_EXPLICIT_BLANK = '-'

export const STATUSES = {
  P: { label: 'Present', color: 'success' },
  A: { label: 'Absent', color: 'danger' },
  SL: { label: 'Sick Leave', color: 'warning' },
  AL: { label: 'Annual Leave', color: 'accent' },
  WH: { label: 'Weekly Holiday', color: 'weekly-holiday' },
}

export const STATUS_KEYS = Object.keys(STATUSES)

/** Sunday = 0, Monday = 1, ... Saturday = 6 */
export const DEFAULT_WEEKLY_HOLIDAY_DAY = 0

export const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
