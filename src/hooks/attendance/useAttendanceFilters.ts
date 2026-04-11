import { useState, useEffect } from 'react'
import { clampDay } from '../../utils/attendance/attendanceFormatters'
export function useAttendanceFilters(
  daysInMonth: number,
  month: number,
  year: number
): {
  snapshotDay: number
  department: string
  setSnapshotDay: (d: number) => void
  setDepartment: (d: string) => void
} {
  const [snapshotDay, setSnapshotDayState] = useState(1)
  const [department, setDepartment] = useState('all')

  useEffect(() => {
    const now = new Date()
    const isCurrent = now.getFullYear() === year && now.getMonth() === month
    const d = isCurrent ? clampDay(now.getDate(), daysInMonth) : 1
    setSnapshotDayState(d)
  }, [month, year, daysInMonth])

  const setSnapshotDay = (d: number) => {
    setSnapshotDayState(clampDay(d, daysInMonth))
  }

  return {
    snapshotDay,
    department,
    setSnapshotDay,
    setDepartment,
  }
}
