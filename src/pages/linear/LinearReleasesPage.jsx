/**
 * LinearReleasesPage.jsx
 * Release Notes + QA Handoff page for issues that are Ready for Release or Done.
 * Route: /#/projects/linear/releases
 *
 * Frontend-only: uses existing TeamProjectsContext data + issue.devMeta.
 * No backend calls, no new migrations.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { ChevronDown, X, Copy, Check, Package, ChevronRight, CheckSquare, Square } from 'lucide-react'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import { ReleaseApprovalPanel } from '../../components/linear/ReleaseApprovalPanel'
import { MobileReleaseTracker }  from '../../components/linear/MobileReleaseTracker'
import { WebDeploymentTracker }  from '../../components/linear/WebDeploymentTracker'
import { ReleaseCalendar }       from '../../components/linear/ReleaseCalendar'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import { IssueDetailPanel } from '../../components/linear/IssueDetailPanel'
import { issueKey, normalizeStatus, normalizePriority, STATUS_CONFIG, PRIORITY_CONFIG, ISSUE_TYPE_CONFIG } from '../../components/linear/IssueRow'
import { CycleBadge } from '../../components/linear/CycleBadge'
import { labelColors } from '../../components/linear/linearLabels'
import './LinearReleasesPage.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div className="rel-filter">
      <select
        className="rel-filter__select"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label={label}
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={11} strokeWidth={2.5} className="rel-filter__arrow" aria-hidden="true" />
      {value != null && (
        <button
          type="button"
          className="rel-filter__clear"
          onClick={() => onChange(null)}
          aria-label={`Clear ${label}`}
        >
          <X size={9} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

const PR_STATUS_LABELS = {
  draft:     'Draft',
  open:      'Open',
  in_review: 'In Review',
  merged:    'Merged',
  closed:    'Closed',
}

function prStatusClass(s) {
  if (s === 'open')      return 'rel-pr--open'
  if (s === 'merged')    return 'rel-pr--merged'
  if (s === 'in_review') return 'rel-pr--review'
  if (s === 'draft')     return 'rel-pr--draft'
  if (s === 'closed')    return 'rel-pr--closed'
  return ''
}

function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ── Release text generators ───────────────────────────────────────────────────

function teamLabel(projectName = '') {
  const n = projectName.toLowerCase()
  if (n.includes('android'))                                         return 'Android'
  if (n.includes('ios') || n.includes('iphone'))                    return 'iOS'
  if (n.includes('ux') || n.includes('ui') || n.includes('design')) return 'UX/UI'
  if (n.includes('backend') || n.includes('api') || n.includes('server')) return 'Backend/API'
  if (n.includes('data') || n.includes(' bi') || n === 'bi')        return 'Data & BI'
  return 'Website'
}

function groupByTeam(issues, projectsMap) {
  const groups = { Website: [], Android: [], iOS: [], 'Backend/API': [], 'UX/UI': [], 'Data & BI': [], Other: [] }
  for (const iss of issues) {
    const proj = projectsMap[iss.projectId]
    const t = teamLabel(proj?.name || '')
    const bucket = groups[t] || groups.Other
    bucket.push({ iss, proj })
  }
  return groups
}

function buildReleaseNotes(selected, projectsMap, cycles) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const cycleMap = {}
  for (const c of cycles) cycleMap[c.id] = c

  const groups = groupByTeam(selected, projectsMap)
  const lines = [
    `# Life Smile Product Update`,
    `**Date**: ${date}`,
    `**Total issues**: ${selected.length}`,
    '',
    '---',
    '',
  ]

  const TEAM_ORDER = ['Website', 'Android', 'iOS', 'Backend/API', 'UX/UI', 'Data & BI', 'Other']
  for (const team of TEAM_ORDER) {
    const items = groups[team]
    if (!items || items.length === 0) continue
    lines.push(`## ${team}`)
    for (const { iss, proj } of items) {
      const key = issueKey(proj?.name, iss.id)
      const cycle = iss.sprintId ? cycleMap[iss.sprintId] : null
      const cycleStr = cycle ? ` [${cycle.name}]` : ''
      const prUrl = iss.devMeta?.prUrl ? ` — ${iss.devMeta.prUrl}` : ''
      lines.push(`- **${key}**: ${iss.title}${cycleStr}${prUrl}`)
      if (iss.labels?.length) lines.push(`  Labels: ${iss.labels.join(', ')}`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push('## Notes / Risks')
  lines.push('- Review each PR before deploying')
  lines.push('- Confirm no pending DB migrations')
  lines.push('- Validate on staging before production deploy')

  // QA approval summary
  const notApproved = selected.filter((iss) => !iss.devMeta?.qaApproval?.approved)
  if (notApproved.length > 0) {
    lines.push('')
    lines.push('## ⚠️ QA Not Approved')
    lines.push(`${notApproved.length} issue(s) have not been QA approved:`)
    for (const iss of notApproved) {
      const proj = projectsMap[iss.projectId]
      lines.push(`- [ ] ${issueKey(proj?.name, iss.id)}: ${iss.title}`)
    }
  }

  return lines.join('\n').trim()
}

function buildQaHandoff(selected, projectsMap) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const groups = groupByTeam(selected, projectsMap)

  const lines = [
    `# QA Handoff — Life Smile`,
    `**Date**: ${date}`,
    `**Scope**: ${selected.length} issue(s) to verify`,
    '',
    '---',
    '',
    '## Issues to Test',
  ]

  for (const iss of selected) {
    const proj = projectsMap[iss.projectId]
    const key = issueKey(proj?.name, iss.id)
    const prStr = iss.devMeta?.prUrl ? ` → ${iss.devMeta.prUrl}` : ''
    lines.push(`- [ ] **${key}**: ${iss.title}${prStr}`)
  }

  lines.push('')
  lines.push('## Test Environment')
  lines.push('- [ ] Staging URL confirmed and accessible')
  lines.push('- [ ] Test accounts available (regular user, admin, guest)')
  lines.push('- [ ] API environment is staging/UAT, not production')
  lines.push('')

  const hasWeb     = (groups.Website?.length     || 0) > 0
  const hasAndroid = (groups.Android?.length     || 0) > 0
  const hasIos     = (groups.iOS?.length         || 0) > 0
  const hasBackend = (groups['Backend/API']?.length || 0) > 0
  const hasUx      = (groups['UX/UI']?.length    || 0) > 0
  const hasBi      = (groups['Data & BI']?.length || 0) > 0

  if (hasWeb || hasUx) {
    lines.push('## Desktop / Web Checks')
    lines.push('- [ ] Features work on Chrome, Firefox, Safari')
    lines.push('- [ ] No layout regressions at 1280px and 1920px')
    lines.push('- [ ] Logged-in and logged-out states tested')
    lines.push('- [ ] Empty states, loading states, error states handled')
    lines.push('')
    lines.push('## Mobile / Responsive Checks')
    lines.push('- [ ] Layout correct at 375px (iPhone) and 768px (tablet)')
    lines.push('- [ ] Touch targets are large enough')
    lines.push('- [ ] No horizontal overflow')
    lines.push('')
  }

  if (hasAndroid) {
    lines.push('## Android Checks')
    lines.push('- [ ] App installs and opens without crash')
    lines.push('- [ ] Feature works on Android 10+')
    lines.push('- [ ] Back navigation works correctly')
    lines.push('- [ ] Dark mode renders correctly')
    lines.push('')
  }

  if (hasIos) {
    lines.push('## iOS Checks')
    lines.push('- [ ] App opens without crash on iOS 15+')
    lines.push('- [ ] Feature works on iPhone 12 and iPhone SE')
    lines.push('- [ ] Dark mode renders correctly')
    lines.push('')
  }

  if (hasBackend) {
    lines.push('## Backend / API Checks')
    lines.push('- [ ] API returns correct response shape and status codes')
    lines.push('- [ ] Auth checks enforced')
    lines.push('- [ ] Error cases return JSON, not HTML')
    lines.push('- [ ] Logs clean (no new uncaught errors)')
    lines.push('')
  }

  if (hasBi) {
    lines.push('## Data & BI Checks')
    lines.push('- [ ] Filters apply correctly')
    lines.push('- [ ] Totals match expected values')
    lines.push('- [ ] Export works correctly')
    lines.push('')
  }

  lines.push('## Regression Checks')
  lines.push('- [ ] Existing unrelated features still work')
  lines.push('- [ ] No new console errors on unrelated pages')
  lines.push('- [ ] Performance is not visibly degraded')
  lines.push('')
  lines.push('## Evidence & Screenshots')
  lines.push('- [ ] Review Bug Evidence screenshots in the issue Files tab')
  lines.push('- [ ] Compare Before vs After screenshots if available')
  lines.push('- [ ] Confirm QA Proof screenshot uploaded before marking Done')
  lines.push('- [ ] Release Evidence screenshot captured for production confirmation')
  lines.push('')
  lines.push('## Sign-off')
  lines.push('- [ ] QA engineer tested and approved')
  lines.push('- [ ] Product manager reviewed')
  lines.push('- [ ] Ready for production deploy')

  return lines.join('\n').trim()
}

function buildDeploymentChecklist(selected, projectsMap) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const groups = groupByTeam(selected, projectsMap)
  const hasBackend = (groups['Backend/API']?.length || 0) > 0
  const hasFrontend = (groups.Website?.length || 0) + (groups['UX/UI']?.length || 0) > 0

  const lines = [
    `# Deployment Checklist — Life Smile`,
    `**Date**: ${date}`,
    `**Issues**: ${selected.length}`,
    '',
    '## Pre-Deploy',
    '- [ ] All PRs reviewed and approved',
    '- [ ] All PRs merged to main branch',
    '- [ ] CI/CD pipeline passes',
    '- [ ] Staging QA sign-off received',
    '- [ ] Change communicated to team',
    '',
    '## Migrations & Config',
    '- [ ] Check for new DB migrations — run if present',
    '- [ ] Confirm no new required env vars',
    '- [ ] Confirm secrets / API keys are set in production',
    '',
  ]

  if (hasBackend) {
    lines.push('## Backend Deploy')
    lines.push('- [ ] SSH to server or trigger deploy pipeline')
    lines.push('- [ ] Run `npm run deploy:backend` (or equivalent)')
    lines.push('- [ ] Confirm backend restarts without errors')
    lines.push('- [ ] Check `/api/health` returns OK')
    lines.push('')
  }

  if (hasFrontend) {
    lines.push('## Frontend Deploy')
    lines.push('- [ ] Run `npm run deploy:frontend` (or equivalent)')
    lines.push('- [ ] Confirm S3 sync succeeded')
    lines.push('- [ ] Trigger CloudFront invalidation for `/*`')
    lines.push('')
  }

  lines.push('## Post-Deploy Smoke Test')
  lines.push('- [ ] Open production URL and log in')
  lines.push('- [ ] Spot-check each released feature')
  lines.push('- [ ] Check browser console for new errors')
  lines.push('- [ ] Check server logs for new errors / exceptions')
  lines.push('')
  lines.push('## Rollback Plan')
  lines.push('- [ ] Previous backend tarball available in S3 artifacts')
  lines.push('- [ ] Previous frontend assets available via CloudFront versioning')
  lines.push('- [ ] Document rollback command here: ___')
  lines.push('')
  lines.push('## Close Out')
  lines.push('- [ ] Mark all released issues as Done in Linear')
  lines.push('- [ ] Post release note to team channel')
  lines.push('- [ ] Archive cycle if all issues are complete')

  return lines.join('\n').trim()
}

// ── Issue card ────────────────────────────────────────────────────────────────

function ReleaseIssueCard({ issue, project, member, cycle, selected, onToggle, onOpen }) {
  const key    = issueKey(project?.name, issue.id)
  const status = normalizeStatus(issue.status)
  const sCfg   = STATUS_CONFIG[status] || STATUS_CONFIG.Backlog
  const pCfg   = PRIORITY_CONFIG[normalizePriority(issue.priority)] || PRIORITY_CONFIG['No Priority']
  const tKey   = String(issue.issueType || 'task').toLowerCase()
  const tCfg   = tKey !== 'task' ? ISSUE_TYPE_CONFIG[tKey] : null
  const dueStr = fmtDate(issue.dueDate)
  const prSt   = issue.devMeta?.prStatus
  const prUrl  = issue.devMeta?.prUrl

  return (
    <div
      className={`rel-card ${selected ? 'rel-card--selected' : ''}`}
      onClick={() => onOpen(issue)}
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(issue)}
      role="button"
      aria-label={`Open issue ${key}`}
    >
      {/* Selection checkbox */}
      <button
        type="button"
        className="rel-card__check"
        onClick={(e) => { e.stopPropagation(); onToggle(issue.id) }}
        aria-label={selected ? 'Deselect issue' : 'Select issue'}
        title={selected ? 'Deselect' : 'Select for release notes'}
      >
        {selected
          ? <CheckSquare size={15} style={{ color: 'var(--accent, #7c3aed)' }} />
          : <Square size={15} style={{ color: 'var(--text-muted, #9ca3af)' }} />
        }
      </button>

      <div className="rel-card__body">
        {/* Top row: key + status + title */}
        <div className="rel-card__top">
          <sCfg.Icon size={13} strokeWidth={1.8} style={{ color: sCfg.color, flexShrink: 0 }} aria-hidden="true" />
          <span className="rel-card__key">{key}</span>
          {tCfg && (
            <tCfg.Icon size={11} strokeWidth={2} style={{ color: tCfg.color, opacity: 0.8, flexShrink: 0 }} aria-hidden="true" />
          )}
          <span className="rel-card__title">{issue.title || '(Untitled)'}</span>
        </div>

        {/* Meta row */}
        <div className="rel-card__meta">
          {/* Project */}
          {project && (
            <span className="rel-card__project" style={{ '--proj-color': project.color || '#8b5cf6' }}>
              {issueKey(project.name, '').replace(/-$/, '')}
            </span>
          )}

          {/* Priority */}
          <pCfg.Icon size={11} strokeWidth={2.2} style={{ color: pCfg.color }} aria-label={`Priority: ${pCfg.label}`} />

          {/* Labels */}
          {issue.labels?.slice(0, 2).map((lbl) => {
            const c = labelColors(lbl)
            return (
              <span key={lbl} className="rel-card__label"
                style={{ background: c.bg, borderColor: c.border, color: c.text }}>
                {lbl}
              </span>
            )
          })}

          {/* Cycle */}
          {cycle && <CycleBadge name={cycle.name} status={cycle.status} small />}

          {/* Assignee */}
          {member && (
            <span className="rel-card__assignee" title={member.displayName || member.username}>
              {(member.displayName || member.username || '?').slice(0, 2).toUpperCase()}
            </span>
          )}

          {/* PR status chip */}
          {prSt && (
            <span className={`rel-card__pr ${prStatusClass(prSt)}`} title={`PR: ${PR_STATUS_LABELS[prSt] || prSt}`}>
              {PR_STATUS_LABELS[prSt] || prSt}
            </span>
          )}

          {/* QA approval chip */}
          {issue.devMeta?.qaApproval?.approved
            ? <span className="rel-card__qa rel-card__qa--approved" title="QA Approved">QA ✓</span>
            : <span className="rel-card__qa rel-card__qa--pending"  title="Not QA Approved">QA?</span>
          }

          {/* Not-ready warning */}
          {!['Ready for Release', 'QA Approved', 'Done'].includes(status) && (
            <span className="rel-card__warn" title={`Status: ${status} — not ready for release`}>⚠ Not Ready</span>
          )}

          {/* PR URL */}
          {prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rel-card__pr-link"
              onClick={(e) => e.stopPropagation()}
              title={prUrl}
            >
              PR ↗
            </a>
          )}

          {/* Due date */}
          {dueStr && <span className="rel-card__due">{dueStr}</span>}
        </div>
      </div>
    </div>
  )
}

