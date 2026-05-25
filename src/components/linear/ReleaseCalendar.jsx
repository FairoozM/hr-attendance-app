/**
 * ReleaseCalendar
 *
 * Timeline view that aggregates mobile releases, web/backend deployments,
 * release approval drafts, and due-dated issues into a single grouped view.
 *
 * Data sources:
 *   - localStorage: lifesmile.linear.mobileReleases.v1
 *   - localStorage: lifesmile.linear.webDeployments.v1
 *   - localStorage: lifesmile.linear.releaseApproval.v1
 *   - prop: allIssues (Ready for Release / QA Approved with dueDate)
 *
 * No API calls, no mutations, read-only view of release tracking data.
 */
import { useState, useMemo, useCallback } from 'react'
import {
  Calendar, Smartphone, Globe, Server, Package, Circle,
  AlertTriangle, ChevronDown, ChevronUp, RefreshCw,
  Copy, Check, X, Filter,
} from 'lucide-react'
import {
  loadMobileReleases,
  loadWebDeployments,
  loadReleaseApprovalDraft,
} from '../../lib/linearReleaseStorage'
import { normalizeStatus, issueKey } from './IssueRow'
import './ReleaseCalendar.css'

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayMidnight() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d
}

function parseDateMidnight(str) {
  if (!str) return null
  try {
    // handles 'YYYY-MM-DD' and ISO strings
    const d = new Date(str.length <= 10 ? str + 'T00:00:00' : str)
    if (isNaN(d)) return null
    d.setHours(0, 0, 0, 0)
    return d
  } catch { return null }
}

function getBucket(dateStr) {
  if (!dateStr) return 'no_date'
  const today   = todayMidnight()
  const d       = parseDateMidnight(dateStr)
  if (!d) return 'no_date'
  const diffMs  = d - today
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays < 0)  return 'overdue'
  if (diffDays <= 6) return 'this_week'
  if (diffDays <= 13) return 'next_week'
  return 'later'
}

function fmtDate(str) {
  if (!str) return '—'
  const d = parseDateMidnight(str)
  if (!d) return str
  return d.toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })
}

