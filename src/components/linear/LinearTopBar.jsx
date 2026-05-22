/**
 * LinearTopBar.jsx
 * Top bar for the Linear-style issues page.
 * Search · filter chips · grouping selector · New Issue button
 */
import { Search, X, ChevronDown, Plus, SlidersHorizontal } from 'lucide-react'
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

export function LinearTopBar({
  search,
  onSearch,
  groupBy,
  onGroupBy,
  activeFilters = {},
  onFilterToggle,
  onNewIssue,
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

      {/* Right: filter chips + grouping + new issue */}
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
      </div>
    </div>
  )
}

export default LinearTopBar
