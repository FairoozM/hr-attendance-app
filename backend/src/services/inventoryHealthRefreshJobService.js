/**
 * Background Zoho rebuild for inventory health (CloudFront-safe — returns immediately).
 * Does not clear the existing cache until the new payload is written successfully.
 * Jobs are keyed per warehouse so Apply warehouse is not blocked by an "all warehouses" rebuild.
 */

const crypto = require('crypto')
const inventoryHealthService = require('./inventoryHealthService')

const jobs = new Map()
/** @type {Map<string, string>} cacheKey -> jobId */
const activeJobByWarehouseKey = new Map()

function warehouseKey(warehouseId) {
  return inventoryHealthService.cacheKeyForBase(warehouseId || null)
}

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

function getActiveRefreshJob(warehouseId = null) {
  const key = warehouseKey(warehouseId)
  const jobId = activeJobByWarehouseKey.get(key)
  if (!jobId) return null
  const job = jobs.get(jobId)
  if (!job || !['queued', 'running'].includes(job.status)) {
    activeJobByWarehouseKey.delete(key)
    return null
  }
  return serializeJob(job)
}

function getRefreshJob(jobId) {
  return serializeJob(jobs.get(String(jobId || '').trim()))
}

function startRefreshJob({ warehouseId = null } = {}) {
  const wh = warehouseId ? String(warehouseId).trim() : null
  const key = warehouseKey(wh)
  const running = getActiveRefreshJob(wh)
  if (running) return { ...running, alreadyRunning: true }

  const jobId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const now = new Date().toISOString()
  const job = {
    jobId,
    status: 'queued',
    progress: { step: wh ? `Queued Zoho rebuild for warehouse ${wh}…` : 'Queued Zoho rebuild…' },
    startedAt: now,
    completedAt: null,
    error: null,
    warehouseId: wh,
    cacheKey: key,
  }
  jobs.set(jobId, job)
  activeJobByWarehouseKey.set(key, jobId)

  setImmediate(async () => {
    job.status = 'running'
    job.progress = {
      step: wh ? `Fetching Zoho items + sales for warehouse ${wh}…` : 'Fetching Zoho items + sales…',
    }
    try {
      // refresh:true rebuilds and overwrites cache — do NOT clear first.
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
      if (activeJobByWarehouseKey.get(key) === jobId) {
        activeJobByWarehouseKey.delete(key)
      }
    }
  })

  return serializeJob(job)
}

module.exports = {
  startRefreshJob,
  getRefreshJob,
  getActiveRefreshJob,
}
