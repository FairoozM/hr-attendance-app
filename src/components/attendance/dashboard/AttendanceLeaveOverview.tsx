import type { AttendanceDashboardMetrics } from '../../../types/attendance'
import { STATUS_COLORS } from '../../../utils/attendance/attendanceStatusColors'
import { useAttendanceLeaveOverview } from '../../../hooks/attendance/useAttendanceLeaveOverview'

type Props = {
  metrics: AttendanceDashboardMetrics
}

export function AttendanceLeaveOverview({ metrics }: Props) {
  const overview = useAttendanceLeaveOverview(metrics)
  return (
    <div className="adash-panel">
      <h3 className="adash-panel__title">Leave &amp; absence overview (selected day)</h3>
      <div className="adash-leave-mini">
        <div className="adash-leave-mini__item">
          <div className="adash-leave-mini__num" style={{ color: STATUS_COLORS.SL.text }}>
            {overview.sickLeave}
          </div>
          <div className="adash-leave-mini__lbl">Sick leave</div>
        </div>
        <div className="adash-leave-mini__item">
          <div className="adash-leave-mini__num" style={{ color: STATUS_COLORS.AL.text }}>
            {overview.annualLeave}
          </div>
          <div className="adash-leave-mini__lbl">Annual leave</div>
        </div>
        <div className="adash-leave-mini__item">
          <div className="adash-leave-mini__num" style={{ color: STATUS_COLORS.A.text }}>
            {overview.absent}
          </div>
          <div className="adash-leave-mini__lbl">Absent</div>
        </div>
      </div>
    </div>
  )
}
