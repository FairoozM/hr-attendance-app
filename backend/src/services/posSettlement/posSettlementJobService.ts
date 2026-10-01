'use strict'

/**
 * Runs "Post to Zoho" for one payout in the background (same rules as Tabby): the job state lives
 * on the settlement row so the page can poll it and see a run a restart cut short. Duplicate runs
 * are refused here and again by the per-payout advisory lock. An interrupted run is safe to start
 * again: posting re-checks Zoho before every write.
 */

const crypto = require('crypto')
const { postPosSettlement } = require('./posSettlementPostingService.ts')
const { storeError } = require('./posSettlementStore.ts')

const JOB_STATUS = Object.freeze({ RUNNING: 'RUNNING', SUCCEEDED: 'SUCCEEDED', STOPPED: 'STOPPED', FAILED: 'FAILED', INTERRUPTED: 'INTERRUPTED' })
const BOOT_ID = crypto.randomUUID()
const HEARTBEAT_MS = 15000
const FOREIGN_STALE_MS = 60000
const running = new Map<string, any>()

function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(storeError(status, code, message), extra)
}

function isLiveElsewhere(job: any, nowMs: number) {
  if (!job || job.status !== JOB_STATUS.RUNNING || job.bootId === BOOT_ID) return false
  const beat = Date.parse(job.heartbeatAt || job.startedAt || '')
  return Number.isFinite(beat) && nowMs - beat < FOREIGN_STALE_MS
}

async function persist(store: any, id: string, job: any, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await store.updateSettlement(id, { postingJob: job })
      return
    } catch (err: any) {
      if (i === attempts) console.error('[pos-settlement] could not save posting job state:', err && err.message)
    }
  }
}

async function startPostingJob({ settlementId, store, sources, writer, config, actor, fingerprint, now = () => new Date(), post = postPosSettlement }: any) {
  if (config.postingEnabled !== true) throw fail(403, 'POSTING_DISABLED', 'POS settlement posting is disabled on this server (POS_SETTLEMENT_POSTING_ENABLED is not true).')
  if (!actor) throw fail(401, 'ACTOR_REQUIRED', 'An authenticated admin is required to post.')
  if (!fingerprint) throw fail(400, 'FINGERPRINT_REQUIRED', 'Post the approved preview.')
  const id = String(settlementId)
  const s = await store.getSettlement(id)
  if (!s) throw fail(404, 'SETTLEMENT_NOT_FOUND', `POS settlement ${id} was not found.`)
  if (!s.approval || s.approval.fingerprint !== fingerprint) throw fail(409, 'NOT_APPROVED', 'This exact preview has not been approved; approve it before posting.')
  const current = running.get(id)
  if (current) throw fail(409, 'POSTING_IN_PROGRESS', `${s.settlementCode} is already being posted.`, { job: current.job })
  if (isLiveElsewhere(s.postingJob, now().getTime())) throw fail(409, 'POSTING_IN_PROGRESS', `${s.settlementCode} is already being posted.`, { job: s.postingJob })

  const startedAt = now().toISOString()
  const job = { id: crypto.randomUUID(), status: JOB_STATUS.RUNNING, settlementCode: s.settlementCode, actor, fingerprint, bootId: BOOT_ID, startedAt, heartbeatAt: startedAt, finishedAt: null, progress: { phase: 'QUEUED', done: 0, total: null, current: null }, result: null, error: null }
  const entry: any = { job }
  running.set(id, entry)
  try {
    await store.updateSettlement(id, { postingJob: job })
  } catch (err) {
    running.delete(id)
    throw err
  }
  let queue = Promise.resolve()
  const write = (next: any, attempts = 1) => {
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
      const result = await post({ settlementId: id, store, sources, writer, config, actor, fingerprint, now, onProgress: async (progress: any) => {
        entry.job = { ...entry.job, progress, heartbeatAt: now().toISOString() }
        await write(entry.job)
      } })
      final = { ...entry.job, status: result.stopReason ? JOB_STATUS.STOPPED : JOB_STATUS.SUCCEEDED, result: { status: result.status, stoppedAt: result.stoppedAt, stopReason: result.stopReason, log: result.log } }
    } catch (err: any) {
      if (!err || !err.status || err.status >= 500) console.error('[pos-settlement] posting job failed:', err && (err.code || ''), err && err.message)
      final = { ...entry.job, status: JOB_STATUS.FAILED, error: { status: (err && err.status) || 500, code: (err && err.code) || 'POSTING_FAILED', message: String((err && err.message) || err).slice(0, 1000) } }
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

async function getPostingJob({ settlementId, store, now = () => new Date() }: any) {
  const id = String(settlementId)
  const current = running.get(id)
  if (current) return current.job
  const s = await store.getSettlement(id)
  if (!s) throw fail(404, 'SETTLEMENT_NOT_FOUND', `POS settlement ${id} was not found.`)
  const job = s.postingJob
  if (!job || job.status !== JOB_STATUS.RUNNING) return job || null
  if (job.bootId !== BOOT_ID && isLiveElsewhere(job, now().getTime())) return job
  const interrupted = { ...job, status: JOB_STATUS.INTERRUPTED, finishedAt: now().toISOString(), error: { status: 503, code: 'POSTING_INTERRUPTED', message: 'The server restarted while this payout was posting. Refresh the preview and post again; records already in Zoho are found and skipped.' } }
  await persist(store, id, interrupted)
  return interrupted
}

function waitForPostingJob(settlementId: string) {
  const current = running.get(String(settlementId))
  return current ? current.promise : Promise.resolve(null)
}

module.exports = { JOB_STATUS, startPostingJob, getPostingJob, waitForPostingJob }
