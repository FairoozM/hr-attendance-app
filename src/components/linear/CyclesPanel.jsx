/**
 * CyclesPanel.jsx
 * Compact modal for managing cycles (list + create).
 * Opens from the sidebar or a topbar trigger.
 * User-facing: always says "Cycle". DB: sprints table.
 */
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, RotateCcw, CheckCircle2, Clock, Circle } from 'lucide-react'
import { CycleBadge } from './CycleBadge'
import './CyclesPanel.css'

const STATUS_OPTIONS = [
  { value: 'planned',   label: 'Planned'   },
  { value: 'active',    label: 'Active'    },
  { value: 'completed', label: 'Completed' },
]

const STATUS_ICON = {
  planned:   Clock,
  active:    RotateCcw,
  completed: CheckCircle2,
}

function CycleRow({ cycle, onStatusChange }) {
  const [changing, setChanging] = useState(false)
  const Icon = STATUS_ICON[cycle.status] || Circle

  async function handleStatus(e) {
    const next = e.target.value
    if (next === cycle.status) return
    setChanging(true)
    try { await onStatusChange(cycle, next) } finally { setChanging(false) }
  }

  return (
    <div className={`cyp__row ${changing ? 'cyp__row--saving' : ''}`}>
      <Icon size={13} className={`cyp__row-icon cyp__row-icon--${cycle.status}`} aria-hidden="true" />
      <div className="cyp__row-info">
        <span className="cyp__row-name">{cycle.name}</span>
        {(cycle.startDate || cycle.endDate) && (
          <span className="cyp__row-dates">
            {cycle.startDate?.slice(0, 10)} {cycle.startDate && cycle.endDate ? '→' : ''} {cycle.endDate?.slice(0, 10)}
          </span>
        )}
      </div>
      <select
        className="cyp__row-status"
        value={cycle.status}
        onChange={handleStatus}
        disabled={changing}
      >
        {STATUS_OPTIONS.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
    </div>
  )
}

export function CyclesPanel({ open, onClose, projects = [], cycles = [], onCreateCycle, onUpdateCycle }) {
  const [name,       setName]       = useState('')
  const [goal,       setGoal]       = useState('')
  const [status,     setStatus]     = useState('planned')
  const [startDate,  setStartDate]  = useState('')
  const [endDate,    setEndDate]    = useState('')
  const [projectId,  setProjectId]  = useState('')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const nameRef = useRef(null)

  useEffect(() => {
    if (open) {
      setName(''); setGoal(''); setStatus('planned')
      setStartDate(''); setEndDate(''); setError('')
      setProjectId(projects[0]?.id ? String(projects[0].id) : '')
      setTimeout(() => nameRef.current?.focus(), 60)
    }
  }, [open, projects])

  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Cycle name is required.'); return }
    if (!projectId)   { setError('Please select a project.'); return }
    setSaving(true); setError('')
    try {
      await onCreateCycle(Number(projectId), {
        name: name.trim(),
        goal: goal.trim() || null,
        status,
        start_date: startDate || null,
        end_date:   endDate   || null,
      })
      setName(''); setGoal(''); setStatus('planned'); setStartDate(''); setEndDate('')
    } catch (err) {
      setError(err.message || 'Failed to create cycle.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  // Group cycles by status order
  const grouped = [
    { key: 'active',    label: 'Active',    Icon: RotateCcw    },
    { key: 'planned',   label: 'Planned',   Icon: Clock        },
    { key: 'completed', label: 'Completed', Icon: CheckCircle2 },
  ]
    .map(({ key, label, Icon }) => ({
      key, label, Icon,
      items: cycles.filter((c) => c.status === key || (key === 'planned' && c.status === 'draft')),
    }))
    .filter((g) => g.items.length > 0)

  return createPortal(
    <div className="cyp-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cyp-panel" role="dialog" aria-modal="true" aria-label="Manage Cycles">
        <div className="cyp-header">
          <span className="cyp-header__title">
            <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
            Cycles
          </span>
          <button type="button" className="cyp-close" onClick={onClose} aria-label="Close">
            <X size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>

        <div className="cyp-body">
          {/* Existing cycles */}
          {cycles.length === 0 ? (
            <p className="cyp__empty">No cycles yet. Create one below.</p>
          ) : (
            grouped.map(({ key, label, Icon, items }) => (
              <div key={key} className="cyp__group">
                <div className="cyp__group-header">
                  <Icon size={12} strokeWidth={2} className={`cyp__gh-icon cyp__gh-icon--${key}`} aria-hidden="true" />
                  <span>{label}</span>
                  <span className="cyp__group-count">{items.length}</span>
                </div>
                {items.map((c) => (
                  <CycleRow
                    key={c.id}
                    cycle={c}
                    onStatusChange={(cycle, newStatus) =>
                      onUpdateCycle(cycle.projectId, cycle.id, { status: newStatus })
                    }
                  />
                ))}
              </div>
            ))
          )}

          <div className="cyp__divider" />

          {/* Create form */}
          <form className="cyp__form" onSubmit={handleCreate} noValidate>
            <p className="cyp__form-title">
              <Plus size={12} strokeWidth={2.5} aria-hidden="true" />
              New Cycle
            </p>

            <div className="cyp__field">
              <label className="cyp__label">Name</label>
              <input
                ref={nameRef}
                type="text"
                className="cyp__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Cycle 1 — June"
                maxLength={120}
                required
              />
            </div>

            <div className="cyp__row2">
              <div className="cyp__field">
                <label className="cyp__label">Status</label>
                <select className="cyp__select" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUS_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="cyp__field">
                <label className="cyp__label">Project</label>
                <select
                  className="cyp__select"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  required
                >
                  {projects.map((p) => (
                    <option key={p.id} value={String(p.id)}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="cyp__row2">
              <div className="cyp__field">
                <label className="cyp__label">Start</label>
                <input type="date" className="cyp__input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="cyp__field">
                <label className="cyp__label">End</label>
                <input type="date" className="cyp__input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            {error && <p className="cyp__error" role="alert">{error}</p>}

            <div className="cyp__actions">
              <button type="submit" className="cyp__btn cyp__btn--create" disabled={saving || !name.trim()}>
                {saving ? 'Creating…' : 'Create Cycle'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default CyclesPanel
