import { useCallback, useEffect, useRef, useState } from 'react'
import { api, isAbortError } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import { resolveEmployeePhotoUrl } from '../../lib/employeePhotoUrl'
import type { AttendanceEmployee } from '../../utils/attendance/attendanceModel'

interface ManagedEmployeeRow {
  id: number | string
  employee_code?: string | null
  full_name?: string | null
  department?: string | null
  designation?: string | null
  weekly_off_day?: string | null
  include_in_attendance?: boolean | null
  photo_url?: string | null
  photo_url_signed?: string | null
  photo_doc_key?: string | null
}

function toEmployee(row: ManagedEmployeeRow): AttendanceEmployee {
  return {
    id: String(row.id),
    name: (row.full_name || '').trim() || `Employee #${row.id}`,
    employeeCode: row.employee_code ?? null,
    department: row.department ?? null,
    designation: row.designation ?? null,
    photoUrl: resolveEmployeePhotoUrl(row) || null,
    weeklyOffDay: row.weekly_off_day ?? null,
  }
}

/**
 * Employees this user may see in Attendance (server-scoped by role / assignments),
 * limited to those flagged `include_in_attendance`.
 */
export function useAttendanceEmployees() {
  const { user } = useAuth()
  const [employees, setEmployees] = useState<AttendanceEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    controllerRef.current?.abort()
    if (!user) {
      setEmployees([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const rows = (await api.get('/api/attendance/managed-employees', { signal: controller.signal })) as unknown
      if (controller.signal.aborted) return
      const list = Array.isArray(rows) ? (rows as ManagedEmployeeRow[]) : []
      setEmployees(list.filter((row) => row.include_in_attendance !== false).map(toEmployee))
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) return
      setError((err as Error)?.message || 'Failed to load employees')
      setEmployees([])
    } finally {
      if (controllerRef.current === controller) setLoading(false)
    }
  }, [user])

  useEffect(() => {
    load()
    return () => controllerRef.current?.abort()
  }, [load])

  return { employees, loading, error, reload: load }
}
