/**
 * Influencer Analytics aggregation.
 *
 * FINANCIAL_SNAPSHOT_RULE (matches Dashboard / Performance / Payments):
 * - cost, salesAed, netProfitAed: latest check-in snapshot per contract (contract.totals)
 * - views, likes, comments, shares: summed across daily check-ins (contract.totals)
 * - Each contract is counted once in summary totals — never sum cumulative check-in financials
 *
 * TIME_SERIES_RULE:
 * - Each contract contributes one financial snapshot to the period of its latest check-in date
 * - Do NOT sum multiple check-ins' sales/cost into period buckets
 */
import type { Influencer } from '../../lib/influencers'
import type { InfluencerPerformanceInput } from '../../types/influencer'
import {
  buildInfluencerDashboardSnapshot,
  resolveDashboardDateRange,
  safeRatioPercent,
  type DashboardContractMetrics,
  type InfluencerDashboardDatePreset,
  type InfluencerDashboardDateRange,
  type InfluencerDashboardGroupMode,
} from './influencerDashboardUtils'
import { calculateEngagementRate, toNumber } from '../../utils/influencerPerformanceUtils'

export type InfluencerAnalyticsDatePreset = InfluencerDashboardDatePreset
export type InfluencerAnalyticsGroupMode = InfluencerDashboardGroupMode
export type InfluencerAnalyticsContractStatus = 'all' | 'active' | 'completed'
export type InfluencerAnalyticsGranularity = 'daily' | 'weekly' | 'monthly'

export interface InfluencerAnalyticsFilters {
  datePreset: InfluencerAnalyticsDatePreset
  customFrom: string
  customTo: string
  influencerId: string
  campaign: string
  platform: string
  contractStatus: InfluencerAnalyticsContractStatus
  groupMode: InfluencerAnalyticsGroupMode
}

export interface InfluencerAnalyticsSummary {
  totalCost: number
  totalSales: number
  totalNetProfit: number
  overallRoi: number
  profitMargin: number
  totalViews: number
  totalEngagement: number
  contractsAnalysed: number
}

export interface InfluencerAnalyticsTrendPoint {
  periodKey: string
  label: string
  cost: number
  salesAed: number
  netProfitAed: number
  roi: number
  views: number
  engagement: number
}

export interface InfluencerAnalyticsPoint {
  id: string
  label: string
  influencerId: string
  contractId: string | null
  cost: number
  salesAed: number
  netProfitAed: number
  roi: number
  views: number
  likes: number
  comments: number
  shares: number
  engagement: number
  engagementRate: number
}

export type InfluencerProfitabilityBucketKey =
  | 'strong_profit'
  | 'profit'
  | 'break_even'
  | 'loss'
  | 'heavy_loss'

export interface InfluencerProfitabilityBucket {
  key: InfluencerProfitabilityBucketKey
  label: string
  count: number
}

export interface InfluencerAnalyticsInsight {
  id: string
  text: string
}

export interface InfluencerAnalyticsSnapshot {
  summary: InfluencerAnalyticsSummary
  trends: InfluencerAnalyticsTrendPoint[]
  roiTrends: InfluencerAnalyticsTrendPoint[]
  topByNetProfit: InfluencerAnalyticsPoint[]
  topBySales: InfluencerAnalyticsPoint[]
  topByRoi: InfluencerAnalyticsPoint[]
  scatterCostProfit: InfluencerAnalyticsPoint[]
  scatterViewsSales: InfluencerAnalyticsPoint[]
  scatterEngagementSales: InfluencerAnalyticsPoint[]
  campaignProfitability: { profitable: number; breakEven: number; lossMaking: number }
  profitDistribution: InfluencerProfitabilityBucket[]
  needsAttention: InfluencerAnalyticsPoint[]
  insights: InfluencerAnalyticsInsight[]
  comparisonPool: InfluencerAnalyticsPoint[]
  granularity: InfluencerAnalyticsGranularity
  points: InfluencerAnalyticsPoint[]
}

function engagementFromContract(row: DashboardContractMetrics): number {
  const totals = row.contract.totals
  return toNumber(totals?.likes) + toNumber(totals?.comments) + toNumber(totals?.shares)
}

