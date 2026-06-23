import { useState } from 'react'
import type { PostingSummary } from '../../../../api/amazonPaymentClearing'

export function ForceRepostModal({
  open,
  postingSummary,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean
  postingSummary?: PostingSummary
  busy: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  if (!open) return null
  const previousIds = postingSummary?.zohoPaymentIds || []
  return (
    <div className="apc-modal-overlay" role="dialog" aria-modal="true" aria-label="Force repost to Zoho">
      <div className="apc-modal">
        <h2 className="ainv-page__title" style={{ fontSize: '1.15rem' }}>Force repost to Zoho</h2>
        <div className="apc-alert apc-alert--error">
          This batch was already posted to Zoho. Reposting may duplicate payments unless previous Zoho entries were
          reversed manually.
        </div>
        {previousIds.length ? (
          <div className="apc-modal__ids">
            <p className="apc-muted">Previous Zoho payment IDs:</p>
            <ul>
              {previousIds.map((entry) => (
                <li key={`${entry.paymentType}-${entry.zohoPaymentId}`}>
                  {entry.paymentType}: <code>{entry.zohoPaymentId}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="apc-muted">No previous Zoho payment IDs are recorded for this batch.</p>
        )}
        <label className="ainv-label">
          Reason for force repost (required)
          <textarea
            className="ainv-input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this settlement must be reposted (e.g. previous Zoho payments were reversed manually)."
          />
        </label>
        <div className="apc-button-row">
          <button type="button" className="ainv-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="ainv-btn ainv-btn--danger"
            onClick={() => onConfirm(reason.trim())}
            disabled={busy || reason.trim().length < 4}
          >
            {busy ? 'Reposting...' : 'Confirm Force Repost'}
          </button>
        </div>
      </div>
    </div>
  )
}
