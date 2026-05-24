/**
 * LinearProjectsPage.jsx
 * /#/projects/linear/projects — Project workspaces overview.
 * Shows all projects with issue counts, active cycle, progress bar.
 * Clicking a project navigates to Issues filtered by that project.
 * Uses existing TeamProjectsContext data — no new API routes.
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Plus, Layers } from 'lucide-react'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import { normalizeStatus } from '../../components/linear/IssueRow'
import { normalizePriority } from '../../components/linear/IssueRow'
import './LinearProjectsPage.css'

// ── Project prefix map (matches issueKey() logic in IssueRow) ─────────────────
function inferPrefix(name) {
  if (!name) return 'PRJ'
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

// ── Per-project computed stats ────────────────────────────────────────────────
function computeStats(issues, cycles) {
  const total    = issues.length
  const done     = issues.filter((i) => normalizeStatus(i.status) === 'Done').length
  const canceled = issues.filter((i) => normalizeStatus(i.status) === 'Canceled').length
  const inProg   = issues.filter((i) => ['In Progress', 'In Review'].includes(normalizeStatus(i.status))).length
  const ready    = issues.filter((i) => normalizeStatus(i.status) === 'Ready for Release').length
  const highPri  = issues.filter((i) => ['Urgent', 'High'].includes(normalizePriority(i.priority))).length
  const open     = total - done - canceled

  const progress = total > 0 ? Math.round((done / total) * 100) : 0

  const activeCycle = cycles.find((c) => c.status === 'active') || null

  return { total, open, done, canceled, inProg, ready, highPri, progress, activeCycle }
}

// ── Project color (fallback palette) ──────────────────────────────────────────
const PALETTE = [
  '#6366f1','#3b82f6','#10b981','#f59e0b','#ec4899','#8b5cf6',
  '#14b8a6','#f97316','#ef4444','#06b6d4',
]
function projectColor(project, idx) {
  return project.color || PALETTE[idx % PALETTE.length]
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LinearProjectsPage() {
  const navigate = useNavigate()
  const {
    projects,
    loadingProjects,
    error,
    getTasksForProject,
    getCyclesForProject,
  } = useTeamProjectsContext()

  const projectCards = useMemo(() =>
    projects.map((p, idx) => {
      const issues = getTasksForProject(p.id)
      const cycles = getCyclesForProject(p.id)
      const stats  = computeStats(issues, cycles)
      const prefix = inferPrefix(p.name)
      const color  = projectColor(p, idx)
      return { project: p, stats, prefix, color }
    }),
  [projects, getTasksForProject, getCyclesForProject])

  function openProject(projectId) {
    // Navigate to Issues page with project filter applied via URL state
    navigate('/projects/linear', { state: { filterProjectId: projectId } })
  }

  const totalOpen = projectCards.reduce((s, c) => s + c.stats.open, 0)

  return (
    <div className="lprj">
      <LinearSidebar projects={projects} />

      <main className="lprj__main">
        {/* Header */}
        <div className="lprj__header">
          <div className="lprj__header-left">
            <h1 className="lprj__title">
              <Layers size={18} strokeWidth={1.8} className="lprj__title-icon" aria-hidden="true" />
              Projects
            </h1>
            <p className="lprj__subtitle">Product and development workspaces</p>
          </div>
          <div className="lprj__header-right">
            {totalOpen > 0 && (
              <span className="lprj__summary">
                {totalOpen} open issue{totalOpen !== 1 ? 's' : ''} across {projectCards.length} project{projectCards.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Loading */}
        {loadingProjects && <div className="lprj__loading-bar" role="progressbar" aria-label="Loading…" />}

        {/* Error */}
        {error && (
          <div className="lprj__error" role="alert">
            <AlertCircle size={14} strokeWidth={2} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Empty */}
        {!loadingProjects && projectCards.length === 0 && !error && (
          <div className="lprj__empty">
            <div className="lprj__empty-title">No projects yet</div>
            <div className="lprj__empty-sub">Projects will appear here once they are created in the database.</div>
          </div>
        )}

        {/* Cards grid */}
        <div className="lprj__grid">
          {projectCards.map(({ project, stats, prefix, color }) => (
            <button
              key={project.id}
              type="button"
              className="lprj__card"
              onClick={() => openProject(project.id)}
              aria-label={`Open ${project.name} issues`}
            >
              {/* Card header */}
              <div className="lprj__card-head">
                <span className="lprj__card-prefix" style={{ background: color + '22', color }}>
                  {prefix}
                </span>
                <span className="lprj__card-name">{project.name}</span>
              </div>

              {/* Description */}
              {project.description && (
                <p className="lprj__card-desc">{project.description}</p>
              )}

              {/* Stats row */}
              <div className="lprj__card-stats">
                <StatChip label="Open"     value={stats.open}    color="#94a3b8" />
                <StatChip label="In Progress" value={stats.inProg} color="#3b82f6" />
                <StatChip label="Ready"    value={stats.ready}   color="#10b981" />
                <StatChip label="Done"     value={stats.done}    color="#059669" />
                {stats.highPri > 0 && (
                  <StatChip label="High Pri" value={stats.highPri} color="#f97316" accent />
                )}
              </div>

              {/* Active cycle badge */}
              {stats.activeCycle && (
                <div className="lprj__card-cycle">
                  <span className="lprj__cycle-dot" />
                  <span className="lprj__cycle-name">{stats.activeCycle.name}</span>
                  <span className="lprj__cycle-status">Active Cycle</span>
                </div>
              )}

              {/* Progress bar */}
              <div className="lprj__card-progress">
                <div
                  className="lprj__card-progress-fill"
                  style={{ width: `${stats.progress}%`, background: color }}
                  role="progressbar"
                  aria-valuenow={stats.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <div className="lprj__card-progress-label">
                {stats.done} / {stats.total} done{stats.total > 0 ? ` · ${stats.progress}%` : ''}
              </div>
            </button>
          ))}
        </div>
      </main>
    </div>
  )
}

function StatChip({ label, value, color, accent }) {
  if (value === 0 && !accent) return null
  return (
    <div className={`lprj__stat ${accent ? 'lprj__stat--accent' : ''}`} style={{ '--chip-color': color }}>
      <span className="lprj__stat-value" style={{ color }}>{value}</span>
      <span className="lprj__stat-label">{label}</span>
    </div>
  )
}
