import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createIsoCalibration, fetchIsoCalibrations } from '../../api/isoQms'
import { hasPermission, useAuth } from '../../contexts/AuthContext'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoStatusBadge } from './components/IsoStatusBadge'
import { IsoLinkedDocumentsPanel } from './components/IsoLinkedDocumentsPanel'
import type { IsoCalibration } from './types'
import { formatIsoDate } from './utils/isoFormat'
import './isoQms.css'

export function IsoCalibrationPage() {
  const { user } = useAuth()
  const canEdit = hasPermission(user, 'iso_qms', 'edit') || hasPermission(user, 'iso_qms', 'add')
  const [searchParams] = useSearchParams()
  const [items, setItems] = useState<IsoCalibration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await fetchIsoCalibrations({
        upcoming: searchParams.get('upcoming') || undefined,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calibrations')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [searchParams])

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="Calibration"
          subtitle="Calibration schedule and certificates (FO-09A). Notifications cover 30 / 14 / 7 day windows."
          actions={canEdit ? (
            <button type="button" className="btn btn--primary" onClick={async () => {
              try {
                await createIsoCalibration({
                  certificateNumber: `CAL-${Date.now().toString().slice(-6)}`,
                  status: 'Scheduled',
                })
                refresh()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Create failed')
              }
            }}>Add calibration</button>
          ) : null}
        />
        {error ? <div className="iso-error">{error}</div> : null}
        {loading ? <IsoLoadingState /> : items.length === 0 ? (
          <IsoEmptyState message="No calibration records yet." />
        ) : (
          <div className="iso-table-wrap">
            <table className="iso-table">
              <thead>
                <tr>
                  <th>Certificate</th><th>Equipment</th><th>Provider</th>
                  <th>Calibrated</th><th>Due</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td className="iso-code">{c.certificateNumber || '—'}</td>
                    <td>{c.equipmentName || c.equipmentNumber || '—'}</td>
                    <td>{c.calibrationProvider || '—'}</td>
                    <td>{formatIsoDate(c.calibrationDate)}</td>
                    <td>{formatIsoDate(c.dueDate)}</td>
                    <td><IsoStatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <IsoLinkedDocumentsPanel title="Calibration certificates / records" filters={{ documentType: 'Calibration Record' }} />
      </div>
    </div>
  )
}
