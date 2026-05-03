import { useState } from 'react'
import { fmtDMY } from '../../utils/dateFormat'
import { EmpAvatar } from './EmpAvatar'

export function LeavePendingDecisionModal({ row, type, onConfirm, onClose }) {
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    setErr('')
    setSaving(true)
    try {
      const next = type === 'approve' ? 'Approved' : 'Rejected'
      await onConfirm(row, next)
      onClose()
    } catch (e) {
      setErr(e?.message || 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  if (!row) return null
  const isApprove = type === 'approve'

  return (
    <div className="al-modal-overlay" onClick={onClose}>
      <div className="al-modal al-modal--contextual" onClick={(e) => e.stopPropagation()}>
        <div className="al-modal__head al-modal__head--split">
          <h3>{isApprove ? 'Approve' : 'Reject'} this leave?</h3>
          <button type="button" className="al-modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="al-modal__emp">
          <EmpAvatar name={row.full_name} photoUrl={row.photo_url} />
          <div>
            <strong>{row.full_name}</strong>
            <span>
              {fmtDMY(row.from_date)} – {fmtDMY(row.to_date)} · {row.department}
            </span>
          </div>
        </div>
        {err && <p className="al-modal__err" style={{ padding: '0 1.25rem' }}>{err}</p>}
        <div className="al-modal__actions al-modal__actions--sticky">
          <button type="button" className="al-btn al-btn--ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className={isApprove ? 'al-btn al-btn--success' : 'al-btn al-btn--reject'}
            onClick={submit}
            disabled={saving}
          >
            {saving ? 'Saving…' : isApprove ? 'Yes, approve' : 'Yes, reject'}
          </button>
        </div>
      </div>
    </div>
  )
}
