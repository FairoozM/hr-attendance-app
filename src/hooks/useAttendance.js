import { useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'

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

function recordsToMaps(records) {
  const statusMap = {}
  const docMap = {}
  if (!Array.isArray(records)) return { statusMap, docMap }
  records.forEach((r) => {
    const empId = String(r.employee_id)
    if (!statusMap[empId]) statusMap[empId] = {}
    const d = r.attendance_date
    const day = typeof d === 'string' ? parseInt(d.slice(8, 10), 10) : d.getDate()
    statusMap[empId][day] = r.status
    if (r.sick_leave_document_url) {
      if (!docMap[empId]) docMap[empId] = {}
      docMap[empId][day] = r.sick_leave_document_url
    }
  })
  return { statusMap, docMap }
}

export function useAttendance(employees, month, year) {
  const { user } = useAuth()
  const [attendance, setAttendanceState] = useState({})
  const [sickLeaveDocuments, setSickLeaveDocuments] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const monthApi = month + 1
  const yearApi = year

  useEffect(() => {
    if (!user) {
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .get(`/api/attendance?month=${monthApi}&year=${yearApi}`)
      .then((data) => {
        if (cancelled) return
        const { statusMap, docMap } = recordsToMaps(data)
        setAttendanceState(statusMap)
        setSickLeaveDocuments(docMap)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load attendance')
          setAttendanceState({})
          setSickLeaveDocuments({})
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [monthApi, yearApi, user])

  useEffect(() => {
    setSickLeaveDocuments((prev) => {
      let next = null
      employees.forEach((emp) => {
        const empDocs = prev[emp.id]
        if (!empDocs) return
        Object.keys(empDocs).forEach((dayStr) => {
          const day = Number(dayStr)
          const status = attendance[emp.id]?.[day]
          if (status !== 'SL' && empDocs[day]) {
            if (!next) next = { ...prev }
            if (!next[emp.id]) next[emp.id] = { ...prev[emp.id] }
            next[emp.id] = { ...next[emp.id] }
            delete next[emp.id][day]
            if (Object.keys(next[emp.id]).length === 0) delete next[emp.id]
          }
        })
      })
      return next || prev
    })
  }, [attendance, employees])

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
            if (nextVal === undefined) continue
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const empId = Number(emp.id)
            api
              .put('/api/attendance', {
                employee_id: empId,
                attendance_date: dateStr,
                status: nextVal,
              })
              .catch((e) => console.error('Attendance save failed', e))
          }
        })
        return next
      })
    },
    [employees, month, year]
  )

  const uploadSickLeaveDocument = useCallback(
    async (employeeId, day, file) => {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const prep = await api.post('/api/attendance/sick-leave-upload-url', {
        employee_id: Number(employeeId),
        attendance_date: dateStr,
        file_name: file.name,
        file_type: file.type,
      })
      const putRes = await fetch(prep.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': prep.contentType || file.type || 'application/octet-stream' },
      })
      if (!putRes.ok) {
        throw new Error(`S3 upload failed (${putRes.status})`)
      }
      const record = await api.post('/api/attendance/sick-leave-document', {
        employee_id: Number(employeeId),
        attendance_date: dateStr,
        key: prep.key,
      })
      if (record?.sick_leave_document_url) {
        const idKey = String(employeeId)
        setSickLeaveDocuments((prev) => ({
          ...prev,
          [idKey]: {
            ...prev[idKey],
            [day]: record.sick_leave_document_url,
          },
        }))
      }
      return record
    },
    [month, year]
  )

  const removeSickLeaveDocument = useCallback(
    async (employeeId, day) => {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const q = new URLSearchParams({
        employee_id: String(employeeId),
        attendance_date: dateStr,
      })
      await api.delete(`/api/attendance/sick-leave-document?${q.toString()}`)
      const idKey = String(employeeId)
      setSickLeaveDocuments((prev) => {
        const copy = { ...prev }
        if (copy[idKey]?.[day]) {
          copy[idKey] = { ...copy[idKey] }
          delete copy[idKey][day]
          if (Object.keys(copy[idKey]).length === 0) delete copy[idKey]
        }
        return copy
      })
    },
    [month, year]
  )

  return {
    attendance,
    sickLeaveDocuments,
    setAttendance,
    uploadSickLeaveDocument,
    removeSickLeaveDocument,
    loading,
    error,
  }
}