function contractToPoint(row: DashboardContractMetrics): InfluencerAnalyticsPoint {
  const totals = row.contract.totals
  const views = toNumber(totals?.views)
  const likes = toNumber(totals?.likes)
  const comments = toNumber(totals?.comments)
  const shares = toNumber(totals?.shares)
  const engagement = likes + comments + shares
  return {
    id: row.contractId,
    label: row.campaignName || row.videoTitle || 'Campaign',
    influencerId: String(row.influencerId),
    contractId: row.contractId,
    cost: row.cost,
    salesAed: row.salesAed,
    netProfitAed: row.netProfitAed,
    roi: row.roi,
    views,
    likes,
    comments,
    shares,
    engagement,
    engagementRate: calculateEngagementRate({ views, likes, comments, shares }),
  }
}

function aggregateInfluencerPoints(contracts: DashboardContractMetrics[]): InfluencerAnalyticsPoint[] {
  const map = new Map<string, InfluencerAnalyticsPoint>()
  contracts.forEach((row) => {
    const id = String(row.influencerId)
    const point = contractToPoint(row)
    const current = map.get(id) || {
      ...point,
      id,
      label: row.influencer?.name || 'Influencer',
      contractId: null,
      cost: 0,
      salesAed: 0,
      netProfitAed: 0,
      roi: 0,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      engagement: 0,
      engagementRate: 0,
    }
    current.cost += point.cost
    current.salesAed += point.salesAed
    current.netProfitAed += point.netProfitAed
    current.views += point.views
    current.likes += point.likes
    current.comments += point.comments
    current.shares += point.shares
    current.engagement += point.engagement
    map.set(id, current)
  })
  return Array.from(map.values()).map((row) => ({
    ...row,
    roi: safeRatioPercent(row.netProfitAed, row.cost),
    engagementRate: calculateEngagementRate({
      views: row.views,
      likes: row.likes,
      comments: row.comments,
      shares: row.shares,
    }),
  }))
}

export function filterAnalyticsContracts(
  contracts: DashboardContractMetrics[],
  filters: Pick<InfluencerAnalyticsFilters, 'influencerId' | 'campaign' | 'platform' | 'contractStatus'>,
): DashboardContractMetrics[] {
  return contracts.filter((row) => {
    if (filters.influencerId !== 'all' && String(row.influencerId) !== filters.influencerId) return false
    if (filters.campaign !== 'all' && row.campaignName !== filters.campaign) return false
    if (filters.platform !== 'all' && String(row.contract.platform || '') !== filters.platform) return false
    if (filters.contractStatus === 'active' && !row.isActive) return false
    if (filters.contractStatus === 'completed' && !row.isCompleted) return false
    return true
  })
}

export function summarizeAnalyticsContracts(contracts: DashboardContractMetrics[]): InfluencerAnalyticsSummary {
  const totalCost = contracts.reduce((sum, row) => sum + row.cost, 0)
  const totalSales = contracts.reduce((sum, row) => sum + row.salesAed, 0)
  const totalNetProfit = contracts.reduce((sum, row) => sum + row.netProfitAed, 0)
  const totalViews = contracts.reduce((sum, row) => sum + toNumber(row.contract.totals?.views), 0)
  const totalEngagement = contracts.reduce((sum, row) => sum + engagementFromContract(row), 0)
  return {
    totalCost,
    totalSales,
    totalNetProfit,
    overallRoi: safeRatioPercent(totalNetProfit, totalCost),
    profitMargin: safeRatioPercent(totalNetProfit, totalSales),
    totalViews,
    totalEngagement,
    contractsAnalysed: contracts.length,
  }
}

function parseIso(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return Number.isNaN(dt.getTime()) ? null : dt
}

