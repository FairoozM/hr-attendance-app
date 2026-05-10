import assert from 'node:assert/strict'
import {
  buildContractRows,
  dedupePerformanceRecords,
  getVideoContractTimelines,
  normalizePerformanceRecord,
} from '../src/utils/influencerPerformanceUtils.js'

const influencer = {
  id: 'dscvr',
  name: 'DSCVR UAE | اكتشف الإمارات',
  platform: 'Instagram',
  username: 'dscvr.uae',
  followers: 577000,
}

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

assert.equal(timelines.length, 1)
assert.equal(timelines[0].recordedDays, 3)
assert.equal(timelines[0].days[0].date, '2026-05-07')
assert.equal(timelines[0].days[0].record.id, 'rec-day-1')
assert.equal(timelines[0].days[1].record.id, 'rec-day-2')
assert.equal(timelines[0].days[2].record.id, 'rec-day-3')
assert.equal(dedupePerformanceRecords(records).length, 3)

// Aggregated totals power the per-contract row in the performance table.
assert.equal(timelines[0].totals.views, 41000 + 15800 + 24000)
assert.equal(timelines[0].totals.likes, 312 + 54 + 80)
assert.equal(timelines[0].totals.comments, 11 + 12 + 13)
assert.equal(timelines[0].totals.shares, 989 + 111 + 121)
assert.equal(timelines[0].totals.salesAed, 1500 + 800 + 900)
assert.equal(timelines[0].totals.cost, 200 + 100 + 100)
assert.equal(timelines[0].totals.netProfitAed, 1300 + 700 + 800)

const contractRows = buildContractRows(records, [influencer])
assert.equal(contractRows.length, 1)
assert.equal(contractRows[0].recordedDays, 3)
assert.equal(contractRows[0].views, 41000 + 15800 + 24000)

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

assert.equal(campaignOnlyTimelines.length, 1)
assert.equal(campaignOnlyTimelines[0].recordedDays, 2)

console.log('Influencer performance utility tests passed')
