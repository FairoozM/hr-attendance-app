/**
 * IssueRow.jsx
 * A compact, Linear-style single issue row.
 * Used inside IssueListGroup.
 *
 * Data note: the server calls these "tasks" internally.
 * The UI calls them "issues". No backend field is renamed here.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Circle, CheckCircle2, Clock, AlertCircle, XCircle,
  GitPullRequest, Rocket, Minus, ArrowUp, ArrowDown, ChevronsUp,
  UserCircle2, CalendarDays,
  Bug, Zap, Pen, Gauge, Layers, Package, FileText, Plug,
} from 'lucide-react'
import './IssueRow.css'

// ── Status config ─────────────────────────────────────────────────────────────
export const STATUS_CONFIG = {
  Backlog:              { Icon: Circle,        color: '#6b7280', label: 'Backlog'            },
  Todo:                 { Icon: Circle,        color: '#94a3b8', label: 'Todo'               },
  'In Progress':        { Icon: Clock,         color: '#3b82f6', label: 'In Progress'        },
  'In Review':          { Icon: GitPullRequest, color: '#8b5cf6', label: 'In Review'         },
  'Ready for Release':  { Icon: Rocket,        color: '#10b981', label: 'Ready for Release'  },
  Done:                 { Icon: CheckCircle2,  color: '#059669', label: 'Done'               },
  Canceled:             { Icon: XCircle,       color: '#4b5563', label: 'Canceled'           },
}

// Normalise legacy and variant status strings → canonical Linear status
export function normalizeStatus(raw) {
  if (!raw) return 'Backlog'
  const s = String(raw).toLowerCase().trim()
  if (s === 'todo' || s === 'to do' || s === 'to-do')                                   return 'Todo'
  if (s === 'in_progress' || s === 'in progress' || s === 'inprogress')                 return 'In Progress'
  if (s === 'in_review'   || s === 'in review'   || s === 'inreview')                   return 'In Review'
  if (s === 'ready for release' || s === 'ready_for_release' || s === 'release ready'
      || s === 'readyforrelease' || s === 'ready')                                       return 'Ready for Release'
  if (s === 'done' || s === 'completed')                                                 return 'Done'
  if (s === 'canceled' || s === 'cancelled')                                             return 'Canceled'
  if (s === 'backlog')                                                                   return 'Backlog'
  return 'Backlog'
}

// ── Priority config ───────────────────────────────────────────────────────────
export const PRIORITY_CONFIG = {
  'No Priority': { Icon: Minus,      color: '#6b7280', label: 'No Priority' },
  Urgent:        { Icon: ChevronsUp, color: '#ef4444', label: 'Urgent'      },
  High:          { Icon: ArrowUp,    color: '#f97316', label: 'High'        },
  Medium:        { Icon: Minus,      color: '#f59e0b', label: 'Medium'      },
  Low:           { Icon: ArrowDown,  color: '#3b82f6', label: 'Low'         },
}

// Normalise legacy priority strings
export function normalizePriority(raw) {
  if (!raw) return 'No Priority'
  const s = String(raw).toLowerCase().trim()
  if (s === 'critical' || s === 'urgent') return 'Urgent'
  if (s === 'high')   return 'High'
  if (s === 'medium') return 'Medium'
  if (s === 'low')    return 'Low'
  return 'No Priority'
}

/** Generate a Linear-style issue key from project/team name + issue id */
export function issueKey(projectName, id) {
  if (!projectName) return `ISS-${id}`
  const lower = String(projectName).toLowerCase()
  let code

  // Product engineering team keyword matching (order matters — more specific first)
  if (lower.includes('android') || lower.includes(' and ') || lower === 'and') code = 'AND'
  else if (lower.includes('ios') || lower.includes('iphone') || lower.includes('apple')) code = 'IOS'
  else if (lower.includes('ux') || lower.includes('ui') || lower.includes('design')) code = 'UX'
  else if (lower.includes('backend') || lower.includes('api') || lower.includes('server')) code = 'API'
  else if (lower.includes('data') || lower.includes(' bi') || lower === 'bi' || lower.includes('analytics')) code = 'BI'
  else if (lower.includes('website') || lower.includes('web') || lower.includes('www')) code = 'WEB'
  else if (lower.includes('mobile') || lower.includes('app')) code = 'APP'
  else if (lower.includes('amazon') || lower.includes('amz')) code = 'AMZ'
  else if (lower.includes('finance') || lower.includes('fin')) code = 'FIN'
  else if (lower.includes('ops') || lower.includes('operations')) code = 'OPS'
  else {
    const words = String(projectName).trim().split(/\s+/).filter(Boolean)
    if (words.length === 1) code = words[0].slice(0, 3).toUpperCase()
    else code = words.slice(0, 3).map((w) => w[0].toUpperCase()).join('')
  }

  return `${code}-${id}`
}

