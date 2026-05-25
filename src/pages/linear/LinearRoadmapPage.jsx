/**
 * LinearRoadmapPage.jsx
 * /#/projects/linear/roadmap — Product/dev delivery roadmap.
 * Groups issues into Now / Next / Later / Ready for Release / Shipped columns.
 * Reuses IssueDetailPanel for inline editing — no new API routes.
 * Uses existing TeamProjectsContext data only.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { Map, AlertCircle, ChevronDown, X, Check } from 'lucide-react'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import { LinearSidebar }    from '../../components/linear/LinearSidebar'
import { IssueDetailPanel } from '../../components/linear/IssueDetailPanel'
import { CycleBadge }       from '../../components/linear/CycleBadge'
import {
  issueKey, normalizeStatus, normalizePriority,
  STATUS_CONFIG, PRIORITY_CONFIG,
} from '../../components/linear/IssueRow'
import { labelColors }      from '../../components/linear/linearLabels'
import './LinearRoadmapPage.css'

// ── Column definitions ────────────────────────────────────────────────────────
const COLUMNS = [
  { id: 'now',    title: 'Now',               color: '#3b82f6', desc: 'In Progress / In Review'    },
  { id: 'next',   title: 'Next',              color: '#a5b4fc', desc: 'Todo + Cycle Backlog'        },
  { id: 'later',  title: 'Later',             color: '#6b7280', desc: 'Backlog'                     },
  { id: 'ready',  title: 'Ready for Release', color: '#10b981', desc: 'Ready to ship'               },
  { id: 'shipped',title: 'Shipped',           color: '#059669', desc: 'Done'                        },
  { id: 'canceled',title: 'Canceled',         color: '#4b5563', desc: 'Canceled', hideable: true    },
]

// ── Issue → column mapping ────────────────────────────────────────────────────
function assignColumn(issue, activeCycleIds) {
  const s = normalizeStatus(issue.status)
  if (s === 'Canceled')             return 'canceled'
  if (s === 'Done')                 return 'shipped'
  if (s === 'Ready for Release' || s === 'QA Approved') return 'ready'
  if (s === 'In Progress' || s === 'In Review') return 'now'
  if (s === 'Todo')                 return 'next'
  if (s === 'Backlog') {
    return (issue.sprintId && activeCycleIds.has(issue.sprintId)) ? 'next' : 'later'
  }
  return 'later'
}

// ── Project prefix inference (mirrors LinearProjectsPage) ────────────────────
function inferPrefix(name) {
  if (!name) return ''
  const n = name.toLowerCase()
  if (n.includes('android'))                      return 'AND'
  if (n.includes('ios') || n.includes('iphone'))  return 'IOS'
  if (n.includes('ux') || n.includes('ui') || n.includes('design')) return 'UX'
  if (n.includes('backend') || n.includes('api') || n.includes('server')) return 'API'
  if (n.includes('data') || n.includes('bi') || n.includes('analytics')) return 'BI'
  if (n.includes('payment') || n.includes('checkout')) return 'PAY'
  if (n.includes('web') || n.includes('website') || n.includes('lifesmile')) return 'WEB'
  return name.slice(0, 3).toUpperCase()
}

function memberInitials(m) {
  if (!m) return '?'
  const name = m.displayName || m.username || '?'
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}

// ── Roadmap issue card ────────────────────────────────────────────────────────
function RoadmapCard({ issue, project, member, cycle, onClick }) {
  const key      = issueKey(project?.name, issue.id)
  const prefix   = inferPrefix(project?.name)
  const status   = normalizeStatus(issue.status)
  const pri      = normalizePriority(issue.priority)
  const priCfg   = PRIORITY_CONFIG[pri]
  const stCfg    = STATUS_CONFIG[status]
  const labels   = Array.isArray(issue.labels) ? issue.labels : []
  const shown    = labels.slice(0, 2)
  const extra    = labels.length - 2
  const due      = issue.dueDate ? new Date(issue.dueDate) : null
  const overdue  = due && due < new Date() && status !== 'Done'

  return (
    <button
      type="button"
      className="rdm-card"
      onClick={onClick}
      aria-label={`${key}: ${issue.title}`}
    >
      {/* Top row: key + type */}
      <div className="rdm-card__top">
        <span className="rdm-card__key">{key}</span>
        {issue.issueType && (
          <span className="rdm-card__type">{issue.issueType}</span>
        )}
      </div>

      {/* Title */}
      <div className="rdm-card__title">{issue.title || 'Untitled'}</div>

      {/* Labels */}
      {shown.length > 0 && (
        <div className="rdm-card__labels">
          {shown.map((lbl) => {
            const c = labelColors(lbl)
            return (
              <span
                key={lbl}
                className="rdm-card__label"
                style={{ background: c.bg, color: c.text, borderColor: c.border }}
              >{lbl}</span>
            )
          })}
          {extra > 0 && <span className="rdm-card__label rdm-card__label--more">+{extra}</span>}
        </div>
      )}

      {/* Bottom row: priority | project | cycle | assignee | due | QA chip */}
      <div className="rdm-card__meta">
        {priCfg && (
          <span className="rdm-card__meta-item" title={`Priority: ${pri}`} style={{ color: priCfg.color }}>
            <priCfg.Icon size={11} strokeWidth={2.5} aria-hidden="true" />
          </span>
        )}
        {prefix && (
          <span className="rdm-card__prefix">{prefix}</span>
        )}
        {cycle && (
          <CycleBadge cycle={cycle} small />
        )}
        {member ? (
          <span className="rdm-card__avatar" title={member.displayName || member.username}>
            {member.avatarUrl
              ? <img src={member.avatarUrl} alt={memberInitials(member)} className="rdm-card__avatar-img" />
              : memberInitials(member)}
          </span>
        ) : (
          <span className="rdm-card__avatar rdm-card__avatar--none" title="Unassigned">—</span>
        )}
        {due && (
          <span className={`rdm-card__due ${overdue ? 'rdm-card__due--overdue' : ''}`}>
            {due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </span>
        )}
        {issue.devMeta?.qaApproval?.approved && (
          <span className="rdm-card__qa-chip" title="QA Approved">QA ✓</span>
        )}
      </div>
    </button>
  )
}

