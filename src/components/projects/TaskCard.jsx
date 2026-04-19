import { useState } from 'react'
import { Check, Clock, AlertTriangle, ChevronRight, MoreHorizontal, Trash2, Edit2 } from 'lucide-react'
import { CategoryBadge } from './CategoryBadge'
import { PriorityIndicator, EnergyBadge } from './PriorityIndicator'

function DueBadge({ daysUntilDue, dueDate }) {
  if (daysUntilDue === null || dueDate === null) return null
  let label, cls
  if (daysUntilDue < 0)      { label = `${Math.abs(daysUntilDue)}d overdue`; cls = 'overdue' }
  else if (daysUntilDue === 0) { label = 'Today';                               cls = 'today' }
  else if (daysUntilDue === 1) { label = 'Tomorrow';                            cls = 'soon' }
  else if (daysUntilDue <= 7)  { label = `${daysUntilDue}d`;                    cls = 'week' }
  else {
    label = new Date(dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    cls = 'future'
  }
  return (
    <span className={`ai-due-badge ai-due-badge--${cls}`}>
      <Clock size={10} aria-hidden />
      {label}
    </span>
  )
}

export function TaskCard({ task, onComplete, onEdit, onDelete, onSelect, compact = false }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isDone    = task.status === 'Done' || !!task.completed_at
  const isBlocked = task.is_blocked || task.status === 'Blocked'

  return (
    <div
      className={`ai-task-card${isDone ? ' ai-task-card--done' : ''}${isBlocked ? ' ai-task-card--blocked' : ''}${compact ? ' ai-task-card--compact' : ''}`}
      style={{ '--priority-score': task.priorityScore || 0 }}
    >
      {/* Priority stripe */}
      <div className="ai-task-card__stripe" aria-hidden />

      <div className="ai-task-card__body">
        {/* Complete checkbox */}
        <button
          className={`ai-task-card__check${isDone ? ' ai-task-card__check--done' : ''}`}
          onClick={() => onComplete && onComplete(task)}
          aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
          title={isDone ? 'Completed' : 'Mark as done'}
        >
          {isDone && <Check size={11} aria-hidden />}
        </button>

        {/* Main content */}
        <div className="ai-task-card__main" onClick={() => onSelect && onSelect(task)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onSelect && onSelect(task)}>
          <div className="ai-task-card__title-row">
            <span className="ai-task-card__title">{task.title}</span>
            {isBlocked && (
              <span className="ai-task-card__blocked-badge" title="Blocked">
                <AlertTriangle size={12} aria-hidden /> Blocked
              </span>
            )}
          </div>

          {!compact && task.description && (
            <p className="ai-task-card__desc">{task.description}</p>
          )}

          <div className="ai-task-card__tags">
            <CategoryBadge category={task.category} />
            {!compact && <EnergyBadge energyType={task.energyType} />}
            <DueBadge daysUntilDue={task.daysUntilDue} dueDate={task.due_date} />
            {task.suggestedSlot && (
              <span className="ai-due-badge ai-due-badge--time">
                <Clock size={10} aria-hidden />
                {task.suggestedSlot}
              </span>
            )}
          </div>
        </div>

        {/* Priority score */}
        {task.priorityScore !== undefined && (
          <PriorityIndicator score={task.priorityScore} showLabel={!compact} />
        )}

        {/* Actions */}
        <div className="ai-task-card__actions">
          <button
            className="ai-task-card__menu-btn"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Task menu"
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && (
            <div className="ai-task-card__menu" onMouseLeave={() => setMenuOpen(false)}>
              <button onClick={() => { onEdit && onEdit(task); setMenuOpen(false) }}>
                <Edit2 size={13} /> Edit
              </button>
              <button className="danger" onClick={() => { onDelete && onDelete(task); setMenuOpen(false) }}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
          )}
        </div>

        <ChevronRight size={14} className="ai-task-card__arrow" aria-hidden />
      </div>
    </div>
  )
}
