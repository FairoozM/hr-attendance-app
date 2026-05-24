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
  Globe, Server, Smartphone, AlertCircle, AlertTriangle, Rocket, Bug, User,
  XCircle, ArrowRight, FolderOpen,
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
  allCycles, allViews,
  onNewIssue, onApplyView, onSetGroupBy,
  onSetActiveLabel, onSetActiveCycle,
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

  // ── Navigation ───────────────────────────────────────────────────────────
  cmds.push({
    id: 'nav-issues', group: 'Navigate', label: 'Go to Issues',
    Icon: LayoutList, keywords: ['go', 'navigate', 'issues', 'linear'],
    action: () => { window.location.hash = '#/projects/linear'; onClose() },
  })
  cmds.push({
    id: 'nav-team', group: 'Navigate', label: 'Go to Projects',
    Icon: FolderOpen, keywords: ['go', 'navigate', 'projects', 'team'],
    action: () => { window.location.hash = '#/projects/team'; onClose() },
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
  projectMap = {},
  onNewIssue,
  onApplyView,
  onSetGroupBy,
  onSetActiveLabel,
  onSetActiveCycle,
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
    allCycles, allViews,
    onNewIssue, onApplyView, onSetGroupBy,
    onSetActiveLabel, onSetActiveCycle,
    onClearFilters, onManageCycles, onClose: handleClose,
  }), [allCycles, allViews, onNewIssue, onApplyView, onSetGroupBy,
      onSetActiveLabel, onSetActiveCycle, onClearFilters, onManageCycles, handleClose])

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
