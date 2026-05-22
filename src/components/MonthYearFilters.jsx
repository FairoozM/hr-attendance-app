import { DAY_NAMES_SHORT } from '../constants/attendance'
import { ModernSelect } from './ui/ModernSelect'
import { ModernButtonGroup } from './ui/ModernButtonGroup'
import './MonthYearFilters.css'

const DAY_OPTIONS = DAY_NAMES_SHORT.map((name, i) => ({ value: i, label: name }))

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
  const monthOptions = months.map((name, i) => ({ value: i, label: name }))
  // yearOptions is an array of numbers — ModernSelect handles plain numbers natively

  return (
    <div className="month-year-filters">
      <ModernSelect
        label="Month"
        value={month}
        options={monthOptions}
        onChange={(v) => onMonthChange(Number(v))}
        aria-label="Select month"
      />
      <ModernSelect
        label="Year"
        value={year}
        options={yearOptions}
        onChange={(v) => onYearChange(Number(v))}
        aria-label="Select year"
      />
      {onWeeklyHolidayDayChange && (
        <ModernButtonGroup
          label="Weekly holiday"
          value={weeklyHolidayDay}
          options={DAY_OPTIONS}
          onChange={(v) => onWeeklyHolidayDayChange(Number(v))}
          getShortLabel={(opt) => opt.label.slice(0, 2)}
        />
      )}
    </div>
  )
}
