import { fmtDMY, fmtISO } from '../../utils/dateFormat'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function LeaveTimeline({ row }) {
  const t = todayISO()
  const steps = [
    { label: 'Applied', date: row.created_at, done: true },
    { label: 'Approved', date: row.updated_at, done: row.status === 'Approved' || !!row.actual_return_date },
    { label: 'Leave starts', date: row.from_date, done: t >= fmtISO(row.from_date) && row.status === 'Approved' },
    { label: 'Leave ends', date: row.to_date, done: t > fmtISO(row.to_date) && row.status === 'Approved' },
    { label: 'Returned', date: row.actual_return_date, done: !!row.actual_return_date },
  ]
  return (
    <div className="al-timeline">
      {steps.map((s, i) => (
        <div key={i} className={`al-timeline__step ${s.done ? 'al-timeline__step--done' : ''}`}>
          <div className="al-timeline__node" />
          {i < steps.length - 1 && <div className="al-timeline__line" />}
          <div className="al-timeline__info">
            <span className="al-timeline__label">{s.label}</span>
            <span className="al-timeline__date">{fmtDMY(s.date)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
