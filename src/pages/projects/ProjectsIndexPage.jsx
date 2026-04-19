import { useState, useRef, useEffect } from 'react'
import { useAIPlanner } from '../../contexts/AIPlannerContext'
import { AIAssistPanel } from '../../components/planner/AIAssistPanel'
import { TaskDrawer } from '../../components/planner/TaskDrawer'
import { priorityLabel, priorityFlame, formatTime } from '../../lib/aiEngine'
import './planner.css'
import './projects.css'

const SECTION_COLORS = [
  '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4',
  '#10b981', '#f59e0b', '#f97316', '#ef4444', '#ec4899',
  '#6b7280',
]

// ── Quick Capture ────────────────────────────────────────────────────────────
function QuickCapture() {
  const { quickCapture } = useAIPlanner()
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState(null)
  const inputRef = useRef(null)

  function handleChange(e) {
    const val = e.target.value
    setInput(val)
    if (val.trim().length > 3) {
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

// ── Task Card ────────────────────────────────────────────────────────────────
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
      <button
        className={`aip-task-check ${task.status === 'done' ? 'checked' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          task.status === 'done' ? markTodo(task.id) : markDone(task.id)
        }}
        aria-label={task.status === 'done' ? 'Mark incomplete' : 'Mark complete'}
      />

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
            <span className="aip-badge aip-badge-time">{formatTime(task.scheduledStart)}</span>
          )}
          {isOverdue && <span className="aip-badge aip-badge-due overdue">⚠️ Overdue</span>}
          {isDueToday && !isOverdue && <span className="aip-badge aip-badge-due today">📅 Today</span>}
          {task.status === 'blocked' && <span className="aip-blocked-tag">🚫 Blocked</span>}
          {task.attachments?.length > 0 && (
            <span className="aip-badge aip-badge-time">📎 {task.attachments.length}</span>
          )}
          {task._hasUnresolvedDeps && (
            <span className="aip-badge aip-dep-badge">⛓ waiting on {task._unresolvedBlockerIds?.length}</span>
          )}
        </div>

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

// ── Inline add-task row ───────────────────────────────────────────────────────
function InlineAddTask({ sectionId, onDone }) {
  const { addTask } = useAIPlanner()
  const [title, setTitle] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function commit() {
    const trimmed = title.trim()
    if (trimmed) {
      addTask({ title: trimmed, sectionId: sectionId || null })
      setTitle('')
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') onDone()
  }

  return (
    <div className="aip-sec-inline-add">
      <div className="aip-sub-check-placeholder" />
      <input
        ref={inputRef}
        className="aip-sub-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (!title.trim()) onDone() }}
        placeholder="Task name… (Enter to add, Esc to cancel)"
      />
    </div>
  )
}

// ── Section header with rename / color / delete ────────────────────────────
function SectionHeader({ section, collapsed, onToggle, taskCount }) {
  const { updateSection, deleteSection, addSection } = useAIPlanner()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(section.title)
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  useEffect(() => {
    function handler(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function commitRename() {
    const t = draft.trim()
    if (t && t !== section.title) updateSection(section.id, { title: t })
    else setDraft(section.title)
    setEditing(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') { setDraft(section.title); setEditing(false) }
  }

  return (
    <div className="aip-sec-header" style={{ '--sec-color': section.color }}>
      {/* Collapse toggle */}
      <button
        className="aip-sec-collapse"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand section' : 'Collapse section'}
      >
        <span className={`aip-sec-chevron ${collapsed ? 'collapsed' : ''}`}>›</span>
      </button>

      {/* Color dot */}
      <span
        className="aip-sec-dot"
        style={{ background: section.color }}
        title="Section colour"
      />

      {/* Title — inline editable */}
      {editing ? (
        <input
          ref={inputRef}
          className="aip-sec-title-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="aip-sec-title"
          onDoubleClick={() => setEditing(true)}
          title="Double-click to rename"
        >
          {section.title}
        </span>
      )}

      <span className="aip-sec-count">{taskCount}</span>

      {/* ⋯ menu */}
      <div className="aip-sec-menu-wrap" ref={menuRef}>
        <button
          className="aip-sec-menu-btn"
          onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v) }}
          aria-label="Section options"
        >
          ···
        </button>
        {showMenu && (
          <div className="aip-sec-menu">
            <button className="aip-sec-menu-item" onClick={() => { setEditing(true); setShowMenu(false) }}>
              ✏️ Rename
            </button>

            {/* Colour picker row */}
            <div className="aip-sec-menu-colors">
              {SECTION_COLORS.map((c) => (
                <button
                  key={c}
                  className={`aip-sec-color-dot ${section.color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => { updateSection(section.id, { color: c }); setShowMenu(false) }}
                  aria-label={c}
                />
              ))}
            </div>

            <button
              className="aip-sec-menu-item"
              onClick={() => { addSection('New Section'); setShowMenu(false) }}
            >
              ＋ Add section below
            </button>

            <div className="aip-sec-menu-divider" />
            <button
              className="aip-sec-menu-item danger"
              onClick={() => {
                if (window.confirm(`Delete section "${section.title}"? Tasks will be moved to No Section.`)) {
                  deleteSection(section.id)
                }
                setShowMenu(false)
              }}
            >
              🗑 Delete section
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Section block ─────────────────────────────────────────────────────────────
function SectionBlock({ section, tasks, statusFilter, catFilter }) {
  const [collapsed, setCollapsed] = useState(false)
  const [adding, setAdding]       = useState(false)

  const filtered = tasks.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (catFilter && t.category?.id !== catFilter) return false
    return true
  })

  return (
    <div className="aip-section">
      <SectionHeader
        section={section}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        taskCount={filtered.length}
      />

      {!collapsed && (
        <div className="aip-section__body">
          {filtered.length > 0 ? (
            <div className="aip-task-list">
              {filtered.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          ) : (
            <div className="aip-sec-empty">No tasks in this section</div>
          )}

          {adding ? (
            <InlineAddTask sectionId={section?.id ?? null} onDone={() => setAdding(false)} />
          ) : (
            <button className="aip-sec-add-task-btn" onClick={() => setAdding(true)}>
              + Add task
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
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

export default function ProjectsIndexPage() {
  const { tasks, sections, addSection } = useAIPlanner()
  const [statusFilter, setStatusFilter] = useState('all')
  const [catFilter, setCatFilter]       = useState('')

  const todoCount    = tasks.filter((t) => t.status === 'todo').length
  const blockedCount = tasks.filter((t) => t.status === 'blocked').length
  const doneCount    = tasks.filter((t) => t.status === 'done').length

  // Sort sections by order
  const sortedSections = [...sections].sort((a, b) => a.order - b.order)

  // Tasks with no section (or section that no longer exists)
  const sectionIds = new Set(sections.map((s) => s.id))
  const unsectioned = tasks.filter((t) => !t.sectionId || !sectionIds.has(t.sectionId))

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

        {/* Sections */}
        <div className="aip-sections-list">
          {sortedSections.map((sec) => {
            const secTasks = tasks.filter((t) => t.sectionId === sec.id)
            return (
              <SectionBlock
                key={sec.id}
                section={sec}
                tasks={secTasks}
                statusFilter={statusFilter}
                catFilter={catFilter}
              />
            )
          })}

          {/* No Section bucket */}
          <SectionBlock
            section={{ id: null, title: 'No Section', color: '#94a3b8', order: 99999 }}
            tasks={unsectioned}
            statusFilter={statusFilter}
            catFilter={catFilter}
          />
        </div>

        {/* Add section button */}
        <button className="aip-add-section-btn" onClick={() => addSection('New Section')}>
          + Add Section
        </button>
      </div>

      <AIAssistPanel />
      <TaskDrawer />
    </div>
  )
}
