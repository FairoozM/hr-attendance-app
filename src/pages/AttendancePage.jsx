import { AttendanceGrid } from '../components/AttendanceGrid'
import { MonthYearFilters } from '../components/MonthYearFilters'
import './Page.css'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const currentDate = new Date()

export function AttendancePage({
  month,
  year,
  setMonth,
  setYear,
  employees,
  attendance,
  setAttendance,
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
        <div className="page-header">
          <h1 className="page-title">Attendance</h1>
        </div>
        {error && (
          <section className="page-section">
            <p className="page-error" role="alert">{error}</p>
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
        {loading && (
          <section className="page-section">
            <p className="page-loading">Loading attendance…</p>
          </section>
        )}
        {!loading && !error && (
          <section className="page-section page-section--fill">
            <AttendanceGrid
              employees={employees}
              attendance={attendance}
              setAttendance={setAttendance}
              month={month}
              year={year}
              daysInMonth={daysInMonth}
              weeklyHolidayDay={weeklyHolidayDay}
            />
          </section>
        )}
      </div>
    </div>
  )
}
