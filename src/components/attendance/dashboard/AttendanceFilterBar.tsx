import { useMemo } from 'react'
import { AttendanceExportButton } from './AttendanceExportButton'
import type { AttendanceEmployee } from '../../../types/attendance'

type Props = {
  employees: AttendanceEmployee[]
  daysInMonth: number
  snapshotDay: number
  onSnapshotDayChange: (d: number) => void
  department: string
  onDepartmentChange: (d: string) => void
  onExport: () => void
  exportDisabled?: boolean
}

export function AttendanceFilterBar({
  employees,
  daysInMonth,
  snapshotDay,
  onSnapshotDayChange,
  department,
  onDepartmentChange,
  onExport,
  exportDisabled,
}: Props) {
  const departments = useMemo(() => {
    const s = new Set<string>()
    employees.forEach((e) => {
      if (e.department && String(e.department).trim()) s.add(String(e.department).trim())
    })
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [employees])

  const dayOptions = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => i + 1),
    [daysInMonth]
  )

  return (
    <div className="adash__filter-row">
      <div className="adash__field">
        <label htmlFor="adash-day">Dashboard day</label>
        <select
          id="adash-day"
          className="adash__select"
          value={snapshotDay}
          onChange={(e) => onSnapshotDayChange(Number(e.target.value))}
        >
          {dayOptions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div className="adash__field">
        <label htmlFor="adash-dept">Department</label>
        <select
          id="adash-dept"
          className="adash__select"
          value={department}
          onChange={(e) => onDepartmentChange(e.target.value)}
        >
          <option value="all">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <AttendanceExportButton onExport={onExport} disabled={exportDisabled} />
    </div>
  )
}
