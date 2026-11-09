import { useCallback, useEffect, useRef, useState } from 'react'
import { api, isAbortError } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import { type CalendarDate, toIsoDate } from '../../utils/attendance/attendanceCalendar'
import {
  type AttendanceApiRow,
  type AttendanceEmployee,
  type DayRecord,
  EXPLICIT_BLANK,
  type MonthRecords,
  rowToRecord,
  rowsToMonthRecords,
  type StatusCode,
} from '../../utils/attendance/attendanceModel'

export type CellAction =
  | { kind: 'status'; status: StatusCode }
  /** Delete the record (day falls back to its schedule). */
  | { kind: 'clear' }
  /** Store `-`: unmarked even though it is the employee's weekly off day. */
  | { kind: 'not-holiday' }

export interface CellSaveState {
  state: 'saving' | 'saved' | 'error'
  message?: string
  retry?: () => void
}

const EMPTY_RECORDS: MonthRecords = {}
const SAVED_FLASH_MS = 2500

export function saveStateKey(employeeId: string, date: CalendarDate): string {
  return `${toIsoDate(date)}:${employeeId}`
}

function monthKeyOf(year: number, month: number): string {
  return `${year}-${month}`
}

function withRecord(records: MonthRecords, employeeId: string, day: number, record: DayRecord | null): MonthRecords {
  const employeeDays = { ...(records[employeeId] || {}) }
  if (record) employeeDays[day] = record
  else delete employeeDays[day]
  return { ...records, [employeeId]: employeeDays }
}

function errorMessage(err: unknown, fallback: string): string {
  const e = err as { body?: { error?: string }; message?: string } | null
  return e?.body?.error || e?.message || fallback
}

/**
 * Loads one month of attendance and owns every write to it.
 * - Responses for a month the user already left are discarded (abort + month key check).
 * - Saves are optimistic, rolled back on failure, and one per cell at a time.
 */