// ── Roadmap column ────────────────────────────────────────────────────────────
function RoadmapColumn({ col, issues, projectMap, memberMap, cycleMap, onSelect }) {
  return (
    <div className="rdm-col">
      <div className="rdm-col__head">
        <span className="rdm-col__dot" style={{ background: col.color }} />
        <span className="rdm-col__title">{col.title}</span>
        <span className="rdm-col__count">{issues.length}</span>
      </div>

      <div className="rdm-col__body">
        {issues.length === 0 ? (
          <div className="rdm-col__empty">No issues here</div>
        ) : (
          issues.map((issue) => (
            <RoadmapCard
              key={`${issue.projectId}-${issue.id}`}
              issue={issue}
              project={projectMap[issue.projectId]}
              member={issue.assigneeUserId ? memberMap[String(issue.assigneeUserId)] : null}
              cycle={issue.sprintId ? cycleMap[issue.sprintId] : null}
              onClick={() => onSelect(issue)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Filter bar ────────────────────────────────────────────────────────────────
function FilterSelect({ label, value, onChange, options }) {
  return (
    <div className="rdm-filter">
      <select
        className="rdm-filter__select"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label={label}
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={11} strokeWidth={2.5} className="rdm-filter__arrow" aria-hidden="true" />
      {value != null && (
        <button
          type="button"
          className="rdm-filter__clear"
          onClick={() => onChange(null)}
          aria-label={`Clear ${label}`}
        >
          <X size={9} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function ToggleChip({ label, active, onToggle }) {
  return (
    <button
      type="button"
      className={`rdm-toggle ${active ? 'rdm-toggle--active' : ''}`}
      onClick={onToggle}
      aria-pressed={active}
    >
      {active && <Check size={10} strokeWidth={2.5} aria-hidden="true" />}
      {label}
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LinearRoadmapPage() {
  const {
    projects, members, loadingProjects, loadingTasks, error,
    getTasksForProject, getCyclesForProject, actions,
  } = useTeamProjectsContext()

  const [selectedIssue,   setSelectedIssue]   = useState(null)
  const [showCanceled,    setShowCanceled]     = useState(false)
  const [showShipped,     setShowShipped]      = useState(true)
  const [filterProject,   setFilterProject]    = useState(null)
  const [filterLabel,     setFilterLabel]      = useState(null)
  const [filterCycle,     setFilterCycle]      = useState(null)
  const [filterAssignee,  setFilterAssignee]   = useState(null)
  const [filterPriority,  setFilterPriority]   = useState(null)
  const [filterType,      setFilterType]       = useState(null)
  const didFetch = useRef(false)

  useEffect(() => {
    if (didFetch.current) return
    didFetch.current = true
    actions.fetchProjects()
    actions.fetchMembers()
  }, [actions])

  useEffect(() => {
    for (const p of projects) {
      actions.fetchTasks(p.id)
      actions.fetchCycles(p.id)
    }
  }, [projects, actions])

  // ── Derived maps ─────────────────────────────────────────────────────────
  const memberMap = useMemo(() => {
    const m = {}
    for (const mb of members) m[String(mb.id)] = mb
    return m
  }, [members])

  const projectMap = useMemo(() => {
    const m = {}
    for (const p of projects) m[p.id] = p
    return m
  }, [projects])

  const allIssues = useMemo(
    () => projects.flatMap((p) => getTasksForProject(p.id)),
    [projects, getTasksForProject]
  )

  const allCycles = useMemo(
    () => projects.flatMap((p) => getCyclesForProject(p.id)),
    [projects, getCyclesForProject]
  )

  const cycleMap = useMemo(() => {
    const m = {}
    for (const c of allCycles) m[c.id] = c
    return m
  }, [allCycles])

  const activeCycleIds = useMemo(
    () => new Set(allCycles.filter((c) => c.status === 'active').map((c) => c.id)),
    [allCycles]
  )

  // Keep selected issue fresh after updates
  useEffect(() => {
    if (!selectedIssue) return
    const fresh = allIssues.find(
      (i) => i.id === selectedIssue.id && i.projectId === selectedIssue.projectId
    )
    if (fresh) setSelectedIssue(fresh)
  }, [allIssues, selectedIssue?.id, selectedIssue?.projectId])

  // ── Filter options for dropdowns ──────────────────────────────────────────
  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: String(p.id), label: p.name })),
    [projects]
  )
  const labelOptions = useMemo(() => {
    const set = new Set()
    for (const i of allIssues) (i.labels || []).forEach((l) => set.add(l))
    return [...set].sort().map((l) => ({ value: l, label: l }))
  }, [allIssues])
  const cycleOptions = useMemo(
    () => allCycles.map((c) => ({ value: String(c.id), label: c.name })),
    [allCycles]
  )
  const assigneeOptions = useMemo(
    () => members.map((m) => ({ value: String(m.id), label: m.displayName || m.username })),
    [members]
  )
  const priorityOptions = ['Urgent', 'High', 'Medium', 'Low', 'No Priority']
    .map((p) => ({ value: p, label: p }))
  const typeOptions = useMemo(() => {
    const set = new Set()
    for (const i of allIssues) if (i.issueType) set.add(i.issueType)
    return [...set].sort().map((t) => ({ value: t, label: t }))
  }, [allIssues])

  // ── Filtered + grouped issues ─────────────────────────────────────────────
  const columnData = useMemo(() => {
    const filtered = allIssues.filter((issue) => {
      if (filterProject  && String(issue.projectId) !== filterProject)                       return false
      if (filterLabel    && !(issue.labels || []).includes(filterLabel))                     return false
      if (filterCycle    && String(issue.sprintId) !== filterCycle)                          return false
      if (filterAssignee && String(issue.assigneeUserId) !== filterAssignee)                 return false
      if (filterPriority && normalizePriority(issue.priority) !== filterPriority)            return false
      if (filterType     && issue.issueType !== filterType)                                  return false
      return true
    })

    const cols = { now: [], next: [], later: [], ready: [], shipped: [], canceled: [] }
    for (const issue of filtered) {
      const col = assignColumn(issue, activeCycleIds)
      cols[col].push(issue)
    }
    // Sort each column: urgent/high first, then by id
    for (const key of Object.keys(cols)) {
      cols[key].sort((a, b) => {
        const PA = ['Urgent','High'].includes(normalizePriority(a.priority)) ? 0 : 1
        const PB = ['Urgent','High'].includes(normalizePriority(b.priority)) ? 0 : 1
        if (PA !== PB) return PA - PB
        return a.id - b.id
      })
    }
    return cols
  }, [allIssues, filterProject, filterLabel, filterCycle, filterAssignee, filterPriority, filterType, activeCycleIds])

  // ── Visible columns ───────────────────────────────────────────────────────
  const visibleCols = useMemo(() => {
    return COLUMNS.filter((c) => {
      if (c.id === 'canceled') return showCanceled
      if (c.id === 'shipped')  return showShipped
      return true
    })
  }, [showCanceled, showShipped])

  // ── Issue update/delete ───────────────────────────────────────────────────
  const handleUpdate = useCallback(async (projectId, taskId, data) => {
    const updated = await actions.updateTask(projectId, taskId, data)
    setSelectedIssue((prev) =>
      prev?.id === taskId && prev?.projectId === projectId ? updated : prev
    )
    return updated
  }, [actions])

  const handleDelete = useCallback(async (projectId, taskId) => {
    await actions.deleteTask(projectId, taskId)
    setSelectedIssue(null)
  }, [actions])

  const anyLoading = loadingProjects || Object.values(loadingTasks).some(Boolean)

  const hasFilters = filterProject || filterLabel || filterCycle || filterAssignee || filterPriority || filterType

  return (
    <div className="rdm">
      <LinearSidebar projects={projects} />

      <main className="rdm__main">
        {/* Header */}
        <div className="rdm__header">
          <div className="rdm__header-left">
            <h1 className="rdm__title">
              <Map size={18} strokeWidth={1.8} className="rdm__title-icon" aria-hidden="true" />
              Roadmap
            </h1>
            <p className="rdm__subtitle">Plan website, app, backend, UX/UI, and BI delivery</p>
          </div>
          <div className="rdm__header-right">
            <span className="rdm__summary">
              {allIssues.filter((i) => normalizeStatus(i.status) !== 'Done' && normalizeStatus(i.status) !== 'Canceled').length} active issues
            </span>
          </div>
        </div>

        {/* Filter bar */}
        <div className="rdm__filters">
          <FilterSelect
            label="Project"
            value={filterProject}
            onChange={setFilterProject}
            options={projectOptions}
          />
          <FilterSelect
            label="Label"
            value={filterLabel}
            onChange={setFilterLabel}
            options={labelOptions}
          />
          <FilterSelect
            label="Cycle"
            value={filterCycle}
            onChange={setFilterCycle}
            options={cycleOptions}
          />
          <FilterSelect
            label="Assignee"
            value={filterAssignee}
            onChange={setFilterAssignee}
            options={assigneeOptions}
          />
          <FilterSelect
            label="Priority"
            value={filterPriority}
            onChange={setFilterPriority}
            options={priorityOptions}
          />
          {typeOptions.length > 0 && (
            <FilterSelect
              label="Type"
              value={filterType}
              onChange={setFilterType}
              options={typeOptions}
            />
          )}

          <div className="rdm__filter-sep" />

          <ToggleChip
            label="Shipped"
            active={showShipped}
            onToggle={() => setShowShipped((v) => !v)}
          />
          <ToggleChip
            label="Canceled"
            active={showCanceled}
            onToggle={() => setShowCanceled((v) => !v)}
          />

          {hasFilters && (
            <button
              type="button"
              className="rdm__clear-btn"
              onClick={() => {
                setFilterProject(null); setFilterLabel(null);
                setFilterCycle(null);   setFilterAssignee(null);
                setFilterPriority(null); setFilterType(null);
              }}
            >
              <X size={11} strokeWidth={2.5} aria-hidden="true" />
              Clear
            </button>
          )}
        </div>

        {anyLoading && <div className="rdm__loading-bar" role="progressbar" aria-label="Loading…" />}
        {error && (
          <div className="rdm__error" role="alert">
            <AlertCircle size={14} strokeWidth={2} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Roadmap board */}
        <div className="rdm__board">
          {visibleCols.map((col) => (
            <RoadmapColumn
              key={col.id}
              col={col}
              issues={columnData[col.id] || []}
              projectMap={projectMap}
              memberMap={memberMap}
              cycleMap={cycleMap}
              onSelect={setSelectedIssue}
            />
          ))}
        </div>
      </main>

      {/* Detail panel — reused from Issues page */}
      <IssueDetailPanel
        open={Boolean(selectedIssue)}
        issue={selectedIssue}
        project={selectedIssue ? projectMap[selectedIssue.projectId] : null}
        members={members}
        cycles={selectedIssue ? getCyclesForProject(selectedIssue.projectId) : allCycles}
        onClose={() => setSelectedIssue(null)}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  )
}
