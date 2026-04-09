/**
 * Attendance visibility is controlled by `includeInAttendance` (API: include_in_attendance),
 * independent of employment status. Missing/undefined is treated as included for backward compatibility.
 */
export function isIncludedInAttendance(employee) {
  return employee?.includeInAttendance !== false
}

export function employeesForAttendance(employees) {
  if (!Array.isArray(employees)) return []
  return employees.filter(isIncludedInAttendance)
}
