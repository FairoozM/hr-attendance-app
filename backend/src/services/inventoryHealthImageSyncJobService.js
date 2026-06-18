/**
 * In-memory background jobs for inventory health image sync (returns immediately; no HTTP timeout).
 */

const crypto = require('crypto')
const { syncMissingInventoryImages } = require('./inventoryHealthImageService')

const jobs = new Map()
let activeJobId = null

function serializeJob(job) {
  if (!job) return null
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    result: job.status === 'completed' ? job.result : undefined,
  }
}

function getActiveImageSyncJob() {
  if (!activeJobId) return null
  const job = jobs.get(activeJobId)
  if (!job || !['queued', 'running'].includes(job.status)) {
    activeJobId = null
    return null
  }
  return serializeJob(job)
}

function getImageSyncJob(jobId) {
  return serializeJob(jobs.get(String(jobId || '').trim()))
}

function startImageSyncJob(options = {}) {
  const running = getActiveImageSyncJob()
  if (running) return { ...running, alreadyRunning: true }

  const jobId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const now = new Date().toISOString()
  const job = {
    jobId,
    status: 'queued',
    progress: {
      step: 'Queued',
      saved: 0,
      failed: 0,
      attempted: 0,
      remaining: 0,
      alreadyCached: 0,
      scannedItems: 0,
    },
    startedAt: now,
    completedAt: null,
    error: null,
    result: null,
    options: { ...options },
  }
  jobs.set(jobId, job)
  activeJobId = jobId

  setImmediate(async () => {
    job.status = 'running'
    job.progress.step = 'Fetching Zoho item list…'
    try {
      const result = await syncMissingInventoryImages({
        ...options,
        all: options.all === true || options.all === 'true' || options.all === '1',
        limit: options.limit ?? 20,
        concurrency: options.concurrency ?? 1,
        staggerMs: options.staggerMs ?? 800,
        maxBatches: options.maxBatches ?? 1,
        onProgress: (p) => {
          job.progress = {
            step: p.step || job.progress.step,
            saved: p.saved ?? job.progress.saved,
            failed: p.failed ?? job.progress.failed,
            attempted: p.attempted ?? job.progress.attempted,
            remaining: p.remaining ?? job.progress.remaining,
            alreadyCached: p.alreadyCached ?? job.progress.alreadyCached,
            scannedItems: p.scannedItems ?? job.progress.scannedItems,
          }
        },
      })
      job.result = result
      job.progress = {
        step: `Done — saved ${result.saved}, failed ${result.failed}`,
        saved: result.saved,
        failed: result.failed,
        attempted: result.attempted,
        remaining: result.skippedDueToLimit,
        alreadyCached: result.alreadyCached,
        scannedItems: result.scannedItems,
      }
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
    } catch (err) {
      job.status = 'failed'
      job.error = err?.message || String(err)
      job.completedAt = new Date().toISOString()
      console.error('[inventory-health-images] background sync failed:', job.error)
    } finally {
      if (activeJobId === jobId) activeJobId = null
    }
  })

  return serializeJob(job)
}

module.exports = {
  startImageSyncJob,
  getImageSyncJob,
  getActiveImageSyncJob,
}
