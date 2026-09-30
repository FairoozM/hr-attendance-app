'use strict'

/**
 * Runs "Post to Zoho" as a background job so no HTTP request (browser, CloudFront ~60s) has to
 * stay open while a statement posts. The job state lives on the batch row (posting_job) so the
 * page can poll it, reopen it after a reload, and see when a server restart cut a run short.
 *
 * Duplicate runs are refused here (one job per batch in this process, plus a fresh RUNNING job
 * from another process) and again by the per-statement advisory lock inside postTabbyBatch.
 * An interrupted run is safe to start again: posting re-checks Zoho before every write.
 */

const crypto = require('crypto')
const { postTabbyBatch } = require('./tabbyClearingPostingService')
const { storeError } = require('./tabbyClearingStore')

const JOB_STATUS = Object.freeze({
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  STOPPED: 'STOPPED',
  FAILED: 'FAILED',
  INTERRUPTED: 'INTERRUPTED',
})

const BOOT_ID = crypto.randomUUID()
const HEARTBEAT_MS = 15000
const FOREIGN_STALE_MS = 60000

const running = new Map()

function fail(status, code, message, extra = {}) {
  const err = storeError(status, code, message)
  Object.assign(err, extra)
  return err
}

function isLiveElsewhere(job, nowMs) {
  if (!job || job.status !== JOB_STATUS.RUNNING || job.bootId === BOOT_ID) return false
  const beat = Date.parse(job.heartbeatAt || job.startedAt || '')
  return Number.isFinite(beat) && nowMs - beat < FOREIGN_STALE_MS
}

async function persist(store, batchId, job, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await store.updateBatch(batchId, { postingJob: job })
      return
    } catch (err) {
      if (i === attempts) console.error('[tabby-clearing] could not save posting job state:', err && err.message)
    }
  }
}

/**
 * Validates the request, records a RUNNING job and starts posting without waiting for it.
 * @returns {Promise<object>} the RUNNING job
 */
async function startPostingJob({ batchId, store, sources, writer, config, actor, fingerprint, now = () => new Date(), post = postTabbyBatch }) {
  if (config.postingEnabled !== true) throw fail(403, 'POSTING_DISABLED', 'Tabby posting is disabled on this server (TABBY_CLEARING_POSTING_ENABLED is not true).')
  if (!actor) throw fail(401, 'ACTOR_REQUIRED', 'An authenticated admin is required to post.')
  if (!fingerprint) throw fail(400, 'FINGERPRINT_REQUIRED', 'Preview the statement and post the reviewed preview.')
  const id = String(batchId)
  const batch = await store.getBatch(id)
  if (!batch) throw fail(404, 'BATCH_NOT_FOUND', `Tabby batch ${id} was not found.`)
  const current = running.get(id)
  if (current) throw fail(409, 'POSTING_IN_PROGRESS', `${batch.statementNumber} is already being posted.`, { job: current.job })
  if (isLiveElsewhere(batch.postingJob, now().getTime())) throw fail(409, 'POSTING_IN_PROGRESS', `${batch.statementNumber} is already being posted.`, { job: batch.postingJob })

  const startedAt = now().toISOString()
  const job = {
    id: crypto.randomUUID(),
    status: JOB_STATUS.RUNNING,
    statementNumber: batch.statementNumber,
    actor,
    fingerprint,
    bootId: BOOT_ID,
    startedAt,
    heartbeatAt: startedAt,
    finishedAt: null,
    progress: { phase: 'QUEUED', done: 0, total: null, current: null },
    result: null,
    error: null,
  }
  const entry = { job }
  running.set(id, entry)
  try {
    await store.updateBatch(id, { postingJob: job })
  } catch (err) {
    running.delete(id)
    throw err
  }

  // Every job write goes through one queue so a late heartbeat can never overwrite the final state.
  let queue = Promise.resolve()
  const write = (next, attempts = 1) => {
    queue = queue.then(() => persist(store, id, next, attempts))
    return queue
  }
  const beat = setInterval(() => {
    entry.job = { ...entry.job, heartbeatAt: now().toISOString() }
    write(entry.job)
  }, HEARTBEAT_MS)
  if (typeof beat.unref === 'function') beat.unref()

  entry.promise = (async () => {
    let final
    try {
      const result = await post({
        batchId: id,
        store,
        sources,
        writer,
        config,
        actor,
        fingerprint,
        now,
        onProgress: async (progress) => {
          entry.job = { ...entry.job, progress, heartbeatAt: now().toISOString() }
          await write(entry.job)
        },
      })
      final = {
        ...entry.job,
        status: result.stopReason ? JOB_STATUS.STOPPED : JOB_STATUS.SUCCEEDED,
        result: { status: result.status, stoppedAt: result.stoppedAt, stopReason: result.stopReason, log: result.log },
      }
    } catch (err) {
      if (!err || !err.status || err.status >= 500) console.error('[tabby-clearing] posting job failed:', err && (err.code || ''), err && err.message)
      final = {
        ...entry.job,
        status: JOB_STATUS.FAILED,
        error: { status: (err && err.status) || 500, code: (err && err.code) || 'POSTING_FAILED', message: String((err && err.message) || err).slice(0, 1000) },
      }
    } finally {
      clearInterval(beat)
    }
    const done = { ...final, finishedAt: now().toISOString(), heartbeatAt: now().toISOString() }
    entry.job = done
    await write(done, 3)
    running.delete(id)
    return done
  })()
  return job
}

/** The batch's latest posting job; a RUNNING job whose process is gone is reported INTERRUPTED. */
async function getPostingJob({ batchId, store, now = () => new Date() }) {
  const id = String(batchId)
  const current = running.get(id)
  if (current) return current.job
  const batch = await store.getBatch(id)
  if (!batch) throw fail(404, 'BATCH_NOT_FOUND', `Tabby batch ${id} was not found.`)
  const job = batch.postingJob
  if (!job || job.status !== JOB_STATUS.RUNNING) return job || null
  if (job.bootId !== BOOT_ID && isLiveElsewhere(job, now().getTime())) return job
  const interrupted = {
    ...job,
    status: JOB_STATUS.INTERRUPTED,
    finishedAt: now().toISOString(),
    error: { status: 503, code: 'POSTING_INTERRUPTED', message: 'The server restarted while this statement was posting. Refresh the preview and post again; records already in Zoho are found and skipped.' },
  }
  await persist(store, id, interrupted)
  return interrupted
}

/** Test hook: wait for a batch's in-process job to finish. */
function waitForPostingJob(batchId) {
  const current = running.get(String(batchId))
  return current ? current.promise : Promise.resolve(null)
}

module.exports = { JOB_STATUS, startPostingJob, getPostingJob, waitForPostingJob }
