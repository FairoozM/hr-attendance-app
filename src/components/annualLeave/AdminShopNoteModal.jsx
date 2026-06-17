import { useState, useEffect } from 'react'
import { fmtDMY } from '../../utils/dateFormat'
import { shopWorkflowLabel } from './annualLeaveLabels'

export function AdminShopNoteModal({ row, onSave, onClose }) {
  const [v, setV] = useState(row.shop_visit_admin_note || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    setV(row.shop_visit_admin_note || '')
  }, [row.id, row.shop_visit_admin_note])

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setSaving(true)
    try {
      await onSave(row.id, { shop_visit_admin_note: v })
      onClose()
    } catch (ex) {
      setErr(ex?.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  if (!row) return null
  return (
    <div className="al-modal-overlay" onClick={onClose}>
      <div className="al-modal al-modal--contextual al-modal--scroll" onClick={(e) => e.stopPropagation()}>
        <div className="al-modal__head al-modal__head--split">
          <div>
            <h3>Handover note (internal)</h3>
            <p className="al-modal__kicker">
              {row.full_name} · {fmtDMY(row.from_date)} – {fmtDMY(row.to_date)} · {shopWorkflowLabel(row)}
            </p>
          </div>
          <button type="button" className="al-modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form onSubmit={submit} style={{ padding: '0 1.25rem' }}>
          <div className="al-modal__field">
            <label>Internal note</label>
            <textarea rows={4} value={v} onChange={(e) => setV(e.target.value)} />
          </div>
          {err && <p className="al-modal__err">{err}</p>}
          <div className="al-modal__actions al-modal__actions--sticky">
            <button type="button" className="al-btn al-btn--ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="al-btn al-btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
