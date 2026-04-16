import { DocStatusBadge, DocWorkflowBadge } from './DocStatusBadge'
import { getDaysLeft, getReminderDate, fmtDate } from '../utils/docExpiryUtils'

function DaysLeftCell({ expiryDate }) {
  const daysLeft = getDaysLeft(expiryDate)
  if (daysLeft === null) return <span className="doc-days-left">—</span>
  if (daysLeft < 0) {
    return <span className="doc-days-left doc-days-left--neg">{Math.abs(daysLeft)}d ago</span>
  }
  const cls = daysLeft <= 7 ? 'doc-days-left doc-days-left--warn' : 'doc-days-left'
  return <span className={cls}>{daysLeft}d</span>
}

export function DocTable({ documents, onEdit, onDelete }) {
  if (documents.length === 0) {
    return (
      <div className="doc-empty">
        <div className="doc-empty__icon" aria-hidden>📋</div>
        <p className="doc-empty__title">No documents found</p>
        <p className="doc-empty__sub">
          Try adjusting your filters, or add a new document record.
        </p>
      </div>
    )
  }

  return (
    <div className="doc-table-wrap">
      <table className="doc-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Type</th>
            <th>Company</th>
            <th>Expiry Date</th>
            <th>Reminder Date</th>
            <th>Days Left</th>
            <th>Status</th>
            <th>Workflow</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc, idx) => {
            const reminderDate = getReminderDate(doc.expiryDate, doc.reminderDays)
            return (
              <tr key={doc.id}>
                <td>{idx + 1}</td>
                <td>
                  <span className="doc-table__name">{doc.name}</span>
                  {doc.periodCovered && (
                    <span className="doc-table__period">{doc.periodCovered}</span>
                  )}
                </td>
                <td>{doc.documentType || '—'}</td>
                <td>{doc.company || '—'}</td>
                <td>{fmtDate(doc.expiryDate)}</td>
                <td>{fmtDate(reminderDate)}</td>
                <td><DaysLeftCell expiryDate={doc.expiryDate} /></td>
                <td><DocStatusBadge expiryDate={doc.expiryDate} /></td>
                <td><DocWorkflowBadge status={doc.workflowStatus} /></td>
                <td>
                  <div className="doc-actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => onEdit(doc)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => onDelete(doc.id)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
