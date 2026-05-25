/**
 * LinearDashboardPage.jsx
 * /#/projects/linear/dashboard
 *
 * Product engineering analytics dashboard for Life Smile dev teams.
 * Read-only. No mutations. Uses TeamProjectsContext + localStorage release data.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, TrendingUp, AlertTriangle, CheckCircle2, ShieldCheck,
  Clock, Rocket, Users, Plus, Inbox, Map, BarChart2, Smartphone,
  Globe, Server, RefreshCw, ChevronDown, ChevronUp, Circle,
  AlertCircle, XCircle, Package, Filter, ArrowRight, ClipboardList,
} from 'lucide-react'
import { LinearSidebar }  from '../../components/linear/LinearSidebar'
import { IssueDetailPanel } from '../../components/linear/IssueDetailPanel'
import {
  normalizeStatus, normalizePriority, issueKey,
  STATUS_CONFIG, PRIORITY_CONFIG,
} from '../../components/linear/IssueRow'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import {
  loadMobileReleases, loadWebDeployments,
} from '../../lib/linearReleaseStorage'
import { issueNeedsSop } from '../../lib/linearChecklistCompliance'
import './LinearDashboardPage.css'

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayStart() { const d = new Date(); d.setHours(0,0,0,0); return d }
function weekStart()  { const d = todayStart(); d.setDate(d.getDate() - d.getDay()); return d }
function monthStart() { const d = todayStart(); d.setDate(1); return d }

function parseDateMidnight(str) {
  if (!str) return null
  try {
    const d = new Date(str.length <= 10 ? str + 'T00:00:00' : str)
    if (isNaN(d)) return null
    d.setHours(0,0,0,0)
    return d
  } catch { return null }
}

function fmtDate(str) {
  const d = parseDateMidnight(str)
  if (!d) return '—'
  return d.toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })
}

function daysUntil(str) {
  const d = parseDateMidnight(str)
  if (!d) return null
  const diff = Math.floor((d - todayStart()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0)  return `${Math.abs(diff)}d ago`
  return `in ${diff}d`
}

// ── Status buckets ────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ['Backlog','Todo','In Progress','In Review','Ready for Release','QA Approved']
const RELEASE_STATUSES = new Set(['Ready for Release','QA Approved'])
const PR_OPEN_STATES   = new Set(['open','in_review','draft'])

// ── Health colours ────────────────────────────────────────────────────────────

const HEALTH_CONFIG = {
  healthy:        { label: 'Healthy',         color: '#059669', bg: '#ecfdf5' },
  needs_attention:{ label: 'Needs Attention', color: '#d97706', bg: '#fffbeb' },
  release_ready:  { label: 'Release Ready',   color: '#0891b2', bg: '#ecfeff' },
  blocked:        { label: 'Blocked',         color: '#dc2626', bg: '#fef2f2' },
}

function calcHealth(proj, issues, today) {
  const nonCanceled = issues.filter(i => normalizeStatus(i.status) !== 'Canceled')
  const overdue     = nonCanceled.filter(i => {
    const d = parseDateMidnight(i.dueDate)
    return d && d < today && !['Done'].includes(normalizeStatus(i.status))
  }).length
  const rfr     = nonCanceled.filter(i => RELEASE_STATUSES.has(normalizeStatus(i.status))).length
  const highPri = nonCanceled.filter(i => ['Urgent','High'].includes(normalizePriority(i.priority))).length
  if (overdue > 0 && overdue >= Math.max(2, nonCanceled.length * 0.3)) return 'blocked'
  if (rfr > 0) return 'release_ready'
  if (highPri > 3 || overdue > 0) return 'needs_attention'
  return 'healthy'
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, icon: Icon, color, sublabel, onClick, alert }) {
  return (
    <button
      type="button"
      className={`ldp__metric ${alert ? 'ldp__metric--alert' : ''} ${onClick ? 'ldp__metric--clickable' : ''}`}
      onClick={onClick}
      style={{ '--mc': color }}
    >
      <div className="ldp__metric-header">
        <span className="ldp__metric-label">{label}</span>
        {Icon && <Icon size={15} className="ldp__metric-icon" />}
      </div>
      <div className="ldp__metric-value">{value}</div>
      {sublabel && <div className="ldp__metric-sub">{sublabel}</div>}
    </button>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function DashSection({ title, icon: Icon, children, collapsible = false, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="ldp__section">
      <div className="ldp__section-header" onClick={collapsible ? () => setOpen(v => !v) : undefined}
        style={{ cursor: collapsible ? 'pointer' : 'default' }}>
        {Icon && <Icon size={14} className="ldp__section-icon" />}
        <h2 className="ldp__section-title">{title}</h2>
        {collapsible && (
          <span className="ldp__section-toggle">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
        )}
      </div>
      {(!collapsible || open) && <div className="ldp__section-body">{children}</div>}
    </section>
  )
}

// ── Status distribution bar ───────────────────────────────────────────────────

function StatusDistribution({ issues }) {
  const counts = useMemo(() => {
    const map = {}
    for (const iss of issues) {
      const s = normalizeStatus(iss.status)
      map[s] = (map[s] || 0) + 1
    }
    return map
  }, [issues])
  const total = issues.length || 1
  const order = ['Backlog','Todo','In Progress','In Review','Ready for Release','QA Approved','Done','Canceled']
  const STATUS_COLORS_MAP = {
    'Backlog':'#9ca3af','Todo':'#6b7280','In Progress':'#3b82f6',
    'In Review':'#8b5cf6','Ready for Release':'#10b981','QA Approved':'#0891b2',
    'Done':'#059669','Canceled':'#4b5563',
  }
  return (
    <div className="ldp__dist">
      <div className="ldp__dist-bar">
        {order.map(s => {
          const n = counts[s] || 0
          if (!n) return null
          const w = (n / total * 100).toFixed(1)
          return (
            <div
              key={s}
              className="ldp__dist-seg"
              style={{ width: `${w}%`, background: STATUS_COLORS_MAP[s] || '#9ca3af' }}
              title={`${s}: ${n}`}
            />
          )
        })}
      </div>
      <div className="ldp__dist-legend">
        {order.map(s => {
          const n = counts[s] || 0
          if (!n) return null
          return (
            <span key={s} className="ldp__dist-item">
              <span className="ldp__dist-dot" style={{ background: STATUS_COLORS_MAP[s] }} />
              <span className="ldp__dist-name">{s}</span>
              <span className="ldp__dist-n">{n}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ── Priority distribution ─────────────────────────────────────────────────────

function PriorityBars({ issues }) {
  const PRIS = ['Urgent','High','Medium','Low','No Priority']
  const PCOLORS = { Urgent:'#ef4444', High:'#f97316', Medium:'#f59e0b', Low:'#6b7280', 'No Priority':'#d1d5db' }
  const counts = useMemo(() => {
    const m = {}
    for (const iss of issues) {
      const p = normalizePriority(iss.priority) || 'No Priority'
      m[p] = (m[p] || 0) + 1
    }
    return m
  }, [issues])
  const max = Math.max(1, ...Object.values(counts))
  return (
    <div className="ldp__pris">
      {PRIS.map(p => {
        const n = counts[p] || 0
        return (
          <div key={p} className="ldp__pri-row">
            <span className="ldp__pri-label">{p}</span>
            <div className="ldp__pri-track">
              <div className="ldp__pri-fill" style={{ width: `${(n/max)*100}%`, background: PCOLORS[p] }} />
            </div>
            <span className="ldp__pri-count">{n}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Project health card ───────────────────────────────────────────────────────

function ProjectHealthCard({ ph, onClick }) {
  const hc = HEALTH_CONFIG[ph.health] || HEALTH_CONFIG.healthy
  return (
    <div className="ldp__proj-card" onClick={onClick}>
      <div className="ldp__proj-card-header">
        <span className="ldp__proj-name">{ph.proj.name}</span>
        <span className="ldp__health-badge" style={{ '--hc': hc.color, '--hcbg': hc.bg }}>{hc.label}</span>
      </div>
      <div className="ldp__proj-stats">
        <span className="ldp__pstat"><span className="ldp__pstat-n">{ph.open}</span><span>Open</span></span>
        <span className="ldp__pstat"><span className="ldp__pstat-n ldp__pstat-n--blue">{ph.inProgress}</span><span>In Progress</span></span>
        <span className="ldp__pstat"><span className="ldp__pstat-n ldp__pstat-n--cyan">{ph.rfr}</span><span>Release Ready</span></span>
        <span className="ldp__pstat"><span className="ldp__pstat-n ldp__pstat-n--green">{ph.done}</span><span>Done</span></span>
        {ph.overdue > 0 && <span className="ldp__pstat"><span className="ldp__pstat-n ldp__pstat-n--red">{ph.overdue}</span><span>Overdue</span></span>}
        {ph.highPri > 0 && <span className="ldp__pstat"><span className="ldp__pstat-n ldp__pstat-n--orange">{ph.highPri}</span><span>High Pri</span></span>}
      </div>
      <div className="ldp__proj-progress-track" title={`${ph.done}/${ph.total} done (${ph.progress}%)`}>
        <div className="ldp__proj-progress-fill" style={{ width: `${ph.progress}%` }} />
      </div>
      <div className="ldp__proj-progress-label">{ph.done}/{ph.total} issues done</div>
    </div>
  )
}

// ── Quick action button ───────────────────────────────────────────────────────

function QA({ label, Icon, to, color, onClick }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="ldp__qa-btn"
      style={{ '--qa': color || 'var(--primary, #6366f1)' }}
      onClick={onClick || (() => navigate(to))}
    >
      {Icon && <Icon size={14} />}
      {label}
    </button>
  )
}

// ── Attention issue row ───────────────────────────────────────────────────────

function AttentionIssueRow({ issue, projectsMap, onClick }) {
  const proj  = projectsMap[issue.projectId]
  const key   = issueKey(proj?.name, issue.id)
  const st    = normalizeStatus(issue.status)
  const pri   = normalizePriority(issue.priority)
  const sCfg  = STATUS_CONFIG[st]    || STATUS_CONFIG.Backlog
  const pCfg  = PRIORITY_CONFIG[pri] || PRIORITY_CONFIG['No Priority']
  return (
    <div className="ldp__att-row" onClick={() => onClick(issue)} role="button" tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter') && onClick(issue)}>
      <sCfg.Icon size={12} style={{ color: sCfg.color, flexShrink: 0 }} />
      <span className="ldp__att-key">{key}</span>
      <span className="ldp__att-title">{issue.title}</span>
      <pCfg.Icon size={11} style={{ color: pCfg.color, flexShrink: 0 }} title={pri} />
      <span className="ldp__att-status">{st}</span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LinearDashboardPage() {
  const navigate  = useNavigate()
  const {
    projects, members, loadingProjects, loadingTasks, error,
    getTasksForProject, getCyclesForProject, actions,
  } = useTeamProjectsContext()

  const fetchedRef = useRef(false)
  const [allIssues, setAllIssues] = useState([])
  const [allCycles, setAllCycles] = useState([])
  const [panelIssue, setPanelIssue] = useState(null)

  // Filters
  const [filterProject,  setFilterProject]  = useState('all')
  const [filterCycle,    setFilterCycle]    = useState('all')
  const [filterAssignee, setFilterAssignee] = useState('all')
  const [dateRange,      setDateRange]      = useState('all')

  const [mobileReleases, setMobileReleases] = useState([])
  const [webDeployments, setWebDeployments] = useState([])

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    actions.fetchProjects()
    actions.fetchMembers()
  }, []) // eslint-disable-line

  useEffect(() => {
    if (!projects.length) return
    const fetch = async () => {
      const allT = []; const allC = []
      for (const p of projects) {
        await actions.fetchTasks(p.id)
        await actions.fetchCycles(p.id)
        allT.push(...(getTasksForProject(p.id) || []))
        allC.push(...(getCyclesForProject(p.id) || []))
      }
      setAllIssues(allT)
      setAllCycles(allC)
    }
    fetch()
  }, [projects]) // eslint-disable-line

  useEffect(() => {
    const issues = []
    for (const p of projects) issues.push(...(getTasksForProject(p.id) || []))
    setAllIssues(issues)
  }, [projects, getTasksForProject])

  useEffect(() => {
    setMobileReleases(loadMobileReleases())
    setWebDeployments(loadWebDeployments())
  }, [])

  const projectsMap = useMemo(() => {
    const m = {}; projects.forEach(p => m[p.id] = p); return m
  }, [projects])

  const membersMap = useMemo(() => {
    const m = {}; members.forEach(mb => m[mb.id] = mb); return m
  }, [members])

  const cyclesMap = useMemo(() => {
    const m = {}; allCycles.forEach(c => m[c.id] = c); return m
  }, [allCycles])

  // ── Date range boundaries ──────────────────────────────────────────────────
  const dateFrom = useMemo(() => {
    if (dateRange === 'this_week')  return weekStart()
    if (dateRange === 'last_7d')    return new Date(Date.now() - 7 * 86400000)
    if (dateRange === 'this_month') return monthStart()
    return null
  }, [dateRange])

  // ── Apply filters ──────────────────────────────────────────────────────────
  const filteredIssues = useMemo(() => {
    return allIssues.filter(iss => {
      if (filterProject  !== 'all' && String(iss.projectId)      !== filterProject)  return false
      if (filterCycle    !== 'all' && String(iss.sprintId)        !== filterCycle)    return false
      if (filterAssignee !== 'all' && String(iss.assigneeUserId)  !== filterAssignee) return false
      if (dateFrom) {
        const upd = parseDateMidnight(iss.updatedAt || iss.createdAt)
        if (!upd || upd < dateFrom) return false
      }
      return true
    })
  }, [allIssues, filterProject, filterCycle, filterAssignee, dateFrom])

  // ── Top metrics ────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const today = todayStart()
    const active = filteredIssues.filter(i => !['Canceled'].includes(normalizeStatus(i.status)))
    return {
      open:          active.filter(i => !['Done','QA Approved'].includes(normalizeStatus(i.status)) && normalizeStatus(i.status) !== 'Canceled').length,
      inProgress:    active.filter(i => normalizeStatus(i.status) === 'In Progress').length,
      inReview:      active.filter(i => normalizeStatus(i.status) === 'In Review').length,
      readyForRelease: active.filter(i => normalizeStatus(i.status) === 'Ready for Release').length,
      qaApproved:    active.filter(i => normalizeStatus(i.status) === 'QA Approved').length,
      done:          filteredIssues.filter(i => normalizeStatus(i.status) === 'Done').length,
      overdue:       active.filter(i => {
        const d = parseDateMidnight(i.dueDate)
        return d && d < today && !['Done','Canceled'].includes(normalizeStatus(i.status))
      }).length,
      blocked:       active.filter(i => i.blockedReason && i.blockedReason.trim()).length,
      unassignedHighPri: active.filter(i => !i.assigneeUserId && ['Urgent','High'].includes(normalizePriority(i.priority))).length,
      sopNeedsWork:  active.filter(i => issueNeedsSop(i, projectsMap[i.projectId])).length,
      total:         filteredIssues.length,
    }
  }, [filteredIssues])

  // ── Project health ─────────────────────────────────────────────────────────
  const projectHealth = useMemo(() => {
    const today = todayStart()
    return projects.map(proj => {
      const issues = filteredIssues.filter(i => i.projectId === proj.id)
      if (!issues.length) return null
      const nc    = issues.filter(i => normalizeStatus(i.status) !== 'Canceled')
      const done  = issues.filter(i => normalizeStatus(i.status) === 'Done').length
      return {
        proj,
        total:      issues.length,
        open:       nc.filter(i => normalizeStatus(i.status) !== 'Done').length,
        inProgress: nc.filter(i => normalizeStatus(i.status) === 'In Progress').length,
        rfr:        nc.filter(i => RELEASE_STATUSES.has(normalizeStatus(i.status))).length,
        done,
        overdue:    nc.filter(i => {
          const d = parseDateMidnight(i.dueDate)
          return d && d < today && !['Done'].includes(normalizeStatus(i.status))
        }).length,
        highPri:    nc.filter(i => ['Urgent','High'].includes(normalizePriority(i.priority))).length,
        progress:   issues.length > 0 ? Math.round((done / issues.length) * 100) : 0,
        health:     calcHealth(proj, issues, today),
      }
    }).filter(Boolean).sort((a, b) => {
      const ORDER = ['blocked','needs_attention','release_ready','healthy']
      return ORDER.indexOf(a.health) - ORDER.indexOf(b.health)
    })
  }, [projects, filteredIssues])

  // ── Release readiness ──────────────────────────────────────────────────────
  const releaseReadiness = useMemo(() => {
    const rfrIssues = filteredIssues.filter(i => normalizeStatus(i.status) === 'Ready for Release')
    return {
      notQaApproved: rfrIssues.filter(i => !i.devMeta?.qaApproval?.approved),
      qaNotDone:     filteredIssues.filter(i => normalizeStatus(i.status) === 'QA Approved'),
      prOpen:        filteredIssues.filter(i =>
        RELEASE_STATUSES.has(normalizeStatus(i.status)) && PR_OPEN_STATES.has(i.devMeta?.prStatus)
      ),
      upcomingMobile: mobileReleases
        .filter(r => !['Released','Rejected'].includes(r.status))
        .sort((a, b) => (a.targetDate || '').localeCompare(b.targetDate || ''))
        .slice(0, 3),
      upcomingDeploys: webDeployments
        .filter(d => !['Verified','Rolled Back','Failed'].includes(d.status))
        .sort((a, b) => (a.targetDate || '').localeCompare(b.targetDate || ''))
        .slice(0, 3),
    }
  }, [filteredIssues, mobileReleases, webDeployments])

  // ── Workload risk ──────────────────────────────────────────────────────────
  const workloadRisk = useMemo(() => {
    const counts = {}, inReview = {}, highPri = {}
    members.forEach(m => { counts[m.id] = 0; inReview[m.id] = 0; highPri[m.id] = 0 })
    const unassigned = []
    for (const iss of filteredIssues) {
      const st = normalizeStatus(iss.status)
      if (['Done','Canceled'].includes(st)) continue
      if (!iss.assigneeUserId) { unassigned.push(iss); continue }
      counts[iss.assigneeUserId]   = (counts[iss.assigneeUserId]   || 0) + 1
      if (st === 'In Review') inReview[iss.assigneeUserId] = (inReview[iss.assigneeUserId] || 0) + 1
      if (['Urgent','High'].includes(normalizePriority(iss.priority)))
        highPri[iss.assigneeUserId] = (highPri[iss.assigneeUserId] || 0) + 1
    }
    const loaded = members
      .map(m => ({ member: m, count: counts[m.id] || 0, inReview: inReview[m.id] || 0, highPri: highPri[m.id] || 0 }))
      .filter(m => m.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
    const riskyUnassigned = unassigned
      .filter(i => ['Urgent','High'].includes(normalizePriority(i.priority)))
      .slice(0, 5)
    return { loaded, riskyUnassigned, unassignedCount: unassigned.length }
  }, [filteredIssues, members])

  // ── Attention items ────────────────────────────────────────────────────────
  const attentionItems = useMemo(() => {
    const today = todayStart()
    const items = filteredIssues.filter(i => {
      const st  = normalizeStatus(i.status)
      const pri = normalizePriority(i.priority)
      if (['Done','Canceled'].includes(st)) return false
      const isOverdue = parseDateMidnight(i.dueDate) < today && i.dueDate
      const isHighPri = ['Urgent','High'].includes(pri)
      const isBlocked = !!i.blockedReason
      const isRFR     = st === 'Ready for Release' && !i.devMeta?.qaApproval?.approved
      return isOverdue || isHighPri || isBlocked || isRFR
    }).sort((a, b) => {
      const ORDER = ['Urgent','High','Medium','Low','No Priority']
      return ORDER.indexOf(normalizePriority(a.priority)) - ORDER.indexOf(normalizePriority(b.priority))
    }).slice(0, 10)
    return items
  }, [filteredIssues])

  const handleOpenIssue   = useCallback(iss => setPanelIssue(iss), [])
  const handleClosePanel  = useCallback(() => setPanelIssue(null), [])
  const handleUpdate      = useCallback(async (pId, tId, data) => actions.updateTask(pId, tId, data), [actions])
  const handleDelete      = useCallback(async (pId, tId) => { await actions.deleteTask(pId, tId); setPanelIssue(null) }, [actions])

  const filterActive = filterProject !== 'all' || filterCycle !== 'all' || filterAssignee !== 'all' || dateRange !== 'all'
  const loading      = loadingProjects || loadingTasks

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="ldp">
      <LinearSidebar />

      <div className="ldp__body">
        {/* ── Top bar ──────────────────────────────────────────────────── */}
        <header className="ldp__topbar">
          <div className="ldp__topbar-left">
            <LayoutDashboard size={16} className="ldp__topbar-icon" />
            <h1 className="ldp__topbar-title">Dashboard</h1>
            {loading && <RefreshCw size={13} className="ldp__topbar-spin" />}
          </div>
          <div className="ldp__topbar-right">
            {/* Filters */}
            <Filter size={12} className="ldp__filter-icon" />
            <select className="ldp__filter-select" value={filterProject} onChange={e => setFilterProject(e.target.value)}>
              <option value="all">All Projects</option>
              {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
            <select className="ldp__filter-select" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
              <option value="all">All Members</option>
              {members.map(m => <option key={m.id} value={String(m.id)}>{m.displayName || m.username}</option>)}
            </select>
            <select className="ldp__filter-select" value={dateRange} onChange={e => setDateRange(e.target.value)}>
              <option value="all">All Time</option>
              <option value="this_week">This Week</option>
              <option value="last_7d">Last 7 Days</option>
              <option value="this_month">This Month</option>
            </select>
            {filterActive && (
              <button className="ldp__filter-clear" onClick={() => { setFilterProject('all'); setFilterAssignee('all'); setFilterCycle('all'); setDateRange('all') }}>
                <XCircle size={12} /> Clear
              </button>
            )}
          </div>
        </header>

        <main className="ldp__main">
          {error && <div className="ldp__error">{error}</div>}

          {/* ── Quick Actions ──────────────────────────────────────────── */}
          <div className="ldp__qa-bar">
            <QA label="New Issue"              Icon={Plus}       to="/projects/linear"          color="#6366f1" />
            <QA label="Inbox"                  Icon={Inbox}      to="/projects/linear/inbox"    color="#f59e0b" />
            <QA label="Roadmap"                Icon={Map}        to="/projects/linear/roadmap"  color="#10b981" />
            <QA label="Releases"               Icon={Rocket}     to="/projects/linear/releases" color="#0891b2" />
            <QA label="Workload"               Icon={BarChart2}  to="/projects/linear/workload" color="#8b5cf6" />
            <QA label="Mobile Release"         Icon={Smartphone} to="/projects/linear/releases" color="#16a34a" />
            <QA label="Website Deployment"     Icon={Globe}      to="/projects/linear/releases" color="#2563eb" />
          </div>

          {/* ── Top Metrics ────────────────────────────────────────────── */}
          <DashSection title="Overview" icon={TrendingUp}>
            <div className="ldp__metrics-grid">
              <MetricCard label="Open Issues"          value={metrics.open}               icon={Circle}        color="#6b7280"  sublabel={`of ${metrics.total} total`} />
              <MetricCard label="In Progress"          value={metrics.inProgress}         icon={LayoutDashboard} color="#3b82f6"  onClick={() => navigate('/projects/linear')} />
              <MetricCard label="In Review"            value={metrics.inReview}           icon={AlertCircle}   color="#8b5cf6"  />
              <MetricCard label="Ready for Release"    value={metrics.readyForRelease}    icon={Rocket}        color="#10b981"  onClick={() => navigate('/projects/linear/releases')} />
              <MetricCard label="QA Approved"          value={metrics.qaApproved}         icon={ShieldCheck}   color="#0891b2"  />
              <MetricCard label="Done"                 value={metrics.done}               icon={CheckCircle2}  color="#059669"  />
              <MetricCard label="Overdue"              value={metrics.overdue}            icon={Clock}          color="#ef4444"  alert={metrics.overdue > 0} sublabel={metrics.overdue > 0 ? 'Needs attention' : 'All on track'} />
              <MetricCard label="Unassigned High Pri"  value={metrics.unassignedHighPri}  icon={AlertTriangle}  color="#f59e0b"  alert={metrics.unassignedHighPri > 0} onClick={() => navigate('/projects/linear')} />
              <MetricCard label="SOP Needs Work"       value={metrics.sopNeedsWork}       icon={ClipboardList}  color="#7c3aed"  alert={metrics.sopNeedsWork > 0} sublabel={metrics.sopNeedsWork > 0 ? 'Checklists incomplete' : 'All good'} onClick={() => navigate('/projects/linear/inbox')} />
            </div>
          </DashSection>

          {/* ── Status + Priority ──────────────────────────────────────── */}
          <div className="ldp__two-col">
            <DashSection title="Issue Status Distribution" icon={LayoutDashboard}>
              <StatusDistribution issues={filteredIssues} />
            </DashSection>
            <DashSection title="Issues by Priority" icon={AlertTriangle}>
              <PriorityBars issues={filteredIssues} />
            </DashSection>
          </div>

          {/* ── Project Health ─────────────────────────────────────────── */}
          {projectHealth.length > 0 && (
            <DashSection title="Project Health" icon={CheckCircle2}>
              <div className="ldp__proj-grid">
                {projectHealth.map(ph => (
                  <ProjectHealthCard
                    key={ph.proj.id}
                    ph={ph}
                    onClick={() => { setFilterProject(String(ph.proj.id)) }}
                  />
                ))}
              </div>
            </DashSection>
          )}

          {/* ── Release Readiness + Workload Risk ──────────────────────── */}
          <div className="ldp__two-col">

            {/* Release Readiness */}
            <DashSection title="Release Readiness" icon={Rocket}>
              <div className="ldp__readiness">
                {/* Not QA Approved */}
                <div className={`ldp__readiness-item ${releaseReadiness.notQaApproved.length > 0 ? 'ldp__readiness-item--warn' : 'ldp__readiness-item--ok'}`}>
                  <div className="ldp__readiness-row">
                    <ShieldCheck size={13} />
                    <span>Ready for Release — Not QA Approved</span>
                    <span className="ldp__readiness-n">{releaseReadiness.notQaApproved.length}</span>
                  </div>
                  {releaseReadiness.notQaApproved.slice(0,3).map(i => (
                    <AttentionIssueRow key={i.id} issue={i} projectsMap={projectsMap} onClick={handleOpenIssue} />
                  ))}
                </div>
                {/* QA Approved not Done */}
                <div className={`ldp__readiness-item ${releaseReadiness.qaNotDone.length > 0 ? 'ldp__readiness-item--info' : 'ldp__readiness-item--ok'}`}>
                  <div className="ldp__readiness-row">
                    <CheckCircle2 size={13} />
                    <span>QA Approved — Awaiting Release</span>
                    <span className="ldp__readiness-n">{releaseReadiness.qaNotDone.length}</span>
                  </div>
                </div>
                {/* Open PRs on release issues */}
                {releaseReadiness.prOpen.length > 0 && (
                  <div className="ldp__readiness-item ldp__readiness-item--warn">
                    <div className="ldp__readiness-row">
                      <AlertTriangle size={13} />
                      <span>Open PRs on Release Issues</span>
                      <span className="ldp__readiness-n">{releaseReadiness.prOpen.length}</span>
                    </div>
                  </div>
                )}
                {/* Upcoming mobile releases */}
                {releaseReadiness.upcomingMobile.length > 0 && (
                  <div className="ldp__readiness-item ldp__readiness-item--neutral">
                    <div className="ldp__readiness-row">
                      <Smartphone size={13} />
                      <span>Upcoming Mobile Releases</span>
                      <span className="ldp__readiness-n">{releaseReadiness.upcomingMobile.length}</span>
                    </div>
                    {releaseReadiness.upcomingMobile.map(r => (
                      <div key={r.id} className="ldp__release-item">
                        <span className="ldp__release-name">{r.name}</span>
                        <span className="ldp__release-status">{r.status}</span>
                        {r.targetDate && <span className="ldp__release-date">{fmtDate(r.targetDate)} <em>{daysUntil(r.targetDate)}</em></span>}
                      </div>
                    ))}
                  </div>
                )}
                {/* Upcoming deployments */}
                {releaseReadiness.upcomingDeploys.length > 0 && (
                  <div className="ldp__readiness-item ldp__readiness-item--neutral">
                    <div className="ldp__readiness-row">
                      <Server size={13} />
                      <span>Upcoming Deployments</span>
                      <span className="ldp__readiness-n">{releaseReadiness.upcomingDeploys.length}</span>
                    </div>
                    {releaseReadiness.upcomingDeploys.map(d => (
                      <div key={d.id} className="ldp__release-item">
                        <span className="ldp__release-name">{d.name}</span>
                        <span className="ldp__release-status">{d.status}</span>
                        {d.targetDate && <span className="ldp__release-date">{fmtDate(d.targetDate)} <em>{daysUntil(d.targetDate)}</em></span>}
                      </div>
                    ))}
                  </div>
                )}
                {releaseReadiness.notQaApproved.length === 0 && releaseReadiness.qaNotDone.length === 0 && releaseReadiness.prOpen.length === 0 && (
                  <p className="ldp__readiness-all-ok">✓ All release issues are QA approved</p>
                )}
                <button className="ldp__readiness-link" onClick={() => navigate('/projects/linear/releases')}>
                  <ArrowRight size={12} /> Go to Releases
                </button>
              </div>
            </DashSection>

            {/* Workload Risk */}
            <DashSection title="Workload & Risk" icon={Users}>
              <div className="ldp__workload">
                {/* Top loaded members */}
                {workloadRisk.loaded.length > 0 && (
                  <div className="ldp__wl-section">
                    <p className="ldp__wl-label">Member Workload (active issues)</p>
                    {workloadRisk.loaded.map(({ member: m, count, inReview: ir, highPri: hp }) => (
                      <div key={m.id} className="ldp__wl-row">
                        <span className="ldp__wl-avatar">{(m.displayName || m.username || '?').slice(0,2).toUpperCase()}</span>
                        <span className="ldp__wl-name">{m.displayName || m.username}</span>
                        <div className="ldp__wl-bar-wrap">
                          <div className="ldp__wl-bar" style={{ width: `${Math.min(100, (count / 12) * 100)}%`, background: count > 12 ? '#ef4444' : count > 7 ? '#f59e0b' : '#10b981' }} />
                        </div>
                        <span className="ldp__wl-count">{count}</span>
                        {ir > 0 && <span className="ldp__wl-chip ldp__wl-chip--review">{ir} review</span>}
                        {hp > 0 && <span className="ldp__wl-chip ldp__wl-chip--high">{hp} high</span>}
                      </div>
                    ))}
                  </div>
                )}
                {/* Unassigned */}
                <div className="ldp__wl-section">
                  <p className="ldp__wl-label">
                    Unassigned Issues
                    <span className="ldp__wl-badge">{workloadRisk.unassignedCount}</span>
                  </p>
                  {workloadRisk.riskyUnassigned.length > 0 && (
                    <>
                      <p className="ldp__wl-sublabel">High priority unassigned:</p>
                      {workloadRisk.riskyUnassigned.map(i => (
                        <AttentionIssueRow key={i.id} issue={i} projectsMap={projectsMap} onClick={handleOpenIssue} />
                      ))}
                    </>
                  )}
                </div>
                <button className="ldp__readiness-link" onClick={() => navigate('/projects/linear/workload')}>
                  <ArrowRight size={12} /> Go to Workload
                </button>
              </div>
            </DashSection>
          </div>

          {/* ── Attention items ────────────────────────────────────────── */}
          {attentionItems.length > 0 && (
            <DashSection title="Needs Attention" icon={AlertTriangle} collapsible defaultOpen={true}>
              <div className="ldp__att-list">
                {attentionItems.map(i => (
                  <AttentionIssueRow key={i.id} issue={i} projectsMap={projectsMap} onClick={handleOpenIssue} />
                ))}
              </div>
              <button className="ldp__readiness-link" onClick={() => navigate('/projects/linear/inbox')}>
                <ArrowRight size={12} /> Go to Inbox for more
              </button>
            </DashSection>
          )}
        </main>
      </div>

      <IssueDetailPanel
        issue={panelIssue}
        project={panelIssue ? projectsMap[panelIssue.projectId] : null}
        members={members}
        cycles={panelIssue ? allCycles.filter(c => c.projectId === panelIssue.projectId) : []}
        open={!!panelIssue}
        onClose={handleClosePanel}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  )
}
