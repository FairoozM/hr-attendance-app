const crypto = require('crypto')
const { fetchOutOfStockAmazonSkus } = require('./amazonListingsInventoryReadService')

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

function activeJob() {
  if (!activeJobId) return null
  const job = jobs.get(activeJobId)
  if (!job || !['queued', 'running'].includes(job.status)) {
    activeJobId = null
    return null
  }
  return job
}

function safeError(err) {
  const msg = err && err.message ? String(err.message) : 'Amazon fetch failed'
  return msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]').slice(0, 800)
}

function startOutOfStockFetchJob(options = {}) {
  const running = activeJob()
  if (running) return serializeJob(running)

  const marketplaceKey = String(options.marketplaceKey || 'uae').toLowerCase() === 'ksa' ? 'ksa' : 'uae'
  const jobId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const now = new Date().toISOString()
  const job = {
    jobId,
    status: 'queued',
    progress: { step: 'Queued', current: 0, total: 0 },
    startedAt: now,
    completedAt: null,
    error: null,
    result: null,
    marketplaceKey,
  }
  jobs.set(jobId, job)
  activeJobId = jobId

  setImmediate(async () => {
    job.status = 'running'
    job.progress = { step: 'Starting Amazon out-of-stock fetch', current: 0, total: 0 }
    try {
      const result = await fetchOutOfStockAmazonSkus({
        marketplaceKey,
        progress: (progress) => {
          job.progress = {
            step: progress.step || job.progress.step,
            current: Number.isFinite(Number(progress.current)) ? Number(progress.current) : job.progress.current,
            total: Number.isFinite(Number(progress.total)) ? Number(progress.total) : job.progress.total,
          }
        },
      })
      job.result = result
      job.progress = {
        step: `Found ${result.rows.length} out-of-stock SKU(s)`,
        current: result.rows.length,
        total: result.totalListings,
      }
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
    } catch (e) {
      job.status = 'failed'
      job.error = safeError(e)
      job.completedAt = new Date().toISOString()
      console.error('[amazon-oos-clearance-fetch]', marketplaceKey, e?.message || e)
    } finally {
      if (activeJobId === jobId) activeJobId = null
    }
  })

  return serializeJob(job)
}

function getOutOfStockFetchJob(jobId) {
  const id = String(jobId || '').trim()
  return serializeJob(jobs.get(id))
}

module.exports = {
  startOutOfStockFetchJob,
  getOutOfStockFetchJob,
}
