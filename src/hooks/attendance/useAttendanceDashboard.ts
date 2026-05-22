import { useAttendanceFilters } from './useAttendanceFilters'
import { useAttendanceMetrics } from './useAttendanceMetrics'
import { useAttendancePendingActions } from './useAttendancePendingActions'
import { useAnnualLeave } from '../useAnnualLeave.js'
import type { AttendanceEmployee } from '../../types/attendance'
import type { AttendanceMap } from '../../utils/attendance/attendanceSelectors'

export function useAttendanceDashboard(
  employees: AttendanceEmployee[],
  attendance: AttendanceMap,
  month: number,
  year: number,
  daysInMonth: number,
  weeklyHolidayDay: number,
  sickLeaveDocuments: Record<string, Record<number, string>>
) {
  const { snapshotDay, setSnapshotDay, department, setDepartment } = useAttendanceFilters(
    daysInMonth,
    month,
    year
  )

  const metrics = useAttendanceMetrics(
    employees,
    attendance,
    snapshotDay,
    year,
    month,
    weeklyHolidayDay,
    department
  )

  const { requests: leaveRequests, loading: leaveLoading } = useAnnualLeave()
  const pendingActions = useAttendancePendingActions(leaveRequests || [])

  return {
    snapshotDay,
    setSnapshotDay,
    department,
    setDepartment,
    metrics,
    pendingActions,
    leaveLoading,
  }
}
