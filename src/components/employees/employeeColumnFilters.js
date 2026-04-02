import { formatJoiningDate, effectiveJoiningDate } from './employeeUtils'

export const EMPLOYEE_COLUMN_FILTER_KEYS = [
  'name',
  'employeeId',
  'department',
  'designation',
  'phone',
  'email',
  'joining',
  'passport',
  'nationality',
  'emirates',
  'status',
]

export const ALL_VALUE = '__all__'
export const BLANK_VALUE = '__blank__'

/** Raw comparable value for filtering (not display). */
export function getEmployeeFilterValue(emp, key) {
  switch (key) {
    case 'name':
      return (emp.name || '').trim()
    case 'employeeId':
      return (emp.employeeId || '').trim()
    case 'department':
      return (emp.department || '').trim()
    case 'designation':
      return (emp.designation || '').trim()
    case 'phone':
      return (emp.phone || '').trim()
    case 'email':
      return (emp.email || '').trim()
    case 'joining':
      return formatJoiningDate(effectiveJoiningDate(emp)) || ''
    case 'passport':
      return (emp.passportNumber || '').trim()
    case 'nationality':
      return (emp.nationality || '').trim()
    case 'emirates':
      return (emp.emiratesId || '').trim()
    case 'status':
      return emp.employmentStatus || ''
    default:
      return ''
  }
}

export function buildSelectOptions(employees, key) {
  const set = new Set()
  employees.forEach((emp) => {
    const v = getEmployeeFilterValue(emp, key)
    if (v) set.add(v)
  })
  const sorted = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  const opts = [{ value: ALL_VALUE, label: 'All' }]
  opts.push({ value: BLANK_VALUE, label: '(Blanks)' })
  sorted.forEach((v) => opts.push({ value: v, label: v }))
  return opts
}

export function matchesColumnFilters(emp, filters) {
  for (const key of EMPLOYEE_COLUMN_FILTER_KEYS) {
    const f = filters[key]
    if (!f || f === ALL_VALUE) continue
    const raw = getEmployeeFilterValue(emp, key)
    if (f === BLANK_VALUE) {
      if (raw) return false
    } else if (raw !== f) {
      return false
    }
  }
  return true
}

export function emptyColumnFilters() {
  return Object.fromEntries(EMPLOYEE_COLUMN_FILTER_KEYS.map((k) => [k, ALL_VALUE]))
}
