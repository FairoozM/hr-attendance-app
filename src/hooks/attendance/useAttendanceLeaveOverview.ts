import { useMemo } from 'react'
import type { AttendanceDashboardMetrics } from '../../types/attendance'

/** Narrow view-model for leave/absence mini-cards (derived from dashboard metrics). */
export function useAttendanceLeaveOverview(metrics: AttendanceDashboardMetrics) {
  return useMemo(
    () => ({
      sickLeave: metrics.sickLeave,
      annualLeave: metrics.annualLeave,
      absent: metrics.absent,
    }),
    [metrics]
  )
}
