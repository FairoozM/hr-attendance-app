import { useState, useMemo, useCallback } from 'react'
import { hasPermission, useAuth } from '../../contexts/AuthContext'
import { useCompanyPayments } from '../../hooks/useCompanyPayments'
import { PAYMENT_STATUS, PAYMENT_TYPE_OPTIONS, COMPANY_OPTIONS, SOURCE_MODULE_OPTIONS } from '../../data/paymentTypes'
import {
  sortPaymentsForDisplay,
  getInformAsadDate,
  buildAnnualLeavePaymentPayload,
} from '../../utils/paymentUtils'
import { PaymentSummaryCards } from '../../components/payments/PaymentSummaryCards'
import { PaymentsTable } from '../../components/payments/PaymentsTable'
import { PaymentFormModal } from '../../components/payments/PaymentFormModal'
import { PaymentDetailDrawer } from '../../components/payments/PaymentDetailDrawer'
import './DocumentExpiryPage.css'
import './PaymentsPage.css'

const EMPTY = {
  search: '',
  status: '',
  paymentType: '',
  company: '',
  sourceModule: '',
  dueFrom: '',
  dueTo: '',
}

/**
 * Company payments (main shop → inform Mr. Asad in advance). Local persistence until API exists.
 * @example future integration: addPayment({ ...buildAnnualLeavePaymentPayload({ ... }) })
 */
