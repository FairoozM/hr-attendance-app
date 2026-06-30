export const SUBSCRIPTION_CATEGORIES = [
  'AI',
  'Efficiency',
  'Design & Dev',
  'Accounting',
  'Marketing',
  'Hosting',
  'Marketplace',
  'Communication',
  'Other',
] as const

export const BILLING_CYCLES = [
  'Monthly',
  'Yearly',
  'Quarterly',
  'One-Time',
  'Custom',
] as const

export const SUBSCRIPTION_STATUS = {
  EXPIRED: 'Expired',
  EXPIRING_SOON: 'Expiring Soon',
  UPCOMING: 'Upcoming',
  ACTIVE: 'Active',
} as const

export type SubscriptionCategory = (typeof SUBSCRIPTION_CATEGORIES)[number]
export type BillingCycle = (typeof BILLING_CYCLES)[number]
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS]

export function getDaysLeft(expiryDate: string | null | undefined): number | null {
  if (!expiryDate) return null
  const s = String(expiryDate).slice(0, 10)
  const [y, m, d] = s.split('-').map(Number)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exp = new Date(y, m - 1, d)
  exp.setHours(0, 0, 0, 0)
  return Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

export function computeSubscriptionStatus(expiryDate: string | null | undefined): SubscriptionStatus {
  const days = getDaysLeft(expiryDate)
  if (days === null) return SUBSCRIPTION_STATUS.ACTIVE
  if (days < 0) return SUBSCRIPTION_STATUS.EXPIRED
  if (days <= 15) return SUBSCRIPTION_STATUS.EXPIRING_SOON
  if (days <= 30) return SUBSCRIPTION_STATUS.UPCOMING
  return SUBSCRIPTION_STATUS.ACTIVE
}

export function formatDaysRemaining(expiryDate: string | null | undefined): string {
  const days = getDaysLeft(expiryDate)
  if (days === null) return '—'
  if (days < 0) {
    const n = Math.abs(days)
    return `Expired ${n} day${n !== 1 ? 's' : ''} ago`
  }
  if (days === 0) return 'Expires today'
  return `${days} day${days !== 1 ? 's' : ''} left`
}

export function daysRemainingPillVariant(expiryDate: string | null | undefined): string {
  const days = getDaysLeft(expiryDate)
  if (days === null) return 'muted'
  if (days < 0) return 'expired'
  if (days <= 7) return 'critical'
  if (days <= 30) return 'warning'
  return 'ok'
}

export function statusBadgeVariant(status: SubscriptionStatus): string {
  switch (status) {
    case SUBSCRIPTION_STATUS.EXPIRED:
      return 'expired'
    case SUBSCRIPTION_STATUS.EXPIRING_SOON:
      return 'expiring-soon'
    case SUBSCRIPTION_STATUS.UPCOMING:
      return 'upcoming'
    default:
      return 'active'
  }
}

export function fmtDate(isoStr: string | null | undefined): string {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB')
}

export function fmtMoney(amount: number, currency = 'AED'): string {
  return `${currency} ${Number(amount).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
