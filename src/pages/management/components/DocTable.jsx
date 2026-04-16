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

function SectionDivider({ label, count, colSpan }) {
  return (
    <tr className="doc-table__section-row">
      <td colSpan={colSpan}>
        <span className="doc-table__section-label">{label}</span>
        <span className="doc-table__section-count">{count} record{count !== 1 ? 's' : ''}</span>
      </td>
    </tr>
  )
}

function DocRow({ doc, idx, onEdit, onDelete }) {
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
}

const COL_SPAN = 10

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

  const companyDocs  = documents.filter(d => d.company !== 'Personal')
  const personalDocs = documents.filter(d => d.company === 'Personal')

  // When a filter/search is active both groups may be empty; skip dividers for
  // groups that have no rows so the table doesn't show a lonely heading.
  const showCompany  = companyDocs.length > 0
  const showPersonal = personalDocs.length > 0
  // Show section dividers only when BOTH groups are present simultaneously
  const showDividers = showCompany && showPersonal

  // Build a flat ordered list: company rows first, then personal
  const rows = [
    ...(showCompany  ? companyDocs  : []),
    ...(showPersonal ? personalDocs : []),
  ]

  // Running per-section index for the # column
  let companyIdx  = 0
  let personalIdx = 0

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
          {showDividers && showCompany && (
            <SectionDivider label="Company Documents" count={companyDocs.length} colSpan={COL_SPAN} />
          )}
          {companyDocs.map(doc => (
            <DocRow
              key={doc.id}
              doc={doc}
              idx={companyIdx++}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}

          {showDividers && showPersonal && (
            <SectionDivider label="Personal Documents" count={personalDocs.length} colSpan={COL_SPAN} />
          )}
          {personalDocs.map(doc => (
            <DocRow
              key={doc.id}
              doc={doc}
              idx={personalIdx++}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
