import { useRef } from 'react'
import type { Subscription } from '../../../api/subscriptions'
import { SubscriptionIcon } from './SubscriptionIcon'
import {
  SubscriptionStatusBadge,
  DaysRemainingLabel,
  InvoiceStatusBadge,
  PaymentStatusBadge,
  fmtDate,
  fmtMoney,
} from './subscriptionDisplay'

interface Props {
  subscription: Subscription | null
  onClose: () => void
  onEdit: (sub: Subscription) => void
  onDelete: (id: string) => void
  onUploadInvoice: (id: string, file: File) => Promise<void>
  onDownloadInvoice: (subscriptionId: string, invoiceId: string) => Promise<void>
  onSendPayment: (sub: Subscription) => void
  onMarkPaid: (id: string) => Promise<void>
  onRenew: (id: string) => Promise<void>
  canEdit: boolean
  canDelete: boolean
  actionLoading: boolean
}

export function SubscriptionDetailDrawer({
  subscription,
  onClose,
  onEdit,
  onDelete,
  onUploadInvoice,
  onDownloadInvoice,
  onSendPayment,
  onMarkPaid,
  onRenew,
  canEdit,
  canDelete,
  actionLoading,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  if (!subscription) return null

  const sub = subscription

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await onUploadInvoice(sub.id, file)
    e.target.value = ''
  }

  return (
    <div className="sub-drawer-backdrop" onClick={onClose}>
      <aside className="sub-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="sub-drawer__head">
          <div>
            <div className="sub-drawer__title-row">
              <SubscriptionIcon name={sub.name} vendor={sub.vendor} variant="drawer" />
              <h2>{sub.name}</h2>
            </div>
            <div className="sub-drawer__badges">
              <SubscriptionStatusBadge expiryDate={sub.expiryDate} />
              <span className="sub-pill sub-pill--muted">{sub.category}</span>
            </div>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="sub-drawer__body">
          <section className="sub-drawer__section">
            <h3>Overview</h3>
            <dl className="sub-detail-grid">
              <dt>Vendor</dt><dd>{sub.vendor || '—'}</dd>
              <dt>Billing</dt><dd>{sub.billingCycle}</dd>
              <dt>Cost</dt><dd>{fmtMoney(sub.cost, sub.currency)}</dd>
              <dt>Start</dt><dd>{fmtDate(sub.startDate)}</dd>
              <dt>Expiry</dt><dd>{fmtDate(sub.expiryDate)}</dd>
              <dt>Days left</dt><dd><DaysRemainingLabel expiryDate={sub.expiryDate} /></dd>
              <dt>Responsible</dt><dd>{sub.responsiblePerson || '—'}</dd>
              <dt>Auto-renew</dt><dd>{sub.autoRenew ? 'Yes' : 'No'}</dd>
            </dl>
            {sub.notes && (
              <p style={{ margin: '0.625rem 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
                {sub.notes}
              </p>
            )}
          </section>

          <section className="sub-drawer__section">
            <h3>Invoice</h3>
            <p style={{ margin: '0 0 0.375rem', fontSize: '0.8125rem' }}>
              <InvoiceStatusBadge status={sub.invoiceStatus} />
            </p>
            {(sub.invoices?.length ?? 0) === 0 ? (
              <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: 0 }}>No invoices uploaded.</p>
            ) : (
              sub.invoices!.map((inv) => (
                <div key={inv.id} className="sub-invoice-item">
                  <span>{inv.fileName}</span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => onDownloadInvoice(sub.id, inv.id)}
                  >
                    Download
                  </button>
                </div>
              ))
            )}
          </section>

          <section className="sub-drawer__section">
            <h3>Payment</h3>
            <p style={{ margin: 0, fontSize: '0.8125rem' }}>
              <PaymentStatusBadge status={sub.paymentStatus} />
            </p>
          </section>

          {canEdit && (
            <section className="sub-drawer__section">
              <h3>Actions</h3>
              <div className="sub-drawer__actions">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => onEdit(sub)} disabled={actionLoading}>
                  Edit
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => fileRef.current?.click()} disabled={actionLoading}>
                  Upload Invoice
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => onSendPayment(sub)} disabled={actionLoading}>
                  Send to Payment Group
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => onMarkPaid(sub.id)} disabled={actionLoading}>
                  Mark Paid
                </button>
                <button type="button" className="btn btn--primary btn--sm" onClick={() => onRenew(sub.id)} disabled={actionLoading}>
                  Renew
                </button>
                {canDelete && (
                  <button type="button" className="btn btn--danger btn--sm" onClick={() => onDelete(sub.id)} disabled={actionLoading}>
                    Delete
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" hidden onChange={handleFile} />
            </section>
          )}

          <section className="sub-drawer__section">
            <h3>Activity Log</h3>
            {(sub.activityLogs?.length ?? 0) === 0 ? (
              <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: 0 }}>No activity yet.</p>
            ) : (
              sub.activityLogs!.map((log) => (
                <div key={log.id} className="sub-activity-item">
                  <strong>{log.action.replace(/_/g, ' ')}</strong> — {log.message}
                  <time>{new Date(log.createdAt).toLocaleString('en-GB')}</time>
                </div>
              ))
            )}
          </section>
        </div>
      </aside>
    </div>
  )
}
