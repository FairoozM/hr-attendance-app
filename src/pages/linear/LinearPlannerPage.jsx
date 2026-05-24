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
import { LinearSidebar }  from '../../components/linear/LinearSidebar'
import { LinearTopBar }   from '../../components/linear/LinearTopBar'
import { IssueListGroup } from '../../components/linear/IssueListGroup'
import { NewIssueModal }  from '../../components/linear/NewIssueModal'
import { IssueDetailPanel } from '../../components/linear/IssueDetailPanel'
import { STATUS_CONFIG, PRIORITY_CONFIG, normalizeStatus, normalizePriority } from '../../components/linear/IssueRow'
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
  const {
    projects,
    members,
    loadingProjects,
    loadingTasks,
    error,
    getTasksForProject,
    getMemberById,
    actions,
  } = useTeamProjectsContext()

  const [search,        setSearch]        = useState('')
  const [groupBy,       setGroupBy]       = useState('status')
  const [activeFilters, setActiveFilters] = useState({})
  const [activeLabel,   setActiveLabel]   = useState(null)
  const [selectedIssue, setSelectedIssue] = useState(null)
  const [newIssueOpen,  setNewIssueOpen]  = useState(false)
  const [githubMetaByIssue, setGithubMetaByIssue] = useState({})
  const [successMessage, setSuccessMessage] = useState('')
  const didFetch = useRef(false)

  // Fetch on mount
  useEffect(() => {
    if (didFetch.current) return
    didFetch.current = true
    actions.fetchProjects()
    actions.fetchMembers()
  }, [actions])

  // Fetch issues for each project once loaded
  useEffect(() => {
    for (const p of projects) actions.fetchTasks(p.id)
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

  // Keep selected issue in sync with context cache after inline/list updates
  useEffect(() => {
    if (!selectedIssue) return
    const fresh = allIssues.find(
      (i) => i.id === selectedIssue.id && i.projectId === selectedIssue.projectId
    )
    if (fresh) setSelectedIssue(fresh)
  }, [allIssues, selectedIssue?.id, selectedIssue?.projectId])

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

      return true
    })
  }, [allIssues, search, activeFilters, activeLabel, projectMap, memberMap, user])

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
    await actions.createTask(projectId, payload)
  }, [actions])

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

  // ── Quick filter toggle ─────────────────────────────────────────────────────
  const toggleFilter = useCallback((id) => {
    setActiveFilters((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const anyLoading = loadingProjects || Object.values(loadingTasks).some(Boolean)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="lpp">
      <LinearSidebar
        projects={projects}
        activeLabel={activeLabel}
        onLabelFilter={setActiveLabel}
      />

      {/* Main content */}
      <main className="lpp__main">
        {/* Top bar */}
        <LinearTopBar
          search={search}
          onSearch={setSearch}
          groupBy={groupBy}
          onGroupBy={setGroupBy}
          activeFilters={activeFilters}
          onFilterToggle={toggleFilter}
          activeLabel={activeLabel}
          onLabelFilter={setActiveLabel}
          onNewIssue={() => setNewIssueOpen(true)}
          title="All Issues"
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
          {groups.length === 0 ? (
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
                selectedId={selectedIssue?.id}
                selectedProjectId={selectedIssue?.projectId}
                onSelect={setSelectedIssue}
                onStatusChange={handleStatusChange}
                onPriorityChange={handlePriorityChange}
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
      />

      <IssueDetailPanel
        open={Boolean(selectedIssue)}
        issue={selectedIssue}
        project={selectedIssue ? projectMap[selectedIssue.projectId] : null}
        members={members}
        onClose={() => setSelectedIssue(null)}
        onUpdate={handleIssueUpdate}
        onDelete={handleIssueDelete}
        githubMeta={issueGithubKey ? githubMetaByIssue[issueGithubKey] : undefined}
        onGithubMetaChange={(meta) => {
          if (!issueGithubKey) return
          setGithubMetaByIssue((prev) => ({ ...prev, [issueGithubKey]: meta }))
        }}
      />
    </div>
  )
}
