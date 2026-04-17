import { Check, Paperclip, GitBranch, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react'
import { useState } from 'react'
import { formatDueDate } from '../../utils/projectUtils'

function PriorityDot({ priority }) {
  const colors = { Low: '#4ade80', Medium: '#60a5fa', High: '#fbbf24', Urgent: '#f87171' }
  return (
    <span
      title={priority}
      style={{
        width: 7, height: 7, borderRadius: '50%',
        background: colors[priority] || '#64748b',
        display: 'inline-block', flexShrink: 0,
      }}
    />
  )
}

function StatusPill({ status }) {
  const map = {
    'Not Started': 'pm-badge-status-not-started',
    'In Progress': 'pm-badge-status-in-progress',
    'Blocked': 'pm-badge-status-blocked',
    'On Hold': 'pm-badge-status-on-hold',
    'Completed': 'pm-badge-status-completed',
  }
  return <span className={`pm-badge ${map[status] || ''}`} style={{ fontSize: '0.67rem', padding: '0.12rem 0.45rem' }}>{status}</span>
}

export function TaskRow({ task, onOpen, onToggleComplete, isSubtask = false }) {
  const [subtasksOpen, setSubtasksOpen] = useState(false)
  const due = formatDueDate(task.due_date)
  const hasSubtasks = task.subtasks?.length > 0
  const completedSubtasks = task.subtasks?.filter((s) => s.status === 'Completed').length || 0

  function handleCheck(e) {
    e.stopPropagation()
    onToggleComplete?.(task)
  }

  return (
    <>
      <div
        className={`pm-task-row${task.status === 'Completed' ? ' completed' : ''}${isSubtask ? ' subtask' : ''}`}
        onClick={() => onOpen?.(task)}
      >
        <button className={`pm-task-check-btn${task.status === 'Completed' ? ' checked' : ''}`} onClick={handleCheck} title="Toggle complete">
          {task.status === 'Completed' && <Check size={10} />}
        </button>

        <PriorityDot priority={task.priority} />

        <span className="pm-task-title">{task.title}</span>

        <div className="pm-task-row-meta">
          {task.is_blocked && task.status !== 'Completed' && (
            <span className="pm-badge pm-badge-blocked" title="Blocked by dependency">
              <AlertCircle size={10} /> Blocked
            </span>
          )}

          <StatusPill status={task.status} />

          {due && (
            <span className={`pm-task-due ${due.overdue ? 'overdue' : due.today ? 'today' : due.soon ? 'soon' : 'normal'}`}>
              {due.label}
            </span>
          )}

          {task.attachments?.length > 0 && (
            <span className="pm-task-meta-icon" title={`${task.attachments.length} attachment(s)`}>
              <Paperclip size={11} /> {task.attachments.length}
            </span>
          )}

          {task.dependencies?.length > 0 && (
            <span className="pm-task-meta-icon" title={`${task.dependencies.length} dependenc(y/ies)`}>
              <GitBranch size={11} /> {task.dependencies.length}
            </span>
          )}

          {hasSubtasks && (
            <button
              className="pm-subtask-toggle"
              onClick={(e) => { e.stopPropagation(); setSubtasksOpen((v) => !v) }}
            >
              {subtasksOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {completedSubtasks}/{task.subtasks.length}
            </button>
          )}
        </div>
      </div>

      {hasSubtasks && subtasksOpen && task.subtasks.map((sub) => (
        <TaskRow
          key={sub.id}
          task={sub}
          onOpen={onOpen}
          onToggleComplete={onToggleComplete}
          isSubtask
        />
      ))}
    </>
  )
}
