import { useEffect, useState } from 'react'
import { fetchIsoActivityLog } from '../../api/isoQms'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoFiltersBar } from './components/IsoFiltersBar'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import type { IsoActivityLogEntry } from './types'
import { formatIsoDateTime } from './utils/isoFormat'
import './isoQms.css'

export function IsoActivityLogPage() {
  const [items, setItems] = useState<IsoActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ search: '', entityType: '' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const data = await fetchIsoActivityLog(filters)
        if (!cancelled) setItems(data)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load activity log')
          setItems([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [filters])

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="QMS Activity Log"
          subtitle="Append-only audit trail of document, approval, publish and configuration events."
        />
        {error ? <div className="iso-error">{error}</div> : null}
        <IsoFiltersBar
          fields={[
            { key: 'search', placeholder: 'Search action / message' },
            { key: 'entityType', placeholder: 'Entity type' },
          ]}
          values={filters}
          onChange={(next) => setFilters(next)}
        />
        {loading ? <IsoLoadingState /> : items.length === 0 ? (
          <IsoEmptyState message="No activity recorded yet." />
        ) : (
          <div className="iso-table-wrap">
            <table className="iso-table">
              <thead>
                <tr>
                  <th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Message</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td>{formatIsoDateTime(e.createdAt)}</td>
                    <td>{e.userName || e.userId || '—'}</td>
                    <td>{e.action}</td>
                    <td>{e.entityType ? `${e.entityType} #${e.entityId ?? ''}` : '—'}</td>
                    <td>{e.message || '—'}</td>
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
