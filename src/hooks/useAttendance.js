import { useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'

export function storageKey(month, year) {
  return `hr-attendance-${year}-${String(month + 1).padStart(2, '0')}`
}

export function clearAllAttendanceStorage() {
  try {
    const keys = Object.keys(localStorage)
    keys.forEach((key) => {
      if (/^hr-attendance-\d{4}-\d{2}$/.test(key)) {
        localStorage.removeItem(key)
      }
    })
  } catch (_) {}
}

function recordsToMap(records) {
  const map = {}
  if (!Array.isArray(records)) return map
  records.forEach((r) => {
    const empId = String(r.employee_id)
    if (!map[empId]) map[empId] = {}
    const d = r.attendance_date
    const day = typeof d === 'string' ? parseInt(d.slice(8, 10), 10) : d.getDate()
    map[empId][day] = r.status
  })
  return map
}

export function useAttendance(employees, month, year) {
  const [attendance, setAttendanceState] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const monthApi = month + 1
  const yearApi = year

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .get(`/api/attendance?month=${monthApi}&year=${yearApi}`)
      .then((data) => {
        if (!cancelled) setAttendanceState(recordsToMap(data))
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load attendance')
          setAttendanceState({})
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [monthApi, yearApi])

  const setAttendance = useCallback(
    (updater) => {
      setAttendanceState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        const daysInMonth = new Date(year, month + 1, 0).getDate()
        employees.forEach((emp) => {
          for (let day = 1; day <= daysInMonth; day++) {
            const prevVal = prev[emp.id]?.[day]
            const nextVal = next[emp.id]?.[day]
            if (prevVal === nextVal) continue
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const empId = Number(emp.id)
            if (nextVal) {
              api
                .put('/api/attendance', {
                  employee_id: empId,
                  attendance_date: dateStr,
                  status: nextVal,
                })
                .catch((e) => console.error('Attendance save failed', e))
            } else if (prevVal) {
              const q = new URLSearchParams({
                employee_id: String(empId),
                attendance_date: dateStr,
              })
              api
                .delete(`/api/attendance?${q.toString()}`)
                .catch((e) => console.error('Attendance clear failed', e))
            }
          }
        })
        return next
      })
    },
    [employees, month, year]
  )

  return { attendance, setAttendance, loading, error }
}
