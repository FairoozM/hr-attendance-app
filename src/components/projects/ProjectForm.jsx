import { useState } from 'react'
import { X } from 'lucide-react'
import { PROJECT_STATUSES, PROJECT_PRIORITIES, PROJECT_COLORS } from '../../utils/projectUtils'

export function ProjectForm({ project, onSave, onClose, loading }) {
  const [form, setForm] = useState({
    name: project?.name || '',
    description: project?.description || '',
    status: project?.status || 'Planning',
    priority: project?.priority || 'Medium',
    color: project?.color || '#8b5cf6',
    start_date: project?.start_date?.slice(0, 10) || '',
    due_date: project?.due_date?.slice(0, 10) || '',
  })
  const [error, setError] = useState('')

  function set(key, value) { setForm((f) => ({ ...f, [key]: value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Project name is required'); return }
    try {
      await onSave(form)
    } catch (err) {
      setError(err.message || 'Failed to save project')
    }
  }

  return (
    <div className="pm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pm-modal">
        <div className="pm-modal-header">
          <span className="pm-modal-title">{project ? 'Edit Project' : 'New Project'}</span>
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
              <label className="pm-field-label">Project Name *</label>
              <input
                className="pm-field-input"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Q2 Marketing Campaign"
                autoFocus
              />
            </div>

            <div className="pm-field-group">
              <label className="pm-field-label">Description</label>
              <textarea
                className="pm-field-textarea"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="What is this project about?"
                rows={3}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="pm-field-group">
                <label className="pm-field-label">Status</label>
                <select className="pm-field-select" value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {PROJECT_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="pm-field-group">
                <label className="pm-field-label">Priority</label>
                <select className="pm-field-select" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                  {PROJECT_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>

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
              <label className="pm-field-label">Color</label>
              <div className="pm-color-swatches">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c} type="button"
                    className={`pm-color-swatch${form.color === c ? ' selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => set('color', c)}
                    title={c}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="pm-modal-footer">
            <button type="button" className="pm-btn pm-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="pm-btn pm-btn-primary" disabled={loading}>
              {loading ? 'Saving…' : project ? 'Save Changes' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
