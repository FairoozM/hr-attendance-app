import { AlertCircle, Loader2 } from 'lucide-react'
import { type CSSProperties, type KeyboardEvent, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type CellAction, type CellSaveState, saveStateKey } from '../../hooks/attendance/useAttendanceMonth'
import {
  type CalendarDate,
  compareDates,
  daysInMonth,
  formatDate,
  isSameDate,
  WEEKDAY_SHORT,
  weekdayOf,
} from '../../utils/attendance/attendanceCalendar'
import {
  type AttendanceEmployee,
  type CellInfo,
  cellSourceLabel,
  departmentOf,
  employeeMonthTotals,
  type ResolveContext,
  resolveCell,
  STATUS_CODES,
  STATUS_LABELS,
} from '../../utils/attendance/attendanceModel'
import { AttendanceAvatar } from './AttendanceAvatar'
import { AttendanceCellMenu } from './AttendanceCellMenu'
import type { GridView } from '../../hooks/attendance/useAttendanceViewState'

interface Props {
  employees: AttendanceEmployee[]
  selected: CalendarDate
  today: CalendarDate
  ctx: ResolveContext
  view: GridView
  canManage: boolean
  saveStates: Record<string, CellSaveState>
  onSelectDate: (date: CalendarDate) => void
  onAction: (employee: AttendanceEmployee, date: CalendarDate, action: CellAction) => void
  onUpload: (employee: AttendanceEmployee, date: CalendarDate, file: File) => void
  onRemoveDocument: (employee: AttendanceEmployee, date: CalendarDate) => void
  onDismissError: (key: string) => void
}

