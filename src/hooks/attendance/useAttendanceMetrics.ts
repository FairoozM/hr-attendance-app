import { useMemo } from 'react'
import type { AttendanceEmployee, AttendanceDashboardMetrics } from '../../types/attendance'
import type { AttendanceMap } from '../../utils/attendance/attendanceSelectors'
import { filterEmployeesByDepartment, countStatusesForDay } from '../../utils/attendance/attendanceSelectors'

export function useAttendanceMetrics(
  employees: AttendanceEmployee[],
  attendance: AttendanceMap,
  snapshotDay: number,
  year: number,
  month: number,
  weeklyHolidayDay: number,
  department: string
): AttendanceDashboardMetrics {
  return useMemo(() => {
    const scoped = filterEmployeesByDepartment(employees, department)
    const totalEmployees = scoped.length
    const counts = countStatusesForDay(
      scoped,
      attendance,
      snapshotDay,
      year,
      month,
      weeklyHolidayDay
    )
    const present = counts.P
    const absent = counts.A
    const sickLeave = counts.SL
    const annualLeave = counts.AL
    const weeklyHoliday = counts.WH
    const denom = totalEmployees - weeklyHoliday - annualLeave
    const attendanceRate =
      denom > 0 ? Math.round((present / denom) * 1000) / 10 : totalEmployees === 0 ? 0 : 0

    return {
      totalEmployees,
      present,
      absent,
      sickLeave,
      annualLeave,
      weeklyHoliday,
      attendanceRate,
    }
  }, [employees, attendance, snapshotDay, year, month, weeklyHolidayDay, department])
}
