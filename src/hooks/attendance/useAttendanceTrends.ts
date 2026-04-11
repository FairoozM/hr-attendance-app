import { useMemo } from 'react'
import type { AttendanceEmployee, AttendanceTrendPoint } from '../../types/attendance'
import type { AttendanceMap } from '../../utils/attendance/attendanceSelectors'
import { filterEmployeesByDepartment, countStatusesForDay } from '../../utils/attendance/attendanceSelectors'
import { formatDateDDMMMYYYY } from '../../utils/attendance/attendanceFormatters'

export function useAttendanceTrends(
  employees: AttendanceEmployee[],
  attendance: AttendanceMap,
  snapshotDay: number,
  year: number,
  month: number,
  weeklyHolidayDay: number,
  department: string
): AttendanceTrendPoint[] {
  return useMemo(() => {
    const scoped = filterEmployeesByDepartment(employees, department)
    const start = Math.max(1, snapshotDay - 6)
    const points: AttendanceTrendPoint[] = []
    for (let d = start; d <= snapshotDay; d++) {
      const c = countStatusesForDay(scoped, attendance, d, year, month, weeklyHolidayDay)
      points.push({
        day: d,
        label: formatDateDDMMMYYYY(year, month, d),
        present: c.P,
        absent: c.A,
        sickLeave: c.SL,
      })
    }
    return points
  }, [employees, attendance, snapshotDay, year, month, weeklyHolidayDay, department])
}
