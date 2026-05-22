import { CalendarDays, AlertTriangle } from 'lucide-react'
import { AttendanceGrid } from '../components/AttendanceGrid'
import { MonthYearFilters } from '../components/MonthYearFilters'
import { AttendanceDashboard } from '../components/attendance/dashboard/AttendanceDashboard'
import './Page.css'
import './AttendancePage.css'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Skeleton rows shown while the grid data is loading. */
function GridSkeleton() {
  return (
    <div className="attendance-grid-skeleton" aria-busy="true" aria-label="Loading attendance grid">
      <div className="attendance-grid-skeleton__header" />
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="attendance-grid-skeleton__row">
          <div className="attendance-grid-skeleton__avatar" />
          <div className="attendance-grid-skeleton__text" style={{ maxWidth: `${6 + (i % 3) * 3}rem` }} />
          <div className="attendance-grid-skeleton__cells">
            {Array.from({ length: 12 }, (_, j) => (
              <div key={j} className="attendance-grid-skeleton__cell" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function AttendancePage({
  month,
  year,
  setMonth,
  setYear,
  employees,
  attendance,
  setAttendance,
  sickLeaveDocuments,
  uploadSickLeaveDocument,
  removeSickLeaveDocument,
  daysInMonth,
  yearOptions,
  weeklyHolidayDay,
  onWeeklyHolidayDayChange,
  loading,
  error,
}) {
  return (
    <div className="page">
      <div className="page-content page-content--attendance">

        {/* ── Page hero header ── */}
        <header className="attendance-page-header">
          <div className="attendance-page-header__icon" aria-hidden="true">
            <CalendarDays size={20} strokeWidth={2.2} />
          </div>
          <div className="attendance-page-header__text">
            <h1 className="attendance-page-header__title">Employee Attendance</h1>
            <p className="attendance-page-header__subtitle">
              Track presence, absences, weekly holidays, sick leave, and annual leave.
            </p>
          </div>
        </header>

        {/* ── Error state ── */}
        {error && (
          <section className="page-section">
            <div className="attendance-error-card" role="alert">
              <span className="attendance-error-card__icon" aria-hidden="true">
                <AlertTriangle size={18} strokeWidth={2} />
              </span>
              <div className="attendance-error-card__body">
                <strong className="attendance-error-card__title">Could not load attendance</strong>
                <p className="attendance-error-card__message">{error}</p>
              </div>
            </div>
          </section>
        )}

        {/* ── Dashboard overview (summary cards, heatmap, status lists) ── */}
        {!error && (
          <section className="page-section">
            <AttendanceDashboard
              employees={employees}
              attendance={attendance}
              month={month}
              year={year}
              daysInMonth={daysInMonth}
              weeklyHolidayDay={weeklyHolidayDay}
              sickLeaveDocuments={sickLeaveDocuments}
              loading={loading}
            />
          </section>
        )}

        {/* ── Month / year / holiday filters ── */}
        <section className="page-section">
          <MonthYearFilters
            month={month}
            year={year}
            months={MONTHS}
            yearOptions={yearOptions}
            onMonthChange={setMonth}
            onYearChange={setYear}
            weeklyHolidayDay={weeklyHolidayDay}
            onWeeklyHolidayDayChange={onWeeklyHolidayDayChange}
          />
        </section>

        {/* ── Detailed attendance grid (or loading skeleton) ── */}
        <section className="page-section page-section--fill" id="attendance-detail-grid">
          <div className="attendance-grid-section-header">
            <h2 className="attendance-grid-section-header__title">Attendance Grid</h2>
            <p className="attendance-grid-section-header__meta">
              {MONTHS[month]} {year}
              {!loading && ` · ${employees.length} employee${employees.length !== 1 ? 's' : ''}`}
            </p>
          </div>

          {loading && <GridSkeleton />}

          {!loading && !error && (
            <AttendanceGrid
              employees={employees}
              attendance={attendance}
              setAttendance={setAttendance}
              sickLeaveDocuments={sickLeaveDocuments}
              uploadSickLeaveDocument={uploadSickLeaveDocument}
              removeSickLeaveDocument={removeSickLeaveDocument}
              month={month}
              year={year}
              daysInMonth={daysInMonth}
              weeklyHolidayDay={weeklyHolidayDay}
            />
          )}
        </section>

      </div>
    </div>
  )
}
