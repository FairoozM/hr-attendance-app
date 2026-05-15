const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire } = require('./_helpers')

function setupServiceMock() {
  const calls = []
  const txCalls = []
  const txClient = {
    query: async (text, params) => {
      txCalls.push({ text, params })
      if (/DELETE FROM influencer_performance_records/.test(text)) return { rows: [], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    },
    release: () => {},
  }
  const restoreDb = mockModule('../src/db', {
    query: async (text, params) => {
      calls.push({ text, params })
      if (/FROM influencer_performance_record_tombstones/.test(text)) {
        return { rows: [{ id: 'dead-id' }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
    pool: { connect: async () => txClient },
    ensureInfluencerPerformanceRecordsTable: async () => {},
  })
  const restoreInfluencers = mockModule('../src/services/influencersService', {
    getInfluencerById: async () => ({ id: 'inf-1' }),
  })
  const svc = freshRequire('../src/services/influencerPerformanceService')
  return {
    svc,
    calls,
    txCalls,
    restore: () => {
      restoreDb()
      restoreInfluencers()
    },
  }
}

test('influencerPerformanceService skips tombstoned ids during bulk upsert', async () => {
  const { svc, calls, restore } = setupServiceMock()

  const result = await svc.bulkUpsertPerformanceRecords([
    { id: 'dead-id', influencerId: 'inf-1', date: '2026-05-08' },
  ], 8, true)

  assert.equal(result.upserted, 0)
  assert.equal(result.skipped, 1)
  assert.equal(result.skippedTombstoned, 1)
  assert.deepEqual(result.skippedTombstonedIds, ['dead-id'])
  assert.ok(calls.some((call) => /FROM influencer_performance_record_tombstones/.test(call.text)))
  assert.equal(calls.some((call) => /INSERT INTO influencer_performance_records/.test(call.text)), false)
  restore()
})

test('influencerPerformanceService delete creates tombstone transactionally', async () => {
  const { svc, txCalls, restore } = setupServiceMock()

  const result = await svc.deletePerformanceRecord('dead-id', 8)

  assert.deepEqual(result, { deleted: true })
  assert.match(txCalls[0].text, /BEGIN/)
  assert.ok(txCalls.some((call) => /DELETE FROM influencer_performance_records/.test(call.text)))
  assert.ok(txCalls.some((call) => /INSERT INTO influencer_performance_record_tombstones/.test(call.text)))
  assert.ok(txCalls.some((call) => /COMMIT/.test(call.text)))
  restore()
})
