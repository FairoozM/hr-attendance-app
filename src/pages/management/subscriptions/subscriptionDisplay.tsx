import {
  computeSubscriptionStatus,
  formatDaysRemaining,
  statusBadgeVariant,
  fmtDate,
  fmtMoney,
  SUBSCRIPTION_CATEGORIES,
  BILLING_CYCLES,
  type SubscriptionStatus,
} from '../../../lib/subscriptionUtils'

export function SubscriptionStatusBadge({ expiryDate }: { expiryDate: string | null | undefined }) {
  const status = computeSubscriptionStatus(expiryDate) as SubscriptionStatus
  return (
    <span className={`sub-badge sub-badge--${statusBadgeVariant(status)}`}>
      {status}
    </span>
  )
}

export function DaysRemainingLabel({ expiryDate }: { expiryDate: string | null | undefined }) {
  const status = computeSubscriptionStatus(expiryDate)
  const variant = statusBadgeVariant(status)
  return (
    <span className={`sub-badge sub-badge--${variant}`}>
      {formatDaysRemaining(expiryDate)}
    </span>
  )
}

export { fmtDate, fmtMoney, SUBSCRIPTION_CATEGORIES, BILLING_CYCLES }
