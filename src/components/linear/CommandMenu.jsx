/**
 * CommandMenu.jsx
 * Linear-style Cmd+K / Ctrl+K command palette for the Issues module.
 * Fully frontend — no backend calls.
 * Opened by keyboard shortcut or TopBar button.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, X, Plus, LayoutList, Tag, RotateCcw, Bookmark, SlidersHorizontal,
  Globe, Server, Smartphone, AlertCircle, AlertTriangle, Rocket, Bug, User, Users,
  XCircle, ArrowRight, FolderOpen, Layers, Map, BarChart2, Inbox, Package, Settings, GitBranch,
  ClipboardCheck,
} from 'lucide-react'
import { DEFAULT_LABELS } from './linearLabels'
import { issueKey, normalizeStatus } from './IssueRow'
import './CommandMenu.css'

// ── Icon map for view icons (string → component) ──────────────────────────────

const VIEW_ICON_MAP = {
  LayoutList, User, Bug, AlertCircle, RotateCcw,
  Rocket, AlertTriangle, Smartphone, Server, Bookmark, FolderOpen,
}

const CYCLE_STATUS_COLOR = { planned: '#a5b4fc', active: '#6ee7b7', completed: '#9ca3af' }

// ── Build flat command list ───────────────────────────────────────────────────

function buildCommands({
  allCycles, allViews, allProjects, allMembers,
  onNewIssue, onApplyView, onSetGroupBy,
  onSetActiveLabel, onSetActiveCycle, onSetActiveProject, onSetActiveAssignee,
  onClearFilters, onManageCycles, onClose,
}) {
  const cmds = []

  // ── Issue actions ────────────────────────────────────────────────────────
  cmds.push({
    id: 'new-issue', group: 'Issues', label: 'New Issue',
    Icon: Plus, hint: '⌘N', keywords: ['create', 'add', 'new', 'issue'],
    action: () => { onNewIssue(); onClose() },
  })
  cmds.push({
    id: 'clear-filters', group: 'Issues', label: 'Clear All Filters',
    Icon: XCircle, keywords: ['reset', 'clear', 'remove', 'filter'],
    action: () => { onClearFilters(); onClose() },
  })
  for (const [value, label] of [
    ['status',   'Group by Status'],
    ['priority', 'Group by Priority'],
    ['assignee', 'Group by Assignee'],
    ['project',  'Group by Project'],
    ['none',     'Group by None'],
  ]) {
    cmds.push({
      id: `group-${value}`, group: 'Issues', label,
      Icon: SlidersHorizontal, keywords: ['group', 'sort', value],
      action: () => { onSetGroupBy(value); onClose() },
    })
  }

  // ── Views ────────────────────────────────────────────────────────────────
  for (const view of allViews) {
    const Icon = VIEW_ICON_MAP[view.icon] || Bookmark
    cmds.push({
      id: `view-${view.id}`, group: 'Views', label: view.label,
      Icon, keywords: ['view', 'filter', view.label.toLowerCase()],
      action: () => { onApplyView(view); onClose() },
    })
  }

  // ── Labels ───────────────────────────────────────────────────────────────
  for (const lbl of DEFAULT_LABELS) {
    cmds.push({
      id: `label-${lbl}`, group: 'Labels', label: lbl,
      Icon: Tag, keywords: ['label', 'tag', lbl.toLowerCase()],
      dot: true,
      action: () => { onSetActiveLabel(lbl); onClose() },
    })
  }
  cmds.push({
    id: 'clear-label', group: 'Labels', label: 'Clear Label Filter',
    Icon: XCircle, keywords: ['clear', 'remove', 'label'],
    action: () => { onSetActiveLabel(null); onClose() },
  })

  // ── Cycles ───────────────────────────────────────────────────────────────
  for (const c of allCycles) {
    cmds.push({
      id: `cycle-${c.id}`, group: 'Cycles', label: c.name,
      Icon: RotateCcw, keywords: ['cycle', c.name.toLowerCase()],
      cycleStatus: c.status,
      action: () => { onSetActiveCycle(c.id); onClose() },
    })
  }
  cmds.push({
    id: 'cycle-none', group: 'Cycles', label: 'No Cycle',
    Icon: RotateCcw, keywords: ['cycle', 'no cycle', 'none'],
    action: () => { onSetActiveCycle('none'); onClose() },
  })
  cmds.push({
    id: 'clear-cycle', group: 'Cycles', label: 'Clear Cycle Filter',
    Icon: XCircle, keywords: ['clear', 'cycle'],
    action: () => { onSetActiveCycle(null); onClose() },
  })
  cmds.push({
    id: 'manage-cycles', group: 'Cycles', label: 'Manage Cycles',
    Icon: RotateCcw, keywords: ['cycle', 'create', 'manage'],
    action: () => { onManageCycles(); onClose() },
  })

  // ── Team / Assignee ──────────────────────────────────────────────────────
  cmds.push({
    id: 'nav-team-page', group: 'Team', label: 'Go to Team',
    Icon: Users, keywords: ['team', 'members', 'workload', 'navigate'],
    action: () => { window.location.hash = '#/projects/linear/team'; onClose() },
  })
  cmds.push({
    id: 'nav-workload', group: 'Team', label: 'Go to Workload',
    Icon: BarChart2, keywords: ['workload', 'capacity', 'load', 'navigate'],
    action: () => { window.location.hash = '#/projects/linear/workload'; onClose() },
  })
  cmds.push({
    id: 'workload-unassigned', group: 'Team', label: 'Show Unassigned Work',
    Icon: User, keywords: ['unassigned', 'no assignee', 'workload'],
    action: () => { onSetActiveAssignee?.('unassigned'); window.location.hash = '#/projects/linear'; onClose() },
  })
  cmds.push({
    id: 'assignee-unassigned', group: 'Team', label: 'Show Unassigned Issues',
    Icon: User, keywords: ['unassigned', 'no assignee', 'filter'],
    action: () => { onSetActiveAssignee?.('unassigned'); onClose() },
  })
  for (const m of allMembers) {
    const name = m.displayName || m.username
    cmds.push({
      id: `assignee-${m.id}`, group: 'Team', label: `${name}'s Issues`,
      Icon: User, keywords: ['assignee', 'member', name.toLowerCase()],
      action: () => { onSetActiveAssignee?.(m.id); onClose() },
    })
  }

  // ── Projects ─────────────────────────────────────────────────────────────
  for (const p of allProjects) {
    cmds.push({
      id: `project-${p.id}`, group: 'Projects', label: p.name,
      Icon: FolderOpen, keywords: ['project', 'open', p.name.toLowerCase()],
      action: () => {
        // Navigate to Issues filtered by project
        window.location.hash = '#/projects/linear'
        onSetActiveProject?.(p.id)
        onClose()
      },
    })
  }
  cmds.push({
    id: 'nav-projects-overview', group: 'Projects', label: 'View All Projects',
    Icon: Layers, keywords: ['projects', 'overview', 'all'],
    action: () => { window.location.hash = '#/projects/linear/projects'; onClose() },
  })

  // ── Navigation ───────────────────────────────────────────────────────────
  cmds.push({
    id: 'nav-issues', group: 'Navigate', label: 'Go to Issues',
    Icon: LayoutList, keywords: ['go', 'navigate', 'issues', 'linear'],
    action: () => { window.location.hash = '#/projects/linear'; onClose() },
  })
  cmds.push({
    id: 'nav-inbox', group: 'Navigate', label: 'Go to Inbox',
    Icon: Inbox, keywords: ['go', 'navigate', 'inbox', 'notifications', 'attention'],
    action: () => { window.location.hash = '#/projects/linear/inbox'; onClose() },
  })
  cmds.push({
    id: 'nav-inbox-review', group: 'Navigate', label: 'Inbox: Show Review Items',
    Icon: Inbox, keywords: ['inbox', 'review', 'in review'],
    action: () => { window.location.hash = '#/projects/linear/inbox'; onClose() },
  })
  cmds.push({
    id: 'nav-inbox-ready', group: 'Navigate', label: 'Inbox: Show Ready for Release',
    Icon: Inbox, keywords: ['inbox', 'ready', 'release', 'ship'],
    action: () => { window.location.hash = '#/projects/linear/inbox'; onClose() },
  })
  cmds.push({
    id: 'nav-inbox-overdue', group: 'Navigate', label: 'Inbox: Show Overdue Issues',
    Icon: Inbox, keywords: ['inbox', 'overdue', 'due date'],
    action: () => { window.location.hash = '#/projects/linear/inbox'; onClose() },
  })
  cmds.push({
    id: 'nav-inbox-blocked', group: 'Navigate', label: 'Inbox: Show Blocked Issues',
    Icon: Inbox, keywords: ['inbox', 'blocked', 'blocker'],
    action: () => { window.location.hash = '#/projects/linear/inbox'; onClose() },
  })
  cmds.push({
    id: 'nav-projects-page', group: 'Navigate', label: 'Go to Projects',
    Icon: FolderOpen, keywords: ['go', 'navigate', 'projects', 'overview'],
    action: () => { window.location.hash = '#/projects/linear/projects'; onClose() },
  })
  cmds.push({
    id: 'nav-team-link', group: 'Navigate', label: 'Go to Team',
    Icon: Users, keywords: ['go', 'navigate', 'team', 'members'],
    action: () => { window.location.hash = '#/projects/linear/team'; onClose() },
  })
  cmds.push({
    id: 'nav-roadmap', group: 'Navigate', label: 'Go to Roadmap',
    Icon: Map, keywords: ['go', 'navigate', 'roadmap', 'plan', 'delivery'],
    action: () => { window.location.hash = '#/projects/linear/roadmap'; onClose() },
  })
  cmds.push({
    id: 'nav-roadmap-now', group: 'Navigate', label: 'Roadmap: Now (In Progress)',
    Icon: Map, keywords: ['roadmap', 'now', 'in progress', 'active'],
    action: () => { window.location.hash = '#/projects/linear/roadmap'; onClose() },
  })
  cmds.push({
    id: 'nav-roadmap-ready', group: 'Navigate', label: 'Roadmap: Ready for Release',
    Icon: Map, keywords: ['roadmap', 'ready', 'release', 'ship'],
    action: () => { window.location.hash = '#/projects/linear/roadmap'; onClose() },
  })
  cmds.push({
    id: 'nav-team-link2', group: 'Navigate', label: 'Go to Team Planner (Classic)',
    Icon: FolderOpen, keywords: ['go', 'navigate', 'team', 'classic', 'planner'],
    action: () => { window.location.hash = '#/projects/team'; onClose() },
  })
  cmds.push({
    id: 'nav-releases', group: 'Navigate', label: 'Go to Releases',
    Icon: Package, keywords: ['go', 'navigate', 'releases', 'qa', 'handoff', 'deploy', 'ship'],
    action: () => { window.location.hash = '#/projects/linear/releases'; onClose() },
  })
  cmds.push({
    id: 'nav-releases-ready', group: 'Navigate', label: 'Releases: Show Ready for Release',
    Icon: Rocket, keywords: ['releases', 'ready', 'release', 'ship', 'qa'],
    action: () => { window.location.hash = '#/projects/linear/releases'; onClose() },
  })
  cmds.push({
    id: 'nav-releases-notes', group: 'Navigate', label: 'Releases: Copy Release Notes',
    Icon: Package, keywords: ['releases', 'release notes', 'copy', 'notes'],
    action: () => { window.location.hash = '#/projects/linear/releases'; onClose() },
  })
  cmds.push({
    id: 'nav-release-approval', group: 'Navigate', label: 'Releases: Release Approval Panel',
    Icon: ClipboardCheck, keywords: ['releases', 'release', 'approval', 'sign-off', 'signoff', 'approve', 'deploy'],
    action: () => { window.location.hash = '#/projects/linear/releases'; onClose() },
  })
  cmds.push({
    id: 'nav-release-deploy', group: 'Navigate', label: 'Releases: Copy Deployment Checklist',
    Icon: Rocket, keywords: ['releases', 'deploy', 'deployment', 'checklist', 'copy', 'sign-off'],
    action: () => { window.location.hash = '#/projects/linear/releases'; onClose() },
  })
  cmds.push({
    id: 'nav-release-smoke', group: 'Navigate', label: 'Releases: Copy Smoke Test',
    Icon: ClipboardCheck, keywords: ['releases', 'smoke', 'test', 'post-deploy', 'qa', 'copy'],
    action: () => { window.location.hash = '#/projects/linear/releases'; onClose() },
  })
  cmds.push({
    id: 'nav-mobile-releases', group: 'Navigate', label: 'Go to Mobile Releases',
    Icon: Smartphone, keywords: ['mobile', 'android', 'ios', 'app store', 'play store', 'releases', 'navigate'],
    action: () => { window.location.hash = '#/projects/linear/releases'; onClose() },
  })
  cmds.push({
    id: 'nav-mobile-create', group: 'Navigate', label: 'Create Mobile Release',
    Icon: Smartphone, keywords: ['mobile', 'android', 'ios', 'create', 'new', 'release'],
    action: () => { window.location.hash = '#/projects/linear/releases'; onClose() },
  })
  cmds.push({
    id: 'nav-mobile-qa', group: 'Navigate', label: 'Releases: Copy Mobile QA Handoff',
    Icon: ClipboardCheck, keywords: ['mobile', 'qa', 'handoff', 'android', 'ios', 'copy'],
    action: () => { window.location.hash = '#/projects/linear/releases'; onClose() },
  })
  cmds.push({
    id: 'nav-settings', group: 'Navigate', label: 'Go to Settings',
    Icon: Settings, keywords: ['go', 'navigate', 'settings', 'github', 'integration', 'config'],
    action: () => { window.location.hash = '#/projects/linear/settings'; onClose() },
  })
  cmds.push({
    id: 'nav-github-settings', group: 'Navigate', label: 'Go to GitHub Integration Settings',
    Icon: GitBranch, keywords: ['go', 'navigate', 'github', 'webhook', 'token', 'settings', 'integration'],
    action: () => { window.location.hash = '#/projects/linear/settings'; onClose() },
  })
  cmds.push({
    id: 'nav-planner', group: 'Navigate', label: 'Go to AI Planner',
    Icon: Server, keywords: ['go', 'navigate', 'ai', 'planner'],
    action: () => { window.location.hash = '#/projects'; onClose() },
  })

  return cmds
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreMatch(item, q) {
  const label = item.label.toLowerCase()
  if (label.startsWith(q)) return 3
  if (label.includes(q)) return 2
  if (item.keywords?.some((k) => k.includes(q))) return 1
  return 0
}

// ── Main component ────────────────────────────────────────────────────────────

export function CommandMenu({
  open,
  onClose,
  allIssues = [],
  allCycles = [],
  allViews  = [],
  allProjects = [],
  allMembers  = [],
  projectMap = {},
  onNewIssue,
  onApplyView,
  onSetGroupBy,
  onSetActiveLabel,
  onSetActiveCycle,
  onSetActiveProject,
  onSetActiveAssignee,
  onClearFilters,
  onManageCycles,
  onSelectIssue,
}) {
  const [query, setQuery]     = useState('')
  const [selIdx, setSelIdx]   = useState(0)
  const inputRef  = useRef(null)
  const listRef   = useRef(null)
  const selectedRef = useRef(null)

  // Reset state on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelIdx(0)
      setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [open])

  const handleClose = useCallback(() => {
    onClose()
    setQuery('')
    setSelIdx(0)
  }, [onClose])

  // Build flat command list (memoised — only changes when deps change)
  const flatCommands = useMemo(() => buildCommands({
    allCycles, allViews, allProjects, allMembers,
    onNewIssue, onApplyView, onSetGroupBy,
    onSetActiveLabel, onSetActiveCycle, onSetActiveProject, onSetActiveAssignee,
    onClearFilters, onManageCycles, onClose: handleClose,
  }), [allCycles, allViews, allProjects, allMembers, onNewIssue, onApplyView, onSetGroupBy,
      onSetActiveLabel, onSetActiveCycle, onSetActiveProject, onSetActiveAssignee,
      onClearFilters, onManageCycles, handleClose])

  // Filter commands + search issues
  const { sections, flatItems } = useMemo(() => {
    const q = query.trim().toLowerCase()

    let matchedCmds = flatCommands
    if (q) {
      matchedCmds = flatCommands
        .map((cmd) => ({ ...cmd, score: scoreMatch(cmd, q) }))
        .filter((cmd) => cmd.score > 0)
        .sort((a, b) => b.score - a.score)
    }

    // Group matched commands
    const grouped = {}
    for (const cmd of matchedCmds) {
      if (!grouped[cmd.group]) grouped[cmd.group] = []
      grouped[cmd.group].push({ type: 'command', ...cmd })
    }

    const sects = Object.entries(grouped).map(([group, items]) => ({ group, items }))

    // Issue search (only when there's a query)
    let issueItems = []
    if (q) {
      issueItems = allIssues
        .filter((i) =>
          i.title?.toLowerCase().includes(q) ||
          issueKey(projectMap[i.projectId]?.name, i.id)?.toLowerCase().includes(q)
        )
        .slice(0, 5)
        .map((i) => ({ type: 'issue', issue: i, id: `issue-${i.id}` }))
      if (issueItems.length) sects.push({ group: 'Issues', items: issueItems })
    }

    const flat = sects.flatMap((s) => s.items)
    return { sections: sects, flatItems: flat }
  }, [query, flatCommands, allIssues, projectMap])

  // Keep selectedIndex in range
  const clampedIdx = flatItems.length ? Math.min(selIdx, flatItems.length - 1) : 0

  useEffect(() => { setSelIdx(0) }, [query])

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [clampedIdx, sections])

  // Keyboard handler
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape')     { e.preventDefault(); handleClose(); return }
      if (e.key === 'ArrowDown')  { e.preventDefault(); setSelIdx((i) => Math.min(i + 1, flatItems.length - 1)); return }
      if (e.key === 'ArrowUp')    { e.preventDefault(); setSelIdx((i) => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter') {
        e.preventDefault()
        const item = flatItems[clampedIdx]
        if (!item) return
        if (item.type === 'command') item.action?.()
        if (item.type === 'issue') { onSelectIssue?.(item.issue); handleClose() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, flatItems, clampedIdx, handleClose, onSelectIssue])

  // Global Cmd+K / Ctrl+K listener (also closed by parent)
  useEffect(() => {
    function onGlobal(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); if (!open) onClose?.() }
    }
    // handled by parent; just suppress the browser default
    window.addEventListener('keydown', onGlobal)
    return () => window.removeEventListener('keydown', onGlobal)
  }, [open, onClose])

  if (!open) return null

  // Flat index tracker across sections
  let runningIdx = 0

  return createPortal(
    <div
      className="cm-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Command menu"
    >
      <div className="cm-panel">
        {/* Search input */}
        <div className="cm-search-wrap">
          <Search size={15} strokeWidth={2} className="cm-search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="cm-search"
            placeholder="Type a command or search issues…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Command search"
            autoComplete="off"
            spellCheck="false"
          />
          {query && (
            <button type="button" className="cm-search-clear" onClick={() => setQuery('')} aria-label="Clear">
              <X size={12} strokeWidth={2.5} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Results */}
        <div className="cm-results" ref={listRef} role="listbox">
          {sections.length === 0 && (
            <p className="cm-empty">No results for "{query}"</p>
          )}

          {sections.map(({ group, items }) => (
            <div key={group} className="cm-group">
              <div className="cm-group__label">{group}</div>
              {items.map((item) => {
                const idx = runningIdx++
                const isSelected = idx === clampedIdx
                const ref = isSelected ? selectedRef : null

                if (item.type === 'issue') {
                  const issue = item.issue
                  const project = projectMap[issue.projectId]
                  const key = issueKey(project?.name, issue.id)
                  const statusNorm = normalizeStatus(issue.status)
                  return (
                    <button
                      key={item.id}
                      ref={ref}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`cm-item ${isSelected ? 'cm-item--selected' : ''}`}
                      onClick={() => { onSelectIssue?.(issue); handleClose() }}
                      onMouseMove={() => setSelIdx(idx)}
                    >
                      <span className="cm-item__icon cm-item__icon--key">{key}</span>
                      <span className="cm-item__label">{issue.title}</span>
                      <span className="cm-item__hint cm-item__hint--status">{statusNorm}</span>
                    </button>
                  )
                }

                // Command item
                const { Icon, label, hint, dot, cycleStatus } = item
                return (
                  <button
                    key={item.id}
                    ref={ref}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`cm-item ${isSelected ? 'cm-item--selected' : ''}`}
                    onClick={() => item.action?.()}
                    onMouseMove={() => setSelIdx(idx)}
                  >
                    {dot ? (
                      <span className="cm-item__icon">
                        <span className="cm-item__dot" />
                      </span>
                    ) : cycleStatus ? (
                      <span className="cm-item__icon">
                        <Icon size={13} strokeWidth={2} style={{ color: CYCLE_STATUS_COLOR[cycleStatus] || '#a5b4fc' }} aria-hidden="true" />
                      </span>
                    ) : (
                      <span className="cm-item__icon">
                        <Icon size={13} strokeWidth={2} aria-hidden="true" />
                      </span>
                    )}
                    <span className="cm-item__label">{label}</span>
                    {hint && <span className="cm-item__hint">{hint}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="cm-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default CommandMenu
