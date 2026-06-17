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
    const todayCounts = countStatusesForDay(
      scoped,
      attendance,
      snapshotDay,
      year,
      month,
      weeklyHolidayDay
    )
    const present = todayCounts.P
    const absent = todayCounts.A
    const sickLeave = todayCounts.SL
    const annualLeave = todayCounts.AL
    const weeklyHoliday = todayCounts.WH
    const unmarked = todayCounts.empty
    const denom = totalEmployees - weeklyHoliday - annualLeave
    const attendanceRate =
      denom > 0 ? Math.round((present / denom) * 1000) / 10 : totalEmployees === 0 ? 0 : 0
    const presentPctOfWorkforce =
      totalEmployees > 0 ? Math.round((present / totalEmployees) * 1000) / 10 : 0

    let presentDeltaVsPriorDay: number | null = null
    let unmarkedDeltaVsPriorDay: number | null = null
    if (snapshotDay > 1) {
      const priorCounts = countStatusesForDay(
        scoped,
        attendance,
        snapshotDay - 1,
        year,
        month,
        weeklyHolidayDay
      )
      presentDeltaVsPriorDay = todayCounts.P - priorCounts.P
      unmarkedDeltaVsPriorDay = todayCounts.empty - priorCounts.empty
    }

    return {
      totalEmployees,
      present,
      absent,
      sickLeave,
      annualLeave,
      weeklyHoliday,
      unmarked,
      presentPctOfWorkforce,
      attendanceRate,
      presentDeltaVsPriorDay,
      unmarkedDeltaVsPriorDay,
    }
  }, [employees, attendance, snapshotDay, year, month, weeklyHolidayDay, department])
}
