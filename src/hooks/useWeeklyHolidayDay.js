import { useState, useCallback, useEffect } from 'react'
import { DEFAULT_WEEKLY_HOLIDAY_DAY } from '../constants/attendance'

const STORAGE_KEY = 'hr-attendance-weekly-holiday-day'

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) {
      const n = parseInt(raw, 10)
      if (n >= 0 && n <= 6) return n
    }
  } catch (_) {}
  return DEFAULT_WEEKLY_HOLIDAY_DAY
}

export function useWeeklyHolidayDay() {
  const [day, setDayState] = useState(load)

  const setDay = useCallback((value) => {
    const next = typeof value === 'function' ? value(load()) : value
    setDayState(next)
    try {
      localStorage.setItem(STORAGE_KEY, String(next))
    } catch (_) {}
  }, [])

  useEffect(() => {
    setDayState(load())
  }, [])

  return [day, setDay]
}
