/**
 * LinearTopBar.jsx
 * Top bar for the Linear-style issues page.
 * Search · filter chips · label filter · grouping selector · New Issue button
 */
import { useState, useRef, useEffect } from 'react'
import { Search, X, ChevronDown, Plus, SlidersHorizontal, Tag, RotateCcw, Bookmark } from 'lucide-react'
import { DEFAULT_LABELS, labelColors } from './linearLabels'
import './LinearTopBar.css'

const GROUP_OPTIONS = [
  { value: 'status',   label: 'Status'   },
  { value: 'priority', label: 'Priority' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'project',  label: 'Project'  },
  { value: 'none',     label: 'None'     },
]

const QUICK_FILTERS = [
  { id: 'myIssues',   label: 'My Issues'      },
  { id: 'highPri',    label: 'High Priority'  },
  { id: 'dueSoon',    label: 'Due Soon'       },
  { id: 'unassigned', label: 'Unassigned'     },
]

function LabelFilterDropdown({ activeLabel, onSelect }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          btnRef.current && !btnRef.current.contains(e.target)) {
        setOpen(false); setSearch('')
      }
    }
    function onKey(e) { if (e.key === 'Escape') { setOpen(false); setSearch('') } }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = DEFAULT_LABELS.filter(
    (l) => search === '' || l.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="ltb__label-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`ltb__chip ltb__chip--label ${activeLabel ? 'ltb__chip--on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Tag size={11} strokeWidth={2} aria-hidden="true" />
        {activeLabel || 'Label'}
        {activeLabel && (
          <span
            className="ltb__label-clear"
            onClick={(e) => { e.stopPropagation(); onSelect(null) }}
            role="button"
            aria-label="Clear label filter"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onSelect(null) } }}
          >
            <X size={9} strokeWidth={2.5} aria-hidden="true" />
          </span>
        )}
        <ChevronDown size={9} strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <div ref={menuRef} className="ltb__label-menu" role="listbox">
          <input
            type="text"
            className="ltb__label-search"
            placeholder="Filter labels…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="ltb__label-options">
            {filtered.map((lbl) => {
              const c = labelColors(lbl)
              return (
                <button
                  key={lbl}
                  type="button"
                  className={`ltb__label-option ${activeLabel === lbl ? 'ltb__label-option--on' : ''}`}
                  onClick={() => { onSelect(lbl === activeLabel ? null : lbl); setOpen(false); setSearch('') }}
                >
                  <span className="ltb__label-dot" style={{ background: c.text }} />
                  {lbl}
                </button>
              )
            })}
            {filtered.length === 0 && <p className="ltb__label-empty">No labels</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function CycleFilterDropdown({ activeCycle, cycles = [], onSelect }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          btnRef.current && !btnRef.current.contains(e.target)) {
        setOpen(false); setSearch('')
      }
    }
    function onKey(e) { if (e.key === 'Escape') { setOpen(false); setSearch('') } }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = cycles.filter(
    (c) => search === '' || c.name.toLowerCase().includes(search.toLowerCase())
  )

  const activeCycleName = activeCycle === 'none'
    ? 'No Cycle'
    : activeCycle != null
      ? cycles.find((c) => c.id === activeCycle)?.name || 'Cycle'
      : null

  return (
    <div className="ltb__label-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`ltb__chip ltb__chip--label ${activeCycle != null ? 'ltb__chip--on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <RotateCcw size={11} strokeWidth={2} aria-hidden="true" />
        {activeCycleName || 'Cycle'}
        {activeCycle != null && (
          <span
            className="ltb__label-clear"
            onClick={(e) => { e.stopPropagation(); onSelect(null) }}
            role="button"
            aria-label="Clear cycle filter"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onSelect(null) } }}
          >
            <X size={9} strokeWidth={2.5} aria-hidden="true" />
          </span>
        )}
        <ChevronDown size={9} strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <div ref={menuRef} className="ltb__label-menu" role="listbox">
          <input
            type="text"
            className="ltb__label-search"
            placeholder="Filter cycles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="ltb__label-options">
            {/* No Cycle option */}
            <button
              type="button"
              className={`ltb__label-option ${activeCycle === 'none' ? 'ltb__label-option--on' : ''}`}
              onClick={() => { onSelect(activeCycle === 'none' ? null : 'none'); setOpen(false); setSearch('') }}
            >
              <span className="ltb__label-dot" style={{ background: '#6b7280' }} />
              No Cycle
            </button>

            {filtered.map((c) => {
              const dotColor = c.status === 'active' ? '#6ee7b7' : c.status === 'completed' ? '#9ca3af' : '#a5b4fc'
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`ltb__label-option ${activeCycle === c.id ? 'ltb__label-option--on' : ''}`}
                  onClick={() => { onSelect(activeCycle === c.id ? null : c.id); setOpen(false); setSearch('') }}
                >
                  <span className="ltb__label-dot" style={{ background: dotColor }} />
                  {c.name}
                </button>
              )
            })}
            {filtered.length === 0 && search && <p className="ltb__label-empty">No cycles found</p>}
          </div>
        </div>
      )}
    </div>
  )
}

