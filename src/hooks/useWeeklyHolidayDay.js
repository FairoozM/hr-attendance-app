import { useState, useCallback, useEffect, useRef } from 'react'
import { DEFAULT_WEEKLY_HOLIDAY_DAY } from '../constants/attendance'
import { PREF_WEEKLY_HOLIDAY_DAY } from '../constants/userPreferenceKeys'
import { useAuth } from '../contexts/AuthContext'
import { useUserPreferences } from '../contexts/UserPreferencesContext'

export function useWeeklyHolidayDay() {
  const { user } = useAuth()
  const { ready, getPref, setPref, prefsVersion } = useUserPreferences()
  const [day, setDayState] = useState(DEFAULT_WEEKLY_HOLIDAY_DAY)
  const skipSave = useRef(false)

  useEffect(() => {
    if (!user || !ready) {
      setDayState(DEFAULT_WEEKLY_HOLIDAY_DAY)
      return
    }
    const v = getPref(PREF_WEEKLY_HOLIDAY_DAY, null)
    skipSave.current = true
    if (typeof v === 'number' && v >= 0 && v <= 6) {
      setDayState(v)
    } else {
      setDayState(DEFAULT_WEEKLY_HOLIDAY_DAY)
    }
  }, [user, ready, prefsVersion, getPref])

  useEffect(() => {
    if (!user || !ready) return
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    setPref(PREF_WEEKLY_HOLIDAY_DAY, day)
  }, [day, user, ready, setPref])

  const setDay = useCallback((value) => {
    setDayState((prev) => {
      const base = prev
      const next = typeof value === 'function' ? value(base) : value
      return typeof next === 'number' && next >= 0 && next <= 6 ? next : base
    })
  }, [])

  return [day, setDay]
}
