import { memo } from 'react'
import { AttendanceSummaryCard } from './AttendanceSummaryCard'
import { STATUS_COLORS } from '../../../utils/attendance/attendanceStatusColors'
import type { AttendanceDashboardMetrics } from '../../../types/attendance'
import { formatPercent } from '../../../utils/attendance/attendanceFormatters'

type Props = {
  metrics: AttendanceDashboardMetrics
}

function deltaFooterPresent(delta: number | null): { text: string; tone: 'good' | 'bad' | 'neutral' } | undefined {
  if (delta === null) return undefined
  if (delta === 0) return { text: 'Same as prior day', tone: 'neutral' }
  return {
    text: `${delta > 0 ? '+' : ''}${delta} vs prior day`,
    tone: delta > 0 ? 'good' : 'bad',
  }
}

function deltaFooterUnmarked(delta: number | null): { text: string; tone: 'good' | 'bad' | 'neutral' } | undefined {
  if (delta === null) return undefined
  if (delta === 0) return { text: 'Same as prior day', tone: 'neutral' }
  return {
    text: `${delta > 0 ? '+' : ''}${delta} vs prior day`,
    tone: delta < 0 ? 'good' : 'bad',
  }
}

export const AttendanceSummaryCards = memo(function AttendanceSummaryCards({ metrics }: Props) {
  const g = STATUS_COLORS.P.text
  const r = STATUS_COLORS.A.text
  const o = STATUS_COLORS.SL.text
  const b = STATUS_COLORS.AL.text
  const p = STATUS_COLORS.WH.text

  const presentExtras = deltaFooterPresent(metrics.presentDeltaVsPriorDay)
  const unmarkedExtras = deltaFooterUnmarked(metrics.unmarkedDeltaVsPriorDay)

  return (
    <div className="adash__cards">
      <AttendanceSummaryCard title="Total employees" value={metrics.totalEmployees} icon="👥" />
      <AttendanceSummaryCard
        title="Present (P)"
        value={metrics.present}
        icon="✓"
        color={g}
        subtitle={
          metrics.totalEmployees > 0
            ? `${formatPercent(metrics.presentPctOfWorkforce, 1)} of workforce`
            : undefined
        }
        footer={presentExtras?.text}
        footerTone={presentExtras?.tone}
      />
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
        title="Unmarked"
        value={metrics.unmarked}
        icon="?"
        subtitle={metrics.unmarked > 0 ? 'No status set for selected day' : 'All marked'}
        footer={unmarkedExtras?.text}
        footerTone={unmarkedExtras?.tone}
      />
      <AttendanceSummaryCard
        title="Attendance rate"
        value={formatPercent(metrics.attendanceRate, 1)}
        icon="📈"
        subtitle="Present vs workable (excl. WH & AL)"
      />
    </div>
  )
})
