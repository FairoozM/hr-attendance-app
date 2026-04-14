import { fmtDMY } from '../../utils/dateFormat'

/** Prefer explicit HR joining date, else record created_at. */
export function effectiveJoiningDate(emp) {
  if (!emp) return null
  return emp.joiningDate || emp.createdAt || null
}

/** @param {string|null|undefined} iso */
export function formatJoiningDate(iso) {
  if (!iso) return null
  const s = fmtDMY(iso)
  return s === '—' ? null : s
}

export function displayOrDash(v) {
  if (v == null || String(v).trim() === '') return '—'
  return String(v).trim()
}

/** Profile text first, then duty_location enum label (employee form “Primary work location”). */
export function primaryWorkLocationLabel(emp) {
  if (!emp) return null
  const text = typeof emp.workLocation === 'string' ? emp.workLocation.trim() : ''
  if (text) return text
  if (emp.dutyLocation === 'warehouse') return 'Warehouse'
  if (emp.dutyLocation === 'office') return 'Office'
  if (emp.dutyLocation === 'remote') return 'Remote'
  return null
}

/** @param {string} name */
export function employmentStatusLabel(status) {
  const m = {
    active: 'Active',
    inactive: 'Inactive',
    on_leave: 'On leave',
    resigned: 'Resigned',
  }
  return m[status] || '—'
}

export function initialsFromName(name) {
  if (!name || typeof name !== 'string') return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
