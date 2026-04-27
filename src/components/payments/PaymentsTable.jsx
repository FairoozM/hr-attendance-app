import { PAYMENT_STATUS } from '../../data/paymentTypes'
import {
  getDaysLeft,
  getInformAsadDate,
  getPaymentUrgency,
  getPaymentStatusLabel,
  getPaymentStatusColor,
} from '../../utils/paymentUtils'
import './paymentsShared.css'

function fmtDate(s) {
  if (!s) return '—'
  try {
    const d = new Date(String(s).length <= 10 ? `${s}T12:00:00` : s)
    if (Number.isNaN(d.getTime())) return s
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return s
  }
}

/**
 * @param {object} props
 * @param {import('../../hooks/useCompanyPayments').CompanyPayment[]} props.rows
 * @param {(p: import('../../hooks/useCompanyPayments').CompanyPayment) => void} props.onRowClick
 */
export function PaymentsTable({ rows, onRowClick }) {
  return (
    <div className="pay-table-wrap">
      <table className="pay-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Company</th>
            <th>Due</th>
            <th>Inform Asad by</th>
            <th>Days</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Files</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                No payments match your filters.
              </td>
            </tr>
          ) : (
            rows.map((p) => {
              const urgency = getPaymentUrgency(p)
              const done = p.status === PAYMENT_STATUS.PAYMENT_DONE
              const dueL = getDaysLeft(p.dueDate)
              const inform = p.informAsadDate || getInformAsadDate(p.dueDate, p.informAsadBeforeDays)
              const fileCount = (p.attachments?.length || 0) + (p.paymentProofAttachment ? 1 : 0)
              return (
                <tr
                  key={p.id}
                  className={done ? 'pay-table__row--done' : undefined}
                  onClick={() => onRowClick(p)}
                >
                  <td>
                    <strong style={{ fontWeight: 600 }}>{p.title}</strong>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      <span
                        className="pay-urgency-badge"
                        style={{ borderColor: urgency.color, color: urgency.color }}
                      >
                        {urgency.label}
                      </span>
                    </div>
                  </td>
                  <td>{p.paymentType}</td>
                  <td className="pay-amount">
                    {p.amount != null && p.amount !== ''
                      ? `${p.currency} ${Number(p.amount).toLocaleString()}`
                      : '—'}
                  </td>
                  <td>{p.company || '—'}</td>
                  <td>{fmtDate(p.dueDate)}</td>
                  <td>{fmtDate(inform)}</td>
                  <td>
                    {dueL == null ? '—' : dueL < 0 ? <span style={{ color: '#ef4444' }}>{dueL}d</span> : `${dueL}d`}
                  </td>
                  <td>
                    <span
                      className="pay-status-badge"
                      style={{ color: getPaymentStatusColor(p.status), borderColor: getPaymentStatusColor(p.status) }}
                    >
                      {getPaymentStatusLabel(p.status)}
                    </span>
                  </td>
                  <td>
                    <span className="pay-priority-badge">{(p.priority || '—').toString()}</span>
                  </td>
                  <td>{fileCount > 0 ? `📎 ${fileCount}` : '—'}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{p.sourceModule}</td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
