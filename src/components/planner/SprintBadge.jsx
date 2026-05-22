/**
 * SprintBadge.jsx
 * Shows the sprint name and status for a task row.
 */
import { Zap } from 'lucide-react'

const STATUS_CLASS = {
  active:    'sb--active',
  completed: 'sb--completed',
  draft:     'sb--draft',
}

export function SprintBadge({ sprint }) {
  if (!sprint) return <span className="sb sb--none">No Sprint</span>

  const statusClass = STATUS_CLASS[sprint.status] || 'sb--draft'

  return (
    <span className={`sb ${statusClass}`} title={`Sprint: ${sprint.name} (${sprint.status})`}>
      <Zap size={10} strokeWidth={2.5} aria-hidden="true" className="sb__icon" />
      <span className="sb__name">{sprint.name}</span>
    </span>
  )
}

export default SprintBadge
