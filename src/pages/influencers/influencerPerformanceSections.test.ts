import { describe, expect, it } from 'vitest'
import { normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'
import type { InfluencerContractRow, InfluencerPerformanceProfile } from '../../types/influencer'
import {
  INFLUENCER_PERFORMANCE_SECTIONS,
  DEFAULT_INFLUENCER_PERFORMANCE_SECTION,
  isPerformanceSectionActive,
  readPerformanceSection,
  writePerformanceSection,
} from './influencerPerformanceSections'
import {
  contractMatchesDateFilter,
  filterRankingRowsByDatePreset,
  sumPerformanceRankingTotals,
} from './influencerPerformanceRankingUtils'

const influencer: InfluencerPerformanceProfile = {
  id: 'inf-1',
  name: 'Creator One',
  platform: 'Instagram',
  username: 'creator.one',
  niche: '',
  profileImage: '',
  followers: 10000,
  assignedCampaign: '',
  status: 'Active',
  createdAt: '',
  updatedAt: '',
}

function rankingRow(overrides: Partial<InfluencerContractRow> = {}): InfluencerContractRow {
  return {
    id: 'ip-contract::c1::2026-05-01',
    contractId: 'ip-contract::c1::2026-05-01',
    influencerId: 'inf-1',
    influencer,
    platform: 'Instagram',
    postUrl: 'https://instagram.com/reel/test/',
    campaignName: 'Campaign A',
    videoTitle: 'Video A',
    contractStartDate: '2026-05-01',
    startDate: '2026-05-01',
    latestDate: '2026-05-03',
    date: '2026-05-03',
    monitoringDays: 3,
    recordedDays: 3,
    days: [],
    latest: undefined,
    records: [],
    totals: {
      views: 3000,
      likes: 120,
      comments: 11,
      shares: 9,
      saves: 0,
      storyViews: 0,
      cost: 100,
      salesAed: 18000,
      netProfitAed: 17900,
    },
    engagementRate: 4.6,
    views: 3000,
    likes: 120,
    comments: 11,
    shares: 9,
    saves: 0,
    storyViews: 0,
    cost: 100,
    salesAed: 18000,
    netProfitAed: 17900,
    ...overrides,
  }
}

describe('influencerPerformanceSections', () => {
  it('defines exactly 3 sections', () => {
    expect(INFLUENCER_PERFORMANCE_SECTIONS).toEqual(['leaderboard', 'ranking', 'timeline'])
  })

  it('defaults to leaderboard and persists section in URL query', () => {
    expect(readPerformanceSection(new URLSearchParams())).toBe('leaderboard')
    const params = writePerformanceSection(new URLSearchParams(), 'ranking')
    expect(readPerformanceSection(params)).toBe('ranking')
    expect(params.get('section')).toBe('ranking')
    const cleared = writePerformanceSection(params, DEFAULT_INFLUENCER_PERFORMANCE_SECTION)
    expect(cleared.has('section')).toBe(false)
  })

  it('shows only the active section flag as true', () => {
    expect(isPerformanceSectionActive('leaderboard', 'leaderboard')).toBe(true)
    expect(isPerformanceSectionActive('leaderboard', 'ranking')).toBe(false)
    expect(isPerformanceSectionActive('timeline', 'timeline')).toBe(true)
  })
})

describe('influencerPerformanceRankingUtils', () => {
  const rows = [
    rankingRow(),
    rankingRow({
      id: 'ip-contract::c2::2026-06-01',
      contractId: 'ip-contract::c2::2026-06-01',
      contractStartDate: '2026-06-01',
      startDate: '2026-06-01',
      latestDate: '2026-06-02',
      date: '2026-06-02',
      cost: 200,
      views: 5000,
      likes: 80,
      comments: 20,
      shares: 10,
      salesAed: 9000,
      netProfitAed: 8800,
    }),
  ]

  it('sums top totals for existing numeric columns only', () => {
    const totals = sumPerformanceRankingTotals(rows)
    expect(totals.cost).toBe(300)
    expect(totals.views).toBe(8000)
    expect(totals.likes).toBe(200)
    expect(totals.comments).toBe(31)
    expect(totals.shares).toBe(19)
    expect(totals.salesAed).toBe(27000)
    expect(totals.netProfitAed).toBe(26700)
    expect(Object.keys(totals)).toEqual([
      'cost',
      'views',
      'likes',
      'comments',
      'shares',
      'salesAed',
      'netProfitAed',
    ])
  })

  it('keeps bottom TOTAL row values aligned with top totals for the same filtered rows', () => {
    const totals = sumPerformanceRankingTotals(rows.slice(0, 1))
    const again = sumPerformanceRankingTotals(rows.slice(0, 1))
    expect(again).toEqual(totals)
  })

  it('filters ranking rows by preset and custom range', () => {
    const mayOnly = filterRankingRowsByDatePreset(rows, 'custom', '2026-05-01', '2026-05-31')
    expect(mayOnly).toHaveLength(1)
    expect(mayOnly[0].contractStartDate).toBe('2026-05-01')

    const juneOnly = filterRankingRowsByDatePreset(rows, 'custom', '2026-06-01', '2026-06-30')
    expect(juneOnly).toHaveLength(1)
    expect(juneOnly[0].contractStartDate).toBe('2026-06-01')

    const all = filterRankingRowsByDatePreset(rows, 'all_time', '', '')
    expect(all).toHaveLength(2)
  })

  it('updates totals when time filter changes visible rows', () => {
    const allTotals = sumPerformanceRankingTotals(filterRankingRowsByDatePreset(rows, 'all_time', '', ''))
    const mayTotals = sumPerformanceRankingTotals(filterRankingRowsByDatePreset(rows, 'custom', '2026-05-01', '2026-05-31'))
    expect(mayTotals.cost).toBe(100)
    expect(allTotals.cost).toBe(300)
    expect(mayTotals.salesAed).toBe(18000)
    expect(allTotals.salesAed).toBe(27000)
  })

  it('does not double-count cumulative check-ins because rows are contract-level', () => {
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
      }),
    ]
    const contractRow = rankingRow({
      cost: 100,
      salesAed: 10000,
      netProfitAed: 9900,
      views: 2000,
      records,
    })
    const totals = sumPerformanceRankingTotals([contractRow])
    expect(totals.salesAed).toBe(10000)
    expect(totals.salesAed).not.toBe(15000)
  })

  it('matches contract date overlap semantics for ranking filters', () => {
    const row = rankingRow()
    expect(contractMatchesDateFilter(row, '2026-05-01', '2026-05-31')).toBe(true)
    expect(contractMatchesDateFilter(row, '2026-06-01', '2026-06-30')).toBe(false)
  })
})
