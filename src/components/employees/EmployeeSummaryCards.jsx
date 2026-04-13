import { memo } from 'react'
import './EmployeeSummaryCards.css'

export const EmployeeSummaryCards = memo(function EmployeeSummaryCards({
  total,
  activeCount,
  inactiveCount,
  onLeaveCount,
}) {
  const cards = [
    {
      label: 'Total employees',
      value: total,
      hint: 'In directory',
    },
    {
      label: 'Active',
      value: activeCount,
      hint: 'Currently active',
      variant: 'success',
    },
    {
      label: 'Inactive',
      value: inactiveCount,
      hint: 'Not active',
      variant: 'muted',
    },
    {
      label: 'On leave',
      value: onLeaveCount,
      hint: onLeaveCount === 0 ? 'No leave records yet' : 'Away on leave',
      variant: 'warning',
      mutedHint: onLeaveCount === 0,
    },
  ]

  return (
    <div className="employee-summary-cards" role="region" aria-label="Employee summary">
      {cards.map((c) => (
        <div
          key={c.label}
          className={`employee-summary-card${c.variant ? ` employee-summary-card--${c.variant}` : ''}`}
        >
          <span className="employee-summary-card__label">{c.label}</span>
          <span className="employee-summary-card__value">{c.value}</span>
          <span
            className={`employee-summary-card__hint${c.mutedHint ? ' employee-summary-card__hint--muted' : ''}`}
          >
            {c.hint}
          </span>
        </div>
      ))}
    </div>
  )
})
