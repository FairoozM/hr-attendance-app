import { useState } from 'react'
import { X, Trash2, Archive, AlertCircle, GitBranch, Save, CheckSquare, Paperclip } from 'lucide-react'
import { usePlanner } from '../../contexts/PlannerContext'
import { CategoryBadge } from './CategoryBadge'
import { PriorityIndicator, EnergyBadge } from './PriorityIndicator'

const TASK_STATUSES   = ['Not Started', 'In Progress', 'Blocked', 'Done']
const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']

export function TaskDrawer({ task, project, sections = [], tasks = [], onClose, onRefresh }) {
  const { updateTask, deleteTask } = usePlanner()

  const projectId = task.project_id || project?.id

  const [form, setForm] = useState({
    title:           task.title || '',
    description:     task.description || '',
    status:          task.status || 'Not Started',
    priority:        task.priority || 'Medium',
    section_id:      task.section_id ?? '',
    due_date:        task.due_date?.slice(0, 10) || '',
    start_date:      task.start_date?.slice(0, 10) || '',
    estimated_hours: task.estimated_hours || '',
    actual_hours:    task.actual_hours || '',
  })
  const [saving, setSaving] = useState(false)
  const [dirty,  setDirty]  = useState(false)

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }))
    setDirty(true)
  }

  async function handleSave() {
    if (!projectId) return
    setSaving(true)
    try {
      await updateTask(projectId, task.id, {
        ...form,
        section_id:      form.section_id || null,
        estimated_hours: form.estimated_hours ? parseFloat(form.estimated_hours) : null,
        actual_hours:    form.actual_hours    ? parseFloat(form.actual_hours)    : null,
      })
      setDirty(false)
      onRefresh?.()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!projectId) return
    if (!window.confirm(`Delete task "${task.title}"? This cannot be undone.`)) return
    await deleteTask(projectId, task.id)
    onClose()
    onRefresh?.()
  }

  async function handleArchive() {
    if (!projectId) return
    await updateTask(projectId, task.id, { archived: !task.archived })
    onClose()
    onRefresh?.()
  }

  const isBlocked = task.is_blocked && task.status !== 'Done'

  return (
    <>
      <div className="pm-drawer-overlay" onClick={onClose} />
      <div className="pm-drawer">
        {/* Header */}
        <div className="pm-drawer-header">
          <input
            className="pm-drawer-title-input"
            value={form.title}
            onChange={e => set('title', e.target.value)}
            placeholder="Task title"
          />
          <button className="pm-btn-icon" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="pm-drawer-body">
          {/* AI enrichment badges */}
          {(task.category || task.energyType || task.priorityScore !== undefined) && (
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <CategoryBadge category={task.category} />
              <EnergyBadge energyType={task.energyType} />
              {task.priorityScore !== undefined && <PriorityIndicator score={task.priorityScore} />}
            </div>
          )}

          {/* Blocked warning */}
          {isBlocked && (
            <div className="pm-blocked-banner">
              <AlertCircle size={15} />
              <span>
                This task is blocked by{' '}
                {task.dependencies
                  ?.filter(d => d.depends_on_status !== 'Done')
                  .map(d => d.depends_on_title)
                  .join(', ') || 'a dependency'}.
              </span>
            </div>
          )}

          {/* Fields grid */}
          <div className="pm-drawer-fields-grid">
            <div className="pm-field-group">
              <label className="pm-field-label">Status</label>
              <select className="pm-field-select" value={form.status} onChange={e => set('status', e.target.value)}>
                {TASK_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="pm-field-group">
              <label className="pm-field-label">Priority</label>
              <select className="pm-field-select" value={form.priority} onChange={e => set('priority', e.target.value)}>
                {TASK_PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="pm-field-group">
              <label className="pm-field-label">Due Date</label>
              <input type="date" className="pm-field-input" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
            </div>
            <div className="pm-field-group">
              <label className="pm-field-label">Start Date</label>
              <input type="date" className="pm-field-input" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </div>
            {sections.length > 0 && (
              <div className="pm-field-group">
                <label className="pm-field-label">Section</label>
                <select className="pm-field-select" value={form.section_id || ''} onChange={e => set('section_id', e.target.value ? parseInt(e.target.value) : null)}>
                  <option value="">No section</option>
                  {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div className="pm-field-group">
              <label className="pm-field-label">Est. Hours</label>
              <input type="number" min="0" step="0.5" className="pm-field-input" value={form.estimated_hours} onChange={e => set('estimated_hours', e.target.value)} placeholder="0" />
            </div>
            <div className="pm-field-group">
              <label className="pm-field-label">Actual Hours</label>
              <input type="number" min="0" step="0.5" className="pm-field-input" value={form.actual_hours} onChange={e => set('actual_hours', e.target.value)} placeholder="0" />
            </div>
          </div>

          {/* Description */}
          <div className="pm-drawer-section">
            <label className="pm-drawer-section-label">Description</label>
            <textarea
              className="pm-field-textarea"
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Add task description…"
              rows={4}
            />
          </div>

          {/* Subtasks (simplified — kept for display) */}
          {task.subtasks && task.subtasks.length > 0 && (
            <div className="pm-drawer-section">
              <label className="pm-drawer-section-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckSquare size={12} /> Subtasks
                <span style={{ background: 'var(--theme-surface-raised)', borderRadius: 100, padding: '0 0.4rem', fontSize: '0.68rem', color: 'var(--theme-text-dim)' }}>
                  {task.subtasks.filter(s => s.status === 'Done').length}/{task.subtasks.length}
                </span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {task.subtasks.map(sub => (
                  <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--theme-text-soft)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: sub.status === 'Done' ? 'var(--theme-primary)' : 'var(--theme-border-strong)', flexShrink: 0 }} />
                    <span style={{ textDecoration: sub.status === 'Done' ? 'line-through' : 'none', color: sub.status === 'Done' ? 'var(--theme-text-dim)' : 'inherit' }}>{sub.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dependencies */}
          {task.dependencies && task.dependencies.length > 0 && (
            <div className="pm-drawer-section">
              <label className="pm-drawer-section-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <GitBranch size={12} /> Dependencies
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {task.dependencies.map(dep => (
                  <div key={dep.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                    <span style={{
                      padding: '0.1rem 0.45rem', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                      background: dep.depends_on_status === 'Done' ? 'rgba(52,211,153,0.12)' : 'rgba(251,146,60,0.12)',
                      color:      dep.depends_on_status === 'Done' ? '#34d399' : '#fb923c',
                    }}>
                      {dep.depends_on_status}
                    </span>
                    <span style={{ color: 'var(--theme-text-soft)' }}>{dep.depends_on_title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Attachments count */}
          {task.attachments && task.attachments.length > 0 && (
            <div className="pm-drawer-section">
              <label className="pm-drawer-section-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Paperclip size={12} /> Attachments
                <span style={{ background: 'var(--theme-surface-raised)', borderRadius: 100, padding: '0 0.4rem', fontSize: '0.68rem', color: 'var(--theme-text-dim)' }}>
                  {task.attachments.length}
                </span>
              </label>
              <div style={{ fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>
                {task.attachments.map(a => a.file_name).join(', ')}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div style={{ fontSize: '0.72rem', color: 'var(--theme-text-dim)', paddingTop: '0.5rem', borderTop: '1px solid var(--theme-border-subtle)' }}>
            Created {new Date(task.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            {task.completed_at && ` · Completed ${new Date(task.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
          </div>
        </div>

        {/* Footer */}
        <div className="pm-drawer-footer">
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="pm-btn-icon" onClick={handleArchive} title={task.archived ? 'Unarchive' : 'Archive'}>
              <Archive size={14} />
            </button>
            <button className="pm-btn-icon" onClick={handleDelete} title="Delete task" style={{ color: '#f87171' }}>
              <Trash2 size={14} />
            </button>
          </div>
          <button className="pm-btn pm-btn-primary" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : <><Save size={13} /> Save</>}
          </button>
        </div>
      </div>
    </>
  )
}
