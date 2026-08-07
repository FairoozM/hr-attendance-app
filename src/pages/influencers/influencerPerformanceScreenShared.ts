import {
  dedupePerformanceRecords,
  normalizePerformanceRecord,
  toNumber,
} from '../../utils/influencerPerformanceUtils'
import { PREF_INFLUENCER_PERF } from '../../constants/userPreferenceKeys'
import { getUserPrefKey, requestUserPrefSave } from '../../lib/userPreferencesBridge'
import type { InfluencerPerformance, InfluencerPerformanceInput } from '../../types/influencer'

/** Cap contract-search results in performance timeline panels (desktop + phone). */
export const CONTRACT_TIMELINE_RESULTS_CAP = 60

export function addContractUrl(influencerId?: string): string {
  const base = '/influencers/performance?add=1'
  if (!influencerId || influencerId === 'all') return base
  return `${base}&influencer=${encodeURIComponent(influencerId)}`
}

export const STORAGE_KEY = 'hr-influencer-performance-v1'
export const TOMBSTONE_KEY = 'hr-influencer-performance-tombstones-v1'

const TOMBSTONE_TTL_MS = 1000 * 60 * 60 * 24 * 90

type PerfBundle = {
  records?: InfluencerPerformanceInput[]
  tombstones?: Record<string, number>
  [key: string]: unknown
}

export type PerformanceSortOption = {
  value: string
  label: string
  adminOnly?: boolean
}

function readPerfBundle(): PerfBundle {
  const b = getUserPrefKey(PREF_INFLUENCER_PERF, null)
  return b && typeof b === 'object' ? (b as PerfBundle) : {}
}

function writePerfBundle(patch: Partial<PerfBundle>): void {
  const cur = readPerfBundle()
  const next = { ...cur, ...patch }
  requestUserPrefSave(PREF_INFLUENCER_PERF, next)
}

export function loadTombstones(): Map<string, number> {
  try {
    const parsed = readPerfBundle().tombstones
    if (!parsed || typeof parsed !== 'object') return new Map()
    return new Map(Object.entries(parsed).map(([k, v]) => [String(k), Number(v) || 0]))
  } catch {
    return new Map()
  }
}

export function saveTombstones(map: Map<string, number>): void {
  try {
    const obj: Record<string, number> = {}
    for (const [k, v] of map) obj[k] = v
    writePerfBundle({ tombstones: obj })
  } catch {
    /* ignore */
  }
}

export function pruneTombstones(map = loadTombstones()): Map<string, number> {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS
  for (const [k, ts] of map) {
    if (!ts || ts < cutoff) map.delete(k)
  }
  saveTombstones(map)
  return map
}

export function addTombstone(id: string | number | null | undefined, ts = Date.now()): void {
  if (!id) return
  const map = pruneTombstones()
  map.set(String(id), ts)
  saveTombstones(map)
}

export const PERFORMANCE_SORT_OPTIONS: PerformanceSortOption[] = [
  { value: 'rank:asc', label: 'Best net profit (AED) first' },
  { value: 'date:desc', label: 'Newest records first' },
  { value: 'date:asc', label: 'Oldest records first' },
  { value: 'views:desc', label: 'Top views first' },
  { value: 'views:asc', label: 'Lowest views first' },
  { value: 'likes:desc', label: 'Top likes first' },
  { value: 'comments:desc', label: 'Top comments first' },
  { value: 'shares:desc', label: 'Top shares first' },
  { value: 'salesAed:desc', label: 'Top sales (AED) first' },
  { value: 'salesAed:asc', label: 'Lowest sales (AED) first' },
  { value: 'netProfitAed:desc', label: 'Top net profit (AED) first', adminOnly: true },
  { value: 'netProfitAed:asc', label: 'Lowest net profit (AED) first', adminOnly: true },
  { value: 'cost:desc', label: 'Highest cost first' },
  { value: 'cost:asc', label: 'Lowest cost first' },
  { value: 'influencer:asc', label: 'Influencer A-Z' },
]

export function loadStoredRecords(): InfluencerPerformance[] | null {
  try {
    const parsed = readPerfBundle().records
    if (!Array.isArray(parsed)) return null
    return dedupePerformanceRecords(parsed).map(normalizePerformanceRecord)
  } catch {
    return null
  }
}

export function saveRecords(_records: InfluencerPerformanceInput[]): void {
  try {
    const bundle = readPerfBundle()
    const tombstones = bundle.tombstones && typeof bundle.tombstones === 'object' ? bundle.tombstones : {}
    // Performance records are canonical in influencer_performance_records. Keep old cached
    // records out of user_preferences so deletes cannot resurrect from stale preference blobs.
    const { records: _dropped, ...rest } = bundle
    requestUserPrefSave(PREF_INFLUENCER_PERF, { ...rest, tombstones })
  } catch {
    /* ignore */
  }
}

export function isSeededMockPerformanceRecord(record: InfluencerPerformanceInput = {}): boolean {
  return (
    /^perf-.+-[0-4]$/.test(String(record.id || '')) &&
    String(record.contractId || '').startsWith('contract-') &&
    String(record.postUrl || '').startsWith('https://example.com/') &&
    String(record.postUrl || '').includes('/weekly-video')
  )
}

export function makeRecordId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `perf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function compareValues(a: unknown, b: unknown, direction: 'asc' | 'desc'): number {
  if (typeof a === 'number' || typeof b === 'number') {
    return direction === 'asc' ? toNumber(a) - toNumber(b) : toNumber(b) - toNumber(a)
  }
  return direction === 'asc'
    ? String(a || '').localeCompare(String(b || ''))
    : String(b || '').localeCompare(String(a || ''))
}

export function mergePerformanceRecordIntoList(
  list: InfluencerPerformance[],
  record: InfluencerPerformanceInput,
): InfluencerPerformance[] {
  const normalized = normalizePerformanceRecord(record)
  const sameDayIndex = list.findIndex((item) => (
    item.id === normalized.id ||
    (
      item.contractId === normalized.contractId &&
      item.date === normalized.date
    )
  ))
  let next: InfluencerPerformance[]
  if (sameDayIndex >= 0) {
    next = list.map((item, index) => (
      index === sameDayIndex ? { ...normalized, id: item.id || normalized.id || makeRecordId() } : item
    ))
  } else if (normalized.id) {
    next = list.map((item) => (item.id === normalized.id ? normalized : item))
  } else {
    next = [{ ...normalized, id: makeRecordId() }, ...list]
  }
  if (!normalized.contractId) return next
  const contractFields = {
    contractStartDate: normalized.contractStartDate,
    contractEndDate: normalized.contractEndDate,
    monitoringDays: normalized.monitoringDays,
    platform: normalized.platform,
    postUrl: normalized.postUrl,
    campaignName: normalized.campaignName,
  }
  return next.map((item) => (
    item.contractId === normalized.contractId ? { ...item, ...contractFields } : item
  ))
}
