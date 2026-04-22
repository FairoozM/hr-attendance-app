import { useEffect, useState } from 'react'
import { Modal } from '../../components/Modal'

/**
 * Modal that shows the last N bulk-import attempts for item_report_groups.
 *
 * The backend caps storage at the most recent 10 entries (success + failure
 * mixed) and self-prunes inside the same transaction that records a new
 * entry, so this modal is bounded by design — no pagination needed.
 *
 * Props:
 *   - open:         boolean
 *   - onClose:      () => void
 *   - onFetch:      () => Promise<{ entries: Entry[], kept: number }>
 *   - refreshKey:   number — bump it from the parent (e.g. after a fresh
 *                   bulk import finishes) to force a re-fetch while the
 *                   modal is open.
 */
export function ImportLogModal({ open, onClose, onFetch, refreshKey = 0 }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [entries, setEntries] = useState([])
  const [kept, setKept] = useState(10)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    onFetch()
      .then((data) => {
        if (cancelled) return
        setEntries(Array.isArray(data?.entries) ? data.entries : [])
        if (Number.isFinite(data?.kept)) setKept(data.kept)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || 'Failed to load import log')
        setEntries([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [open, onFetch, refreshKey])

  return (
    <Modal
      title="Import Log"
      open={open}
      onClose={onClose}
      panelClassName="modal-panel--wide"
    >
      <p className="bulk-help" style={{ marginTop: 0 }}>
        Last <strong>{kept}</strong> bulk-import attempts (successes and
        failures). Older entries are pruned automatically — this is a quick
        operational view, not a long-term audit history.
      </p>

      {loading ? (
        <div className="irg-empty">Loading import log…</div>
      ) : error ? (
        <p className="irg-form__err" role="alert">{error}</p>
      ) : entries.length === 0 ? (
        <div className="irg-empty">
          No bulk imports have been recorded yet. Run a bulk import to see it
          here.
        </div>
      ) : (
        <div className="irg-table-wrap">
          <table className="irg-table">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Mode</th>
                <th style={{ textAlign: 'right' }}>Rows</th>
                <th style={{ textAlign: 'right' }}>Created</th>
                <th style={{ textAlign: 'right' }}>Updated</th>
                <th style={{ textAlign: 'right' }}>Invalid</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <LogRow key={e.id} entry={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="irg-form__actions">
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}

function LogRow({ entry }) {
  const when = entry.created_at ? new Date(entry.created_at) : null
  const whenStr = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString(undefined, {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '—'

  const userLabel =
    entry.user_label
      || (entry.user_id ? `user #${entry.user_id}` : null)
      || (entry.user_role ? `(${entry.user_role})` : 'unknown')

  const succeeded = entry.succeeded !== false
  const statusPill = succeeded
    ? <span className="irg-pill irg-pill--active">OK</span>
    : <span className="irg-pill irg-pill--inactive" title={entry.error_code || 'error'}>
        Failed{entry.error_code ? ` · ${entry.error_code}` : ''}
      </span>

  return (
    <tr>
      <td>{whenStr}</td>
      <td>
        {userLabel}
        {entry.user_role ? (
          <span className="irg-mono" style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
            {entry.user_role}
          </span>
        ) : null}
      </td>
      <td>
        <span className="irg-pill irg-pill--group">{entry.mode || 'upsert'}</span>
        {entry.deactivated_count > 0 ? (
          <span
            className="bulk-msg bulk-msg--dim"
            style={{ marginLeft: 6 }}
            title="Rows deactivated by replace_group"
          >
            ↓{entry.deactivated_count}
          </span>
        ) : null}
      </td>
      <td style={{ textAlign: 'right' }}>{Number(entry.total_rows || 0)}</td>
      <td style={{ textAlign: 'right', color: 'var(--success)' }}>
        {Number(entry.created_count || 0)}
      </td>
      <td style={{ textAlign: 'right', color: 'var(--info, #2563eb)' }}>
        {Number(entry.updated_count || 0)}
      </td>
      <td style={{
        textAlign: 'right',
        color: Number(entry.invalid_count) > 0 ? 'var(--danger)' : 'inherit',
      }}>
        {Number(entry.invalid_count || 0)}
      </td>
      <td>{statusPill}</td>
    </tr>
  )
}

export default ImportLogModal
