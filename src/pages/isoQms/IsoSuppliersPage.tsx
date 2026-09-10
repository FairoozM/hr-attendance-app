import { useEffect, useState } from 'react'
import { createIsoSupplier, fetchIsoSuppliers } from '../../api/isoQms'
import { hasPermission, useAuth } from '../../contexts/AuthContext'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoStatusBadge } from './components/IsoStatusBadge'
import { IsoLinkedDocumentsPanel } from './components/IsoLinkedDocumentsPanel'
import type { IsoSupplier } from './types'
import { formatIsoDate } from './utils/isoFormat'
import './isoQms.css'

export function IsoSuppliersPage() {
  const { user } = useAuth()
  const canEdit = hasPermission(user, 'iso_qms', 'edit') || hasPermission(user, 'iso_qms', 'add')
  const [items, setItems] = useState<IsoSupplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = async () => {
    setLoading(true); setError('')
    try { setItems(await fetchIsoSuppliers()) }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load suppliers'); setItems([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])
  return (
    <div className="page"><div className="iso-page">
      <IsoPageHeader title="Approved Suppliers" subtitle="FO-07A/B/C approved supplier list, prequalification and reevaluation evidence."
        actions={canEdit ? <button type="button" className="btn btn--primary" onClick={async () => {
          try { await createIsoSupplier({ name: 'New supplier', status: 'Pending' }); refresh() }
          catch (err) { setError(err instanceof Error ? err.message : 'Create failed') }
        }}>Add supplier</button> : null}
      />
      {error ? <div className="iso-error">{error}</div> : null}
      {loading ? <IsoLoadingState /> : items.length === 0 ? <IsoEmptyState message="No suppliers recorded yet." /> : (
        <div className="iso-table-wrap"><table className="iso-table">
          <thead><tr><th>Name</th><th>Material / service</th><th>Approved</th><th>ISO</th><th>Status</th></tr></thead>
          <tbody>{items.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td><td>{s.materialService || '—'}</td>
              <td>{formatIsoDate(s.approvalDate)}</td>
              <td>{s.isoCertified ? 'Yes' : 'No'}</td>
              <td><IsoStatusBadge status={s.status} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <IsoLinkedDocumentsPanel title="Supplier evidence documents" filters={{ documentType: 'Supplier Record' }} />
    </div></div>
  )
}
