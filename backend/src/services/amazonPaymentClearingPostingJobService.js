const crypto = require('crypto')

const jobs = new Map()
const activeByBatchId = new Map()

function serializeJob(job) {
  if (!job) return null
  return {
    jobId: job.jobId,
    batchId: job.batchId,
    status: job.status,
    progress: job.progress,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    outcome: job.status === 'completed' ? job.result?.status || 'posted' : job.status === 'failed' ? 'failed' : null,
    errorCode: job.errorCode || null,
    result: job.status === 'completed' ? job.result : undefined,
  }
}

function safeError(err) {
  const msg = err && err.message ? String(err.message) : 'Zoho posting failed'
  return msg.slice(0, 800)
}

function startPostToZohoJob(batchId, options = {}) {
  const id = Number(batchId)
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
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
    status: 'queued',
    progress: { step: 'Queued', current: 0, total: 0 },
    startedAt: now,
    completedAt: null,
    error: null,
    result: null,
    postedBy: options.postedBy || null,
  }
  jobs.set(jobId, job)
  activeByBatchId.set(id, jobId)

  setImmediate(async () => {
    job.status = 'running'
    job.progress = { step: 'Starting', current: 0, total: 0 }
    const onProgress = (progress) => {
      job.progress = progress
    }
    try {
      const { postBatchToZoho, forceRepostBatch } = require('./amazonPaymentClearingService')
      job.result = options.forceRepostReason
        ? await forceRepostBatch(id, { dryRun: false, reason: options.forceRepostReason, postedBy: options.postedBy, onProgress })
        : await postBatchToZoho(id, { dryRun: false, postedBy: options.postedBy, onProgress })
      const summary = job.result?.summary || {}
      const done =
        (summary.paymentsCreated || 0) + (summary.paymentsSkipped || 0) + (summary.journalsCreated || 0) + (summary.journalsSkipped || 0)
      const total = done + (summary.errors || 0) + (summary.verificationRequired || 0)
      job.progress = {
        step: job.result?.success ? 'All sales entries verified in Zoho' : 'Posting stopped with entries still open',
        current: done,
        total,
      }
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
    } catch (err) {
      job.status = 'failed'
      job.error = safeError(err)
      job.errorCode = err?.code || null
      job.completedAt = new Date().toISOString()
      console.error('[amazon-payment-clearing-post]', id, err?.message || err)
    } finally {
      if (activeByBatchId.get(id) === jobId) activeByBatchId.delete(id)
    }
  })

  return serializeJob(job)
}

function getPostToZohoJob(jobId) {
  const id = String(jobId || '').trim()
  return serializeJob(jobs.get(id))
}

module.exports = {
  startPostToZohoJob,
  getPostToZohoJob,
}
