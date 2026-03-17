export const STATUSES = {
  P: { label: 'Present', color: 'success' },
  A: { label: 'Absent', color: 'danger' },
  SL: { label: 'Sick Leave', color: 'warning' },
  H: { label: 'Holiday', color: 'accent' },
  WH: { label: 'Weekly Holiday', color: 'weekly-holiday' },
}

export const STATUS_KEYS = Object.keys(STATUSES)

/** Sunday = 0, Monday = 1, ... Saturday = 6 */
export const DEFAULT_WEEKLY_HOLIDAY_DAY = 0

export const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