function isoWeekKey(date: string): string {
  const dt = parseIso(date)
  if (!dt) return date
  const day = dt.getUTCDay() || 7
  dt.setUTCDate(dt.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function resolveTrendGranularity(range: InfluencerDashboardDateRange): InfluencerAnalyticsGranularity {
  if (!range) return 'monthly'
  const from = parseIso(range.from)
  const to = parseIso(range.to)
  if (!from || !to) return 'monthly'
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1
  if (days <= 45) return 'daily'
  if (days <= 120) return 'weekly'
  return 'monthly'
}

function periodKeyForDate(date: string, granularity: InfluencerAnalyticsGranularity): string {
  if (granularity === 'daily') return date
  if (granularity === 'weekly') return isoWeekKey(date)
  return date.slice(0, 7)
}

function periodLabel(key: string, granularity: InfluencerAnalyticsGranularity): string {
  if (granularity === 'daily') return key
  if (granularity === 'weekly') return key.replace('-W', ' W')
  const [year, month] = key.split('-')
  const dt = new Date(Date.UTC(Number(year), Number(month) - 1, 1))
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(dt)
}

export function buildAnalyticsTrends(
  contracts: DashboardContractMetrics[],
  granularity: InfluencerAnalyticsGranularity,
): InfluencerAnalyticsTrendPoint[] {
  const buckets = new Map<string, InfluencerAnalyticsTrendPoint>()
  contracts.forEach((row) => {
    const anchorDate = row.latestDate || row.contractStartDate
    if (!anchorDate) return
    const key = periodKeyForDate(anchorDate, granularity)
    const bucket = buckets.get(key) || {
      periodKey: key,
      label: periodLabel(key, granularity),
      cost: 0,
      salesAed: 0,
      netProfitAed: 0,
      roi: 0,
      views: 0,
      engagement: 0,
    }
    bucket.cost += row.cost
    bucket.salesAed += row.salesAed
    bucket.netProfitAed += row.netProfitAed
    bucket.views += toNumber(row.contract.totals?.views)
    bucket.engagement += engagementFromContract(row)
    buckets.set(key, bucket)
  })
  return Array.from(buckets.values())
    .map((row) => ({ ...row, roi: safeRatioPercent(row.netProfitAed, row.cost) }))
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
}

function topPoints(points: InfluencerAnalyticsPoint[], pick: (p: InfluencerAnalyticsPoint) => number, limit = 5) {
  return [...points].sort((a, b) => pick(b) - pick(a)).slice(0, limit)
}

function profitBucket(netProfit: number, cost: number): InfluencerProfitabilityBucketKey {
  const ratio = cost > 0 ? netProfit / cost : netProfit
  if (netProfit >= cost * 0.5 && netProfit > 0) return 'strong_profit'
  if (netProfit > 0) return 'profit'
  if (Math.abs(netProfit) <= Math.max(50, cost * 0.02)) return 'break_even'
  if (ratio <= -0.5) return 'heavy_loss'
  return 'loss'
}

const PROFIT_BUCKET_LABELS: Record<InfluencerProfitabilityBucketKey, string> = {
  strong_profit: 'Strong Profit',
  profit: 'Profit',
  break_even: 'Break-even',
  loss: 'Loss',
  heavy_loss: 'Heavy Loss',
}

export function buildProfitDistribution(points: InfluencerAnalyticsPoint[]): InfluencerProfitabilityBucket[] {
  const counts: Record<InfluencerProfitabilityBucketKey, number> = {
    strong_profit: 0,
    profit: 0,
    break_even: 0,
    loss: 0,
    heavy_loss: 0,
  }
  points.forEach((point) => {
    counts[profitBucket(point.netProfitAed, point.cost)] += 1
  })
  return (Object.keys(counts) as InfluencerProfitabilityBucketKey[]).map((key) => ({
    key,
    label: PROFIT_BUCKET_LABELS[key],
    count: counts[key],
  }))
}

export function buildCampaignProfitability(points: InfluencerAnalyticsPoint[]) {
  let profitable = 0
  let breakEven = 0
  let lossMaking = 0
  points.forEach((point) => {
    const bucket = profitBucket(point.netProfitAed, point.cost)
    if (bucket === 'break_even') breakEven += 1
    else if (bucket === 'loss' || bucket === 'heavy_loss') lossMaking += 1
    else profitable += 1
  })
  return { profitable, breakEven, lossMaking }
}

function average(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function buildNeedsAttention(points: InfluencerAnalyticsPoint[]): InfluencerAnalyticsPoint[] {
  if (!points.length) return []
  const avgRoi = average(points.map((p) => p.roi))
  const avgSales = average(points.map((p) => p.salesAed))
  const avgViews = average(points.filter((p) => p.views > 0).map((p) => p.views)) || 0
  const flagged = new Map<string, InfluencerAnalyticsPoint>()
  points.forEach((point) => {
    const reasons: string[] = []
    if (point.netProfitAed < 0) reasons.push('loss')
    if (point.cost > 0 && point.salesAed < avgSales * 0.35 && point.cost >= avgSales * 0.25) reasons.push('high_cost_weak_sales')
    if (point.views >= avgViews * 1.2 && point.salesAed < avgSales * 0.6 && avgViews > 0) reasons.push('high_reach_weak_sales')
    if (point.roi < avgRoi * 0.5 && point.cost > 0 && avgRoi > 0) reasons.push('below_benchmark_roi')
    if (reasons.length) flagged.set(point.id, point)
  })
  return Array.from(flagged.values())
    .sort((a, b) => a.netProfitAed - b.netProfitAed)
    .slice(0, 8)
}

export function buildAnalyticsInsights(
  points: InfluencerAnalyticsPoint[],
  summary: InfluencerAnalyticsSummary,
  previousSummary: InfluencerAnalyticsSummary | null,
  lossMakingCount: number,
): InfluencerAnalyticsInsight[] {
  const insights: InfluencerAnalyticsInsight[] = []
  if (!points.length) return insights

  const topProfit = topPoints(points, (p) => p.netProfitAed, 1)[0]
  if (topProfit && topProfit.netProfitAed > 0) {
    insights.push({
      id: 'top-profit',
      text: `${topProfit.label} generated the highest net profit in the selected period.`,
    })
  }

  const completed = points.filter((p) => p.cost > 0)
  const topRoi = topPoints(completed, (p) => p.roi, 1)[0]
  if (topRoi && topRoi.roi > 0) {
    insights.push({
      id: 'top-roi',
      text: `${topRoi.label} produced the highest ROI among analysed ${topRoi.contractId ? 'contracts' : 'influencers'}.`,
    })
  }

  if (lossMakingCount > 0) {
    insights.push({
      id: 'loss-count',
      text: `${lossMakingCount} ${lossMakingCount === 1 ? 'contract was' : 'contracts were'} loss-making during the selected period.`,
    })
  }

  const avgViews = average(points.filter((p) => p.views > 0).map((p) => p.views))
  const avgSales = average(points.map((p) => p.salesAed))
  const highSalesLowReach = points.find((p) => p.salesAed >= avgSales * 1.25 && p.views > 0 && p.views <= avgViews * 0.75 && avgViews > 0)
  if (highSalesLowReach) {
    insights.push({
      id: 'sales-low-reach',
      text: `${highSalesLowReach.label} generated above-average sales despite below-average reach.`,
    })
  }

  const highReachLowSales = points.find((p) => p.views >= avgViews * 1.25 && p.salesAed < avgSales * 0.75 && avgViews > 0)
  if (highReachLowSales) {
    insights.push({
      id: 'reach-low-sales',
      text: `${highReachLowSales.label} generated high reach but below-average sales.`,
    })
  }

  if (previousSummary && previousSummary.totalNetProfit !== 0) {
    const delta = ((summary.totalNetProfit - previousSummary.totalNetProfit) / Math.abs(previousSummary.totalNetProfit)) * 100
    if (Number.isFinite(delta) && Math.abs(delta) >= 5) {
      insights.push({
        id: 'profit-trend',
        text: `Net profit ${delta >= 0 ? 'increased' : 'decreased'} ${Math.abs(delta).toFixed(0)}% compared with the previous comparable period.`,
      })
    }
  }

  return insights
}

function shiftRangeBack(range: InfluencerDashboardDateRange): InfluencerDashboardDateRange {
  if (!range) return null
  const from = parseIso(range.from)
  const to = parseIso(range.to)
  if (!from || !to) return null
  const spanDays = Math.round((to.getTime() - from.getTime()) / 86400000) + 1
  const prevTo = new Date(from.getTime() - 86400000)
  const prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * 86400000)
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) }
}

