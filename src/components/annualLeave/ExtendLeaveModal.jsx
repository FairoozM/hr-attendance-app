import { useState } from 'react'
import { fmtDMY, fmtISO } from '../../utils/dateFormat'
import { EmpAvatar } from './EmpAvatar'

export function ExtendLeaveModal({ row, onExtend, onClose }) {
  const currentEnd = fmtISO(row.to_date)
  const [newEnd, setNewEnd] = useState('')
  const [remarks, setRemarks] = useState(row.admin_remarks || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!newEnd || newEnd <= currentEnd) return setErr('New end date must be after ' + fmtDMY(currentEnd))
    setSaving(true)
    try {
      await onExtend(row.id, { new_to_date: newEnd, admin_remarks: remarks })
      onClose()
    } catch (ex) {
      setErr(ex.message || 'Failed')
      setSaving(false)
    }
  }

  return (
    <div className="al-modal-overlay" onClick={onClose}>
      <div className="al-modal al-modal--contextual al-modal--scroll" onClick={(e) => e.stopPropagation()}>
        <div className="al-modal__head al-modal__head--split">
          <div>
            <h3>Extend annual leave</h3>
            <p className="al-modal__kicker">
              {row.full_name} · current end {fmtDMY(currentEnd)}
            </p>
          </div>
          <button type="button" className="al-modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="al-modal__emp">
          <EmpAvatar name={row.full_name} photoUrl={row.photo_url} />
          <div>
            <strong>{row.full_name}</strong>
            <span>{row.department}</span>
          </div>
        </div>
        <form onSubmit={submit}>
          <div className="al-modal__field">
            <label>Current end</label>
            <input type="text" value={fmtDMY(currentEnd)} readOnly className="al-modal__readonly" />
          </div>
          <div className="al-modal__field">
            <label>New end date *</label>
            <input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} min={currentEnd} required />
          </div>
          <div className="al-modal__field">
            <label>Remarks</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
          </div>
          {err && <p className="al-modal__err">{err}</p>}
          <div className="al-modal__actions al-modal__actions--sticky">
            <button type="button" className="al-btn al-btn--ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="al-btn al-btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save extension'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
