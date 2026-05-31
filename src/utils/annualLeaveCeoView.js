import { fmtISO, fmtDMY } from './dateFormat'
import { alDaysBetween } from './annualLeaveUtils'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** e.g. 4 Apr to 4 May 2026 */
export function fmtLeavePeriodCeo(fromIso, toIso) {
  const f = fmtISO(fromIso)
  const t = fmtISO(toIso)
  if (!f || !t) return '—'
  const [, fm, fd] = f.split('-').map(Number)
  const [ty, tm, td] = t.split('-').map(Number)
  const fy = Number(f.split('-')[0])
  const fLabel = `${fd} ${MONTHS_SHORT[fm - 1]}`
  const tLabel = `${td} ${MONTHS_SHORT[tm - 1]} ${ty}`
  if (f === t) return `${fLabel} ${fy}`
  if (fy === ty) return `${fLabel} to ${tLabel}`
  return `${fLabel} ${fy} to ${tLabel}`
}

/** Whole months of service from joining until leave starts (partial month rounds up). */
export function roundupMonthsUntilLeave(joiningIso, leaveStartIso) {
  const join = fmtISO(joiningIso)
  const start = fmtISO(leaveStartIso)
  if (!join || !start) return null
  if (start < join) return 0
  const d0 = new Date(`${join}T12:00:00Z`)
  const d1 = new Date(`${start}T12:00:00Z`)
  if (Number.isNaN(d0.getTime()) || Number.isNaN(d1.getTime())) return null
  const totalDays = Math.max(0, Math.floor((d1 - d0) / 86400000))
  return Math.max(0, Math.ceil(totalDays / 30))
}

function rangesOverlap(aFrom, aTo, bFrom, bTo) {
  if (!aFrom || !aTo || !bFrom || !bTo) return false
  return aFrom <= bTo && bFrom <= aTo
}

/**
 * Alternate cover person and whether they are free during this leave window.
 * @param {object} row
 * @param {object[]} allRequests
 */
export function alternateAvailabilityForRow(row, allRequests) {
  const altId = row.alternate_employee_id
  const name = row.alternate_employee_full_name
  if (altId == null || !name) {
    return { name: null, status: 'missing', label: 'Not assigned' }
  }
  const from = fmtISO(row.from_date)
  const to = fmtISO(row.to_date)
  const conflict = (allRequests || []).some(
    (other) =>
      other.id !== row.id &&
      String(other.employee_id) === String(altId) &&
      other.status !== 'Rejected' &&
      rangesOverlap(from, to, fmtISO(other.from_date), fmtISO(other.to_date)),
  )
  if (conflict) {
    return { name, status: 'unavailable', label: 'On leave (unavailable)' }
  }
  return { name, status: 'available', label: 'Available' }
}