export function buildInfluencerAnalyticsSnapshot({
  records,
  roster,
  filters,
  today = new Date().toISOString().slice(0, 10),
}: {
  records: InfluencerPerformanceInput[]
  roster: Influencer[]
  filters: InfluencerAnalyticsFilters
  today?: string
}): InfluencerAnalyticsSnapshot {
  const range = resolveDashboardDateRange(filters.datePreset, filters.customFrom, filters.customTo)
  const dashboard = buildInfluencerDashboardSnapshot({
    records,
    roster,
    range,
    groupMode: filters.groupMode,
    today,
  })
  const contracts = filterAnalyticsContracts(dashboard.contracts, filters)
  const summary = summarizeAnalyticsContracts(contracts)
  const granularity = resolveTrendGranularity(range)
  const trends = buildAnalyticsTrends(contracts, granularity)
  const points = filters.groupMode === 'influencer'
    ? aggregateInfluencerPoints(contracts)
    : contracts.map(contractToPoint)
  const campaignProfitability = buildCampaignProfitability(points)
  const lossMakingCount = campaignProfitability.lossMaking

  const previousRange = shiftRangeBack(range)
  const previousDashboard = previousRange
    ? buildInfluencerDashboardSnapshot({ records, roster, range: previousRange, groupMode: filters.groupMode, today })
    : null
  const previousContracts = previousDashboard
    ? filterAnalyticsContracts(previousDashboard.contracts, filters)
    : []
  const previousSummary = previousContracts.length ? summarizeAnalyticsContracts(previousContracts) : null

  return {
    summary,
    trends,
    roiTrends: trends,
    topByNetProfit: topPoints(points, (p) => p.netProfitAed),
    topBySales: topPoints(points, (p) => p.salesAed),
    topByRoi: topPoints(points.filter((p) => p.cost > 0), (p) => p.roi),
    scatterCostProfit: points,
    scatterViewsSales: points.filter((p) => p.views > 0 || p.salesAed > 0),
    scatterEngagementSales: points.filter((p) => p.engagement > 0 || p.salesAed > 0),
    campaignProfitability,
    profitDistribution: buildProfitDistribution(points),
    needsAttention: buildNeedsAttention(points),
    insights: buildAnalyticsInsights(points, summary, previousSummary, lossMakingCount),
    comparisonPool: points,
    granularity,
    points,
  }
}

