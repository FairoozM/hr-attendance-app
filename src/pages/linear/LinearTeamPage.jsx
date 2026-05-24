/**
 * LinearTeamPage.jsx
 * /#/projects/linear/team — Team workload overview.
 * Shows member cards with assigned issue counts and a top-3 issue preview.
 * Clicking a card navigates to Issues filtered by that assignee.
 * Uses existing TeamProjectsContext — no new API routes.
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Users } from 'lucide-react'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import { normalizeStatus, normalizePriority } from '../../components/linear/IssueRow'
import './LinearTeamPage.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

const OPEN_STATUSES  = new Set(['Backlog','Todo','In Progress','In Review','Ready for Release'])
const ACTIVE_STATUSES = new Set(['In Progress','In Review'])

function isOpen(issue) { return OPEN_STATUSES.has(normalizeStatus(issue.status)) }
function isActive(issue) { return ACTIVE_STATUSES.has(normalizeStatus(issue.status)) }
function isHighPri(issue) { return ['Urgent','High'].includes(normalizePriority(issue.priority)) }
function isReady(issue) { return normalizeStatus(issue.status) === 'Ready for Release' }

const WORKLOAD_CAP = 12   // "full" workload for the bar

function memberInitials(m) {
  const name = m.displayName || m.username || '?'
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}

function roleLabel(m) {
  // Prefer designation → plannerRole → role → nothing
  if (m.designation) return m.designation
  if (m.plannerRole && m.plannerRole !== 'view') return m.plannerRole
  if (m.role && m.role !== 'employee') return m.role
  return null
}

// ── Stats per member ──────────────────────────────────────────────────────────
function memberStats(issues, activeCycleIds) {
  const open    = issues.filter(isOpen)
  const active  = open.filter(isActive)
  const ready   = open.filter(isReady)
  const highPri = open.filter(isHighPri)
  const inCycle = activeCycleIds.size > 0
    ? open.filter((i) => activeCycleIds.has(i.sprintId))
    : []

  // Top 3: active first, then high-priority, then rest
  const sorted = [
    ...active.filter(isHighPri),
    ...active.filter((i) => !isHighPri(i)),
    ...open.filter((i) => !isActive(i) && isHighPri(i)),
    ...open.filter((i) => !isActive(i) && !isHighPri(i)),
  ]
  const top3 = [...new Map(sorted.map((i) => [i.id, i])).values()].slice(0, 3)

  const workloadPct = Math.min(100, Math.round((open.length / WORKLOAD_CAP) * 100))

  return { open: open.length, active: active.length, ready: ready.length,
           highPri: highPri.length, inCycle: inCycle.length, workloadPct, top3 }
}

// ── Issue mini-row ────────────────────────────────────────────────────────────
function IssuePreviewRow({ issue }) {
  const status = normalizeStatus(issue.status)
  const pri    = normalizePriority(issue.priority)
  const isHi   = isHighPri(issue)
  return (
    <div className="ltm-issue-row">
      <span className={`ltm-issue-status ltm-issue-status--${status.toLowerCase().replace(/\s+/g,'-')}`} title={status} />
      <span className="ltm-issue-title">{issue.title || 'Untitled'}</span>
      {isHi && <span className="ltm-issue-pri">{pri}</span>}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LinearTeamPage() {
  const navigate = useNavigate()
  const {
    projects, members, loadingProjects, loadingMembers, loadingTasks, error,
    getTasksForProject, getCyclesForProject,
  } = useTeamProjectsContext()

  // Aggregate all issues + build active cycle set
  const { allIssues, activeCycleIds } = useMemo(() => {
    const issues = projects.flatMap((p) => getTasksForProject(p.id))
    const ids = new Set(
      projects.flatMap((p) => getCyclesForProject(p.id))
        .filter((c) => c.status === 'active')
        .map((c) => c.id)
    )
    return { allIssues: issues, activeCycleIds: ids }
  }, [projects, getTasksForProject, getCyclesForProject])

  // Build member cards
  const memberCards = useMemo(() =>
    members.map((m) => {
      const assigned = allIssues.filter((i) => String(i.assigneeUserId) === String(m.id))
      const stats = memberStats(assigned, activeCycleIds)
      return { member: m, stats }
    }).sort((a, b) => b.stats.open - a.stats.open),
  [members, allIssues, activeCycleIds])

  // Unassigned issues
  const unassignedStats = useMemo(() => {
    const issues = allIssues.filter((i) => !i.assigneeUserId)
    return memberStats(issues, activeCycleIds)
  }, [allIssues, activeCycleIds])

  const anyLoading = loadingProjects || loadingMembers || Object.values(loadingTasks).some(Boolean)

  function openAssignee(userId) {
    navigate('/projects/linear', { state: { filterAssigneeId: userId } })
  }
  function openUnassigned() {
    navigate('/projects/linear', { state: { filterAssigneeId: 'unassigned' } })
  }

  return (
    <div className="ltm">
      <LinearSidebar projects={projects} />

      <main className="ltm__main">
        {/* Header */}
        <div className="ltm__header">
          <div className="ltm__header-left">
            <h1 className="ltm__title">
              <Users size={18} strokeWidth={1.8} className="ltm__title-icon" aria-hidden="true" />
              Team
            </h1>
            <p className="ltm__subtitle">Product and development workload</p>
          </div>
          <div className="ltm__header-right">
            <span className="ltm__summary">
              {memberCards.length} member{memberCards.length !== 1 ? 's' : ''} ·{' '}
              {allIssues.filter(isOpen).length} open issue{allIssues.filter(isOpen).length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {anyLoading && <div className="ltm__loading-bar" role="progressbar" aria-label="Loading…" />}
        {error && (
          <div className="ltm__error" role="alert">
            <AlertCircle size={14} strokeWidth={2} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {!anyLoading && memberCards.length === 0 && !error && (
          <div className="ltm__empty">
            <div className="ltm__empty-title">No team members found</div>
            <div className="ltm__empty-sub">Members will appear once they are added to the workspace.</div>
          </div>
        )}

        {/* Member grid */}
        {memberCards.length > 0 && (
          <div className="ltm__grid">
            {memberCards.map(({ member, stats }) => (
              <MemberCard
                key={member.id}
                member={member}
                stats={stats}
                onClick={() => openAssignee(member.id)}
              />
            ))}

            {/* Unassigned card */}
            <button
              type="button"
              className="ltm__card ltm__card--unassigned"
              onClick={openUnassigned}
              aria-label="Show unassigned issues"
            >
              <div className="ltm__card-head">
                <span className="ltm__avatar ltm__avatar--unassigned">?</span>
                <div className="ltm__card-info">
                  <span className="ltm__card-name">Unassigned</span>
                  <span className="ltm__card-role">No assignee</span>
                </div>
              </div>
              <StatsRow stats={unassignedStats} />
              {unassignedStats.top3.length > 0 && (
                <div className="ltm__card-issues">
                  {unassignedStats.top3.map((i) => <IssuePreviewRow key={i.id} issue={i} />)}
                </div>
              )}
              <WorkloadBar pct={unassignedStats.workloadPct} />
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

// ── Member card ───────────────────────────────────────────────────────────────
function MemberCard({ member, stats, onClick }) {
  const initials = memberInitials(member)
  const role     = roleLabel(member)

  return (
    <button type="button" className="ltm__card" onClick={onClick} aria-label={`Show ${member.displayName || member.username}'s issues`}>
      <div className="ltm__card-head">
        {member.avatarUrl ? (
          <img src={member.avatarUrl} alt={initials} className="ltm__avatar ltm__avatar--img" />
        ) : (
          <span className="ltm__avatar">{initials}</span>
        )}
        <div className="ltm__card-info">
          <span className="ltm__card-name">{member.displayName || member.username}</span>
          {role && <span className="ltm__card-role">{role}</span>}
        </div>
        <span className="ltm__card-open-badge">{stats.open}</span>
      </div>

      <StatsRow stats={stats} />

      {stats.top3.length > 0 && (
        <div className="ltm__card-issues">
          {stats.top3.map((i) => <IssuePreviewRow key={i.id} issue={i} />)}
        </div>
      )}

      <WorkloadBar pct={stats.workloadPct} />
    </button>
  )
}

// ── Stats row ─────────────────────────────────────────────────────────────────
function StatsRow({ stats }) {
  return (
    <div className="ltm__card-stats">
      <StatChip label="In Progress" value={stats.active}  color="#3b82f6" />
      <StatChip label="Ready"       value={stats.ready}   color="#10b981" />
      <StatChip label="High Pri"    value={stats.highPri} color="#f97316" show={stats.highPri > 0} />
      {stats.inCycle > 0 && <StatChip label="In Cycle" value={stats.inCycle} color="#a5b4fc" show />}
    </div>
  )
}

function StatChip({ label, value, color, show }) {
  if (value === 0 && !show) return null
  return (
    <div className="ltm__stat">
      <span className="ltm__stat-value" style={{ color }}>{value}</span>
      <span className="ltm__stat-label">{label}</span>
    </div>
  )
}

// ── Workload bar ──────────────────────────────────────────────────────────────
function WorkloadBar({ pct }) {
  const color = pct >= 85 ? '#ef4444' : pct >= 60 ? '#f97316' : '#6366f1'
  return (
    <div className="ltm__workload">
      <div className="ltm__workload-track">
        <div
          className="ltm__workload-fill"
          style={{ width: `${pct}%`, background: color }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <span className="ltm__workload-label">{pct}% workload</span>
    </div>
  )
}
