import { CalendarDays, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { useMemo, useRef } from 'react'
import {
  addDays,
  type CalendarDate,
  formatDate,
  isSameDate,
  MONTH_NAMES,
  parseIsoDate,
  shiftMonth,
  toIsoDate,
} from '../../utils/attendance/attendanceCalendar'

interface Props {
  selected: CalendarDate
  today: CalendarDate
  department: string
  departments: { value: string; label: string }[]
  search: string
  onMonthChange: (year: number, month: number) => void
  onSelectDate: (date: CalendarDate) => void
  onToday: () => void
  onDepartmentChange: (value: string) => void
  onSearchChange: (value: string) => void
}

const MIN_YEAR = 2000
const MAX_YEAR = 2100

export function AttendanceToolbar({
  selected,
  today,
  department,
  departments,
  search,
  onMonthChange,
  onSelectDate,
  onToday,
  onDepartmentChange,
  onSearchChange,
}: Props) {
  const dateInputRef = useRef<HTMLInputElement>(null)
  const years = useMemo(() => {
    const set = new Set<number>()
    for (let y = today.year - 3; y <= today.year + 1; y++) set.add(y)
    set.add(selected.year)
    return [...set].sort((a, b) => a - b)
  }, [today.year, selected.year])

  const prevMonth = shiftMonth(selected.year, selected.month, -1)
  const nextMonth = shiftMonth(selected.year, selected.month, 1)
  const isToday = isSameDate(selected, today)

  return (
    <div className="att-toolbar" role="toolbar" aria-label="Attendance period and filters">
      <div className="att-toolbar__group" role="group" aria-labelledby="att-month-label">
        <span className="att-toolbar__label" id="att-month-label">
          Month
        </span>
        <button
          type="button"
          className="att-icon-btn att-icon-btn--bordered"
          aria-label="Previous month"
          disabled={prevMonth.year < MIN_YEAR}
          onClick={() => onMonthChange(prevMonth.year, prevMonth.month)}
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <select
          className="att-select"
          aria-label="Month"
          value={selected.month}
          onChange={(e) => onMonthChange(selected.year, Number(e.target.value))}
        >
          {MONTH_NAMES.map((name, index) => (
            <option key={name} value={index}>
              {name}
            </option>
          ))}
        </select>
        <select
          className="att-select att-select--year"
          aria-label="Year"
          value={selected.year}
          onChange={(e) => onMonthChange(Number(e.target.value), selected.month)}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="att-icon-btn att-icon-btn--bordered"
          aria-label="Next month"
          disabled={nextMonth.year > MAX_YEAR}
          onClick={() => onMonthChange(nextMonth.year, nextMonth.month)}
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>

      <div className="att-toolbar__group" role="group" aria-labelledby="att-day-label">
        <span className="att-toolbar__label" id="att-day-label">
          Day
        </span>
        <button
          type="button"
          className="att-icon-btn att-icon-btn--bordered"
          aria-label="Previous day"
          onClick={() => onSelectDate(addDays(selected, -1))}
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <span className="att-datefield">
          <button
            type="button"
            className="att-btn att-datefield__button"
            aria-label={`Selected day: ${formatDate(selected, { weekday: true })}. Choose a date`}
            onClick={() => {
              const input = dateInputRef.current
              if (!input) return
              try {
                input.showPicker()
              } catch {
                input.focus()
              }
            }}
          >
            <CalendarDays size={15} aria-hidden />
            {formatDate(selected, { weekday: true })}
          </button>
          <input
            ref={dateInputRef}
            type="date"
            className="att-datefield__input"
            tabIndex={-1}
            aria-hidden
            value={toIsoDate(selected)}
            min={`${MIN_YEAR}-01-01`}
            max={`${MAX_YEAR}-12-31`}
            onChange={(e) => {
              const date = parseIsoDate(e.target.value)
              if (date) onSelectDate(date)
            }}
          />
        </span>
        <button
          type="button"
          className="att-icon-btn att-icon-btn--bordered"
          aria-label="Next day"
          onClick={() => onSelectDate(addDays(selected, 1))}
        >
          <ChevronRight size={16} aria-hidden />
        </button>
        <button type="button" className="att-btn" onClick={onToday} disabled={isToday}>
          Today
        </button>
      </div>

      <div className="att-toolbar__group att-toolbar__group--scope" role="group" aria-label="Who is included">
        <select
          className="att-select att-select--dept"
          aria-label="Department"
          value={department}
          onChange={(e) => onDepartmentChange(e.target.value)}
        >
          <option value="all">All departments</option>
          {departments.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <label className="att-search">
          <Search size={15} aria-hidden className="att-search__icon" />
          <input
            type="search"
            className="att-input"
            placeholder="Search employees"
            aria-label="Search employees by name, department, designation or code"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {search && (
            <button type="button" className="att-search__clear" aria-label="Clear search" onClick={() => onSearchChange('')}>
              <X size={14} aria-hidden />
            </button>
          )}
        </label>
      </div>
    </div>
  )
}