export function reconcileWithDashboard(
  analyticsSummary: InfluencerAnalyticsSummary,
  dashboardSnapshot: ReturnType<typeof buildInfluencerDashboardSnapshot>,
  filters: Pick<InfluencerAnalyticsFilters, 'influencerId' | 'campaign' | 'platform' | 'contractStatus'>,
): boolean {
  const contracts = filterAnalyticsContracts(dashboardSnapshot.contracts, filters)
  const expected = summarizeAnalyticsContracts(contracts)
  return (
    expected.totalCost === analyticsSummary.totalCost
    && expected.totalSales === analyticsSummary.totalSales
    && expected.totalNetProfit === analyticsSummary.totalNetProfit
    && expected.overallRoi === analyticsSummary.overallRoi
  )
}

export function defaultAnalyticsFilters(): InfluencerAnalyticsFilters {
  return {
    datePreset: 'all_time',
    customFrom: '',
    customTo: '',
    influencerId: 'all',
    campaign: 'all',
    platform: 'all',
    contractStatus: 'all',
    groupMode: 'influencer',
  }
}

export function readAnalyticsFiltersFromSearchParams(params: URLSearchParams): InfluencerAnalyticsFilters {
  const defaults = defaultAnalyticsFilters()
  const group = params.get('group')
  const status = params.get('status')
  return {
    datePreset: (params.get('period') as InfluencerAnalyticsFilters['datePreset']) || defaults.datePreset,
    customFrom: params.get('from') || '',
    customTo: params.get('to') || '',
    influencerId: params.get('influencer') || 'all',
    campaign: params.get('campaign') || 'all',
    platform: params.get('platform') || 'all',
    contractStatus: (status as InfluencerAnalyticsContractStatus) || 'all',
    groupMode: group === 'contract' ? 'contract' : 'influencer',
  }
}

export function analyticsFiltersToSearchParams(filters: InfluencerAnalyticsFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.datePreset !== 'all_time') params.set('period', filters.datePreset)
  if (filters.customFrom) params.set('from', filters.customFrom)
  if (filters.customTo) params.set('to', filters.customTo)
  if (filters.influencerId !== 'all') params.set('influencer', filters.influencerId)
  if (filters.campaign !== 'all') params.set('campaign', filters.campaign)
  if (filters.platform !== 'all') params.set('platform', filters.platform)
  if (filters.contractStatus !== 'all') params.set('status', filters.contractStatus)
  if (filters.groupMode !== 'influencer') params.set('group', filters.groupMode)
  return params
}

export function analyticsInfluencerFilterActive(filters: InfluencerAnalyticsFilters): boolean {
  return filters.influencerId !== 'all'
}

export function campaignOptionsFromContracts(contracts: DashboardContractMetrics[]): string[] {
  const set = new Set<string>()
  contracts.forEach((row) => { if (row.campaignName) set.add(row.campaignName) })
  return Array.from(set).sort()
}

export function platformOptionsFromContracts(contracts: DashboardContractMetrics[]): string[] {
  const set = new Set<string>()
  contracts.forEach((row) => { if (row.contract.platform) set.add(String(row.contract.platform)) })
  return Array.from(set).sort()
}

export function influencerProfileUrl(influencerId: string): string {
  return `/influencers/${encodeURIComponent(influencerId)}`
}

export function performanceContractUrl(contractId: string): string {
  return `/influencers/performance?contract=${encodeURIComponent(contractId)}`
}

export function resolveAnalyticsDateRange(
  preset: InfluencerAnalyticsDatePreset,
  customFrom = '',
  customTo = '',
): InfluencerDashboardDateRange {
  return resolveDashboardDateRange(preset, customFrom, customTo)
}

export function formatAnalyticsAxisValue(value: number): string {
  const n = toNumber(value)
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export function formatAnalyticsTooltipAed(value: number): string {
  return `AED ${toNumber(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}
