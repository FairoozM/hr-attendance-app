import { useMemo } from 'react'
import { EmployeeAvatar } from '../../employees/EmployeeAvatar'
import type { AttendanceEmployee, AttendanceStatusCode } from '../../../types/attendance'
import type { AttendanceMap } from '../../../utils/attendance/attendanceSelectors'
import { filterEmployeesByDepartment } from '../../../utils/attendance/attendanceSelectors'
import { getEffectiveStatus } from '../../../utils/attendanceHelpers.js'
import { STATUSES } from '../../../constants/attendance.js'
import { colorForStatus } from '../../../utils/attendance/attendanceStatusColors'

type Props = {
  employees: AttendanceEmployee[]
  attendance: AttendanceMap
  snapshotDay: number
  year: number
  month: number
  weeklyHolidayDay: number
  department: string
}

type Row = {
  employee: AttendanceEmployee
  status: AttendanceStatusCode | ''
  label: string
}

function buildRows(
  scoped: AttendanceEmployee[],
  attendance: AttendanceMap,
  snapshotDay: number,
  year: number,
  month: number,
  weeklyHolidayDay: number
): Row[] {
  const list: Row[] = []
  for (const emp of scoped) {
    const raw = getEffectiveStatus(attendance, emp.id, snapshotDay, year, month, weeklyHolidayDay)
    const status = (raw || '') as AttendanceStatusCode | ''
    let label = 'Unmarked'
    if (status && STATUSES[status as keyof typeof STATUSES]) {
      label = STATUSES[status as keyof typeof STATUSES].label
    }
    list.push({ employee: emp, status, label })
  }
  list.sort((a, b) => a.employee.name.localeCompare(b.employee.name))
  return list
}

export function AttendanceWhosInList({
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
    () => buildRows(scoped, attendance, snapshotDay, year, month, weeklyHolidayDay),
    [scoped, attendance, snapshotDay, year, month, weeklyHolidayDay]
  )

  return (
    <div className="adash-panel adash-whos-in">
      <h3 className="adash-panel__title">Who&apos;s in today</h3>
      <p className="adash-whos-in__hint">Selected calendar day · sorted by name</p>
      <div className="adash-whos-in__scroll">
        {rows.length === 0 ? (
          <p className="adash-empty" style={{ padding: '1rem 0' }}>
            No employees for current filter.
          </p>
        ) : (
          <ul className="adash-whos-in__list">
            {rows.map((row) => {
              const col = colorForStatus(row.status || undefined)
              return (
                <li key={row.employee.id} className="adash-whos-in__row">
                  <EmployeeAvatar name={row.employee.name} photoUrl={row.employee.photoUrl} size="sm" />
                  <div className="adash-whos-in__meta">
                    <span className="adash-whos-in__name">{row.employee.name}</span>
                    <span className="adash-whos-in__dept">{row.employee.department || '—'}</span>
                  </div>
                  <span
                    className="adash-badge"
                    style={{
                      background: col.bg,
                      color: col.text,
                      border: `1px solid ${col.border}`,
                    }}
                  >
                    {row.label}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
