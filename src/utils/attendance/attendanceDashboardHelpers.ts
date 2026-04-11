import { getEffectiveStatus, getEmployeeMonthSummary } from '../attendanceHelpers.js'
import type { AttendanceMap } from './attendanceSelectors.js'
import type { AttendanceEmployee, AttendanceStatusItem } from '../../types/attendance'
import { filterEmployeesByDepartment, statusForEmployeeDay } from './attendanceSelectors.js'
import { STATUSES } from '../../constants/attendance.js'

const STATUS_LABEL: Record<string, string> = {
  P: STATUSES.P.label,
  A: STATUSES.A.label,
  SL: STATUSES.SL.label,
  AL: STATUSES.AL.label,
  WH: STATUSES.WH.label,
}

export function buildStatusListsForDay(
  employees: AttendanceEmployee[],
  attendance: AttendanceMap,
  day: number,
  year: number,
  monthIndex0: number,
  weeklyHolidayDay: number,
  keys: Array<'A' | 'SL' | 'AL' | 'WH'>
): Record<string, AttendanceStatusItem[]> {
  const lists: Record<string, AttendanceStatusItem[]> = {}
  for (const k of keys) lists[k] = []

  for (const emp of employees) {
    const s = statusForEmployeeDay(attendance, emp.id, day, year, monthIndex0, weeklyHolidayDay)
    if (!s || !keys.includes(s as 'A' | 'SL' | 'AL' | 'WH')) continue
    lists[s].push({
      employee: emp,
      status: s,
      label: STATUS_LABEL[s] || s,
    })
  }
  return lists
}

export function countAbsentStreakInMonth(
  attendance: AttendanceMap,
  employeeId: string,
  daysInMonth: number,
  year: number,
  monthIndex0: number,
  weeklyHolidayDay: number
): number {
  let n = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const s = getEffectiveStatus(attendance, employeeId, d, year, monthIndex0, weeklyHolidayDay)
    if (s === 'A') n++
  }
  return n
}

export function countSickLeaveInMonth(
  attendance: AttendanceMap,
  employeeId: string,
  daysInMonth: number,
  year: number,
  monthIndex0: number,
  weeklyHolidayDay: number
): number {
  let n = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const s = getEffectiveStatus(attendance, employeeId, d, year, monthIndex0, weeklyHolidayDay)
    if (s === 'SL') n++
  }
  return n
}

export function employeesMissingAttendanceForDay(
  employees: AttendanceEmployee[],
  attendance: AttendanceMap,
  day: number,
  year: number,
  monthIndex0: number,
  weeklyHolidayDay: number
): AttendanceEmployee[] {
  const out: AttendanceEmployee[] = []
  for (const emp of employees) {
    const s = getEffectiveStatus(attendance, emp.id, day, year, monthIndex0, weeklyHolidayDay)
    if (s == null || s === '') out.push(emp)
  }
  return out
}

export function monthSummaryForEmployee(
  attendance: AttendanceMap,
  employeeId: string,
  daysInMonth: number,
  year: number,
  monthIndex0: number,
  weeklyHolidayDay: number
) {
  return getEmployeeMonthSummary(attendance, employeeId, daysInMonth, year, monthIndex0, weeklyHolidayDay)
}

export function buildAttendanceSnapshotCsv(
  employees: AttendanceEmployee[],
  attendance: AttendanceMap,
  day: number,
  year: number,
  monthIndex0: number,
  weeklyHolidayDay: number,
  department: string
): string {
  const scoped = filterEmployeesByDepartment(employees, department)
  const rows: string[][] = [['Name', 'Department', 'Designation', 'Status']]
  for (const emp of scoped) {
    const s = getEffectiveStatus(attendance, emp.id, day, year, monthIndex0, weeklyHolidayDay)
    rows.push([emp.name, emp.department || '', emp.designation || '', s || ''])
  }
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
}
