import type { ReactNode } from 'react'
import { type CalendarDate, formatDate, isSameDate } from '../../utils/attendance/attendanceCalendar'
import type { DaySummary, RowFilter, StatusCode } from '../../utils/attendance/attendanceModel'
import { AttendanceInfoTip } from './AttendanceInfoTip'

interface Props {
  summary: DaySummary
  previous: DaySummary | null
  today: CalendarDate
  rowFilter: RowFilter
  onRowFilterChange: (filter: RowFilter) => void
}

function Delta({ value, goodWhenUp, label }: { value: number; goodWhenUp: boolean; label: string }) {
  if (value === 0) return <span className="att-stat__delta">Same as {label}</span>
  const good = goodWhenUp ? value > 0 : value < 0
  return (
    <span className={`att-stat__delta ${good ? 'is-good' : 'is-bad'}`}>
      {value > 0 ? '+' : '−'}
      {Math.abs(value)} vs {label}
    </span>
  )
}

interface TileProps {
  label: string
  value: number | string
  code?: StatusCode | 'unmarked'
  filter?: RowFilter
  activeFilter: RowFilter
  onFilter: (filter: RowFilter) => void
  children?: ReactNode
}

function Tile({ label, value, code, filter, activeFilter, onFilter, children }: TileProps) {
  const content = (
    <>
      <span className="att-stat__label">
        {code && <span className={`att-dot att-dot--${code}`} aria-hidden />}
        {label}
      </span>
      <span className="att-stat__value">{value}</span>
      {children}
    </>
  )
  if (!filter) return <div className="att-stat">{content}</div>
  const pressed = activeFilter === filter
  return (
    <button
      type="button"
      className={`att-stat att-stat--action${pressed ? ' is-active' : ''}`}
      aria-pressed={pressed}
      title={pressed ? 'Show all employees in the grid' : `Show only these employees in the grid`}
      onClick={() => onFilter(pressed ? 'all' : filter)}
    >
      {content}
    </button>
  )
}

export function AttendanceDaySummary({ summary, previous, today, rowFilter, onRowFilterChange }: Props) {
  const isToday = isSameDate(summary.date, today)
  const prevLabel = previous ? formatDate(previous.date, { year: false }) : ''
  const showDeltas = previous && !summary.isFuture
  const reconciles =
    summary.P + summary.A + summary.SL + summary.AL + summary.WH + summary.unmarked === summary.total

  const rateValue =
    summary.rate != null ? `${summary.rate.toFixed(1)}%` : summary.rateUnavailable === 'future' ? '—' : 'N/A'
  const tileProps = { activeFilter: rowFilter, onFilter: onRowFilterChange }

  return (
    <section className="att-summary" aria-labelledby="att-summary-title">
      <div className="att-section-head">
        <h2 id="att-summary-title" className="att-section-title">
          {isToday ? 'Today' : 'Selected day'}
          <span className="att-section-title__date">{formatDate(summary.date, { weekday: true })}</span>
          {summary.isFuture && <span className="att-chip">Future date</span>}
        </h2>
        {!reconciles && (
          <span className="att-chip att-chip--warn" role="status">
            Counts do not add up — reload to refresh
          </span>
        )}
      </div>
      <div className="att-stats">
        <Tile label="Employees" value={summary.total} {...tileProps}>
          <span className="att-stat__sub">In current filter</span>
        </Tile>
        <Tile label="Present" code="P" value={summary.P} {...tileProps}>
          {showDeltas && <Delta value={summary.P - previous.P} goodWhenUp label={prevLabel} />}
        </Tile>
        <Tile label="Absent" code="A" value={summary.A} filter="absent-day" {...tileProps}>
          {showDeltas && <Delta value={summary.A - previous.A} goodWhenUp={false} label={prevLabel} />}
        </Tile>
        <Tile label="Sick leave" code="SL" value={summary.SL} filter="leave-day" {...tileProps} />
        <Tile label="Annual leave" code="AL" value={summary.AL} filter="leave-day" {...tileProps} />
        <Tile label="Weekly holiday" code="WH" value={summary.WH} {...tileProps} />
        <Tile
          label={summary.isFuture ? 'Not yet recorded' : 'Unmarked'}
          code="unmarked"
          value={summary.unmarked}
          filter="unmarked-day"
          {...tileProps}
        >
          {showDeltas && <Delta value={summary.unmarked - previous.unmarked} goodWhenUp={false} label={prevLabel} />}
        </Tile>
        <div className="att-stat att-stat--rate">
          <span className="att-stat__label">
            Attendance rate
            <AttendanceInfoTip label="How attendance rate is calculated" align="end">
              Present ÷ (employees − annual leave − weekly holiday). Sick leave, absent and unmarked employees stay in
              the denominator. {summary.eligible > 0 && `Denominator for this day: ${summary.eligible}.`} Shown as N/A
              when nobody is expected to work, and as — for future dates.
            </AttendanceInfoTip>
          </span>
          <span className="att-stat__value">{rateValue}</span>
          <span className="att-stat__sub">
            {summary.rate != null
              ? `${summary.P} of ${summary.eligible} expected`
              : summary.rateUnavailable === 'future'
                ? 'Future date'
                : 'Nobody expected to work'}
          </span>
        </div>
      </div>
    </section>
  )
}