function daysLabel(dateStr) {
  if (!dateStr) return ''
  const today = todayMidnight()
  const d     = parseDateMidnight(dateStr)
  if (!d) return ''
  const diff  = Math.floor((d - today) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return '1 day ago'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  return `in ${diff}d`
}

// ── Type config ───────────────────────────────────────────────────────────────

function typeConfig(item) {
  if (item.type === 'issue') {
    return { Icon: Circle, color: '#6b7280', label: 'Issue' }
  }
  if (item.type === 'release_batch') {
    return { Icon: Package, color: '#7c3aed', label: 'Release Batch' }
  }
  if (item.type === 'mobile') {
    const p = item.platform
    if (p === 'Android') return { Icon: Smartphone, color: '#16a34a', label: 'Android' }
    if (p === 'iOS')     return { Icon: Smartphone, color: '#2563eb', label: 'iOS' }
    return               { Icon: Smartphone, color: '#7c3aed', label: 'Mobile' }
  }
  // deployment
  const p = item.platform
  if (p === 'Backend')    return { Icon: Server, color: '#059669', label: 'Backend' }
  if (p === 'Full Stack') return { Icon: Server, color: '#7c3aed', label: 'Full Stack' }
  if (p === 'Database')   return { Icon: Server, color: '#d97706', label: 'Database' }
  if (p === 'Config/Env') return { Icon: Server, color: '#64748b', label: 'Config/Env' }
  return                   { Icon: Globe, color: '#6366f1', label: 'Frontend' }
}

const STATUS_COLORS = {
  'Planning':       '#6b7280',
  'In QA':          '#d97706',
  'Submitted':      '#2563eb',
  'In Review':      '#4f46e5',
  'Approved':       '#7c3aed',
  'Released':       '#059669',
  'Rejected':       '#dc2626',
  'Ready':          '#2563eb',
  'Deploying':      '#d97706',
  'Deployed':       '#7c3aed',
  'Verified':       '#059669',
  'Rolled Back':    '#dc2626',
  'Failed':         '#dc2626',
  'Ready for Release': '#10b981',
  'QA Approved':    '#0891b2',
}

const BUCKET_CONFIG = [
  { key: 'overdue',   label: '⚠ Overdue',     cls: 'overdue'    },
  { key: 'this_week', label: '📅 This Week',   cls: 'this_week'  },
  { key: 'next_week', label: '📅 Next Week',   cls: 'next_week'  },
  { key: 'later',     label: '📅 Later',       cls: 'later'      },
  { key: 'no_date',   label: '— No Date',      cls: 'no_date'    },
]

// ── Build timeline items ──────────────────────────────────────────────────────

function buildItems(mobileReleases, webDeployments, releaseApproval, allIssues, projectsMap) {
  const items = []

  for (const r of mobileReleases) {
    const date = r.targetDate || r.submittedAt || r.releasedAt || ''
    items.push({
      id:               `mr-${r.id}`,
      type:             'mobile',
      name:             r.name || 'Unnamed Mobile Release',
      status:           r.status || 'Planning',
      targetDate:       date,
      platform:         r.platform || 'Android',
      environment:      null,
      linkedIssueCount: (r.linkedIssueIds || []).length,
      notes:            r.notes || '',
      version:          r.version ? `v${r.version}` : '',
      raw:              r,
    })
  }

  for (const d of webDeployments) {
    const date = d.targetDate || d.deployedAt || d.verifiedAt || ''
    items.push({
      id:               `wd-${d.id}`,
      type:             'deployment',
      name:             d.name || 'Unnamed Deployment',
      status:           d.status || 'Planning',
      targetDate:       date,
      platform:         d.deployType || 'Frontend',
      environment:      d.environment || 'Production',
      linkedIssueCount: (d.linkedIssueIds || []).length,
      notes:            d.notes || '',
      version:          '',
      raw:              d,
    })
  }

  // Release approval batch
  if (releaseApproval?.releaseName) {
    const approved  = releaseApproval.approvalState?.approved
    const deployed  = releaseApproval.deployedState?.deployed
    const isoDate   = releaseApproval.deployedState?.deployedAt || releaseApproval.approvalState?.approvedAt || ''
    const date      = isoDate ? isoDate.split('T')[0] : ''
    if (approved || deployed) {
      items.push({
        id:               'ra-draft',
        type:             'release_batch',
        name:             releaseApproval.releaseName,
        status:           deployed ? 'Deployed' : 'Approved',
        targetDate:       date,
        platform:         releaseApproval.releaseType || 'Mixed',
        environment:      releaseApproval.environment || 'Production',
        linkedIssueCount: (releaseApproval.selectedIssueIds || []).length,
        notes:            releaseApproval.signOffNotes || '',
        version:          '',
        raw:              releaseApproval,
      })
    }
  }

  // Issues with due dates
  const relStatuses = new Set(['Ready for Release', 'QA Approved'])
  for (const iss of allIssues) {
    const st = normalizeStatus(iss.status)
    if (!relStatuses.has(st)) continue
    if (!iss.dueDate) continue
    const proj = projectsMap[iss.projectId]
    const key  = issueKey(proj?.name, iss.id)
    items.push({
      id:               `iss-${iss.id}`,
      type:             'issue',
      name:             `${key}: ${iss.title || '(Untitled)'}`,
      status:           st,
      targetDate:       iss.dueDate,
      platform:         null,
      environment:      null,
      linkedIssueCount: 0,
      notes:            '',
      version:          '',
      raw:              iss,
      issueRef:         iss,
      projectName:      proj?.name || '',
    })
  }

  return items
}

// ── Copy helpers ──────────────────────────────────────────────────────────────

function renderItemLine(item) {
  const tc = typeConfig(item)
  const dl = daysLabel(item.targetDate)
  const parts = [
    `[${tc.label}]`,
    item.name,
    `— ${item.status}`,
    item.targetDate ? `| Target: ${fmtDate(item.targetDate)}${dl ? ` (${dl})` : ''}` : '',
    item.environment ? `| Env: ${item.environment}` : '',
    item.linkedIssueCount > 0 ? `| ${item.linkedIssueCount} issue${item.linkedIssueCount !== 1 ? 's' : ''}` : '',
    item.version ? `| ${item.version}` : '',
  ]
  return parts.filter(Boolean).join(' ')
}

function buildCopyText(title, items) {
  if (!items.length) return `${title}\n\n(No items)`
  const date  = new Date().toLocaleDateString('en-AE', { day: 'numeric', month: 'long', year: 'numeric' })
  const lines = [`# ${title}`, `Generated: ${date}`, '']
  for (const item of items) lines.push(renderItemLine(item))
  return lines.join('\n')
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyBtn({ label, getText }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    const text = typeof getText === 'function' ? getText() : getText
    if (!text) return
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else {
        const ta = Object.assign(document.createElement('textarea'), { value: text, style: 'position:fixed;top:-9999px' })
        document.body.appendChild(ta); ta.select(); document.execCommand('copy')
        document.body.removeChild(ta)
      }
    } catch { /* ignore */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button type="button" className={`rc__copy-btn ${copied ? 'rc__copy-btn--done' : ''}`} onClick={handle}>
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

// ── Timeline item row ─────────────────────────────────────────────────────────

function TimelineItem({ item, onOpenIssue }) {
  const [expanded, setExpanded] = useState(false)
  const tc       = typeConfig(item)
  const bucket   = getBucket(item.targetDate)
  const isOverdue = bucket === 'overdue'
  const dl        = daysLabel(item.targetDate)
  const sc        = STATUS_COLORS[item.status] || '#6b7280'
  const isIssue   = item.type === 'issue'

  const handleRowClick = () => {
    if (isIssue && onOpenIssue) {
      onOpenIssue(item.issueRef)
    } else {
      setExpanded((v) => !v)
    }
  }

  return (
    <div className={`rc__item ${isOverdue ? 'rc__item--overdue' : ''} ${isIssue ? 'rc__item--issue' : ''}`}>
      <div
        className="rc__item-row"
        onClick={handleRowClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleRowClick()}
        aria-expanded={!isIssue ? expanded : undefined}
      >
        {/* Type icon */}
        <span className="rc__type-icon" style={{ color: tc.color }} title={tc.label}>
          <tc.Icon size={14} strokeWidth={1.8} />
        </span>

        {/* Name */}
        <span className="rc__item-name">{item.name}</span>

        {/* Version */}
        {item.version && <span className="rc__item-version">{item.version}</span>}

        {/* Status chip */}
        <span className="rc__item-status" style={{ '--sc': sc, '--scbg': `color-mix(in srgb, ${sc} 12%, transparent)` }}>
          {item.status}
        </span>

        {/* Environment */}
        {item.environment && (
          <span className={`rc__env-badge rc__env-badge--${item.environment.toLowerCase()}`}>{item.environment}</span>
        )}

        {/* Platform */}
        {item.platform && (
          <span className="rc__platform-chip">{item.platform}</span>
        )}

        {/* Linked issues */}
        {item.linkedIssueCount > 0 && (
          <span className="rc__linked-count">{item.linkedIssueCount} issue{item.linkedIssueCount !== 1 ? 's' : ''}</span>
        )}

        {/* Date */}
        <span className={`rc__item-date ${isOverdue ? 'rc__item-date--overdue' : ''}`}>
          {item.targetDate ? fmtDate(item.targetDate) : '—'}
          {dl && <span className="rc__day-label">{dl}</span>}
        </span>

        {/* Expand or open indicator */}
        <span className="rc__item-arrow" aria-hidden="true">
          {isIssue
            ? <span className="rc__open-hint">Open ›</span>
            : (expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
          }
        </span>
      </div>

      {/* Expanded detail */}
      {!isIssue && expanded && (
        <div className="rc__item-detail">
          {item.notes && (
            <p className="rc__detail-notes">{item.notes}</p>
          )}
          <div className="rc__detail-meta">
            {item.targetDate && <span><strong>Target:</strong> {fmtDate(item.targetDate)}</span>}
            {item.raw?.startedAt   && <span><strong>Started:</strong> {fmtDate(item.raw.startedAt)}</span>}
            {item.raw?.deployedAt  && <span><strong>Deployed:</strong> {fmtDate(item.raw.deployedAt)}</span>}
            {item.raw?.verifiedAt  && <span><strong>Verified:</strong> {fmtDate(item.raw.verifiedAt)}</span>}
            {item.raw?.submittedAt && <span><strong>Submitted:</strong> {fmtDate(item.raw.submittedAt)}</span>}
            {item.raw?.deployedBy  && <span><strong>By:</strong> {item.raw.deployedBy}</span>}
          </div>
          <p className="rc__detail-hint">
            {item.type === 'mobile' ? '↓ Edit in Mobile Release Tracker section below' : null}
            {item.type === 'deployment' ? '↓ Edit in Website & Backend Deployments section below' : null}
            {item.type === 'release_batch' ? '↑ Edit in Release Summary Builder above' : null}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * @param {{
 *   allIssues: object[],
 *   projectsMap: Record<string, object>,
 *   onOpenIssue: (issue: object) => void,
 * }} props
 */
export function ReleaseCalendar({ allIssues, projectsMap, onOpenIssue }) {
  const [collapsed,      setCollapsed]      = useState(false)
  const [refreshKey,     setRefreshKey]     = useState(0)
  const [filterType,     setFilterType]     = useState('all')
  const [filterStatus,   setFilterStatus]   = useState('all')
  const [filterEnv,      setFilterEnv]      = useState('all')
  const [overdueOnly,    setOverdueOnly]    = useState(false)
  const [showFilters,    setShowFilters]    = useState(false)
  const [expandedBuckets, setExpandedBuckets] = useState({ overdue: true, this_week: true, next_week: true, later: false, no_date: false })

  // Load from localStorage (re-reads on refreshKey change)
  const mobileReleases  = useMemo(() => loadMobileReleases(),       [refreshKey]) // eslint-disable-line
  const webDeployments  = useMemo(() => loadWebDeployments(),       [refreshKey]) // eslint-disable-line
  const releaseApproval = useMemo(() => loadReleaseApprovalDraft(), [refreshKey]) // eslint-disable-line

  // Build all items
  const allItems = useMemo(
    () => buildItems(mobileReleases, webDeployments, releaseApproval, allIssues, projectsMap),
    [mobileReleases, webDeployments, releaseApproval, allIssues, projectsMap]
  )

  // Unique statuses for filter
  const statusOptions = useMemo(() => {
    const s = new Set(allItems.map((i) => i.status))
    return Array.from(s).sort()
  }, [allItems])

  // Filter
  const filtered = useMemo(() => {
    return allItems.filter((item) => {
      if (filterType   !== 'all' && item.type !== filterType)                         return false
      if (filterStatus !== 'all' && item.status !== filterStatus)                     return false
      if (filterEnv    !== 'all' && item.environment !== filterEnv)                   return false
      if (overdueOnly  && getBucket(item.targetDate) !== 'overdue')                   return false
      return true
    })
  }, [allItems, filterType, filterStatus, filterEnv, overdueOnly])

  // Group by bucket
  const grouped = useMemo(() => {
    const map = Object.fromEntries(BUCKET_CONFIG.map((b) => [b.key, []]))
    for (const item of filtered) map[getBucket(item.targetDate)].push(item)
    // Sort each bucket by date ascending
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        const da = parseDateMidnight(a.targetDate)
        const db = parseDateMidnight(b.targetDate)
        if (!da && !db) return 0
        if (!da) return 1
        if (!db) return -1
        return da - db
      })
    }
    return map
  }, [filtered])

  // Items this week / overdue for copy helpers
  const thisWeekItems = grouped.this_week || []
  const overdueItems  = grouped.overdue   || []
  const upcomingItems = [...(grouped.this_week || []), ...(grouped.next_week || [])]

  const toggleBucket = useCallback((key) => {
    setExpandedBuckets((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const totalCount = filtered.length
  const overdueCount = overdueItems.length

  // ── Copy helpers ────────────────────────────────────────────────────────────
  const getThisWeekText   = () => buildCopyText('This Week Release Plan',      thisWeekItems)
  const getOverdueText    = () => buildCopyText('Overdue Release Items',       overdueItems)
  const getUpcomingText   = () => buildCopyText('Upcoming Deployment Plan',    upcomingItems)

  if (collapsed) {
    return (
      <div className="rc rc--collapsed">
        <div className="rc__header">
          <div className="rc__header-left">
            <Calendar size={15} className="rc__header-icon" />
            <span className="rc__header-title">Release Calendar</span>
            {overdueCount > 0 && <span className="rc__overdue-badge">{overdueCount} overdue</span>}
            <span className="rc__total-badge">{totalCount} items</span>
          </div>
          <button className="rc__collapse-btn" onClick={() => setCollapsed(false)} aria-label="Expand">
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rc">
      {/* Header */}
      <div className="rc__header">
        <div className="rc__header-left">
          <Calendar size={15} className="rc__header-icon" />
          <span className="rc__header-title">Release Calendar</span>
          {overdueCount > 0 && <span className="rc__overdue-badge">{overdueCount} overdue</span>}
          <span className="rc__total-badge">{totalCount} item{totalCount !== 1 ? 's' : ''}</span>
        </div>
        <div className="rc__header-right">
          <button className="rc__icon-btn" onClick={() => setRefreshKey((k) => k + 1)} title="Refresh from storage">
            <RefreshCw size={13} />
          </button>
          <button
            className={`rc__icon-btn ${showFilters ? 'rc__icon-btn--active' : ''}`}
            onClick={() => setShowFilters((v) => !v)}
            title="Filters"
          >
            <Filter size={13} />
          </button>
          <button className="rc__collapse-btn" onClick={() => setCollapsed(true)} aria-label="Collapse">
            <ChevronUp size={14} />
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="rc__filters">
          <select className="rc__filter-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">All Types</option>
            <option value="mobile">Mobile</option>
            <option value="deployment">Deployment</option>
            <option value="release_batch">Release Batch</option>
            <option value="issue">Issue</option>
          </select>
          <select className="rc__filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">All Statuses</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="rc__filter-select" value={filterEnv} onChange={(e) => setFilterEnv(e.target.value)}>
            <option value="all">All Environments</option>
            <option value="Production">Production</option>
            <option value="Staging">Staging</option>
          </select>
          <label className="rc__toggle-label">
            <input
              type="checkbox"
              className="rc__toggle-check"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
            />
            Overdue only
          </label>
          {(filterType !== 'all' || filterStatus !== 'all' || filterEnv !== 'all' || overdueOnly) && (
            <button
              className="rc__clear-filter"
              onClick={() => { setFilterType('all'); setFilterStatus('all'); setFilterEnv('all'); setOverdueOnly(false) }}
            >
              <X size={11} /> Clear
            </button>
          )}
        </div>
      )}

      {/* Copy actions */}
      <div className="rc__copy-bar">
        <CopyBtn label="This Week Release Plan"    getText={getThisWeekText}  />
        <CopyBtn label="Overdue Release Items"     getText={getOverdueText}   />
        <CopyBtn label="Upcoming Deployment Plan"  getText={getUpcomingText}  />
      </div>

      {/* Empty state */}
      {totalCount === 0 && (
        <div className="rc__empty">
          <Calendar size={28} className="rc__empty-icon" />
          <p>No release items found.</p>
          <p>Create mobile releases or deployments below, or add due dates to Ready for Release issues.</p>
        </div>
      )}

      {/* Buckets */}
      {BUCKET_CONFIG.map(({ key, label, cls }) => {
        const items = grouped[key] || []
        if (items.length === 0 && key !== 'this_week') return null
        const isOpen = expandedBuckets[key]
        return (
          <div key={key} className={`rc__bucket rc__bucket--${cls}`}>
            <button
              type="button"
              className="rc__bucket-header"
              onClick={() => toggleBucket(key)}
            >
              {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              <span className="rc__bucket-label">{label}</span>
              <span className="rc__bucket-count">{items.length}</span>
            </button>

            {isOpen && (
              <div className="rc__bucket-items">
                {items.length === 0 ? (
                  <p className="rc__bucket-empty">No items scheduled this week.</p>
                ) : (
                  items.map((item) => (
                    <TimelineItem
                      key={item.id}
                      item={item}
                      onOpenIssue={onOpenIssue}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
