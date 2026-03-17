import { DAY_NAMES_SHORT } from '../constants/attendance'
import './MonthYearFilters.css'

export function MonthYearFilters({
  month,
  year,
  months,
  yearOptions,
  onMonthChange,
  onYearChange,
  weeklyHolidayDay = 0,
  onWeeklyHolidayDayChange,
}) {
  return (
    <div className="month-year-filters">
      <label className="filter-group">
        <span className="filter-label">Month</span>
        <select
          value={month}
          onChange={(e) => onMonthChange(Number(e.target.value))}
          className="filter-select"
          aria-label="Select month"
        >
          {months.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-group">
        <span className="filter-label">Year</span>
        <select
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
          className="filter-select"
          aria-label="Select year"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      {onWeeklyHolidayDayChange && (
        <label className="filter-group">
          <span className="filter-label">Weekly holiday</span>
          <select
            value={weeklyHolidayDay}
            onChange={(e) => onWeeklyHolidayDayChange(Number(e.target.value))}
            className="filter-select"
            aria-label="Select weekly holiday day"
          >
            {DAY_NAMES_SHORT.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
