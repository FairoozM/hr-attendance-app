import { useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'
import { employeesSocket } from '../api/socket'

function mapEmployee(row) {
  return {
    id: String(row.id),
    employeeId: row.employee_code,
    name: row.full_name,
    department: row.department,
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
