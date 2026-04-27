import { fmtDMY } from '../../utils/dateFormat'
import { buildAnnualLeavePaymentPayload } from '../../utils/paymentUtils'

const PAYMENTS_CONNECTED = false

/**
 * @param {object} props
 * @param {object} props.row
 * @param {(r: object) => void} [props.onPushToPayments]
 * @param {boolean} [props.isAdmin]
 */
export function LeaveSalarySnapshotCard({ row, onPushToPayments, isAdmin }) {
  const snap = row.calculator_snapshot
  const amount = row.calculated_leave_amount

  if (row.status !== 'Approved') {
    return (
      <div className="al-salary-card al-salary-card--muted">
        <h4 className="al-salary-card__title">Leave salary</h4>
        <p className="al-salary-card__empty">Relevant after this leave is approved and you start the main shop visit flow.</p>
      </div>
    )
  }

  if (amount == null) {
    return (
      <div className="al-salary-card">
        <h4 className="al-salary-card__title">Leave salary</h4>
        <p className="al-salary-card__empty">
          Salary not applied yet. Save a calculation in <strong>Leave Salary Calculator</strong> first, then use{' '}
          <strong>Apply salary calculator</strong> in the main shop visit card. If the button returns an error, save
          a calculation in the calculator tab for this employee and try again.
        </p>
        {isAdmin && (
          <p className="al-salary-card__meta">
            Expected flow: confirm visit → run calculator (tab) for this employee → apply here.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="al-salary-card al-salary-card--has">
      <h4 className="al-salary-card__title">Leave salary</h4>
      <div className="al-salary-card__amount">
        AED {Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      {snap?.monthly_salary != null && (
        <p className="al-salary-card__meta">Monthly snapshot: AED {Number(snap.monthly_salary).toLocaleString()}</p>
      )}
      {(snap?.leave_days_to_pay != null || row.leave_days != null) && (
        <p className="al-salary-card__meta">
          {snap?.leave_days_to_pay != null && <span>Paid days (calc): {snap.leave_days_to_pay} </span>}
          {row.leave_days != null && <span>· Request days: {row.leave_days} </span>}
        </p>
      )}
      {snap?.calculation_date && <p className="al-salary-card__meta">Calculated: {fmtDMY(snap.calculation_date)}</p>}
      {onPushToPayments && isAdmin && (
        <div className="al-salary-card__pay">
          <button
            type="button"
            className="al-btn al-btn--ghost al-btn--sm"
            disabled
            onClick={() => onPushToPayments(row)}
            title={buildAnnualLeavePaymentPayload ? 'Builds a Management → Payments record when connected' : undefined}
          >
            {PAYMENTS_CONNECTED ? 'Send to payments' : 'Push to company payments (not connected yet)'}
          </button>
        </div>
      )}
    </div>
  )
}