/** Days shown in week view: Monday–Sunday around the selected day, clipped to the loaded month. */
export function visibleDays(selected: CalendarDate, view: GridView): number[] {
  const dim = daysInMonth(selected.year, selected.month)
  if (view === 'month') return Array.from({ length: dim }, (_, i) => i + 1)
  const offset = (weekdayOf(selected) + 6) % 7
  const start = Math.max(1, selected.day - offset)
  const end = Math.min(dim, selected.day - offset + 6)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

/** Sticky-right offset (in total-column widths) so the six totals stack from the right edge. */
function totalOffset(index: number): CSSProperties {
  return { '--i': STATUS_CODES.length - index } as CSSProperties
}

function badgeClass(cell: CellInfo): string {
  if (cell.kind === 'scheduled') return 'att-badge att-badge--scheduled'
  if (cell.kind === 'unmarked') return 'att-badge att-badge--unmarked'
  if (cell.kind === 'future') return 'att-badge att-badge--future'
  let cls = `att-badge att-badge--${cell.status}`
  if (cell.approvedLeave) cls += ' att-badge--approved'
  if (cell.status === 'SL' && cell.documentUrl) cls += ' att-badge--doc'
  return cls
}

function cellLabel(cell: CellInfo): string {
  if (cell.status) return `${STATUS_LABELS[cell.status]} (${cellSourceLabel(cell)})`
  return cellSourceLabel(cell)
}

interface OpenMenu {
  employeeId: string
  day: number
  anchor: HTMLElement
}

export function AttendanceTable({
  employees,
  selected,
  today,
  ctx,
  view,
  canManage,
  saveStates,
  onSelectDate,
  onAction,
  onUpload,
  onRemoveDocument,
  onDismissError,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const [active, setActive] = useState<{ row: number; col: number }>({ row: 0, col: -1 })
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const { year, month } = selected
  const days = useMemo(() => visibleDays(selected, view), [selected, view])
  const selectedCol = days.indexOf(selected.day)
  const activeRow = Math.min(active.row, Math.max(employees.length - 1, 0))
  const activeCol = active.col >= 0 && active.col < days.length ? active.col : Math.max(selectedCol, 0)

  const totalsById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof employeeMonthTotals>>()
    for (const employee of employees) map.set(employee.id, employeeMonthTotals(employee, year, month, ctx))
    return map
  }, [employees, year, month, ctx])

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const header = scroller?.querySelector<HTMLElement>(`th[data-day="${selected.day}"]`)
    const nameCol = scroller?.querySelector<HTMLElement>('th.att-table__name')
    if (!scroller || !header) return
    const stickyLeft = nameCol?.offsetWidth ?? 0
    const totalsWidth = [...scroller.querySelectorAll<HTMLElement>('thead th.att-total')].reduce(
      (sum, th) => sum + (getComputedStyle(th).position === 'sticky' ? th.offsetWidth : 0),
      0
    )
    const left = header.offsetLeft - stickyLeft
    const right = header.offsetLeft + header.offsetWidth - (scroller.clientWidth - totalsWidth)
    if (scroller.scrollLeft > left) scroller.scrollLeft = left - 8
    else if (scroller.scrollLeft < right) scroller.scrollLeft = right + 8
  }, [selected.day, view, year, month, employees.length])

  const focusCell = useCallback((row: number, col: number) => {
    setActive({ row, col })
    requestAnimationFrame(() => {
      tableRef.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)?.focus()
    })
  }, [])

  function onGridKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    const target = event.target as HTMLElement
    const coords = target.dataset.cell
    if (!coords) return
    const [row, col] = coords.split(':').map(Number)
    const moves: Record<string, [number, number]> = {
      ArrowUp: [row - 1, col],
      ArrowDown: [row + 1, col],
      ArrowLeft: [row, col - 1],
      ArrowRight: [row, col + 1],
      Home: [row, 0],
      End: [row, days.length - 1],
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    const nextRow = Math.min(Math.max(move[0], 0), employees.length - 1)
    const nextCol = Math.min(Math.max(move[1], 0), days.length - 1)
    focusCell(nextRow, nextCol)
  }

  const menuRef = useRef(menu)
  menuRef.current = menu
  const closeMenu = useCallback(() => {
    const anchor = menuRef.current?.anchor
    setMenu(null)
    if (anchor?.isConnected) anchor.focus()
  }, [])

  const menuEmployee = menu ? employees.find((e) => e.id === menu.employeeId) : undefined
  const menuDate = menu ? { year, month, day: menu.day } : null

  return (
    <div className="att-table-scroll" ref={scrollRef}>
      <table className="att-table" ref={tableRef} onKeyDown={onGridKeyDown} aria-rowcount={employees.length + 1}>
        <caption className="att-sr-only">
          Attendance for {employees.length} employees. Use arrow keys to move between days; press Enter to open a day.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="att-table__name">
              Employee
            </th>
            {days.map((day) => {
              const date = { year, month, day }
              const isToday = isSameDate(date, today)
              const isSelected = day === selected.day
              const isFuture = compareDates(date, today) > 0
              return (
                <th
                  key={day}
                  scope="col"
                  data-day={day}
                  className={`att-table__day${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${isFuture ? ' is-future' : ''}`}
                  aria-current={isToday ? 'date' : undefined}
                >
                  <button
                    type="button"
                    className="att-day-head"
                    aria-pressed={isSelected}
                    aria-label={`Select ${formatDate(date, { weekday: true })}${isToday ? ' (today)' : ''}`}
                    onClick={() => onSelectDate(date)}
                  >
                    <span className="att-day-head__wd">{WEEKDAY_SHORT[weekdayOf(date)].slice(0, 2)}</span>
                    <span className="att-day-head__num">{day}</span>
                  </button>
                </th>
              )
            })}
            {STATUS_CODES.map((code, i) => (
              <th
                key={code}
                scope="col"
                className={`att-total${i === 0 ? ' att-total--first' : ''}`}
                style={totalOffset(i)}
                title={`${STATUS_LABELS[code]} — whole month`}
              >
                {code}
              </th>
            ))}
            <th scope="col" className="att-total att-total--last" title="Unmarked days to date">
              –
            </th>
          </tr>
        </thead>
        <tbody>
          {employees.map((employee, rowIndex) => {
            const totals = totalsById.get(employee.id)!
            const dept = departmentOf(employee)
            return (
              <tr key={employee.id}>
                <th scope="row" className="att-table__name">
                  <div className="att-person">
                    <AttendanceAvatar name={employee.name} photoUrl={employee.photoUrl} employeeId={employee.id} size="sm" />
                    <span className="att-person__text">
                      <span className="att-person__name" title={employee.name}>
                        {employee.name}
                      </span>
                      <span className={`att-person__dept${dept ? '' : ' is-empty'}`} title={dept || undefined}>
                        {dept || 'No department'}
                      </span>
                    </span>
                  </div>
                </th>
                {days.map((day, colIndex) => {
                  const date = { year, month, day }
                  const cell = resolveCell(employee, date, ctx)
                  const key = saveStateKey(employee.id, date)
                  const state = saveStates[key]
                  const isToday = isSameDate(date, today)
                  const isSelected = day === selected.day
                  const focusable = rowIndex === activeRow && colIndex === activeCol
                  return (
                    <td
                      key={day}
                      className={`att-cell${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${cell.isFuture ? ' is-future' : ''}${state ? ` is-${state.state}` : ''}`}
                    >
                      <button
                        type="button"
                        className={badgeClass(cell)}
                        data-cell={`${rowIndex}:${colIndex}`}
                        tabIndex={focusable ? 0 : -1}
                        aria-haspopup="dialog"
                        aria-expanded={menu?.employeeId === employee.id && menu.day === day}
                        aria-label={`${employee.name}, ${formatDate(date, { weekday: true })}: ${cellLabel(cell)}${state?.state === 'saving' ? ', saving' : ''}${state?.state === 'error' ? ', save failed' : ''}`}
                        onFocus={() => setActive({ row: rowIndex, col: colIndex })}
                        onClick={(event) => {
                          const anchor = event.currentTarget
                          setMenu((current) =>
                            current && current.employeeId === employee.id && current.day === day
                              ? null
                              : { employeeId: employee.id, day, anchor }
                          )
                        }}
                      >
                        {cell.kind === 'unmarked' ? '–' : cell.status || ''}
                      </button>
                      {state?.state === 'saving' && <Loader2 className="att-cell__state att-spin" size={11} aria-hidden />}
                      {state?.state === 'error' && <AlertCircle className="att-cell__state att-cell__state--error" size={12} aria-hidden />}
                    </td>
                  )
                })}
                {STATUS_CODES.map((code, i) => {
                  const future = code === 'AL' ? totals.futureAL : code === 'WH' ? totals.futureWH : 0
                  return (
                    <td
                      key={code}
                      className={`att-total${i === 0 ? ' att-total--first' : ''}${totals[code] === 0 ? ' is-zero' : ''}`}
                      style={totalOffset(i)}
                      title={`${STATUS_LABELS[code]}: ${totals[code]}${future ? ` (includes ${future} upcoming)` : ''}`}
                    >
                      {totals[code]}
                    </td>
                  )
                })}
                <td
                  className={`att-total att-total--last${totals.unmarkedToDate ? ' is-warn' : ' is-zero'}`}
                  title={`Unmarked days to date: ${totals.unmarkedToDate}`}
                >
                  {totals.unmarkedToDate}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {menu && menuEmployee && menuDate && (
        <AttendanceCellMenu
          key={`${menu.employeeId}:${menu.day}`}
          anchor={menu.anchor}
          employee={menuEmployee}
          date={menuDate}
          cell={resolveCell(menuEmployee, menuDate, ctx)}
          canManage={canManage}
          saveState={saveStates[saveStateKey(menuEmployee.id, menuDate)]}
          onAction={(action) => {
            onAction(menuEmployee, menuDate, action)
            closeMenu()
          }}
          onUpload={(file) => onUpload(menuEmployee, menuDate, file)}
          onRemoveDocument={() => onRemoveDocument(menuEmployee, menuDate)}
          onDismissError={() => onDismissError(saveStateKey(menuEmployee.id, menuDate))}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}
