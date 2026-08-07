import { fmtISO } from '../../utils/dateFormat'
import { toNumber } from '../../utils/influencerPerformanceUtils'
import type { InfluencerContractRow } from '../../types/influencer'
import {
  resolveDashboardDateRange,
  type InfluencerDashboardDatePreset,
} from './influencerDashboardUtils'

export type InfluencerPerformanceRankingDatePreset = Exclude<
  InfluencerDashboardDatePreset,
  'this_quarter'
>

export const PERFORMANCE_RANKING_DATE_PRESETS: Array<{
  id: InfluencerPerformanceRankingDatePreset
  label: string
}> = [
  { id: 'all_time', label: 'All Time' },
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'last_30_days', label: 'Last 30 Days' },
  { id: 'last_90_days', label: 'Last 90 Days' },
  { id: 'this_year', label: 'This Year' },
  { id: 'custom', label: 'Custom Range' },
]

export type PerformanceRankingTotals = {
  cost: number
  views: number
  likes: number
  comments: number
  shares: number
  salesAed: number
  netProfitAed: number
}

function getContractIsoSpan(contract: Partial<InfluencerContractRow> | null | undefined) {
  const start = fmtISO(contract?.contractStartDate || contract?.startDate || '')
  const end = fmtISO(contract?.latest?.date || contract?.latestDate || contract?.contractStartDate || '')
  const s = start || end
  const e = end || start
  if (!s && !e) return null
  return s <= e ? { start: s, end: e } : { start: e, end: s }
}

/** Inclusive overlap: contract window vs optional filter from/to (YYYY-MM-DD). */
export function contractMatchesDateFilter(
  contract: InfluencerContractRow,
  filterFrom: string,
  filterTo: string,
): boolean {
  const hasFilter = Boolean(filterFrom || filterTo)
  const span = getContractIsoSpan(contract)
  if (!span) return !hasFilter
  if (!hasFilter) return true
  if (filterFrom && !filterTo) return span.end >= filterFrom
  if (!filterFrom && filterTo) return span.start <= filterTo
  let lo = filterFrom
  let hi = filterTo
  if (lo && hi && lo > hi) {
    const t = lo
    lo = hi
    hi = t
  }
  return span.start <= hi && span.end >= lo
}

export function resolveRankingDateFilter(
  preset: InfluencerPerformanceRankingDatePreset,
  customFrom = '',
  customTo = '',
): { from: string; to: string } | null {
  return resolveDashboardDateRange(preset, customFrom, customTo)
}

export function filterRankingRowsByDatePreset(
  rows: InfluencerContractRow[],
  preset: InfluencerPerformanceRankingDatePreset,
  customFrom = '',
  customTo = '',
): InfluencerContractRow[] {
  const range = resolveRankingDateFilter(preset, customFrom, customTo)
  if (!range) return rows
  return rows.filter((row) => contractMatchesDateFilter(row, range.from, range.to))
}

export function sumPerformanceRankingTotals(rows: InfluencerContractRow[]): PerformanceRankingTotals {
  return rows.reduce<PerformanceRankingTotals>((acc, row) => ({
    cost: acc.cost + toNumber(row.cost),
    views: acc.views + toNumber(row.views),
    likes: acc.likes + toNumber(row.likes),
    comments: acc.comments + toNumber(row.comments),
    shares: acc.shares + toNumber(row.shares),
    salesAed: acc.salesAed + toNumber(row.salesAed),
    netProfitAed: acc.netProfitAed + toNumber(row.netProfitAed),
  }), {
    cost: 0,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    salesAed: 0,
    netProfitAed: 0,
  })
}
