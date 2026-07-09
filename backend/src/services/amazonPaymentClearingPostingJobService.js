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
    job.progress = { step: 'Posting grouped Zoho Record Payments and fee journals', current: 0, total: 0 }
    try {
      const { postBatchToZoho } = require('./amazonPaymentClearingService')
      job.result = await postBatchToZoho(id, {
        dryRun: false,
        postedBy: options.postedBy,
      })
      job.progress = {
        step: 'Posting completed',
        current: job.result?.summary?.paymentsCreated || 0,
        total: job.result?.summary?.paymentsCreated || 0,
      }
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
    } catch (err) {
      job.status = 'failed'
      job.error = safeError(err)
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
