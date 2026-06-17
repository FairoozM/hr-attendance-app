import { useMemo } from 'react'
import type { AttendanceEmployee } from '../../../types/attendance'
import type { AttendanceMap } from '../../../utils/attendance/attendanceSelectors'
import { filterEmployeesByDepartment } from '../../../utils/attendance/attendanceSelectors'
import { buildMonthHeatmapCells } from '../../../utils/attendance/attendanceDashboardHelpers'
import { formatDateDDMMMYYYY } from '../../../utils/attendance/attendanceFormatters'

type Props = {
  employees: AttendanceEmployee[]
  attendance: AttendanceMap
  month: number
  year: number
  daysInMonth: number
  weeklyHolidayDay: number
  department: string
  snapshotDay: number
}

function heatmapTone(ratePercent: number | null, workable: number): string {
  if (workable <= 0 || ratePercent === null) return 'adash-heatmap__cell--empty'
  if (ratePercent < 60) return 'adash-heatmap__cell--low'
  if (ratePercent < 80) return 'adash-heatmap__cell--mid'
  if (ratePercent < 90) return 'adash-heatmap__cell--high'
  return 'adash-heatmap__cell--max'
}

export function AttendanceMonthHeatmap({
  employees,
  attendance,
  month,
  year,
  daysInMonth,
  weeklyHolidayDay,
  department,
  snapshotDay,
}: Props) {
  const scoped = useMemo(
    () => filterEmployeesByDepartment(employees, department),
    [employees, department]
  )

  const cells = useMemo(
    () =>
      buildMonthHeatmapCells(scoped, attendance, daysInMonth, year, month, weeklyHolidayDay),
    [scoped, attendance, daysInMonth, year, month, weeklyHolidayDay]
  )

  return (
    <div className="adash-panel adash-heatmap">
      <h3 className="adash-panel__title">Monthly attendance heatmap</h3>
      <p className="adash-heatmap__hint">
        Daily colour = present ÷ (headcount − annual leave − weekly holiday). Weekends are outlined
        lightly.
      </p>
      <div className="adash-heatmap__track" role="list">
        {cells.map((cell) => {
          const label = formatDateDDMMMYYYY(year, month, cell.day)
          const rateLabel =
            cell.workable > 0 && cell.ratePercent !== null
              ? `${cell.ratePercent}% present (${cell.present}/${cell.workable})`
              : cell.workable <= 0
                ? 'No workable headcount (all AL/WH)'
                : 'No data'
          const title = `${label}: ${rateLabel}. Unmarked: ${cell.unmarked}.`
          const tone = heatmapTone(cell.ratePercent, cell.workable)
          const snap = cell.day === snapshotDay ? ' adash-heatmap__cell--snapshot' : ''
          const weekend = cell.isWeekend ? ' adash-heatmap__cell--weekend' : ''

          return (
            <button
              key={cell.day}
              type="button"
              role="listitem"
              className={`adash-heatmap__cell ${tone}${snap}${weekend}`}
              title={title}
              aria-label={title}
            >
              <span className="adash-heatmap__cell-num">{cell.day}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
