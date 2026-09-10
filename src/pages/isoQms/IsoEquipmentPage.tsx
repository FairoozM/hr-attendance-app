import { useEffect, useState } from 'react'
import { createIsoEquipment, fetchIsoEquipment, fetchIsoMaintenanceLogs } from '../../api/isoQms'
import { hasPermission, useAuth } from '../../contexts/AuthContext'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoStatusBadge } from './components/IsoStatusBadge'
import { IsoLinkedDocumentsPanel } from './components/IsoLinkedDocumentsPanel'
import type { IsoEquipment, IsoMaintenanceLog } from './types'
import { formatIsoDate } from './utils/isoFormat'
import './isoQms.css'

export function IsoEquipmentPage() {
  const { user } = useAuth()
  const canEdit = hasPermission(user, 'iso_qms', 'edit') || hasPermission(user, 'iso_qms', 'add')
  const [items, setItems] = useState<IsoEquipment[]>([])
  const [logs, setLogs] = useState<IsoMaintenanceLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const [eq, ml] = await Promise.all([fetchIsoEquipment(), fetchIsoMaintenanceLogs()])
      setItems(eq)
      setLogs(ml)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load equipment')
      setItems([])
      setLogs([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="Equipment & Maintenance"
          subtitle="Equipment register with history cards and maintenance logs (FO-13A–D)."
          actions={canEdit ? (
            <button type="button" className="btn btn--primary" onClick={async () => {
              try {
                await createIsoEquipment({
                  equipmentNumber: `EQ-${items.length + 1}`,
                  name: 'New equipment',
                  status: 'Active',
                })
                refresh()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Create failed')
              }
            }}>Add equipment</button>
          ) : null}
        />
        {error ? <div className="iso-error">{error}</div> : null}
        {loading ? <IsoLoadingState /> : (
          <>
            {items.length === 0 ? <IsoEmptyState message="No equipment registered yet." /> : (
              <div className="iso-table-wrap">
                <table className="iso-table">
                  <thead>
                    <tr>
                      <th>Number</th><th>Name</th><th>Brand / model</th><th>Location</th>
                      <th>Calibration</th><th>Condition</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((e) => (
                      <tr key={e.id}>
                        <td className="iso-code">{e.equipmentNumber}</td>
                        <td>{e.name}</td>
                        <td>{[e.brand, e.model].filter(Boolean).join(' / ') || '—'}</td>
                        <td>{e.department || '—'}</td>
                        <td>{e.calibrationRequired ? 'Required' : 'N/A'}</td>
                        <td>{e.currentCondition || '—'}</td>
                        <td><IsoStatusBadge status={e.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <section className="iso-section-card">
              <h2 className="iso-section-card__title">Maintenance log</h2>
              {logs.length === 0 ? <IsoEmptyState message="No maintenance logs yet." /> : (
                <div className="iso-table-wrap">
                  <table className="iso-table" style={{ minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th>Date</th><th>Equipment</th><th>Problem</th><th>Action</th>
                        <th>Provider</th><th>Completed by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((l) => (
                        <tr key={l.id}>
                          <td>{formatIsoDate(l.logDate)}</td>
                          <td>{l.equipmentNumber || '—'}</td>
                          <td>{l.natureOfProblem || '—'}</td>
                          <td>{l.actionTaken || '—'}</td>
                          <td>{l.serviceProvider || l.maintenanceType || '—'}</td>
                          <td>{l.completedBy || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
        <IsoLinkedDocumentsPanel title="Maintenance evidence" filters={{ documentType: 'Maintenance Record' }} />
      </div>
    </div>
  )
}
