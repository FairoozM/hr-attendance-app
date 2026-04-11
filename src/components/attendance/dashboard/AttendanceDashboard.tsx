import { useCallback } from 'react'
import { useAttendanceDashboard } from '../../../hooks/attendance/useAttendanceDashboard'
import type { AttendanceEmployee } from '../../../types/attendance'
import type { AttendanceMap } from '../../../utils/attendance/attendanceSelectors'
import { formatDateDDMMMYYYY } from '../../../utils/attendance/attendanceFormatters'
import { buildAttendanceSnapshotCsv } from '../../../utils/attendance/attendanceDashboardHelpers'
import { AttendanceDashboardHeader } from './AttendanceDashboardHeader'
import { AttendanceFilterBar } from './AttendanceFilterBar'
import { AttendanceSummaryCards } from './AttendanceSummaryCards'
import { AttendanceStatusLists } from './AttendanceStatusLists'
import { AttendanceTrendCharts } from './AttendanceTrendCharts'
import { AttendanceAlertsPanel } from './AttendanceAlertsPanel'
import { AttendancePendingActions } from './AttendancePendingActions'
import { AttendanceLeaveOverview } from './AttendanceLeaveOverview'
import { AttendanceLoadingState } from './AttendanceLoadingState'
import { AttendanceEmptyState } from './AttendanceEmptyState'
import './AttendanceDashboard.css'

type Props = {
  employees: AttendanceEmployee[]
  attendance: AttendanceMap
  month: number
  year: number
  daysInMonth: number
  weeklyHolidayDay: number
  sickLeaveDocuments: Record<string, Record<number, string>>
  loading?: boolean
}

export function AttendanceDashboard({
  employees,
  attendance,
  month,
  year,
  daysInMonth,
  weeklyHolidayDay,
  sickLeaveDocuments,
  loading,
}: Props) {
  const dash = useAttendanceDashboard(
    employees,
    attendance,
    month,
    year,
    daysInMonth,
    weeklyHolidayDay,
    sickLeaveDocuments
  )

  const contextLabel = formatDateDDMMMYYYY(year, month, dash.snapshotDay)

  const handleExport = useCallback(() => {
    const csv = buildAttendanceSnapshotCsv(
      employees,
      attendance,
      dash.snapshotDay,
      year,
      month,
      weeklyHolidayDay,
      dash.department
    )
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance-snapshot-${year}-${String(month + 1).padStart(2, '0')}-${String(dash.snapshotDay).padStart(2, '0')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [employees, attendance, dash.snapshotDay, dash.department, year, month, weeklyHolidayDay])

  if (loading) {
    return <AttendanceLoadingState />
  }

  if (!employees.length) {
    return (
      <div className="adash">
        <AttendanceDashboardHeader contextLabel={contextLabel} />
        <AttendanceEmptyState />
      </div>
    )
  }

  return (
    <section className="adash" aria-label="Attendance dashboard">
      <AttendanceDashboardHeader contextLabel={contextLabel} />

      <AttendanceFilterBar
        employees={employees}
        daysInMonth={daysInMonth}
        snapshotDay={dash.snapshotDay}
        onSnapshotDayChange={dash.setSnapshotDay}
        department={dash.department}
        onDepartmentChange={dash.setDepartment}
        onExport={handleExport}
        exportDisabled={false}
      />

      <AttendanceSummaryCards metrics={dash.metrics} />

      <div className="adash-grid-2">
        <AttendanceLeaveOverview metrics={dash.metrics} />
        <AttendancePendingActions items={dash.pendingActions} leaveLoading={dash.leaveLoading} />
      </div>

      <AttendanceStatusLists
        employees={employees}
        attendance={attendance}
        snapshotDay={dash.snapshotDay}
        year={year}
        month={month}
        weeklyHolidayDay={weeklyHolidayDay}
        department={dash.department}
      />

      <div className="adash-grid-2">
        <AttendanceTrendCharts data={dash.trends} />
        <AttendanceAlertsPanel alerts={dash.alerts} />
      </div>
    </section>
  )
}
