/**
 * CycleBadge.jsx
 * Compact chip showing a cycle name.
 * Color reflects cycle status: planned=indigo, active=green, completed=gray.
 */
import { RotateCcw } from 'lucide-react'
import './CycleBadge.css'

const STATUS_STYLE = {
  planned:   { cls: 'cb--planned',   label: 'Planned'   },
  active:    { cls: 'cb--active',    label: 'Active'    },
  completed: { cls: 'cb--completed', label: 'Completed' },
}

export function CycleBadge({ name, status = 'planned', small = false }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.planned
  return (
    <span className={`cb ${s.cls} ${small ? 'cb--small' : ''}`} title={`Cycle: ${name}`}>
      <RotateCcw size={small ? 9 : 10} strokeWidth={2.2} className="cb__icon" aria-hidden="true" />
      <span className="cb__name">{name}</span>
    </span>
  )
}

export default CycleBadge
