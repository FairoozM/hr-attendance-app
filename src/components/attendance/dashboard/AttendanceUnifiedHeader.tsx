import { useMemo } from 'react'
import { AttendanceExportButton } from './AttendanceExportButton'
import type { AttendanceEmployee } from '../../../types/attendance'

type Props = {
  totalEmployees: number
  contextLabel: string
  employees: AttendanceEmployee[]
  daysInMonth: number
  snapshotDay: number
  onSnapshotDayChange: (d: number) => void
  department: string
  onDepartmentChange: (d: string) => void
  onExport: () => void
  exportDisabled?: boolean
}

export function AttendanceUnifiedHeader({
  totalEmployees,
  contextLabel,
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

  const peopleLabel = totalEmployees === 1 ? '1 person' : `${totalEmployees} people`

  return (
    <header className="adash__shell">
      <div className="adash__shell-top">
        <div className="adash__shell-intro">
          <h1 className="adash__shell-title">Attendance</h1>
          <p className="adash__shell-meta">
            {peopleLabel} · {contextLabel}
          </p>
        </div>
        <div className="adash__shell-controls">
          <div className="adash__field">
            <label htmlFor="adash-day">Day</label>
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
              <option value="all">All</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <AttendanceExportButton onExport={onExport} disabled={exportDisabled} />
        </div>
      </div>
    </header>
  )
}
