import {
  STATUS_KEYS,
  STATUSES,
  DAY_NAMES_SHORT,
  STATUS_EXPLICIT_BLANK,
} from '../constants/attendance'
import {
  getDayOfWeek,
  getEffectiveStatus,
  getEmployeeMonthSummary,
  SUMMARY_STATUS_ORDER,
} from '../utils/attendanceHelpers'
import './AttendanceGrid.css'

function setAttendanceFor(setAttendance, employeeId, day, value) {
  setAttendance((prev) => {
    const next = { ...prev }
    if (!next[employeeId]) next[employeeId] = {}
    const emp = { ...next[employeeId] }
    if (value) {
      emp[day] = value
    } else {
      emp[day] = STATUS_EXPLICIT_BLANK
    }
    next[employeeId] = emp
    return next
  })
}

export function AttendanceGrid({
  employees,
  attendance,
  setAttendance,
  month,
  year,
  daysInMonth,
  weeklyHolidayDay = 0,
}) {
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  return (
    <div className="attendance-grid-wrap">
      <div className="attendance-grid-legend">
        {STATUS_KEYS.map((key) => (
          <span key={key} className={`attendance-legend attendance-legend--${STATUSES[key].color}`}>
            <b>{key}</b> {STATUSES[key].label}
          </span>
        ))}
      </div>
      <div className="attendance-grid-scroll">
        <table className="attendance-grid" role="grid">
          <thead>
            <tr className="attendance-grid__header-row attendance-grid__header-row--group">
              <th
                colSpan={1}
                className="attendance-grid__th attendance-grid__th--group attendance-grid__th--group-employee"
              >
                <div className="attendance-grid__header-employee-inner">Employee</div>
              </th>
              <th
                colSpan={SUMMARY_STATUS_ORDER.length}
                className="attendance-grid__th attendance-grid__th--group attendance-grid__th--group-summary"
              >
                Summary
              </th>
              <th
                colSpan={days.length}
                className="attendance-grid__th attendance-grid__th--group attendance-grid__th--group-attendance"
              >
                Attendance
              </th>
            </tr>
            <tr className="attendance-grid__header-row attendance-grid__header-row--sub">
              <th className="attendance-grid__th attendance-grid__th--sticky attendance-grid__th--sub">
                <div className="attendance-grid__header-employee-inner">Name / Dept</div>
              </th>
              {SUMMARY_STATUS_ORDER.map((key) => (
                <th
                  key={key}
                  className={`attendance-grid__th attendance-grid__th--summary attendance-grid__summary-col--${key.toLowerCase()} attendance-grid__th--sub`}
                  title={STATUSES[key].label}
                >
                  {key}
                </th>
              ))}
              {days.map((day) => {
                const dayOfWeek = getDayOfWeek(year, month, day)
                const dayName = DAY_NAMES_SHORT[dayOfWeek]
                const isFirstDay = day === 1
                return (
                  <th
                    key={day}
                    className={`attendance-grid__th attendance-grid__th--day attendance-grid__th--sub ${isFirstDay ? 'attendance-grid__th--day-first' : ''}`}
                  >
                    <div className="attendance-grid__th-day-inner">
                      <span className="attendance-grid__day-name">{dayName}</span>
                      <span className="attendance-grid__day-num">{day}</span>
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id}>
                <td className="attendance-grid__td attendance-grid__td--sticky">
                  <div className="attendance-grid__cell-employee">
                    <span className="attendance-grid__name">{emp.name}</span>
                    <span className="attendance-grid__dept">{emp.department}</span>
                  </div>
                </td>
                {(() => {
                  const summary = getEmployeeMonthSummary(
                    attendance,
                    emp.id,
                    daysInMonth,
                    year,
                    month,
                    weeklyHolidayDay
                  )
                  return SUMMARY_STATUS_ORDER.map((key) => (
                    <td
                      key={key}
                      className={`attendance-grid__td attendance-grid__td--summary attendance-grid__summary-col--${key.toLowerCase()}`}
                    >
                      <span
                        className={`attendance-grid__summary-value attendance-grid__summary-value--${STATUSES[key].color}`}
                      >
                        {summary[key]}
                      </span>
                    </td>
                  ))
                })()}
                {days.map((day) => {
                  const current = getEffectiveStatus(
                    attendance,
                    emp.id,
                    day,
                    year,
                    month,
                    weeklyHolidayDay
                  )
                  const colorClass = current ? `attendance-cell--${STATUSES[current].color}` : ''
                  const isFirstDay = day === 1
                  return (
                    <td
                      key={day}
                      className={`attendance-grid__td attendance-grid__td--day ${isFirstDay ? 'attendance-grid__td--day-first' : ''}`}
                    >
                      <div className="attendance-cell-wrap">
                        <select
                          className={`attendance-cell attendance-cell--select ${colorClass}`}
                          value={current || ''}
                          onChange={(e) => {
                            const v = e.target.value
                            setAttendanceFor(setAttendance, emp.id, day, v)
                          }}
                          title={current ? STATUSES[current].label : 'Select status'}
                          aria-label={`Day ${day} status for ${emp.name}`}
                        >
                          <option value="">—</option>
                          {STATUS_KEYS.map((key) => (
                            <option key={key} value={key}>
                              {key}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {employees.length === 0 && (
        <p className="attendance-grid-empty">Add employees to record attendance.</p>
      )}
    </div>
  )
}
