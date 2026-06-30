import { useState, useMemo, useCallback } from 'react'
import { hasPermission, useAuth } from '../../../contexts/AuthContext'
import { useSubscriptions } from '../../../hooks/useSubscriptions'
import {
  previewPaymentGroupMessage,
  confirmSendToPaymentGroup,
  markSubscriptionPaid,
  renewSubscription,
  uploadSubscriptionInvoice,
  getInvoiceDownloadUrl,
  fetchSubscription,
  type Subscription,
  type SubscriptionFormPayload,
} from '../../../api/subscriptions'
import { computeSubscriptionStatus, fmtDate, fmtMoney } from '../../../lib/subscriptionUtils'
import { Modal } from '../../../components/Modal'
import { SubscriptionFormModal } from './SubscriptionFormModal'
import { SubscriptionDetailDrawer } from './SubscriptionDetailDrawer'
import { PaymentGroupModal } from './PaymentGroupModal'
import { SubscriptionKpiCards } from './SubscriptionKpiCards'
import { SubscriptionRowActions } from './SubscriptionRowActions'
import { SubscriptionNameWithIcon } from './SubscriptionIcon'
import {
  SubscriptionStatusBadge,
  DaysRemainingLabel,
  InvoiceStatusBadge,
  PaymentStatusBadge,
  SUBSCRIPTION_CATEGORIES,
  BILLING_CYCLES,
} from './subscriptionDisplay'
import './SubscriptionsPage.css'

