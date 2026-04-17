import { useState } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { useProjects } from '../../contexts/ProjectsContext'

export function SubtaskList({ task, projectId, onTaskUpdate }) {
  const { createTask, updateTask, deleteTask } = useProjects()
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)

  const subtasks = task.subtasks || []

  async function handleAddSubtask() {
    if (!newTitle.trim()) return
    setSaving(true)
    try {
      await createTask(projectId, {
        title: newTitle.trim(),
        parent_task_id: task.id,
        section_id: task.section_id,
        status: 'Not Started',
        priority: task.priority || 'Medium',
      })
      setNewTitle('')
      setAdding(false)
      onTaskUpdate?.()
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(subtask) {
    const newStatus = subtask.status === 'Completed' ? 'Not Started' : 'Completed'
    await updateTask(projectId, subtask.id, { status: newStatus })
    onTaskUpdate?.()
  }

  async function handleDelete(subtask) {
    if (!window.confirm(`Delete subtask "${subtask.title}"?`)) return
    await deleteTask(projectId, subtask.id)
    onTaskUpdate?.()
  }

  return (
    <div>
      {subtasks.length === 0 && !adding && (
        <div style={{ fontSize: '0.78rem', color: 'var(--theme-text-dim)', padding: '0.25rem 0' }}>
          No subtasks yet
        </div>
      )}

      {subtasks.map((sub) => (
        <div key={sub.id} className={`pm-subtask-item${sub.status === 'Completed' ? ' done' : ''}`}>
          <button
            className={`pm-task-check-btn${sub.status === 'Completed' ? ' checked' : ''}`}
            style={{ width: 16, height: 16, flexShrink: 0 }}
            onClick={() => handleToggle(sub)}
          >
            {sub.status === 'Completed' && <Check size={9} />}
          </button>
          <span className="pm-subtask-title">{sub.title}</span>
          {sub.due_date && (
            <span style={{ fontSize: '0.7rem', color: 'var(--theme-text-dim)' }}>
              {new Date(sub.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          )}
          <button className="pm-btn-icon pm-btn-sm" style={{ opacity: 0.5 }} onClick={() => handleDelete(sub)} title="Delete">
            <Trash2 size={11} />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="pm-add-subtask-row">
          <input
            autoFocus
            className="pm-add-subtask-input"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Subtask title…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddSubtask()
              if (e.key === 'Escape') { setAdding(false); setNewTitle('') }
            }}
          />
          <button className="pm-btn pm-btn-primary pm-btn-sm" onClick={handleAddSubtask} disabled={saving}>
            {saving ? '…' : 'Add'}
          </button>
          <button className="pm-btn pm-btn-ghost pm-btn-sm" onClick={() => { setAdding(false); setNewTitle('') }}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="pm-btn pm-btn-ghost pm-btn-sm"
          style={{ marginTop: '0.4rem' }}
          onClick={() => setAdding(true)}
        >
          <Plus size={12} /> Add Subtask
        </button>
      )}
    </div>
  )
}
