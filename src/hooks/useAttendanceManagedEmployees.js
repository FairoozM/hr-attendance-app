import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'

/**
 * Maps a raw DB employee row (snake_case) to the UI employee shape used
 * by AttendancePage / AttendanceGrid.
 */
function mapRow(row) {
  return {
    id: String(row.id),
    employeeId: row.employee_code,
    name: row.full_name,
    department: row.department,
    isActive: row.is_active !== false,
    joiningDate: row.joining_date ? String(row.joining_date).slice(0, 10) : null,
    photoUrl: row.photo_url ?? null,
    phone: row.phone ?? null,
    designation: row.designation ?? null,
    employmentStatus: row.employment_status ?? 'active',
    weeklyOffDay: row.weekly_off_day ?? null,
    dutyLocation: row.duty_location ?? null,
    includeInAttendance: row.include_in_attendance !== false,
    nationality: row.nationality ?? null,
    emiratesId: row.emirates_id ?? null,
    passportNumber: row.passport_number ?? null,
  }
}

/**
 * Returns the list of employees this user is allowed to manage / view in
 * the Attendance module.
 *
 * - Admin / warehouse:  all active employees (same as useEmployees)
 * - Employee with attendance permission:  only their assigned employees
 *
 * Falls back to the full useEmployees list when the user doesn't have
 * attendance permission (caller should gate behind PermissionGuard anyway).
 */
export function useAttendanceManagedEmployees() {
  const { user } = useAuth()
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchManaged = useCallback(async () => {
    if (!user) {
      setEmployees([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await api.get('/api/attendance/managed-employees')
      setEmployees(Array.isArray(data) ? data.map(mapRow) : [])
    } catch (err) {
      setError(err.message || 'Failed to load employees')
      setEmployees([])
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    fetchManaged()
  }, [fetchManaged])

  return { employees, loading, error, refetch: fetchManaged }
}
