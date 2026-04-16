import { useState, useEffect } from 'react'
import { DOCUMENT_TYPES, COMPANIES, WORKFLOW_STATUSES, RENEWAL_FREQUENCIES } from '../data/seedDocuments'

const EMPTY_FORM = {
  name: '',
  documentType: '',
  company: '',
  expiryDate: '',
  reminderDays: 14,
  renewalFrequency: 'Annual',
  periodCovered: '',
  notes: '',
  workflowStatus: 'Pending',
  attachment: null,
}

function validate(form) {
  if (!String(form.name || '').trim())    return 'Document name is required'
  if (!form.documentType)                 return 'Document type is required'
  if (!String(form.company || '').trim()) return 'Company is required'
  if (!form.expiryDate)                   return 'Expiry date is required'
  const rd = Number(form.reminderDays)
  if (!Number.isFinite(rd) || rd < 0)    return 'Reminder days must be 0 or more'
  return ''
}

export function DocForm({ initialValue, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initialValue ? { ...EMPTY_FORM, ...initialValue } : EMPTY_FORM)
  const [error, setError] = useState('')

  useEffect(() => {
    setForm(initialValue ? { ...EMPTY_FORM, ...initialValue } : EMPTY_FORM)
    setError('')
  }, [initialValue])

  const set = (key) => (e) => {
    const val = e?.target?.value ?? e
    setForm(prev => ({ ...prev, [key]: val }))
  }

  const submit = (e) => {
    e.preventDefault()
    const err = validate(form)
    if (err) { setError(err); return }
    setError('')
    onSave(form)
  }

  return (
    <form className="doc-form" onSubmit={submit} noValidate>
      <div className="doc-form__grid">
        <label className="doc-form__full">
          Document Name *
          <input
            value={form.name}
            onChange={set('name')}
            placeholder="e.g. VAT KSA Q1 2026"
          />
        </label>

        <label>
          Document Type *
          <select value={form.documentType} onChange={set('documentType')}>
            <option value="">Select type…</option>
            {DOCUMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        <label>
          Company *
          <select value={form.company} onChange={set('company')}>
            <option value="">Select company…</option>
            {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label>
          Expiry Date *
          <input
            type="date"
            value={form.expiryDate}
            onChange={set('expiryDate')}
          />
        </label>

        <label>
          Reminder Days Before *
          <input
            type="number"
            min="0"
            value={form.reminderDays}
            onChange={set('reminderDays')}
          />
        </label>

        <label>
          Renewal Frequency
          <select value={form.renewalFrequency} onChange={set('renewalFrequency')}>
            {RENEWAL_FREQUENCIES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>

        <label>
          Period Covered
          <input
            value={form.periodCovered}
            onChange={set('periodCovered')}
            placeholder="e.g. Q1 2026 (Jan–Mar)"
          />
        </label>

        <label>
          Workflow Status
          <select value={form.workflowStatus} onChange={set('workflowStatus')}>
            {WORKFLOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label className="doc-form__full">
          Notes
          <textarea
            rows={3}
            value={form.notes}
            onChange={set('notes')}
            placeholder="Any additional notes…"
          />
        </label>
      </div>

      {error && <p className="doc-form__err">{error}</p>}

      <div className="doc-form__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Saving…' : initialValue?.id ? 'Save Changes' : 'Add Document'}
        </button>
      </div>
    </form>
  )
}
