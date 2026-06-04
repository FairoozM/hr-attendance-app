export function Badge({ children, tone = 'muted' }) {
  return <span className={`pp-badge pp-badge--${tone}`}>{children}</span>
}

export function FilterChip({ active, children, onClick }) {
  return (
    <button type="button" className={`pp-filter-chip ${active ? 'pp-filter-chip--active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}

export function SortHeader({ label, sortKey, sort, onSort, nextSortFn }) {
  const active = sort.key === sortKey
  return (
    <th>
      <button
        type="button"
        className={`pp-sort-header ${active ? 'pp-sort-header--active' : ''}`}
        onClick={() => onSort(nextSortFn(sort, sortKey))}
      >
        <span>{label}</span>
        <span className="pp-sort-header__icon">{active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  )
}

export function RowBadgeList({ badges }) {
  if (!badges?.length) return null
  return (
    <div className="pp-row-badges">
      {badges.map((badge) => (
        <Badge key={badge.key} tone={badge.tone}>
          {badge.label}
        </Badge>
      ))}
    </div>
  )
}

export function StepStatusBadge({ status }) {
  const labels = {
    not_started: 'Not started',
    ready: 'Ready',
    in_progress: 'In progress',
    completed: 'Completed',
    blocked: 'Blocked',
    error: 'Error',
  }
  const tones = {
    not_started: 'muted',
    ready: 'warning',
    in_progress: 'warning',
    completed: 'success',
    blocked: 'danger',
    error: 'danger',
  }
  return <Badge tone={tones[status] || 'muted'}>{labels[status] || status}</Badge>
}
