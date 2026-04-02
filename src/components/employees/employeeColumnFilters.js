import { formatJoiningDate, effectiveJoiningDate, employmentStatusLabel } from './employeeUtils'

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

/** Options for Excel-style checkbox filter: distinct values + (Blanks) when needed. */
export function buildExcelColumnOptions(employees, key) {
  const seen = new Set()
  employees.forEach((emp) => {
    const v = getEmployeeFilterValue(emp, key)
    seen.add(v ? v : BLANK_VALUE)
  })
  const nonBlank = [...seen].filter((x) => x !== BLANK_VALUE)
  nonBlank.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  const opts = []
  if (seen.has(BLANK_VALUE)) {
    opts.push({ value: BLANK_VALUE, label: '(Blanks)' })
  }
  for (const v of nonBlank) {
    const label = key === 'status' ? employmentStatusLabel(v) : v
    opts.push({ value: v, label })
  }
  return opts
}

/**
 * `filters[key]` is `undefined` = all values included (no filter).
 * Otherwise `Set` of allowed raw values; use BLANK_VALUE for empty cells.
 */
export function matchesColumnFilters(emp, filters) {
  for (const key of EMPLOYEE_COLUMN_FILTER_KEYS) {
    const inc = filters[key]
    if (inc === undefined || inc === null) continue
    const raw = getEmployeeFilterValue(emp, key)
    const normalized = raw ? raw : BLANK_VALUE
    if (!inc.has(normalized)) return false
  }
  return true
}

export function emptyColumnFilters() {
  return {}
}
