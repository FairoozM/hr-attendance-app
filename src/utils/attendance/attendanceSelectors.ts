import { getEffectiveStatus } from '../attendanceHelpers.js'
import type { AttendanceEmployee, AttendanceStatusCode } from '../../types/attendance'

/** Raw attendance map: employeeId -> day -> status */
export type AttendanceMap = Record<string, Record<number, string | undefined>>

export function filterEmployeesByDepartment(
  employees: AttendanceEmployee[],
  department: string
): AttendanceEmployee[] {
  if (!department || department === 'all') return employees
  return employees.filter((e) => (e.department || '') === department)
}

export function statusForEmployeeDay(
  attendance: AttendanceMap,
  employeeId: string,
  day: number,
  year: number,
  monthIndex0: number,
  weeklyHolidayDay: number
): AttendanceStatusCode | null {
  const s = getEffectiveStatus(attendance, employeeId, day, year, monthIndex0, weeklyHolidayDay)
  return (s as AttendanceStatusCode) || null
}

export function countStatusesForDay(
  employees: AttendanceEmployee[],
  attendance: AttendanceMap,
  day: number,
  year: number,
  monthIndex0: number,
  weeklyHolidayDay: number
): Record<'P' | 'A' | 'SL' | 'AL' | 'WH' | 'empty', number> {
  const counts = { P: 0, A: 0, SL: 0, AL: 0, WH: 0, empty: 0 }
  for (const emp of employees) {
    const raw = getEffectiveStatus(attendance, emp.id, day, year, monthIndex0, weeklyHolidayDay)
    const key = (raw && counts[raw as keyof typeof counts] !== undefined ? raw : 'empty') as keyof typeof counts
    if (key === 'empty') counts.empty++
    else counts[key]++
  }
  return counts
}
