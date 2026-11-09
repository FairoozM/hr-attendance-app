import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { saveStateKey, useAttendanceMonth } from './useAttendanceMonth'
import { dateForMonthSwitch } from './useAttendanceViewState'

vi.mock('../../contexts/AuthContext', () => {
  const auth = { user: { userId: 1, role: 'admin' } }
  return { useAuth: () => auth }
})

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
  isAbortError: (err: unknown) => (err as Error)?.name === 'AbortError',
}))

const mockedApi = api as unknown as Record<'get' | 'put' | 'post' | 'delete', ReturnType<typeof vi.fn>>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const employee = { id: '7', name: 'Ali' }
const nov9 = { year: 2026, month: 10, day: 9 }

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAttendanceMonth', () => {
  it('ignores a slow response for a month the user already left', async () => {
    const october = deferred<unknown>()
    const november = deferred<unknown>()
    mockedApi.get.mockImplementation((path: string) => (path.includes('month=10') ? october.promise : november.promise))

    const { result, rerender } = renderHook(({ month }) => useAttendanceMonth(2026, month), {
      initialProps: { month: 9 },
    })
    rerender({ month: 10 })
    await act(async () => {
      november.resolve([{ employee_id: 7, attendance_date: '2026-11-09', status: 'P' }])
    })
    await act(async () => {
      october.resolve([{ employee_id: 7, attendance_date: '2026-10-09', status: 'A' }])
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.records['7'][9].status).toBe('P')
  })

  it('saves optimistically, blocks duplicate saves for the same cell, and rolls back on failure', async () => {
    mockedApi.get.mockResolvedValue([{ employee_id: 7, attendance_date: '2026-11-09', status: 'A' }])
    const put = deferred<unknown>()
    mockedApi.put.mockReturnValue(put.promise)

    const { result } = renderHook(() => useAttendanceMonth(2026, 10))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = result.current.saveCell(employee, nov9, { kind: 'status', status: 'P' })
      second = result.current.saveCell(employee, nov9, { kind: 'status', status: 'SL' })
    })
    expect(mockedApi.put).toHaveBeenCalledTimes(1)
    expect(result.current.records['7'][9].status).toBe('P')
    expect(result.current.saveStates[saveStateKey('7', nov9)].state).toBe('saving')
    await expect(second).resolves.toBe(false)

    await act(async () => {
      put.reject(Object.assign(new Error('Server down'), { body: { error: 'Server down' } }))
      await first
    })
    expect(result.current.records['7'][9].status).toBe('A')
    expect(result.current.saveStates[saveStateKey('7', nov9)]).toMatchObject({ state: 'error', message: 'Server down' })
  })

  it('clears a record with DELETE and keeps the server row (including the leave link) after PUT', async () => {
    mockedApi.get.mockResolvedValue([{ employee_id: 7, attendance_date: '2026-11-09', status: 'P' }])
    mockedApi.delete.mockResolvedValue(null)
    mockedApi.put.mockResolvedValue({ employee_id: 7, attendance_date: '2026-11-10', status: 'AL', annual_leave_id: null })
    const { result } = renderHook(() => useAttendanceMonth(2026, 10))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.saveCell(employee, nov9, { kind: 'clear' })
    })
    expect(mockedApi.delete).toHaveBeenCalledWith('/api/attendance?employee_id=7&attendance_date=2026-11-09')
    expect(result.current.records['7'][9]).toBeUndefined()

    await act(async () => {
      await result.current.saveCell(employee, { ...nov9, day: 10 }, { kind: 'status', status: 'AL' })
    })
    expect(mockedApi.put).toHaveBeenCalledWith('/api/attendance', {
      employee_id: 7,
      attendance_date: '2026-11-10',
      status: 'AL',
    })
    expect(result.current.records['7'][10]).toEqual({ status: 'AL', annualLeaveId: null, documentUrl: null })
  })
})

describe('dateForMonthSwitch', () => {
  const today = { year: 2026, month: 10, day: 9 }
  it('lands on today in the current month and clamps the day elsewhere', () => {
    expect(dateForMonthSwitch(2026, 10, 31, today)).toEqual(today)
    expect(dateForMonthSwitch(2026, 1, 31, today)).toEqual({ year: 2026, month: 1, day: 28 })
    expect(dateForMonthSwitch(2028, 1, 30, today)).toEqual({ year: 2028, month: 1, day: 29 })
  })
})
