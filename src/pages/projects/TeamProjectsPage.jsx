/**
 * TeamProjectsPage.jsx
 * Phase 2 — Jira-style team task list on /projects/team
 *
 * Safety contract:
 *  - Does NOT touch /projects (AI Planner) or AIPlannerContext.
 *  - Uses TeamProjectsContext + projectsApi exclusively.
 *  - The existing planner is completely unaffected.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  LayoutList, LayoutDashboard, CalendarDays,
  Plus, RefreshCw, AlertCircle, Inbox,
  ChevronDown, ChevronUp, ChevronsUpDown,
  ArrowUp, ArrowDown, Minus,
  Clock, CalendarX, Flag,
  Layers2,
} from 'lucide-react'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import { useAuth } from '../../contexts/AuthContext'
import { IssueTypeBadge } from '../../components/planner/IssueTypeBadge'
import { AssigneeAvatar } from '../../components/planner/AssigneeAvatar'
import { LabelPills } from '../../components/planner/LabelPills'
import { SprintBadge } from '../../components/planner/SprintBadge'
import { TaskFiltersBar } from '../../components/planner/TaskFiltersBar'
import { ModernSelect } from '../../components/ui/ModernSelect'
import '../../components/planner/plannerComponents.css'
import './TeamProjectsPage.css'

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_FILTERS = {
  search:      '',
  projectId:   '',
  assigneeId:  '',
  status:      '',
  priority:    '',
  issueType:   '',
  sprintId:    '',
  label:       '',
  overdueOnly: false,
  blockedOnly: false,
  myTasks:     false,
  unassigned:  false,
}

/** Normalise legacy status values from the AI Planner into the Jira workflow */
function normalizeStatus(raw) {
  if (!raw) return 'Backlog'
  const s = String(raw).toLowerCase().trim()
  if (s === 'todo' || s === 'to do' || s === 'to-do')     return 'To Do'
  if (s === 'in_progress' || s === 'in progress')          return 'In Progress'
  if (s === 'in_review' || s === 'in review')              return 'In Review'
  if (s === 'qa' || s === 'qa_testing' || s === 'qa testing') return 'QA Testing'
  if (s === 'blocked')                                     return 'Blocked'
  if (s === 'done' || s === 'completed')                   return 'Done'
  if (s === 'cancelled' || s === 'canceled')               return 'Cancelled'
  if (s === 'backlog')                                     return 'Backlog'
  return raw  // pass through unknown values
}

const STATUS_CONFIG = {
  'Backlog':     { color: 'gray',   dot: '#6b7280' },
  'To Do':       { color: 'slate',  dot: '#94a3b8' },
  'In Progress': { color: 'blue',   dot: '#3b82f6' },
  'In Review':   { color: 'indigo', dot: '#818cf8' },
  'QA Testing':  { color: 'teal',   dot: '#2dd4bf' },
  'Blocked':     { color: 'red',    dot: '#f87171' },
  'Done':        { color: 'green',  dot: '#34d399' },
  'Cancelled':   { color: 'gray',   dot: '#4b5563' },
}

const STATUS_OPTIONS_INLINE = [
  'Backlog', 'To Do', 'In Progress', 'In Review',
  'QA Testing', 'Blocked', 'Done', 'Cancelled',
].map((s) => ({ value: s, label: s }))

const PRIORITY_CONFIG = {
  Critical: { icon: ArrowUp,   color: '#ef4444', label: 'Critical' },
  High:     { icon: ArrowUp,   color: '#f97316', label: 'High'     },
  Medium:   { icon: Minus,     color: '#f59e0b', label: 'Medium'   },
  Low:      { icon: ArrowDown, color: '#3b82f6', label: 'Low'      },
}

const PRIORITY_OPTIONS_INLINE = ['Critical', 'High', 'Medium', 'Low'].map((p) => ({
  value: p, label: p,
}))

/** Derive a 2-4 char project key from project name */
function projectKey(name = '') {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words.slice(0, 3).map((w) => w[0].toUpperCase()).join('')
}

