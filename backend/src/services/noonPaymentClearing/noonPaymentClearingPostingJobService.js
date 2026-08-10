const crypto = require('crypto')

const jobs = new Map()
const activeByBatchId = new Map()
const JOB_TTL_MS = 60 * 60 * 1000

function pruneOldJobs() {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs.entries()) {
    const started = Date.parse(job.startedAt || '') || 0
    if (started && started < cutoff && ['completed', 'failed'].includes(job.status)) {
      jobs.delete(id)
    }
  }
}

function serializeJob(job) {
  if (!job) return null
  return {
    jobId: job.jobId,
    batchId: job.batchId,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    result: job.status === 'completed' ? job.result : undefined,
  }
}

function safeError(err) {
  const msg = err && err.message ? String(err.message) : 'Noon payment clearing job failed'
  return msg.slice(0, 800)
}

function startJob(batchId, kind, runner, progressStep, completedStep = 'Completed') {
  pruneOldJobs()
  const id = Number(batchId)
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }

  const existingJobId = activeByBatchId.get(id)
  if (existingJobId) {
    const existing = jobs.get(existingJobId)
    if (existing && ['queued', 'running'].includes(existing.status)) {
      return serializeJob(existing)
    }
  }

  const jobId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const now = new Date().toISOString()
  const job = {
    jobId,
    batchId: id,
    kind,
    status: 'queued',
    progress: { step: 'Queued', current: 0, total: 3 },
    startedAt: now,
    completedAt: null,
    error: null,
    result: null,
  }
  jobs.set(jobId, job)
  activeByBatchId.set(id, jobId)

  setImmediate(async () => {
    job.status = 'running'
    job.progress = { step: progressStep, current: 1, total: 3 }
    try {
      job.progress = { step: progressStep, current: 2, total: 3 }
      job.result = await runner()
      job.progress = {
        step: completedStep,
        current: 3,
        total: 3,
      }
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
    } catch (err) {
      job.status = 'failed'
      job.error = safeError(err)
      job.completedAt = new Date().toISOString()
      console.error('[noon-payment-clearing-post]', kind, id, err?.message || err)
    } finally {
      if (activeByBatchId.get(id) === jobId) activeByBatchId.delete(id)
    }
  })

  return serializeJob(job)
}

/**
 * Live Zoho post — async so CloudFront (~30s) does not 504.
 */
function startPostToZohoJob(batchId, options = {}) {
  return startJob(
    batchId,
    'post_to_zoho',
    async () => {
      const service = require('./noonPaymentClearingService')
      return service.postBatchToZoho(batchId, {
        dryRun: false,
        postedBy: options.postedBy,
      })
    },
    'Posting Noon payments and journals to Zoho'
  )
}

/**
 * Force repost — clears local posting rows then posts; often multi-minute with Zoho.
 */
function startForceRepostJob(batchId, options = {}) {
  return startJob(
    batchId,
    'force_repost',
    async () => {
      const service = require('./noonPaymentClearingService')
      return service.forceRepost(batchId, {
        reason: options.reason,
        actorUserId: options.actorUserId,
      })
    },
    'Force reposting Noon payments and journals to Zoho'
  )
}

/**
 * Payment preview — async so CloudFront (~30s) does not 504 on large statements.
 */
function startPaymentPreviewJob(batchId, options = {}) {
  return startJob(
    batchId,
    'payment_preview',
    async () => {
      const service = require('./noonPaymentClearingService')
      const paymentPreview = await service.generatePaymentPreview(batchId, options.createdBy)
      return { paymentPreview }
    },
    'Generating Noon payment preview',
    'Payment preview ready'
  )
}

function getPostingJob(jobId) {
  pruneOldJobs()
  const id = String(jobId || '').trim()
  return serializeJob(jobs.get(id))
}

module.exports = {
  startPostToZohoJob,
  startForceRepostJob,
  startPaymentPreviewJob,
  getPostingJob,
}
