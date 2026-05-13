const crypto = require('crypto')
const comparisonService = require('./amazonZohoStockComparisonService')

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
  const msg = err && err.message ? String(err.message) : 'Refresh failed'
  return msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]').slice(0, 800)
}

function startAmazonZohoStockRefresh(options = {}) {
  const running = activeJob()
  if (running) return serializeJob(running)

  const jobId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const now = new Date().toISOString()
  const job = {
    jobId,
    status: 'queued',
    progress: { step: 'Queued', current: 0, total: 0 },
    startedAt: now,
    completedAt: null,
    error: null,
  }
  jobs.set(jobId, job)
  activeJobId = jobId

  setImmediate(async () => {
    job.status = 'running'
    job.progress = { step: 'Starting refresh', current: 0, total: 0 }
    try {
      const result = await comparisonService.refreshAmazonZohoStockComparison({
        marketplace: options.marketplace || 'all',
        progress: (progress) => {
          job.progress = {
            step: progress.step || job.progress.step,
            current: Number.isFinite(Number(progress.current)) ? Number(progress.current) : job.progress.current,
            total: Number.isFinite(Number(progress.total)) ? Number(progress.total) : job.progress.total,
          }
        },
      })
      job.progress = {
        step: `Completed ${result.totalRows} comparison rows`,
        current: result.totalRows,
        total: result.totalRows,
      }
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
    } catch (e) {
      job.status = 'failed'
      job.error = safeError(e)
      job.completedAt = new Date().toISOString()
      console.error('[amazon-zoho-stock-refresh]', e?.message || e)
    } finally {
      if (activeJobId === jobId) activeJobId = null
    }
  })

  return serializeJob(job)
}

function getAmazonZohoStockRefreshJob(jobId) {
  const id = String(jobId || '').trim()
  return serializeJob(jobs.get(id))
}

module.exports = {
  startAmazonZohoStockRefresh,
  getAmazonZohoStockRefreshJob,
}