// ── Copy button with feedback ─────────────────────────────────────────────────

function CopyButton({ label, text, disabled, className = '' }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const markCopied = () => { setCopied(true); setTimeout(() => setCopied(false), 2000) }
    navigator.clipboard.writeText(text).then(markCopied).catch(() => {
      try {
        const ta = document.createElement('textarea')
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.select()
        document.execCommand('copy'); document.body.removeChild(ta)
        markCopied()
      } catch { /* clipboard not available */ }
    })
  }
  return (
    <button
      type="button"
      className={`rel-copy-btn ${className}`}
      onClick={copy}
      disabled={disabled}
      title={disabled ? 'Select issues first' : `Copy ${label}`}
    >
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {copied ? 'Copied!' : label}
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LinearReleasesPage() {
  const {
    projects,
    members,
    loadingProjects,
    loadingTasks,
    error,
    user,
    getTasksForProject,
    getCyclesForProject,
    actions,
  } = useTeamProjectsContext()

  const fetchedRef    = useRef(false)
  const [allIssues, setAllIssues] = useState([])
  const [allCycles, setAllCycles] = useState([])
  const [donePage,  setDonePage]  = useState(1)
  const DONE_PAGE_SIZE = 20

  // Fetch all projects' tasks + cycles once
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
  }, [projects.length]) // eslint-disable-line

  useEffect(() => {
    if (!projects.length) return
    const tasks = []
    const cycles = []
    for (const p of projects) {
      const pt = getTasksForProject(p.id)
      const pc = getCyclesForProject(p.id)
      tasks.push(...pt)
      cycles.push(...pc)
    }
    setAllIssues(tasks)
    setAllCycles(cycles)
  }, [projects, getTasksForProject, getCyclesForProject])

  // ── Lookups ────────────────────────────────────────────────────────────────
  const projectsMap = useMemo(() => {
    const m = {}
    for (const p of projects) m[p.id] = p
    return m
  }, [projects])

  const membersMap = useMemo(() => {
    const m = {}
    for (const mb of members) m[mb.id] = mb
    return m
  }, [members])

  const cyclesMap = useMemo(() => {
    const m = {}
    for (const c of allCycles) m[c.id] = c
    return m
  }, [allCycles])

  // ── Filters ────────────────────────────────────────────────────────────────
  const [filterProject,  setFilterProject]  = useState(null)
  const [filterCycle,    setFilterCycle]    = useState(null)
  const [filterLabel,    setFilterLabel]    = useState(null)
  const [filterType,     setFilterType]     = useState(null)
  const [filterPriority, setFilterPriority] = useState(null)
  const [filterPrStatus, setFilterPrStatus] = useState(null)
  const [filterAssignee, setFilterAssignee] = useState(null)

  const hasFilters = !!(filterProject || filterCycle || filterLabel || filterType || filterPriority || filterPrStatus || filterAssignee)

  const clearFilters = useCallback(() => {
    setFilterProject(null); setFilterCycle(null); setFilterLabel(null)
    setFilterType(null); setFilterPriority(null); setFilterPrStatus(null); setFilterAssignee(null)
  }, [])

  // ── Selection ──────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState(new Set())

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback((issues) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const iss of issues) next.add(iss.id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  // ── Detail panel ───────────────────────────────────────────────────────────
  const [panelIssue, setPanelIssue] = useState(null)

  const handleOpenIssue = useCallback((issue) => setPanelIssue(issue), [])
  const handleClosePanel = useCallback(() => setPanelIssue(null), [])

  const handleUpdate = useCallback(async (projectId, taskId, data) => {
    return actions.updateTask(projectId, taskId, data)
  }, [actions])

  const handleDelete = useCallback(async (projectId, taskId) => {
    await actions.deleteTask(projectId, taskId)
    setPanelIssue(null)
  }, [actions])

  const handleMoveToDone = useCallback(async (issues) => {
    for (const iss of issues) {
      await actions.updateTask(iss.projectId, iss.id, { status: 'Done' })
    }
  }, [actions])

  // ── Filtered issue sets ────────────────────────────────────────────────────
  function applyFilters(issues) {
    return issues.filter((iss) => {
      if (filterProject  && String(iss.projectId) !== filterProject)       return false
      if (filterCycle    && String(iss.sprintId)  !== filterCycle)         return false
      if (filterLabel    && !(iss.labels || []).includes(filterLabel))     return false
      if (filterType     && iss.issueType !== filterType)                  return false
      if (filterPriority && normalizePriority(iss.priority) !== filterPriority) return false
      if (filterPrStatus && (iss.devMeta?.prStatus || '') !== filterPrStatus)   return false
      if (filterAssignee && String(iss.assigneeUserId) !== filterAssignee) return false
      return true
    })
  }

  const readyIssues = useMemo(() => {
    const raw = allIssues.filter((i) => normalizeStatus(i.status) === 'Ready for Release')
    return applyFilters(raw)
  }, [allIssues, filterProject, filterCycle, filterLabel, filterType, filterPriority, filterPrStatus, filterAssignee]) // eslint-disable-line

  const doneIssues = useMemo(() => {
    const raw = allIssues
      .filter((i) => normalizeStatus(i.status) === 'Done')
      .sort((a, b) => {
        const ta = a.completedAt || a.updatedAt || ''
        const tb = b.completedAt || b.updatedAt || ''
        return tb.localeCompare(ta)
      })
    return applyFilters(raw)
  }, [allIssues, filterProject, filterCycle, filterLabel, filterType, filterPriority, filterPrStatus, filterAssignee]) // eslint-disable-line

  // ── Selected issues ────────────────────────────────────────────────────────
  const selectedIssues = useMemo(() => {
    const all = [...readyIssues, ...doneIssues]
    const seen = new Set()
    return all.filter((iss) => {
      if (seen.has(iss.id)) return false
      seen.add(iss.id)
      return selectedIds.has(iss.id)
    })
  }, [readyIssues, doneIssues, selectedIds])

  // ── Filter options ─────────────────────────────────────────────────────────
  const projectOptions  = projects.map((p) => ({ value: String(p.id), label: p.name }))
  const cycleOptions    = allCycles.map((c) => ({ value: String(c.id), label: c.name }))
  const labelOptions    = useMemo(() => {
    const s = new Set()
    for (const iss of allIssues) (iss.labels || []).forEach((l) => s.add(l))
    return Array.from(s).sort().map((l) => ({ value: l, label: l }))
  }, [allIssues])
  const typeOptions     = useMemo(() => {
    const s = new Set()
    for (const iss of allIssues) if (iss.issueType && iss.issueType !== 'task') s.add(iss.issueType)
    return Array.from(s).sort().map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))
  }, [allIssues])
  const priorityOptions = ['Urgent', 'High', 'Medium', 'Low', 'No Priority'].map((p) => ({ value: p, label: p }))
  const prStatusOptions = Object.entries(PR_STATUS_LABELS).map(([value, label]) => ({ value, label }))
  const assigneeOptions = members.map((m) => ({ value: String(m.id), label: m.displayName || m.username || `User ${m.id}` }))

  // ── Generated texts ────────────────────────────────────────────────────────
  const hasSelection = selectedIssues.length > 0

  const releaseNotesText      = hasSelection ? buildReleaseNotes(selectedIssues, projectsMap, allCycles) : ''
  const qaHandoffText         = hasSelection ? buildQaHandoff(selectedIssues, projectsMap) : ''
  const deployChecklistText   = hasSelection ? buildDeploymentChecklist(selectedIssues, projectsMap) : ''

  // ── Pagination ─────────────────────────────────────────────────────────────
  const visibleDone = doneIssues.slice(0, donePage * DONE_PAGE_SIZE)
  const hasMoreDone = doneIssues.length > visibleDone.length

  const loading = loadingProjects || Object.values(loadingTasks).some(Boolean)

  return (
    <div className="rel">
      <LinearSidebar projects={projects} />

      <main className="rel__main">
        {/* Header */}
        <header className="rel__header">
          <div className="rel__header-icon">
            <Package size={20} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div>
            <h1 className="rel__title">Releases</h1>
            <p className="rel__subtitle">QA handoff and release notes for website, app, backend, UX/UI, and BI work</p>
          </div>
        </header>

        {/* Filters */}
        <div className="rel__filters">
          <FilterSelect label="Project"   value={filterProject}  onChange={setFilterProject}  options={projectOptions}  />
          <FilterSelect label="Cycle"     value={filterCycle}    onChange={setFilterCycle}    options={cycleOptions}    />
          <FilterSelect label="Label"     value={filterLabel}    onChange={setFilterLabel}    options={labelOptions}    />
          {typeOptions.length > 0 && (
            <FilterSelect label="Type"     value={filterType}    onChange={setFilterType}     options={typeOptions}     />
          )}
          <FilterSelect label="Priority"  value={filterPriority} onChange={setFilterPriority} options={priorityOptions} />
          <FilterSelect label="PR Status" value={filterPrStatus} onChange={setFilterPrStatus} options={prStatusOptions} />
          <FilterSelect label="Assignee"  value={filterAssignee} onChange={setFilterAssignee} options={assigneeOptions} />
          {hasFilters && (
            <button type="button" className="rel__clear-btn" onClick={clearFilters}>
              <X size={11} strokeWidth={2.5} aria-hidden="true" />
              Clear
            </button>
          )}
        </div>

        {error && (
          <div className="rel__error" role="alert">{error}</div>
        )}

        {loading && !allIssues.length && (
          <div className="rel__loading">Loading issues…</div>
        )}

        {/* ── Ready for Release ─────────────────────────────────────────── */}
        <section className="rel__section">
          <div className="rel__section-header">
            <h2 className="rel__section-title">
              Ready for Release
              <span className="rel__count">{readyIssues.length}</span>
            </h2>
            {readyIssues.length > 0 && (
              <button
                type="button"
                className="rel__select-all-btn"
                onClick={() => selectAll(readyIssues)}
              >
                Select All
              </button>
            )}
          </div>

          {readyIssues.length === 0 && !loading ? (
            <p className="rel__empty">No issues ready for release{hasFilters ? ' matching current filters' : ''}.</p>
          ) : (
            <div className="rel__cards">
              {readyIssues.map((iss) => (
                <ReleaseIssueCard
                  key={iss.id}
                  issue={iss}
                  project={projectsMap[iss.projectId]}
                  member={membersMap[iss.assigneeUserId]}
                  cycle={iss.sprintId ? cyclesMap[iss.sprintId] : null}
                  selected={selectedIds.has(iss.id)}
                  onToggle={toggleSelect}
                  onOpen={handleOpenIssue}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Recently Done ──────────────────────────────────────────────── */}
        <section className="rel__section">
          <div className="rel__section-header">
            <h2 className="rel__section-title">
              Recently Done
              <span className="rel__count">{doneIssues.length}</span>
            </h2>
            {doneIssues.length > 0 && (
              <button
                type="button"
                className="rel__select-all-btn"
                onClick={() => selectAll(doneIssues)}
              >
                Select All
              </button>
            )}
          </div>

          {doneIssues.length === 0 && !loading ? (
            <p className="rel__empty">No done issues{hasFilters ? ' matching current filters' : ''}.</p>
          ) : (
            <>
              <div className="rel__cards">
                {visibleDone.map((iss) => (
                  <ReleaseIssueCard
                    key={iss.id}
                    issue={iss}
                    project={projectsMap[iss.projectId]}
                    member={membersMap[iss.assigneeUserId]}
                    cycle={iss.sprintId ? cyclesMap[iss.sprintId] : null}
                    selected={selectedIds.has(iss.id)}
                    onToggle={toggleSelect}
                    onOpen={handleOpenIssue}
                  />
                ))}
              </div>
              {hasMoreDone && (
                <button
                  type="button"
                  className="rel__show-more"
                  onClick={() => setDonePage((n) => n + 1)}
                >
                  <ChevronRight size={14} aria-hidden="true" />
                  Show more ({doneIssues.length - visibleDone.length} more)
                </button>
              )}
            </>
          )}
        </section>

        {/* ── Release Summary Builder ────────────────────────────────────── */}
        <section className="rel__section rel__section--builder">
          <div className="rel__section-header">
            <h2 className="rel__section-title">
              Release Summary Builder
              {selectedIssues.length > 0 && (
                <span className="rel__count rel__count--accent">{selectedIssues.length} selected</span>
              )}
            </h2>
            {selectedIssues.length > 0 && (
              <button type="button" className="rel__clear-sel-btn" onClick={clearSelection}>
                <X size={11} aria-hidden="true" />
                Clear Selection
              </button>
            )}
          </div>

          {!hasSelection ? (
            <p className="rel__builder-hint">
              Select issues above using the checkboxes to generate release notes, QA handoff, and deployment checklist.
            </p>
          ) : (
            <>
              {/* Selected issues preview */}
              <div className="rel__selected-list">
                {selectedIssues.map((iss) => {
                  const proj = projectsMap[iss.projectId]
                  return (
                    <span key={iss.id} className="rel__selected-chip">
                      {issueKey(proj?.name, iss.id)}
                      <button
                        type="button"
                        className="rel__selected-chip-remove"
                        onClick={() => toggleSelect(iss.id)}
                        aria-label="Remove"
                      >
                        <X size={9} />
                      </button>
                    </span>
                  )
                })}
              </div>

              {/* Copy buttons */}
              <div className="rel__copy-actions">
                <CopyButton
                  label="Release Notes"
                  text={releaseNotesText}
                  className="rel-copy-btn--primary"
                />
                <CopyButton
                  label="QA Handoff"
                  text={qaHandoffText}
                />
                <CopyButton
                  label="Deployment Checklist"
                  text={deployChecklistText}
                />
              </div>

              {/* Preview accordion */}
              <ReleasePreview label="Release Notes Preview" text={releaseNotesText} />

              {/* Release Approval Panel */}
              <ReleaseApprovalPanel
                selectedIssues={selectedIssues}
                projectsMap={projectsMap}
                membersMap={membersMap}
                currentUser={user || null}
                onMoveToDone={handleMoveToDone}
              />
            </>
          )}
        </section>

        {/* ── Release Calendar ──────────────────────────────────────────── */}
        <section className="rel__section rel__section--calendar" id="release-calendar">
          <ReleaseCalendar
            allIssues={allIssues}
            projectsMap={projectsMap}
            onOpenIssue={handleOpenIssue}
          />
        </section>

        {/* ── Mobile Release Tracker ────────────────────────────────────── */}
        <section className="rel__section rel__section--mobile">
          <MobileReleaseTracker
            allIssues={allIssues}
            selectedIssues={selectedIssues}
            projectsMap={projectsMap}
          />
        </section>

        {/* ── Website & Backend Deployments ─────────────────────────────── */}
        <section className="rel__section rel__section--web-deploy">
          <WebDeploymentTracker
            allIssues={allIssues}
            selectedIssues={selectedIssues}
            projectsMap={projectsMap}
          />
        </section>
      </main>

      {/* Issue detail panel */}
      <IssueDetailPanel
        issue={panelIssue}
        project={panelIssue ? projectsMap[panelIssue.projectId] : null}
        members={members}
        cycles={panelIssue ? allCycles.filter((c) => c.projectId === panelIssue.projectId) : []}
        open={!!panelIssue}
        onClose={handleClosePanel}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  )
}

function ReleasePreview({ label, text }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rel__preview-block">
      <button
        type="button"
        className="rel__preview-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {label}
      </button>
      {open && <pre className="rel__preview-text">{text}</pre>}
    </div>
  )
}
