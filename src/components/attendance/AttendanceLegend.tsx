import { STATUS_CODES, STATUS_LABELS } from '../../utils/attendance/attendanceModel'

export function AttendanceLegend() {
  return (
    <ul className="att-legend" aria-label="Legend">
      {STATUS_CODES.map((code) => (
        <li key={code}>
          <span className={`att-badge att-badge--${code}`} aria-hidden>
            {code}
          </span>
          {STATUS_LABELS[code]}
        </li>
      ))}
      <li>
        <span className="att-badge att-badge--scheduled" aria-hidden>
          WH
        </span>
        Scheduled holiday
      </li>
      <li>
        <span className="att-badge att-badge--unmarked" aria-hidden>
          –
        </span>
        Unmarked
      </li>
      <li>
        <span className="att-badge att-badge--future" aria-hidden />
        Future
      </li>
      <li>
        <span className="att-badge att-badge--AL att-badge--approved" aria-hidden>
          AL
        </span>
        Approved leave request
      </li>
    </ul>
  )
}