export function SubscriptionsPage() {
  const { user } = useAuth()
  const canEdit = hasPermission(user, 'subscriptions', 'edit')
  const canAdd = hasPermission(user, 'subscriptions', 'add')
  const canDelete = hasPermission(user, 'subscriptions', 'delete')

  const { items, summary, loading, error, createItem, updateItem, deleteItem, refreshOne } =
    useSubscriptions()

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [billingFilter, setBillingFilter] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Subscription | null>(null)
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [detailSub, setDetailSub] = useState<Subscription | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [paymentMessage, setPaymentMessage] = useState('')
  const [paymentSubId, setPaymentSubId] = useState<string | null>(null)
  const [paymentConfirming, setPaymentConfirming] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((sub) => {
      if (categoryFilter && sub.category !== categoryFilter) return false
      if (billingFilter && sub.billingCycle !== billingFilter) return false
      if (statusFilter && computeSubscriptionStatus(sub.expiryDate) !== statusFilter) return false
      if (q) {
        const blob = [sub.name, sub.vendor, sub.category, sub.responsiblePerson].join(' ').toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [items, search, categoryFilter, statusFilter, billingFilter])

  const openAdd = useCallback(() => {
    setEditTarget(null)
    setFormError('')
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((sub: Subscription) => {
    setEditTarget(sub)
    setFormError('')
    setFormOpen(true)
  }, [])

  const openDetail = useCallback(async (sub: Subscription) => {
    try {
      const detail = await fetchSubscription(sub.id)
      setDetailSub(detail)
    } catch {
      setDetailSub(sub)
    }
  }, [])

  const handleSave = useCallback(
    async (form: SubscriptionFormPayload) => {
      setFormSaving(true)
      setFormError('')
      try {
        if (editTarget) {
          await updateItem(editTarget.id, form)
        } else {
          await createItem(form)
        }
        setFormOpen(false)
        if (detailSub?.id === editTarget?.id && editTarget) {
          const refreshed = await fetchSubscription(editTarget.id)
          setDetailSub(refreshed)
        }
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Failed to save subscription')
      } finally {
        setFormSaving(false)
      }
    },
    [editTarget, createItem, updateItem, detailSub]
  )

  const handleDelete = useCallback(async () => {
    if (!deleteId) return
    setDeleteLoading(true)
    try {
      await deleteItem(deleteId)
      setDeleteId(null)
      if (detailSub?.id === deleteId) setDetailSub(null)
    } finally {
      setDeleteLoading(false)
    }
  }, [deleteId, deleteItem, detailSub])

  const handleSendPayment = useCallback(async (sub: Subscription) => {
    const { message } = await previewPaymentGroupMessage(sub.id)
    setPaymentMessage(message)
    setPaymentSubId(sub.id)
    setPaymentModalOpen(true)
  }, [])

  const handleConfirmPayment = useCallback(async () => {
    if (!paymentSubId) return
    setPaymentConfirming(true)
    try {
      const { subscription } = await confirmSendToPaymentGroup(paymentSubId)
      setPaymentModalOpen(false)
      await refreshOne(paymentSubId)
      if (detailSub?.id === paymentSubId) setDetailSub(subscription)
    } finally {
      setPaymentConfirming(false)
    }
  }, [paymentSubId, refreshOne, detailSub])

  const handleMarkPaid = useCallback(
    async (id: string) => {
      setActionLoading(true)
      try {
        const updated = await markSubscriptionPaid(id)
        await refreshOne(id)
        if (detailSub?.id === id) setDetailSub(updated)
      } finally {
        setActionLoading(false)
      }
    },
    [refreshOne, detailSub]
  )

  const handleRenew = useCallback(
    async (id: string) => {
      setActionLoading(true)
      try {
        const updated = await renewSubscription(id)
        await refreshOne(id)
        if (detailSub?.id === id) setDetailSub(updated)
      } finally {
        setActionLoading(false)
      }
    },
    [refreshOne, detailSub]
  )

  const handleUploadInvoice = useCallback(
    async (id: string, file: File) => {
      setActionLoading(true)
      try {
        await uploadSubscriptionInvoice(id, file)
        const updated = await fetchSubscription(id)
        await refreshOne(id)
        if (detailSub?.id === id) setDetailSub(updated)
      } finally {
        setActionLoading(false)
      }
    },
    [refreshOne, detailSub]
  )

  const handleDownloadInvoice = useCallback(async (subscriptionId: string, invoiceId: string) => {
    const { url } = await getInvoiceDownloadUrl(subscriptionId, invoiceId)
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  return (
    <div className="page">
      <div className="subscriptions-page">
        <header className="sub-page-header">
          <div>
            <h1 className="sub-page-title">Subscription Management</h1>
            <p className="sub-page-subtitle">
              Track renewals, invoices, and payment follow-ups.
            </p>
          </div>
        </header>

        {error && <div className="sub-error-banner">{error}</div>}

        {summary && <SubscriptionKpiCards summary={summary} />}

        <div className="sub-toolbar">
          <div className="sub-toolbar__field sub-toolbar__field--search">
            <label htmlFor="sub-search">Search</label>
            <input
              id="sub-search"
              type="search"
              placeholder="Name, vendor, category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="sub-toolbar__field">
            <label htmlFor="sub-category">Category</label>
            <select id="sub-category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All</option>
              {SUBSCRIPTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="sub-toolbar__field">
            <label htmlFor="sub-status">Status</label>
            <select id="sub-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="Expired">Expired</option>
              <option value="Expiring Soon">Expiring Soon</option>
              <option value="Upcoming">Upcoming</option>
              <option value="Active">Active</option>
            </select>
          </div>
          <div className="sub-toolbar__field">
            <label htmlFor="sub-billing">Billing</label>
            <select id="sub-billing" value={billingFilter} onChange={(e) => setBillingFilter(e.target.value)}>
              <option value="">All</option>
              {BILLING_CYCLES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          {canAdd && (
            <div className="sub-toolbar__actions">
              <button type="button" className="btn btn--primary" onClick={openAdd}>
                Add Subscription
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="sub-loading">Loading subscriptions…</div>
        ) : filtered.length === 0 ? (
          <div className="sub-empty">No subscriptions found.</div>
        ) : (
          <>
            <div className="sub-table-panel">
              <div className="sub-table-wrap">
                <table className="sub-table">
                  <thead>
                    <tr>
                      <th className="col-name">Name</th>
                      <th>Category</th>
                      <th>Status</th>
                      <th>Billing</th>
                      <th className="col-cost">Cost</th>
                      <th className="col-date">Start</th>
                      <th className="col-date">Expiry</th>
                      <th>Days Left</th>
                      <th>Invoice</th>
                      <th>Payment</th>
                      <th className="col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((sub) => (
                      <tr key={sub.id} onClick={() => openDetail(sub)}>
                        <td className="col-name">
                          <SubscriptionNameWithIcon name={sub.name} vendor={sub.vendor} />
                        </td>
                        <td>{sub.category}</td>
                        <td><SubscriptionStatusBadge expiryDate={sub.expiryDate} /></td>
                        <td>{sub.billingCycle}</td>
                        <td className="col-cost">{fmtMoney(sub.cost, sub.currency)}</td>
                        <td className="col-date">{fmtDate(sub.startDate)}</td>
                        <td className="col-date">{fmtDate(sub.expiryDate)}</td>
                        <td><DaysRemainingLabel expiryDate={sub.expiryDate} /></td>
                        <td><InvoiceStatusBadge status={sub.invoiceStatus} /></td>
                        <td><PaymentStatusBadge status={sub.paymentStatus} /></td>
                        <td className="col-actions">
                          <SubscriptionRowActions
                            sub={sub}
                            canEdit={canEdit}
                            canDelete={canDelete}
                            onView={openDetail}
                            onEdit={openEdit}
                            onDelete={setDeleteId}
                            onSendPayment={handleSendPayment}
                            onMarkPaid={handleMarkPaid}
                            onRenew={handleRenew}
                            onUploadInvoice={handleUploadInvoice}
                            onDownloadInvoice={handleDownloadInvoice}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="sub-cards">
              {filtered.map((sub) => (
                <div key={sub.id} className="sub-card" onClick={() => openDetail(sub)}>
                  <div className="sub-card__head">
                    <SubscriptionNameWithIcon name={sub.name} vendor={sub.vendor} />
                    <SubscriptionStatusBadge expiryDate={sub.expiryDate} />
                  </div>
                  <div className="sub-card__meta">
                    <span>Cost: <strong>{fmtMoney(sub.cost, sub.currency)}</strong></span>
                    <span>Expiry: <strong>{fmtDate(sub.expiryDate)}</strong></span>
                    <span>Days: <strong>{sub.daysRemainingLabel}</strong></span>
                    <span>Payment: <strong>{sub.paymentStatus}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <SubscriptionFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
        editTarget={editTarget}
        saving={formSaving}
        error={formError}
      />

      <SubscriptionDetailDrawer
        subscription={detailSub}
        onClose={() => setDetailSub(null)}
        onEdit={openEdit}
        onDelete={setDeleteId}
        onUploadInvoice={handleUploadInvoice}
        onDownloadInvoice={handleDownloadInvoice}
        onSendPayment={handleSendPayment}
        onMarkPaid={handleMarkPaid}
        onRenew={handleRenew}
        canEdit={canEdit}
        canDelete={canDelete}
        actionLoading={actionLoading}
      />

      <PaymentGroupModal
        open={paymentModalOpen}
        message={paymentMessage}
        onClose={() => setPaymentModalOpen(false)}
        onConfirm={handleConfirmPayment}
        confirming={paymentConfirming}
      />

      <Modal title="Delete Subscription" open={!!deleteId} onClose={() => setDeleteId(null)}>
        <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#475569' }}>
          This will remove the subscription from the tracker. This action cannot be undone.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn--ghost" onClick={() => setDeleteId(null)}>Cancel</button>
          <button type="button" className="btn btn--danger" onClick={handleDelete} disabled={deleteLoading}>
            {deleteLoading ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
