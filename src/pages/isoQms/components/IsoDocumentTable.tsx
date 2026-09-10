import type { ReactNode } from 'react'
import type { IsoDocument } from '../types'
import { formatFileSize, formatIsoDate } from '../utils/isoFormat'
import { IsoStatusBadge } from './IsoStatusBadge'
import { IsoActionMenu, type IsoActionMenuItem } from './IsoActionMenu'
import { IsoEmptyState } from './IsoEmptyState'

export interface IsoDocumentTableProps {
  documents: IsoDocument[]
  onPreview?: (doc: IsoDocument) => void
  onRowClick?: (doc: IsoDocument) => void
  getActions?: (doc: IsoDocument) => IsoActionMenuItem[]
  emptyMessage?: string
  compact?: boolean
}

export function IsoDocumentTable({
  documents,
  onPreview,
  onRowClick,
  getActions,
  emptyMessage,
}: IsoDocumentTableProps) {
  if (!documents.length) {
    return <IsoEmptyState message={emptyMessage || 'No documents match the current filters.'} />
  }

  return (
    <div className="iso-table-wrap">
      <table className="iso-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Title</th>
            <th>Type</th>
            <th>Rev</th>
            <th>Status</th>
            <th>Department</th>
            <th>Review</th>
            <th>Size</th>
            <th>Auditor</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => {
            const actions = getActions?.(doc) || []
            return (
              <tr
                key={doc.id}
                onClick={() => onRowClick?.(doc)}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                <td className="iso-code">{doc.documentCode || '—'}</td>
                <td>
                  <div>{doc.title}</div>
                  {doc.originalFilename ? (
                    <div className="iso-muted">{doc.originalFilename}</div>
                  ) : null}
                </td>
                <td>{doc.documentType || '—'}</td>
                <td>{doc.revision || doc.currentVersion?.revisionNumber || '—'}</td>
                <td>
                  <IsoStatusBadge status={doc.status} />
                </td>
                <td>{doc.department || '—'}</td>
                <td>{formatIsoDate(doc.reviewDate)}</td>
                <td>{formatFileSize(doc.fileSize ?? doc.currentVersion?.fileSize)}</td>
                <td>
                  {doc.publishToAuditorRoom ? (
                    <span className="iso-badge iso-badge--ok">Published</span>
                  ) : (
                    <span className="iso-badge iso-badge--neutral">Internal</span>
                  )}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="iso-inline-actions">
                    {onPreview ? (
                      <button
                        type="button"
                        className="btn btn--secondary"
                        onClick={() => onPreview(doc)}
                      >
                        View
                      </button>
                    ) : null}
                    <IsoActionMenu items={actions} />
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

/** Minimal helper so pages can pass React nodes into table cells if needed later. */
export type IsoTableCell = ReactNode
