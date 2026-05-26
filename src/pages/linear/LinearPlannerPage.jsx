/**
 * LinearPlannerPage.jsx
 * /projects/linear — Linear-style issue tracker for Life Smile team.
 *
 * Safety: does NOT touch /projects (AI Planner) or AIPlannerContext.
 * Uses TeamProjectsContext + projectsApi exclusively.
 * "Issue" in UI = "task" in the server API. No DB field names are changed.
 * "Cycle" in UI = "sprint_id" in the server API.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { AlertCircle } from 'lucide-react'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from 'react-router-dom'
import { LinearSidebar }    from '../../components/linear/LinearSidebar'
import { LinearTopBar }     from '../../components/linear/LinearTopBar'
import { IssueListGroup }   from '../../components/linear/IssueListGroup'
import { NewIssueModal }    from '../../components/linear/NewIssueModal'
import { IssueDetailPanel } from '../../components/linear/IssueDetailPanel'
import { CyclesPanel }      from '../../components/linear/CyclesPanel'
import { SaveViewModal }    from '../../components/linear/SaveViewModal'
import { CommandMenu }      from '../../components/linear/CommandMenu'
import { STATUS_CONFIG, PRIORITY_CONFIG, normalizeStatus, normalizePriority } from '../../components/linear/IssueRow'
import {
  BUILTIN_VIEWS,
  ACTIVE_CYCLE_SENTINEL,
  loadCustomViews,
  saveCustomViewsToStorage,
  captureFilters,
  hasActiveFilter,
} from '../../components/linear/savedViews'
import { canCreateIssue, canEditIssue } from '../../lib/linearPermissions'
import './LinearPlannerPage.css'

// ── Grouping helpers ──────────────────────────────────────────────────────────

function groupByStatus(issues) {
  // Linear product engineering status order
  const ORDER = ['In Progress', 'In Review', 'Ready for Release', 'Todo', 'Backlog', 'Done', 'Canceled']
  const groups = {}
  for (const issue of issues) {
    const s = normalizeStatus(issue.status)
    if (!groups[s]) groups[s] = []
    groups[s].push(issue)
  }
  return ORDER
    .filter((s) => groups[s])
    .concat(Object.keys(groups).filter((s) => !ORDER.includes(s)))
    .map((s) => ({
      key:   s,
      title: s,
      color: STATUS_CONFIG[s]?.color,
      Icon:  STATUS_CONFIG[s]?.Icon,
      issues: groups[s],
    }))
}

function groupByPriority(issues, priorityMap) {
  const ORDER = ['Urgent', 'High', 'Medium', 'Low', 'No Priority']
  const groups = {}
  for (const issue of issues) {
    const p = normalizePriority(issue.priority)
    if (!groups[p]) groups[p] = []
    groups[p].push(issue)
  }
  return ORDER
    .filter((p) => groups[p])
    .map((p) => ({
      key:   p,
      title: p,
      color: PRIORITY_CONFIG[p]?.color,
      Icon:  PRIORITY_CONFIG[p]?.Icon,
      issues: groups[p],
    }))
}

function groupByAssignee(issues, memberMap) {
  const groups = {}
  for (const issue of issues) {
    const key = issue.assigneeUserId ? String(issue.assigneeUserId) : '__unassigned'
    if (!groups[key]) groups[key] = []
    groups[key].push(issue)
  }
  return Object.entries(groups).map(([key, issueList]) => {
    const member = memberMap[key] || null
    return {
      key,
      title: member ? (member.displayName || member.username) : 'Unassigned',
      issues: issueList,
    }
  })
}

function groupByProject(issues, projectMap) {
  const groups = {}
  for (const issue of issues) {
    const key = String(issue.projectId || '__none')
    if (!groups[key]) groups[key] = []
    groups[key].push(issue)
  }
  return Object.entries(groups).map(([key, issueList]) => ({
    key,
    title: projectMap[key]?.name || 'No Project',
    color: projectMap[key]?.color,
    issues: issueList,
  }))
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LinearPlannerPage() {
  const { user } = useAuth()
  const location = useLocation()
  const {
    projects,
    members,
    loadingProjects,
    loadingTasks,
    error,
    getTasksForProject,
    getCyclesForProject,
    getMemberById,
    actions,
  } = useTeamProjectsContext()

  const [search,        setSearch]        = useState('')
  const [groupBy,       setGroupBy]       = useState('status')
  const [activeFilters, setActiveFilters] = useState({})
  const [activeLabel,   setActiveLabel]   = useState(null)
  const [activeCycle,   setActiveCycle]   = useState(null)  // null | 'none' | cycleId (number)
  const [activeStatus,  setActiveStatus]  = useState(null)  // null | status string
  const [activePriority, setActivePriority] = useState(null)  // null | priority string
  const [activeProject, setActiveProject] = useState(null)   // null | projectId (number)
  const [activeAssignee, setActiveAssignee] = useState(null) // null | userId | 'unassigned'
  const [activeViewId,  setActiveViewId]  = useState(null)
  const [customViews,   setCustomViews]   = useState(() => loadCustomViews())
  const [selectedIssue, setSelectedIssue] = useState(null)
  const [newIssueOpen,  setNewIssueOpen]  = useState(false)
  const [cyclesPanelOpen, setCyclesPanelOpen] = useState(false)
  const [saveViewOpen,  setSaveViewOpen]  = useState(false)
  const [cmdMenuOpen,   setCmdMenuOpen]   = useState(false)
  const [githubMetaByIssue, setGithubMetaByIssue] = useState({})
  const [successMessage, setSuccessMessage] = useState('')
  const didFetch = useRef(false)
  const canCreateIssues = canCreateIssue(user)

  // ── Apply project filter from navigation state (from Projects page) ────────
  useEffect(() => {
    if (location.state?.filterProjectId != null) {
      setActiveProject(location.state.filterProjectId)
      window.history.replaceState({ ...window.history.state, usr: {} }, '')
    }
    if (location.state?.filterAssigneeId != null) {
      setActiveAssignee(location.state.filterAssigneeId)
      window.history.replaceState({ ...window.history.state, usr: {} }, '')
    }
  }, [location.state?.filterProjectId, location.state?.filterAssigneeId])

  // ── Fetch on mount ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (didFetch.current) return
    didFetch.current = true
    actions.fetchProjects()
    actions.fetchMembers()
  }, [actions])

  // Fetch issues and cycles for each project once loaded
  useEffect(() => {
    for (const p of projects) {
      actions.fetchTasks(p.id)
      actions.fetchCycles(p.id)
    }
  }, [projects, actions])

  // ── Derived maps ────────────────────────────────────────────────────────────
  const memberMap = useMemo(() => {
    const m = {}
    for (const mb of members) m[mb.id] = mb
    return m
  }, [members])

  const projectMap = useMemo(() => {
    const m = {}
    for (const p of projects) m[p.id] = p
    return m
  }, [projects])

  // All issues (server calls them tasks)
  const allIssues = useMemo(
    () => projects.flatMap((p) => getTasksForProject(p.id)),
    [projects, getTasksForProject]
  )

  // All cycles (aggregated across all projects, keyed by ID)
  const allCycles = useMemo(
    () => projects.flatMap((p) => getCyclesForProject(p.id)),
    [projects, getCyclesForProject]
  )

  const cycleMap = useMemo(() => {
    const m = {}
    for (const c of allCycles) m[c.id] = c
    return m
  }, [allCycles])

  // Keep selected issue in sync with context cache after inline/list updates
  useEffect(() => {
    if (!selectedIssue) return
    const fresh = allIssues.find(
      (i) => i.id === selectedIssue.id && i.projectId === selectedIssue.projectId
    )
    if (fresh) setSelectedIssue(fresh)
  }, [allIssues, selectedIssue?.id, selectedIssue?.projectId])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const issueId = Number(params.get('issueId') || '')
    const projectId = Number(params.get('projectId') || '')
    if (!issueId) return
    const match = allIssues.find((issue) => (
      issue.id === issueId && (!projectId || issue.projectId === projectId)
    ))
    if (match) setSelectedIssue(match)
  }, [allIssues, location.search])

  // ── Filtering ───────────────────────────────────────────────────────────────
  const filteredIssues = useMemo(() => {
    const q = search.toLowerCase().trim()
    const today = new Date()
    const soonMs = 3 * 24 * 60 * 60 * 1000 // 3 days

    return allIssues.filter((issue) => {
      const project  = projectMap[issue.projectId]
      const assignee = issue.assigneeUserId ? memberMap[issue.assigneeUserId] : null

      // Search
      if (q) {
        const haystack = [
          issue.title,
          project?.name,
          assignee?.displayName,
          assignee?.username,
          ...(issue.labels || []),
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }

      // Quick filter chips
      if (activeFilters.myIssues && String(issue.assigneeUserId) !== String(user?.userId)) return false
      if (activeFilters.highPri  && !['Urgent', 'High'].includes(normalizePriority(issue.priority))) return false
      if (activeFilters.unassigned && issue.assigneeUserId) return false
      if (activeFilters.dueSoon) {
        if (!issue.dueDate) return false
        const due = new Date(issue.dueDate)
        const diff = due - today
        if (diff < 0 || diff > soonMs) return false
      }

      // Label filter
      if (activeLabel) {
        const labels = Array.isArray(issue.labels) ? issue.labels : []
        if (!labels.includes(activeLabel)) return false
      }

      // Cycle filter: 'none' = no cycle, number = specific cycle ID
      if (activeCycle === 'none') {
        if (issue.sprintId != null) return false
      } else if (activeCycle != null) {
        if (issue.sprintId !== activeCycle) return false
      }

      // Status filter (set by views)
      if (activeStatus) {
        if (normalizeStatus(issue.status) !== activeStatus) return false
      }

      // Priority filter (set by views)
      if (activePriority) {
        if (normalizePriority(issue.priority) !== activePriority) return false
      }

      // Project filter (set by Projects page navigation)
      if (activeProject != null) {
        if (String(issue.projectId) !== String(activeProject)) return false
      }

      // Assignee filter (set by Team page navigation or Cmd+K)
      if (activeAssignee === 'unassigned') {
        if (issue.assigneeUserId) return false
      } else if (activeAssignee != null) {
        if (String(issue.assigneeUserId) !== String(activeAssignee)) return false
      }

      return true
    })
  }, [allIssues, search, activeFilters, activeLabel, activeCycle, activeStatus, activePriority, activeProject, activeAssignee, projectMap, memberMap, user])

  // ── Grouping ─────────────────────────────────────────────────────────────────
  const groups = useMemo(() => {
    if (groupBy === 'status')   return groupByStatus(filteredIssues)
    if (groupBy === 'priority') return groupByPriority(filteredIssues)
    if (groupBy === 'assignee') return groupByAssignee(filteredIssues, memberMap)
    if (groupBy === 'project')  return groupByProject(filteredIssues, projectMap)
    // none — single group
    return [{ key: 'all', title: 'All Issues', issues: filteredIssues }]
  }, [groupBy, filteredIssues, memberMap, projectMap])

  // ── Inline updates ──────────────────────────────────────────────────────────
  const handleStatusChange = useCallback(async (issue, newStatus) => {
    try {
      await actions.updateTask(issue.projectId, issue.id, { status: newStatus })
    } catch (e) { console.error('[Linear] status update failed:', e) }
  }, [actions])

  const handlePriorityChange = useCallback(async (issue, newPriority) => {
    try {
      await actions.updateTask(issue.projectId, issue.id, { priority: newPriority })
    } catch (e) { console.error('[Linear] priority update failed:', e) }
  }, [actions])

  // ── Create issue ────────────────────────────────────────────────────────────
  const handleCreate = useCallback(async ({ projectId, payload }) => {
    if (!canCreateIssues) {
      throw new Error('You do not have permission to perform this action.')
    }
    await actions.createTask(projectId, payload)
  }, [actions, canCreateIssues])

  const handleIssueUpdate = useCallback(async (projectId, taskId, data) => {
    const updated = await actions.updateTask(projectId, taskId, data)
    setSelectedIssue((prev) =>
      prev?.id === taskId && prev?.projectId === projectId ? updated : prev
    )
    return updated
  }, [actions])

  const handleIssueDelete = useCallback(async (projectId, taskId) => {
    await actions.deleteTask(projectId, taskId)
    setSelectedIssue(null)
    setGithubMetaByIssue((prev) => {
      const next = { ...prev }
      delete next[`${projectId}-${taskId}`]
      return next
    })
    setSuccessMessage('Issue deleted.')
    window.setTimeout(() => setSuccessMessage(''), 4000)
  }, [actions])

  const issueGithubKey = selectedIssue
    ? `${selectedIssue.projectId}-${selectedIssue.id}`
    : null

  // ── Global Cmd+K / Ctrl+K listener ─────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCmdMenuOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── Clear all filters ────────────────────────────────────────────────────────
  const handleClearFilters = useCallback(() => {
    setSearch('')
    setGroupBy('status')
    setActiveFilters({})
    setActiveLabel(null)
    setActiveCycle(null)
    setActiveStatus(null)
    setActivePriority(null)
    setActiveProject(null)
    setActiveAssignee(null)
    setActiveViewId(null)
  }, [])
  const toggleFilter = useCallback((id) => {
    setActiveFilters((prev) => ({ ...prev, [id]: !prev[id] }))
    setActiveViewId(null)
  }, [])

  // ── Wrappers that clear activeViewId on manual filter change ─────────────────
  const handleSearch       = useCallback((v) => { setSearch(v);        setActiveViewId(null) }, [])
  const handleGroupBy      = useCallback((v) => { setGroupBy(v);       setActiveViewId(null) }, [])
  const handleLabelFilter  = useCallback((v) => { setActiveLabel(v);   setActiveViewId(null) }, [])
  const handleCycleFilter  = useCallback((v) => { setActiveCycle(v);   setActiveViewId(null) }, [])

  // ── Saved views ──────────────────────────────────────────────────────────────

  /** Apply a view — resolves ACTIVE_CYCLE_SENTINEL if needed. */
  const applyView = useCallback((view) => {
    const f = view.filters
    setSearch(f.search ?? '')
    setGroupBy(f.groupBy ?? 'status')
    setActiveFilters(f.activeFilters ?? {})
    setActiveLabel(f.activeLabel ?? null)
    setActiveStatus(f.activeStatus ?? null)
    setActivePriority(f.activePriority ?? null)
    setActiveAssignee(f.activeAssignee ?? null)
    setActiveProject(f.activeProject ?? null)

    if (f.activeCycle === ACTIVE_CYCLE_SENTINEL) {
      const activeCycleObj = allCycles.find((c) => c.status === 'active')
      setActiveCycle(activeCycleObj ? activeCycleObj.id : null)
    } else {
      setActiveCycle(f.activeCycle ?? null)
    }

    setActiveViewId(view.id)
  }, [allCycles])

  /** Capture current filters and save as a new custom view. */
  const saveCurrentView = useCallback((name) => {
    const id = `custom-${Date.now()}`
    const newView = {
      id,
      label: name,
      icon: 'Bookmark',
      builtin: false,
      filters: captureFilters({
        search, groupBy, activeFilters, activeLabel, activeCycle,
        activeStatus, activePriority, activeAssignee, activeProject,
      }),
    }
    setCustomViews((prev) => {
      const next = [...prev, newView]
      saveCustomViewsToStorage(next)
      return next
    })
    setActiveViewId(id)
  }, [search, groupBy, activeFilters, activeLabel, activeCycle, activeStatus, activePriority, activeAssignee, activeProject])

  /** Delete a custom view (built-in views cannot be deleted). */
  const deleteCustomView = useCallback((viewId) => {
    setCustomViews((prev) => {
      const next = prev.filter((v) => v.id !== viewId)
      saveCustomViewsToStorage(next)
      return next
    })
    if (activeViewId === viewId) setActiveViewId(null)
  }, [activeViewId])

  const anyLoading = loadingProjects || Object.values(loadingTasks).some(Boolean)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="lpp">
      <LinearSidebar
        projects={projects}
        activeLabel={activeLabel}
        onLabelFilter={handleLabelFilter}
        cycles={allCycles}
        activeCycle={activeCycle}
        onCycleFilter={handleCycleFilter}
        onManageCycles={() => setCyclesPanelOpen(true)}
        allViews={[...BUILTIN_VIEWS, ...customViews]}
        activeViewId={activeViewId}
        onApplyView={applyView}
        onDeleteView={deleteCustomView}
      />

      {/* Main content */}
      <main className="lpp__main">
        {/* Top bar */}
        <LinearTopBar
          search={search}
          onSearch={handleSearch}
          groupBy={groupBy}
          onGroupBy={handleGroupBy}
          activeFilters={activeFilters}
          onFilterToggle={toggleFilter}
          activeLabel={activeLabel}
          onLabelFilter={handleLabelFilter}
          activeCycle={activeCycle}
          onCycleFilter={handleCycleFilter}
          cycles={allCycles}
          onNewIssue={() => setNewIssueOpen(true)}
          onSaveView={() => setSaveViewOpen(true)}
          onOpenCmdMenu={() => setCmdMenuOpen(true)}
          canCreateIssues={canCreateIssues}
          hasActiveFilters={hasActiveFilter({ search, activeFilters, activeLabel, activeCycle, activeStatus, activePriority }) || activeProject != null || activeAssignee != null}
          title={
            activeProject != null  ? (projectMap[activeProject]?.name ?? 'Project') :
            activeAssignee === 'unassigned' ? 'Unassigned Issues' :
            activeAssignee != null ? (memberMap[activeAssignee]?.displayName ?? 'Assignee') :
            'All Issues'
          }
          issueCount={filteredIssues.length}
        />

        {/* Loading bar */}
        {anyLoading && (
          <div className="lpp__loading-bar" role="progressbar" aria-label="Loading…" />
        )}

        {/* Error */}
        {error && (
          <div className="lpp__error" role="alert">
            <AlertCircle size={14} strokeWidth={2} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="lpp__toast lpp__toast--success" role="status">
            {successMessage}
          </div>
        )}

        {/* Issue groups */}
        <div className="lpp__list">
          {groups.length === 0 && !anyLoading ? (
            <div className="lpp__empty">
              <div className="lpp__empty-title">No issues found</div>
              <div className="lpp__empty-sub">
                {search || Object.values(activeFilters).some(Boolean)
                  ? 'Try clearing your search or filters.'
                  : 'Create your first issue with the New Issue button above.'}
              </div>
            </div>
          ) : (
            groups.map((g) => (
              <IssueListGroup
                key={g.key}
                title={g.title}
                titleColor={g.color}
                titleIcon={g.Icon}
                issues={g.issues}
                projectMap={projectMap}
                memberMap={memberMap}
                cycleMap={cycleMap}
                selectedId={selectedIssue?.id}
                selectedProjectId={selectedIssue?.projectId}
                onSelect={setSelectedIssue}
                onStatusChange={handleStatusChange}
                onPriorityChange={handlePriorityChange}
                canEditIssue={(issue) => canEditIssue(user, issue)}
                defaultOpen={g.key !== 'Done' && g.key !== 'Canceled' && g.key !== 'Backlog'}
              />
            ))
          )}
        </div>
      </main>

      {/* New Issue modal */}
      <NewIssueModal
        open={newIssueOpen}
        onClose={() => setNewIssueOpen(false)}
        onCreate={handleCreate}
        projects={projects}
        members={members}
        cycles={allCycles}
      />

      <IssueDetailPanel
        open={Boolean(selectedIssue)}
        issue={selectedIssue}
        project={selectedIssue ? projectMap[selectedIssue.projectId] : null}
        members={members}
        cycles={selectedIssue ? getCyclesForProject(selectedIssue.projectId) : allCycles}
        onClose={() => setSelectedIssue(null)}
        onUpdate={handleIssueUpdate}
        onDelete={handleIssueDelete}
        githubMeta={issueGithubKey ? githubMetaByIssue[issueGithubKey] : undefined}
        onGithubMetaChange={(meta) => {
          if (!issueGithubKey) return
          setGithubMetaByIssue((prev) => ({ ...prev, [issueGithubKey]: meta }))
        }}
      />

      {/* Cycles management modal */}
      <CyclesPanel
        open={cyclesPanelOpen}
        onClose={() => setCyclesPanelOpen(false)}
        projects={projects}
        cycles={allCycles}
        onCreateCycle={actions.createCycle}
        onUpdateCycle={actions.updateCycle}
      />

      {/* Save View modal */}
      <SaveViewModal
        open={saveViewOpen}
        onClose={() => setSaveViewOpen(false)}
        onSave={saveCurrentView}
      />

      {/* Command Menu — Cmd+K / Ctrl+K */}
      <CommandMenu
        open={cmdMenuOpen}
        onClose={() => setCmdMenuOpen(false)}
        allIssues={allIssues}
        allCycles={allCycles}
        allViews={[...BUILTIN_VIEWS, ...customViews]}
        projectMap={projectMap}
        allProjects={projects}
        allMembers={members}
        onNewIssue={() => { setNewIssueOpen(true) }}
        onApplyView={applyView}
        onSetGroupBy={(v) => { setGroupBy(v); setActiveViewId(null) }}
        onSetActiveLabel={(v) => { setActiveLabel(v); setActiveViewId(null) }}
        onSetActiveCycle={(v) => { setActiveCycle(v); setActiveViewId(null) }}
        onSetActiveProject={(v) => { setActiveProject(v); setActiveViewId(null) }}
        onSetActiveAssignee={(v) => { setActiveAssignee(v); setActiveViewId(null) }}
        onClearFilters={handleClearFilters}
        onManageCycles={() => setCyclesPanelOpen(true)}
        onSelectIssue={(issue) => setSelectedIssue(issue)}
      />
    </div>
  )
}
