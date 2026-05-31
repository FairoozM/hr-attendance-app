/**
 * LinearInboxPage.jsx
 * /#/projects/linear/inbox — Attention items derived from existing issue data.
 * Frontend-only. Dismissed items stored in localStorage.
 * Uses TeamProjectsContext + AuthContext — no new API routes or migrations.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Inbox, AlertCircle, ChevronDown, X, Check, Eye, EyeOff, Trash2 } from 'lucide-react'
import { useUrlSearchParamState } from '../../hooks/useUrlSearchParamState'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import { useAuth }               from '../../contexts/AuthContext'
import { LinearSidebar }         from '../../components/linear/LinearSidebar'
import { IssueDetailPanel }      from '../../components/linear/IssueDetailPanel'
import { CycleBadge }            from '../../components/linear/CycleBadge'
import {
  issueKey, normalizeStatus, normalizePriority,
  STATUS_CONFIG, PRIORITY_CONFIG,
} from '../../components/linear/IssueRow'
import { labelColors } from '../../components/linear/linearLabels'
import { issueNeedsSop } from '../../lib/linearChecklistCompliance'
import './LinearInboxPage.css'

// ── LocalStorage ──────────────────────────────────────────────────────────────
const DISMISSED_KEY = 'lifesmile.linear.inbox.dismissed.v1'
function loadDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')) }
  catch { return new Set() }
}
function saveDismissed(set) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set])) } catch {}
}
function itemId(issue) { return `${issue.projectId}-${issue.id}` }

// ── Reason definitions ────────────────────────────────────────────────────────
const REASONS = [
  { id: 'blocked',    label: 'Blocked',                  color: '#ef4444' },
  { id: 'overdue',    label: 'Overdue',                   color: '#f97316' },
  { id: 'assigned',   label: 'Assigned to you',           color: '#6366f1' },
  { id: 'review',     label: 'Needs Review',              color: '#8b5cf6' },
  { id: 'needs_qa',   label: 'Needs QA',                  color: '#0891b2' },
  { id: 'sop_needed', label: 'SOP Needed',                color: '#7c3aed' },
  { id: 'ready',      label: 'Ready for Release',         color: '#10b981' },
  { id: 'highpri',    label: 'High Priority',             color: '#f59e0b' },
  { id: 'unassigned', label: 'Unassigned High Pri',       color: '#94a3b8' },
]
const REASON_MAP = Object.fromEntries(REASONS.map((r) => [r.id, r]))

function classifyIssue(issue, currentUserId, today, projectsMap) {
  const status = normalizeStatus(issue.status)
  const pri    = normalizePriority(issue.priority)
  // Skip done/canceled
  if (status === 'Done' || status === 'Canceled') return null

  // Priority order: Blocked > Overdue > Assigned > Review > SOP Needed > Needs QA > Ready > HighPri > Unassigned
  if (issue.blockedReason)                                                        return 'blocked'
  if (issue.dueDate && new Date(issue.dueDate) < today)                          return 'overdue'
  if (currentUserId && String(issue.assigneeUserId) === String(currentUserId))   return 'assigned'
  if (status === 'In Review')                                                     return 'review'
  // SOP Needed: ready-for-release with incomplete checklist
  if ((status === 'Ready for Release' || status === 'QA Approved') &&
      issueNeedsSop(issue, projectsMap?.[issue.projectId]))                       return 'sop_needed'
  if (status === 'Ready for Release' && !issue.devMeta?.qaApproval?.approved)    return 'needs_qa'
  if (status === 'Ready for Release' || status === 'QA Approved')                return 'ready'
  if (['Urgent','High'].includes(pri))                                            return 'highpri'
  if (!issue.assigneeUserId && ['Urgent','High'].includes(pri))                  return 'unassigned'
  return null
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function inferPrefix(name) {
  if (!name) return ''
  const n = name.toLowerCase()
  if (n.includes('android'))                                                      return 'AND'
  if (n.includes('ios') || n.includes('iphone'))                                 return 'IOS'
  if (n.includes('ux') || n.includes('ui') || n.includes('design'))             return 'UX'
  if (n.includes('backend') || n.includes('api') || n.includes('server'))       return 'API'
  if (n.includes('data') || n.includes('bi') || n.includes('analytics'))        return 'BI'
  if (n.includes('payment') || n.includes('checkout'))                           return 'PAY'
  return 'WEB'
}
function memberInitials(m) {
  if (!m) return '?'
  const name = m.displayName || m.username || '?'
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}

// ── Filter select ─────────────────────────────────────────────────────────────
function FilterSelect({ label, value, onChange, options }) {
  return (
    <div className="ibx-filter">
      <select
        className="ibx-filter__select"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label={label}
      >
        <option value="">{label}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={11} strokeWidth={2.5} className="ibx-filter__arrow" aria-hidden="true" />
      {value != null && (
        <button type="button" className="ibx-filter__clear" onClick={() => onChange(null)} aria-label={`Clear ${label}`}>
          <X size={9} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

// ── Inbox item row ────────────────────────────────────────────────────────────
function InboxRow({ item, projectMap, memberMap, cycleMap, dismissed, onSelect, onDismiss, onRestore }) {
  const { issue, reason } = item
  const reasonCfg = REASON_MAP[reason]
  const project   = projectMap[issue.projectId]
  const member    = issue.assigneeUserId ? memberMap[String(issue.assigneeUserId)] : null
  const cycle     = issue.sprintId ? cycleMap[issue.sprintId] : null
  const key       = issueKey(project?.name, issue.id)
  const status    = normalizeStatus(issue.status)
  const stCfg     = STATUS_CONFIG[status]
  const pri       = normalizePriority(issue.priority)
  const priCfg    = PRIORITY_CONFIG[pri]
  const labels    = (issue.labels || []).slice(0, 2)
  const extra     = (issue.labels || []).length - 2
  const due       = issue.dueDate ? new Date(issue.dueDate) : null
  const overdue   = due && due < new Date()

  return (
    <div className={`ibx-row ${dismissed ? 'ibx-row--dismissed' : ''}`}>
      {/* Reason badge */}
      <span
        className="ibx-row__reason"
        style={{ background: reasonCfg.color + '22', color: reasonCfg.color, borderColor: reasonCfg.color + '44' }}
      >
        {reasonCfg.label}
      </span>

      {/* Main content (clickable) */}
      <button type="button" className="ibx-row__body" onClick={() => onSelect(issue)} aria-label={`Open: ${issue.title}`}>
        <span className="ibx-row__key">{key}</span>
        <span className="ibx-row__title">{issue.title || 'Untitled'}</span>

        <span className="ibx-row__meta">
          {/* Status */}
          {stCfg && (
            <span className="ibx-row__meta-chip" style={{ color: stCfg.color }}>
              <stCfg.Icon size={11} strokeWidth={2} aria-hidden="true" />
              <span>{status}</span>
            </span>
          )}
          {/* Priority */}
          {priCfg && <span className="ibx-row__meta-chip" style={{ color: priCfg.color }}><priCfg.Icon size={11} strokeWidth={2.5} aria-hidden="true" /></span>}
          {/* Type */}
          {issue.issueType && <span className="ibx-row__type">{issue.issueType}</span>}
          {/* Project */}
          {project && <span className="ibx-row__proj">{inferPrefix(project.name)}</span>}
          {/* Cycle */}
          {cycle && <CycleBadge cycle={cycle} small />}
          {/* Labels */}
          {labels.map((l) => {
            const c = labelColors(l)
            return <span key={l} className="ibx-row__label" style={{ background: c.bg, color: c.text, borderColor: c.border }}>{l}</span>
          })}
          {extra > 0 && <span className="ibx-row__label ibx-row__label--more">+{extra}</span>}
          {/* Assignee */}
          {member
            ? <span className="ibx-row__avatar" title={member.displayName || member.username}>{memberInitials(member)}</span>
            : <span className="ibx-row__avatar ibx-row__avatar--none" title="Unassigned">—</span>}
          {/* Due date */}
          {due && (
            <span className={`ibx-row__due ${overdue ? 'ibx-row__due--overdue' : ''}`}>
              {due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </span>
      </button>

      {/* Action button */}
      {dismissed ? (
        <button type="button" className="ibx-row__action ibx-row__action--restore" onClick={onRestore} title="Restore">
          <Eye size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : (
        <button type="button" className="ibx-row__action ibx-row__action--dismiss" onClick={onDismiss} title="Dismiss">
          <X size={13} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

// ── Summary card ──────────────────────────────────────────────────────────────
function SummaryCard({ label, value, color, active, onClick }) {
  return (
    <button
      type="button"
      className={`ibx-summary ${active ? 'ibx-summary--active' : ''} ${value > 0 ? 'ibx-summary--clickable' : ''}`}
      onClick={value > 0 ? onClick : undefined}
      disabled={value === 0}
    >
      <span className="ibx-summary__value" style={{ color }}>{value}</span>
      <span className="ibx-summary__label">{label}</span>
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LinearInboxPage() {
  const { user }  = useAuth()
  const {
    projects, members, loadingProjects, loadingTasks, error,
    getTasksForProject, getCyclesForProject, actions,
  } = useTeamProjectsContext()

  const [dismissed,      setDismissed]     = useState(() => loadDismissed())
  const [showDismissed,  setShowDismissed] = useState(false)
  const [selectedIssue,  setSelectedIssue] = useState(null)
  const [reasonParam, setReasonParam] = useUrlSearchParamState('reason', {
    defaultValue: '',
    allowed: ['', 'assigned', 'blocked', 'overdue', 'review', 'ready', 'highpri', 'unassigned'],
  })
  const filterReason = reasonParam || null
  const setFilterReason = useCallback(
    (value) => setReasonParam(value || ''),
    [setReasonParam],
  )
  const [filterProject,  setFilterProject] = useState(null)
  const [filterPriority, setFilterPriority]= useState(null)
  const [filterCycle,    setFilterCycle]   = useState(null)
  const [filterAssignee, setFilterAssignee]= useState(null)
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

  // ── Maps ──────────────────────────────────────────────────────────────────
  const memberMap = useMemo(() => {
    const m = {}; for (const mb of members) m[String(mb.id)] = mb; return m
  }, [members])

  const projectMap = useMemo(() => {
    const m = {}; for (const p of projects) m[p.id] = p; return m
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
    const m = {}; for (const c of allCycles) m[c.id] = c; return m
  }, [allCycles])

  // Keep selected issue fresh
  useEffect(() => {
    if (!selectedIssue) return
    const fresh = allIssues.find((i) => i.id === selectedIssue.id && i.projectId === selectedIssue.projectId)
    if (fresh) setSelectedIssue(fresh)
  }, [allIssues, selectedIssue?.id, selectedIssue?.projectId])

  // ── Build inbox items ─────────────────────────────────────────────────────
  const today = useMemo(() => new Date(), [])

  const allItems = useMemo(() => {
    const currentUserId = user?.userId
    const items = []
    for (const issue of allIssues) {
      const reason = classifyIssue(issue, currentUserId, today, projectMap)
      if (reason) items.push({ issue, reason, id: itemId(issue) })
    }
    // Sort: blocked > overdue > assigned > review > sop_needed > needs_qa > ready > highpri > unassigned
    const ORDER = ['blocked','overdue','assigned','review','sop_needed','needs_qa','ready','highpri','unassigned']
    items.sort((a, b) => ORDER.indexOf(a.reason) - ORDER.indexOf(b.reason))
    return items
  }, [allIssues, user?.userId, today])

  // ── Filter ────────────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      const { issue, reason } = item
      if (filterReason   && reason !== filterReason)                                     return false
      if (filterProject  && String(issue.projectId) !== filterProject)                   return false
      if (filterPriority && normalizePriority(issue.priority) !== filterPriority)        return false
      if (filterCycle    && String(issue.sprintId) !== filterCycle)                      return false
      if (filterAssignee && String(issue.assigneeUserId) !== filterAssignee)             return false
      return true
    })
  }, [allItems, filterReason, filterProject, filterPriority, filterCycle, filterAssignee])

  const activeItems    = filteredItems.filter((i) => !dismissed.has(i.id))
  const dismissedItems = filteredItems.filter((i) =>  dismissed.has(i.id))

  // ── Dismiss / restore / clear ──────────────────────────────────────────────
  const dismiss = useCallback((id) => {
    setDismissed((prev) => { const next = new Set(prev); next.add(id); saveDismissed(next); return next })
  }, [])
  const restore = useCallback((id) => {
    setDismissed((prev) => { const next = new Set(prev); next.delete(id); saveDismissed(next); return next })
  }, [])
  const clearAll = useCallback(() => {
    setDismissed(new Set()); saveDismissed(new Set())
  }, [])

  // ── Summary counts (from active+dismissed pre-filter to include all) ───────
  const counts = useMemo(() => {
    const active = allItems.filter((i) => !dismissed.has(i.id))
    const total  = active.length
    const byReason = {}
    for (const r of REASONS) byReason[r.id] = active.filter((i) => i.reason === r.id).length
    return { total, ...byReason }
  }, [allItems, dismissed])

  // ── Issue update/delete ───────────────────────────────────────────────────
  const handleUpdate = useCallback(async (projectId, taskId, data) => {
    const updated = await actions.updateTask(projectId, taskId, data)
    setSelectedIssue((prev) => prev?.id === taskId && prev?.projectId === projectId ? updated : prev)
    return updated
  }, [actions])

  const handleDelete = useCallback(async (projectId, taskId) => {
    await actions.deleteTask(projectId, taskId)
    setSelectedIssue(null)
  }, [actions])

  // ── Filter options ────────────────────────────────────────────────────────
  const projectOptions  = projects.map((p) => ({ value: String(p.id), label: p.name }))
  const cycleOptions    = allCycles.map((c) => ({ value: String(c.id), label: c.name }))
  const priorityOptions = ['Urgent','High','Medium','Low','No Priority'].map((p) => ({ value: p, label: p }))
  const assigneeOptions = members.map((m) => ({ value: String(m.id), label: m.displayName || m.username }))
  const reasonOptions   = REASONS.map((r) => ({ value: r.id, label: r.label }))
  const hasFilters = filterReason || filterProject || filterPriority || filterCycle || filterAssignee

  const anyLoading = loadingProjects || Object.values(loadingTasks).some(Boolean)

  return (
    <div className="ibx">
      <LinearSidebar projects={projects} inboxCount={counts.total} />

      <main className="ibx__main">
        {/* Header */}
        <div className="ibx__header">
          <div>
            <h1 className="ibx__title">
              <Inbox size={18} strokeWidth={1.8} className="ibx__title-icon" aria-hidden="true" />
              Inbox
              {counts.total > 0 && <span className="ibx__title-count">{counts.total}</span>}
            </h1>
            <p className="ibx__subtitle">Attention items from product and development work</p>
          </div>
          {dismissed.size > 0 && (
            <div className="ibx__header-actions">
              <button type="button" className="ibx__hdr-btn" onClick={() => setShowDismissed((v) => !v)}>
                {showDismissed ? <EyeOff size={13} strokeWidth={2} aria-hidden="true" /> : <Eye size={13} strokeWidth={2} aria-hidden="true" />}
                {showDismissed ? 'Hide dismissed' : `Show ${dismissed.size} dismissed`}
              </button>
              <button type="button" className="ibx__hdr-btn ibx__hdr-btn--danger" onClick={clearAll} title="Clear all dismissed items">
                <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                Clear dismissed
              </button>
            </div>
          )}
        </div>

        {/* Summary cards */}
        <div className="ibx__summary-grid">
          <SummaryCard label="Inbox"           value={counts.total}      color="#e2e8f0" active={!filterReason} onClick={() => setFilterReason(null)} />
          <SummaryCard label="Assigned to you" value={counts.assigned}   color="#6366f1" active={filterReason==='assigned'}   onClick={() => setFilterReason('assigned')} />
          <SummaryCard label="Blocked"         value={counts.blocked}    color="#ef4444" active={filterReason==='blocked'}    onClick={() => setFilterReason('blocked')} />
          <SummaryCard label="Overdue"         value={counts.overdue}    color="#f97316" active={filterReason==='overdue'}    onClick={() => setFilterReason('overdue')} />
          <SummaryCard label="Needs Review"    value={counts.review}     color="#8b5cf6" active={filterReason==='review'}     onClick={() => setFilterReason('review')} />
          <SummaryCard label="Ready to Ship"   value={counts.ready}      color="#10b981" active={filterReason==='ready'}      onClick={() => setFilterReason('ready')} />
          <SummaryCard label="High Priority"   value={counts.highpri}    color="#f59e0b" active={filterReason==='highpri'}    onClick={() => setFilterReason('highpri')} />
          <SummaryCard label="Unassigned"      value={counts.unassigned} color="#94a3b8" active={filterReason==='unassigned'} onClick={() => setFilterReason('unassigned')} />
        </div>

        {/* Filter bar */}
        <div className="ibx__filters">
          <FilterSelect label="Category" value={filterReason}   onChange={setFilterReason}   options={reasonOptions} />
          <FilterSelect label="Project"  value={filterProject}  onChange={setFilterProject}  options={projectOptions} />
          <FilterSelect label="Priority" value={filterPriority} onChange={setFilterPriority} options={priorityOptions} />
          <FilterSelect label="Cycle"    value={filterCycle}    onChange={setFilterCycle}    options={cycleOptions} />
          <FilterSelect label="Assignee" value={filterAssignee} onChange={setFilterAssignee} options={assigneeOptions} />
          {hasFilters && (
            <button type="button" className="ibx__clear-btn" onClick={() => { setFilterReason(null); setFilterProject(null); setFilterPriority(null); setFilterCycle(null); setFilterAssignee(null) }}>
              <X size={11} strokeWidth={2.5} aria-hidden="true" />
              Clear
            </button>
          )}
        </div>

        {anyLoading && <div className="ibx__loading-bar" role="progressbar" aria-label="Loading…" />}
        {error && (
          <div className="ibx__error" role="alert">
            <AlertCircle size={14} strokeWidth={2} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Items list */}
        <div className="ibx__list">
          {activeItems.length === 0 && !showDismissed && !anyLoading && (
            <div className="ibx__empty">
              <div className="ibx__empty-title">All clear</div>
              <div className="ibx__empty-sub">No attention items match the current filters.</div>
            </div>
          )}

          {activeItems.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              projectMap={projectMap}
              memberMap={memberMap}
              cycleMap={cycleMap}
              dismissed={false}
              onSelect={setSelectedIssue}
              onDismiss={() => dismiss(item.id)}
              onRestore={() => restore(item.id)}
            />
          ))}

          {showDismissed && dismissedItems.length > 0 && (
            <>
              <div className="ibx__divider">Dismissed ({dismissedItems.length})</div>
              {dismissedItems.map((item) => (
                <InboxRow
                  key={item.id}
                  item={item}
                  projectMap={projectMap}
                  memberMap={memberMap}
                  cycleMap={cycleMap}
                  dismissed
                  onSelect={setSelectedIssue}
                  onDismiss={() => dismiss(item.id)}
                  onRestore={() => restore(item.id)}
                />
              ))}
            </>
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
