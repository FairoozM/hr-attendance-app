import { describe, expect, it } from 'vitest'
import {
  buildContractRows,
  computeContractRankings,
  dedupePerformanceRecords,
  getVideoContractTimelines,
  normalizePerformanceRecord,
} from './influencerPerformanceUtils'
import type { InfluencerPerformanceProfile } from '../types/influencer'

const influencer: InfluencerPerformanceProfile = {
  id: 'dscvr',
  name: 'DSCVR UAE | اكتشف الإمارات',
  platform: 'Instagram',
  username: 'dscvr.uae',
  niche: '',
  profileImage: '',
  followers: 577000,
  assignedCampaign: '',
  status: 'Active',
  createdAt: '',
  updatedAt: '',
}

describe('influencerPerformanceUtils', () => {
  it('merges same-video check-ins across URL variants into one contract timeline', () => {
    const records = [
      normalizePerformanceRecord({
        id: 'rec-day-1',
        contractId: 'old-generated-contract-id',
        influencerId: influencer.id,
        date: '2026-05-07',
        platform: 'Instagram',
        postUrl: 'https://instagram.com/reel/dscvr-video/',
        campaignName: 'DSCVR UAE',
        contractStartDate: '2026-05-07',
        monitoringDays: 5,
        views: 41000,
        likes: 312,
        comments: 11,
        shares: 989,
        salesAed: 1500,
        cost: 200,
        netProfitAed: 1300,
        updatedAt: '2026-05-07T12:00:00.000Z',
      }),
      normalizePerformanceRecord({
        id: 'rec-day-2',
        contractId: 'new-generated-contract-id',
        influencerId: influencer.id,
        date: '2026-05-08',
        platform: 'Instagram',
        postUrl: 'http://instagram.com/reel/dscvr-video?igsh=tracking',
        campaignName: 'DSCVR UAE',
        contractStartDate: '2026-05-08',
        monitoringDays: 5,
        views: 15800,
        likes: 54,
        comments: 12,
        shares: 111,
        salesAed: 800,
        cost: 100,
        netProfitAed: 700,
        updatedAt: '2026-05-08T12:00:00.000Z',
      }),
      normalizePerformanceRecord({
        id: 'rec-day-3',
        contractId: 'third-generated-contract-id',
        influencerId: influencer.id,
        date: '2026-05-09',
        platform: 'Instagram',
        postUrl: 'https://www.instagram.com/reel/dscvr-video/?utm_source=ig_web_copy_link',
        campaignName: 'DSCVR UAE',
        contractStartDate: '2026-05-09',
        monitoringDays: 5,
        views: 24000,
        likes: 80,
        comments: 13,
        shares: 121,
        salesAed: 900,
        cost: 100,
        netProfitAed: 800,
        updatedAt: '2026-05-09T12:00:00.000Z',
      }),
    ]

    const timelines = getVideoContractTimelines(records, [influencer])

    expect(timelines).toHaveLength(1)
    expect(timelines[0].recordedDays).toBe(3)
    expect(timelines[0].days[0].date).toBe('2026-05-07')
    expect(timelines[0].days[0].record?.id).toBe('rec-day-1')
    expect(timelines[0].days[1].record?.id).toBe('rec-day-2')
    expect(timelines[0].days[2].record?.id).toBe('rec-day-3')
    expect(dedupePerformanceRecords(records)).toHaveLength(3)

    expect(timelines[0].totals.views).toBe(41000 + 15800 + 24000)
    expect(timelines[0].totals.likes).toBe(312 + 54 + 80)
    expect(timelines[0].totals.comments).toBe(11 + 12 + 13)
    expect(timelines[0].totals.shares).toBe(989 + 111 + 121)
    expect(timelines[0].totals.salesAed).toBe(900)
    expect(timelines[0].totals.cost).toBe(100)
    expect(timelines[0].totals.netProfitAed).toBe(800)

    const contractRows = buildContractRows(records, [influencer])
    expect(contractRows).toHaveLength(1)
    expect(contractRows[0].recordedDays).toBe(3)
    expect(contractRows[0].views).toBe(41000 + 15800 + 24000)
  })

  it('groups campaign-only records without post URLs', () => {
    const campaignOnlyTimelines = getVideoContractTimelines([
      normalizePerformanceRecord({
        id: 'campaign-day-1',
        contractId: 'legacy-day-1-id',
        influencerId: influencer.id,
        date: '2026-05-07',
        platform: 'Instagram',
        campaignName: 'DSCVR UAE',
        contractStartDate: '2026-05-07',
        views: 1,
      }),
      normalizePerformanceRecord({
        id: 'campaign-day-2',
        contractId: 'legacy-day-2-id',
        influencerId: influencer.id,
        date: '2026-05-08',
        platform: 'Instagram',
        campaignName: 'DSCVR UAE',
        contractStartDate: '2026-05-08',
        views: 2,
      }),
    ], [influencer])

    expect(campaignOnlyTimelines).toHaveLength(1)
    expect(campaignOnlyTimelines[0].recordedDays).toBe(2)
  })

  it('ranks contracts by latest net profit AED', () => {
    const rankingContracts = getVideoContractTimelines([
      normalizePerformanceRecord({
        id: 'rank-a',
        contractId: 'ip-contract::rank-a::2026-05-01',
        influencerId: influencer.id,
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        postUrl: 'https://instagram.com/reel/rank-a/',
        netProfitAed: 12068,
      }),
      normalizePerformanceRecord({
        id: 'rank-b',
        contractId: 'ip-contract::rank-b::2026-05-02',
        influencerId: influencer.id,
        date: '2026-05-02',
        contractStartDate: '2026-05-02',
        postUrl: 'https://instagram.com/reel/rank-b/',
        netProfitAed: 11210,
      }),
      normalizePerformanceRecord({
        id: 'rank-c',
        contractId: 'ip-contract::rank-c::2026-05-03',
        influencerId: influencer.id,
        date: '2026-05-03',
        contractStartDate: '2026-05-03',
        postUrl: 'https://instagram.com/reel/rank-c/',
        netProfitAed: 0,
      }),
    ], [influencer])

    expect(rankingContracts).toHaveLength(3)

    const rankings = computeContractRankings(rankingContracts)
    expect(rankings.get('ip-contract::rank-a::2026-05-01')?.rank).toBe(1)
    expect(rankings.get('ip-contract::rank-b::2026-05-02')?.rank).toBe(2)
    expect(rankings.get('ip-contract::rank-c::2026-05-03')?.rank).toBe(3)
  })
})
