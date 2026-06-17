/** Shared attendance dashboard & grid types */

export type AttendanceStatusCode = 'P' | 'A' | 'SL' | 'AL' | 'WH' | ''

export interface AttendanceEmployee {
  id: string
  name: string
  department?: string | null
  designation?: string | null
  photoUrl?: string | null
}

export interface AttendanceRecord {
  employeeId: string
  day: number
  status: AttendanceStatusCode
}

export interface AttendanceFilterState {
  /** Day-of-month snapshot (1–31) within the loaded calendar month */
  snapshotDay: number
  department: string
}

export interface AttendanceDashboardMetrics {
  totalEmployees: number
  present: number
  absent: number
  sickLeave: number
  annualLeave: number
  weeklyHoliday: number
  /** No effective status for snapshot day (empty / unset). */
  unmarked: number
  /** Present count ÷ total employees × 100 (0–100, one decimal). */
  presentPctOfWorkforce: number
  /** 0–100 */
  attendanceRate: number
  /** Present count minus prior calendar day (same month); null when snapshot is day 1. */
  presentDeltaVsPriorDay: number | null
  /** Unmarked count minus prior day; null when snapshot is day 1. */
  unmarkedDeltaVsPriorDay: number | null
}

export interface AttendanceStatusItem {
  employee: AttendanceEmployee
  status: AttendanceStatusCode
  label: string
}

export interface AttendanceTrendPoint {
  day: number
  label: string
  present: number
  absent: number
  sickLeave: number
  annualLeave: number
}

export interface AttendanceAlertItem {
  id: string
  severity: 'info' | 'warning' | 'danger'
  title: string
  detail?: string
}

export interface AttendancePendingActionItem {
  id: string
  label: string
  meta?: string
  type: 'certificate' | 'approval' | 'leave'
}
