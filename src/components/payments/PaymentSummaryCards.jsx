import { useMemo } from 'react'
import { PAYMENT_STATUS } from '../../data/paymentTypes'
import { getDaysLeft, getInformAsadDate } from '../../utils/paymentUtils'
import './paymentsShared.css'

function weekEnd() {
  const t = new Date()
  t.setDate(t.getDate() + 7)
  t.setHours(23, 59, 59, 999)
  return t
}

/**
 * @param {object} props
 * @param {import('../../hooks/useCompanyPayments').CompanyPayment[]} props.payments
 */
export function PaymentSummaryCards({ payments }) {
  const stats = useMemo(() => {
    const list = Array.isArray(payments) ? payments : []
    let totalNeeded = 0
    let needInform = 0
    let informed = 0
    let done = 0
    let overdue = 0
    let dueThisWeek = 0
    const we = weekEnd()

    for (const p of list) {
      if (p.status === PAYMENT_STATUS.PAYMENT_DONE) {
        done += 1
        continue
      }
      totalNeeded += 1
      if (p.status === PAYMENT_STATUS.INFORMED_TO_ASAD) informed += 1
      const dLeft = getDaysLeft(p.dueDate)
      if (dLeft != null && dLeft < 0) overdue += 1

      if (dLeft != null && dLeft >= 0 && dLeft <= 7) {
        const due = new Date(`${p.dueDate}T12:00:00`)
        if (due <= we) dueThisWeek += 1
      }

      if (p.status === PAYMENT_STATUS.PAYMENT_NEEDED) {
        const informBy = p.informAsadDate || getInformAsadDate(p.dueDate, p.informAsadBeforeDays)
        const untilInform = getDaysLeft(informBy)
        if (untilInform != null && untilInform <= 2) needInform += 1
      }
    }
    return { totalNeeded, needInform, informed, done, overdue, dueThisWeek }
  }, [payments])

  const cards = [
    { k: 'total', label: 'Active pipeline', sub: 'Not yet paid out', n: stats.totalNeeded, accent: 'var(--text-primary)' },
    { k: 'inform', label: 'Need to inform Asad', sub: 'Within 2 days of inform date', n: stats.needInform, accent: '#ec4899' },
    { k: 'informed', label: 'Informed to Asad', sub: 'Awaiting payment', n: stats.informed, accent: '#8b5cf6' },
    { k: 'done', label: 'Payment done', sub: 'Completed', n: stats.done, accent: '#22c55e' },
    { k: 'overdue', label: 'Overdue (due date)', sub: 'Still open', n: stats.overdue, accent: '#ef4444' },
    { k: 'week', label: 'Due this week', sub: 'Next 7 days', n: stats.dueThisWeek, accent: '#0ea5e9' },
  ]

  return (
    <div className="pay-summary-cards" role="region" aria-label="Payment summary">
      {cards.map((c) => (
        <div key={c.k} className="pay-summary-card" style={{ '--pay-accent': c.accent }}>
          <div className="pay-summary-card__n">{c.n}</div>
          <div className="pay-summary-card__label">{c.label}</div>
          <div className="pay-summary-card__sub">{c.sub}</div>
        </div>
      ))}
    </div>
  )
}