// ── Issue type config (subtle — icon only in row) ────────────────────────────
export const ISSUE_TYPE_CONFIG = {
  bug:         { Icon: Bug,      color: '#f87171', label: 'Bug'         },
  feature:     { Icon: Zap,      color: '#a78bfa', label: 'Feature'     },
  'ux/ui':     { Icon: Pen,      color: '#f472b6', label: 'UX/UI'       },
  performance: { Icon: Gauge,    color: '#fb923c', label: 'Performance'  },
  scalability: { Icon: Layers,   color: '#818cf8', label: 'Scalability'  },
  release:     { Icon: Rocket,   color: '#34d399', label: 'Release'      },
  content:     { Icon: FileText, color: '#94a3b8', label: 'Content'      },
  integration: { Icon: Plug,     color: '#fbbf24', label: 'Integration'  },
  task:        { Icon: Circle,   color: '#6b7280', label: 'Task'         },
}

function initialsFromName(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')
}
function hue(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff
  return Math.abs(h) % 360
}

function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d)) return null
  const now = new Date()
  const isOverdue = d < now
  const label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return { label, isOverdue }
}

// ── Floating picker (shared by status / priority) ─────────────────────────────
function FloatingPicker({ anchorEl, options, currentValue, onSelect, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!anchorEl) return
    const r = anchorEl.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left })
  }, [anchorEl])

  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target) && !anchorEl?.contains(e.target)) onClose()
    }
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('mousedown', handle); document.removeEventListener('keydown', handleKey) }
  }, [anchorEl, onClose])

  return createPortal(
    <ul
      ref={ref}
      className="ir-picker"
      style={{ top: pos.top, left: pos.left }}
      role="listbox"
    >
      {options.map(({ value, label, Icon, color }) => (
        <li
          key={value}
          role="option"
          aria-selected={value === currentValue}
          className={`ir-picker__item ${value === currentValue ? 'ir-picker__item--active' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(value); onClose() }}
        >
          <Icon size={13} strokeWidth={2} style={{ color }} aria-hidden="true" />
          <span>{label}</span>
        </li>
      ))}
    </ul>,
    document.body
  )
}

// ── IssueRow ──────────────────────────────────────────────────────────────────
export function IssueRow({
  issue,
  project,
  member,
  onSelect,
  onStatusChange,
  onPriorityChange,
  isSelected,
}) {
  const [statusPicker,   setStatusPicker]   = useState(false)
  const [priorityPicker, setPriorityPicker] = useState(false)
  const statusRef   = useRef(null)
  const priorityRef = useRef(null)

  const status   = normalizeStatus(issue.status)
  const priority = normalizePriority(issue.priority)
  const statusCfg   = STATUS_CONFIG[status]   || STATUS_CONFIG.Backlog
  const priorityCfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG['No Priority']
  // Subtle issue type icon (shown only when issue_type is set and not 'task')
  const typeKey  = String(issue.issueType || issue.issue_type || 'task').toLowerCase()
  const typeCfg  = typeKey !== 'task' ? (ISSUE_TYPE_CONFIG[typeKey] || null) : null
  const key = issueKey(project?.name, issue.id)
  const due = fmtDate(issue.dueDate)
  const assigneeName = member?.displayName || member?.username || ''

  const statusOptions   = Object.entries(STATUS_CONFIG).map(([value, c]) => ({ value, ...c }))
  const priorityOptions = Object.entries(PRIORITY_CONFIG).map(([value, c]) => ({ value, ...c }))

  const handleStatusClick = useCallback((e) => {
    e.stopPropagation()
    setStatusPicker((v) => !v)
    setPriorityPicker(false)
  }, [])

  const handlePriorityClick = useCallback((e) => {
    e.stopPropagation()
    setPriorityPicker((v) => !v)
    setStatusPicker(false)
  }, [])

  return (
    <>
      <div
        className={`ir ${isSelected ? 'ir--selected' : ''}`}
        onClick={() => onSelect(issue)}
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(issue)}
        role="row"
        aria-selected={isSelected}
      >
        {/* Status dot */}
        <button
          ref={statusRef}
          type="button"
          className="ir__status-btn"
          onClick={handleStatusClick}
          title={statusCfg.label}
          aria-label={`Status: ${statusCfg.label}`}
        >
          <statusCfg.Icon
            size={15}
            strokeWidth={status === 'Done' ? 2.2 : 1.8}
            style={{ color: statusCfg.color }}
            aria-hidden="true"
          />
        </button>

        {/* Issue key */}
        <span className="ir__key" title={key}>{key}</span>

        {/* Subtle issue type icon (non-task types only) */}
        {typeCfg && (
          <typeCfg.Icon
            size={11}
            strokeWidth={2}
            style={{ color: typeCfg.color, flexShrink: 0, opacity: 0.75 }}
            title={typeCfg.label}
            aria-label={typeCfg.label}
          />
        )}

        {/* Title */}
        <span className="ir__title">{issue.title || '(Untitled)'}</span>

        {/* Spacer */}
        <span className="ir__spacer" />

        {/* Labels */}
        {issue.labels?.length > 0 && (
          <span className="ir__labels">
            {issue.labels.slice(0, 2).map((lbl) => (
              <span key={lbl} className="ir__label">{lbl}</span>
            ))}
          </span>
        )}

        {/* Project chip */}
        {project && (
          <span
            className="ir__project"
            style={{ '--proj-color': project.color || '#8b5cf6' }}
            title={project.name}
          >
            {issueKey(project.name, '').replace(/-$/, '')}
          </span>
        )}

        {/* Due date */}
        {due && (
          <span className={`ir__due ${due.isOverdue ? 'ir__due--overdue' : ''}`} title="Due date">
            <CalendarDays size={11} strokeWidth={2} aria-hidden="true" />
            {due.label}
          </span>
        )}

        {/* Assignee */}
        <span className="ir__assignee" title={assigneeName || 'Unassigned'}>
          {member ? (
            <span className="ir__avatar" style={{ '--av-hue': hue(assigneeName) }}>
              {initialsFromName(assigneeName) || '?'}
            </span>
          ) : (
            <UserCircle2 size={18} strokeWidth={1.4} className="ir__avatar--empty" aria-hidden="true" />
          )}
        </span>

        {/* Priority */}
        <button
          ref={priorityRef}
          type="button"
          className="ir__priority-btn"
          onClick={handlePriorityClick}
          title={`Priority: ${priorityCfg.label}`}
          aria-label={`Priority: ${priorityCfg.label}`}
        >
          <priorityCfg.Icon
            size={13}
            strokeWidth={2.2}
            style={{ color: priorityCfg.color }}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Status picker */}
      {statusPicker && (
        <FloatingPicker
          anchorEl={statusRef.current}
          options={statusOptions}
          currentValue={status}
          onSelect={(v) => onStatusChange(issue, v)}
          onClose={() => setStatusPicker(false)}
        />
      )}

      {/* Priority picker */}
      {priorityPicker && (
        <FloatingPicker
          anchorEl={priorityRef.current}
          options={priorityOptions}
          currentValue={priority}
          onSelect={(v) => onPriorityChange(issue, v)}
          onClose={() => setPriorityPicker(false)}
        />
      )}
    </>
  )
}

export default IssueRow
