import { useRef } from 'react'
import type { Subscription } from '../../../api/subscriptions'
import { SubscriptionIcon } from './SubscriptionIcon'
import {
  SubscriptionStatusBadge,
  DaysRemainingLabel,
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
              <SubscriptionIcon name={sub.name} vendor={sub.vendor} size={36} className="sub-icon--drawer" />
              <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{sub.name}</h2>
            </div>
            <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              <SubscriptionStatusBadge expiryDate={sub.expiryDate} />
              <span className="sub-badge sub-badge--neutral">{sub.category}</span>
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
              <dt>Days Left</dt><dd><DaysRemainingLabel expiryDate={sub.expiryDate} /></dd>
              <dt>Invoice Status</dt><dd>{sub.invoiceStatus}</dd>
              <dt>Payment Status</dt><dd>{sub.paymentStatus}</dd>
              <dt>Responsible</dt><dd>{sub.responsiblePerson || '—'}</dd>
              <dt>Auto-renew</dt><dd>{sub.autoRenew ? 'Yes' : 'No'}</dd>
            </dl>
            {sub.notes && (
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {sub.notes}
              </p>
            )}
          </section>

          {canEdit && (
            <section className="sub-drawer__section">
              <h3>Actions</h3>
              <div className="sub-actions">
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
                <button type="button" className="btn btn--danger btn--sm" onClick={() => onDelete(sub.id)} disabled={actionLoading}>
                  Delete
                </button>
              </div>
              <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" hidden onChange={handleFile} />
            </section>
          )}

          <section className="sub-drawer__section">
            <h3>Invoices ({sub.invoices?.length ?? sub.invoiceCount})</h3>
            {(sub.invoices?.length ?? 0) === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>No invoices uploaded.</p>
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
            <h3>Activity Log</h3>
            {(sub.activityLogs?.length ?? 0) === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>No activity yet.</p>
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
