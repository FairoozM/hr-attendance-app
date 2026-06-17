import { getEffectiveStatus, getEmployeeMonthSummary } from '../attendanceHelpers.js'
import type { AttendanceMap } from './attendanceSelectors.js'
import type { AttendanceEmployee, AttendanceStatusItem } from '../../types/attendance'
import {
  filterEmployeesByDepartment,
  statusForEmployeeDay,
  countStatusesForDay,
} from './attendanceSelectors.js'
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

/** One calendar day for the monthly attendance heatmap (% present vs workable headcount). */
export interface HeatmapDayCell {
  day: number
  /** Present ÷ (total − WH − AL); null when workable is 0. */
  ratePercent: number | null
  present: number
  workable: number
  unmarked: number
  /** Sat/Sun — visual hint only; attendance still counts normally. */
  isWeekend: boolean
}

export function buildMonthHeatmapCells(
  employees: AttendanceEmployee[],
  attendance: AttendanceMap,
  daysInMonth: number,
  year: number,
  monthIndex0: number,
  weeklyHolidayDay: number
): HeatmapDayCell[] {
  const cells: HeatmapDayCell[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const c = countStatusesForDay(employees, attendance, d, year, monthIndex0, weeklyHolidayDay)
    const workable = employees.length - c.WH - c.AL
    const jsDay = new Date(year, monthIndex0, d).getDay()
    const isWeekend = jsDay === 0 || jsDay === 6
    let ratePercent: number | null = null
    if (workable > 0) {
      ratePercent = Math.round((c.P / workable) * 1000) / 10
    }
    cells.push({
      day: d,
      ratePercent,
      present: c.P,
      workable,
      unmarked: c.empty,
      isWeekend,
    })
  }
  return cells
}

export interface DepartmentPresenceRow {
  department: string
  total: number
  present: number
}

/** Present count per department for one day (scoped employee list). */
export function departmentPresenceForDay(
  employees: AttendanceEmployee[],
  attendance: AttendanceMap,
  day: number,
  year: number,
  monthIndex0: number,
  weeklyHolidayDay: number
): DepartmentPresenceRow[] {
  const map = new Map<string, { total: number; present: number }>()
  for (const emp of employees) {
    const dept = (emp.department || '').trim() || 'Unassigned'
    const s = getEffectiveStatus(attendance, emp.id, day, year, monthIndex0, weeklyHolidayDay)
    if (!map.has(dept)) map.set(dept, { total: 0, present: 0 })
    const row = map.get(dept)!
    row.total++
    if (s === 'P') row.present++
  }
  return [...map.entries()]
    .map(([department, v]) => ({ department, ...v }))
    .sort((a, b) => a.department.localeCompare(b.department))
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
