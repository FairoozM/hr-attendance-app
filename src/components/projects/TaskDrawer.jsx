import { useState, useEffect } from 'react'
import { X, Trash2, Archive, AlertCircle, GitBranch, Paperclip, CheckSquare, Save } from 'lucide-react'
import { useProjects } from '../../contexts/ProjectsContext'
import { TASK_STATUSES, TASK_PRIORITIES } from '../../utils/projectUtils'
import { SubtaskList } from './SubtaskList'
import { DependencyPanel } from './DependencyPanel'
import { AttachmentPanel } from './AttachmentPanel'

export function TaskDrawer({ task, projectId, sections, allTasks, onClose, onUpdate }) {
  const { updateTask, deleteTask } = useProjects()
  const [form, setForm] = useState({
    title: task.title,
    description: task.description || '',
    status: task.status,
    priority: task.priority,
    section_id: task.section_id ?? '',
    due_date: task.due_date?.slice(0, 10) || '',
    start_date: task.start_date?.slice(0, 10) || '',
    estimated_hours: task.estimated_hours || '',
    actual_hours: task.actual_hours || '',
  })
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
    setDirty(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateTask(projectId, task.id, {
        ...form,
        section_id: form.section_id || null,
        estimated_hours: form.estimated_hours ? parseFloat(form.estimated_hours) : null,
        actual_hours: form.actual_hours ? parseFloat(form.actual_hours) : null,
      })
      setDirty(false)
      onUpdate?.()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete task "${task.title}"? This cannot be undone.`)) return
    await deleteTask(projectId, task.id)
    onClose()
    onUpdate?.()
  }

  async function handleArchive() {
    await updateTask(projectId, task.id, { archived: !task.archived })
    onClose()
    onUpdate?.()
  }

  // Auto-save title on blur
  async function handleTitleBlur() {
    if (form.title.trim() !== task.title) {
      await updateTask(projectId, task.id, { title: form.title.trim() || task.title })
      onUpdate?.()
    }
  }

  const isBlocked = task.is_blocked && task.status !== 'Completed'

  return (
    <>
      <div className="pm-drawer-overlay" onClick={onClose} />
      <div className="pm-drawer">
        <div className="pm-drawer-header">
          <input
            className="pm-drawer-title-input"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            onBlur={handleTitleBlur}
            placeholder="Task title"
          />
          <button className="pm-btn-icon" onClick={onClose}><X size={15} /></button>
        </div>

        <div className="pm-drawer-body">
          {isBlocked && (
            <div className="pm-blocked-banner">
              <AlertCircle size={15} />
              <span>
                This task is blocked by{' '}
                {task.dependencies?.filter((d) => d.depends_on_status !== 'Completed').map((d) => d.depends_on_title).join(', ')}.
                Complete those tasks first.
              </span>
            </div>
          )}

          {/* Fields grid */}
          <div className="pm-drawer-fields-grid">
            <div className="pm-field-group">
              <label className="pm-field-label">Status</label>
              <select className="pm-field-select" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="pm-field-group">
              <label className="pm-field-label">Priority</label>
              <select className="pm-field-select" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                {TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="pm-field-group">
              <label className="pm-field-label">Due Date</label>
              <input type="date" className="pm-field-input" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
            </div>
            <div className="pm-field-group">
              <label className="pm-field-label">Start Date</label>
              <input type="date" className="pm-field-input" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
            </div>
            {sections?.length > 0 && (
              <div className="pm-field-group">
                <label className="pm-field-label">Section</label>
                <select className="pm-field-select" value={form.section_id || ''} onChange={(e) => set('section_id', e.target.value ? parseInt(e.target.value) : null)}>
                  <option value="">No section</option>
                  {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div className="pm-field-group">
              <label className="pm-field-label">Est. Hours</label>
              <input type="number" min="0" step="0.5" className="pm-field-input" value={form.estimated_hours} onChange={(e) => set('estimated_hours', e.target.value)} placeholder="0" />
            </div>
            <div className="pm-field-group">
              <label className="pm-field-label">Actual Hours</label>
              <input type="number" min="0" step="0.5" className="pm-field-input" value={form.actual_hours} onChange={(e) => set('actual_hours', e.target.value)} placeholder="0" />
            </div>
          </div>

          {/* Description */}
          <div className="pm-drawer-section">
            <label className="pm-drawer-section-label">Description</label>
            <textarea
              className="pm-field-textarea"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Add task description…"
              rows={4}
            />
          </div>

          {/* Subtasks */}
          <div className="pm-drawer-section">
            <label className="pm-drawer-section-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <CheckSquare size={12} /> Subtasks
              {task.subtasks?.length > 0 && (
                <span style={{ background: 'var(--theme-surface-raised)', borderRadius: 100, padding: '0 0.4rem', fontSize: '0.68rem', color: 'var(--theme-text-dim)' }}>
                  {task.subtasks.filter((s) => s.status === 'Completed').length}/{task.subtasks.length}
                </span>
              )}
            </label>
            <SubtaskList task={task} projectId={projectId} onTaskUpdate={onUpdate} />
          </div>

          {/* Dependencies */}
          <div className="pm-drawer-section">
            <label className="pm-drawer-section-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <GitBranch size={12} /> Dependencies
            </label>
            <DependencyPanel task={task} projectId={projectId} allTasks={allTasks} onUpdate={onUpdate} />
          </div>

          {/* Attachments */}
          <div className="pm-drawer-section">
            <label className="pm-drawer-section-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Paperclip size={12} /> Attachments
              {task.attachments?.length > 0 && (
                <span style={{ background: 'var(--theme-surface-raised)', borderRadius: 100, padding: '0 0.4rem', fontSize: '0.68rem', color: 'var(--theme-text-dim)' }}>
                  {task.attachments.length}
                </span>
              )}
            </label>
            <AttachmentPanel task={task} projectId={projectId} onUpdate={onUpdate} />
          </div>

          {/* Created metadata */}
          <div style={{ fontSize: '0.72rem', color: 'var(--theme-text-dim)', paddingTop: '0.5rem', borderTop: '1px solid var(--theme-border-subtle)' }}>
            Created {new Date(task.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            {task.completed_at && ` · Completed ${new Date(task.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
          </div>
        </div>

        <div className="pm-drawer-footer">
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="pm-btn-icon" onClick={handleArchive} title={task.archived ? 'Unarchive' : 'Archive'}>
              <Archive size={14} />
            </button>
            <button className="pm-btn-icon" onClick={handleDelete} title="Delete task" style={{ color: '#f87171' }}>
              <Trash2 size={14} />
            </button>
          </div>
          <button
            className="pm-btn pm-btn-primary"
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? 'Saving…' : <><Save size={13} /> Save</>}
          </button>
        </div>
      </div>
    </>
  )
}
