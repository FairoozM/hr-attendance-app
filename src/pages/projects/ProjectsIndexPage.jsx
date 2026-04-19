import { useState, useRef, useEffect } from 'react'
import { useAIPlanner } from '../../contexts/AIPlannerContext'
import { AIAssistPanel } from '../../components/planner/AIAssistPanel'
import { TaskDrawer } from '../../components/planner/TaskDrawer'
import { priorityLabel, formatTime } from '../../lib/aiEngine'
import './planner.css'
import './projects.css'

const SECTION_COLORS = [
  '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4',
  '#10b981', '#f59e0b', '#f97316', '#ef4444', '#ec4899',
  '#6b7280',
]

// ── Priority dot ─────────────────────────────────────────────────────────────
function PriorityDot({ score }) {
  const { text, color } = priorityLabel(score || 0)
  return (
    <span className="tbl-priority-dot" style={{ '--dot-color': color }} title={`${text} · ${score}`}>
      <span className="tbl-priority-dot__circle" />
      <span className="tbl-priority-dot__label">{text}</span>
    </span>
  )
}

// ── Status chip ───────────────────────────────────────────────────────────────
function StatusChip({ status }) {
  const map = {
    todo:    { label: 'To Do',   cls: 'todo'    },
    blocked: { label: 'Blocked', cls: 'blocked' },
    done:    { label: 'Done',    cls: 'done'    },
  }
  const { label, cls } = map[status] || map.todo
  return <span className={`tbl-status-chip tbl-status-chip--${cls}`}>{label}</span>
}

// ── Category pill ─────────────────────────────────────────────────────────────
function CatPill({ cat }) {
  if (!cat) return null
  return (
    <span
      className="tbl-cat-pill"
      style={{ '--cat-color': cat.color, '--cat-bg': cat.bg }}
    >
      {cat.icon} {cat.label}
    </span>
  )
}

