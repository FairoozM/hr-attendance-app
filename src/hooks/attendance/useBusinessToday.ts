import { useEffect, useState } from 'react'
import { businessToday, type CalendarDate, isSameDate } from '../../utils/attendance/attendanceCalendar'

/** Today in the business time zone; rolls over at local midnight there while the tab stays open. */
export function useBusinessToday(): CalendarDate {
  const [today, setToday] = useState<CalendarDate>(() => businessToday())
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = businessToday()
      setToday((prev) => (isSameDate(prev, next) ? prev : next))
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return today
}
