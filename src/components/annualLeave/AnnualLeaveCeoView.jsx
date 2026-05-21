import { useMemo, useState } from 'react'
import { alDaysBetween } from '../../utils/annualLeaveUtils'
import {
  alternateAvailabilityForRow,
  fmtLeavePeriodCeo,
  roundupMonthsUntilLeave,
} from '../../utils/annualLeaveCeoView'
import { fmtDMY } from '../../utils/dateFormat'
import { EmpAvatar } from './EmpAvatar'
import { leaveStatusDisplay } from './annualLeaveLabels'

const CEO_PAGE_SIZE = 50

export function AnnualLeaveCeoView({ rows, allRequests, loading }) {
  const [limit, setLimit] = useState(CEO_PAGE_SIZE)

  const sorted = useMemo(() => {
    return [...(rows || [])].sort((a, b) => {
      const fa = a.from_date || ''
      const fb = b.from_date || ''
      if (fa !== fb) return fa < fb ? -1 : 1
      return (a.full_name || '').localeCompare(b.full_name || '')
    })
  }, [rows])

  const visible = sorted.slice(0, limit)
  const remaining = Math.max(0, sorted.length - visible.length)

  if (loading) {
    return <p className="page-loading al-ceo__loading">Loading CEO view…</p>
  }

  if (!sorted.length) {
    return (
      <div className="al-empty-state">
        <div className="al-empty-state__icon al-empty-state__icon--calm" />
        <p>No leave requests match the current filters.</p>
      </div>
    )
  }

  return (
    <section className="al-ceo" aria-labelledby="al-ceo-heading">
      <header className="al-ceo__head">
        <div>
          <h2 id="al-ceo-heading" className="al-ceo__title">
            CEO view
          </h2>
          <p className="al-ceo__subtitle">
            At-a-glance leave periods, cover, and tenure before each leave starts.
          </p>
        </div>
        <span className="al-ceo__count">{sorted.length} request{sorted.length !== 1 ? 's' : ''}</span>
      </header>

      <div className="al-table-wrap al-ceo__table-wrap">
        <table className="al-table al-table--ceo">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Leave period</th>
              <th>Days</th>
              <th>Alternate / availability</th>
              <th>Joining date</th>
              <th>Tenure at leave start</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const days = row.leave_days ?? alDaysBetween(row.from_date, row.to_date)
              const alt = alternateAvailabilityForRow(row, allRequests)
              const joining = row.employee_joining_date
              const months = roundupMonthsUntilLeave(joining, row.from_date)
              const es = row.effective_status || row.status

              return (
                <tr key={row.id} className="al-ceo__row">
                  <td>
                    <div className="al-row__emp">
                      <EmpAvatar name={row.full_name} photoUrl={row.photo_url} size={40} />
                      <div>
                        <span className="al-row__name">{row.full_name}</span>
                        {row.department ? (
                          <span className="al-row__dept">{row.department}</span>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="al-ceo__period">{fmtLeavePeriodCeo(row.from_date, row.to_date)}</td>
                  <td className="al-ceo__days">
                    {days} day{days !== 1 ? 's' : ''}
                  </td>
                  <td>
                    <div className="al-ceo__alt">
                      <span className="al-ceo__alt-name">{alt.name || '—'}</span>
                      <span
                        className={`al-ceo__alt-badge al-ceo__alt-badge--${alt.status}`}
                      >
                        {alt.label}
                      </span>
                    </div>
                  </td>
                  <td className="al-ceo__join">{joining ? fmtDMY(joining) : '—'}</td>
                  <td className="al-ceo__tenure">
                    {months != null ? (
                      <>
                        <strong>{months}</strong> mo
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span className="al-ceo__status">{leaveStatusDisplay(es)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {remaining > 0 && (
        <div className="al-section__more">
          <button
            type="button"
            className="al-btn al-btn--ghost"
            onClick={() => setLimit((n) => n + CEO_PAGE_SIZE)}
          >
            Show {Math.min(CEO_PAGE_SIZE, remaining)} more
          </button>
        </div>
      )}
    </section>
  )
}
