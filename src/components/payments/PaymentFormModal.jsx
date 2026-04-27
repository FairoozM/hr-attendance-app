import { useState, useEffect } from 'react'
import { Modal } from '../Modal'
import {
  PAYMENT_TYPE_OPTIONS,
  PRIORITY_OPTIONS,
  COMPANY_OPTIONS,
  SOURCE_MODULE_OPTIONS,
  DEFAULT_INFORM_ASAD_BEFORE_DAYS,
  PAYMENT_STATUS,
} from '../../data/paymentTypes'
import { getInformAsadDate } from '../../utils/paymentUtils'
import './paymentsShared.css'

const empty = {
  title: '',
  paymentType: 'Other',
  sourceModule: 'Manual',
  sourceReferenceId: '',
  amount: '',
  currency: 'AED',
  company: 'Main Shop (UAE)',
  dueDate: '',
  informAsadBeforeDays: DEFAULT_INFORM_ASAD_BEFORE_DAYS,
  payeeOrVendor: '',
  responsiblePerson: '',
  status: PAYMENT_STATUS.PAYMENT_NEEDED,
  priority: 'medium',
  notes: '',
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(form: object) => void} props.onSave
 * @param {boolean} props.saving
 * @param {import('../../hooks/useCompanyPayments').CompanyPayment | null} props.editTarget
 */
export function PaymentFormModal({ open, onClose, onSave, saving, editTarget }) {
  const [f, setF] = useState(empty)

  useEffect(() => {
    if (!open) return
    if (editTarget) {
      setF({
        title: editTarget.title || '',
        paymentType: editTarget.paymentType || 'Other',
        sourceModule: editTarget.sourceModule || 'Manual',
        sourceReferenceId: editTarget.sourceReferenceId || '',
        amount: editTarget.amount != null ? String(editTarget.amount) : '',
        currency: editTarget.currency || 'AED',
        company: editTarget.company || 'Main Shop (UAE)',
        dueDate: (editTarget.dueDate || '').slice(0, 10),
        informAsadBeforeDays: editTarget.informAsadBeforeDays ?? DEFAULT_INFORM_ASAD_BEFORE_DAYS,
        payeeOrVendor: editTarget.payeeOrVendor || '',
        responsiblePerson: editTarget.responsiblePerson || '',
        status: editTarget.status || PAYMENT_STATUS.PAYMENT_NEEDED,
        priority: editTarget.priority || 'medium',
        notes: editTarget.notes || '',
      })
    } else {
      setF(empty)
    }
  }, [open, editTarget])

  const informPreview =
    f.dueDate && f.dueDate.length >= 8
      ? getInformAsadDate(f.dueDate, Number(f.informAsadBeforeDays) || DEFAULT_INFORM_ASAD_BEFORE_DAYS)
      : '—'

  const disabledDone = editTarget?.status === PAYMENT_STATUS.PAYMENT_DONE

  function set(k, v) {
    setF((prev) => ({ ...prev, [k]: v }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    onSave({
      ...f,
      informAsadBeforeDays: Number(f.informAsadBeforeDays) || DEFAULT_INFORM_ASAD_BEFORE_DAYS,
      amount: f.amount === '' ? null : Number(f.amount),
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editTarget ? 'Edit payment' : 'Add payment'}
      panelClassName="modal-panel--wide pay-modal-panel"
    >
      <form onSubmit={handleSubmit} className="pay-form">
        <div className="pay-form-grid">
          <label className="pay-form-field pay-form-field--full">
            Title
            <input required value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={200} />
          </label>
          <label className="pay-form-field">
            Payment type
            <select value={f.paymentType} onChange={(e) => set('paymentType', e.target.value)}>
              {PAYMENT_TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="pay-form-field">
            Source module
            <select value={f.sourceModule} onChange={(e) => set('sourceModule', e.target.value)}>
              {SOURCE_MODULE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="pay-form-field">
            Source ref ID
            <input
              value={f.sourceReferenceId}
              onChange={(e) => set('sourceReferenceId', e.target.value)}
              placeholder="Leave, bill, or ticket id"
            />
          </label>
          <label className="pay-form-field">
            Amount
            <input
              type="number"
              step="0.01"
              value={f.amount}
              onChange={(e) => set('amount', e.target.value)}
            />
          </label>
          <label className="pay-form-field">
            Currency
            <input value={f.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} maxLength={8} />
          </label>
          <label className="pay-form-field">
            Company
            <select value={f.company} onChange={(e) => set('company', e.target.value)}>
              {COMPANY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="pay-form-field">
            Due date
            <input type="date" required value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </label>
          <label className="pay-form-field">
            Inform Asad (days before due)
            <input
              type="number"
              min={0}
              max={90}
              value={f.informAsadBeforeDays}
              onChange={(e) => set('informAsadBeforeDays', e.target.value)}
            />
            <span style={{ fontSize: 10, textTransform: 'none', color: 'var(--text-muted)', fontWeight: 500 }}>
              Inform by: <strong>{informPreview}</strong>
            </span>
          </label>
          <label className="pay-form-field">
            Payee / vendor
            <input value={f.payeeOrVendor} onChange={(e) => set('payeeOrVendor', e.target.value)} />
          </label>
          <label className="pay-form-field">
            Responsible person
            <input value={f.responsiblePerson} onChange={(e) => set('responsiblePerson', e.target.value)} />
          </label>
          <label className="pay-form-field">
            Priority
            <select value={f.priority} onChange={(e) => set('priority', e.target.value)}>
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {editTarget && (
            <label className="pay-form-field">
              Status
              <select
                value={f.status}
                onChange={(e) => set('status', e.target.value)}
                disabled={disabledDone}
              >
                <option value={PAYMENT_STATUS.PAYMENT_NEEDED}>Payment needed</option>
                <option value={PAYMENT_STATUS.INFORMED_TO_ASAD}>Informed to Asad</option>
                <option value={PAYMENT_STATUS.PAYMENT_DONE}>Payment done</option>
              </select>
            </label>
          )}
          <label className="pay-form-field pay-form-field--full">
            Notes
            <textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving || disabledDone}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {disabledDone && <p className="pay-hint">Completed payments are read-only. Use the drawer to view proof and history.</p>}
      </form>
    </Modal>
  )
}
