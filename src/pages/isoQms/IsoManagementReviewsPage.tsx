import { useEffect, useState } from 'react'
import { createManagementReview, fetchManagementReviews } from '../../api/isoQms'
import { hasPermission, useAuth } from '../../contexts/AuthContext'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoStatusBadge } from './components/IsoStatusBadge'
import { IsoLinkedDocumentsPanel } from './components/IsoLinkedDocumentsPanel'
import type { IsoManagementReview } from './types'
import { formatIsoDate } from './utils/isoFormat'
import './isoQms.css'

export function IsoManagementReviewsPage() {
  const { user } = useAuth()
  const canEdit = hasPermission(user, 'iso_qms', 'edit') || hasPermission(user, 'iso_qms', 'add')
  const [items, setItems] = useState<IsoManagementReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await fetchManagementReviews())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load management reviews')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="Management Reviews"
          subtitle="FO-04A management review meetings, agenda outputs and linked minutes."
          actions={canEdit ? (
            <button type="button" className="btn btn--primary" onClick={async () => {
              try {
                await createManagementReview({
                  mrmReference: `MRM-${new Date().getFullYear()}-${String(items.length + 1).padStart(2, '0')}`,
                  meetingDate: new Date().toISOString().slice(0, 10),
                  status: 'Draft',
                })
                refresh()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Create failed')
              }
            }}>New MRM</button>
          ) : null}
        />
        {error ? <div className="iso-error">{error}</div> : null}
        {loading ? <IsoLoadingState /> : items.length === 0 ? (
          <IsoEmptyState message="No management reviews recorded yet." />
        ) : (
          <div className="iso-table-wrap">
            <table className="iso-table">
              <thead>
                <tr><th>Reference</th><th>Date</th><th>Venue</th><th>Chair</th><th>Next</th><th>Status</th></tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td className="iso-code">{r.mrmReference}</td>
                    <td>{formatIsoDate(r.meetingDate)}</td>
                    <td>{r.venue || '—'}</td>
                    <td>{r.chairperson || '—'}</td>
                    <td>{formatIsoDate(r.nextMeetingDate)}</td>
                    <td><IsoStatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <IsoLinkedDocumentsPanel
          title="Linked MRM documents"
          filters={{ documentType: 'Management Review Record' }}
        />
      </div>
    </div>
  )
}
