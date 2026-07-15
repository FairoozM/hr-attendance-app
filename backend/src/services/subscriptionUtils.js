const CATEGORIES = [
  'AI',
  'Efficiency',
  'Design & Dev',
  'Accounting',
  'Marketing',
  'Hosting',
  'Marketplace',
  'Communication',
  'Other',
]

const BILLING_CYCLES = ['Monthly', 'Yearly', 'Quarterly', 'One-Time', 'Custom']

const STATUS = {
  EXPIRED: 'Expired',
  EXPIRING_SOON: 'Expiring Soon',
  UPCOMING: 'Upcoming',
  ACTIVE: 'Active',
}

function formatLocalIso(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Normalize pg DATE / Date / ISO strings to YYYY-MM-DD.
 * node-pg returns DATE columns as Date objects; String(date).slice(0, 10) yields
 * "Wed Jul 15" (not ISO) and breaks SQL inserts with "NaN-NaN-NaN".
 */
function toIsoDate(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return formatLocalIso(value)
  }
  const s = String(value).trim()
  const iso = s.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const parsed = new Date(s)
  if (Number.isNaN(parsed.getTime())) return null
  return formatLocalIso(parsed)
}

function parseLocalDate(isoDate) {
  if (isoDate instanceof Date) {
    return new Date(isoDate.getFullYear(), isoDate.getMonth(), isoDate.getDate())
  }
  const iso = toIsoDate(isoDate)
  if (!iso) return new Date(NaN)
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function getDaysLeft(expiryDate) {
  if (!expiryDate) return null
  const exp = parseLocalDate(expiryDate)
  if (Number.isNaN(exp.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  exp.setHours(0, 0, 0, 0)
  return Math.ceil((exp - today) / (1000 * 60 * 60 * 24))
}

function computeStatus(expiryDate) {
  const days = getDaysLeft(expiryDate)
  if (days === null) return STATUS.ACTIVE
  if (days < 0) return STATUS.EXPIRED
  if (days <= 15) return STATUS.EXPIRING_SOON
  if (days <= 30) return STATUS.UPCOMING
  return STATUS.ACTIVE
}

function formatDaysRemaining(expiryDate) {
  const days = getDaysLeft(expiryDate)
  if (days === null) return '—'
  if (days < 0) {
    const n = Math.abs(days)
    return `Expired ${n} day${n !== 1 ? 's' : ''} ago`
  }
  if (days === 0) return 'Expires today'
  return `${days} day${days !== 1 ? 's' : ''} left`
}

function monthlyCost(cost, billingCycle) {
  const c = Number(cost) || 0
  switch (billingCycle) {
    case 'Yearly':
      return c / 12
    case 'Quarterly':
      return c / 3
    case 'One-Time':
      return 0
    default:
      return c
  }
}

function addBillingPeriod(expiryDate, billingCycle) {
  const base = expiryDate ? parseLocalDate(expiryDate) : new Date()
  if (Number.isNaN(base.getTime())) base.setTime(Date.now())
  const d = new Date(base)
  switch (billingCycle) {
    case 'Yearly':
      d.setFullYear(d.getFullYear() + 1)
      break
    case 'Quarterly':
      d.setMonth(d.getMonth() + 3)
      break
    case 'One-Time':
      d.setFullYear(d.getFullYear() + 1)
      break
    case 'Custom':
      d.setMonth(d.getMonth() + 1)
      break
    default:
      d.setMonth(d.getMonth() + 1)
  }
  return formatLocalIso(d)
}

function subtractDays(isoDate, days) {
  const d = parseLocalDate(isoDate)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() - Number(days))
  return formatLocalIso(d)
}

module.exports = {
  CATEGORIES,
  BILLING_CYCLES,
  STATUS,
  getDaysLeft,
  computeStatus,
  formatDaysRemaining,
  monthlyCost,
  addBillingPeriod,
  subtractDays,
  formatLocalIso,
  toIsoDate,
}
