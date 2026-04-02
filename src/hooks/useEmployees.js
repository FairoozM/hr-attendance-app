import { useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'
import { employeesSocket } from '../api/socket'

/**
 * Maps API row to UI employee. Extra fields are optional until backend adds columns.
 * employment_status (if added): 'active' | 'inactive' | 'on_leave' | 'resigned'
 */
function mapEmployee(row) {
  const rawStatus = row.employment_status
  let employmentStatus = 'active'
  if (rawStatus === 'on_leave' || rawStatus === 'On Leave') employmentStatus = 'on_leave'
  else if (rawStatus === 'inactive' || rawStatus === 'Inactive') employmentStatus = 'inactive'
  else if (rawStatus === 'resigned' || rawStatus === 'Resigned') employmentStatus = 'resigned'
  else if (row.is_active === false) employmentStatus = 'inactive'
  else employmentStatus = 'active'

  const joiningDate = row.joining_date
    ? String(row.joining_date).slice(0, 10)
    : null

  return {
    id: String(row.id),
    employeeId: row.employee_code,
    name: row.full_name,
    department: row.department,
    isActive: row.is_active !== false,
    employmentStatus,
    createdAt: row.created_at ?? null,
    joiningDate,
    photoUrl: row.photo_url ?? null,
    designation: row.designation ?? null,
    phone: row.phone ?? row.contact_number ?? null,
    email: row.email ?? null,
    passportNumber: row.passport_number ?? null,
    emiratesId: row.emirates_id ?? null,
    nationality: row.nationality ?? null,
  }
}

export const defaultEmployees = []

export function useEmployees() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchEmployees = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get('/api/employees')
      setEmployees(Array.isArray(data) ? data.map(mapEmployee) : [])
    } catch (err) {
      setError(err.message || 'Failed to load employees')
      setEmployees([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEmployees()
  }, [fetchEmployees])

  useEffect(() => {
    const onEmployeesChanged = () => {
      fetchEmployees()
    }
    employeesSocket.on('employees:changed', onEmployeesChanged)
    return () => {
      employeesSocket.off('employees:changed', onEmployeesChanged)
    }
  }, [fetchEmployees])

  const addEmployee = useCallback(
    async (employee) => {
      setError(null)
      try {
        const created = await api.post('/api/employees', {
          employee_code: employee.employeeId,
          full_name: employee.name,
          department: employee.department,
          employment_status: employee.employmentStatus || 'active',
          is_active: (employee.employmentStatus || 'active') !== 'inactive',
          joining_date: employee.joiningDate || null,
          photo_url: employee.photoUrl || null,
          phone: employee.phone || null,
          emirates_id: employee.emiratesId || null,
          passport_number: employee.passportNumber || null,
          nationality: employee.nationality || null,
        })
        setEmployees((prev) => [...prev, mapEmployee(created)])
      } catch (err) {
        const msg = err.body?.error || err.message || 'Failed to add employee'
        setError(msg)
        throw new Error(msg)
      }
    },
    []
  )

  const updateEmployee = useCallback(
    async (id, updates) => {
      setError(null)
      try {
        const updated = await api.put(`/api/employees/${id}`, {
          employee_code: updates.employeeId,
          full_name: updates.name,
          department: updates.department,
          employment_status: updates.employmentStatus || 'active',
          is_active: (updates.employmentStatus || 'active') !== 'inactive',
          joining_date: updates.joiningDate || null,
          photo_url: updates.photoUrl || null,
          phone: updates.phone || null,
          emirates_id: updates.emiratesId || null,
          passport_number: updates.passportNumber || null,
          nationality: updates.nationality || null,
        })
        setEmployees((prev) =>
          prev.map((e) => (e.id === id ? mapEmployee(updated) : e))
        )
      } catch (err) {
        const msg = err.body?.error || err.message || 'Failed to update employee'
        setError(msg)
        throw new Error(msg)
      }
    },
    []
  )

  const deleteEmployee = useCallback(
    async (id) => {
      setError(null)
      try {
        await api.delete(`/api/employees/${id}`)
        setEmployees((prev) => prev.filter((e) => e.id !== id))
      } catch (err) {
        const msg = err.body?.error || err.message || 'Failed to delete employee'
        setError(msg)
        throw new Error(msg)
      }
    },
    []
  )

  const resetToDefault = useCallback(() => {
    fetchEmployees()
  }, [fetchEmployees])

  return {
    employees,
    loading,
    error,
    addEmployee,
    updateEmployee,
    deleteEmployee,
    resetToDefault,
    refetch: fetchEmployees,
  }
}
