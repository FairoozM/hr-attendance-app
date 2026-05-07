import {
  dedupePerformanceRecords,
  normalizePerformanceRecord,
  toNumber,
} from '../../utils/influencerPerformanceUtils'

export const STORAGE_KEY = 'hr-influencer-performance-v1'

export const PERFORMANCE_SORT_OPTIONS = [
  { value: 'rank:asc', label: 'Best overall (90% profit · 10% rest)' },
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

export function loadStoredRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return dedupePerformanceRecords(parsed.map(normalizePerformanceRecord))
  } catch {
    return null
  }
}

export function saveRecords(records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // Local mock storage is best effort; backend integration can replace this.
  }
}

export function isSeededMockPerformanceRecord(record = {}) {
  return (
    /^perf-.+-[0-4]$/.test(String(record.id || '')) &&
    String(record.contractId || '').startsWith('contract-') &&
    String(record.postUrl || '').startsWith('https://example.com/') &&
    String(record.postUrl || '').includes('/weekly-video')
  )
}

export function makeRecordId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `perf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function compareValues(a, b, direction) {
  if (typeof a === 'number' || typeof b === 'number') {
    return direction === 'asc' ? toNumber(a) - toNumber(b) : toNumber(b) - toNumber(a)
  }
  return direction === 'asc'
    ? String(a || '').localeCompare(String(b || ''))
    : String(b || '').localeCompare(String(a || ''))
}

export function mergePerformanceRecordIntoList(list, record) {
  const normalized = normalizePerformanceRecord(record)
  const sameDayIndex = list.findIndex((item) => (
    item.id === normalized.id ||
    (
      item.contractId === normalized.contractId &&
      item.date === normalized.date
    )
  ))
  if (sameDayIndex >= 0) {
    return list.map((item, index) => (
      index === sameDayIndex ? { ...normalized, id: item.id || normalized.id || makeRecordId() } : item
    ))
  }
  if (normalized.id) {
    return list.map((item) => (item.id === normalized.id ? normalized : item))
  }
  return [{ ...normalized, id: makeRecordId() }, ...list]
}
