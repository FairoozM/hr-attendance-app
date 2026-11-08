import type { ReactNode } from 'react'
import { Badge } from './PurchasePlanningBadges'
import type { UploadPreview, UploadPreviewRow } from './purchasePlanningTypes'

const PREVIEW_ROW_LIMIT = 12

interface PreviewColumn {
  label: string
  render: (row: UploadPreviewRow) => ReactNode
}

interface UploadPreviewTableProps {
  preview: UploadPreview
  meta: ReactNode
  columns: PreviewColumn[]
  footer?: ReactNode
}

export function UploadPreviewTable({ preview, meta, columns, footer }: UploadPreviewTableProps) {
  const { validRows, invalidRows } = preview.summary
  const hiddenRows = preview.rows.length - PREVIEW_ROW_LIMIT
  return (
    <div className="pp-preview">
      <div className="pp-preview__meta">
        <Badge tone={invalidRows ? 'danger' : 'success'}>
          {validRows} valid / {invalidRows} invalid
        </Badge>
        {meta}
      </div>
      <div className="doc-table-wrap">
        <table className="doc-table pp-preview-table">
          <thead>
            <tr>
              <th>Row</th>
              {columns.map((col) => (
                <th key={col.label}>{col.label}</th>
              ))}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.slice(0, PREVIEW_ROW_LIMIT).map((row) => (
              <tr key={row.rowNumber} className={row.valid ? undefined : 'pp-row--invalid'}>
                <td>{row.rowNumber}</td>
                {columns.map((col) => (
                  <td key={col.label}>{col.render(row)}</td>
                ))}
                <td>
                  {row.valid ? <Badge tone="success">Valid</Badge> : <Badge tone="danger">{row.errors.join(', ')}</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenRows > 0 && <p className="pp-hint">Showing the first {PREVIEW_ROW_LIMIT} rows; {hiddenRows} more not shown.</p>}
      {footer}
    </div>
  )
}
