/**
 * savedViews.js
 * Built-in views + localStorage helpers for custom saved views.
 * UI always says "View / Views". No Sprint / Task / Jira wording.
 *
 * TODO: When a server-side user-preferences API is available,
 * migrate custom views from localStorage to the server so they
 * persist across devices.
 */

/** LocalStorage key for custom (user-created) views. */
export const STORAGE_KEY = 'lifesmile.linear.savedViews.v1'

/**
 * Sentinel value for activeCycle in built-in views.
 * At runtime, LinearPlannerPage resolves this to the first cycle
 * with status 'active'. Falls back to null if no active cycle exists.
 */
export const ACTIVE_CYCLE_SENTINEL = '__active_cycle__'

/**
 * The shape of a view's filter snapshot.
 * All fields are optional — missing fields fall back to the
 * current default (usually null / empty).
 *
 * @typedef {Object} ViewFilters
 * @property {string}             search
 * @property {string}             groupBy      - 'status' | 'priority' | 'assignee' | 'project' | 'none'
 * @property {Object}             activeFilters - { myIssues, highPri, dueSoon, unassigned }
 * @property {string|null}        activeLabel
 * @property {null|'none'|number|'__active_cycle__'} activeCycle
 * @property {string|null}        activeStatus
 * @property {string|null}        activePriority
 */

/** Built-in non-deletable views. */
export const BUILTIN_VIEWS = [
  {
    id: 'all',
    label: 'All Issues',
    icon: 'LayoutList',
    builtin: true,
    filters: {
      search: '', groupBy: 'status', activeFilters: {},
      activeLabel: null, activeCycle: null,
      activeStatus: null, activePriority: null,
    },
  },
  {
    id: 'my-issues',
    label: 'My Issues',
    icon: 'User',
    builtin: true,
    filters: {
      search: '', groupBy: 'status', activeFilters: { myIssues: true },
      activeLabel: null, activeCycle: null,
      activeStatus: null, activePriority: null,
    },
  },
  {
    id: 'website-bugs',
    label: 'Website Bugs',
    icon: 'Bug',
    builtin: true,
    filters: {
      search: '', groupBy: 'status', activeFilters: {},
      activeLabel: 'Bug', activeCycle: null,
      activeStatus: null, activePriority: null,
    },
  },
  {
    id: 'release-blockers',
    label: 'Release Blockers',
    icon: 'AlertCircle',
    builtin: true,
    filters: {
      search: '', groupBy: 'status', activeFilters: {},
      activeLabel: 'Release Blocker', activeCycle: null,
      activeStatus: null, activePriority: null,
    },
  },
  {
    id: 'current-cycle',
    label: 'Current Cycle',
    icon: 'RotateCcw',
    builtin: true,
    filters: {
      search: '', groupBy: 'status', activeFilters: {},
      activeLabel: null, activeCycle: ACTIVE_CYCLE_SENTINEL,
      activeStatus: null, activePriority: null,
    },
  },
  {
    id: 'ready-for-release',
    label: 'Ready for Release',
    icon: 'Rocket',
    builtin: true,
    filters: {
      search: '', groupBy: 'status', activeFilters: {},
      activeLabel: null, activeCycle: null,
      activeStatus: 'Ready for Release', activePriority: null,
    },
  },
  {
    id: 'unassigned-high',
    label: 'Unassigned High Priority',
    icon: 'AlertTriangle',
    builtin: true,
    filters: {
      search: '', groupBy: 'priority',
      activeFilters: { unassigned: true, highPri: true },
      activeLabel: null, activeCycle: null,
      activeStatus: null, activePriority: null,
    },
  },
  {
    id: 'mobile-ux',
    label: 'Mobile UX',
    icon: 'Smartphone',
    builtin: true,
    filters: {
      search: '', groupBy: 'status', activeFilters: {},
      activeLabel: 'Mobile UX', activeCycle: null,
      activeStatus: null, activePriority: null,
    },
  },
  {
    id: 'backend-api',
    label: 'Backend/API Work',
    icon: 'Server',
    builtin: true,
    filters: {
      search: '', groupBy: 'status', activeFilters: {},
      activeLabel: null, activeCycle: null,
      activeStatus: null, activePriority: null,
      // Uses search fallback since there's no separate team filter yet
      _searchHint: 'api',
    },
  },
]

// Patch the backend-api view's search hint into the actual search field
BUILTIN_VIEWS[BUILTIN_VIEWS.length - 1].filters.search = 'api'

/** Load custom (user-created) views from localStorage. */
export function loadCustomViews() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Persist custom views to localStorage. */
export function saveCustomViewsToStorage(views) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(views.filter((v) => !v.builtin)))
  } catch {
    // localStorage unavailable — silently ignore
  }
}

/**
 * Capture the current filter state as a serialisable snapshot.
 * Excludes activeCycle sentinel — stores the resolved value.
 */
export function captureFilters({
  search, groupBy, activeFilters, activeLabel, activeCycle,
  activeStatus, activePriority,
}) {
  return {
    search:         search         ?? '',
    groupBy:        groupBy        ?? 'status',
    activeFilters:  activeFilters  ?? {},
    activeLabel:    activeLabel    ?? null,
    activeCycle:    activeCycle    ?? null,
    activeStatus:   activeStatus   ?? null,
    activePriority: activePriority ?? null,
  }
}

/** Returns true if any non-default filter is set. */
export function hasActiveFilter({ search, activeFilters, activeLabel, activeCycle, activeStatus, activePriority }) {
  return (
    Boolean(search?.trim()) ||
    Object.values(activeFilters || {}).some(Boolean) ||
    activeLabel != null ||
    activeCycle != null ||
    activeStatus != null ||
    activePriority != null
  )
}