// ── Quick Capture ─────────────────────────────────────────────────────────────
function QuickCapture() {
  const { quickCapture } = useAIPlanner()
  const [input, setInput]   = useState('')
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

// ── Table column header ───────────────────────────────────────────────────────
function TaskTableHeader() {
  return (
    <div className="tbl-col-header" aria-hidden>
      <div className="tbl-col tbl-col--check" />
      <div className="tbl-col tbl-col--name">Task name</div>
      <div className="tbl-col tbl-col--cat">Category</div>
      <div className="tbl-col tbl-col--due">Due</div>
      <div className="tbl-col tbl-col--priority">Priority</div>
      <div className="tbl-col tbl-col--status">Status</div>
      <div className="tbl-col tbl-col--score">Score</div>
    </div>
  )
}

// ── Task row ──────────────────────────────────────────────────────────────────
function TaskRow({ task }) {
  const { markDone, markTodo, setActiveTaskId, activeTaskId } = useAIPlanner()
  const isActive  = task.id === activeTaskId
  const cat       = task.category
  const isDueToday = task.dueDate === new Date().toISOString().slice(0, 10)
  const isOverdue  = task.dueDate && new Date(task.dueDate) < new Date(new Date().toDateString())
  const { color: pcolor } = priorityLabel(task.priorityScore || 0)

  // Format due date concisely
  let dueLabel = null
  if (task.dueDate) {
    dueLabel = isOverdue
      ? { text: task.dueDate, cls: 'overdue' }
      : isDueToday
        ? { text: 'Today', cls: 'today' }
        : { text: task.dueDate, cls: '' }
  } else if (task.scheduledStart) {
    dueLabel = { text: formatTime(task.scheduledStart), cls: '' }
  }

  // Subtask progress
  const subTotal = task.subtasks?.length || 0
  const subDone  = subTotal > 0 ? task.subtasks.filter((s) => s.done).length : 0
  const subPct   = subTotal > 0 ? Math.round((subDone / subTotal) * 100) : 0

  return (
    <div
      className={`tbl-row ${task.status === 'done' ? 'done' : ''} ${task.status === 'blocked' ? 'blocked' : ''} ${isActive ? 'active' : ''} ${task._hasUnresolvedDeps ? 'dep-blocked' : ''}`}
      onClick={() => setActiveTaskId(task.id)}
      role="row"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTaskId(task.id) } }}
    >
      {/* Checkbox */}
      <div className="tbl-col tbl-col--check">
        <button
          className={`tbl-check ${task.status === 'done' ? 'checked' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            task.status === 'done' ? markTodo(task.id) : markDone(task.id)
          }}
          aria-label={task.status === 'done' ? 'Mark incomplete' : 'Mark complete'}
        />
      </div>

      {/* Task name */}
      <div className="tbl-col tbl-col--name">
        <span className="tbl-task-title">{task.title}</span>

        {/* Inline indicators on the name column */}
        <div className="tbl-task-indicators">
          {task.status === 'blocked' && (
            <span className="tbl-indicator tbl-indicator--blocked">Blocked</span>
          )}
          {task._hasUnresolvedDeps && (
            <span className="tbl-indicator tbl-indicator--dep">
              ⛓ {task._unresolvedBlockerIds?.length} dep
            </span>
          )}
          {task.attachments?.length > 0 && (
            <span className="tbl-indicator tbl-indicator--attach">📎 {task.attachments.length}</span>
          )}
          {subTotal > 0 && (
            <span className="tbl-indicator tbl-indicator--sub" title={`${subDone}/${subTotal} subtasks`}>
              <span className="tbl-sub-progress">
                <span className="tbl-sub-progress__fill" style={{ width: `${subPct}%` }} />
              </span>
              {subDone}/{subTotal}
            </span>
          )}
          {task.energyType === 'deep' && (
            <span className="tbl-indicator tbl-indicator--deep" title="Deep work">🧠</span>
          )}
        </div>
      </div>

      {/* Category */}
      <div className="tbl-col tbl-col--cat">
        <CatPill cat={cat} />
      </div>

      {/* Due */}
      <div className="tbl-col tbl-col--due">
        {dueLabel && (
          <span className={`tbl-due ${dueLabel.cls}`}>{dueLabel.text}</span>
        )}
      </div>

      {/* Priority */}
      <div className="tbl-col tbl-col--priority">
        <PriorityDot score={task.priorityScore} />
      </div>

      {/* Status */}
      <div className="tbl-col tbl-col--status">
        <StatusChip status={task.status} />
      </div>

      {/* Score */}
      <div className="tbl-col tbl-col--score">
        <span className="tbl-score" style={{ '--score-color': pcolor }}>
          {task.priorityScore || 0}
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
    <div className="tbl-add-row">
      <div className="tbl-col tbl-col--check">
        <div className="tbl-check-placeholder" />
      </div>
      <div className="tbl-col tbl-col--name" style={{ flex: '1 1 0' }}>
        <input
          ref={inputRef}
          className="tbl-add-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (!title.trim()) onDone() }}
          placeholder="Task name… Enter to add, Esc to cancel"
        />
      </div>
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ section, collapsed, onToggle, taskCount, onAddTask }) {
  const { updateSection, deleteSection, addSection } = useAIPlanner()
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState(section.title)
  const [showMenu, setShowMenu] = useState(false)
  const menuRef  = useRef(null)
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
    <div className="tbl-sec-header" style={{ '--sec-color': section.color }}>
      {/* Collapse chevron */}
      <button
        className="tbl-sec-collapse"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand section' : 'Collapse section'}
      >
        <span className={`tbl-sec-chevron ${collapsed ? 'collapsed' : ''}`} />
      </button>

      {/* Colour dot */}
      <span className="tbl-sec-dot" style={{ background: section.color }} />

      {/* Title */}
      {editing ? (
        <input
          ref={inputRef}
          className="tbl-sec-title-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="tbl-sec-title"
          onDoubleClick={() => setEditing(true)}
          title="Double-click to rename"
        >
          {section.title}
        </span>
      )}

      <span className="tbl-sec-count">{taskCount}</span>

      {/* Right actions */}
      <div className="tbl-sec-actions">
        <button className="tbl-sec-add-btn" onClick={onAddTask} title="Add task">+</button>

        {/* ⋯ menu */}
        <div className="aip-sec-menu-wrap" ref={menuRef}>
          <button
            className="tbl-sec-menu-btn"
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
    </div>
  )
}

// ── Section block (table) ──────────────────────────────────────────────────────
function SectionBlock({ section, tasks, statusFilter, catFilter }) {
  const [collapsed, setCollapsed] = useState(false)
  const [adding, setAdding]       = useState(false)

  const filtered = tasks.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (catFilter && t.category?.id !== catFilter) return false
    return true
  })

  return (
    <div className="tbl-section">
      <SectionHeader
        section={section}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        taskCount={filtered.length}
        onAddTask={() => { setCollapsed(false); setAdding(true) }}
      />

      {!collapsed && (
        <div className="tbl-section__body">
          {/* Column header — shown once per section */}
          <TaskTableHeader />

          {/* Task rows */}
          {filtered.length > 0
            ? filtered.map((task) => <TaskRow key={task.id} task={task} />)
            : <div className="tbl-empty">No tasks — add one below</div>
          }

          {/* Inline add */}
          {adding ? (
            <InlineAddTask sectionId={section?.id ?? null} onDone={() => setAdding(false)} />
          ) : (
            <button className="tbl-add-task-btn" onClick={() => setAdding(true)}>
              + Add task
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Filter bar ────────────────────────────────────────────────────────────────
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

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ProjectsIndexPage() {
  const { tasks, sections, addSection } = useAIPlanner()
  const [statusFilter, setStatusFilter] = useState('all')
  const [catFilter, setCatFilter]       = useState('')

  const todoCount    = tasks.filter((t) => t.status === 'todo').length
  const blockedCount = tasks.filter((t) => t.status === 'blocked').length
  const doneCount    = tasks.filter((t) => t.status === 'done').length

  const sortedSections = [...sections].sort((a, b) => a.order - b.order)
  const sectionIds     = new Set(sections.map((s) => s.id))
  const unsectioned    = tasks.filter((t) => !t.sectionId || !sectionIds.has(t.sectionId))

  return (
    <div className="aip-layout">
      <div className="aip-main aip-main--list">

        {/* Page header */}
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

        {/* Filter bar */}
        <div className="aip-toolbar tbl-toolbar">
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

        {/* Section table list */}
        <div className="tbl-sections-list">
          {sortedSections.map((sec) => (
            <SectionBlock
              key={sec.id}
              section={sec}
              tasks={tasks.filter((t) => t.sectionId === sec.id)}
              statusFilter={statusFilter}
              catFilter={catFilter}
            />
          ))}

          {/* No-section bucket */}
          <SectionBlock
            section={{ id: null, title: 'No Section', color: '#94a3b8', order: 99999 }}
            tasks={unsectioned}
            statusFilter={statusFilter}
            catFilter={catFilter}
          />
        </div>

        {/* Add section */}
        <button className="tbl-add-section-btn" onClick={() => addSection('New Section')}>
          + Add Section
        </button>

      </div>

      <AIAssistPanel />
      <TaskDrawer />
    </div>
  )
}
