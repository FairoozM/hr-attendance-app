const crypto = require('crypto')

const jobs = new Map()

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
    status: job.status,
    progress: job.progress,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    result: job.status === 'completed' ? job.result : undefined,
  }
}

function safeError(err) {
  const msg = err && err.message ? String(err.message) : 'Noon statement upload failed'
  return msg.slice(0, 800)
}

/**
 * Start async Noon preview-upload so CloudFront (~30s origin timeout) does not 504
 * while Zoho invoice matching runs.
 */
function startPreviewUploadJob({ buffer, fileName, customerName, createdBy, allowMatchFailure }) {
  pruneOldJobs()
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const err = new Error('Noon statement file is required.')
    err.code = 'NOON_PAYMENT_CLEARING_UPLOAD_REQUIRED'
    err.status = 400
    throw err
  }

  const jobId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const now = new Date().toISOString()
  const job = {
    jobId,
    status: 'queued',
    progress: { step: 'Queued', current: 0, total: 3 },
    startedAt: now,
    completedAt: null,
    error: null,
    result: null,
  }
  jobs.set(jobId, job)

  // Copy buffer so multer memory can be GC'd after the request returns.
  const fileBuffer = Buffer.from(buffer)
  const originalName = String(fileName || 'noon-statement.csv')

  setImmediate(async () => {
    job.status = 'running'
    job.progress = { step: 'Parsing Noon statement and matching Zoho invoices', current: 1, total: 3 }
    try {
      const service = require('./noonPaymentClearingService')
      job.progress = { step: 'Building preview and saving batch', current: 2, total: 3 }
      job.result = await service.buildPreviewFromUpload(fileBuffer, originalName, {
        customerName,
        createdBy,
        allowMatchFailure: Boolean(allowMatchFailure),
      })
      job.progress = { step: 'Upload complete', current: 3, total: 3 }
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
    } catch (err) {
      job.status = 'failed'
      job.error = safeError(err)
      job.completedAt = new Date().toISOString()
      console.error('[noon-payment-clearing-upload]', jobId, err?.message || err)
    }
  })

  return serializeJob(job)
}

function getPreviewUploadJob(jobId) {
  pruneOldJobs()
  const id = String(jobId || '').trim()
  return serializeJob(jobs.get(id))
}

module.exports = {
  startPreviewUploadJob,
  getPreviewUploadJob,
}
