import { useEffect, useState } from 'react'
import { createIsoRisk, fetchIsoRisks } from '../../api/isoQms'
import { hasPermission, useAuth } from '../../contexts/AuthContext'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoStatusBadge } from './components/IsoStatusBadge'
import { IsoLinkedDocumentsPanel } from './components/IsoLinkedDocumentsPanel'
import type { IsoRisk } from './types'
import { formatIsoDate } from './utils/isoFormat'
import './isoQms.css'

export function IsoRisksPage() {
  const { user } = useAuth()
  const canEdit = hasPermission(user, 'iso_qms', 'edit') || hasPermission(user, 'iso_qms', 'add')
  const [items, setItems] = useState<IsoRisk[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true)
    setError('')
    try { setItems(await fetchIsoRisks()) }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load risks'); setItems([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])

  return (
    <div className="page"><div className="iso-page">
      <IsoPageHeader title="Risks & Opportunities" subtitle="FO-12A risk and opportunity register. Rating = severity × likelihood."
        actions={canEdit ? <button type="button" className="btn btn--primary" onClick={async () => {
          try {
            await createIsoRisk({ riskNumber: `RA-${new Date().getFullYear()}-${items.length + 1}`, status: 'Open', severity: 1, likelihood: 1 })
            refresh()
          } catch (err) { setError(err instanceof Error ? err.message : 'Create failed') }
        }}>New risk</button> : null}
      />
      {error ? <div className="iso-error">{error}</div> : null}
      {loading ? <IsoLoadingState /> : items.length === 0 ? <IsoEmptyState message="No risks recorded yet." /> : (
        <div className="iso-table-wrap"><table className="iso-table">
          <thead><tr><th>Number</th><th>Process</th><th>Failure</th><th>S×L</th><th>Owner</th><th>Target</th><th>Status</th></tr></thead>
          <tbody>{items.map((r) => (
            <tr key={r.id}>
              <td className="iso-code">{r.riskNumber}</td>
              <td>{r.process || '—'}</td>
              <td>{r.potentialFailure || '—'}</td>
              <td>{r.rating ?? ((r.severity || 0) * (r.likelihood || 0))}</td>
              <td>{r.responsiblePerson || '—'}</td>
              <td>{formatIsoDate(r.targetDate)}</td>
              <td><IsoStatusBadge status={r.status} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <IsoLinkedDocumentsPanel title="Linked risk records" filters={{ documentType: 'Risk Record' }} />
    </div></div>
  )
}
