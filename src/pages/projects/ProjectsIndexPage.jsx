import { useState, useRef } from 'react'
import { useAIPlanner } from '../../contexts/AIPlannerContext'
import { AIAssistPanel } from '../../components/planner/AIAssistPanel'
import { TaskDrawer } from '../../components/planner/TaskDrawer'
import { priorityLabel, priorityFlame, formatTime } from '../../lib/aiEngine'
import './planner.css'
import './projects.css'

const FILTER_OPTIONS = [
  { id: 'all',     label: 'All' },
  { id: 'todo',    label: 'To Do' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'done',    label: 'Done' },
]

const CAT_FILTER_OPTIONS = [
  { id: '', label: 'All Categories' },
  { id: 'finance',       label: '💰 Finance' },
  { id: 'operations',    label: '📦 Operations' },
  { id: 'communication', label: '💬 Communication' },
  { id: 'marketing',     label: '📣 Marketing' },
  { id: 'admin',         label: '📋 Admin' },
]

function QuickCapture() {
  const { quickCapture } = useAIPlanner()
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState(null)
  const inputRef = useRef(null)

  function handleChange(e) {
    const val = e.target.value
    setInput(val)
    if (val.trim().length > 3) {
      // live preview
      import('../../lib/aiEngine').then(({ parseQuickCapture }) => {
        setPreview(parseQuickCapture(val))
      })
    } else {
      setPreview(null)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && input.trim()) {
      quickCapture(input.trim())
      setInput('')
      setPreview(null)
    }
    if (e.key === 'Escape') {
      setInput('')
      setPreview(null)
      inputRef.current?.blur()
    }
  }

  return (
    <div>
      <div className="aip-capture">
        <span className="aip-capture__icon">⚡</span>
        <input
          ref={inputRef}
          className="aip-capture__input"
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder='Quick capture… e.g. "Check Amazon VAT invoices tomorrow" then press Enter'
          autoComplete="off"
          spellCheck={false}
        />
        {input ? (
          <span className="aip-capture__hint">↵ to add</span>
        ) : (
          <span className="aip-capture__hint">/ to focus</span>
        )}
      </div>
      {preview && input.trim().length > 3 && (
        <div className="aip-capture__preview">
          <span style={{ color: 'var(--theme-text-dim)', fontSize: '0.7rem' }}>AI will create:</span>
          <span className="aip-capture__tag" style={{ background: 'var(--theme-surface-soft)', color: 'var(--theme-text-soft)' }}>
            📝 {preview.title}
          </span>
          {preview.category && (
            <span className="aip-capture__tag" style={{ background: preview.category.bg, color: preview.category.color }}>
              {preview.category.icon} {preview.category.label}
            </span>
          )}
          {preview.dueDate && (
            <span className="aip-capture__tag" style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}>
              📅 {preview.dueDate}
            </span>
          )}
          <span className="aip-capture__tag" style={{ background: 'rgba(6,182,212,0.1)', color: '#22d3ee' }}>
            {preview.energyType === 'deep' ? '🧠 Deep' : '⚡ Shallow'}
          </span>
        </div>
      )}
    </div>
  )
}

