import { AttendanceGrid } from '../components/AttendanceGrid'
import { MonthYearFilters } from '../components/MonthYearFilters'
import { AttendanceDashboard } from '../components/attendance/dashboard/AttendanceDashboard'
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
        <div className="page-header">
          <h1 className="page-title">Attendance</h1>
          <p className="ui-page-subtitle">
            Review live staffing, department performance, and daily status signals before moving into the detailed attendance grid.
          </p>
        </div>
        {error && (
          <section className="page-section">
            <p className="page-error" role="alert">{error}</p>
          </section>
        )}
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
          <section className="page-section page-section--fill">
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
          </section>
        )}
      </div>
    </div>
  )
}
