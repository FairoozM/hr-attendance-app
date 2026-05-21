import { fmtISO } from './dateFormat'

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