function TaskCard({ task }) {
  const { markDone, markTodo, setActiveTaskId, activeTaskId } = useAIPlanner()
  const isActive = task.id === activeTaskId
  const { color: pcolor } = priorityLabel(task.priorityScore || 0)
  const flames = priorityFlame(task.priorityScore || 0)
  const cat = task.category
  const isDueToday = task.dueDate === new Date().toISOString().slice(0, 10)
  const isOverdue  = task.dueDate && new Date(task.dueDate) < new Date(new Date().toDateString())

  return (
    <div
      className={`aip-task-card ${task.status === 'done' ? 'done' : ''} ${task.status === 'blocked' ? 'blocked' : ''} ${isActive ? 'active' : ''}`}
      onClick={() => setActiveTaskId(task.id)}
    >
      {/* Checkbox */}
      <button
        className={`aip-task-check ${task.status === 'done' ? 'checked' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          task.status === 'done' ? markTodo(task.id) : markDone(task.id)
        }}
        aria-label={task.status === 'done' ? 'Mark incomplete' : 'Mark complete'}
      />

      {/* Body */}
      <div className="aip-task-body">
        <div className="aip-task-title">{task.title}</div>
        <div className="aip-task-meta">
          {cat && (
            <span className="aip-badge aip-badge-cat" style={{ background: cat.bg, color: cat.color }}>
              {cat.icon} {cat.label}
            </span>
          )}
          <span className={`aip-badge aip-badge-energy ${task.energyType}`}>
            {task.energyType === 'deep' ? '🧠' : '⚡'}
          </span>
          {task.scheduledStart && (
            <span className="aip-badge aip-badge-time">
              {formatTime(task.scheduledStart)}
            </span>
          )}
          {isOverdue && (
            <span className="aip-badge aip-badge-due overdue">⚠️ Overdue</span>
          )}
          {isDueToday && !isOverdue && (
            <span className="aip-badge aip-badge-due today">📅 Today</span>
          )}
          {task.status === 'blocked' && (
            <span className="aip-blocked-tag">🚫 Blocked</span>
          )}
          {task.attachments?.length > 0 && (
            <span className="aip-badge aip-badge-time">📎 {task.attachments.length}</span>
          )}
        </div>
        {/* Subtask progress bar */}
        {task.subtasks?.length > 0 && (() => {
          const done = task.subtasks.filter((s) => s.done).length
          const pct  = Math.round((done / task.subtasks.length) * 100)
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: 2 }}>
              <div className="aip-task-subtask-bar" style={{ flex: 1, maxWidth: 120 }}>
                <div className="aip-task-subtask-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--theme-text-dim)', fontWeight: 600 }}>
                {done}/{task.subtasks.length}
              </span>
            </div>
          )
        })()}
      </div>

      {/* Priority score */}
      <div className="aip-task-actions">
        <span
          className="aip-score"
          style={{ background: `${pcolor}18`, color: pcolor }}
          title="AI Priority Score"
        >
          {flames || ''} {task.priorityScore || 0}
        </span>
      </div>
    </div>
  )
}

export default function ProjectsIndexPage() {
  const { tasks, addTask } = useAIPlanner()
  const [statusFilter, setStatusFilter] = useState('all')
  const [catFilter, setCatFilter] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const filtered = tasks.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (catFilter && t.category?.id !== catFilter) return false
    return true
  })

  const todoCount    = tasks.filter((t) => t.status === 'todo').length
  const blockedCount = tasks.filter((t) => t.status === 'blocked').length
  const doneCount    = tasks.filter((t) => t.status === 'done').length

  function handleAddQuick(e) {
    e.preventDefault()
    if (!newTitle.trim()) return
    addTask({ title: newTitle.trim() })
    setNewTitle('')
    setShowAddForm(false)
  }

  return (
    <div className="aip-layout">
      <div className="aip-main">
        {/* Header */}
        <div className="aip-page-header">
          <div>
            <h1 className="aip-page-title">AI Task Planner</h1>
            <p className="aip-page-subtitle">
              {todoCount} to do · {blockedCount} blocked · {doneCount} done — auto-prioritised by AI
            </p>
          </div>
        </div>

        {/* Quick Capture */}
        <QuickCapture />

        {/* Filters */}
        <div className="aip-toolbar">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.id}
              className={`aip-filter-btn ${statusFilter === f.id ? 'active' : ''}`}
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
              {f.id !== 'all' && (
                <span style={{ marginLeft: 4, fontSize: '0.68rem', opacity: 0.7 }}>
                  {f.id === 'todo' ? todoCount : f.id === 'blocked' ? blockedCount : doneCount}
                </span>
              )}
            </button>
          ))}
          <div style={{ marginLeft: 'auto' }}>
            <select
              className="aip-filter-btn"
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              style={{ cursor: 'pointer' }}
            >
              {CAT_FILTER_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Task list */}
        {filtered.length === 0 ? (
          <div className="aip-empty">
            <div className="aip-empty__icon">📭</div>
            <div className="aip-empty__title">No tasks match this filter</div>
            <div>Try a different filter or add a new task</div>
          </div>
        ) : (
          <div className="aip-task-list">
            {filtered.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        )}

        {/* Add task */}
        {showAddForm ? (
          <form onSubmit={handleAddQuick} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
            <input
              autoFocus
              className="aip-drawer__input"
              style={{ flex: 1 }}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Task title…"
            />
            <button type="submit" className="pm-btn pm-btn-primary" style={{ fontSize: '0.8rem' }}>Add</button>
            <button type="button" className="pm-btn pm-btn-ghost" style={{ fontSize: '0.8rem' }} onClick={() => setShowAddForm(false)}>Cancel</button>
          </form>
        ) : (
          <button className="aip-add-btn" onClick={() => setShowAddForm(true)}>
            + New Task
          </button>
        )}
      </div>

      {/* AI Assist Panel */}
      <AIAssistPanel />

      {/* Task Detail Drawer */}
      <TaskDrawer />
    </div>
  )
}
