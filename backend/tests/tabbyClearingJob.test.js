'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { createMemoryTabbyStore } = require('../src/services/tabbyClearing/tabbyClearingMemoryStore')
const { JOB_STATUS, startPostingJob, getPostingJob, waitForPostingJob } = require('../src/services/tabbyClearing/tabbyClearingJobService')
const { parseTabbyStatement } = require('../src/services/tabbyClearing/tabbyStatementParser')
const model = require('../src/services/tabbyClearing/tabbyClearingModel')
const { getTabbyClearingConfig } = require('../src/config/tabbyClearing')
const fs = require('fs')
const path = require('path')

const SEP28 = fs.readFileSync(path.join(__dirname, 'fixtures', 'tabby', 'Tabby20260928AED.xlsx'))
const config = { ...getTabbyClearingConfig(), postingEnabled: true }

async function importedBatch() {
  const store = createMemoryTabbyStore()
  const parsed = parseTabbyStatement(SEP28, { fileName: 'a.xlsx' })
  const { batch } = await store.importStatement({ parsed, analysis: model.analyzeStatement(parsed, config), fileName: 'a.xlsx', actor: 'user:1' })
  return { store, batchId: batch.id }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const base = (store, batchId, post) => ({ batchId, store, sources: {}, writer: {}, config, actor: 'user:1', fingerprint: 'fp', post })

test('posting job: returns RUNNING at once, records progress, then the final result', async () => {
  const { store, batchId } = await importedBatch()
  const gate = deferred()
  const post = async ({ onProgress }) => {
    await onProgress({ phase: 'POSTING', done: 3, total: 14, current: 'Tabby20260928AED/21141/SALE_NET' })
    await gate.promise
    return { status: 'POSTED', stoppedAt: null, stopReason: null, log: [{ key: 'k', status: 'VERIFIED' }] }
  }
  const job = await startPostingJob(base(store, batchId, post))
  assert.equal(job.status, JOB_STATUS.RUNNING)
  await new Promise((r) => setImmediate(r))
  const mid = await getPostingJob({ batchId, store })
  assert.equal(mid.status, JOB_STATUS.RUNNING)
  assert.deepEqual(mid.progress, { phase: 'POSTING', done: 3, total: 14, current: 'Tabby20260928AED/21141/SALE_NET' })

  await assert.rejects(startPostingJob(base(store, batchId, post)), (e) => e.status === 409 && e.code === 'POSTING_IN_PROGRESS' && e.job.id === job.id)

  gate.resolve()
  const done = await waitForPostingJob(batchId)
  assert.equal(done.status, JOB_STATUS.SUCCEEDED)
  assert.equal(done.result.status, 'POSTED')
  assert.ok(done.finishedAt)
  const saved = (await store.getBatch(batchId)).postingJob
  assert.equal(saved.status, JOB_STATUS.SUCCEEDED)
  assert.equal(saved.id, job.id)
})

test('posting job: a stopped run is STOPPED and a thrown error is FAILED with its code', async () => {
  const { store, batchId } = await importedBatch()
  await startPostingJob(base(store, batchId, async () => ({ status: 'PARTIALLY_POSTED', stoppedAt: 'k', stopReason: 'Zoho timed out.', log: [] })))
  assert.equal((await waitForPostingJob(batchId)).status, JOB_STATUS.STOPPED)

  await startPostingJob(base(store, batchId, async () => {
    const err = new Error('The statement, Zoho or the posting date changed since this preview.')
    err.status = 409
    err.code = 'PREVIEW_CHANGED'
    throw err
  }))
  const failed = await waitForPostingJob(batchId)
  assert.equal(failed.status, JOB_STATUS.FAILED)
  assert.deepEqual(failed.error, { status: 409, code: 'PREVIEW_CHANGED', message: 'The statement, Zoho or the posting date changed since this preview.' })
})

test('posting job: guards refuse before anything is recorded', async () => {
  const { store, batchId } = await importedBatch()
  const never = async () => assert.fail('must not post')
  await assert.rejects(startPostingJob({ ...base(store, batchId, never), config: { ...config, postingEnabled: false } }), (e) => e.status === 403)
  await assert.rejects(startPostingJob({ ...base(store, batchId, never), actor: null }), (e) => e.status === 401)
  await assert.rejects(startPostingJob({ ...base(store, batchId, never), fingerprint: '' }), (e) => e.status === 400)
  await assert.rejects(startPostingJob({ ...base(store, '999', never) }), (e) => e.status === 404)
  assert.equal((await store.getBatch(batchId)).postingJob, null)
})

test('posting job: a RUNNING job left by a restarted server is INTERRUPTED; a live one elsewhere blocks a second run', async () => {
  const { store, batchId } = await importedBatch()
  const now = new Date('2026-09-29T16:30:00Z')
  const foreign = (heartbeatAt) => ({ id: 'old', status: JOB_STATUS.RUNNING, bootId: 'other-process', startedAt: '2026-09-29T16:00:00Z', heartbeatAt, progress: { phase: 'POSTING', done: 5, total: 14, current: null } })

  await store.updateBatch(batchId, { postingJob: foreign('2026-09-29T16:29:40Z') })
  assert.equal((await getPostingJob({ batchId, store, now: () => now })).status, JOB_STATUS.RUNNING)
  await assert.rejects(startPostingJob({ ...base(store, batchId, async () => assert.fail('must not post')), now: () => now }), (e) => e.code === 'POSTING_IN_PROGRESS')

  await store.updateBatch(batchId, { postingJob: foreign('2026-09-29T16:10:00Z') })
  const interrupted = await getPostingJob({ batchId, store, now: () => now })
  assert.equal(interrupted.status, JOB_STATUS.INTERRUPTED)
  assert.equal(interrupted.error.code, 'POSTING_INTERRUPTED')
  assert.equal((await store.getBatch(batchId)).postingJob.status, JOB_STATUS.INTERRUPTED)

  await startPostingJob({ ...base(store, batchId, async () => ({ status: 'POSTED', stoppedAt: null, stopReason: null, log: [] })), now: () => now })
  assert.equal((await waitForPostingJob(batchId)).status, JOB_STATUS.SUCCEEDED)
})

test('posting job: progress reports that fail never stop the run', async () => {
  const { store, batchId } = await importedBatch()
  const flaky = { ...store, updateBatch: async (id, patch) => { if (patch.postingJob && patch.postingJob.progress && patch.postingJob.progress.phase === 'POSTING') throw new Error('db blip'); return store.updateBatch(id, patch) } }
  await startPostingJob(base(flaky, batchId, async ({ onProgress }) => {
    await onProgress({ phase: 'POSTING', done: 1, total: 2, current: 'x' })
    return { status: 'POSTED', stoppedAt: null, stopReason: null, log: [] }
  }))
  assert.equal((await waitForPostingJob(batchId)).status, JOB_STATUS.SUCCEEDED)
})
