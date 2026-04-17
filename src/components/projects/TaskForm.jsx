import { useState } from 'react'
import { X } from 'lucide-react'
import { TASK_STATUSES, TASK_PRIORITIES } from '../../utils/projectUtils'

export function TaskForm({ task, sections, parentTaskId, onSave, onClose, loading }) {
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    status: task?.status || 'Not Started',
    priority: task?.priority || 'Medium',
    section_id: task?.section_id ?? (sections?.[0]?.id ?? ''),
    start_date: task?.start_date?.slice(0, 10) || '',
    due_date: task?.due_date?.slice(0, 10) || '',
    estimated_hours: task?.estimated_hours || '',
  })
  const [error, setError] = useState('')

  function set(key, value) { setForm((f) => ({ ...f, [key]: value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.title.trim()) { setError('Task title is required'); return }
    try {
      await onSave({
        ...form,
        section_id: form.section_id || null,
        parent_task_id: parentTaskId || null,
        estimated_hours: form.estimated_hours ? parseFloat(form.estimated_hours) : null,
      })
    } catch (err) {
      setError(err.message || 'Failed to save task')
    }
  }

  return (
    <div className="pm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pm-modal">
        <div className="pm-modal-header">
          <span className="pm-modal-title">
            {parentTaskId ? 'New Subtask' : task ? 'Edit Task' : 'New Task'}
          </span>
          <button className="pm-btn-icon" onClick={onClose}><X size={15} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="pm-modal-body">
            {error && (
              <div style={{ color: '#f87171', background: 'rgba(239,68,68,0.1)', borderRadius: 8, padding: '0.6rem 0.8rem', fontSize: '0.82rem' }}>
                {error}
              </div>
            )}

            <div className="pm-field-group">
              <label className="pm-field-label">Title *</label>
              <input
                autoFocus
                className="pm-field-input"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="Task title"
              />
            </div>

            <div className="pm-field-group">
              <label className="pm-field-label">Description</label>
              <textarea
                className="pm-field-textarea"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Add details, notes, or context…"
                rows={3}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
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
            </div>

            {!parentTaskId && sections?.length > 0 && (
              <div className="pm-field-group">
                <label className="pm-field-label">Section</label>
                <select className="pm-field-select" value={form.section_id || ''} onChange={(e) => set('section_id', e.target.value ? parseInt(e.target.value) : null)}>
                  <option value="">No section</option>
                  {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="pm-field-group">
                <label className="pm-field-label">Start Date</label>
                <input type="date" className="pm-field-input" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
              </div>
              <div className="pm-field-group">
                <label className="pm-field-label">Due Date</label>
                <input type="date" className="pm-field-input" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
              </div>
            </div>

            <div className="pm-field-group">
              <label className="pm-field-label">Estimated Hours</label>
              <input
                type="number" min="0" step="0.5"
                className="pm-field-input"
                value={form.estimated_hours}
                onChange={(e) => set('estimated_hours', e.target.value)}
                placeholder="0"
                style={{ maxWidth: 160 }}
              />
            </div>
          </div>

          <div className="pm-modal-footer">
            <button type="button" className="pm-btn pm-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="pm-btn pm-btn-primary" disabled={loading}>
              {loading ? 'Saving…' : task ? 'Save Changes' : parentTaskId ? 'Add Subtask' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
