import { describe, expect, it } from 'vitest'
import { normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'
import type { Influencer } from '../../lib/influencers'
import {
  buildInfluencerAnalyticsSnapshot,
  defaultAnalyticsFilters,
} from './influencerAnalyticsUtils'
import {
  buildInfluencerProfileSnapshot,
  buildProfileNeedsAttention,
  filterRecordsForInfluencer,
  influencerQueryParam,
  moduleDeepLinks,
  profileEngagementRate,
  reconcileProfileWithAnalytics,
  reconcileProfileWithPayments,
  resolveInfluencerById,
} from './influencerProfileUtils'

const rosterBase = {
  workflowStatus: 'Approved' as const,
  approvalStatus: 'Approved' as const,
  paymentStatus: 'Not Requested' as const,
}

function rosterRow(id: string, name: string, extra: Partial<Influencer> = {}): Influencer {
  return { id, name, ...rosterBase, ...extra }
}

describe('influencerProfileUtils', () => {
  it('resolveInfluencerById matches stable id only', () => {
    const roster = [
      rosterRow('inf-1', 'Creator One'),
      rosterRow('inf-2', 'Creator One'),
    ]
    expect(resolveInfluencerById(roster, 'inf-1')?.name).toBe('Creator One')
    expect(resolveInfluencerById(roster, 'inf-2')?.name).toBe('Creator One')
    expect(resolveInfluencerById(roster, 'Creator One')).toBeNull()
    expect(resolveInfluencerById(roster, '')).toBeNull()
    expect(resolveInfluencerById(roster, 'missing')).toBeNull()
  })

  it('duplicate display names resolve to distinct ids', () => {
    const roster = [
      rosterRow('inf-a', 'Same Name'),
      rosterRow('inf-b', 'Same Name'),
    ]
    const records = [
      normalizePerformanceRecord({
        id: 'd1',
        contractId: 'ip-contract::a::2026-05-01',
        influencerId: 'inf-a',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        cost: 100,
        salesAed: 200,
      }),
      normalizePerformanceRecord({
        id: 'd2',
        contractId: 'ip-contract::b::2026-05-01',
        influencerId: 'inf-b',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        cost: 300,
        salesAed: 400,
      }),
    ]

    const profileA = buildInfluencerProfileSnapshot({
      influencerId: 'inf-a',
      roster,
      records,
      payments: [],
      today: '2026-05-01',
    })
    const profileB = buildInfluencerProfileSnapshot({
      influencerId: 'inf-b',
      roster,
      records,
      payments: [],
      today: '2026-05-01',
    })

    expect(profileA?.summary.totalCost).toBe(100)
    expect(profileB?.summary.totalCost).toBe(300)
  })

  it('returns null for unknown influencer id', () => {
    const snapshot = buildInfluencerProfileSnapshot({
      influencerId: 'unknown',
      roster: [rosterRow('inf-1', 'Creator')],
      records: [],
      payments: [],
    })
    expect(snapshot).toBeNull()
  })

  it('builds valid profile with no contracts when roster exists', () => {
    const snapshot = buildInfluencerProfileSnapshot({
      influencerId: 'inf-1',
      roster: [rosterRow('inf-1', 'Creator', { notes: 'CRM note' })],
      records: [],
      payments: [],
    })
    expect(snapshot).not.toBeNull()
    expect(snapshot?.contracts).toHaveLength(0)
    expect(snapshot?.summary.contractsAnalysed).toBe(0)
    expect(snapshot?.notesFields[0]?.value).toBe('CRM note')
  })

  it('aggregates KPIs from latest check-in per contract (not cumulative)', () => {
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
        likes: 10,
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
        likes: 20,
      }),
    ]

    const snapshot = buildInfluencerProfileSnapshot({
      influencerId: 'inf-1',
      roster: [rosterRow('inf-1', 'Creator')],
      records,
      payments: [],
      today: '2026-05-02',
    })

    expect(snapshot?.summary.totalCost).toBe(50)
    expect(snapshot?.summary.totalSales).toBe(900)
    expect(snapshot?.summary.totalNetProfit).toBe(850)
    expect(snapshot?.summary.overallRoi).toBe(1700)
    expect(snapshot?.summary.totalViews).toBe(3000)
  })

  it('handles zero-cost ROI safely', () => {
    const records = [
      normalizePerformanceRecord({
        id: 'd1',
        contractId: 'ip-contract::c1::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        cost: 0,
        salesAed: 100,
        netProfitAed: 100,
      }),
    ]
    const snapshot = buildInfluencerProfileSnapshot({
      influencerId: 'inf-1',
      roster: [rosterRow('inf-1', 'Creator')],
      records,
      payments: [],
    })
    expect(snapshot?.summary.overallRoi).toBe(0)
    expect(Number.isFinite(snapshot?.summary.overallRoi ?? NaN)).toBe(true)
  })

  it('selects active contracts only', () => {
    const records = [
      normalizePerformanceRecord({
        id: 'active',
        contractId: 'ip-contract::active::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        monitoringDays: 5,
        cost: 100,
      }),
      normalizePerformanceRecord({
        id: 'done',
        contractId: 'ip-contract::done::2026-04-01',
        influencerId: 'inf-1',
        date: '2026-04-05',
        contractStartDate: '2026-04-01',
        monitoringDays: 5,
        cost: 200,
      }),
    ]
    const snapshot = buildInfluencerProfileSnapshot({
      influencerId: 'inf-1',
      roster: [rosterRow('inf-1', 'Creator')],
      records,
      payments: [],
      today: '2026-05-02',
    })
    expect(snapshot?.contracts).toHaveLength(2)
    expect(snapshot?.activeContracts).toHaveLength(1)
    expect(snapshot?.activeContracts[0].contractId).toContain('active')
  })

  it('reconciles profile totals with analytics for same influencer filter', () => {
    const roster = [rosterRow('inf-1', 'Creator')]
    const records = [
      normalizePerformanceRecord({
        id: 'd1',
        contractId: 'ip-contract::c1::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        cost: 100,
        salesAed: 300,
        netProfitAed: 200,
      }),
      normalizePerformanceRecord({
        id: 'd2',
        contractId: 'ip-contract::c2::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        cost: 50,
        salesAed: 150,
        netProfitAed: 100,
      }),
    ]
    const profile = buildInfluencerProfileSnapshot({
      influencerId: 'inf-1',
      roster,
      records,
      payments: [],
      today: '2026-05-01',
    })
    const analytics = buildInfluencerAnalyticsSnapshot({
      records,
      roster,
      filters: { ...defaultAnalyticsFilters(), influencerId: 'inf-1', groupMode: 'contract' },
      today: '2026-05-01',
    })
    expect(profile).not.toBeNull()
    expect(reconcileProfileWithAnalytics(profile!, analytics.summary)).toBe(true)
  })

  it('reconciles payment totals with Payments & ROI summary', () => {
    const records = [
      normalizePerformanceRecord({
        id: 'd1',
        contractId: 'ip-contract::c1::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        postUrl: 'https://instagram.com/reel/c1/',
        cost: 100,
      }),
      normalizePerformanceRecord({
        id: 'd2',
        contractId: 'ip-contract::c2::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        postUrl: 'https://instagram.com/reel/c2/',
        cost: 200,
      }),
    ]
    const profile = buildInfluencerProfileSnapshot({
      influencerId: 'inf-1',
      roster: [rosterRow('inf-1', 'Creator')],
      records,
      payments: [{
        contractId: 'ip-contract::c1::2026-05-01',
        influencerId: 'inf-1',
        amountPaid: 40,
        paymentStatus: 'Partially Paid',
        dueDate: '2026-05-10',
        paymentDate: null,
        invoiceReference: 'INV-1',
      }],
      today: '2026-05-05',
    })
    expect(profile).not.toBeNull()
    expect(reconcileProfileWithPayments(profile!)).toBe(true)
    expect(profile?.finance.untrackedContractCount).toBe(1)
  })

  it('flags untracked contracts separately from tracked outstanding', () => {
    const records = [
      normalizePerformanceRecord({
        id: 'd1',
        contractId: 'ip-contract::c1::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        cost: 500,
      }),
    ]
    const profile = buildInfluencerProfileSnapshot({
      influencerId: 'inf-1',
      roster: [rosterRow('inf-1', 'Creator')],
      records,
      payments: [],
    })
    expect(profile?.paymentRows[0].effectiveStatus).toBe('Untracked')
    expect(profile?.finance.trackedOutstanding).toBe(0)
    expect(profile?.finance.untrackedContractCount).toBe(1)
  })

  it('filters performance records by influencer id', () => {
    const records = [
      normalizePerformanceRecord({ id: 'a', contractId: 'c-a', influencerId: 'inf-1', date: '2026-05-01' }),
      normalizePerformanceRecord({ id: 'b', contractId: 'c-b', influencerId: 'inf-2', date: '2026-05-01' }),
    ]
    expect(filterRecordsForInfluencer(records, 'inf-1')).toHaveLength(1)
  })

  it('buildProfileNeedsAttention includes overdue tracked payment and untracked finance', () => {
    const paymentRowBase = {
      influencerName: 'Creator',
      influencerHandle: '@creator',
      influencerImage: '',
      contractStartDate: '2026-05-01',
      contractEndDate: '2026-05-05',
      invoiceReference: '',
      notes: '',
    }
    const items = buildProfileNeedsAttention({
      contracts: [],
      paymentRows: [{
        ...paymentRowBase,
        contractId: 'c1',
        influencerId: 'inf-1',
        contractLabel: 'Campaign A',
        contractCost: 100,
        amountPaid: 0,
        amountOutstanding: 100,
        hasPersistedPayment: true,
        paymentStatus: 'Pending',
        storedPaymentStatus: 'Pending',
        effectiveStatus: 'Overdue',
        dueDate: '2026-01-01',
        paymentDate: null,
        netProfitAed: 50,
        salesAed: 150,
        roi: 50,
      }, {
        ...paymentRowBase,
        contractId: 'c2',
        influencerId: 'inf-1',
        contractLabel: 'Campaign B',
        contractCost: 200,
        amountPaid: 0,
        amountOutstanding: 0,
        hasPersistedPayment: false,
        paymentStatus: 'Untracked',
        storedPaymentStatus: null,
        effectiveStatus: 'Untracked',
        dueDate: null,
        paymentDate: null,
        netProfitAed: 0,
        salesAed: 0,
        roi: 0,
      }],
      today: '2026-05-01',
    })
    expect(items.some((row) => row.label === 'Overdue tracked payment')).toBe(true)
    expect(items.some((row) => row.label === 'Missing finance tracking')).toBe(true)
  })

  it('moduleDeepLinks use influencer query parameter consistently', () => {
    const links = moduleDeepLinks('inf-42')
    expect(links.performance).toBe('/influencers/performance?influencer=inf-42')
    expect(links.payments).toBe('/influencers/payments?influencer=inf-42')
    expect(links.timeline).toBe('/influencers/timeline?influencer=inf-42')
    expect(links.analytics).toBe('/influencers/analytics?influencer=inf-42')
    expect(links.contracts).toBe('/influencers/contracts?influencer=inf-42')
    expect(influencerQueryParam('inf-42')).toBe('influencer=inf-42')
  })

  it('profileEngagementRate sums views and interactions across contracts', () => {
    const snapshot = buildInfluencerProfileSnapshot({
      influencerId: 'inf-1',
      roster: [rosterRow('inf-1', 'Creator')],
      records: [
        normalizePerformanceRecord({
          id: 'd1',
          contractId: 'ip-contract::c1::2026-05-01',
          influencerId: 'inf-1',
          date: '2026-05-01',
          contractStartDate: '2026-05-01',
          views: 1000,
          likes: 50,
          comments: 10,
          shares: 5,
        }),
      ],
      payments: [],
    })
    expect(profileEngagementRate(snapshot!.contracts)).toBeGreaterThan(0)
  })

  it('timeline events are scoped to influencer id', () => {
    const roster = [rosterRow('inf-1', 'Creator'), rosterRow('inf-2', 'Other')]
    const records = [
      normalizePerformanceRecord({
        id: 'd1',
        contractId: 'ip-contract::c1::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        monitoringDays: 3,
      }),
      normalizePerformanceRecord({
        id: 'd2',
        contractId: 'ip-contract::c2::2026-05-01',
        influencerId: 'inf-2',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        monitoringDays: 3,
      }),
    ]
    const profile = buildInfluencerProfileSnapshot({
      influencerId: 'inf-1',
      roster,
      records,
      payments: [],
      today: '2026-05-01',
    })
    expect(profile?.timelineEvents.every((event) => event.influencerId === 'inf-1')).toBe(true)
    expect(profile?.recentEvents.length).toBeLessThanOrEqual(10)
  })

  it('omits empty optional CRM note fields', () => {
    const profile = buildInfluencerProfileSnapshot({
      influencerId: 'inf-1',
      roster: [rosterRow('inf-1', 'Creator', { niche: 'Beauty' })],
      records: [],
      payments: [],
    })
    expect(profile?.notesFields).toHaveLength(0)
    expect(profile?.influencer.niche).toBe('Beauty')
  })
})
