import { useCallback, useEffect, useState } from 'react'
import { Modal } from '../Modal'
import { api } from '../../api/client'
import { fmtDMY } from '../../utils/dateFormat'
import { todayIso, toIsoDate } from './notificationFormat'

interface DocumentRecord {
  id: string
  name: string
  documentType: string
  company: string
  expiryDate: string | null
  reminderDays: number
  renewalFrequency: string
  periodCovered: string
  notes: string
  workflowStatus: string
}

interface DocExpiryRenewModalProps {
  open: boolean
  documentId: string | null
  onClose: () => void
  onSaved: (expiryDate: string) => void | Promise<void>
}

const EMPTY_FORM = { expiryDate: '', notes: '' }

export function DocExpiryRenewModal({
  open,
  documentId,
  onClose,
  onSaved,
}: DocExpiryRenewModalProps) {
  const [doc, setDoc] = useState<DocumentRecord | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /**
   * Fetched on demand. The previous version relied on a document list preloaded by the app shell,
   * so opening the form before that request finished showed "Document record not found".
   */
  useEffect(() => {
    if (!open || !documentId) {
      setDoc(null)
      setForm(EMPTY_FORM)
      setError('')
      return undefined
    }

    const controller = new AbortController()
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const record = (await api.get(`/api/document-expiry/${documentId}`, {
          signal: controller.signal,
        })) as DocumentRecord
        if (controller.signal.aborted) return
        setDoc(record)
        setForm({ expiryDate: toIsoDate(record.expiryDate) || '', notes: record.notes || '' })
      } catch (err) {
        if (controller.signal.aborted) return
        setError((err as Error)?.message || 'Could not load this document.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [open, documentId])

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!doc) return
      const expiryDate = toIsoDate(form.expiryDate)
      if (!expiryDate) {
        setError('A new expiry date is required.')
        return
      }
      setSaving(true)
      setError('')
      try {
        await api.put(`/api/document-expiry/${doc.id}`, {
          name: doc.name,
          document_type: doc.documentType,
          company: doc.company,
          expiry_date: expiryDate,
          reminder_days: doc.reminderDays,
          renewal_frequency: doc.renewalFrequency,
          period_covered: doc.periodCovered,
          notes: form.notes,
          workflow_status: doc.workflowStatus || 'Pending',
        })
        // The server retires the reminder for the previous expiry date as part of the update, so
        // there is no separate resolve call to race against this one.
        await onSaved(expiryDate)
        onClose()
      } catch (err) {
        setError((err as Error)?.message || 'Failed to update the document.')
      } finally {
        setSaving(false)
      }
    },
    [doc, form.expiryDate, form.notes, onClose, onSaved]
  )

  const stillDue = Boolean(
    doc && form.expiryDate && toIsoDate(form.expiryDate) && (toIsoDate(form.expiryDate) as string) <= todayIso()
  )

  return (
    <Modal title="Renew document" open={open} onClose={onClose}>
      {loading && <p className="notif-form__muted">Loading document…</p>}

      {!loading && !doc && (
        <div>
          <p className="notif-form__error">{error || 'Document record not found.'}</p>
          <div className="notif-form__actions">
            <button type="button" className="notif-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}

      {!loading && doc && (
        <form className="notif-form" onSubmit={handleSubmit} noValidate>
          <p className="notif-form__subtitle">
            {[doc.name, doc.company, doc.documentType].filter(Boolean).join(' · ')}
          </p>
          {doc.expiryDate && (
            <p className="notif-form__muted">Current expiry: {fmtDMY(doc.expiryDate)}</p>
          )}

          <label className="notif-field">
            New expiry date *
            <input
              type="date"
              value={form.expiryDate}
              onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
              required
            />
          </label>

          {stillDue && (
            <p className="notif-form__warning">
              This date is today or in the past, so the reminder will stay in your inbox.
            </p>
          )}

          <label className="notif-field">
            Notes
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional renewal notes"
            />
          </label>

          {error && <p className="notif-form__error">{error}</p>}

          <div className="notif-form__actions">
            <button type="button" className="notif-btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="notif-btn notif-btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save renewal'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
