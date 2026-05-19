import { describe, expect, it } from 'vitest'
import { buildEmployeesCsv, employeesExportFilename } from './employeeExport'
import { getEmployeeExportColumns } from './employeeTableColumns'

const sample = [
  {
    id: '1',
    name: 'Jane Doe',
    employeeId: 'EMP001',
    department: 'HR',
    designation: 'Manager',
    dutyLocation: 'office',
    phone: '+971 50 123 4567',
    email: 'jane@example.com',
    joiningDate: '2024-01-15',
    passportNumber: 'P123',
    nationality: 'UAE',
    emiratesId: '784-1234',
    employmentStatus: 'active',
  },
]

describe('employeeExport', () => {
  it('builds CSV with table data columns only', () => {
    const csv = buildEmployeesCsv(sample)
    const lines = csv.trim().split(/\r?\n/)
    expect(lines[0]).toContain('Employee name')
    expect(lines[0]).not.toContain('Sr.')
    expect(lines[0]).not.toContain('Photo')
    expect(lines[0]).not.toContain('Actions')
    expect(lines[1]).toContain('Jane Doe')
    expect(lines[1]).toContain('EMP001')
    expect(lines[1]).toContain('Active')
  })

  it('escapes commas and quotes in cell values', () => {
    const csv = buildEmployeesCsv([
      {
        ...sample[0],
        name: 'Smith, "Jr."',
        department: 'Sales',
      },
    ])
    expect(csv).toContain('"Smith, ""Jr.""')
  })

  it('uses a dated export filename', () => {
    expect(employeesExportFilename(new Date('2026-05-19T12:00:00Z'))).toBe('employees-2026-05-19.csv')
  })

  it('export columns match every non-ui table column', () => {
    const exportIds = getEmployeeExportColumns().map((c) => c.id)
    expect(exportIds).toEqual([
      'name',
      'employeeId',
      'department',
      'designation',
      'primaryLocation',
      'phone',
      'email',
      'joining',
      'passport',
      'nationality',
      'emirates',
      'status',
    ])
  })
})
