import { describe, expect, it } from 'vitest'
import { normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'
import type { Influencer } from '../../lib/influencers'
import {
  buildInfluencerAnalyticsSnapshot,
  defaultAnalyticsFilters,
  reconcileWithDashboard,
} from './influencerAnalyticsUtils'
import { buildInfluencerDashboardSnapshot } from './influencerDashboardUtils'
import {
  buildInfluencerContractListRows,
  reconcileContractListRow,
} from './influencerContractsUtils'
import {
  buildInfluencerPaymentRows,
  summarizePaymentsRoi,
} from './influencerPaymentsRoiUtils'
import {
  buildInfluencerProfileSnapshot,
  reconcileProfileWithAnalytics,
  reconcileProfileWithPayments,
} from './influencerProfileUtils'

const roster: Influencer[] = [{
  id: 'inf-1',
  name: 'Creator One',
  workflowStatus: 'Approved',
  approvalStatus: 'Approved',
  paymentStatus: 'Not Requested',
}]

/** Canonical cumulative check-in fixture — contract total must be 18,000 not 33,000. */
const cumulativeRecords = [
  normalizePerformanceRecord({
    id: 'd1',
    contractId: 'ip-contract::c1::2026-05-01',
    influencerId: 'inf-1',
    date: '2026-05-01',
    contractStartDate: '2026-05-01',
    monitoringDays: 3,
    postUrl: 'https://instagram.com/reel/qa/',
    cost: 100,
    salesAed: 5000,
    netProfitAed: 4900,
    views: 1000,
    likes: 50,
  }),
  normalizePerformanceRecord({
    id: 'd2',
    contractId: 'ip-contract::c1::2026-05-01',
    influencerId: 'inf-1',
    date: '2026-05-02',
    contractStartDate: '2026-05-01',
    monitoringDays: 3,
    postUrl: 'https://instagram.com/reel/qa/',
    cost: 100,
    salesAed: 10000,
    netProfitAed: 9900,
    views: 2000,
    likes: 80,
  }),
  normalizePerformanceRecord({
    id: 'd3',
    contractId: 'ip-contract::c1::2026-05-01',
    influencerId: 'inf-1',
    date: '2026-05-03',
    contractStartDate: '2026-05-01',
    monitoringDays: 3,
    postUrl: 'https://instagram.com/reel/qa/',
    cost: 100,
    salesAed: 18000,
    netProfitAed: 17900,
    views: 3000,
    likes: 120,
  }),
]

describe('influencer module reconciliation', () => {
  it('never sums cumulative check-in financials across module surfaces', () => {
    const dashboard = buildInfluencerDashboardSnapshot({
      records: cumulativeRecords,
      roster,
      range: null,
      groupMode: 'contract',
      today: '2026-05-03',
    })
    expect(dashboard.totalSales).toBe(18000)
    expect(dashboard.totalCost).toBe(100)
    expect(dashboard.totalNetProfit).toBe(17900)
    expect(dashboard.totalSales).not.toBe(33000)
  })

  it('keeps dashboard, analytics, profile, contracts, and payments aligned for one influencer', () => {
    const payments = [{
      contractId: 'ip-contract::c1::2026-05-01',
      influencerId: 'inf-1',
      amountPaid: 50,
      paymentStatus: 'Partially Paid' as const,
      dueDate: '2026-05-10',
      paymentDate: null,
      invoiceReference: 'INV-QA',
    }]

    const dashboard = buildInfluencerDashboardSnapshot({
      records: cumulativeRecords,
      roster,
      range: null,
      groupMode: 'contract',
      today: '2026-05-03',
    })
    const filters = { ...defaultAnalyticsFilters(), influencerId: 'inf-1', groupMode: 'contract' as const }
    const analytics = buildInfluencerAnalyticsSnapshot({
      records: cumulativeRecords,
      roster,
      filters,
      today: '2026-05-03',
    })
    const profile = buildInfluencerProfileSnapshot({
      influencerId: 'inf-1',
      roster,
      records: cumulativeRecords,
      payments,
      today: '2026-05-03',
    })
    const contractRows = buildInfluencerContractListRows({
      records: cumulativeRecords,
      roster,
      payments,
      today: '2026-05-03',
    })
    const paymentRows = buildInfluencerPaymentRows({
      records: cumulativeRecords,
      roster,
      payments,
      range: null,
      today: '2026-05-03',
    })

    expect(profile).not.toBeNull()
    expect(reconcileWithDashboard(analytics.summary, dashboard, filters)).toBe(true)
    expect(reconcileProfileWithAnalytics(profile!, analytics.summary)).toBe(true)
    expect(reconcileProfileWithPayments(profile!)).toBe(true)

    const contractRow = contractRows[0]
    const dashboardContract = dashboard.contracts[0]
    const paymentRow = paymentRows[0]
    expect(reconcileContractListRow(contractRow, dashboardContract, paymentRow)).toBe(true)

    expect(contractRow.salesAed).toBe(18000)
    expect(contractRow.cost).toBe(100)
    expect(paymentRow.contractCost).toBe(100)
    expect(paymentRow.salesAed).toBe(18000)
    expect(summarizePaymentsRoi(paymentRows).totalContractedCost).toBe(100)
  })

  it('sums engagement metrics across check-ins while keeping financials on latest check-in', () => {
    const profile = buildInfluencerProfileSnapshot({
      influencerId: 'inf-1',
      roster,
      records: cumulativeRecords,
      payments: [],
      today: '2026-05-03',
    })
    expect(profile?.summary.totalViews).toBe(6000)
    expect(profile?.summary.totalSales).toBe(18000)
  })
})
