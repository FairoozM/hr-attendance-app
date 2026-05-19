/** Shared column definitions for the employees directory table and CSV export. */
export const EMPLOYEE_TABLE_COLUMNS = [
  { id: 'sr', label: 'Sr.' },
  { id: 'photo', label: 'Photo' },
  { id: 'name', label: 'Employee name', sortKey: 'name', filterKey: 'name', filterId: 'emp-col-name' },
  { id: 'employeeId', label: 'Employee ID', filterKey: 'employeeId', filterId: 'emp-col-employeeId' },
  { id: 'department', label: 'Department', sortKey: 'department', filterKey: 'department', filterId: 'emp-col-department' },
  { id: 'designation', label: 'Designation', filterKey: 'designation', filterId: 'emp-col-designation' },
  {
    id: 'primaryLocation',
    label: 'Primary work location',
    sortKey: 'primaryLocation',
    filterKey: 'primaryLocation',
    filterId: 'emp-col-primary-location',
  },
  { id: 'phone', label: 'Contact', filterKey: 'phone', filterId: 'emp-col-phone' },
  { id: 'email', label: 'Email', filterKey: 'email', filterId: 'emp-col-email' },
  { id: 'joining', label: 'Joining date', sortKey: 'joiningDate', filterKey: 'joining', filterId: 'emp-col-joining' },
  { id: 'passport', label: 'Passport no.', filterKey: 'passport', filterId: 'emp-col-passport' },
  { id: 'nationality', label: 'Nationality', filterKey: 'nationality', filterId: 'emp-col-nationality' },
  { id: 'emirates', label: 'Emirates ID', filterKey: 'emirates', filterId: 'emp-col-emirates' },
  {
    id: 'status',
    label: 'Status',
    sortKey: 'employmentStatus',
    filterKey: 'status',
    filterId: 'emp-col-status',
    sticky: 'status',
  },
  { id: 'actions', label: 'Actions', sticky: 'actions' },
]

const NON_EXPORT_COLUMN_IDS = new Set(['sr', 'photo', 'actions'])

/** Data columns shown in the table (excludes Sr., photo, and row actions). */
export function getEmployeeExportColumns() {
  return EMPLOYEE_TABLE_COLUMNS.filter((col) => !NON_EXPORT_COLUMN_IDS.has(col.id))
}
