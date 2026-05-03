const CARDS = [
  { key: 'Ongoing', field: 'ongoing', label: 'On leave now' },
  { key: 'Approved', field: 'upcoming', label: 'Upcoming' },
  { key: 'ReturnPending', field: 'return_pending_total', label: 'Return pending' },
  { key: 'Overstayed', field: 'overstayed', label: 'Overstayed' },
  { key: 'Pending', field: 'pending', label: 'Pending approval' },
  { key: 'Completed', field: 'completed_this_month', label: 'Closed this month' },
]

const SWATCH = {
  Ongoing: { color: '#8b5cf6', bg: '#ede9fe' },
  Approved: { color: '#3b82f6', bg: '#dbeafe' },
  ReturnPending: { color: '#f97316', bg: '#ffedd5' },
  Overstayed: { color: '#ef4444', bg: '#fee2e2' },
  Pending: { color: '#f59e0b', bg: '#fef3c7' },
  Completed: { color: '#22c55e', bg: '#dcfce7' },
}

export function AnnualLeaveStats({ stats, onFilterClick, isAdmin }) {
  if (!stats || !isAdmin) return null
  return (
    <div className="al-dashboard" role="navigation" aria-label="Filter by status">
      {CARDS.map((c) => {
        const sw = SWATCH[c.key] || SWATCH.Pending
        return (
          <button
            key={c.key}
            type="button"
            className="al-stat-card"
            style={{ borderTopColor: sw.color }}
            onClick={() => onFilterClick(c.key)}
          >
            <div className="al-stat-card__icon al-stat-card__icon--dot" style={{ background: sw.bg }} />
            <div className="al-stat-card__body">
              <div className="al-stat-card__num" style={{ color: sw.color }}>
                {stats[c.field] ?? 0}
              </div>
              <div className="al-stat-card__label">{c.label}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
