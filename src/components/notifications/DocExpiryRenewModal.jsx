import { useState, useEffect } from 'react'
import { Modal } from '../Modal'
import { api } from '../../api/client'

const EMPTY = { expiryDate: '', notes: '' }

export function DocExpiryRenewModal({ open, documentId, documentRecords = [], onClose, onSaved, onResolve }) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const doc = documentRecords.find((d) => String(d.id) === String(documentId))

  useEffect(() => {
    if (!open || !doc) {
      setForm(EMPTY)
      setError('')
      return
    }
    setForm({
      expiryDate: doc.expiryDate || '',
      notes: doc.notes || '',
    })
    setError('')
  }, [open, doc])

  if (!open) return null

  async function handleSubmit(e) {
    e.preventDefault()
    if (!doc) return
    if (!form.expiryDate) {
      setError('New expiry date is required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: doc.name,
        document_type: doc.documentType,
        company: doc.company,
        expiry_date: form.expiryDate,
        reminder_days: doc.reminderDays,
        renewal_frequency: doc.renewalFrequency,
        period_covered: doc.periodCovered,
        notes: form.notes,
        workflow_status: doc.workflowStatus || 'Pending',
      }
      await api.put(`/api/document-expiry/${doc.id}`, payload)
      if (onResolve) await onResolve()
      onSaved?.(form.expiryDate)
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to update document')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Update / Renew" open={open} onClose={onClose}>
      {!doc ? (
        <p className="notif-modal__empty">Document record not found.</p>
      ) : (
        <form className="notif-renew-form" onSubmit={handleSubmit} noValidate>
          <p className="notif-renew-form__subtitle">
            {doc.name}
            {doc.company ? ` · ${doc.company}` : ''}
            {doc.documentType ? ` · ${doc.documentType}` : ''}
          </p>
          <label className="notif-renew-form__field">
            New expiry date *
            <input
              type="date"
              value={form.expiryDate}
              onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
              required
            />
          </label>
          <label className="notif-renew-form__field">
            Notes
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional renewal notes"
            />
          </label>
          {error && <p className="notif-renew-form__error">{error}</p>}
          <div className="notif-renew-form__actions">
            <button type="button" className="notif-action-pill notif-action-pill--ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="notif-action-pill notif-action-pill--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save renewal'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
