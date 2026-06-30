import type { ReactNode } from 'react'
import {
  Layers,
  CalendarClock,
  AlertTriangle,
  FileWarning,
  CreditCard,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import type { SubscriptionSummary } from '../../../api/subscriptions'
import { fmtMoney } from '../../../lib/subscriptionUtils'

interface KpiItem {
  key: string
  label: string
  value: string
  subtext: string
  accent?: 'neutral' | 'expired' | 'expiring' | 'payment' | 'invoice'
  icon: ReactNode
}

interface Props {
  summary: SubscriptionSummary
}

export function SubscriptionKpiCards({ summary }: Props) {
  const items: KpiItem[] = [
    {
      key: 'total',
      label: 'Total Subscriptions',
      value: String(summary.totalSubscriptions),
      subtext: 'Active records in tracker',
      accent: 'neutral',
      icon: <Layers size={16} strokeWidth={2} aria-hidden />,
    },
    {
      key: 'monthly',
      label: 'Monthly Cost',
      value: fmtMoney(summary.monthlyCost),
      subtext: 'Current active recurring cost',
      accent: 'neutral',
      icon: <Wallet size={16} strokeWidth={2} aria-hidden />,
    },
    {
      key: 'annual',
      label: 'Annualized Cost',
      value: fmtMoney(summary.annualizedCost),
      subtext: 'Estimated yearly run rate',
      accent: 'neutral',
      icon: <TrendingUp size={16} strokeWidth={2} aria-hidden />,
    },
    {
      key: 'expiring',
      label: 'Expiring in 30 Days',
      value: String(summary.expiringIn30Days),
      subtext: 'Needs renewal attention',
      accent: 'expiring',
      icon: <CalendarClock size={16} strokeWidth={2} aria-hidden />,
    },
    {
      key: 'expired',
      label: 'Expired',
      value: String(summary.expired),
      subtext: 'Overdue subscriptions',
      accent: 'expired',
      icon: <AlertTriangle size={16} strokeWidth={2} aria-hidden />,
    },
    {
      key: 'invoice',
      label: 'Missing Invoices',
      value: String(summary.missingInvoices),
      subtext: 'Awaiting invoice upload',
      accent: 'invoice',
      icon: <FileWarning size={16} strokeWidth={2} aria-hidden />,
    },
    {
      key: 'payment',
      label: 'Pending Payments',
      value: String(summary.pendingPayments),
      subtext: 'Unpaid or requested',
      accent: 'payment',
      icon: <CreditCard size={16} strokeWidth={2} aria-hidden />,
    },
  ]

  return (
    <div className="sub-kpi-grid">
      {items.map((item) => (
        <div key={item.key} className={`sub-kpi-card sub-kpi-card--${item.accent || 'neutral'}`}>
          <div className="sub-kpi-card__body">
            <span className="sub-kpi-card__label">{item.label}</span>
            <span className="sub-kpi-card__value">{item.value}</span>
            <span className="sub-kpi-card__sub">{item.subtext}</span>
          </div>
          <span className="sub-kpi-card__icon" aria-hidden>{item.icon}</span>
        </div>
      ))}
    </div>
  )
}