function isOverdue(task) {
  if (!task.dueDate || task.status === 'Done' || task.status === 'Cancelled') return false
  return new Date(task.dueDate) < new Date()
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

// ── View switcher ─────────────────────────────────────────────────────────────
function ViewSwitcher({ view, onChange }) {
  const tabs = [
    { id: 'list',     Icon: LayoutList,      label: 'List'      },
    { id: 'board',    Icon: LayoutDashboard, label: 'Board'     },
    { id: 'calendar', Icon: CalendarDays,    label: 'Calendar'  },
  ]
  return (
    <div className="tp-view-switcher" role="tablist" aria-label="View mode">
      {tabs.map(({ id, Icon, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={view === id}
          className={`tp-view-tab ${view === id ? 'tp-view-tab--active' : ''}`}
          onClick={() => onChange(id)}
        >
          <Icon size={14} strokeWidth={2} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}

// ── Priority badge ────────────────────────────────────────────────────────────
function PriorityBadge({ priority }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.Medium
  const { icon: Icon, color, label } = cfg
  return (
    <span className="tp-priority" style={{ '--pri-color': color }} title={label}>
      <Icon size={12} strokeWidth={2.5} aria-hidden="true" />
      <span className="tp-priority__label">{label}</span>
    </span>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const norm  = normalizeStatus(status)
  const cfg   = STATUS_CONFIG[norm] || STATUS_CONFIG['Backlog']
  return (
    <span className={`tp-status tp-status--${cfg.color}`}>
      <span className="tp-status__dot" style={{ background: cfg.dot }} aria-hidden="true" />
      {norm}
    </span>
  )
}

// ── Inline status dropdown ────────────────────────────────────────────────────
function InlineStatusSelect({ value, onChange }) {
  return (
    <ModernSelect
      value={normalizeStatus(value)}
      onChange={onChange}
      options={STATUS_OPTIONS_INLINE}
      size="sm"
    />
  )
}

// ── Inline priority dropdown ──────────────────────────────────────────────────
function InlinePrioritySelect({ value, onChange }) {
  return (
    <ModernSelect
      value={value || 'Medium'}
      onChange={onChange}
      options={PRIORITY_OPTIONS_INLINE}
      size="sm"
    />
  )
}

// ── Inline assignee dropdown ──────────────────────────────────────────────────
function InlineAssigneeSelect({ value, onChange, members }) {
  const options = [
    { value: '', label: 'Unassigned' },
    ...members.map((m) => ({ value: String(m.id), label: m.displayName || m.username })),
  ]
  return (
    <ModernSelect
      value={value ? String(value) : ''}
      onChange={onChange}
      options={options}
      size="sm"
    />
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ filtered }) {
  return (
    <div className="tp-empty">
      <Inbox size={40} strokeWidth={1.2} className="tp-empty__icon" />
      <div className="tp-empty__title">
        {filtered ? 'No tasks match your filters' : 'No tasks yet'}
      </div>
      <div className="tp-empty__sub">
        {filtered
          ? 'Try adjusting or clearing your filters.'
          : 'Tasks created from the server-backed planner will appear here.'}
      </div>
    </div>
  )
}

// ── Placeholder views ─────────────────────────────────────────────────────────
function BoardPlaceholder() {
  return (
    <div className="tp-placeholder">
      <LayoutDashboard size={48} strokeWidth={1} className="tp-placeholder__icon" />
      <div className="tp-placeholder__title">Board View — Coming in Phase 4</div>
      <div className="tp-placeholder__sub">
        Kanban drag-and-drop board will be available after Phase 4 is approved.
      </div>
    </div>
  )
}

function CalendarPlaceholder() {
  return (
    <div className="tp-placeholder">
      <CalendarDays size={48} strokeWidth={1} className="tp-placeholder__icon" />
      <div className="tp-placeholder__title">Calendar View — Coming Soon</div>
      <div className="tp-placeholder__sub">
        Calendar view with due date timeline will be available in a future phase.
      </div>
    </div>
  )
}

// ── Task row ──────────────────────────────────────────────────────────────────
function TaskRow({
  task,
  project,
  sprintMap,
  memberMap,
  onSelect,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  isSelected,
  currentUserId,
}) {
  const assignee = task.assigneeUserId ? memberMap[task.assigneeUserId] : null
  const sprint   = task.sprintId        ? sprintMap[task.sprintId]       : null
  const pKey     = project ? projectKey(project.name) : '—'
  const overdue  = isOverdue(task)

  return (
    <tr
      className={`tp-row ${isSelected ? 'tp-row--selected' : ''} ${overdue ? 'tp-row--overdue' : ''}`}
      onClick={() => onSelect(task)}
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(task)}
      aria-selected={isSelected}
    >
      {/* Issue Type */}
      <td className="tp-cell tp-cell--type">
        <IssueTypeBadge type={task.issueType || 'task'} />
      </td>

      {/* Task name */}
      <td className="tp-cell tp-cell--name">
        <div className="tp-task-name-wrap">
          <span className="tp-task-name">{task.title || '(Untitled)'}</span>
          {task.labels?.length > 0 && (
            <LabelPills labels={task.labels} max={2} />
          )}
        </div>
      </td>

      {/* Project */}
      <td className="tp-cell tp-cell--project" onClick={(e) => e.stopPropagation()}>
        {project ? (
          <span
            className="tp-project-key"
            style={{ '--proj-color': project.color || '#8b5cf6' }}
            title={project.name}
          >
            {pKey}
          </span>
        ) : <span className="tp-cell--muted">—</span>}
      </td>

      {/* Sprint */}
      <td className="tp-cell tp-cell--sprint" onClick={(e) => e.stopPropagation()}>
        <SprintBadge sprint={sprint} />
      </td>

      {/* Assignee */}
      <td className="tp-cell tp-cell--assignee" onClick={(e) => e.stopPropagation()}>
        <div className="tp-assignee-cell">
          <AssigneeAvatar member={assignee} size="sm" showName />
        </div>
        <div className="tp-cell-edit tp-assignee-edit" onClick={(e) => e.stopPropagation()}>
          <InlineAssigneeSelect
            value={task.assigneeUserId}
            onChange={(v) => onAssigneeChange(task, v ? Number(v) : null)}
            members={Object.values(memberMap)}
          />
        </div>
      </td>

      {/* Priority */}
      <td className="tp-cell tp-cell--priority" onClick={(e) => e.stopPropagation()}>
        <div className="tp-cell-display">
          <PriorityBadge priority={task.priority} />
        </div>
        <div className="tp-cell-edit">
          <InlinePrioritySelect
            value={task.priority}
            onChange={(v) => onPriorityChange(task, v)}
          />
        </div>
      </td>

      {/* Status */}
      <td className="tp-cell tp-cell--status" onClick={(e) => e.stopPropagation()}>
        <div className="tp-cell-display">
          <StatusBadge status={task.status} />
        </div>
        <div className="tp-cell-edit">
          <InlineStatusSelect
            value={task.status}
            onChange={(v) => onStatusChange(task, v)}
          />
        </div>
      </td>

      {/* Due date */}
      <td className={`tp-cell tp-cell--due ${overdue ? 'tp-cell--overdue' : ''}`}>
        {overdue && <CalendarX size={11} strokeWidth={2.2} className="tp-overdue-icon" aria-hidden="true" />}
        <span>{fmtDate(task.dueDate)}</span>
      </td>

      {/* Story points */}
      <td className="tp-cell tp-cell--points">
        {task.storyPoints != null
          ? <span className="tp-points">{task.storyPoints}</span>
          : <span className="tp-cell--muted">—</span>}
      </td>
    </tr>
  )
}

// ── Column sort header ────────────────────────────────────────────────────────
function SortHeader({ label, col, sortCol, sortDir, onSort }) {
  const active = sortCol === col
  const Icon   = active ? (sortDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
  return (
    <th
      className={`tp-th tp-th--sortable ${active ? 'tp-th--active' : ''}`}
      onClick={() => onSort(col)}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="tp-th-inner">
        {label}
        <Icon size={12} strokeWidth={2} aria-hidden="true" />
      </span>
    </th>
  )
}

// ── Task detail placeholder panel ─────────────────────────────────────────────
function TaskDetailPlaceholder({ task, onClose }) {
  if (!task) return null
  return createPortal(
    <div className="tp-detail-overlay" onClick={onClose}>
      <aside className="tp-detail-panel" onClick={(e) => e.stopPropagation()} aria-label="Task detail">
        <div className="tp-detail-header">
          <div className="tp-detail-type-title">
            <IssueTypeBadge type={task.issueType || 'task'} showLabel />
            <span className="tp-detail-id">#{task.id}</span>
          </div>
          <button type="button" className="tp-detail-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <h2 className="tp-detail-title">{task.title || '(Untitled)'}</h2>
        <p className="tp-detail-coming">
          Full task drawer (comments, subtasks, activity log, checklist) coming in Phase 3.
        </p>
        <dl className="tp-detail-meta">
          <dt>Status</dt>    <dd><StatusBadge status={task.status} /></dd>
          <dt>Priority</dt>  <dd><PriorityBadge priority={task.priority} /></dd>
          <dt>Due</dt>       <dd>{fmtDate(task.dueDate)}</dd>
          <dt>Points</dt>    <dd>{task.storyPoints ?? '—'}</dd>
          {task.blockedReason && <><dt>Blocked reason</dt><dd>{task.blockedReason}</dd></>}
          {task.labels?.length > 0 && <><dt>Labels</dt><dd><LabelPills labels={task.labels} max={6} /></dd></>}
        </dl>
      </aside>
    </div>,
    document.body
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TeamProjectsPage() {
  const { user } = useAuth()
  const {
    projects,
    members,
    loadingProjects,
    loadingTasks,
    error,
    getTasksForProject,
    getSprintsForProject,
    getMemberById,
    actions,
  } = useTeamProjectsContext()

  const [view,         setView]         = useState('list')
  const [filters,      setFilters]      = useState(DEFAULT_FILTERS)
  const [sortCol,      setSortCol]      = useState('dueDate')
  const [sortDir,      setSortDir]      = useState('asc')
  const [selectedTask, setSelectedTask] = useState(null)
  const didFetch = useRef(false)

  // Fetch on mount
  useEffect(() => {
    if (didFetch.current) return
    didFetch.current = true
    actions.fetchProjects()
    actions.fetchMembers()
  }, [actions])

  // Fetch tasks for each project once projects load
  useEffect(() => {
    for (const p of projects) {
      actions.fetchTasks(p.id)
    }
  }, [projects, actions])

  // ── Derived data ────────────────────────────────────────────────────────────
  const memberMap = useMemo(() => {
    const m = {}
    for (const member of members) m[member.id] = member
    return m
  }, [members])

  const projectMap = useMemo(() => {
    const m = {}
    for (const p of projects) m[p.id] = p
    return m
  }, [projects])

  /** Flatten all tasks from all projects into a single list */
  const allTasks = useMemo(() => {
    return projects.flatMap((p) => getTasksForProject(p.id))
  }, [projects, getTasksForProject])

  const sprintMap = useMemo(() => {
    const m = {}
    for (const p of projects) {
      for (const s of getSprintsForProject(p.id)) m[s.id] = s
    }
    return m
  }, [projects, getSprintsForProject])

  const allSprints = useMemo(() => Object.values(sprintMap), [sprintMap])

  // ── Filter logic ────────────────────────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    const today = new Date()
    const q = filters.search.toLowerCase()

    return allTasks.filter((t) => {
      const project  = projectMap[t.projectId]
      const assignee = t.assigneeUserId ? memberMap[t.assigneeUserId] : null

      if (q) {
        const haystack = [
          t.title, t.description,
          project?.name, project && projectKey(project.name),
          assignee?.displayName, assignee?.username,
          ...(t.labels || []),
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }

      if (filters.projectId   && String(t.projectId) !== filters.projectId)           return false
      if (filters.status      && normalizeStatus(t.status) !== filters.status)        return false
      if (filters.priority    && t.priority !== filters.priority)                     return false
      if (filters.issueType   && t.issueType !== filters.issueType)                   return false
      if (filters.sprintId    && String(t.sprintId) !== filters.sprintId)             return false
      if (filters.label       && !(t.labels || []).includes(filters.label))           return false

      if (filters.assigneeId) {
        if (String(t.assigneeUserId) !== filters.assigneeId) return false
      }
      if (filters.unassigned  && t.assigneeUserId)                                    return false
      if (filters.myTasks     && String(t.assigneeUserId) !== String(user?.userId))   return false
      if (filters.overdueOnly && !isOverdue(t))                                       return false
      if (filters.blockedOnly && normalizeStatus(t.status) !== 'Blocked')             return false

      return true
    })
  }, [allTasks, filters, projectMap, memberMap, user])

  // ── Sort ────────────────────────────────────────────────────────────────────
  const sortedTasks = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filteredTasks].sort((a, b) => {
      switch (sortCol) {
        case 'title':    return dir * a.title.localeCompare(b.title)
        case 'status':   return dir * normalizeStatus(a.status).localeCompare(normalizeStatus(b.status))
        case 'priority': {
          const order = { Critical: 0, High: 1, Medium: 2, Low: 3 }
          return dir * ((order[a.priority] ?? 2) - (order[b.priority] ?? 2))
        }
        case 'dueDate': {
          const da = a.dueDate ? new Date(a.dueDate) : new Date('9999-12-31')
          const db = b.dueDate ? new Date(b.dueDate) : new Date('9999-12-31')
          return dir * (da - db)
        }
        case 'points':   return dir * ((a.storyPoints ?? 0) - (b.storyPoints ?? 0))
        default: return 0
      }
    })
  }, [filteredTasks, sortCol, sortDir])

  // ── Sort handler ────────────────────────────────────────────────────────────
  function handleSort(col) {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(col); setSortDir('asc') }
  }

  // ── Inline updates ──────────────────────────────────────────────────────────
  const handleStatusChange = useCallback(async (task, newStatus) => {
    try {
      await actions.updateTask(task.projectId, task.id, { status: newStatus })
    } catch (e) {
      console.error('[TeamProjects] status update failed:', e)
    }
  }, [actions])

  const handlePriorityChange = useCallback(async (task, newPriority) => {
    try {
      await actions.updateTask(task.projectId, task.id, { priority: newPriority })
    } catch (e) {
      console.error('[TeamProjects] priority update failed:', e)
    }
  }, [actions])

  const handleAssigneeChange = useCallback(async (task, newUserId) => {
    try {
      await actions.updateTask(task.projectId, task.id, { assignee_user_id: newUserId })
    } catch (e) {
      console.error('[TeamProjects] assignee update failed:', e)
    }
  }, [actions])

  // ── Loading / error states ──────────────────────────────────────────────────
  const anyLoading = loadingProjects || Object.values(loadingTasks).some(Boolean)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="tp-page">
      {/* Header */}
      <header className="tp-header">
        <div className="tp-header__left">
          <div className="tp-header__icon-wrap" aria-hidden="true">
            <Layers2 size={20} strokeWidth={2} />
          </div>
          <div>
            <h1 className="tp-header__title">Team Planner</h1>
            <p className="tp-header__sub">
              {projects.length} project{projects.length !== 1 ? 's' : ''} · {allTasks.length} task{allTasks.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="tp-header__right">
          <ViewSwitcher view={view} onChange={setView} />
          <button
            type="button"
            className="tp-btn tp-btn--ghost"
            onClick={() => { actions.fetchProjects(); projects.forEach((p) => actions.fetchTasks(p.id)) }}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw size={14} strokeWidth={2} aria-hidden="true" className={anyLoading ? 'tp-spin' : ''} />
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="tp-error-banner" role="alert">
          <AlertCircle size={15} strokeWidth={2} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading bar */}
      {anyLoading && <div className="tp-loading-bar" role="progressbar" aria-label="Loading…" />}

      {/* Filters */}
      <TaskFiltersBar
        filters={filters}
        onChange={setFilters}
        projects={projects}
        members={members}
        sprints={allSprints}
        currentUser={user}
      />

      {/* Views */}
      {view === 'board'    && <BoardPlaceholder />}
      {view === 'calendar' && <CalendarPlaceholder />}
      {view === 'list' && (
        sortedTasks.length === 0 ? (
          <EmptyState filtered={Object.values(filters).some((v) => v !== '' && v !== false)} />
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table" aria-label="Team tasks">
              <thead>
                <tr className="tp-thead-row">
                  <th className="tp-th tp-th--type">Type</th>
                  <SortHeader label="Task"     col="title"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <th className="tp-th tp-th--project">Project</th>
                  <th className="tp-th tp-th--sprint">Sprint</th>
                  <th className="tp-th tp-th--assignee">Assignee</th>
                  <SortHeader label="Priority" col="priority" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Status"   col="status"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Due"      col="dueDate"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Pts"      col="points"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {sortedTasks.map((task) => (
                  <TaskRow
                    key={`${task.projectId}-${task.id}`}
                    task={task}
                    project={projectMap[task.projectId]}
                    sprintMap={sprintMap}
                    memberMap={memberMap}
                    onSelect={setSelectedTask}
                    onStatusChange={handleStatusChange}
                    onPriorityChange={handlePriorityChange}
                    onAssigneeChange={handleAssigneeChange}
                    isSelected={selectedTask?.id === task.id}
                    currentUserId={user?.userId}
                  />
                ))}
              </tbody>
            </table>
            <div className="tp-table-footer">
              Showing {sortedTasks.length} of {allTasks.length} task{allTasks.length !== 1 ? 's' : ''}
            </div>
          </div>
        )
      )}

      {/* Task detail placeholder */}
      <TaskDetailPlaceholder
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  )
}
