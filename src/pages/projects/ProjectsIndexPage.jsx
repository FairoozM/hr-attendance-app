import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { ChevronRight, Copy, CornerDownRight, CheckCircle2, Circle, ListTree, ExternalLink, Link2, Trash2 } from 'lucide-react'
import { useAIPlanner } from '../../contexts/AIPlannerContext'
import { AIAssistPanel } from '../../components/planner/AIAssistPanel'
import { TaskDrawer } from '../../components/planner/TaskDrawer'
import { PlannerDatePopover } from '../../components/planner/PlannerDatePopover'
import { priorityLabel, formatTime, getCategoryById, PLANNER_CATEGORY_LIST } from '../../lib/aiEngine'
import './planner.css'
import './projects.css'

const SECTION_COLORS = [
  '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4',
  '#10b981', '#f59e0b', '#f97316', '#ef4444', '#ec4899',
  '#6b7280',
]

/** Asana-style list display: "Apr 9" (no year) */
function formatDueShort(iso) {
  if (!iso) return ''
  const parts = iso.split('-').map(Number)
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return ''
  const d = new Date(parts[0], parts[1] - 1, parts[2])
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const INLINE_PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const INLINE_STATUS_OPTIONS = [
  { value: 'todo', label: 'To Do' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
]

/** Enriched tasks in manual listOrder when set; otherwise match AI priority sort. */
function orderTasksForListSection(rawInSection, enrichedById) {
  const hasAny = rawInSection.some((t) => t.listOrder != null)
  const items = rawInSection
    .map((r) => {
      const e = enrichedById[r.id]
      if (!e) return null
      return { enriched: e, raw: r }
    })
    .filter(Boolean)
  if (!hasAny) {
    items.sort((a, b) => (b.enriched.priorityScore ?? 0) - (a.enriched.priorityScore ?? 0))
  } else {
    items.sort((a, b) => (a.raw.listOrder ?? 0) - (b.raw.listOrder ?? 0))
  }
  return items.map((x) => x.enriched)
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
      <div className="tbl-col tbl-col--grip" />
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

// ── Task right-click context menu ─────────────────────────────────────────────
function TaskContextMenu({ task, sectionId, pos, onClose }) {
  const { markDone, markTodo, deleteTask, setActiveTaskId, addTask } = useAIPlanner()
  const menuRef = useRef(null)

  // Close on outside click or Escape
  useEffect(() => {
    function onMouseDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Smart positioning: flip up/left if near viewport edges
  const MENU_W = 218
  const MENU_H = 280
  const left = pos.x + MENU_W > window.innerWidth  ? pos.x - MENU_W : pos.x
  const top  = pos.y + MENU_H > window.innerHeight ? pos.y - MENU_H : pos.y

  function act(fn) {
    onClose()
    fn()
  }

  function duplicateTask() {
    const { id: _id, createdAt: _c, listOrder: _lo, ...rest } = task
    addTask({ ...rest, title: `Copy of ${task.title || 'Untitled'}`, sectionId: sectionId ?? null, status: 'todo' })
  }

  function createFollowUp() {
    addTask({
      title: `Follow-up: ${task.title || 'Untitled'}`,
      sectionId: sectionId ?? null,
      dueDate: task.dueDate || null,
      priority: task.priority || 'medium',
      category: task.category || null,
      status: 'todo',
    })
  }

  function copyTaskLink() {
    const text = `[${task.title || 'Untitled'}] — Task #${task.id}`
    navigator.clipboard?.writeText(text).catch(() => {})
  }

  const isDone = task.status === 'done'

  return (
    <div
      ref={menuRef}
      className="task-ctx-menu"
      style={{ top, left }}
      role="menu"
      aria-label="Task options"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Mark complete / incomplete */}
      <button
        className="task-ctx-menu__item"
        role="menuitem"
        onClick={() => act(() => isDone ? markTodo(task.id) : markDone(task.id))}
      >
        {isDone
          ? <Circle size={15} className="ctx-icon" />
          : <CheckCircle2 size={15} className="ctx-icon" />}
        {isDone ? 'Mark incomplete' : 'Mark complete'}
      </button>

      <div className="task-ctx-menu__divider" />

      {/* Duplicate */}
      <button
        className="task-ctx-menu__item"
        role="menuitem"
        onClick={() => act(duplicateTask)}
      >
        <Copy size={15} className="ctx-icon" />
        Duplicate task
      </button>

      {/* Follow-up */}
      <button
        className="task-ctx-menu__item"
        role="menuitem"
        onClick={() => act(createFollowUp)}
      >
        <CornerDownRight size={15} className="ctx-icon" />
        Create follow-up task
      </button>

      {/* Add subtask */}
      <button
        className="task-ctx-menu__item"
        role="menuitem"
        onClick={() => act(() => setActiveTaskId(task.id))}
      >
        <ListTree size={15} className="ctx-icon" />
        Add subtask
      </button>

      <div className="task-ctx-menu__divider" />

      {/* Open details */}
      <button
        className="task-ctx-menu__item"
        role="menuitem"
        onClick={() => act(() => setActiveTaskId(task.id))}
      >
        <ExternalLink size={15} className="ctx-icon" />
        Open task details
      </button>

      {/* Copy task link */}
      <button
        className="task-ctx-menu__item"
        role="menuitem"
        onClick={() => act(copyTaskLink)}
      >
        <Link2 size={15} className="ctx-icon" />
        Copy task link
      </button>

      <div className="task-ctx-menu__divider" />

      {/* Delete */}
      <button
        className="task-ctx-menu__item task-ctx-menu__item--danger"
        role="menuitem"
        onClick={() => act(() => {
          if (window.confirm(`Delete "${task.title || 'this task'}"?`)) deleteTask(task.id)
        })}
      >
        <Trash2 size={15} className="ctx-icon" />
        Delete task
      </button>
    </div>
  )
}

// ── Task row (spreadsheet-style inline edit, no side drawer) ────────────────
function TaskRow({
  task,
  sectionId,
  onOpenDatePicker,
  reorderTasksInSection,
  draggingId,
  onDragState,
}) {
  const { markDone, markTodo, updateTask, deleteTask, setActiveTaskId, activeTaskId } = useAIPlanner()
  const detailsOpen = task.id === activeTaskId
  const [titleDraft, setTitleDraft] = useState(task.title || '')
  const [ctxMenu, setCtxMenu] = useState(null) // { x, y } | null

  useEffect(() => {
    setTitleDraft(task.title || '')
  }, [task.id, task.title])

  const cat = task.category
  const endDate = task.dueDate
  const startDate = task.dueDateStart || endDate
  const isRange = endDate && startDate && startDate !== endDate
  const isDueToday = endDate === new Date().toISOString().slice(0, 10)
  const isOverdue = endDate && new Date(endDate) < new Date(new Date().toDateString())
  const { color: pcolor } = priorityLabel(task.priorityScore || 0)
  const catId = cat?.id && PLANNER_CATEGORY_LIST.some((c) => c.id === cat.id) ? cat.id : 'general'

  let dueLabel = null
  if (task.dueDate) {
    const text = isRange
      ? `${formatDueShort(startDate)} – ${formatDueShort(endDate)}`
      : isOverdue
        ? formatDueShort(endDate)
        : isDueToday
          ? 'Today'
          : formatDueShort(endDate)
    dueLabel = isOverdue
      ? { text, cls: 'overdue' }
      : isDueToday && !isRange
        ? { text, cls: 'today' }
        : { text, cls: '' }
  } else if (task.scheduledStart) {
    dueLabel = { text: formatTime(task.scheduledStart), cls: '' }
  }

  const subTotal = task.subtasks?.length || 0
  const subDone = subTotal > 0 ? task.subtasks.filter((s) => s.done).length : 0
  const subPct = subTotal > 0 ? Math.round((subDone / subTotal) * 100) : 0

  function commitTitle() {
    const t = titleDraft.trim()
    if (!t) {
      setTitleDraft(task.title || '')
      return
    }
    if (t !== (task.title || '')) updateTask(task.id, { title: t })
  }

  const isDragging = draggingId === task.id

  const closeCtx = useCallback(() => setCtxMenu(null), [])

  return (
    <div
      className={`tbl-row ${task.status === 'done' ? 'done' : ''} ${task.status === 'blocked' ? 'blocked' : ''} ${task._hasUnresolvedDeps ? 'dep-blocked' : ''} ${detailsOpen ? 'tbl-row--details-open' : ''} ${isDragging ? 'tbl-row--dragging' : ''}`}
      role="row"
      data-task-id={task.id}
      draggable
      onContextMenu={(e) => {
        e.preventDefault()
        setCtxMenu({ x: e.clientX, y: e.clientY })
      }}
      onDragStart={(e) => {
        if (!e.target.closest('.tbl-drag-handle')) {
          e.preventDefault()
          return
        }
        e.dataTransfer.setData('text/plain', task.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragState?.(task.id)
      }}
      onDragEnd={() => onDragState?.(null)}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        e.preventDefault()
        const draggedId = e.dataTransfer.getData('text/plain')
        if (!draggedId || draggedId === task.id) return
        reorderTasksInSection(sectionId, draggedId, task.id)
        onDragState?.(null)
      }}
    >
      <div className="tbl-col tbl-col--grip" aria-hidden>
        <span className="tbl-drag-handle" title="Drag to reorder" aria-label="Drag to reorder">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="tbl-drag-dot" />
          ))}
        </span>
      </div>
      <div className="tbl-col tbl-col--check">
        <button
          type="button"
          className={`tbl-check ${task.status === 'done' ? 'checked' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            task.status === 'done' ? markTodo(task.id) : markDone(task.id)
          }}
          aria-label={task.status === 'done' ? 'Mark incomplete' : 'Mark complete'}
        />
      </div>

      <div className="tbl-col tbl-col--name">
        <div className="tbl-name-edit-row">
          <input
            className="tbl-inline-title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            aria-label="Task title"
          />
          <button
            type="button"
            className="tbl-row-details"
            title="Details"
            aria-label="Open task details"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              setActiveTaskId(task.id)
            }}
          >
            <ChevronRight size={16} strokeWidth={2.25} aria-hidden />
          </button>
          <button
            type="button"
            className="tbl-row-delete"
            title="Delete task"
            onClick={() => {
              if (window.confirm(`Delete “${task.title || 'this task'}”?`)) deleteTask(task.id)
            }}
          >
            ×
          </button>
        </div>
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

      <div className="tbl-col tbl-col--cat">
        <select
          className="tbl-inline-select tbl-inline-select--cat"
          value={catId}
          onChange={(e) => updateTask(task.id, { category: getCategoryById(e.target.value) })}
          aria-label="Category"
        >
          {PLANNER_CATEGORY_LIST.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="tbl-col tbl-col--due">
        <button
          type="button"
          className={`tbl-due-btn ${dueLabel ? `tbl-due ${dueLabel.cls}` : 'tbl-due tbl-due--placeholder'}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            onOpenDatePicker(task.id, {
              rect: {
                top: r.top,
                left: r.left,
                bottom: r.bottom,
                right: r.right,
                width: r.width,
                height: r.height,
              },
              scrollY: window.scrollY,
            })
          }}
        >
          {dueLabel ? dueLabel.text : 'Set date'}
        </button>
      </div>

      <div className="tbl-col tbl-col--priority">
        <select
          className="tbl-inline-select"
          value={task.priority || 'medium'}
          onChange={(e) => updateTask(task.id, { priority: e.target.value })}
          aria-label="Priority"
        >
          {INLINE_PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="tbl-col tbl-col--status">
        <select
          className="tbl-inline-select"
          value={task.status || 'todo'}
          onChange={(e) => updateTask(task.id, { status: e.target.value })}
          aria-label="Status"
        >
          {INLINE_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="tbl-col tbl-col--score">
        <span className="tbl-score" style={{ '--score-color': pcolor }}>
          {task.priorityScore || 0}
        </span>
      </div>

      {ctxMenu && (
        <TaskContextMenu
          task={task}
          sectionId={sectionId}
          pos={ctxMenu}
          onClose={closeCtx}
        />
      )}
    </div>
  )
}

// ── Inline add-task row ───────────────────────────────────────────────────────
function InlineAddTask({ sectionId, onDone, onAdded }) {
  const { addTask } = useAIPlanner()
  const [title, setTitle] = useState('')
  const inputRef = useRef(null)
  const skipBlurClose = useRef(false)

  useEffect(() => { inputRef.current?.focus() }, [])

  function commit() {
    const trimmed = title.trim()
    if (trimmed) {
      skipBlurClose.current = true
      addTask({ title: trimmed, sectionId: sectionId ?? null })
      setTitle('')
      onAdded?.()
      requestAnimationFrame(() => {
        skipBlurClose.current = false
        inputRef.current?.focus()
      })
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    }
    if (e.key === 'Escape') onDone()
  }

  return (
    <div className="tbl-add-row">
      <div className="tbl-col tbl-col--grip tbl-col--pad" aria-hidden />
      <div className="tbl-col tbl-col--check">
        <div className="tbl-check-placeholder" />
      </div>
      <div className="tbl-col tbl-col--name">
        <input
          ref={inputRef}
          className="tbl-add-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (skipBlurClose.current) return
            if (!title.trim()) onDone()
          }}
          placeholder="Task name… Enter to add, Esc to cancel"
        />
      </div>
      <div className="tbl-col tbl-col--cat tbl-col--pad" aria-hidden />
      <div className="tbl-col tbl-col--due tbl-col--pad" aria-hidden />
      <div className="tbl-col tbl-col--priority tbl-col--pad" aria-hidden />
      <div className="tbl-col tbl-col--status tbl-col--pad" aria-hidden />
      <div className="tbl-col tbl-col--score tbl-col--pad" aria-hidden />
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
function SectionBlock({
  section,
  sectionTasksOrdered,
  statusFilter,
  catFilter,
  onOpenDatePicker,
  onAfterAddTask,
  reorderTasksInSection,
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [adding, setAdding]       = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const sectionId = section?.id ?? null

  const filtered = sectionTasksOrdered.filter((t) => {
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
            ? (
              <>
                {filtered.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    sectionId={sectionId}
                    onOpenDatePicker={onOpenDatePicker}
                    reorderTasksInSection={reorderTasksInSection}
                    draggingId={draggingId}
                    onDragState={setDraggingId}
                  />
                ))}
                <div
                  className="tbl-drop-tail"
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const id = e.dataTransfer.getData('text/plain')
                    if (id) reorderTasksInSection(sectionId, id, null)
                    setDraggingId(null)
                  }}
                />
              </>
            )
            : <div className="tbl-empty">No tasks — add one below</div>
          }

          {/* Inline add */}
          {adding ? (
            <InlineAddTask
              sectionId={section?.id ?? null}
              onDone={() => setAdding(false)}
              onAdded={onAfterAddTask}
            />
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
  const { tasks, rawTasks, sections, addSection, updateTask, reorderTasksInSection } = useAIPlanner()
  const [statusFilter, setStatusFilter] = useState('all')
  const [catFilter, setCatFilter]       = useState('')
  const [datePicker, setDatePicker]     = useState(null)

  const todoCount    = tasks.filter((t) => t.status === 'todo').length
  const blockedCount = tasks.filter((t) => t.status === 'blocked').length
  const doneCount    = tasks.filter((t) => t.status === 'done').length

  const sortedSections = [...sections].sort((a, b) => a.order - b.order)
  const sectionIds     = new Set(sections.map((s) => s.id))

  const datePickerTask = datePicker ? tasks.find((t) => t.id === datePicker.taskId) : null

  const enrichedById = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks])

  const afterInlineAdd = () => {
    setCatFilter('')
    setStatusFilter('all')
  }

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
              sectionTasksOrdered={orderTasksForListSection(
                rawTasks.filter((t) => (t.sectionId ?? null) === (sec.id ?? null)),
                enrichedById
              )}
              statusFilter={statusFilter}
              catFilter={catFilter}
              onOpenDatePicker={(taskId, payload) => setDatePicker({ taskId, ...payload })}
              onAfterAddTask={afterInlineAdd}
              reorderTasksInSection={reorderTasksInSection}
            />
          ))}

          {/* No-section bucket */}
          <SectionBlock
            section={{ id: null, title: 'No Section', color: '#94a3b8', order: 99999 }}
            sectionTasksOrdered={orderTasksForListSection(
              rawTasks.filter((t) => !t.sectionId || !sectionIds.has(t.sectionId)),
              enrichedById
            )}
            statusFilter={statusFilter}
            catFilter={catFilter}
            onOpenDatePicker={(taskId, payload) => setDatePicker({ taskId, ...payload })}
            onAfterAddTask={afterInlineAdd}
            reorderTasksInSection={reorderTasksInSection}
          />
        </div>

        {/* Add section */}
        <button className="tbl-add-section-btn" onClick={() => addSection('New Section')}>
          + Add Section
        </button>

      </div>

      <AIAssistPanel />
      <TaskDrawer />
      {datePicker && datePickerTask && (
        <PlannerDatePopover
          task={datePickerTask}
          anchorRect={datePicker.rect}
          openScrollY={datePicker.scrollY}
          onClose={() => setDatePicker(null)}
          onApply={(patch) => updateTask(datePicker.taskId, patch)}
        />
      )}
    </div>
  )
}
