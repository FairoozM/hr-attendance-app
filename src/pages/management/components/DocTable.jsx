import { DocStatusBadge, DocWorkflowBadge } from './DocStatusBadge'
import { getReminderDate, fmtDate } from '../utils/docExpiryUtils'

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

const COL_SPAN = 9

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

  const showCompany  = companyDocs.length > 0
  const showPersonal = personalDocs.length > 0
  const showDividers = showCompany && showPersonal

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
