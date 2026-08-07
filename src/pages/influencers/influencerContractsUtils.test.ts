import { describe, expect, it } from 'vitest'
import { normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'
import type { Influencer } from '../../lib/influencers'
import {
  addContractUrl,
  buildContractAttentionFlags,
  buildInfluencerContractListRows,
  contractsFiltersToSearchParams,
  deriveContractStatusLabel,
  filterContractListRows,
  paginateContractListRows,
  readContractsFiltersFromSearchParams,
  reconcileContractListRow,
  sortContractListRows,
} from './influencerContractsUtils'
import { buildInfluencerDashboardSnapshot } from './influencerDashboardUtils'
import { buildInfluencerPaymentRows } from './influencerPaymentsRoiUtils'
import { resolveInfluencerById } from './influencerProfileUtils'

const rosterBase = {
  workflowStatus: 'Approved' as const,
  approvalStatus: 'Approved' as const,
  paymentStatus: 'Not Requested' as const,
}

function rosterRow(id: string, name: string): Influencer {
  return { id, name, ...rosterBase }
}

describe('influencerContractsUtils', () => {
  const records = [
    normalizePerformanceRecord({
      id: 'd1',
      contractId: 'ip-contract::c1::2026-05-01',
      influencerId: 'inf-1',
      date: '2026-05-01',
      contractStartDate: '2026-05-01',
      monitoringDays: 3,
      postUrl: 'https://instagram.com/reel/a/',
      cost: 100,
      salesAed: 500,
      netProfitAed: 400,
    }),
    normalizePerformanceRecord({
      id: 'd2',
      contractId: 'ip-contract::c1::2026-05-01',
      influencerId: 'inf-1',
      date: '2026-05-02',
      contractStartDate: '2026-05-01',
      monitoringDays: 3,
      postUrl: 'https://instagram.com/reel/a/',
      cost: 50,
      salesAed: 900,
      netProfitAed: 850,
    }),
    normalizePerformanceRecord({
      id: 'd3',
      contractId: 'ip-contract::c2::2026-05-01',
      influencerId: 'inf-2',
      date: '2026-05-01',
      contractStartDate: '2026-05-01',
      monitoringDays: 3,
      postUrl: 'https://instagram.com/reel/b/',
      cost: 200,
      salesAed: 100,
      netProfitAed: -100,
    }),
  ]
  const roster = [rosterRow('inf-1', 'Creator One'), rosterRow('inf-2', 'Creator One')]

  it('reads influencer filter from URL query params', () => {
    const filters = readContractsFiltersFromSearchParams(new URLSearchParams('influencer=inf-1&status=active&payment=Untracked&attention=1'))
    expect(filters.influencerId).toBe('inf-1')
    expect(filters.contractStatus).toBe('active')
    expect(filters.paymentStatus).toBe('Untracked')
    expect(filters.needsAttentionOnly).toBe(true)
    const roundTrip = contractsFiltersToSearchParams(filters)
    expect(roundTrip.get('influencer')).toBe('inf-1')
  })

  it('filters contracts by influencer id without name collisions', () => {
    const rows = buildInfluencerContractListRows({ records, roster, payments: [], today: '2026-05-02' })
    const filtered = filterContractListRows(rows, {
      influencerId: 'inf-2',
      contractStatus: 'all',
      campaignQuery: '',
      paymentStatus: 'All',
      checkInStatus: 'all',
      profitFilter: 'all',
      needsAttentionOnly: false,
    }, null)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].influencerId).toBe('inf-2')
  })

  it('filters untracked payment status', () => {
    const rows = buildInfluencerContractListRows({ records, roster, payments: [], today: '2026-05-02' })
    const untracked = filterContractListRows(rows, {
      influencerId: 'all',
      contractStatus: 'all',
      campaignQuery: '',
      paymentStatus: 'Untracked',
      checkInStatus: 'all',
      profitFilter: 'all',
      needsAttentionOnly: false,
    }, null)
    expect(untracked.length).toBeGreaterThan(0)
    expect(untracked.every((row) => !row.hasPersistedPayment)).toBe(true)
  })

  it('filters overdue tracked payments via payment row effective status', () => {
    const rows = buildInfluencerContractListRows({
      records: [records[2]],
      roster,
      payments: [{
        contractId: 'ip-contract::c2::2026-05-01',
        influencerId: 'inf-2',
        amountPaid: 0,
        paymentStatus: 'Pending',
        dueDate: '2026-01-01',
        paymentDate: null,
        invoiceReference: 'INV-1',
      }],
      today: '2026-05-05',
    })
    const overdue = filterContractListRows(rows, {
      influencerId: 'all',
      contractStatus: 'all',
      campaignQuery: '',
      paymentStatus: 'Overdue',
      checkInStatus: 'all',
      profitFilter: 'all',
      needsAttentionOnly: false,
    }, null)
    expect(overdue).toHaveLength(1)
    expect(overdue[0].effectivePaymentStatus).toBe('Overdue')
  })

  it('filters loss-making contracts', () => {
    const rows = buildInfluencerContractListRows({ records, roster, payments: [], today: '2026-05-02' })
    const loss = filterContractListRows(rows, {
      influencerId: 'all',
      contractStatus: 'all',
      campaignQuery: '',
      paymentStatus: 'All',
      checkInStatus: 'all',
      profitFilter: 'loss_making',
      needsAttentionOnly: false,
    }, null)
    expect(loss.some((row) => row.influencerId === 'inf-2')).toBe(true)
    expect(loss.every((row) => row.netProfitAed < 0)).toBe(true)
  })

  it('sorts contracts by cost descending', () => {
    const rows = buildInfluencerContractListRows({ records, roster, payments: [], today: '2026-05-02' })
    const sorted = sortContractListRows(rows, 'cost', 'desc')
    expect(sorted[0].cost).toBeGreaterThanOrEqual(sorted[sorted.length - 1].cost)
  })

  it('paginates contract rows', () => {
    const rows = buildInfluencerContractListRows({ records, roster, payments: [], today: '2026-05-02' })
    const page1 = paginateContractListRows(rows, 1, 1)
    expect(page1.rows).toHaveLength(1)
    expect(page1.total).toBe(2)
    expect(page1.totalPages).toBe(2)
  })

  it('addContractUrl preselects influencer safely', () => {
    expect(addContractUrl('inf-1')).toBe('/influencers/performance?add=1&influencer=inf-1')
    expect(addContractUrl()).toBe('/influencers/performance?add=1')
  })

  it('reconciles contract list row with dashboard and payment metrics', () => {
    const rows = buildInfluencerContractListRows({ records, roster, payments: [], today: '2026-05-02' })
    const dashboard = buildInfluencerDashboardSnapshot({
      records,
      roster,
      range: null,
      groupMode: 'contract',
      today: '2026-05-02',
    })
    const paymentRows = buildInfluencerPaymentRows({ records, roster, payments: [], range: null, today: '2026-05-02' })
    const row = rows.find((item) => item.influencerId === 'inf-1')
    const dashboardRow = dashboard.contracts.find((item) => item.influencerId === 'inf-1')
    const paymentRow = paymentRows.find((item) => item.influencerId === 'inf-1') || null
    expect(row).toBeTruthy()
    expect(dashboardRow).toBeTruthy()
    expect(reconcileContractListRow(row!, dashboardRow!, paymentRow)).toBe(true)
    expect(row!.cost).toBe(50)
    expect(row!.salesAed).toBe(900)
  })

  it('flags needs attention for untracked finance and loss-making contracts', () => {
    const rows = buildInfluencerContractListRows({ records, roster, payments: [], today: '2026-05-02' })
    const lossRow = rows.find((row) => row.influencerId === 'inf-2')
    expect(lossRow?.attentionFlags.some((flag) => flag.label === 'Loss-making')).toBe(true)
    expect(lossRow?.attentionFlags.some((flag) => flag.label === 'Untracked finance')).toBe(true)
  })

  it('resolves duplicate influencer names by id for profile navigation', () => {
    expect(resolveInfluencerById(roster, 'inf-1')?.id).toBe('inf-1')
    expect(resolveInfluencerById(roster, 'inf-2')?.id).toBe('inf-2')
  })

  it('derives contract status labels consistently', () => {
    const rows = buildInfluencerContractListRows({ records, roster, payments: [], today: '2026-05-02' })
    rows.forEach((row) => {
      expect(deriveContractStatusLabel(row, '2026-05-02')).toBe(row.statusLabel)
    })
  })

  it('buildContractAttentionFlags is deterministic', () => {
    const rows = buildInfluencerContractListRows({ records, roster, payments: [], today: '2026-05-02' })
    const row = rows[0]
    const flags = buildContractAttentionFlags(row, row.paymentRow, '2026-05-02')
    expect(Array.isArray(flags)).toBe(true)
  })
})
