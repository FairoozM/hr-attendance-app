import { downloadBlob } from '../../api/client'
import {
  effectiveJoiningDate,
  employmentStatusLabel,
  formatJoiningDate,
  primaryWorkLocationLabel,
} from './employeeUtils'
import { getEmployeeExportColumns } from './employeeTableColumns'

function csvEscape(value) {
  const s = String(value ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportCellValue(emp, columnId) {
  switch (columnId) {
    case 'name':
      return emp.name || ''
    case 'employeeId':
      return emp.employeeId || ''
    case 'department':
      return emp.department || ''
    case 'designation':
      return emp.designation || ''
    case 'primaryLocation':
      return primaryWorkLocationLabel(emp) || ''
    case 'phone':
      return emp.phone || ''
    case 'email':
      return emp.email || ''
    case 'joining':
      return formatJoiningDate(effectiveJoiningDate(emp)) || ''
    case 'passport':
      return emp.passportNumber || ''
    case 'nationality':
      return emp.nationality || ''
    case 'emirates':
      return emp.emiratesId || ''
    case 'status':
      return employmentStatusLabel(emp.employmentStatus)
    default:
      return ''
  }
}

export function buildEmployeesCsv(employees, columns = getEmployeeExportColumns()) {
  const header = columns.map((col) => col.label)
  const rows = employees.map((emp) => columns.map((col) => exportCellValue(emp, col.id)))
  return `${[header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n')}\r\n`
}

export function employeesExportFilename(date = new Date()) {
  const iso = date.toISOString().slice(0, 10)
  return `employees-${iso}.csv`
}

export function downloadEmployeesCsv(employees, options = {}) {
  const columns = options.columns ?? getEmployeeExportColumns()
  const csv = buildEmployeesCsv(employees, columns)
  const filename = options.filename ?? employeesExportFilename()
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)
}
