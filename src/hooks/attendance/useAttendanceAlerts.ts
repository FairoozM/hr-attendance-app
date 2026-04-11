import { useMemo } from 'react'
import { getEffectiveStatus } from '../../utils/attendanceHelpers.js'
import type { AttendanceEmployee, AttendanceAlertItem } from '../../types/attendance'
import type { AttendanceMap } from '../../utils/attendance/attendanceSelectors'
import { filterEmployeesByDepartment } from '../../utils/attendance/attendanceSelectors'
import {
  countAbsentStreakInMonth,
  countSickLeaveInMonth,
  employeesMissingAttendanceForDay,
} from '../../utils/attendance/attendanceDashboardHelpers'

const THRESH_ABSENT = 3
const THRESH_SL = 3

export function useAttendanceAlerts(
  employees: AttendanceEmployee[],
  attendance: AttendanceMap,
  snapshotDay: number,
  year: number,
  month: number,
  daysInMonth: number,
  weeklyHolidayDay: number,
  department: string,
  sickLeaveDocuments: Record<string, Record<number, string>>
): AttendanceAlertItem[] {
  return useMemo(() => {
    const scoped = filterEmployeesByDepartment(employees, department)
    const alerts: AttendanceAlertItem[] = []

    for (const emp of scoped) {
      const a = countAbsentStreakInMonth(attendance, emp.id, daysInMonth, year, month, weeklyHolidayDay)
      if (a >= THRESH_ABSENT) {
        alerts.push({
          id: `abs-${emp.id}`,
          severity: 'warning',
          title: `High absence count: ${emp.name}`,
          detail: `${a} absent day(s) this month`,
        })
      }
      const sl = countSickLeaveInMonth(attendance, emp.id, daysInMonth, year, month, weeklyHolidayDay)
      if (sl >= THRESH_SL) {
        alerts.push({
          id: `sl-${emp.id}`,
          severity: 'info',
          title: `Frequent sick leave: ${emp.name}`,
          detail: `${sl} sick leave day(s) this month`,
        })
      }
    }

    for (const emp of scoped) {
      const docs = sickLeaveDocuments[emp.id]
      const hasDoc = docs && docs[snapshotDay]
      const s = getEffectiveStatus(attendance, emp.id, snapshotDay, year, month, weeklyHolidayDay)
      if (s === 'SL' && !hasDoc) {
        alerts.push({
          id: `cert-${emp.id}-${snapshotDay}`,
          severity: 'danger',
          title: `Missing sick leave certificate: ${emp.name}`,
          detail: `Day ${snapshotDay}`,
        })
      }
    }

    const missing = employeesMissingAttendanceForDay(
      scoped,
      attendance,
      snapshotDay,
      year,
      month,
      weeklyHolidayDay
    )
    if (missing.length > 0 && missing.length <= 10) {
      alerts.push({
        id: 'missing-att',
        severity: 'warning',
        title: 'Unmarked attendance',
        detail: `${missing.length} employee(s) have no status on ${snapshotDay}`,
      })
    }

    return alerts.slice(0, 25)
  }, [
    employees,
    attendance,
    snapshotDay,
    year,
    month,
    daysInMonth,
    weeklyHolidayDay,
    department,
    sickLeaveDocuments,
  ])
}
