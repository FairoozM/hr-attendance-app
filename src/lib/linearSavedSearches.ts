export type LinearSearchType = 'all' | 'issues' | 'docs' | 'intake' | 'releases' | 'deployments' | 'audit'

export type LinearWorkspaceResultType =
  | 'issue'
  | 'doc'
  | 'intake'
  | 'mobile_release'
  | 'deployment'
  | 'audit'

export type LinearWorkspaceSearchResult = {
  type: LinearWorkspaceResultType
  id: string | number
  title: string
  subtitle?: string
  snippet?: string
  url: string
  meta?: Record<string, any>
  score?: number
}

export type LinearSavedSearch = {
  name: string
  query: string
  type: LinearSearchType
  createdAt: string
  updatedAt: string
}

export type LinearBuiltinSearch = {
  id: string
  name: string
  query: string
  type: LinearSearchType
  description: string
}

export const LINEAR_SAVED_SEARCHES_KEY = 'lifesmile.linear.savedSearches.v1'

export const LINEAR_SEARCH_TYPES: LinearSearchType[] = [
  'all',
  'issues',
  'docs',
  'intake',
  'releases',
  'deployments',
  'audit',
]

const BUILTIN_SEARCHES: LinearBuiltinSearch[] = [
  { id: 'release-blockers', name: 'Release blockers', query: 'blocked', type: 'issues', description: 'Look for blocked issue work.' },
  { id: 'open-prs', name: 'Open PRs', query: 'github.com', type: 'issues', description: 'Find issues linked to pull requests.' },
  { id: 'merged-prs', name: 'Merged PRs', query: 'merged', type: 'issues', description: 'Look for merged PR references.' },
  { id: 'ready-for-release', name: 'Ready for Release', query: 'ready for release', type: 'issues', description: 'Show issues ready to ship.' },
  { id: 'needs-qa', name: 'Needs QA', query: 'qa', type: 'issues', description: 'Look for QA-related issue work.' },
  { id: 'overdue-issues', name: 'Overdue issues', query: 'overdue', type: 'issues', description: 'Look for overdue issue references.' },
  { id: 'unassigned-high-priority', name: 'Unassigned High Priority', query: 'high', type: 'issues', description: 'Quick high-priority issue search.' },
  { id: 'checkout-issues', name: 'Checkout issues', query: 'checkout', type: 'issues', description: 'Find checkout-related issue work.' },
  { id: 'mobile-ux', name: 'Mobile UX', query: 'mobile', type: 'all', description: 'Search across mobile and UX context.' },
  { id: 'backend-api', name: 'Backend/API issues', query: 'backend', type: 'issues', description: 'Find backend or API issue work.' },
  { id: 'recent-deployments', name: 'Recent deployments', query: 'prod', type: 'deployments', description: 'Search production deployment history.' },
  { id: 'intake-not-converted', name: 'Intake not converted', query: 'customer', type: 'intake', description: 'Look for intake items needing follow-up.' },
]

export function normalizeLinearSearchType(value: unknown, canSeeAudit = true): LinearSearchType {
  const next = String(value || 'all').trim().toLowerCase() as LinearSearchType
  if (!LINEAR_SEARCH_TYPES.includes(next)) return 'all'
  if (next === 'audit' && !canSeeAudit) return 'all'
  return next
}

export function buildLinearSearchHref({
  query,
  type = 'all',
}: {
  query: string
  type?: LinearSearchType
}) {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (type && type !== 'all') params.set('type', type)
  const qs = params.toString()
  return `#/projects/linear/search${qs ? `?${qs}` : ''}`
}

export function getBuiltinLinearSearches(canSeeAudit = true) {
  return BUILTIN_SEARCHES.filter((item) => canSeeAudit || item.type !== 'audit')
}

function coerceSavedSearch(candidate: any, canSeeAudit: boolean): LinearSavedSearch | null {
  if (!candidate || typeof candidate !== 'object') return null
  const name = String(candidate.name || '').trim()
  const query = String(candidate.query || '').trim()
  const type = normalizeLinearSearchType(candidate.type, canSeeAudit)
  const createdAt = String(candidate.createdAt || '').trim() || new Date().toISOString()
  const updatedAt = String(candidate.updatedAt || '').trim() || createdAt
  if (!name || !query) return null
  if (type === 'audit' && !canSeeAudit) return null
  return { name, query, type, createdAt, updatedAt }
}

export function normalizeLinearSavedSearches(raw: unknown, canSeeAudit = true): LinearSavedSearch[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => coerceSavedSearch(item, canSeeAudit))
    .filter(Boolean)
    .sort((a, b) => new Date(b!.updatedAt).getTime() - new Date(a!.updatedAt).getTime()) as LinearSavedSearch[]
}

export function savedSearchKey(search: Pick<LinearSavedSearch, 'name' | 'query' | 'type' | 'createdAt'>) {
  return [search.createdAt, search.name, search.query, search.type].join('::')
}

export function upsertLinearSavedSearch(
  items: LinearSavedSearch[],
  next: { name: string, query: string, type: LinearSearchType }
) {
  const now = new Date().toISOString()
  const normalizedName = String(next.name || '').trim()
  const normalizedQuery = String(next.query || '').trim()
  if (!normalizedName || !normalizedQuery) return items

  const existing = items.find(
    (item) =>
      item.name.toLowerCase() === normalizedName.toLowerCase() &&
      item.query.toLowerCase() === normalizedQuery.toLowerCase() &&
      item.type === next.type
  )

  if (existing) {
    return items
      .map((item) =>
        item === existing
          ? { ...item, name: normalizedName, updatedAt: now }
          : item
      )
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  return [
    {
      name: normalizedName,
      query: normalizedQuery,
      type: next.type,
      createdAt: now,
      updatedAt: now,
    },
    ...items,
  ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function removeLinearSavedSearch(items: LinearSavedSearch[], target: LinearSavedSearch) {
  const key = savedSearchKey(target)
  return items.filter((item) => savedSearchKey(item) !== key)
}
