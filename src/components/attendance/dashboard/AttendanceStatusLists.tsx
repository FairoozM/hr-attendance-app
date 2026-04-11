import { useMemo } from 'react'
import { AttendanceStatusSection } from './AttendanceStatusSection'
import type { AttendanceEmployee } from '../../../types/attendance'
import type { AttendanceMap } from '../../../utils/attendance/attendanceSelectors'
import { buildStatusListsForDay } from '../../../utils/attendance/attendanceDashboardHelpers'

type Props = {
  employees: AttendanceEmployee[]
  attendance: AttendanceMap
  snapshotDay: number
  year: number
  month: number
  weeklyHolidayDay: number
  department: string
}

export function AttendanceStatusLists({
  employees,
  attendance,
  snapshotDay,
  year,
  month,
  weeklyHolidayDay,
  department,
}: Props) {
  const lists = useMemo(() => {
    const deptScoped =
      department === 'all' ? employees : employees.filter((e) => (e.department || '') === department)
    return buildStatusListsForDay(
      deptScoped,
      attendance,
      snapshotDay,
      year,
      month,
      weeklyHolidayDay,
      ['A', 'SL', 'AL', 'WH']
    )
  }, [employees, attendance, snapshotDay, year, month, weeklyHolidayDay, department])

  return (
    <div className="adash-panel">
      <h3 className="adash-panel__title">Today&apos;s status (selected day)</h3>
      <div className="adash-status-grid">
        <AttendanceStatusSection title="Absent (A)" items={lists.A} emptyText="No absences" />
        <AttendanceStatusSection title="Sick leave (SL)" items={lists.SL} emptyText="No sick leave" />
        <AttendanceStatusSection title="Annual leave (AL)" items={lists.AL} emptyText="No annual leave" />
        <AttendanceStatusSection title="Weekly holiday (WH)" items={lists.WH} emptyText="No weekly holidays" />
      </div>
    </div>
  )
}
