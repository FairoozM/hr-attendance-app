import { useState, useEffect } from 'react'
import { useAIPlanner } from '../../contexts/AIPlannerContext'
import { calcPriorityScore, priorityLabel, priorityFlame, formatTime, estimateDuration } from '../../lib/aiEngine'
import { SubtaskList } from './SubtaskList'
import { AttachmentPanel } from './AttachmentPanel'


const STATUS_OPTIONS   = ['todo', 'blocked', 'done']
const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent']
const ENERGY_OPTIONS   = ['shallow', 'deep']
const TABS = ['Details', 'Subtasks', 'Attachments']

export function TaskDrawer() {
  const { activeTask, setActiveTaskId, updateTask, deleteTask, markDone, markTodo, sections, moveTaskToSection } = useAIPlanner()
  const [form, setForm]   = useState(null)
  const [dirty, setDirty] = useState(false)
  const [tab, setTab]     = useState('Details')

  useEffect(() => {
    if (activeTask) {
      setForm({ ...activeTask })
      setDirty(false)
    } else {
      setForm(null)
      setTab('Details')
    }
  }, [activeTask])

  if (!activeTask || !form) return null

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setDirty(true)
  }

  function handleSave() {
    updateTask(form.id, form)
    setDirty(false)
  }

  function handleDelete() {
    if (window.confirm(`Delete "${activeTask.title}"?`)) {
      deleteTask(activeTask.id)
    }
  }

  const score    = calcPriorityScore(form)
  const { text: plabel, color: pcolor } = priorityLabel(score)
  const flames   = priorityFlame(score)
  const duration = estimateDuration(form)
  const cat      = form.category

  const isDueToday = form.dueDate === new Date().toISOString().slice(0, 10)
  const isOverdue  = form.dueDate && new Date(form.dueDate) < new Date(new Date().toDateString())

  const subtasks    = activeTask.subtasks    || []
  const attachments = activeTask.attachments || []
  const doneSubtasks = subtasks.filter((s) => s.done).length

  return (
    <>
      <div className="aip-drawer-overlay" onClick={() => setActiveTaskId(null)} />
      <div className="aip-drawer">

        {/* ── Head ── */}
        <div className="aip-drawer__head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
            <span className="aip-drawer__title">Task Details</span>
            {/* Badge row under title */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: 2 }}>
              {subtasks.length > 0 && (
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--theme-text-dim)', background: 'var(--theme-surface-soft)', padding: '0.1rem 0.45rem', borderRadius: 20, border: '1px solid var(--theme-border-subtle)' }}>
                  ☑ {doneSubtasks}/{subtasks.length} subtasks
                </span>
              )}
              {attachments.length > 0 && (
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--theme-text-dim)', background: 'var(--theme-surface-soft)', padding: '0.1rem 0.45rem', borderRadius: 20, border: '1px solid var(--theme-border-subtle)' }}>
                  📎 {attachments.length} file{attachments.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <button className="aip-drawer__close" onClick={() => setActiveTaskId(null)}>✕</button>
        </div>

        {/* ── Tabs ── */}
        <div className="aip-drawer__tabs">
          {TABS.map((t) => (
            <button
              key={t}
              className={`aip-drawer__tab ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'Subtasks' && subtasks.length > 0 && (
                <span className="aip-drawer__tab-badge">{subtasks.length}</span>
              )}
              {t === 'Attachments' && attachments.length > 0 && (
                <span className="aip-drawer__tab-badge">{attachments.length}</span>
              )}
              {t}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div className="aip-drawer__body">

          {/* ── DETAILS TAB ── */}
          {tab === 'Details' && (
            <>
              {/* AI Score */}
              <div className="aip-drawer__score-row">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--theme-text-dim)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                      🔥 AI Priority Score
                    </span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: pcolor }}>
                      {score}/100 {flames}
                    </span>
                  </div>
                  <div className="aip-drawer__score-bar">
                    <div className="aip-drawer__score-fill" style={{ width: `${score}%`, background: pcolor }} />
                  </div>
                  <div style={{ fontSize: '0.68rem', color: pcolor, fontWeight: 700 }}>{plabel} Priority</div>
                </div>
              </div>

              {/* AI insights row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                {cat && (
                  <span className="aip-badge" style={{ background: cat.bg, color: cat.color }}>
                    {cat.icon} {cat.label}
                  </span>
                )}
                <span className={`aip-badge aip-badge-energy ${form.energyType}`}>
                  {form.energyType === 'deep' ? '🧠 Deep Work' : '⚡ Shallow Work'}
                </span>
                <span className="aip-badge aip-badge-time">⏱ ~{duration} min</span>
                {form.scheduledStart && (
                  <span className="aip-badge aip-badge-time">
                    🕐 {formatTime(form.scheduledStart)} – {formatTime(form.scheduledEnd)}
                  </span>
                )}
                {isOverdue && <span className="aip-badge aip-badge-due overdue">⚠️ Overdue</span>}
                {isDueToday && !isOverdue && <span className="aip-badge aip-badge-due today">📅 Due today</span>}
              </div>

              {/* Title */}
              <div className="aip-drawer__field">
                <label className="aip-drawer__label">Task Title</label>
                <input
                  className="aip-drawer__input"
                  value={form.title}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder="Task title…"
                />
              </div>

              {/* Description */}
              <div className="aip-drawer__field">
                <label className="aip-drawer__label">Description</label>
                <textarea
                  className="aip-drawer__input aip-drawer__textarea"
                  value={form.description || ''}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="Add more context…"
                />
              </div>

              {/* Status + Priority */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="aip-drawer__field">
                  <label className="aip-drawer__label">Status</label>
                  <select
                    className="aip-drawer__input aip-drawer__select"
                    value={form.status}
                    onChange={(e) => set('status', e.target.value)}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div className="aip-drawer__field">
                  <label className="aip-drawer__label">Priority</label>
                  <select
                    className="aip-drawer__input aip-drawer__select"
                    value={form.priority}
                    onChange={(e) => set('priority', e.target.value)}
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Due date + Energy */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="aip-drawer__field">
                  <label className="aip-drawer__label">Due Date</label>
                  <input
                    type="date"
                    className="aip-drawer__input"
                    value={form.dueDate || ''}
                    onChange={(e) => set('dueDate', e.target.value || null)}
                  />
                </div>
                <div className="aip-drawer__field">
                  <label className="aip-drawer__label">Energy Mode</label>
                  <select
                    className="aip-drawer__input aip-drawer__select"
                    value={form.energyType}
                    onChange={(e) => set('energyType', e.target.value)}
                  >
                    {ENERGY_OPTIONS.map((e) => (
                      <option key={e} value={e}>{e === 'deep' ? '🧠 Deep Work' : '⚡ Shallow Work'}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Est. duration */}
              <div className="aip-drawer__field">
                <label className="aip-drawer__label">Estimated Duration (minutes)</label>
                <input
                  type="number"
                  min="5"
                  step="5"
                  className="aip-drawer__input"
                  value={form.estimatedMinutes || ''}
                  onChange={(e) => set('estimatedMinutes', e.target.value ? parseInt(e.target.value) : null)}
                  placeholder={`AI estimate: ${duration} min`}
                />
              </div>

              {/* Notes */}
              <div className="aip-drawer__field">
                <label className="aip-drawer__label">Notes</label>
                <textarea
                  className="aip-drawer__input aip-drawer__textarea"
                  value={form.notes || ''}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="Additional notes…"
                  style={{ minHeight: 64 }}
                />
              </div>

              {/* Section */}
              <div className="aip-drawer__field">
                <label className="aip-drawer__label">Section</label>
                <select
                  className="aip-drawer__input aip-drawer__select"
                  value={form.sectionId || ''}
                  onChange={(e) => {
                    const val = e.target.value || null
                    set('sectionId', val)
                    moveTaskToSection(form.id, val)
                  }}
                >
                  <option value="">No Section</option>
                  {[...(sections || [])].sort((a, b) => a.order - b.order).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* ── SUBTASKS TAB ── */}
          {tab === 'Subtasks' && (
            <SubtaskList taskId={activeTask.id} subtasks={subtasks} />
          )}

          {/* ── ATTACHMENTS TAB ── */}
          {tab === 'Attachments' && (
            <AttachmentPanel taskId={activeTask.id} attachments={attachments} />
          )}
        </div>

        {/* ── Footer ── */}
        <div className="aip-drawer__footer">
          <button className="pm-btn pm-btn-danger" onClick={handleDelete} style={{ fontSize: '0.8rem' }}>
            Delete
          </button>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {form.status !== 'done' ? (
              <button
                className="pm-btn pm-btn-ghost"
                style={{ fontSize: '0.8rem' }}
                onClick={() => { markDone(form.id); setActiveTaskId(null) }}
              >
                ✓ Mark Done
              </button>
            ) : (
              <button
                className="pm-btn pm-btn-ghost"
                style={{ fontSize: '0.8rem' }}
                onClick={() => { markTodo(form.id); setActiveTaskId(null) }}
              >
                ↺ Reopen
              </button>
            )}
            {tab === 'Details' && (
              <button
                className="pm-btn pm-btn-primary"
                style={{ fontSize: '0.8rem' }}
                onClick={handleSave}
                disabled={!dirty}
              >
                Save
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
