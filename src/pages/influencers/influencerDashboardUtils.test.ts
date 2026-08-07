import { describe, expect, it } from 'vitest'
import {
  buildInfluencerDashboardSnapshot,
  contractEngagementFromMetrics,
  contractViewsFromMetrics,
  resolveDashboardDateRange,
  safeRatioPercent,
} from './influencerDashboardUtils'
import { normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'
import {
  buildInfluencerAnalyticsSnapshot,
  defaultAnalyticsFilters,
  reconcileWithDashboard,
} from './influencerAnalyticsUtils'

const roster = [{ id: 'inf-1', name: 'Creator One', workflowStatus: 'Approved', approvalStatus: 'Approved', paymentStatus: 'Not Requested' }]

const sampleRecords = [
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
    likes: 40,
    comments: 10,
    shares: 5,
  }),
  normalizePerformanceRecord({
    id: 'd2',
    contractId: 'ip-contract::c1::2026-05-01',
    influencerId: 'inf-1',
    date: '2026-05-02',
    contractStartDate: '2026-05-01',
    monitoringDays: 3,
    cost: 50,
    salesAed: 9000,
    netProfitAed: 8950,
    views: 2000,
    likes: 80,
    comments: 20,
    shares: 10,
  }),
  normalizePerformanceRecord({
    id: 'b1',
    contractId: 'ip-contract::c2::2026-05-01',
    influencerId: 'inf-2',
    date: '2026-05-01',
    contractStartDate: '2026-05-01',
    monitoringDays: 3,
    postUrl: 'https://instagram.com/reel/b/',
    cost: 200,
    salesAed: 1000,
    netProfitAed: 800,
    views: 500,
    likes: 20,
    comments: 5,
    shares: 2,
  }),
]

describe('influencerDashboardUtils', () => {
  it('safeRatioPercent never returns NaN or Infinity', () => {
    expect(safeRatioPercent(100, 0)).toBe(0)
    expect(safeRatioPercent(0, 0)).toBe(0)
    expect(safeRatioPercent(50, 200)).toBe(25)
  })

  it('aggregates contract financials once per contract', () => {
    const snapshot = buildInfluencerDashboardSnapshot({
      records: sampleRecords.slice(0, 2),
      roster,
      range: { from: '2026-05-01', to: '2026-05-31' },
      groupMode: 'contract',
      today: '2026-05-02',
    })

    expect(snapshot.contracts).toHaveLength(1)
    expect(snapshot.totalContracts).toBe(1)
    expect(snapshot.totalCost).toBe(50)
    expect(snapshot.totalSales).toBe(9000)
    expect(snapshot.totalNetProfit).toBe(8950)
    expect(snapshot.overallRoi).toBe(17900)
    expect(snapshot.totalViews).toBe(3000)
    expect(snapshot.totalEngagement).toBe(165)
  })

  it('exposes executive influencer rankings independent of group mode', () => {
    const snapshot = buildInfluencerDashboardSnapshot({
      records: sampleRecords,
      roster: [
        ...roster,
        { id: 'inf-2', name: 'Creator Two', workflowStatus: 'Approved', approvalStatus: 'Approved', paymentStatus: 'Not Requested' },
      ],
      range: null,
      groupMode: 'contract',
      today: '2026-05-02',
    })

    expect(snapshot.topInfluencersBySales[0]?.influencerId).toBe('inf-1')
    expect(snapshot.topInfluencersByNetProfit[0]?.influencerId).toBe('inf-1')
    expect(snapshot.topInfluencersBySales).toHaveLength(2)
  })

  it('resolveDashboardDateRange supports last 30 and 90 day presets', () => {
    const last30 = resolveDashboardDateRange('last_30_days')
    const last90 = resolveDashboardDateRange('last_90_days')
    expect(last30?.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(last30?.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(last90?.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    if (last30 && last90) {
      expect(last30.from <= last30.to).toBe(true)
      expect(last90.from <= last30.from).toBe(true)
    }
  })

  it('reconciles dashboard executive totals with analytics under matching filters', () => {
    const dashboard = buildInfluencerDashboardSnapshot({
      records: sampleRecords,
      roster: [
        ...roster,
        { id: 'inf-2', name: 'Creator Two', workflowStatus: 'Approved', approvalStatus: 'Approved', paymentStatus: 'Not Requested' },
      ],
      range: null,
      groupMode: 'influencer',
      today: '2026-05-02',
    })
    const analytics = buildInfluencerAnalyticsSnapshot({
      records: sampleRecords,
      roster: [
        ...roster,
        { id: 'inf-2', name: 'Creator Two', workflowStatus: 'Approved', approvalStatus: 'Approved', paymentStatus: 'Not Requested' },
      ],
      filters: { ...defaultAnalyticsFilters(), datePreset: 'all_time' },
      today: '2026-05-02',
    })

    expect(dashboard.totalContracts).toBe(analytics.summary.contractsAnalysed)
    expect(dashboard.totalCost).toBe(analytics.summary.totalCost)
    expect(dashboard.totalSales).toBe(analytics.summary.totalSales)
    expect(dashboard.totalNetProfit).toBe(analytics.summary.totalNetProfit)
    expect(dashboard.overallRoi).toBe(analytics.summary.overallRoi)
    expect(dashboard.totalViews).toBe(analytics.summary.totalViews)
    expect(dashboard.totalEngagement).toBe(analytics.summary.totalEngagement)
    expect(reconcileWithDashboard(analytics.summary, dashboard, defaultAnalyticsFilters())).toBe(true)
  })

  it('sums views and engagement from contract totals helpers', () => {
    const snapshot = buildInfluencerDashboardSnapshot({
      records: sampleRecords.slice(0, 2),
      roster,
      range: null,
      groupMode: 'contract',
      today: '2026-05-02',
    })
    const row = snapshot.contracts[0]
    expect(contractViewsFromMetrics(row)).toBe(3000)
    expect(contractEngagementFromMetrics(row)).toBe(165)
  })
})
