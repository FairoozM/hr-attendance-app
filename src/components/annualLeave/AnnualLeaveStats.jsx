const CARDS = [
  { key: 'queue:needsAction', field: 'needs_action', label: 'Needs action', hint: 'Decisions, returns, shop and handover work' },
  { key: 'Pending', field: 'pending', label: 'Pending approval', hint: 'Waiting for admin decision' },
  { key: 'Ongoing', field: 'ongoing', label: 'Currently on leave', hint: 'Employees away now' },
  { key: 'ReturnPending', field: 'return_pending_total', label: 'Return pending', hint: 'Return must be recorded' },
  { key: 'Overstayed', field: 'overstayed', label: 'Overstayed', hint: 'Past expected return' },
  { key: 'queue:shopSalary', field: 'shop_salary_pending', label: 'Salary / handover pending', hint: 'Shop visit, salary, or handover still open' },
]

const SWATCH = {
  Ongoing: { color: '#8b5cf6', bg: '#ede9fe' },
  Approved: { color: '#3b82f6', bg: '#dbeafe' },
  ReturnPending: { color: '#f97316', bg: '#ffedd5' },
  Overstayed: { color: '#ef4444', bg: '#fee2e2' },
  Pending: { color: '#f59e0b', bg: '#fef3c7' },
  Completed: { color: '#22c55e', bg: '#dcfce7' },
  'queue:needsAction': { color: '#6366f1', bg: '#e0e7ff' },
  'queue:shopSalary': { color: '#0f766e', bg: '#ccfbf1' },
}

export function AnnualLeaveStats({ stats, derivedStats, activeKey, onFilterClick, isAdmin }) {
  if (!stats || !isAdmin) return null
  return (
    <div className="al-dashboard" role="navigation" aria-label="Operational leave queues">
      {CARDS.map((c) => {
        const sw = SWATCH[c.key] || SWATCH.Pending
        const count = derivedStats?.[c.field] ?? stats[c.field] ?? 0
        return (
          <button
            key={c.key}
            type="button"
            className={`al-stat-card ${activeKey === c.key ? 'al-stat-card--active' : ''}`}
            style={{ borderTopColor: sw.color }}
            onClick={() => onFilterClick(c.key)}
          >
            <div className="al-stat-card__icon al-stat-card__icon--dot" style={{ background: sw.bg }} />
            <div className="al-stat-card__body">
              <div className="al-stat-card__num" style={{ color: sw.color }}>
                {count}
              </div>
              <div className="al-stat-card__label">{c.label}</div>
              <div className="al-stat-card__hint">{c.hint}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
