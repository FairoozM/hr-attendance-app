import { DashboardCards } from '../components/DashboardCards'
import { MonthYearFilters } from '../components/MonthYearFilters'
import './Page.css'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const currentDate = new Date()

export function DashboardPage({
  month,
  year,
  setMonth,
  setYear,
  employees,
  effectiveAttendance,
  daysInMonth,
  yearOptions,
  weeklyHolidayDay,
  onWeeklyHolidayDayChange,
  loading,
  error,
}) {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
      </div>
      {error && (
        <section className="page-section">
          <p className="page-error" role="alert">{error}</p>
        </section>
      )}
      {loading && (
        <section className="page-section">
          <p className="page-loading">Loading…</p>
        </section>
      )}
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
      {!loading && !error && (
        <section className="page-section">
          <DashboardCards
            employees={employees}
            attendance={effectiveAttendance}
            daysInMonth={daysInMonth}
          />
        </section>
      )}
    </div>
  )
}