export function getInitials(name) {
  if (!name || !String(name).trim()) return '?'
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function formatDate(date) {
  return fmtDMY(date) || '—'
}

/** Signed alternate employee photo URL from API row (supports snake_case and camelCase). */
export function resolveAlternateEmployeePhotoUrl(record) {
  if (!record || typeof record !== 'object') return null
  const url =
    record.alternateEmployeePhotoUrl ||
    record.alternate_employee_photo_url ||
    record.alternatePhotoUrl ||
    record.alternateProfileImage ||
    null
  if (url == null || String(url).trim() === '') return null
  return String(url)
}

function rowLeaveDays(row) {
  return row?.leave_days ?? alDaysBetween(row?.from_date, row?.to_date)
}

function isCurrentYear(isoDate) {
  const d = fmtISO(isoDate)
  if (!d) return false
  return d.startsWith(String(new Date().getFullYear()))
}

function countsTowardUsage(row) {
  const status = row?.status
  return status === 'Approved' || status === 'Completed' || row?.actual_return_date != null
}

/** Entitlement from salary calculator snapshot when present on this request. */
export function getLeaveEntitlement(record) {
  const snap = record?.calculator_snapshot
  if (!snap || typeof snap !== 'object') return null
  const raw = snap.annual_leave_days_eligible ?? snap.annualLeaveDaysEligible
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Approved / completed leave days for this employee in the current calendar year. */
export function calculateLeaveUsed(record, allRequests) {
  if (record?._devMockLeaveUsed != null) {
    const n = Number(record._devMockLeaveUsed)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }
  const empId = record?.employee_id
  if (empId == null) return 0
  return (allRequests || [])
    .filter(
      (r) =>
        String(r.employee_id) === String(empId) &&
        r.status !== 'Rejected' &&
        isCurrentYear(r.from_date) &&
        countsTowardUsage(r),
    )
    .reduce((sum, r) => sum + rowLeaveDays(r), 0)
}

export function calculateLeaveRemaining(record, allRequests) {
  if (record?._devMockLeaveRemaining != null) {
    const n = Number(record._devMockLeaveRemaining)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const entitlement = getLeaveEntitlement(record)
  if (entitlement == null) return null
  return Math.max(0, entitlement - calculateLeaveUsed(record, allRequests))
}

export function getLeaveUsagePercent(record, allRequests) {
  const entitlement = getLeaveEntitlement(record)
  if (entitlement == null || entitlement <= 0) return null
  const used = calculateLeaveUsed(record, allRequests)
  return Math.min(100, Math.round((used / entitlement) * 100))
}

/** CSS modifier for restrained status styling. */
export function getStatusStyle(status) {
  const s = String(status || 'Pending')
  if (s === 'Approved' || s === 'Completed') return 'approved'
  if (s === 'Pending') return 'pending'
  if (s === 'Rejected') return 'rejected'
  if (s === 'Ongoing') return 'ongoing'
  if (s === 'ReturnPending' || s === 'Overstayed') return 'attention'
  return 'neutral'
}

function countByEffectiveStatus(allRequests, status) {
  return (allRequests || []).filter((r) => (r.effective_status || r.status) === status).length
}

function uniqueEmployeeCount(allRequests) {
  return new Set((allRequests || []).map((r) => r.employee_id).filter((id) => id != null)).size
}

function totalLeaveDaysUsedThisYear(allRequests) {
  return (allRequests || [])
    .filter((r) => r.status !== 'Rejected' && isCurrentYear(r.from_date) && countsTowardUsage(r))
    .reduce((sum, r) => sum + rowLeaveDays(r), 0)
}

function upcomingLeavesThisMonth(allRequests) {
  const month = new Date().toISOString().slice(0, 7)
  const today = new Date().toISOString().slice(0, 10)
  return (allRequests || []).filter((r) => {
    const from = fmtISO(r.from_date)
    return (
      r.status === 'Approved' &&
      from &&
      from.startsWith(month) &&
      from >= today
    )
  }).length
}

function employeesOnLeaveNow(allRequests) {
  const ids = new Set()
  ;(allRequests || []).forEach((r) => {
    if ((r.effective_status || r.status) === 'Ongoing') ids.add(r.employee_id)
  })
  return ids.size
}

/**
 * Overview metrics for the CEO header and summary cards.
 * Uses dashboard API stats when available, otherwise derives from requests.
 */
export function computeCeoOverviewStats(allRequests, dashboard, employeeCount) {
  const totalEmployees =
    employeeCount != null && employeeCount > 0
      ? employeeCount
      : uniqueEmployeeCount(allRequests)

  const onLeave = dashboard?.ongoing ?? countByEffectiveStatus(allRequests, 'Ongoing')
  const upcomingLeave = dashboard?.upcoming ?? countByEffectiveStatus(allRequests, 'Approved')
  const pendingRequests = dashboard?.pending ?? countByEffectiveStatus(allRequests, 'Pending')

  return {
    totalEmployees,
    onLeave,
    upcomingLeave,
    pendingRequests,
    totalLeaveDaysUsed: totalLeaveDaysUsedThisYear(allRequests),
    employeesOnLeave: employeesOnLeaveNow(allRequests),
    upcomingThisMonth: upcomingLeavesThisMonth(allRequests),
    pendingApprovals: pendingRequests,
  }
}

export const CEO_STATUS_FILTERS = [
  { key: 'All', label: 'All' },
  { key: 'Pending', label: 'Pending' },
  { key: 'Approved', label: 'Upcoming' },
  { key: 'Ongoing', label: 'On leave' },
  { key: 'ReturnPending', label: 'Return pending' },
  { key: 'Overstayed', label: 'Overstayed' },
  { key: 'Completed', label: 'Completed' },
  { key: 'Rejected', label: 'Rejected' },
]

export const CEO_SORT_OPTIONS = [
  { key: 'from_date_asc', label: 'Leave start (earliest)' },
  { key: 'from_date_desc', label: 'Leave start (latest)' },
  { key: 'name_asc', label: 'Name A–Z' },
  { key: 'days_desc', label: 'Longest leave' },
]
