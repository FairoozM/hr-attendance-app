import { useMemo } from 'react'
import { AttendanceStatusSection } from './AttendanceStatusSection'
import type { AttendanceEmployee } from '../../../types/attendance'
import type { AttendanceMap } from '../../../utils/attendance/attendanceSelectors'
import { buildStatusListsForDay } from '../../../utils/attendance/attendanceDashboardHelpers'
import { colorForStatus } from '../../../utils/attendance/attendanceStatusColors'
import { EmployeeAvatar } from '../../employees/EmployeeAvatar'
import type { AttendanceStatusItem } from '../../../types/attendance'

type Props = {
  employees: AttendanceEmployee[]
  attendance: AttendanceMap
  snapshotDay: number
  year: number
  month: number
  weeklyHolidayDay: number
  department: string
}

/** A half-panel used inside the combined Absent+SL card */
function HalfList({
  title,
  code,
  items,
  emptyText,
}: {
  title: string
  code: string
  items: AttendanceStatusItem[]
  emptyText: string
}) {
  const col = colorForStatus(code)
  return (
    <div className="adash-half-list">
      <div className="adash-half-list__head">
        <span
          className="adash-half-list__badge"
          style={{ background: col.bg, color: col.text, border: `1px solid ${col.border}` }}
        >
          {code}
        </span>
        <span className="adash-half-list__title">{title}</span>
        <span className="adash-half-list__count">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <p className="adash-empty adash-half-list__empty">{emptyText}</p>
      ) : (
        <div className="adash-half-list__rows">
          {items.map((row) => (
            <div key={row.employee.id + row.status} className="adash-status-row">
              <EmployeeAvatar name={row.employee.name} photoUrl={row.employee.photoUrl} size="sm" />
              <div className="adash-status-row__meta">
                <span className="adash-status-row__name" title={row.employee.name}>
                  {row.employee.name}
                </span>
                <span
                  className="adash-status-row__dept"
                  title={row.employee.department || undefined}
                >
                  {row.employee.department || '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
    <div className="adash-status-lists">
      <h3 className="adash-panel__title">Today&apos;s status (selected day)</h3>
      <div className="adash-status-grid">

        {/* Combined Absent + Sick Leave card */}
        <div className="adash-panel adash-combined-card">
          <HalfList title="Absent" code="A" items={lists.A} emptyText="No absences" />
          <div className="adash-combined-card__divider" aria-hidden="true" />
          <HalfList title="Sick Leave" code="SL" items={lists.SL} emptyText="No sick leave" />
        </div>

        <AttendanceStatusSection title="Annual leave (AL)" items={lists.AL} emptyText="No annual leave" />
        <AttendanceStatusSection title="Weekly holiday (WH)" items={lists.WH} emptyText="No weekly holidays" />
      </div>
    </div>
  )
}
