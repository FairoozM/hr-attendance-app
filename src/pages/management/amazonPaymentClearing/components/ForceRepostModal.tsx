import { useState } from 'react'
import type { PostingJobProgress, PostingSummary } from '../../../../api/amazonPaymentClearing'
import { PostingProgressBar } from './PostingProgressBar'

export function ForceRepostModal({
  open,
  postingSummary,
  busy,
  progress,
  startedAt,
  onCancel,
  onConfirm,
}: {
  open: boolean
  postingSummary?: PostingSummary
  busy: boolean
  progress: PostingJobProgress | null
  startedAt: number | null
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
        {busy && startedAt ? (
          <PostingProgressBar progress={progress} startedAt={startedAt} />
        ) : (
          <>
            <div className="apc-alert apc-alert--error">
              Delete the previous Zoho payment received entries and fee journals for this settlement first. Force
              repost then posts those sales payments and fee journals again. A reason is required and kept in the
              audit log.
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
                placeholder="Why this settlement is being reposted (for example, the previous Zoho payments and journals were deleted)."
              />
            </label>
          </>
        )}
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
