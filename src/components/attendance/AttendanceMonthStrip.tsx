import { type CalendarDate, formatDate, formatMonth, isSameDate } from '../../utils/attendance/attendanceCalendar'
import { monthToDateRate, type StripDay, type StripTone } from '../../utils/attendance/attendanceModel'
import { AttendanceInfoTip } from './AttendanceInfoTip'

interface Props {
  days: StripDay[]
  selected: CalendarDate
  today: CalendarDate
  onSelectDate: (date: CalendarDate) => void
}

const TONE_TEXT: Record<StripTone, string> = {
  future: 'Upcoming',
  'no-eligible': 'Nobody expected to work',
  'no-records': 'Nothing recorded',
  low: 'Below 60%',
  mid: '60–79%',
  high: '80–89%',
  max: '90% or more',
}

function describe(day: StripDay, isToday: boolean): string {
  const { summary } = day
  const parts = [`${formatDate(summary.date, { weekday: true })}${isToday ? ' (today)' : ''}`]
  if (day.tone === 'future') {
    parts.push('Upcoming')
    if (summary.AL) parts.push(`${summary.AL} on approved annual leave`)
    if (summary.WH) parts.push(`${summary.WH} weekly holiday`)
  } else if (day.tone === 'no-records') {
    parts.push(`Nothing recorded (${summary.unmarked} unmarked)`)
  } else if (day.tone === 'no-eligible') {
    parts.push('Nobody expected to work')
  } else {
    parts.push(`${summary.rate?.toFixed(1)}% present (${summary.P} of ${summary.eligible})`)
    if (summary.unmarked) parts.push(`${summary.unmarked} unmarked`)
  }
  return parts.join(' · ')
}

export function AttendanceMonthStrip({ days, selected, today, onSelectDate }: Props) {
  const mtd = monthToDateRate(days)
  return (
    <section className="att-strip" aria-labelledby="att-strip-title">
      <div className="att-section-head">
        <h2 id="att-strip-title" className="att-section-title">
          {formatMonth(selected.year, selected.month)}
          <span className="att-section-title__date">
            Month to date: {mtd.rate != null ? `${mtd.rate.toFixed(1)}%` : 'N/A'}
          </span>
          <AttendanceInfoTip label="About the month overview" align="start">
            Each day uses the same rule as the attendance rate. Month to date sums present ÷ expected over elapsed days
            that have attendance recorded ({mtd.days} so far). Future days are neutral; days with nothing recorded are
            shown separately instead of as absences.
          </AttendanceInfoTip>
        </h2>
        <ul className="att-strip__legend" aria-label="Month overview legend">
          {(['max', 'high', 'mid', 'low', 'no-records', 'future'] as StripTone[]).map((tone) => (
            <li key={tone}>
              <span className={`att-strip__swatch att-strip__day--${tone}`} aria-hidden />
              {TONE_TEXT[tone]}
            </li>
          ))}
        </ul>
      </div>
      <div className="att-strip__track">
        {days.map((day) => {
          const { date } = day.summary
          const isToday = isSameDate(date, today)
          const isSelected = isSameDate(date, selected)
          const label = describe(day, isToday)
          return (
            <button
              key={date.day}
              type="button"
              className={`att-strip__day att-strip__day--${day.tone}${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
              aria-label={label}
              aria-pressed={isSelected}
              title={label}
              onClick={() => onSelectDate(date)}
            >
              {date.day}
            </button>
          )
        })}
      </div>
    </section>
  )
}
