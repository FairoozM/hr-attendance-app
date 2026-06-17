import { useMemo } from 'react'
import { toNumber } from '../../utils/influencerPerformanceUtils'

export const EMPTY_RANK_MAP = new Map()

export function influencerInitials(name) {
  return String(name || 'IN')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'IN'
}

/** Best values among currently visible contract rows (ties all win). Max for metrics; min for cost. */
export function useMetricBests(records, includeNetProfit) {
  return useMemo(() => {
    if (!records.length) return null
    const views = records.map((r) => toNumber(r.views))
    const likes = records.map((r) => toNumber(r.likes))
    const comments = records.map((r) => toNumber(r.comments))
    const shares = records.map((r) => toNumber(r.shares))
    const salesAed = records.map((r) => toNumber(r.salesAed))
    const cost = records.map((r) => toNumber(r.cost))
    const base = {
      views: Math.max(...views),
      likes: Math.max(...likes),
      comments: Math.max(...comments),
      shares: Math.max(...shares),
      salesAed: Math.max(...salesAed),
      cost: Math.min(...cost),
    }
    if (includeNetProfit) {
      const netProfitAed = records.map((r) => toNumber(r.netProfitAed))
      base.netProfitAed = Math.max(...netProfitAed)
    }
    return base
  }, [records, includeNetProfit])
}

export const WINNER_TITLE = {
  views: 'Highest views in this table',
  likes: 'Most likes in this table',
  comments: 'Most comments in this table',
  shares: 'Most shares in this table',
  salesAed: 'Highest sales (AED) in this table',
  netProfitAed: 'Highest net profit (AED) in this table',
  cost: 'Lowest cost (AED) in this table',
}

/** Suffix for `.ip-table__winner-pill--{suffix}` or '' if not a winner in this column. */
export function winnerPillMod(field, record, bests) {
  if (!bests) return ''
  if (field === 'cost') {
    if (toNumber(record.cost) === bests.cost) return 'cost'
    return ''
  }
  if (field === 'netProfitAed') {
    const val = toNumber(record.netProfitAed)
    const best = bests.netProfitAed
    if (val !== best) return ''
    return 'sales'
  }
  const val = toNumber(record[field])
  const best = bests[field]
  if (best <= 0) return ''
  if (val !== best) return ''
  if (field === 'salesAed') return 'sales'
  return field
}
