import { useState } from 'react'
import { useAIPlanner } from '../../contexts/AIPlannerContext'
import { Trash2, RotateCcw, X, AlertTriangle } from 'lucide-react'
import './planner.css'

function formatDeleted(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now - d
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Deleted today'
  if (days === 1) return 'Deleted yesterday'
  if (days < 7) return `Deleted ${days} days ago`
  return `Deleted ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export default function TrashPage() {
  const { trashedTasks, restoreTask, permanentlyDeleteTask, emptyTrash, sections } = useAIPlanner()
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  const sectionMap = Object.fromEntries(sections.map((s) => [s.id, s.title]))

  return (
    <div className="trash-page">
      {/* Header */}
      <div className="trash-page__header">
        <div className="trash-page__header-left">
          <Trash2 size={20} className="trash-page__header-icon" />
          <div>
            <h1 className="trash-page__title">Deleted Tasks</h1>
            <p className="trash-page__subtitle">
              {trashedTasks.length === 0
                ? 'No deleted tasks'
                : `${trashedTasks.length} deleted task${trashedTasks.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        {trashedTasks.length > 0 && (
          <div className="trash-page__header-actions">
            {confirmEmpty ? (
              <div className="trash-page__confirm">
                <span className="trash-page__confirm-text">
                  <AlertTriangle size={14} />
                  Permanently delete all {trashedTasks.length} tasks?
                </span>
                <button
                  type="button"
                  className="trash-page__btn trash-page__btn--danger"
                  onClick={() => { emptyTrash(); setConfirmEmpty(false) }}
                >
                  Yes, delete all
                </button>
                <button
                  type="button"
                  className="trash-page__btn trash-page__btn--ghost"
                  onClick={() => setConfirmEmpty(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="trash-page__btn trash-page__btn--danger-outline"
                onClick={() => setConfirmEmpty(true)}
              >
                <Trash2 size={14} />
                Empty Trash
              </button>
            )}
          </div>
        )}
      </div>

      {/* Empty state */}
      {trashedTasks.length === 0 && (
        <div className="trash-page__empty">
          <Trash2 size={40} className="trash-page__empty-icon" />
          <p className="trash-page__empty-title">Trash is empty</p>
          <p className="trash-page__empty-sub">Deleted tasks will appear here. You can restore them any time.</p>
        </div>
      )}

      {/* Task list */}
      {trashedTasks.length > 0 && (
        <div className="trash-page__list">
          {trashedTasks.map((task) => (
            <div key={task.id} className="trash-row">
              <div className="trash-row__info">
                <span className="trash-row__title">{task.title || 'Untitled'}</span>
                <div className="trash-row__meta">
                  {task.sectionId && sectionMap[task.sectionId] && (
                    <span className="trash-row__section">{sectionMap[task.sectionId]}</span>
                  )}
                  <span className="trash-row__date">{formatDeleted(task.deletedAt)}</span>
                  {task.status === 'done' && (
                    <span className="trash-row__badge trash-row__badge--done">Completed</span>
                  )}
                  {task.subtasks?.length > 0 && (
                    <span className="trash-row__badge">{task.subtasks.length} subtask{task.subtasks.length !== 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
              <div className="trash-row__actions">
                <button
                  type="button"
                  className="trash-row__btn trash-row__btn--restore"
                  title="Restore task"
                  onClick={() => restoreTask(task.id)}
                >
                  <RotateCcw size={14} />
                  Restore
                </button>
                <button
                  type="button"
                  className="trash-row__btn trash-row__btn--delete"
                  title="Delete permanently"
                  onClick={() => {
                    if (window.confirm(`Permanently delete "${task.title || 'this task'}"? This cannot be undone.`)) {
                      permanentlyDeleteTask(task.id)
                    }
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
