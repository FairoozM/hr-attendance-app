import { describe, expect, it } from 'vitest'
import {
  buildInfluencerDashboardSnapshot,
  resolveDashboardDateRange,
  safeRatioPercent,
} from './influencerDashboardUtils'
import { normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'

describe('influencerDashboardUtils', () => {
  it('safeRatioPercent never returns NaN or Infinity', () => {
    expect(safeRatioPercent(100, 0)).toBe(0)
    expect(safeRatioPercent(0, 0)).toBe(0)
    expect(safeRatioPercent(50, 200)).toBe(25)
  })

  it('aggregates contract financials once per contract', () => {
    const records = [
      normalizePerformanceRecord({
        id: 'd1',
        contractId: 'ip-contract::c1::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        monitoringDays: 3,
        cost: 100,
        salesAed: 500,
        netProfitAed: 400,
        views: 1000,
      }),
      normalizePerformanceRecord({
        id: 'd2',
        contractId: 'ip-contract::c1::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-02',
        contractStartDate: '2026-05-01',
        monitoringDays: 3,
        cost: 50,
        salesAed: 900,
        netProfitAed: 850,
        views: 2000,
      }),
    ]

    const snapshot = buildInfluencerDashboardSnapshot({
      records,
      roster: [{ id: 'inf-1', name: 'Creator One', workflowStatus: 'Approved', approvalStatus: 'Approved', paymentStatus: 'Not Requested' }],
      range: { from: '2026-05-01', to: '2026-05-31' },
      groupMode: 'contract',
      today: '2026-05-02',
    })

    expect(snapshot.contracts).toHaveLength(1)
    expect(snapshot.totalCost).toBe(50)
    expect(snapshot.totalSales).toBe(900)
    expect(snapshot.totalNetProfit).toBe(850)
    expect(snapshot.overallRoi).toBe(1700)
    expect(snapshot.profitMargin).toBeCloseTo(94.4, 1)
  })

  it('groups rankings by influencer', () => {
    const records = [
      normalizePerformanceRecord({
        id: 'a1',
        contractId: 'ip-contract::a::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        postUrl: 'https://instagram.com/reel/a/',
        cost: 100,
        salesAed: 200,
        netProfitAed: 100,
      }),
      normalizePerformanceRecord({
        id: 'b1',
        contractId: 'ip-contract::b::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        postUrl: 'https://instagram.com/reel/b/',
        cost: 100,
        salesAed: 300,
        netProfitAed: 200,
      }),
    ]

    const snapshot = buildInfluencerDashboardSnapshot({
      records,
      roster: [{ id: 'inf-1', name: 'Creator One', workflowStatus: 'Approved', approvalStatus: 'Approved', paymentStatus: 'Not Requested' }],
      range: null,
      groupMode: 'influencer',
      today: '2026-05-01',
    })

    expect(snapshot.influencers).toHaveLength(1)
    expect(snapshot.influencers[0].cost).toBe(200)
    expect(snapshot.influencers[0].salesAed).toBe(500)
    expect(snapshot.influencers[0].netProfitAed).toBe(300)
    expect(snapshot.topByNetProfit[0]).toMatchObject({ influencerId: 'inf-1', netProfitAed: 300 })
  })

  it('resolveDashboardDateRange supports this month', () => {
    const range = resolveDashboardDateRange('this_month')
    expect(range?.from).toMatch(/^\d{4}-\d{2}-01$/)
    expect(range?.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
