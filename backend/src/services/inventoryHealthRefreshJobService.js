/**
 * Background Zoho rebuild for inventory health (CloudFront-safe — returns immediately).
 * Does not clear the existing cache until the new payload is written successfully.
 */

const crypto = require('crypto')
const inventoryHealthService = require('./inventoryHealthService')

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
    warehouseId: job.warehouseId,
    alreadyRunning: job.alreadyRunning === true,
  }
}

function getActiveRefreshJob() {
  if (!activeJobId) return null
  const job = jobs.get(activeJobId)
  if (!job || !['queued', 'running'].includes(job.status)) {
    activeJobId = null
    return null
  }
  return serializeJob(job)
}

function getRefreshJob(jobId) {
  return serializeJob(jobs.get(String(jobId || '').trim()))
}

function startRefreshJob({ warehouseId = null } = {}) {
  const running = getActiveRefreshJob()
  if (running) return { ...running, alreadyRunning: true }

  const jobId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const now = new Date().toISOString()
  const wh = warehouseId ? String(warehouseId).trim() : null
  const job = {
    jobId,
    status: 'queued',
    progress: { step: 'Queued Zoho rebuild…' },
    startedAt: now,
    completedAt: null,
    error: null,
    warehouseId: wh,
  }
  jobs.set(jobId, job)
  activeJobId = jobId

  setImmediate(async () => {
    job.status = 'running'
    job.progress = { step: 'Fetching Zoho items + sales…' }
    try {
      // refresh:true rebuilds and overwrites cache — do NOT clear first (avoids empty 504 window).
      await inventoryHealthService.loadInventoryHealthBase({
        warehouseId: wh,
        refresh: true,
      })
      job.status = 'completed'
      job.progress = { step: 'Zoho rebuild complete' }
      job.completedAt = new Date().toISOString()
    } catch (err) {
      job.status = 'failed'
      job.error = err?.message || String(err)
      job.completedAt = new Date().toISOString()
      console.error('[inventory-health] background refresh failed:', job.error)
    } finally {
      if (activeJobId === jobId) activeJobId = null
    }
  })

  return serializeJob(job)
}

module.exports = {
  startRefreshJob,
  getRefreshJob,
  getActiveRefreshJob,
}
