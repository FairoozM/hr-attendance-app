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
 * @param {(id: string) => void} [props.onEdit]
 * @param {(id: string) => void} [props.onDelete]
 */
export function PaymentsTable({ rows, onRowClick, onEdit, onDelete }) {
  const colSpan = 11 + (onEdit || onDelete ? 1 : 0)
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
            {(onEdit || onDelete) && <th style={{ width: 72 }}></th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
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
                  {(onEdit || onDelete) && (
                    <td className="pay-actions-cell" onClick={(e) => e.stopPropagation()}>
                      {onEdit && (
                        <button
                          type="button"
                          className="pay-action-btn pay-action-btn--edit"
                          title="Edit payment"
                          onClick={() => onEdit(p.id)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          className="pay-action-btn pay-action-btn--delete"
                          title="Delete payment"
                          onClick={() => onDelete(p.id, p.title)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
