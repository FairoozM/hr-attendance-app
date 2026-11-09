import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { readEnumParam, readIntParam } from '../../lib/urlSearchParams'
import {
  type CalendarDate,
  clampToMonth,
  isSameMonth,
} from '../../utils/attendance/attendanceCalendar'
import { ROW_FILTERS, type RowFilter } from '../../utils/attendance/attendanceModel'

export const GRID_VIEWS = ['month', 'week'] as const
export type GridView = (typeof GRID_VIEWS)[number]

export interface AttendanceViewState {
  selected: CalendarDate
  department: string
  rowFilter: RowFilter
  view: GridView
}

type Patch = Partial<{ selected: CalendarDate; department: string; rowFilter: RowFilter; view: GridView }>

/** Default day for a month: today when it is the current month, otherwise the 1st. */
export function defaultDayFor(year: number, month: number, today: CalendarDate): CalendarDate {
  return isSameMonth({ year, month }, today) ? today : clampToMonth(year, month, 1)
}

/** Day to land on when switching months: today in the current month, else the same day number (clamped). */
export function dateForMonthSwitch(
  year: number,
  month: number,
  currentDay: number,
  today: CalendarDate
): CalendarDate {
  return isSameMonth({ year, month }, today) ? today : clampToMonth(year, month, currentDay)
}

/**
 * Month / selected day / department / row filter / view live in the URL so refresh and
 * shared links keep the same scope. Every change is written in one `setSearchParams` call.
 */
export function useAttendanceViewState(today: CalendarDate) {
  const [params, setParams] = useSearchParams()

  const state = useMemo<AttendanceViewState>(() => {
    const year = readIntParam(params, 'year', today.year, { min: 2000, max: 2100 })
    const month = readIntParam(params, 'month', today.month, { min: 0, max: 11 })
    const rawDay = readIntParam(params, 'day', 0, { min: 1, max: 31 })
    const selected = rawDay ? clampToMonth(year, month, rawDay) : defaultDayFor(year, month, today)
    return {
      selected,
      department: params.get('dept') || 'all',
      rowFilter: readEnumParam(params, 'rows', ROW_FILTERS, 'all'),
      view: readEnumParam(params, 'view', GRID_VIEWS, 'month'),
    }
  }, [params, today])

  const update = useCallback(
    (patch: Patch) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (patch.selected) {
            next.set('year', String(patch.selected.year))
            next.set('month', String(patch.selected.month))
            next.set('day', String(patch.selected.day))
          }
          if (patch.department !== undefined) {
            if (patch.department === 'all') next.delete('dept')
            else next.set('dept', patch.department)
          }
          if (patch.rowFilter !== undefined) {
            if (patch.rowFilter === 'all') next.delete('rows')
            else next.set('rows', patch.rowFilter)
          }
          if (patch.view !== undefined) {
            if (patch.view === 'month') next.delete('view')
            else next.set('view', patch.view)
          }
          return next
        },
        { replace: true }
      )
    },
    [setParams]
  )

  const selectDate = useCallback((date: CalendarDate) => update({ selected: date }), [update])
  const goToMonth = useCallback(
    (year: number, month: number) => update({ selected: dateForMonthSwitch(year, month, state.selected.day, today) }),
    [update, state.selected.day, today]
  )
  const goToToday = useCallback(() => update({ selected: today }), [update, today])
  const setDepartment = useCallback((department: string) => update({ department }), [update])
  const setRowFilter = useCallback((rowFilter: RowFilter) => update({ rowFilter }), [update])
  const setView = useCallback((view: GridView) => update({ view }), [update])

  return { ...state, selectDate, goToMonth, goToToday, setDepartment, setRowFilter, setView }
}
