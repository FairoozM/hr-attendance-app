import { useEffect, useState } from 'react'
import { downloadBlob } from '../../api/client'
import { exportMasterRecords, fetchMasterRecords } from '../../api/isoQms'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoFiltersBar } from './components/IsoFiltersBar'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoStatusBadge } from './components/IsoStatusBadge'
import type { IsoMasterRecordRow } from './types'
import { formatIsoDate } from './utils/isoFormat'
import './isoQms.css'

export function IsoMasterRecordsPage() {
  const [rows, setRows] = useState<IsoMasterRecordRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ search: '', department: '' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const data = await fetchMasterRecords(filters)
        if (!cancelled) setRows(data)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load master records')
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
      const { blob, filename } = await exportMasterRecords(filters)
      downloadBlob(blob, filename || 'FO-02A-Master-List-of-Records.xlsx')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    }
  }

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="Master List of Records"
          subtitle="Live FO-02A register of QMS record types with evidence counts from the document library."
          actions={
            <button type="button" className="btn btn--secondary" onClick={onExport}>
              Export Excel
            </button>
          }
        />
        {error ? <div className="iso-error">{error}</div> : null}
        <IsoFiltersBar
          fields={[
            { key: 'search', placeholder: 'Search format reference / description' },
            { key: 'department', placeholder: 'Department' },
          ]}
          values={filters}
          onChange={(next) => setFilters(next)}
        />
        {loading ? (
          <IsoLoadingState />
        ) : rows.length === 0 ? (
          <IsoEmptyState message="No record types configured yet." />
        ) : (
          <div className="iso-table-wrap">
            <table className="iso-table">
              <thead>
                <tr>
                  <th>Format ref</th>
                  <th>Description</th>
                  <th>Department</th>
                  <th>Medium</th>
                  <th>Issue</th>
                  <th>Rev</th>
                  <th>Rev date</th>
                  <th>Retention</th>
                  <th>Custodian</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Evidence</th>
                  <th>Latest</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.formatReference}>
                    <td className="iso-code">{row.formatReference}</td>
                    <td>{row.formatDescription}</td>
                    <td>{row.department || '—'}</td>
                    <td>{row.medium || '—'}</td>
                    <td>{formatIsoDate(row.issueDate)}</td>
                    <td>{row.revision || '—'}</td>
                    <td>{formatIsoDate(row.revisionDate)}</td>
                    <td>{row.retentionPeriod || '—'}</td>
                    <td>{row.custodian || '—'}</td>
                    <td>{row.location || '—'}</td>
                    <td>
                      <IsoStatusBadge status={row.recordStatus} />
                    </td>
                    <td>{row.evidenceCount || 0}</td>
                    <td>{formatIsoDate(row.latestRecordDate)}</td>
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