export function LinearTopBar({
  search,
  onSearch,
  groupBy,
  onGroupBy,
  activeFilters = {},
  onFilterToggle,
  activeLabel,
  onLabelFilter,
  activeCycle,
  onCycleFilter,
  cycles = [],
  onNewIssue,
  onSaveView,
  hasActiveFilters = false,
  title = 'All Issues',
  issueCount = null,
}) {
  return (
    <div className="ltb">
      {/* Left: title */}
      <div className="ltb__left">
        <span className="ltb__title">{title}</span>
        {issueCount != null && (
          <span className="ltb__count">{issueCount}</span>
        )}
      </div>

      {/* Centre: search */}
      <div className="ltb__search-wrap">
        <Search size={13} strokeWidth={2} className="ltb__search-icon" aria-hidden="true" />
        <input
          type="search"
          className="ltb__search"
          placeholder="Search issues…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          aria-label="Search issues"
        />
        {search && (
          <button
            type="button"
            className="ltb__search-clear"
            onClick={() => onSearch('')}
            aria-label="Clear search"
          >
            <X size={11} strokeWidth={2.5} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Right: filter chips + label filter + grouping + new issue */}
      <div className="ltb__right">
        {/* Quick filter chips */}
        <div className="ltb__chips">
          {QUICK_FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`ltb__chip ${activeFilters[id] ? 'ltb__chip--on' : ''}`}
              onClick={() => onFilterToggle(id)}
            >
              {label}
            </button>
          ))}
          {/* Label filter */}
          <LabelFilterDropdown
            activeLabel={activeLabel}
            onSelect={onLabelFilter}
          />
          {/* Cycle filter */}
          <CycleFilterDropdown
            activeCycle={activeCycle}
            cycles={cycles}
            onSelect={onCycleFilter}
          />
        </div>

        {/* Group by */}
        <div className="ltb__group-wrap">
          <SlidersHorizontal size={12} strokeWidth={2} aria-hidden="true" />
          <select
            className="ltb__group-select"
            value={groupBy}
            onChange={(e) => onGroupBy(e.target.value)}
            aria-label="Group by"
          >
            {GROUP_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <ChevronDown size={11} strokeWidth={2} aria-hidden="true" />
        </div>

        {/* New Issue */}
        <button
          type="button"
          className="ltb__new-btn"
          onClick={onNewIssue}
          aria-label="Create new issue"
        >
          <Plus size={13} strokeWidth={2.5} aria-hidden="true" />
          New Issue
        </button>

        {/* Save View */}
        <button
          type="button"
          className={`ltb__save-btn ${hasActiveFilters ? 'ltb__save-btn--active' : ''}`}
          onClick={onSaveView}
          aria-label="Save current filters as a view"
          title="Save current filters as a view"
        >
          <Bookmark size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

export default LinearTopBar
