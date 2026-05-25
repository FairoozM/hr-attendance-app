/**
 * LinearWeeklyReportPage.jsx
 * /#/projects/linear/reports/weekly
 *
 * Executive weekly product/dev report for Life Smile.
 * Read-only. No mutations. Data from TeamProjectsContext + localStorage.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText, Calendar, RefreshCw, Copy, CheckCircle2, Printer,
  AlertTriangle, Rocket, ShieldCheck, Clock, Users, XCircle,
  Circle, ArrowRight, Smartphone, Globe, Server, Filter,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import { LinearSidebar }  from '../../components/linear/LinearSidebar'
import { IssueDetailPanel } from '../../components/linear/IssueDetailPanel'
import {
  normalizeStatus, normalizePriority, issueKey,
  STATUS_CONFIG, PRIORITY_CONFIG,
} from '../../components/linear/IssueRow'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import { loadMobileReleases, loadWebDeployments, loadReleaseApprovalDraft } from '../../lib/linearReleaseStorage'
import './LinearWeeklyReportPage.css'

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayStart() { const d = new Date(); d.setHours(0,0,0,0); return d }

function weekBounds() {
  const today = todayStart()
  const dow   = today.getDay()                             // 0=Sun
  const mon   = new Date(today); mon.setDate(today.getDate() - ((dow + 6) % 7))
  const sun   = new Date(mon);   sun.setDate(mon.getDate() + 6)
  sun.setHours(23,59,59,999)
  return { mon, sun }
}

function nextWeekBounds() {
  const { mon } = weekBounds()
  const nMon = new Date(mon); nMon.setDate(mon.getDate() + 7)
  const nSun = new Date(nMon); nSun.setDate(nMon.getDate() + 6); nSun.setHours(23,59,59,999)
  return { mon: nMon, sun: nSun }
}

function parseDateMidnight(str) {
  if (!str) return null
  try {
    const d = new Date(str.length <= 10 ? str + 'T00:00:00' : str)
    if (isNaN(d)) return null
    d.setHours(0,0,0,0)
    return d
  } catch { return null }
}

function fmtDate(d) {
  if (!d) return '—'
  const date = typeof d === 'string' ? parseDateMidnight(d) : d
  if (!date) return '—'
  return date.toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateShort(d) {
  if (!d) return '—'
  const date = typeof d === 'string' ? parseDateMidnight(d) : d
  if (!date) return '—'
  return date.toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })
}

function isInRange(dateStr, from, to) {
  const d = parseDateMidnight(dateStr)
  if (!d) return false
  return d >= from && d <= to
}

function daysAgo(str) {
  const d = parseDateMidnight(str); if (!d) return null
  const diff = Math.floor((todayStart() - d) / 86400000)
  if (diff === 0) return 'today'
  if (diff === 1) return '1d ago'
  return `${diff}d ago`
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
      return true
    } catch { return false }
  }
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyBtn({ text, label, icon: Icon, variant = 'default', small = false }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    const ok = await copyText(text)
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800) }
  }
  return (
    <button
      type="button"
      className={`wrp__copy-btn wrp__copy-btn--${variant} ${small ? 'wrp__copy-btn--small' : ''} ${copied ? 'wrp__copy-btn--copied' : ''}`}
      onClick={handle}
    >
      {copied ? <CheckCircle2 size={small ? 12 : 13} /> : Icon ? <Icon size={small ? 12 : 13} /> : <Copy size={small ? 12 : 13} />}
      {copied ? 'Copied!' : label}
    </button>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function ReportSection({ id, title, icon: Icon, badge, children, collapsible = true, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="wrp__section" id={id}>
      <div
        className="wrp__section-header"
        onClick={collapsible ? () => setOpen(v => !v) : undefined}
        style={{ cursor: collapsible ? 'pointer' : 'default' }}
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        onKeyDown={collapsible ? e => e.key === 'Enter' && setOpen(v => !v) : undefined}
      >
        {Icon && <Icon size={14} className="wrp__section-icon" />}
        <span className="wrp__section-title">{title}</span>
        {badge != null && <span className="wrp__section-badge">{badge}</span>}
        {collapsible && (
          <span className="wrp__section-toggle">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
        )}
      </div>
      {(!collapsible || open) && <div className="wrp__section-body">{children}</div>}
    </section>
  )
}

// ── Issue row in report ───────────────────────────────────────────────────────

function ReportIssueRow({ issue, projectsMap, membersMap, onClick, extra }) {
  const proj  = projectsMap[issue.projectId]
  const key   = issueKey(proj?.name, issue.id)
  const st    = normalizeStatus(issue.status)
  const pri   = normalizePriority(issue.priority)
  const sCfg  = STATUS_CONFIG[st]    || STATUS_CONFIG.Backlog
  const pCfg  = PRIORITY_CONFIG[pri] || PRIORITY_CONFIG['No Priority']
  const assignee = issue.assigneeUserId ? membersMap[issue.assigneeUserId] : null
  const prStatus = issue.devMeta?.prStatus
  return (
    <div
      className="wrp__issue-row"
      onClick={() => onClick(issue)}
      role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick(issue)}
    >
      <sCfg.Icon size={12} style={{ color: sCfg.color, flexShrink: 0 }} title={st} />
      <pCfg.Icon size={11} style={{ color: pCfg.color, flexShrink: 0 }} title={pri} />
      <span className="wrp__issue-key">{key}</span>
      <span className="wrp__issue-title">{issue.title}</span>
      {proj && <span className="wrp__issue-proj">{proj.name}</span>}
      {assignee && (
        <span className="wrp__issue-avatar" title={assignee.displayName || assignee.username}>
          {(assignee.displayName || assignee.username || '?').slice(0,2).toUpperCase()}
        </span>
      )}
      {prStatus && (
        <span className={`wrp__issue-pr wrp__issue-pr--${prStatus}`}>{prStatus.replace('_',' ')}</span>
      )}
      {extra}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LinearWeeklyReportPage() {
  const navigate = useNavigate()
  const {
    projects, members, loadingProjects, loadingTasks, error,
    getTasksForProject, getCyclesForProject, actions,
  } = useTeamProjectsContext()

  const fetchedRef  = useRef(false)
  const [allIssues, setAllIssues] = useState([])
  const [allCycles, setAllCycles] = useState([])
  const [panelIssue, setPanelIssue] = useState(null)

  // Filters
  const [filterProject,  setFilterProject]  = useState('all')
  const [filterLabel,    setFilterLabel]    = useState('all')
  const [filterAssignee, setFilterAssignee] = useState('all')

  const [mobileReleases,    setMobileReleases]    = useState([])
  const [webDeployments,    setWebDeployments]    = useState([])
  const [releaseApproval,   setReleaseApproval]   = useState(null)

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
      for (const p of projects) {
        await actions.fetchTasks(p.id)
        await actions.fetchCycles(p.id)
      }
    }
    fetch()
  }, [projects]) // eslint-disable-line

  useEffect(() => {
    const issues = []; const cycles = []
    for (const p of projects) {
      issues.push(...(getTasksForProject(p.id) || []))
      cycles.push(...(getCyclesForProject(p.id) || []))
    }
    setAllIssues(issues)
    setAllCycles(cycles)
  }, [projects, getTasksForProject, getCyclesForProject])

  useEffect(() => {
    setMobileReleases(loadMobileReleases())
    setWebDeployments(loadWebDeployments())
    setReleaseApproval(loadReleaseApprovalDraft())
  }, [])

  const projectsMap = useMemo(() => {
    const m = {}; projects.forEach(p => m[p.id] = p); return m
  }, [projects])

  const membersMap = useMemo(() => {
    const m = {}; members.forEach(mb => m[mb.id] = mb); return m
  }, [members])

  // ── Week bounds ────────────────────────────────────────────────────────────
  const { mon: weekMon, sun: weekSun } = useMemo(() => weekBounds(), [])
  const { mon: nextMon, sun: nextSun } = useMemo(() => nextWeekBounds(), [])

  const weekLabel = useMemo(
    () => `${fmtDateShort(weekMon)} – ${fmtDateShort(weekSun)}`,
    [weekMon, weekSun]
  )

  // ── Collect all labels ─────────────────────────────────────────────────────
  const allLabels = useMemo(() => {
    const set = new Set()
    allIssues.forEach(i => (i.labels || []).forEach(l => set.add(l)))
    return [...set].sort()
  }, [allIssues])

  // ── Apply filters ──────────────────────────────────────────────────────────
  const filteredIssues = useMemo(() => {
    return allIssues.filter(iss => {
      if (filterProject  !== 'all' && String(iss.projectId)     !== filterProject)  return false
      if (filterAssignee !== 'all' && String(iss.assigneeUserId) !== filterAssignee) return false
      if (filterLabel !== 'all') {
        if (!(iss.labels || []).includes(filterLabel)) return false
      }
      return true
    })
  }, [allIssues, filterProject, filterAssignee, filterLabel])

  // ── Computed report data ───────────────────────────────────────────────────
  const reportData = useMemo(() => {
    const today = todayStart()

    const active   = filteredIssues.filter(i => normalizeStatus(i.status) !== 'Canceled')
    const open     = active.filter(i => normalizeStatus(i.status) !== 'Done')

    // Completed this week = Done issues updated within this week
    const completedThisWeek = filteredIssues.filter(i => {
      if (normalizeStatus(i.status) !== 'Done') return false
      return isInRange(i.updatedAt || i.createdAt, weekMon, weekSun)
    })

    // Ready for release
    const rfrIssues  = open.filter(i => normalizeStatus(i.status) === 'Ready for Release')
    const qaApproved = open.filter(i => normalizeStatus(i.status) === 'QA Approved')

    // Blockers & risks
    const blocked  = open.filter(i => i.blockedReason && i.blockedReason.trim())
    const overdue  = open.filter(i => {
      const d = parseDateMidnight(i.dueDate)
      return d && d < today
    })
    const unassignedHighPri = open.filter(i =>
      !i.assigneeUserId && ['Urgent','High'].includes(normalizePriority(i.priority))
    )
    const prOpenOnRelease = filteredIssues.filter(i => {
      const st = normalizeStatus(i.status)
      return ['Ready for Release','QA Approved'].includes(st) &&
        ['open','in_review','draft'].includes(i.devMeta?.prStatus)
    })
    const rfrNotQa = rfrIssues.filter(i => !i.devMeta?.qaApproval?.approved)

    // Workload
    const wlMap = {}
    members.forEach(m => { wlMap[m.id] = { open: 0, inReview: 0, highPri: 0 } })
    let unassignedCount = 0
    for (const iss of open) {
      if (!iss.assigneeUserId) { unassignedCount++; continue }
      const e = wlMap[iss.assigneeUserId] || { open: 0, inReview: 0, highPri: 0 }
      e.open++
      if (normalizeStatus(iss.status) === 'In Review') e.inReview++
      if (['Urgent','High'].includes(normalizePriority(iss.priority))) e.highPri++
      wlMap[iss.assigneeUserId] = e
    }
    const topLoaded = members
      .map(m => ({ member: m, ...wlMap[m.id] || {} }))
      .filter(m => (m.open || 0) > 0)
      .sort((a,b) => (b.open||0) - (a.open||0))
      .slice(0, 6)

    // Upcoming releases (this week + next week)
    const upcomingMobile = mobileReleases.filter(r => {
      if (['Released','Rejected'].includes(r.status)) return false
      const d = parseDateMidnight(r.targetDate)
      return d && d <= nextSun
    }).sort((a,b) => (a.targetDate||'').localeCompare(b.targetDate||''))

    const upcomingDeploys = webDeployments.filter(d => {
      if (['Verified','Rolled Back','Failed'].includes(d.status)) return false
      const dt = parseDateMidnight(d.targetDate)
      return dt && dt <= nextSun
    }).sort((a,b) => (a.targetDate||'').localeCompare(b.targetDate||''))

    // Decisions needed
    const decisions = []
    if (unassignedHighPri.length > 0) decisions.push(`${unassignedHighPri.length} high/urgent issue(s) unassigned — assign ownership`)
    if (rfrNotQa.length > 0)          decisions.push(`${rfrNotQa.length} issue(s) ready for release but not QA approved`)
    if (blocked.length > 0)           decisions.push(`${blocked.length} blocked issue(s) need resolution`)
    const failedDeploys = webDeployments.filter(d => ['Failed','Rolled Back'].includes(d.status))
    if (failedDeploys.length > 0)     decisions.push(`${failedDeploys.length} failed/rolled back deployment(s) — review needed`)
    const rejectedMobile = mobileReleases.filter(r => r.status === 'Rejected')
    if (rejectedMobile.length > 0)    decisions.push(`${rejectedMobile.length} rejected mobile release(s) — action needed`)
    if (overdue.length > 0)           decisions.push(`${overdue.length} overdue issue(s) — reschedule or escalate`)

    return {
      open, completedThisWeek, rfrIssues, qaApproved,
      blocked, overdue, unassignedHighPri, prOpenOnRelease, rfrNotQa,
      topLoaded, unassignedCount, decisions,
      upcomingMobile, upcomingDeploys,
      totalOpen: open.length, totalActive: active.length,
    }
  }, [filteredIssues, members, weekMon, weekSun, nextSun, mobileReleases, webDeployments])

  // ── Copy helpers ───────────────────────────────────────────────────────────
  const generateExecutiveSummary = useCallback(() => {
    const { completedThisWeek: cw, totalOpen: tot, rfrIssues: rfr, qaApproved: qa,
            blocked, overdue, unassignedHighPri: uhp, upcomingMobile: um, upcomingDeploys: ud } = reportData
    const lines = [
      `📊 *Weekly Product Report — Life Smile Dev*`,
      `📅 Week: ${weekLabel}`,
      `🗓️ Generated: ${fmtDate(new Date())}`,
      ``,
      `*Executive Summary*`,
      `• ${tot} open issues across all projects`,
      `• ✅ ${cw.length} issue(s) completed this week`,
      `• 🚀 ${rfr.length} ready for release, ${qa.length} QA approved`,
      `• ⚠️ ${blocked.length} blocked, ${overdue.length} overdue`,
      `• 🔴 ${uhp.length} unassigned high/urgent issue(s)`,
    ]
    if (um.length > 0 || ud.length > 0) {
      lines.push(`• 📦 ${um.length + ud.length} release(s)/deployment(s) planned this/next week`)
    }
    return lines.join('\n')
  }, [reportData, weekLabel])

  const generateFullReport = useCallback(() => {
    const {
      completedThisWeek: cw, rfrIssues: rfr, qaApproved: qa,
      blocked, overdue, unassignedHighPri: uhp, prOpenOnRelease: prOpen,
      decisions, topLoaded, unassignedCount, upcomingMobile: um, upcomingDeploys: ud,
    } = reportData

    const issueStr = (iss) => {
      const p   = projectsMap[iss.projectId]
      const key = issueKey(p?.name, iss.id)
      const pri = normalizePriority(iss.priority)
      const asg = iss.assigneeUserId ? (membersMap[iss.assigneeUserId]?.displayName || membersMap[iss.assigneeUserId]?.username || '?') : 'Unassigned'
      return `  • ${key}: ${iss.title} (${pri} · ${asg})`
    }

    const lines = [
      `📊 WEEKLY PRODUCT REPORT — LIFE SMILE DEV`,
      `Week: ${weekLabel}  |  Generated: ${fmtDate(new Date())}`,
      `${'─'.repeat(50)}`,
      ``,
      `EXECUTIVE SUMMARY`,
      ...generateExecutiveSummary().split('\n').slice(5),
      ``,
      `${'─'.repeat(50)}`,
      `COMPLETED THIS WEEK (${cw.length})`,
    ]
    if (cw.length === 0) {
      lines.push(`  No issues completed this week`)
    } else {
      cw.forEach(i => lines.push(issueStr(i)))
    }

    lines.push(``, `${'─'.repeat(50)}`, `READY FOR RELEASE / QA APPROVED`)
    if (rfr.length === 0 && qa.length === 0) {
      lines.push(`  No issues ready for release`)
    } else {
      if (rfr.length) { lines.push(`  Ready for Release:`);  rfr.forEach(i => lines.push(issueStr(i))) }
      if (qa.length)  { lines.push(`  QA Approved:`);        qa.forEach(i => lines.push(issueStr(i))) }
    }

    lines.push(``, `${'─'.repeat(50)}`, `BLOCKERS & RISKS`)
    if (blocked.length === 0 && overdue.length === 0 && uhp.length === 0 && prOpen.length === 0) {
      lines.push(`  ✓ No blockers or risks identified`)
    } else {
      if (blocked.length)  { lines.push(`  Blocked:`);                blocked.forEach(i => { lines.push(`${issueStr(i)} — ${i.blockedReason}`) }) }
      if (overdue.length)  { lines.push(`  Overdue:`);                overdue.forEach(i => lines.push(issueStr(i))) }
      if (uhp.length)      { lines.push(`  High/Urgent Unassigned:`); uhp.forEach(i => lines.push(issueStr(i))) }
      if (prOpen.length)   { lines.push(`  Open PRs on Release Issues:`); prOpen.forEach(i => lines.push(issueStr(i))) }
    }

    if (um.length > 0 || ud.length > 0) {
      lines.push(``, `${'─'.repeat(50)}`, `UPCOMING RELEASES & DEPLOYMENTS`)
      um.forEach(r => lines.push(`  📱 ${r.name} [${r.platform}] — ${r.status} — ${fmtDate(r.targetDate)}`))
      ud.forEach(d => lines.push(`  🌐 ${d.name} [${d.type}] — ${d.status} — ${fmtDate(d.targetDate)}`))
    }

    lines.push(``, `${'─'.repeat(50)}`, `TEAM WORKLOAD`)
    topLoaded.slice(0,5).forEach(({ member: m, open: o, inReview: ir, highPri: hp }) => {
      const name = m.displayName || m.username
      const tags = []
      if (ir > 0) tags.push(`${ir} in review`)
      if (hp > 0) tags.push(`${hp} high pri`)
      lines.push(`  ${name}: ${o} open${tags.length ? ' (' + tags.join(', ') + ')' : ''}`)
    })
    lines.push(`  Unassigned: ${unassignedCount}`)

    if (decisions.length > 0) {
      lines.push(``, `${'─'.repeat(50)}`, `DECISIONS NEEDED`)
      decisions.forEach((d,i) => lines.push(`  ${i+1}. ${d}`))
    }

    lines.push(``, `— Report generated by Life Smile Dev Tracker`)
    return lines.join('\n')
  }, [reportData, projectsMap, membersMap, weekLabel, generateExecutiveSummary])

  const generateBlockersReport = useCallback(() => {
    const { blocked, overdue, unassignedHighPri: uhp, prOpenOnRelease: prOpen } = reportData
    const issueStr = (iss) => {
      const p   = projectsMap[iss.projectId]
      const key = issueKey(p?.name, iss.id)
      const asg = iss.assigneeUserId ? (membersMap[iss.assigneeUserId]?.displayName || membersMap[iss.assigneeUserId]?.username || '?') : 'Unassigned'
      return `• ${key}: ${iss.title} — ${asg}`
    }
    const lines = [
      `⚠️ BLOCKERS & RISKS REPORT`,
      `Week: ${weekLabel}  |  ${fmtDate(new Date())}`,
      ``,
    ]
    if (blocked.length)  { lines.push(`BLOCKED (${blocked.length})`);                blocked.forEach(i => lines.push(issueStr(i) + (i.blockedReason ? ` [${i.blockedReason}]` : ''))); lines.push('') }
    if (overdue.length)  { lines.push(`OVERDUE (${overdue.length})`);                overdue.forEach(i => lines.push(issueStr(i) + (i.dueDate ? ` [due ${fmtDate(i.dueDate)}]` : ''))); lines.push('') }
    if (uhp.length)      { lines.push(`HIGH/URGENT UNASSIGNED (${uhp.length})`);     uhp.forEach(i => lines.push(issueStr(i))); lines.push('') }
    if (prOpen.length)   { lines.push(`OPEN PRS ON RELEASE ISSUES (${prOpen.length})`); prOpen.forEach(i => lines.push(issueStr(i))); lines.push('') }
    if (blocked.length === 0 && overdue.length === 0 && uhp.length === 0 && prOpen.length === 0)
      lines.push('✓ No blockers or risks this week')
    return lines.join('\n')
  }, [reportData, projectsMap, membersMap, weekLabel])

  const generateReleasePlan = useCallback(() => {
    const { rfrIssues: rfr, qaApproved: qa, upcomingMobile: um, upcomingDeploys: ud } = reportData
    const lines = [
      `🚀 RELEASE PLAN`,
      `Week: ${weekLabel}  |  ${fmtDate(new Date())}`,
      ``,
    ]
    if (rfr.length > 0 || qa.length > 0) {
      lines.push('ISSUES FOR RELEASE')
      rfr.forEach(i => {
        const p   = projectsMap[i.projectId]
        const key = issueKey(p?.name, i.id)
        const qaStr = i.devMeta?.qaApproval?.approved ? '✓ QA' : '⚠ QA pending'
        lines.push(`• ${key}: ${i.title} — ${qaStr}`)
      })
      qa.forEach(i => {
        const p   = projectsMap[i.projectId]
        const key = issueKey(p?.name, i.id)
        lines.push(`• ${key}: ${i.title} — ✓ QA Approved`)
      })
      lines.push('')
    }
    if (um.length > 0) {
      lines.push('MOBILE RELEASES')
      um.forEach(r => {
        const range = isInRange(r.targetDate, weekMon, weekSun) ? 'this week' : 'next week'
        lines.push(`• ${r.name} [${r.platform}] v${r.version||'?'} — ${r.status} — ${fmtDate(r.targetDate)} (${range})`)
      })
      lines.push('')
    }
    if (ud.length > 0) {
      lines.push('WEBSITE / BACKEND DEPLOYMENTS')
      ud.forEach(d => {
        const range = isInRange(d.targetDate, weekMon, weekSun) ? 'this week' : 'next week'
        lines.push(`• ${d.name} [${d.type}] — ${d.status} — ${fmtDate(d.targetDate)} (${range})`)
      })
      lines.push('')
    }
    if (rfr.length === 0 && qa.length === 0 && um.length === 0 && ud.length === 0)
      lines.push('No releases or deployments planned this week')
    return lines.join('\n')
  }, [reportData, projectsMap, weekMon, weekSun, weekLabel])

  const handleOpenIssue  = useCallback(iss => setPanelIssue(iss), [])
  const handleClosePanel = useCallback(() => setPanelIssue(null), [])
  const handleUpdate     = useCallback(async (pId, tId, data) => actions.updateTask(pId, tId, data), [actions])
  const handleDelete     = useCallback(async (pId, tId) => { await actions.deleteTask(pId, tId); setPanelIssue(null) }, [actions])

  const filterActive = filterProject !== 'all' || filterAssignee !== 'all' || filterLabel !== 'all'
  const loading      = loadingProjects || loadingTasks

  const { completedThisWeek: cw, rfrIssues: rfr, qaApproved: qa,
          blocked, overdue, unassignedHighPri: uhp, prOpenOnRelease: prOpen,
          rfrNotQa, decisions, topLoaded, unassignedCount,
          upcomingMobile: um, upcomingDeploys: ud, totalOpen } = reportData

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="wrp">
      <LinearSidebar />

      <div className="wrp__body">
        {/* ── Top bar ──────────────────────────────────────────────────── */}
        <header className="wrp__topbar">
          <div className="wrp__topbar-left">
            <FileText size={16} className="wrp__topbar-icon" />
            <div>
              <h1 className="wrp__topbar-title">Weekly Product Report</h1>
              <div className="wrp__topbar-meta">
                <Calendar size={11} /> {weekLabel} &nbsp;·&nbsp; Generated {fmtDate(new Date())}
                {loading && <><RefreshCw size={11} className="wrp__spin" /> Updating…</>}
              </div>
            </div>
          </div>
          <div className="wrp__topbar-right">
            {/* Filters */}
            <Filter size={12} className="wrp__filter-icon" />
            <select className="wrp__filter-sel" value={filterProject}  onChange={e => setFilterProject(e.target.value)}>
              <option value="all">All Projects</option>
              {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
            <select className="wrp__filter-sel" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
              <option value="all">All Members</option>
              {members.map(m => <option key={m.id} value={String(m.id)}>{m.displayName || m.username}</option>)}
            </select>
            <select className="wrp__filter-sel" value={filterLabel}    onChange={e => setFilterLabel(e.target.value)}>
              <option value="all">All Labels</option>
              {allLabels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            {filterActive && (
              <button className="wrp__filter-clear" onClick={() => { setFilterProject('all'); setFilterAssignee('all'); setFilterLabel('all') }}>
                <XCircle size={12} /> Clear
              </button>
            )}
          </div>
        </header>

        {/* ── Copy & Print bar ─────────────────────────────────────────── */}
        <div className="wrp__action-bar">
          <CopyBtn text={generateFullReport()}        label="Copy Full Report"       variant="primary" />
          <CopyBtn text={generateExecutiveSummary()}  label="Copy Executive Summary" />
          <CopyBtn text={generateBlockersReport()}    label="Copy Blockers"          />
          <CopyBtn text={generateReleasePlan()}       label="Copy Release Plan"      />
          <button className="wrp__print-btn" onClick={() => window.print()}>
            <Printer size={13} /> Print
          </button>
        </div>

        {error && <div className="wrp__error">{error}</div>}

        {/* ── Report content ────────────────────────────────────────────── */}
        <main className="wrp__main" id="wrp-print-area">

          {/* 1. Executive Summary */}
          <ReportSection id="s-exec" title="Executive Summary" icon={TrendingUp} collapsible={false}>
            <ul className="wrp__exec-list">
              <li><strong>{totalOpen}</strong> open issues across all projects</li>
              <li className={cw.length === 0 ? 'wrp__exec-dim' : ''}>
                <CheckCircle2 size={13} className="wrp__exec-icon wrp__exec-icon--green" />
                <strong>{cw.length}</strong> issue{cw.length !== 1 ? 's' : ''} completed this week
              </li>
              <li>
                <Rocket size={13} className="wrp__exec-icon wrp__exec-icon--cyan" />
                <strong>{rfr.length}</strong> ready for release &nbsp;·&nbsp;
                <strong>{qa.length}</strong> QA approved
              </li>
              {(blocked.length > 0 || overdue.length > 0) && (
                <li className="wrp__exec-warn">
                  <AlertTriangle size={13} className="wrp__exec-icon" />
                  <strong>{blocked.length}</strong> blocked &nbsp;·&nbsp;
                  <strong>{overdue.length}</strong> overdue
                </li>
              )}
              {uhp.length > 0 && (
                <li className="wrp__exec-risk">
                  <AlertTriangle size={13} className="wrp__exec-icon" />
                  <strong>{uhp.length}</strong> unassigned high/urgent issue{uhp.length !== 1 ? 's' : ''}
                </li>
              )}
              {(um.length > 0 || ud.length > 0) && (
                <li>
                  <Rocket size={13} className="wrp__exec-icon wrp__exec-icon--blue" />
                  <strong>{um.length + ud.length}</strong> release{um.length + ud.length !== 1 ? 's' : ''}/deployment{um.length + ud.length !== 1 ? 's' : ''} planned this/next week
                </li>
              )}
            </ul>
            <div className="wrp__exec-copy-row">
              <CopyBtn text={generateExecutiveSummary()} label="Copy Summary" small />
            </div>
          </ReportSection>

          {/* 2. Completed this week */}
          <ReportSection id="s-done" title="Completed This Week" icon={CheckCircle2} badge={cw.length}>
            {cw.length === 0 ? (
              <p className="wrp__empty">No issues marked Done this week</p>
            ) : (
              <div className="wrp__issue-list">
                {cw.map(i => (
                  <ReportIssueRow key={i.id} issue={i} projectsMap={projectsMap} membersMap={membersMap} onClick={handleOpenIssue}
                    extra={i.updatedAt ? <span className="wrp__issue-age">{daysAgo(i.updatedAt)}</span> : null}
                  />
                ))}
              </div>
            )}
          </ReportSection>

          {/* 3. Ready for Release / QA Approved */}
          <ReportSection id="s-rfr" title="Ready for Release / QA Approved" icon={Rocket} badge={rfr.length + qa.length}>
            {rfr.length === 0 && qa.length === 0 ? (
              <p className="wrp__empty">No issues awaiting release</p>
            ) : (
              <>
                {rfr.length > 0 && (
                  <>
                    <p className="wrp__sub-label">Ready for Release ({rfr.length})</p>
                    <div className="wrp__issue-list">
                      {rfr.map(i => (
                        <ReportIssueRow key={i.id} issue={i} projectsMap={projectsMap} membersMap={membersMap} onClick={handleOpenIssue}
                          extra={
                            <span className={`wrp__qa-badge ${i.devMeta?.qaApproval?.approved ? 'wrp__qa-badge--ok' : 'wrp__qa-badge--warn'}`}>
                              {i.devMeta?.qaApproval?.approved ? '✓ QA' : '⚠ QA'}
                            </span>
                          }
                        />
                      ))}
                    </div>
                  </>
                )}
                {qa.length > 0 && (
                  <>
                    <p className="wrp__sub-label">QA Approved ({qa.length})</p>
                    <div className="wrp__issue-list">
                      {qa.map(i => (
                        <ReportIssueRow key={i.id} issue={i} projectsMap={projectsMap} membersMap={membersMap} onClick={handleOpenIssue}
                          extra={<ShieldCheck size={12} style={{ color: '#0891b2' }} title="QA Approved" />}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </ReportSection>

          {/* 4. Blockers and Risks */}
          <ReportSection id="s-block" title="Blockers & Risks" icon={AlertTriangle}
            badge={blocked.length + overdue.length + uhp.length + prOpen.length}>
            {blocked.length === 0 && overdue.length === 0 && uhp.length === 0 && prOpen.length === 0 ? (
              <p className="wrp__empty wrp__empty--ok">✓ No blockers or risks identified</p>
            ) : (
              <>
                {blocked.length > 0 && (
                  <>
                    <p className="wrp__sub-label wrp__sub-label--red">Blocked ({blocked.length})</p>
                    <div className="wrp__issue-list">
                      {blocked.map(i => (
                        <ReportIssueRow key={i.id} issue={i} projectsMap={projectsMap} membersMap={membersMap} onClick={handleOpenIssue}
                          extra={i.blockedReason ? <span className="wrp__blocked-reason">{i.blockedReason}</span> : null}
                        />
                      ))}
                    </div>
                  </>
                )}
                {overdue.length > 0 && (
                  <>
                    <p className="wrp__sub-label wrp__sub-label--orange">Overdue ({overdue.length})</p>
                    <div className="wrp__issue-list">
                      {overdue.map(i => (
                        <ReportIssueRow key={i.id} issue={i} projectsMap={projectsMap} membersMap={membersMap} onClick={handleOpenIssue}
                          extra={i.dueDate ? <span className="wrp__due-badge">{daysAgo(i.dueDate)}</span> : null}
                        />
                      ))}
                    </div>
                  </>
                )}
                {uhp.length > 0 && (
                  <>
                    <p className="wrp__sub-label wrp__sub-label--orange">Unassigned High/Urgent ({uhp.length})</p>
                    <div className="wrp__issue-list">
                      {uhp.map(i => (
                        <ReportIssueRow key={i.id} issue={i} projectsMap={projectsMap} membersMap={membersMap} onClick={handleOpenIssue} />
                      ))}
                    </div>
                  </>
                )}
                {prOpen.length > 0 && (
                  <>
                    <p className="wrp__sub-label">Open PRs on Release Issues ({prOpen.length})</p>
                    <div className="wrp__issue-list">
                      {prOpen.map(i => (
                        <ReportIssueRow key={i.id} issue={i} projectsMap={projectsMap} membersMap={membersMap} onClick={handleOpenIssue} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            <div className="wrp__exec-copy-row">
              <CopyBtn text={generateBlockersReport()} label="Copy Blockers" small />
            </div>
          </ReportSection>

          {/* 5. Upcoming Releases & Deployments */}
          {(um.length > 0 || ud.length > 0) && (
            <ReportSection id="s-releases" title="Upcoming Releases & Deployments" icon={Rocket}
              badge={um.length + ud.length}>
              {um.length > 0 && (
                <>
                  <p className="wrp__sub-label">Mobile Releases</p>
                  <div className="wrp__release-list">
                    {um.map(r => (
                      <div key={r.id} className={`wrp__rel-item ${isInRange(r.targetDate, weekMon, weekSun) ? 'wrp__rel-item--thisweek' : ''}`}>
                        <Smartphone size={12} className="wrp__rel-icon" />
                        <span className="wrp__rel-name">{r.name}</span>
                        <span className="wrp__rel-platform">{r.platform}</span>
                        {r.version && <span className="wrp__rel-version">v{r.version}</span>}
                        <span className={`wrp__rel-status wrp__rel-status--${(r.status||'').toLowerCase().replace(/\s+/g,'-')}`}>{r.status}</span>
                        <span className="wrp__rel-date">
                          {fmtDate(r.targetDate)}
                          {isInRange(r.targetDate, weekMon, weekSun) ? <em> this week</em> : <em> next week</em>}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {ud.length > 0 && (
                <>
                  <p className="wrp__sub-label">Website / Backend Deployments</p>
                  <div className="wrp__release-list">
                    {ud.map(d => (
                      <div key={d.id} className={`wrp__rel-item ${isInRange(d.targetDate, weekMon, weekSun) ? 'wrp__rel-item--thisweek' : ''}`}>
                        <Globe size={12} className="wrp__rel-icon" />
                        <span className="wrp__rel-name">{d.name}</span>
                        <span className="wrp__rel-platform">{d.type}</span>
                        <span className={`wrp__rel-status wrp__rel-status--${(d.status||'').toLowerCase().replace(/\s+/g,'-')}`}>{d.status}</span>
                        <span className="wrp__rel-date">
                          {fmtDate(d.targetDate)}
                          {isInRange(d.targetDate, weekMon, weekSun) ? <em> this week</em> : <em> next week</em>}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="wrp__exec-copy-row">
                <CopyBtn text={generateReleasePlan()} label="Copy Release Plan" small />
              </div>
            </ReportSection>
          )}

          {/* 6. Team Workload Snapshot */}
          <ReportSection id="s-workload" title="Team Workload Snapshot" icon={Users}>
            <div className="wrp__workload-grid">
              {topLoaded.map(({ member: m, open: o, inReview: ir, highPri: hp }) => (
                <div key={m.id} className={`wrp__wl-card ${o > 12 ? 'wrp__wl-card--overloaded' : ''}`}>
                  <div className="wrp__wl-avatar">
                    {(m.displayName || m.username || '?').slice(0,2).toUpperCase()}
                  </div>
                  <div className="wrp__wl-info">
                    <div className="wrp__wl-name">{m.displayName || m.username}</div>
                    <div className="wrp__wl-stats">
                      <span className="wrp__wl-stat">{o} open</span>
                      {ir > 0 && <span className="wrp__wl-stat wrp__wl-stat--purple">{ir} in review</span>}
                      {hp > 0 && <span className="wrp__wl-stat wrp__wl-stat--red">{hp} high</span>}
                    </div>
                  </div>
                  <div className="wrp__wl-bar-wrap">
                    <div className="wrp__wl-bar" style={{
                      width: `${Math.min(100, (o/12)*100)}%`,
                      background: o > 12 ? '#ef4444' : o > 7 ? '#f59e0b' : '#10b981'
                    }} />
                  </div>
                </div>
              ))}
              {topLoaded.length === 0 && <p className="wrp__empty">No workload data available</p>}
            </div>
            {unassignedCount > 0 && (
              <div className="wrp__unassigned-note">
                <AlertTriangle size={12} />
                <strong>{unassignedCount}</strong> unassigned issue{unassignedCount !== 1 ? 's' : ''} &nbsp;
                <button className="wrp__link" onClick={() => navigate('/projects/linear/workload')}>
                  <ArrowRight size={11} /> View in Workload
                </button>
              </div>
            )}
          </ReportSection>

          {/* 7. Decisions Needed */}
          {decisions.length > 0 && (
            <ReportSection id="s-decisions" title="Decisions Needed" icon={AlertTriangle} badge={decisions.length}>
              <ol className="wrp__decisions-list">
                {decisions.map((d, i) => <li key={i}>{d}</li>)}
              </ol>
            </ReportSection>
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

// Missing import alias used in exec summary
function TrendingUp(props) {
  return <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={props.size||14} height={props.size||14}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
}
