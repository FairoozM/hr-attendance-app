import { ChevronDown } from 'lucide-react'
import { useMemo } from 'react'
import { type CalendarDate, daysInMonth, formatDate } from '../../utils/attendance/attendanceCalendar'
import {
  type AttendanceEmployee,
  departmentOf,
  employeeMonthTotals,
  type ResolveContext,
  resolveCell,
} from '../../utils/attendance/attendanceModel'
import { AttendanceAvatar } from './AttendanceAvatar'

interface Props {
  employees: AttendanceEmployee[]
  selected: CalendarDate
  ctx: ResolveContext
}

interface Entry {
  employee: AttendanceEmployee
  note?: string
  count?: number
}

function PersonList({ title, code, entries, empty }: { title: string; code: string; entries: Entry[]; empty: string }) {
  return (
    <div className="att-exc__group">
      <h3 className="att-exc__title">
        <span className={`att-dot att-dot--${code}`} aria-hidden />
        {title}
        <span className="att-exc__count">{entries.length}</span>
      </h3>
      {entries.length === 0 ? (
        <p className="att-exc__empty">{empty}</p>
      ) : (
        <ul className="att-exc__list">
          {entries.map(({ employee, note }) => (
            <li key={employee.id} className="att-exc__item">
              <AttendanceAvatar name={employee.name} photoUrl={employee.photoUrl} employeeId={employee.id} size="sm" />
              <span className="att-person__text">
                <span className="att-person__name" title={employee.name}>
                  {employee.name}
                </span>
                <span className="att-person__dept">{note || departmentOf(employee) || 'No department'}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function AttendanceExceptions({ employees, selected, ctx }: Props) {
  const data = useMemo(() => {
    const day: Record<'A' | 'SL' | 'AL' | 'unmarked', Entry[]> = { A: [], SL: [], AL: [], unmarked: [] }
    const missingCertificates: Entry[] = []
    const frequentAbsence: Entry[] = []
    const unmarkedDays: Entry[] = []
    const dim = daysInMonth(selected.year, selected.month)
    for (const employee of employees) {
      const cell = resolveCell(employee, selected, ctx)
      if (cell.status === 'A' || cell.status === 'SL' || cell.status === 'AL') {
        day[cell.status].push({
          employee,
          note:
            cell.status === 'SL'
              ? cell.documentUrl
                ? 'Certificate uploaded'
                : 'No certificate yet'
              : cell.approvedLeave
                ? 'Approved leave request'
                : undefined,
        })
      } else if (!cell.status && !cell.isFuture) {
        day.unmarked.push({ employee })
      }

      let missing = 0
      for (let d = 1; d <= dim; d++) {
        const c = resolveCell(employee, { ...selected, day: d }, ctx)
        if (c.status === 'SL' && c.kind === 'recorded' && !c.documentUrl && !c.isFuture) missing++
      }
      if (missing) missingCertificates.push({ employee, note: `${missing} day${missing > 1 ? 's' : ''} without certificate` })
      const totals = employeeMonthTotals(employee, selected.year, selected.month, ctx)
      if (totals.A >= 2) frequentAbsence.push({ employee, count: totals.A, note: `${totals.A} absences this month` })
      if (totals.unmarkedToDate) {
        const n = totals.unmarkedToDate
        unmarkedDays.push({ employee, count: n, note: `${n} unmarked day${n > 1 ? 's' : ''}` })
      }
    }
    const byCount = (a: Entry, b: Entry) => (b.count ?? 0) - (a.count ?? 0)
    frequentAbsence.sort(byCount)
    unmarkedDays.sort(byCount)
    return { day, missingCertificates, frequentAbsence, unmarkedDays }
  }, [employees, selected, ctx])

  const dateLabel = formatDate(selected)
  const summaryParts = [
    `${data.day.A.length} absent`,
    `${data.day.SL.length + data.day.AL.length} on leave`,
    `${data.day.unmarked.length} unmarked`,
  ]

  return (
    <details className="att-exc">
      <summary className="att-exc__summary">
        <ChevronDown size={16} className="att-exc__chevron" aria-hidden />
        <span className="att-section-title">Employee details</span>
        <span className="att-exc__meta">
          {dateLabel}: {summaryParts.join(' · ')}
        </span>
      </summary>
      <div className="att-exc__body">
        <div className="att-exc__grid">
          <PersonList title={`Absent · ${dateLabel}`} code="A" entries={data.day.A} empty="Nobody absent" />
          <PersonList title={`Sick leave · ${dateLabel}`} code="SL" entries={data.day.SL} empty="Nobody on sick leave" />
          <PersonList title={`Annual leave · ${dateLabel}`} code="AL" entries={data.day.AL} empty="Nobody on annual leave" />
          <PersonList title={`Unmarked · ${dateLabel}`} code="unmarked" entries={data.day.unmarked} empty="Everyone is marked" />
        </div>
        <div className="att-exc__grid att-exc__grid--month">
          <PersonList title="Sick leave without certificate (this month)" code="SL" entries={data.missingCertificates} empty="All sick leave has a certificate" />
          <PersonList title="Two or more absences (this month)" code="A" entries={data.frequentAbsence} empty="No repeated absences" />
          <PersonList title="Unmarked days to date (this month)" code="unmarked" entries={data.unmarkedDays} empty="No gaps to date" />
        </div>
      </div>
    </details>
  )
}
