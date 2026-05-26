/**
 * LinearWorkloadPage.jsx
 * /#/projects/linear/workload — Team capacity and assigned work overview.
 * Summary cards + per-member workload rows + unassigned section.
 * Frontend-only, uses existing TeamProjectsContext data.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart2, AlertCircle, ChevronDown, X, Check, AlertTriangle } from 'lucide-react'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import { LinearSidebar }    from '../../components/linear/LinearSidebar'
import { IssueDetailPanel } from '../../components/linear/IssueDetailPanel'
import { normalizeStatus, normalizePriority } from '../../components/linear/IssueRow'
import { labelColors } from '../../components/linear/linearLabels'
import './LinearWorkloadPage.css'

// ── Constants ─────────────────────────────────────────────────────────────────
const WORKLOAD_CAP   = 12
const OPEN_STATUSES  = new Set(['Backlog','Todo','In Progress','In Review','Ready for Release'])

function isOpen(i)     { return OPEN_STATUSES.has(normalizeStatus(i.status)) }
function isActive(i)   { return ['In Progress','In Review'].includes(normalizeStatus(i.status)) }
function isReady(i)    { return normalizeStatus(i.status) === 'Ready for Release' }
function isHighPri(i)  { return ['Urgent','High'].includes(normalizePriority(i.priority)) }
function isDone(i)     { return normalizeStatus(i.status) === 'Done' }
function isCanceled(i) { return normalizeStatus(i.status) === 'Canceled' }

function memberInitials(m) {
  const name = m.displayName || m.username || '?'
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}

function roleLabel(m) {
  return m.designation || (m.plannerRole !== 'view' ? m.plannerRole : null) || (m.role !== 'employee' ? m.role : null) || null
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, color, onClick }) {
  return (
    <button
      type="button"
      className={`wld-summary ${onClick ? 'wld-summary--clickable' : ''}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <span className="wld-summary__value" style={{ color }}>{value}</span>
      <span className="wld-summary__label">{label}</span>
      {sub != null && <span className="wld-summary__sub">{sub}</span>}
    </button>
  )
}

function CapacityBar({ open, pts }) {
  const pct   = Math.min(100, Math.round((open / WORKLOAD_CAP) * 100))
  const color = pct >= 85 ? '#ef4444' : pct >= 60 ? '#f97316' : '#6366f1'
  const label = pct >= 85 ? 'Overloaded' : pct >= 60 ? 'Near capacity' : 'OK'
  return (
    <div className="wld-bar">
      <div className="wld-bar__track">
        <div className="wld-bar__fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="wld-bar__label" style={{ color }}>{pct}%{pts > 0 ? ` · ${pts} pts` : ''}</span>
      <span className="wld-bar__status" style={{ color }}>{label}</span>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div className="wld-filter">
      <select
        className="wld-filter__select"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label={label}
      >
        <option value="">{label}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={11} strokeWidth={2.5} className="wld-filter__arrow" aria-hidden="true" />
      {value != null && (
        <button type="button" className="wld-filter__clear" onClick={() => onChange(null)} aria-label={`Clear ${label}`}>
          <X size={9} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function ToggleChip({ label, active, onToggle }) {
  return (
    <button type="button" className={`wld-toggle ${active ? 'wld-toggle--active' : ''}`} onClick={onToggle} aria-pressed={active}>
      {active && <Check size={10} strokeWidth={2.5} aria-hidden="true" />}
      {label}
    </button>
  )
}

// ── Issue mini row (unassigned section) ───────────────────────────────────────
function IssueRow({ issue, projectMap, onClick }) {
  const status  = normalizeStatus(issue.status)
  const pri     = normalizePriority(issue.priority)
  const project = projectMap[issue.projectId]
  const labels  = (issue.labels || []).slice(0, 2)
  return (
    <button type="button" className="wld-issue" onClick={() => onClick(issue)} aria-label={issue.title}>
      <span className={`wld-issue__dot wld-issue__dot--${status.toLowerCase().replace(/\s+/g,'-')}`} />
      <span className="wld-issue__title">{issue.title || 'Untitled'}</span>
      {project && <span className="wld-issue__proj">{project.name}</span>}
      {labels.map((l) => {
        const c = labelColors(l)
        return <span key={l} className="wld-issue__label" style={{ background: c.bg, color: c.text, borderColor: c.border }}>{l}</span>
      })}
      <span className={`wld-issue__pri ${isHighPri(issue) ? 'wld-issue__pri--high' : ''}`}>{pri}</span>
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LinearWorkloadPage() {
  const navigate = useNavigate()
  const {
    projects, members, loadingProjects, loadingMembers, loadingTasks, error,
    getTasksForProject, getCyclesForProject, actions,
  } = useTeamProjectsContext()

  const [selectedIssue,   setSelectedIssue]   = useState(null)
  const [filterProject,   setFilterProject]    = useState(null)
  const [filterCycle,     setFilterCycle]      = useState(null)
  const [filterLabel,     setFilterLabel]      = useState(null)
  const [filterPriority,  setFilterPriority]   = useState(null)
  const [filterType,      setFilterType]       = useState(null)
  const [includeDone,     setIncludeDone]      = useState(false)
  const [includeCanceled, setIncludeCanceled]  = useState(false)
  const didFetch = useRef(false)

  useEffect(() => {
    if (didFetch.current) return
    didFetch.current = true
    actions.fetchProjects()
    actions.fetchMembers()
  }, [actions])

  useEffect(() => {
    for (const p of projects) { actions.fetchTasks(p.id); actions.fetchCycles(p.id) }
  }, [projects, actions])

  // ── Maps ────────────────────────────────────────────────────────────────────
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

  const activeCycleIds = useMemo(
    () => new Set(allCycles.filter((c) => c.status === 'active').map((c) => c.id)),
    [allCycles]
  )

  // Keep selected issue fresh
  useEffect(() => {
    if (!selectedIssue) return
    const fresh = allIssues.find((i) => i.id === selectedIssue.id && i.projectId === selectedIssue.projectId)
    if (fresh) setSelectedIssue(fresh)
  }, [allIssues, selectedIssue?.id, selectedIssue?.projectId])

  // ── Filtered issue pool ──────────────────────────────────────────────────────
  const filteredIssues = useMemo(() => {
    return allIssues.filter((i) => {
      if (!includeDone     && isDone(i))     return false
      if (!includeCanceled && isCanceled(i)) return false
      if (filterProject  && String(i.projectId) !== filterProject)       return false
      if (filterCycle    && String(i.sprintId)   !== filterCycle)         return false
      if (filterLabel    && !(i.labels || []).includes(filterLabel))      return false
      if (filterPriority && normalizePriority(i.priority) !== filterPriority) return false
      if (filterType     && i.issueType !== filterType)                   return false
      return true
    })
  }, [allIssues, includeDone, includeCanceled, filterProject, filterCycle, filterLabel, filterPriority, filterType])

  // ── Summary stats ────────────────────────────────────────────────────────────
  const summary = useMemo(() => ({
    open:       filteredIssues.filter(isOpen).length,
    inProgress: filteredIssues.filter(isActive).length,
    inReview:   filteredIssues.filter((i) => normalizeStatus(i.status) === 'In Review').length,
    ready:      filteredIssues.filter(isReady).length,
    unassigned: filteredIssues.filter((i) => !i.assigneeUserId && isOpen(i)).length,
    highPri:    filteredIssues.filter((i) => isOpen(i) && isHighPri(i)).length,
  }), [filteredIssues])

  // ── Per-member stats ─────────────────────────────────────────────────────────
  const memberRows = useMemo(() => {
    const statsByMember = {}
    members.forEach((member) => {
      statsByMember[String(member.id)] = {
        open: 0,
        inProgress: 0,
        inReview: 0,
        ready: 0,
        highPri: 0,
        inCycle: 0,
        storyPts: 0,
      }
    })

    filteredIssues.forEach((issue) => {
      const memberId = issue.assigneeUserId == null ? null : String(issue.assigneeUserId)
      if (!memberId || !statsByMember[memberId]) return

      const status = normalizeStatus(issue.status)
      const open = isOpen(issue)
      const stats = statsByMember[memberId]

      if (open) {
        stats.open += 1
        stats.storyPts += Number(issue.storyPoints) || 0
        if (isHighPri(issue)) stats.highPri += 1
        if (activeCycleIds.has(issue.sprintId)) stats.inCycle += 1
      }
      if (status === 'In Progress') stats.inProgress += 1
      if (status === 'In Review') stats.inReview += 1
      if (status === 'Ready for Release') stats.ready += 1
    })

    return members
      .map((member) => ({ member, ...(statsByMember[String(member.id)] || {}) }))
      .sort((a, b) => b.open - a.open)
  }, [members, filteredIssues, activeCycleIds])

  const overloadedCount = memberRows.filter((r) => r.open >= Math.round(WORKLOAD_CAP * 0.85)).length

  // ── Unassigned top issues ────────────────────────────────────────────────────
  const unassignedTop = useMemo(() => {
    return filteredIssues
      .filter((i) => !i.assigneeUserId && isOpen(i))
      .sort((a, b) => {
        const pa = ['Urgent','High'].includes(normalizePriority(a.priority)) ? 0 : 1
        const pb = ['Urgent','High'].includes(normalizePriority(b.priority)) ? 0 : 1
        return pa - pb
      })
      .slice(0, 5)
  }, [filteredIssues])

  // ── Filter options ───────────────────────────────────────────────────────────
  const projectOptions  = projects.map((p) => ({ value: String(p.id), label: p.name }))
  const cycleOptions    = allCycles.map((c) => ({ value: String(c.id), label: c.name }))
  const labelOptions    = useMemo(() => {
    const s = new Set(); for (const i of allIssues) (i.labels||[]).forEach((l) => s.add(l))
    return [...s].sort().map((l) => ({ value: l, label: l }))
  }, [allIssues])
  const priorityOptions = ['Urgent','High','Medium','Low','No Priority'].map((p) => ({ value: p, label: p }))
  const typeOptions     = useMemo(() => {
    const s = new Set(); for (const i of allIssues) if (i.issueType) s.add(i.issueType)
    return [...s].sort().map((t) => ({ value: t, label: t }))
  }, [allIssues])

  const hasFilters = filterProject || filterCycle || filterLabel || filterPriority || filterType
  const clearFilters = () => { setFilterProject(null); setFilterCycle(null); setFilterLabel(null); setFilterPriority(null); setFilterType(null) }

  // ── Issue update ─────────────────────────────────────────────────────────────
  const handleUpdate = useCallback(async (projectId, taskId, data) => {
    const updated = await actions.updateTask(projectId, taskId, data)
    setSelectedIssue((prev) => prev?.id === taskId && prev?.projectId === projectId ? updated : prev)
    return updated
  }, [actions])

  const handleDelete = useCallback(async (projectId, taskId) => {
    await actions.deleteTask(projectId, taskId)
    setSelectedIssue(null)
  }, [actions])

  const anyLoading = loadingProjects || loadingMembers || Object.values(loadingTasks).some(Boolean)

  return (
    <div className="wld">
      <LinearSidebar projects={projects} />

      <main className="wld__main">
        {/* Header */}
        <div className="wld__header">
          <div>
            <h1 className="wld__title">
              <BarChart2 size={18} strokeWidth={1.8} className="wld__title-icon" aria-hidden="true" />
              Workload
            </h1>
            <p className="wld__subtitle">Team capacity across product and development work</p>
          </div>
          <div className="wld__header-right">
            {overloadedCount > 0 && (
              <span className="wld__overload-badge">
                <AlertTriangle size={11} strokeWidth={2.5} aria-hidden="true" />
                {overloadedCount} overloaded
              </span>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="wld__filters">
          <FilterSelect label="Project"  value={filterProject}  onChange={setFilterProject}  options={projectOptions} />
          <FilterSelect label="Cycle"    value={filterCycle}    onChange={setFilterCycle}    options={cycleOptions} />
          <FilterSelect label="Label"    value={filterLabel}    onChange={setFilterLabel}    options={labelOptions} />
          <FilterSelect label="Priority" value={filterPriority} onChange={setFilterPriority} options={priorityOptions} />
          {typeOptions.length > 0 && (
            <FilterSelect label="Type" value={filterType} onChange={setFilterType} options={typeOptions} />
          )}
          <div className="wld__filter-sep" />
          <ToggleChip label="Done"     active={includeDone}     onToggle={() => setIncludeDone((v) => !v)} />
          <ToggleChip label="Canceled" active={includeCanceled} onToggle={() => setIncludeCanceled((v) => !v)} />
          {hasFilters && (
            <button type="button" className="wld__clear-btn" onClick={clearFilters}>
              <X size={11} strokeWidth={2.5} aria-hidden="true" />
              Clear
            </button>
          )}
        </div>

        {anyLoading && <div className="wld__loading-bar" role="progressbar" aria-label="Loading…" />}
        {error && (
          <div className="wld__error" role="alert">
            <AlertCircle size={14} strokeWidth={2} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="wld__content">
          {/* Summary cards */}
          <div className="wld__summary-grid">
            <SummaryCard label="Open Issues"        value={summary.open}       color="#e2e8f0" />
            <SummaryCard label="In Progress"        value={summary.inProgress} color="#3b82f6" />
            <SummaryCard label="In Review"          value={summary.inReview}   color="#8b5cf6" />
            <SummaryCard label="Ready for Release"  value={summary.ready}      color="#10b981" />
            <SummaryCard label="Unassigned"         value={summary.unassigned} color="#f59e0b"
              onClick={summary.unassigned > 0 ? () => navigate('/projects/linear', { state: { filterAssigneeId: 'unassigned' } }) : undefined} />
            <SummaryCard label="High / Urgent"      value={summary.highPri}    color="#ef4444" />
          </div>

          {/* Member workload table */}
          <section className="wld__section">
            <h2 className="wld__section-title">Member Workload</h2>
            {memberRows.length === 0 ? (
              <p className="wld__empty">No team members found.</p>
            ) : (
              <div className="wld__table">
                {/* Table header */}
                <div className="wld__row wld__row--head">
                  <span className="wld__cell wld__cell--member">Member</span>
                  <span className="wld__cell wld__cell--num">Open</span>
                  <span className="wld__cell wld__cell--num">In Prog</span>
                  <span className="wld__cell wld__cell--num">In Review</span>
                  <span className="wld__cell wld__cell--num">Ready</span>
                  <span className="wld__cell wld__cell--num">High Pri</span>
                  <span className="wld__cell wld__cell--num">In Cycle</span>
                  <span className="wld__cell wld__cell--bar">Capacity</span>
                </div>

                {/* Member rows */}
                {memberRows.map(({ member, open, inProgress, inReview, ready, highPri, inCycle, storyPts }) => {
                  const pct = Math.min(100, Math.round((open / WORKLOAD_CAP) * 100))
                  const barColor = pct >= 85 ? '#ef4444' : pct >= 60 ? '#f97316' : '#6366f1'
                  return (
                    <button
                      key={member.id}
                      type="button"
                      className="wld__row wld__row--member"
                      onClick={() => navigate('/projects/linear', { state: { filterAssigneeId: member.id } })}
                      aria-label={`Open ${member.displayName || member.username}'s issues`}
                    >
                      <span className="wld__cell wld__cell--member">
                        {member.avatarUrl
                          ? <img src={member.avatarUrl} alt={memberInitials(member)} className="wld__avatar wld__avatar--img" />
                          : <span className="wld__avatar">{memberInitials(member)}</span>}
                        <span className="wld__member-info">
                          <span className="wld__member-name">{member.displayName || member.username}</span>
                          {roleLabel(member) && <span className="wld__member-role">{roleLabel(member)}</span>}
                        </span>
                      </span>
                      <span className="wld__cell wld__cell--num wld__num--open">{open}</span>
                      <span className="wld__cell wld__cell--num" style={{ color: '#3b82f6' }}>{inProgress}</span>
                      <span className="wld__cell wld__cell--num" style={{ color: '#8b5cf6' }}>{inReview}</span>
                      <span className="wld__cell wld__cell--num" style={{ color: '#10b981' }}>{ready}</span>
                      <span className="wld__cell wld__cell--num" style={{ color: highPri > 0 ? '#f97316' : undefined }}>{highPri}</span>
                      <span className="wld__cell wld__cell--num" style={{ color: '#a5b4fc' }}>{inCycle}</span>
                      <span className="wld__cell wld__cell--bar">
                        <CapacityBar open={open} pts={storyPts} />
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* Unassigned work */}
          {summary.unassigned > 0 && (
            <section className="wld__section">
              <div className="wld__section-head">
                <h2 className="wld__section-title">Unassigned Work</h2>
                <span className="wld__section-badge">{summary.unassigned} open</span>
                <button
                  type="button"
                  className="wld__section-link"
                  onClick={() => navigate('/projects/linear', { state: { filterAssigneeId: 'unassigned' } })}
                >
                  View all →
                </button>
              </div>
              <div className="wld__unassigned-list">
                {unassignedTop.map((issue) => (
                  <IssueRow
                    key={`${issue.projectId}-${issue.id}`}
                    issue={issue}
                    projectMap={projectMap}
                    onClick={setSelectedIssue}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Detail panel */}
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
