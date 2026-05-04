import { useMemo } from 'react'
import type { AttendanceEmployee } from '../../../types/attendance'
import type { AttendanceMap } from '../../../utils/attendance/attendanceSelectors'
import { filterEmployeesByDepartment } from '../../../utils/attendance/attendanceSelectors'
import { departmentPresenceForDay } from '../../../utils/attendance/attendanceDashboardHelpers'

type Props = {
  employees: AttendanceEmployee[]
  attendance: AttendanceMap
  snapshotDay: number
  year: number
  month: number
  weeklyHolidayDay: number
  department: string
}

export function AttendanceDepartmentBreakdown({
  employees,
  attendance,
  snapshotDay,
  year,
  month,
  weeklyHolidayDay,
  department,
}: Props) {
  const scoped = useMemo(
    () => filterEmployeesByDepartment(employees, department),
    [employees, department]
  )

  const rows = useMemo(
    () =>
      departmentPresenceForDay(scoped, attendance, snapshotDay, year, month, weeklyHolidayDay),
    [scoped, attendance, snapshotDay, year, month, weeklyHolidayDay]
  )

  return (
    <div className="adash-panel adash-dept-breakdown">
      <h3 className="adash-panel__title">Department breakdown</h3>
      {rows.length === 0 ? (
        <p className="adash-empty" style={{ padding: '1rem 0' }}>
          No departments for current filter.
        </p>
      ) : (
        <ul className="adash-dept-breakdown__list">
          {rows.map((row) => {
            const pct = row.total > 0 ? Math.round((row.present / row.total) * 1000) / 10 : 0
            return (
              <li key={row.department} className="adash-dept-breakdown__row">
                <div className="adash-dept-breakdown__head">
                  <span className="adash-dept-breakdown__name">{row.department}</span>
                  <span className="adash-dept-breakdown__ratio">
                    {row.present}/{row.total} ({pct}%)
                  </span>
                </div>
                <div className="adash-dept-breakdown__bar" aria-hidden>
                  <span
                    className="adash-dept-breakdown__fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
