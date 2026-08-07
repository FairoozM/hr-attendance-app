import { describe, expect, it } from 'vitest'
import { normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'
import {
  analyticsFiltersToSearchParams,
  analyticsInfluencerFilterActive,
  buildInfluencerAnalyticsSnapshot,
  buildAnalyticsTrends,
  buildNeedsAttention,
  buildProfitDistribution,
  defaultAnalyticsFilters,
  readAnalyticsFiltersFromSearchParams,
  reconcileWithDashboard,
  resolveTrendGranularity,
  summarizeAnalyticsContracts,
} from './influencerAnalyticsUtils'
import { buildInfluencerDashboardSnapshot } from './influencerDashboardUtils'

describe('influencerAnalyticsUtils', () => {
  const roster = [{
    id: 'inf-1',
    name: 'Arjun Ganesh',
    workflowStatus: 'Approved',
    approvalStatus: 'Approved',
    paymentStatus: 'Not Requested',
  }]

  const records = [
    normalizePerformanceRecord({
      id: 'd1',
      contractId: 'ip-contract::c1::2026-05-01',
      influencerId: 'inf-1',
      date: '2026-05-01',
      contractStartDate: '2026-05-01',
      monitoringDays: 3,
      cost: 100,
      salesAed: 5000,
      netProfitAed: 4900,
      views: 1000,
      likes: 100,
    }),
    normalizePerformanceRecord({
      id: 'd2',
      contractId: 'ip-contract::c1::2026-05-01',
      influencerId: 'inf-1',
      date: '2026-05-02',
      contractStartDate: '2026-05-01',
      monitoringDays: 3,
      cost: 100,
      salesAed: 10000,
      netProfitAed: 9900,
      views: 2000,
      likes: 150,
    }),
    normalizePerformanceRecord({
      id: 'd3',
      contractId: 'ip-contract::c1::2026-05-01',
      influencerId: 'inf-1',
      date: '2026-05-03',
      contractStartDate: '2026-05-01',
      monitoringDays: 3,
      cost: 100,
      salesAed: 18000,
      netProfitAed: 17900,
      views: 3000,
      likes: 200,
    }),
  ]

  it('uses latest check-in snapshot — not sum of cumulative check-ins', () => {
    const dashboard = buildInfluencerDashboardSnapshot({
      records,
      roster,
      range: null,
      groupMode: 'contract',
    })
    expect(dashboard.totalCost).toBe(100)
    expect(dashboard.totalSales).toBe(18000)
    expect(dashboard.totalNetProfit).toBe(17900)
  })

  it('reconciles analytics totals with dashboard under same filters', () => {
    const filters = defaultAnalyticsFilters()
    const dashboard = buildInfluencerDashboardSnapshot({
      records,
      roster,
      range: null,
      groupMode: filters.groupMode,
    })
    const analytics = buildInfluencerAnalyticsSnapshot({ records, roster, filters })
    expect(reconcileWithDashboard(analytics.summary, dashboard, filters)).toBe(true)
    expect(analytics.summary.totalCost).toBe(dashboard.totalCost)
    expect(analytics.summary.totalSales).toBe(dashboard.totalSales)
    expect(analytics.summary.totalNetProfit).toBe(dashboard.totalNetProfit)
    expect(analytics.summary.overallRoi).toBe(dashboard.overallRoi)
  })

  it('calculates overall ROI from totals not average of ROI percentages', () => {
    const filters = { ...defaultAnalyticsFilters(), groupMode: 'contract' as const }
    const analytics = buildInfluencerAnalyticsSnapshot({ records, roster, filters })
    expect(analytics.summary.overallRoi).toBeCloseTo(17900 / 100 * 100, 1)
  })

  it('handles zero cost and zero sales safely', () => {
    const empty = summarizeAnalyticsContracts([])
    expect(empty.overallRoi).toBe(0)
    expect(empty.profitMargin).toBe(0)
    expect(empty.totalCost).toBe(0)
  })

  it('groups by influencer without duplicating contracts', () => {
    const byContract = buildInfluencerAnalyticsSnapshot({
      records,
      roster,
      filters: { ...defaultAnalyticsFilters(), groupMode: 'contract' },
    })
    const byInfluencer = buildInfluencerAnalyticsSnapshot({
      records,
      roster,
      filters: { ...defaultAnalyticsFilters(), groupMode: 'influencer' },
    })
    expect(byContract.points).toHaveLength(1)
    expect(byInfluencer.points).toHaveLength(1)
    expect(byInfluencer.summary.totalSales).toBe(byContract.summary.totalSales)
  })

  it('builds monthly trends without summing cumulative check-in financials', () => {
    const dashboard = buildInfluencerDashboardSnapshot({
      records,
      roster,
      range: null,
      groupMode: 'contract',
    })
    const trends = buildAnalyticsTrends(dashboard.contracts, 'monthly')
    expect(trends).toHaveLength(1)
    expect(trends[0].salesAed).toBe(18000)
    expect(trends[0].cost).toBe(100)
  })

  it('selects trend granularity from date range length', () => {
    expect(resolveTrendGranularity({ from: '2026-05-01', to: '2026-05-20' })).toBe('daily')
    expect(resolveTrendGranularity({ from: '2026-01-01', to: '2026-03-31' })).toBe('weekly')
    expect(resolveTrendGranularity(null)).toBe('monthly')
  })

  it('builds profit distribution buckets', () => {
    const analytics = buildInfluencerAnalyticsSnapshot({
      records,
      roster,
      filters: defaultAnalyticsFilters(),
    })
    const total = analytics.profitDistribution.reduce((sum, row) => sum + row.count, 0)
    expect(total).toBe(analytics.points.length)
  })

  it('flags needs attention for loss-making points', () => {
    const lossRecords = [
      normalizePerformanceRecord({
        id: 'l1',
        contractId: 'ip-contract::loss::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        cost: 5000,
        salesAed: 1000,
        netProfitAed: -4000,
        views: 50000,
      }),
    ]
    const analytics = buildInfluencerAnalyticsSnapshot({
      records: lossRecords,
      roster,
      filters: defaultAnalyticsFilters(),
    })
    expect(analytics.needsAttention.length).toBeGreaterThan(0)
    expect(buildNeedsAttention(analytics.points).length).toBeGreaterThan(0)
  })

  it('generates insights when data supports them', () => {
    const analytics = buildInfluencerAnalyticsSnapshot({
      records,
      roster,
      filters: defaultAnalyticsFilters(),
    })
    expect(analytics.insights.length).toBeGreaterThan(0)
  })

  it('returns empty insights for empty dataset', () => {
    const analytics = buildInfluencerAnalyticsSnapshot({
      records: [],
      roster: [],
      filters: defaultAnalyticsFilters(),
    })
    expect(analytics.insights).toHaveLength(0)
    expect(analytics.points).toHaveLength(0)
  })

  it('builds scatter datasets from points', () => {
    const analytics = buildInfluencerAnalyticsSnapshot({
      records,
      roster,
      filters: defaultAnalyticsFilters(),
    })
    expect(analytics.scatterCostProfit.length).toBeGreaterThan(0)
    expect(analytics.scatterViewsSales[0].views).toBeGreaterThan(0)
  })

  it('derives profit distribution with negative profit bucket', () => {
    const points = [{
      id: 'x',
      label: 'Loss',
      influencerId: 'inf-1',
      contractId: 'c',
      cost: 1000,
      salesAed: 200,
      netProfitAed: -800,
      roi: -80,
      views: 100,
      likes: 0,
      comments: 0,
      shares: 0,
      engagement: 0,
      engagementRate: 0,
    }]
    const buckets = buildProfitDistribution(points)
    expect(buckets.some((b) => b.key === 'loss' || b.key === 'heavy_loss')).toBe(true)
  })

  it('reads and writes Analytics influencer filter in URL params', () => {
    const params = new URLSearchParams('period=this_month&influencer=inf-42&campaign=Summer')
    const filters = readAnalyticsFiltersFromSearchParams(params)
    expect(filters.influencerId).toBe('inf-42')
    expect(filters.datePreset).toBe('this_month')
    expect(filters.campaign).toBe('Summer')
    expect(analyticsInfluencerFilterActive(filters)).toBe(true)

    const cleared = analyticsFiltersToSearchParams({ ...filters, influencerId: 'all' })
    expect(cleared.get('influencer')).toBeNull()
    expect(cleared.get('period')).toBe('this_month')
    expect(cleared.get('campaign')).toBe('Summer')
    expect(analyticsInfluencerFilterActive(readAnalyticsFiltersFromSearchParams(cleared))).toBe(false)
  })
})
