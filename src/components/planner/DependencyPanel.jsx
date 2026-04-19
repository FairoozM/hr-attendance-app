import { useState, useRef, useEffect } from 'react'
import { useAIPlanner } from '../../contexts/AIPlannerContext'
import { priorityLabel } from '../../lib/aiEngine'

function statusIcon(status) {
  if (status === 'done')    return { icon: '✓', color: '#22c55e' }
  if (status === 'blocked') return { icon: '🚫', color: '#f97316' }
  return { icon: '○', color: 'var(--theme-text-dim)' }
}

function BlockerChip({ blocker, onRemove, isUnresolved }) {
  const { color: pcolor } = priorityLabel(blocker.priorityScore || 0)
  const { icon, color: scolor } = statusIcon(blocker.status)
  const { setActiveTaskId } = useAIPlanner()

  return (
    <div className={`aip-dep-chip ${isUnresolved ? 'unresolved' : 'resolved'}`}>
      {/* Status icon */}
      <span className="aip-dep-chip__status" style={{ color: scolor }} title={blocker.status}>
        {icon}
      </span>

      {/* Title — click to open that task */}
      <span
        className="aip-dep-chip__title"
        onClick={() => setActiveTaskId(blocker.id)}
        title="Click to open this task"
      >
        {blocker.title}
      </span>

      {/* Priority pill */}
      <span
        className="aip-dep-chip__priority"
        style={{ background: `${pcolor}18`, color: pcolor }}
      >
        {blocker.priorityScore || 0}
      </span>

      {/* Remove */}
      <button
        className="aip-dep-chip__remove"
        onClick={onRemove}
        title="Remove dependency"
        aria-label="Remove dependency"
      >
        ✕
      </button>
    </div>
  )
}

export function DependencyPanel({ taskId, blockedBy = [] }) {
  const { tasks, addDependency, removeDependency } = useAIPlanner()
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const wrapRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // All tasks except self and already-added blockers
  const candidates = tasks.filter(
    (t) => t.id !== taskId && !blockedBy.includes(t.id) && t.status !== 'done'
  )

  const filtered = query.trim()
    ? candidates.filter((t) => t.title.toLowerCase().includes(query.toLowerCase()))
    : candidates.slice(0, 8)

  // Resolve blocker task objects
  const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t]))
  const blockerTasks = blockedBy
    .map((id) => taskMap[id])
    .filter(Boolean)

  const unresolvedIds = new Set(
    blockerTasks.filter((b) => b.status !== 'done').map((b) => b.id)
  )

  const hasUnresolved = unresolvedIds.size > 0

  return (
    <div className="aip-deps">
      {/* Header */}
      <div className="aip-deps__head">
        <span className="aip-deps__label">
          Blocked By
          {blockedBy.length > 0 && (
            <span
              className="aip-subtasks__count"
              style={hasUnresolved ? { background: 'rgba(249,115,22,0.12)', color: '#f97316', borderColor: 'rgba(249,115,22,0.3)' } : {}}
            >
              {hasUnresolved ? `⛓ ${unresolvedIds.size} unresolved` : `✓ all done`}
            </span>
          )}
        </span>
      </div>

      {/* Explanation */}
      <p className="aip-deps__hint">
        Tasks listed here must be completed before this task can start. If any are unresolved, this task is automatically deprioritised by the AI.
      </p>

      {/* Current blockers */}
      {blockerTasks.length > 0 ? (
        <div className="aip-dep-chips">
          {blockerTasks.map((b) => (
            <BlockerChip
              key={b.id}
              blocker={b}
              isUnresolved={unresolvedIds.has(b.id)}
              onRemove={() => removeDependency(taskId, b.id)}
            />
          ))}
        </div>
      ) : (
        <div className="aip-deps__empty">No dependencies yet</div>
      )}

      {/* Search / add */}
      <div className="aip-deps__search-wrap" ref={wrapRef}>
        <div className="aip-deps__search-row">
          <span className="aip-deps__search-icon">🔗</span>
          <input
            className="aip-deps__search-input"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder="Search tasks to add as blocker…"
            autoComplete="off"
          />
          {query && (
            <button
              className="aip-deps__search-clear"
              onClick={() => { setQuery(''); setOpen(false) }}
              aria-label="Clear"
            >
              ✕
            </button>
          )}
        </div>

        {open && filtered.length > 0 && (
          <div className="aip-deps__dropdown">
            {filtered.map((t) => {
              const { color: pcolor } = priorityLabel(t.priorityScore || 0)
              const { icon: sicon, color: scolor } = statusIcon(t.status)
              return (
                <button
                  key={t.id}
                  className="aip-deps__option"
                  onClick={() => {
                    addDependency(taskId, t.id)
                    setQuery('')
                    setOpen(false)
                  }}
                >
                  <span style={{ color: scolor, fontSize: '0.7rem' }}>{sicon}</span>
                  <span className="aip-deps__option-title">{t.title}</span>
                  {t.category && (
                    <span style={{ fontSize: '0.65rem', color: t.category.color }}>
                      {t.category.icon}
                    </span>
                  )}
                  <span
                    className="aip-dep-chip__priority"
                    style={{ background: `${pcolor}18`, color: pcolor, marginLeft: 'auto', flexShrink: 0 }}
                  >
                    {t.priorityScore || 0}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {open && filtered.length === 0 && query.trim() && (
          <div className="aip-deps__dropdown">
            <div className="aip-deps__no-results">No matching tasks found</div>
          </div>
        )}
      </div>
    </div>
  )
}