export function PaymentsPage() {
  const { user } = useAuth()
  const {
    payments,
    addPayment,
    updatePayment,
    markInformedToAsad,
    markPaymentDone,
    addAttachment,
    setPaymentProof,
    removePayment,
  } = useCompanyPayments()

  const [filters, setFilters] = useState(EMPTY)
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [saving, setSaving] = useState(false)

  const active = useMemo(() => (activeId ? payments.find((p) => p.id === activeId) : null) || null, [activeId, payments])

  const canAdd = hasPermission(user, 'document_expiry', 'add')
  const canEdit = hasPermission(user, 'document_expiry', 'edit')

  const filtered = useMemo(() => {
    return payments.filter((p) => {
      if (filters.status && p.status !== filters.status) return false
      if (filters.paymentType && p.paymentType !== filters.paymentType) return false
      if (filters.company && p.company !== filters.company) return false
      if (filters.sourceModule && p.sourceModule !== filters.sourceModule) return false
      const q = filters.search.trim().toLowerCase()
      if (q) {
        const blob = [p.title, p.paymentType, p.company, p.payeeOrVendor, p.sourceModule, p.notes]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!blob.includes(q)) return false
      }
      if (filters.dueFrom && p.dueDate < filters.dueFrom) return false
      if (filters.dueTo && p.dueDate > filters.dueTo) return false
      return true
    })
  }, [payments, filters])

  const rows = useMemo(() => sortPaymentsForDisplay(filtered), [filtered])

  const openAdd = useCallback(() => {
    setEditTarget(null)
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((id) => {
    const p = payments.find((x) => x.id === id)
    if (p) {
      setEditTarget(p)
      setFormOpen(true)
      setActiveId(null)
    }
  }, [payments])

  const handleDelete = useCallback((id, title) => {
    if (window.confirm(`Delete "${title}"? This cannot be undone.`)) {
      removePayment(id)
      if (activeId === id) setActiveId(null)
    }
  }, [removePayment, activeId])

  const handleSave = useCallback(
    async (form) => {
      setSaving(true)
      try {
        const base = {
          title: form.title,
          paymentType: form.paymentType,
          sourceModule: form.sourceModule,
          sourceReferenceId: form.sourceReferenceId,
          amount: form.amount,
          currency: form.currency,
          company: form.company,
          dueDate: form.dueDate,
          informAsadBeforeDays: form.informAsadBeforeDays,
          informAsadDate: getInformAsadDate(form.dueDate, form.informAsadBeforeDays),
          payeeOrVendor: form.payeeOrVendor,
          responsiblePerson: form.responsiblePerson,
          status: form.status,
          priority: form.priority,
          notes: form.notes,
        }
        if (editTarget) {
          if (form.status && form.status !== editTarget.status) {
            base._historyNote = 'Status updated in form'
          }
          updatePayment(editTarget.id, base)
        } else {
          addPayment(base)
        }
        setFormOpen(false)
        setEditTarget(null)
      } finally {
        setSaving(false)
      }
    },
    [addPayment, updatePayment, editTarget]
  )

  return (
    <div className="page pay-page">
      <div className="doc-page-hero pay-hero">
        <div>
          <h1 className="doc-page-title">Company payments</h1>
          <p className="doc-page-subtitle pay-hero__sub">
            Central workflow for outflows from the <strong>main shop</strong>: log requests, remind{' '}
            <strong>Mr. Asad</strong> <em>5 days before</em> the due date, and track when payment is done.
            Other modules can push records here using the same data shape (e.g. Annual Leave salary).
          </p>
        </div>
        {canAdd && (
          <button type="button" className="btn btn--primary" onClick={openAdd}>
            + Add payment
          </button>
        )}
      </div>

      <div className="pay-dev-hint" role="note">
        <span className="pay-dev-hint__label">Dev</span>
        Storage is in-browser for now. Example integration:{' '}
        <code>addPayment(buildAnnualLeavePaymentPayload(...))</code> — see <code>paymentUtils.js</code>.
      </div>

      <PaymentSummaryCards payments={payments} />

      <div className="pay-filters" role="search">
        <label>
          Search
          <input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Title, vendor, notes…"
          />
        </label>
        <label>
          Status
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All</option>
            <option value={PAYMENT_STATUS.PAYMENT_NEEDED}>Payment needed</option>
            <option value={PAYMENT_STATUS.INFORMED_TO_ASAD}>Informed to Asad</option>
            <option value={PAYMENT_STATUS.PAYMENT_DONE}>Payment done</option>
          </select>
        </label>
        <label>
          Type
          <select value={filters.paymentType} onChange={(e) => setFilters((f) => ({ ...f, paymentType: e.target.value }))}>
            <option value="">All</option>
            {PAYMENT_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Company
          <select value={filters.company} onChange={(e) => setFilters((f) => ({ ...f, company: e.target.value }))}>
            <option value="">All</option>
            {COMPANY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source
          <select value={filters.sourceModule} onChange={(e) => setFilters((f) => ({ ...f, sourceModule: e.target.value }))}>
            <option value="">All</option>
            {SOURCE_MODULE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due from
          <input type="date" value={filters.dueFrom} onChange={(e) => setFilters((f) => ({ ...f, dueFrom: e.target.value }))} />
        </label>
        <label>
          Due to
          <input type="date" value={filters.dueTo} onChange={(e) => setFilters((f) => ({ ...f, dueTo: e.target.value }))} />
        </label>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFilters(EMPTY)}>
          Clear
        </button>
      </div>

      <PaymentsTable
        rows={rows}
        onRowClick={(p) => setActiveId(p.id)}
        onEdit={canEdit ? (id) => openEdit(id) : undefined}
        onDelete={canEdit ? handleDelete : undefined}
      />

      <PaymentFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditTarget(null)
        }}
        onSave={handleSave}
        saving={saving}
        editTarget={canEdit ? editTarget : null}
      />

      <PaymentDetailDrawer
        payment={active}
        onClose={() => setActiveId(null)}
        onEdit={canEdit ? openEdit : undefined}
        onMarkInformed={canEdit ? (id) => markInformedToAsad(id, '') : undefined}
        onMarkDone={canEdit ? (id, file, note) => markPaymentDone(id, file || null, note) : undefined}
        onSetProof={canEdit ? (id, file) => setPaymentProof(id, file) : undefined}
        onAttachBill={canEdit ? (id, file) => addAttachment(id, file) : undefined}
      />
    </div>
  )
}

export { buildAnnualLeavePaymentPayload } from '../../utils/paymentUtils'