export function useAttendanceMonth(year: number, month: number) {
  const { user } = useAuth()
  const monthKey = monthKeyOf(year, month)
  const [data, setData] = useState<{ key: string; records: MonthRecords } | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [saveStates, setSaveStates] = useState<Record<string, CellSaveState>>({})
  const dataRef = useRef(data)
  dataRef.current = data
  const inFlight = useRef(new Set<string>())
  const flashTimers = useRef(new Map<string, number>())

  useEffect(() => {
    if (!user) return undefined
    const controller = new AbortController()
    setError(null)
    api
      .get(`/api/attendance?month=${month + 1}&year=${year}`, { signal: controller.signal })
      .then((rows: unknown) => {
        if (controller.signal.aborted) return
        setData({ key: monthKey, records: rowsToMonthRecords(rows, year, month) })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError({ key: monthKey, message: errorMessage(err, 'Failed to load attendance') })
      })
    return () => controller.abort()
  }, [user, year, month, monthKey, reloadToken])

  useEffect(() => {
    const timers = flashTimers.current
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [])

  const setCellState = useCallback((key: string, next: CellSaveState | null) => {
    const pending = flashTimers.current.get(key)
    if (pending) {
      window.clearTimeout(pending)
      flashTimers.current.delete(key)
    }
    setSaveStates((prev) => {
      const copy = { ...prev }
      if (next) copy[key] = next
      else delete copy[key]
      return copy
    })
    if (next?.state === 'saved') {
      const id = window.setTimeout(() => {
        flashTimers.current.delete(key)
        setSaveStates((prev) => {
          if (prev[key]?.state !== 'saved') return prev
          const copy = { ...prev }
          delete copy[key]
          return copy
        })
      }, SAVED_FLASH_MS)
      flashTimers.current.set(key, id)
    }
  }, [])

  const applyRecord = useCallback((key: string, employeeId: string, day: number, record: DayRecord | null) => {
    setData((prev) => (prev && prev.key === key ? { key, records: withRecord(prev.records, employeeId, day, record) } : prev))
  }, [])

  const currentRecord = (key: string, employeeId: string, day: number): DayRecord | null => {
    const current = dataRef.current
    return current && current.key === key ? (current.records[employeeId]?.[day] ?? null) : null
  }

  const saveCell = useCallback(
    async (employee: AttendanceEmployee, date: CalendarDate, action: CellAction): Promise<boolean> => {
      const key = monthKeyOf(date.year, date.month)
      const stateKey = saveStateKey(employee.id, date)
      if (inFlight.current.has(stateKey)) return false
      const previous = currentRecord(key, employee.id, date.day)
      let optimistic: DayRecord | null = null
      if (action.kind === 'status') {
        optimistic = {
          status: action.status,
          annualLeaveId: action.status === 'AL' ? (previous?.annualLeaveId ?? null) : null,
          documentUrl: action.status === 'SL' ? (previous?.documentUrl ?? null) : null,
        }
      } else if (action.kind === 'not-holiday') {
        optimistic = { status: EXPLICIT_BLANK, annualLeaveId: null, documentUrl: null }
      }
      if (action.kind !== 'clear' && previous?.status === optimistic?.status) return true
      if (action.kind === 'clear' && !previous) return true

      inFlight.current.add(stateKey)
      setCellState(stateKey, { state: 'saving' })
      applyRecord(key, employee.id, date.day, optimistic)
      const isoDate = toIsoDate(date)
      try {
        if (action.kind === 'clear') {
          const query = new URLSearchParams({ employee_id: employee.id, attendance_date: isoDate })
          await api.delete(`/api/attendance?${query.toString()}`)
          applyRecord(key, employee.id, date.day, null)
        } else {
          const row = (await api.put('/api/attendance', {
            employee_id: Number(employee.id),
            attendance_date: isoDate,
            status: optimistic?.status,
          })) as AttendanceApiRow | null
          if (row) applyRecord(key, employee.id, date.day, rowToRecord(row))
        }
        setCellState(stateKey, { state: 'saved' })
        return true
      } catch (err) {
        applyRecord(key, employee.id, date.day, previous)
        setCellState(stateKey, {
          state: 'error',
          message: errorMessage(err, 'Could not save attendance'),
          retry: () => {
            void saveCell(employee, date, action)
          },
        })
        return false
      } finally {
        inFlight.current.delete(stateKey)
      }
    },
    [applyRecord, setCellState]
  )

  const uploadDocument = useCallback(
    async (employee: AttendanceEmployee, date: CalendarDate, file: File): Promise<boolean> => {
      const key = monthKeyOf(date.year, date.month)
      const stateKey = saveStateKey(employee.id, date)
      if (inFlight.current.has(stateKey)) return false
      inFlight.current.add(stateKey)
      setCellState(stateKey, { state: 'saving' })
      const isoDate = toIsoDate(date)
      try {
        const prep = (await api.post('/api/attendance/sick-leave-upload-url', {
          employee_id: Number(employee.id),
          attendance_date: isoDate,
          file_name: file.name,
          file_type: file.type,
        })) as { uploadUrl: string; key: string; contentType?: string }
        const putRes = await fetch(prep.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': prep.contentType || file.type || 'application/octet-stream' },
        })
        if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`)
        const row = (await api.post('/api/attendance/sick-leave-document', {
          employee_id: Number(employee.id),
          attendance_date: isoDate,
          key: prep.key,
        })) as AttendanceApiRow | null
        if (row) applyRecord(key, employee.id, date.day, rowToRecord(row))
        setCellState(stateKey, { state: 'saved' })
        return true
      } catch (err) {
        setCellState(stateKey, { state: 'error', message: errorMessage(err, 'Certificate upload failed') })
        return false
      } finally {
        inFlight.current.delete(stateKey)
      }
    },
    [applyRecord, setCellState]
  )

  const removeDocument = useCallback(
    async (employee: AttendanceEmployee, date: CalendarDate): Promise<boolean> => {
      const key = monthKeyOf(date.year, date.month)
      const stateKey = saveStateKey(employee.id, date)
      if (inFlight.current.has(stateKey)) return false
      const previous = currentRecord(key, employee.id, date.day)
      inFlight.current.add(stateKey)
      setCellState(stateKey, { state: 'saving' })
      try {
        const query = new URLSearchParams({ employee_id: employee.id, attendance_date: toIsoDate(date) })
        await api.delete(`/api/attendance/sick-leave-document?${query.toString()}`)
        if (previous) applyRecord(key, employee.id, date.day, { ...previous, documentUrl: null })
        setCellState(stateKey, { state: 'saved' })
        return true
      } catch (err) {
        setCellState(stateKey, { state: 'error', message: errorMessage(err, 'Could not remove certificate') })
        return false
      } finally {
        inFlight.current.delete(stateKey)
      }
    },
    [applyRecord, setCellState]
  )

  const dismissSaveState = useCallback((stateKey: string) => setCellState(stateKey, null), [setCellState])
  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  const currentError = error && error.key === monthKey ? error.message : null
  const ready = data?.key === monthKey
  return {
    records: ready ? data.records : EMPTY_RECORDS,
    loading: Boolean(user) && !ready && !currentError,
    error: currentError,
    reload,
    saveCell,
    uploadDocument,
    removeDocument,
    saveStates,
    dismissSaveState,
  }
}
