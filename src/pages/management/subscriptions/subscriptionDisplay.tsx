import {
  computeSubscriptionStatus,
  formatDaysRemaining,
  statusBadgeVariant,
  daysRemainingPillVariant,
  fmtDate,
  fmtMoney,
  SUBSCRIPTION_CATEGORIES,
  BILLING_CYCLES,
  type SubscriptionStatus,
} from '../../../lib/subscriptionUtils'

export function SubscriptionStatusBadge({ expiryDate }: { expiryDate: string | null | undefined }) {
  const status = computeSubscriptionStatus(expiryDate) as SubscriptionStatus
  return (
    <span className={`sub-pill sub-pill--${statusBadgeVariant(status)}`}>
      {status}
    </span>
  )
}

export function DaysRemainingLabel({ expiryDate }: { expiryDate: string | null | undefined }) {
  const variant = daysRemainingPillVariant(expiryDate)
  return (
    <span className={`sub-pill sub-pill--days-${variant}`}>
      {formatDaysRemaining(expiryDate)}
    </span>
  )
}

export function InvoiceStatusBadge({ status }: { status: string }) {
  const s = String(status || '').toLowerCase()
  let variant = 'muted'
  if (s.includes('missing')) variant = 'warning'
  else if (s.includes('sent')) variant = 'info'
  else if (s.includes('upload')) variant = 'ok'
  return <span className={`sub-pill sub-pill--${variant}`}>{status || '—'}</span>
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const s = String(status || '').toLowerCase()
  let variant = 'muted'
  if (s.includes('paid')) variant = 'ok'
  else if (s.includes('requested')) variant = 'info'
  else if (s.includes('unpaid')) variant = 'warning'
  return <span className={`sub-pill sub-pill--${variant}`}>{status || '—'}</span>
}

export { fmtDate, fmtMoney, SUBSCRIPTION_CATEGORIES, BILLING_CYCLES }
