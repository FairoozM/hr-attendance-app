import { useEffect, useState } from 'react'
import { createIsoObjective, fetchIsoObjectives } from '../../api/isoQms'
import { hasPermission, useAuth } from '../../contexts/AuthContext'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoStatusBadge } from './components/IsoStatusBadge'
import { IsoLinkedDocumentsPanel } from './components/IsoLinkedDocumentsPanel'
import type { IsoQualityObjective } from './types'
import './isoQms.css'

export function IsoObjectivesPage() {
  const { user } = useAuth()
  const canEdit = hasPermission(user, 'iso_qms', 'edit') || hasPermission(user, 'iso_qms', 'add')
  const [items, setItems] = useState<IsoQualityObjective[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = async () => {
    setLoading(true); setError('')
    try { setItems(await fetchIsoObjectives()) }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load objectives'); setItems([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])
  return (
    <div className="page"><div className="iso-page">
      <IsoPageHeader title="Quality Objectives" subtitle="Quality objectives and KPI tracking (LIF-QMS-M-ANX-01E)."
        actions={canEdit ? <button type="button" className="btn btn--primary" onClick={async () => {
          try {
            await createIsoObjective({ year: new Date().getFullYear(), objective: 'New objective', status: 'Open' })
            refresh()
          } catch (err) { setError(err instanceof Error ? err.message : 'Create failed') }
        }}>Add objective</button> : null}
      />
      {error ? <div className="iso-error">{error}</div> : null}
      {loading ? <IsoLoadingState /> : items.length === 0 ? <IsoEmptyState message="No objectives recorded for any year." /> : (
        <div className="iso-table-wrap"><table className="iso-table">
          <thead><tr><th>Year</th><th>Objective</th><th>Target</th><th>Department</th><th>Result</th><th>Status</th></tr></thead>
          <tbody>{items.map((o) => (
            <tr key={o.id}>
              <td>{o.year}</td><td>{o.objective}</td><td>{o.target || '—'}</td>
              <td>{o.responsibleDepartment || '—'}</td><td>{o.currentResult || '—'}</td>
              <td><IsoStatusBadge status={o.status} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <IsoLinkedDocumentsPanel title="Linked objective records" filters={{ documentType: 'Objective/KPI Record' }} />
    </div></div>
  )
}
