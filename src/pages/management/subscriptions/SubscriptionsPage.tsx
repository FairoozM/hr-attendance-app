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
import { SubscriptionNameWithIcon } from './SubscriptionIcon'
import {
  SubscriptionStatusBadge,
  DaysRemainingLabel,
  SUBSCRIPTION_CATEGORIES,
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
      if (statusFilter && computeSubscriptionStatus(sub.expiryDate) !== statusFilter) return false
      if (q) {
        const blob = [sub.name, sub.vendor, sub.category, sub.responsiblePerson].join(' ').toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [items, search, categoryFilter, statusFilter])

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
        if (detailSub?.id === editTarget?.id) {
          const refreshed = await fetchSubscription(editTarget!.id)
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
      if (detailSub?.id === paymentSubId) {
        setDetailSub(subscription)
      }
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

  const stopRowClick = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div className="page">
      <div className="subscriptions-page">
        <div className="sub-page-hero">
          <div>
            <h1 className="sub-page-title">Subscription Management</h1>
            <p className="sub-page-subtitle">
              Track company tool subscriptions — expiry, invoices, and payment follow-up for
              ChatGPT, Cursor, AWS, Zoho, Adobe, and more.
            </p>
          </div>
          {canAdd && (
            <button type="button" className="btn btn--primary" onClick={openAdd}>
              + Add Subscription
            </button>
          )}
        </div>

        {error && <div className="sub-error-banner">⚠ {error}</div>}

        {summary && (
          <div className="sub-summary-cards">
            <div className="sub-summary-card sub-summary-card--total">
              <span className="sub-summary-card__count">{summary.totalSubscriptions}</span>
              <span className="sub-summary-card__label">Total</span>
            </div>
            <div className="sub-summary-card sub-summary-card--cost">
              <span className="sub-summary-card__count">{fmtMoney(summary.monthlyCost)}</span>
              <span className="sub-summary-card__label">Monthly Cost</span>
            </div>
            <div className="sub-summary-card sub-summary-card--cost">
              <span className="sub-summary-card__count">{fmtMoney(summary.annualizedCost)}</span>
              <span className="sub-summary-card__label">Annualized</span>
            </div>
            <div className="sub-summary-card sub-summary-card--expiring">
              <span className="sub-summary-card__count">{summary.expiringIn30Days}</span>
              <span className="sub-summary-card__label">Expiring in 30 Days</span>
            </div>
            <div className="sub-summary-card sub-summary-card--expired">
              <span className="sub-summary-card__count">{summary.expired}</span>
              <span className="sub-summary-card__label">Expired</span>
            </div>
            <div className="sub-summary-card sub-summary-card--invoice">
              <span className="sub-summary-card__count">{summary.missingInvoices}</span>
              <span className="sub-summary-card__label">Missing Invoices</span>
            </div>
            <div className="sub-summary-card sub-summary-card--payment">
              <span className="sub-summary-card__count">{summary.pendingPayments}</span>
              <span className="sub-summary-card__label">Pending Payments</span>
            </div>
          </div>
        )}

        <div className="sub-filters">
          <input
            type="search"
            placeholder="Search subscriptions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {SUBSCRIPTION_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="Expired">Expired</option>
            <option value="Expiring Soon">Expiring Soon</option>
            <option value="Upcoming">Upcoming</option>
            <option value="Active">Active</option>
          </select>
        </div>

        {loading ? (
          <div className="sub-loading">Loading subscriptions…</div>
        ) : filtered.length === 0 ? (
          <div className="sub-empty">No subscriptions found.</div>
        ) : (
          <>
            <div className="sub-table-wrap">
              <table className="sub-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Billing</th>
                    <th>Cost</th>
                    <th>Start</th>
                    <th>Expiry</th>
                    <th>Days Remaining</th>
                    <th>Invoice</th>
                    <th>Payment</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((sub) => (
                    <tr key={sub.id} onClick={() => openDetail(sub)}>
                      <td>
                        <SubscriptionNameWithIcon name={sub.name} vendor={sub.vendor} size={22} className="sub-table__name" />
                      </td>
                      <td>{sub.category}</td>
                      <td><SubscriptionStatusBadge expiryDate={sub.expiryDate} /></td>
                      <td>{sub.billingCycle}</td>
                      <td>{fmtMoney(sub.cost, sub.currency)}</td>
                      <td>{fmtDate(sub.startDate)}</td>
                      <td>{fmtDate(sub.expiryDate)}</td>
                      <td><DaysRemainingLabel expiryDate={sub.expiryDate} /></td>
                      <td><span className="sub-badge sub-badge--neutral">{sub.invoiceStatus}</span></td>
                      <td><span className="sub-badge sub-badge--neutral">{sub.paymentStatus}</span></td>
                      <td onClick={stopRowClick}>
                        <div className="sub-actions">
                          {canEdit && (
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEdit(sub)}>
                              Edit
                            </button>
                          )}
                          {canDelete && (
                            <button type="button" className="btn btn--danger btn--sm" onClick={() => setDeleteId(sub.id)}>
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sub-cards">
              {filtered.map((sub) => (
                <div key={sub.id} className="sub-card" onClick={() => openDetail(sub)}>
                  <div className="sub-card__head">
                    <div className="sub-card__title-row">
                      <SubscriptionNameWithIcon name={sub.name} vendor={sub.vendor} size={22} />
                    </div>
                    <SubscriptionStatusBadge expiryDate={sub.expiryDate} />
                  </div>
                  <div className="sub-card__meta">
                    <span>Category: <strong>{sub.category}</strong></span>
                    <span>Billing: <strong>{sub.billingCycle}</strong></span>
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
        onDelete={(id) => setDeleteId(id)}
        onUploadInvoice={handleUploadInvoice}
        onDownloadInvoice={handleDownloadInvoice}
        onSendPayment={handleSendPayment}
        onMarkPaid={handleMarkPaid}
        onRenew={handleRenew}
        canEdit={canEdit}
        actionLoading={actionLoading}
      />

      <PaymentGroupModal
        open={paymentModalOpen}
        message={paymentMessage}
        onClose={() => setPaymentModalOpen(false)}
        onConfirm={handleConfirmPayment}
        confirming={paymentConfirming}
      />

      <Modal
        title="Delete Subscription"
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
      >
        <p>Are you sure you want to delete this subscription?</p>
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
