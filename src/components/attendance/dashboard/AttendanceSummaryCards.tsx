import { AttendanceSummaryCard } from './AttendanceSummaryCard'
import { STATUS_COLORS } from '../../../utils/attendance/attendanceStatusColors'
import type { AttendanceDashboardMetrics } from '../../../types/attendance'
import { formatPercent } from '../../../utils/attendance/attendanceFormatters'

type Props = {
  metrics: AttendanceDashboardMetrics
}

export function AttendanceSummaryCards({ metrics }: Props) {
  const g = STATUS_COLORS.P.text
  const r = STATUS_COLORS.A.text
  const o = STATUS_COLORS.SL.text
  const b = STATUS_COLORS.AL.text
  const p = STATUS_COLORS.WH.text

  return (
    <div className="adash__cards">
      <AttendanceSummaryCard title="Total employees" value={metrics.totalEmployees} icon="👥" />
      <AttendanceSummaryCard title="Present (P)" value={metrics.present} icon="✓" color={g} />
      <AttendanceSummaryCard title="Absent (A)" value={metrics.absent} icon="✕" color={r} />
      <AttendanceSummaryCard title="Sick leave (SL)" value={metrics.sickLeave} icon="◆" color={o} />
      <AttendanceSummaryCard
        title="Annual leave (AL)"
        value={metrics.annualLeave}
        icon="◇"
        color={b}
      />
      <AttendanceSummaryCard
        title="Weekly Holiday (WH)"
        value={metrics.weeklyHoliday}
        icon="◎"
        color={p}
      />
      <AttendanceSummaryCard
        title="Attendance rate"
        value={formatPercent(metrics.attendanceRate, 1)}
        icon="📈"
        subtitle="Present vs workable (excl. WH & AL)"
      />
    </div>
  )
}
