const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const storePath = path.resolve(__dirname, '../src/services/noonPaymentClearing/noonPaymentClearingStore.js')
const fakeStore = {
  active: null,
  updates: [],
  created: [],
  async findActiveClearingJobForBatch() {
    return this.active
  },
  async updateClearingJob(jobId, patch) {
    this.updates.push({ jobId, ...patch })
  },
  async createClearingJob(job) {
    this.created.push(job)
    return { ...job, status: 'queued' }
  },
}
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore }
const servicePath = path.resolve(__dirname, '../src/services/noonPaymentClearing/noonPaymentClearingService.js')
require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: { reconcileOpenBalances: async () => ({}), postBatchToZoho: async () => ({}) },
}
const {
  startReconcileOpenBalancesJob,
  startPostToZohoJob,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingPostingJobService')

const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString()

describe('Noon clearing job start', () => {
  beforeEach(() => {
    fakeStore.active = null
    fakeStore.updates = []
    fakeStore.created = []
  })

  it('reuses a recent active job of the same kind', async () => {
    fakeStore.active = { jobId: 'j1', kind: 'reconcile_open_balances', status: 'running', startedAt: minutesAgo(1) }
    const job = await startReconcileOpenBalancesJob(18)
    assert.equal(job.jobId, 'j1')
    assert.equal(fakeStore.created.length, 0)
  })

  it('replaces an abandoned open balance check with a new run', async () => {
    fakeStore.active = { jobId: 'j1', kind: 'reconcile_open_balances', status: 'running', startedAt: minutesAgo(65) }
    const job = await startReconcileOpenBalancesJob(18)
    assert.notEqual(job.jobId, 'j1')
    assert.equal(fakeStore.updates[0].jobId, 'j1')
    assert.equal(fakeStore.updates[0].status, 'failed')
    assert.equal(fakeStore.created.length, 1)
  })

  it('never replaces a long-running posting job', async () => {
    fakeStore.active = { jobId: 'p1', kind: 'post_to_zoho', status: 'running', startedAt: minutesAgo(65) }
    const job = await startPostToZohoJob(18)
    assert.equal(job.jobId, 'p1')
    assert.equal(fakeStore.created.length, 0)
  })

  it('refuses to hand back a job of a different kind', async () => {
    fakeStore.active = { jobId: 'p1', kind: 'post_to_zoho', status: 'running', startedAt: minutesAgo(1) }
    await assert.rejects(startReconcileOpenBalancesJob(18), (err) => err.status === 409)
    assert.equal(fakeStore.created.length, 0)
  })
})
