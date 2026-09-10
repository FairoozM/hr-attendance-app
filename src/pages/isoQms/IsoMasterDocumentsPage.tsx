import { useEffect, useState } from 'react'
import { downloadBlob } from '../../api/client'
import { exportMasterDocuments, fetchMasterDocuments } from '../../api/isoQms'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoFiltersBar } from './components/IsoFiltersBar'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoStatusBadge } from './components/IsoStatusBadge'
import type { IsoMasterDocumentRow } from './types'
import { formatIsoDate } from './utils/isoFormat'
import './isoQms.css'

export function IsoMasterDocumentsPage() {
  const [rows, setRows] = useState<IsoMasterDocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ search: '', status: '', category: '' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const data = await fetchMasterDocuments(filters)
        if (!cancelled) setRows(data)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load master list')
          setRows([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filters])

  const onExport = async () => {
    try {
      const { blob, filename } = await exportMasterDocuments(filters)
      downloadBlob(blob, filename || 'FO-01A-Master-List-of-Documents.xlsx')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    }
  }

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="Master List of Documents"
          subtitle="Live FO-01A register generated from controlled document metadata — no duplicate maintenance."
          actions={
            <button type="button" className="btn btn--secondary" onClick={onExport}>
              Export Excel
            </button>
          }
        />
        {error ? <div className="iso-error">{error}</div> : null}
        <IsoFiltersBar
          fields={[
            { key: 'search', placeholder: 'Search document number / title' },
            { key: 'category', placeholder: 'Category' },
            { key: 'status', placeholder: 'Status' },
          ]}
          values={filters}
          onChange={(next) => setFilters(next)}
        />
        {loading ? (
          <IsoLoadingState />
        ) : rows.length === 0 ? (
          <IsoEmptyState message="No controlled documents available for the master list." />
        ) : (
          <div className="iso-table-wrap">
            <table className="iso-table">
              <thead>
                <tr>
                  <th>S/N</th>
                  <th>Int/Ext</th>
                  <th>Category</th>
                  <th>Document No.</th>
                  <th>Title</th>
                  <th>Rev</th>
                  <th>Issue</th>
                  <th>Revision</th>
                  <th>Prepared</th>
                  <th>Reviewed</th>
                  <th>Approved</th>
                  <th>Master copy</th>
                  <th>Distribution</th>
                  <th>Status</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.serialNumber}-${row.documentNumber}`}>
                    <td>{row.serialNumber}</td>
                    <td>{row.internalExternal}</td>
                    <td>{row.category}</td>
                    <td className="iso-code">{row.documentNumber}</td>
                    <td>{row.documentTitle}</td>
                    <td>{row.revisionNumber}</td>
                    <td>{formatIsoDate(row.issueDate)}</td>
                    <td>{formatIsoDate(row.revisionDate)}</td>
                    <td>{row.preparedBy || '—'}</td>
                    <td>{row.reviewedBy || '—'}</td>
                    <td>{row.approvedBy || '—'}</td>
                    <td>{row.masterCopyLocation || '—'}</td>
                    <td>{row.distribution || '—'}</td>
                    <td>
                      <IsoStatusBadge status={row.status} />
                    </td>
                    <td>{row.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
