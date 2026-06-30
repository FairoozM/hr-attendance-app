import { useState, useEffect } from 'react'
import { Modal } from '../../../components/Modal'
import { SUBSCRIPTION_CATEGORIES, BILLING_CYCLES } from '../../../lib/subscriptionUtils'
import type { Subscription, SubscriptionFormPayload } from '../../../api/subscriptions'

interface Props {
  open: boolean
  onClose: () => void
  onSave: (form: SubscriptionFormPayload) => Promise<void>
  editTarget: Subscription | null
  saving: boolean
  error: string
}

const EMPTY = {
  name: '',
  vendor: '',
  category: 'Other',
  billingCycle: 'Monthly',
  cost: 0,
  currency: 'AED',
  startDate: '',
  expiryDate: '',
  autoRenew: false,
  responsiblePerson: '',
  invoiceRequired: true,
  notes: '',
}

export function SubscriptionFormModal({ open, onClose, onSave, editTarget, saving, error }: Props) {
  const [form, setForm] = useState(EMPTY)

  useEffect(() => {
    if (!open) return
    if (editTarget) {
      setForm({
        name: editTarget.name,
        vendor: editTarget.vendor,
        category: editTarget.category,
        billingCycle: editTarget.billingCycle,
        cost: editTarget.cost,
        currency: editTarget.currency,
        startDate: editTarget.startDate || '',
        expiryDate: editTarget.expiryDate || '',
        autoRenew: editTarget.autoRenew,
        responsiblePerson: editTarget.responsiblePerson,
        invoiceRequired: editTarget.invoiceRequired,
        notes: editTarget.notes,
      })
    } else {
      setForm(EMPTY)
    }
  }, [open, editTarget])

  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSave({
      ...form,
      startDate: form.startDate || null,
      expiryDate: form.expiryDate || null,
    })
  }

  return (
    <Modal
      title={editTarget ? 'Edit Subscription' : 'Add Subscription'}
      open={open}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="form-stack">
        {error && <div className="sub-error-banner">{error}</div>}

        <label>
          Name *
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </label>

        <label>
          Vendor
          <input value={form.vendor} onChange={(e) => set('vendor', e.target.value)} />
        </label>

        <div className="form-row">
          <label>
            Category
            <select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {SUBSCRIPTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Billing Cycle
            <select value={form.billingCycle} onChange={(e) => set('billingCycle', e.target.value)}>
              {BILLING_CYCLES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>
            Cost
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.cost}
              onChange={(e) => set('cost', Number(e.target.value))}
            />
          </label>
          <label>
            Currency
            <input value={form.currency} onChange={(e) => set('currency', e.target.value)} />
          </label>
        </div>

        <div className="form-row">
          <label>
            Start Date
            <input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </label>
          <label>
            Expiry Date
            <input type="date" value={form.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} />
          </label>
        </div>

        <label>
          Responsible Person
          <input value={form.responsiblePerson} onChange={(e) => set('responsiblePerson', e.target.value)} />
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.autoRenew}
            onChange={(e) => set('autoRenew', e.target.checked)}
          />
          Auto-renew
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.invoiceRequired}
            onChange={(e) => set('invoiceRequired', e.target.checked)}
          />
          Invoice required
        </label>

        <label>
          Notes
          <textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>

        <div className="modal-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Subscription'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
