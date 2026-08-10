const crypto = require('crypto')
const store = require('./noonPaymentClearingStore')

function safeError(err) {
  const msg = err && err.message ? String(err.message) : 'Noon statement upload failed'
  return msg.slice(0, 800)
}

/**
 * Durable async upload — survives API restarts; avoids CloudFront 504 during Zoho match.
 */
async function startPreviewUploadJob({ buffer, fileName, customerName, createdBy, allowMatchFailure }) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const err = new Error('Noon statement file is required.')
    err.code = 'NOON_PAYMENT_CLEARING_UPLOAD_REQUIRED'
    err.status = 400
    throw err
  }

  const jobId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const job = await store.createClearingJob({
    jobId,
    batchId: null,
    kind: 'preview_upload',
    createdBy,
    progress: { step: 'Queued', current: 0, total: 3 },
  })

  const fileBuffer = Buffer.from(buffer)
  const originalName = String(fileName || 'noon-statement.csv')

  setImmediate(async () => {
    try {
      await store.updateClearingJob(jobId, {
        status: 'running',
        progress: { step: 'Parsing Noon statement and matching Zoho invoices', current: 1, total: 3 },
      })
      const service = require('./noonPaymentClearingService')
      await store.updateClearingJob(jobId, {
        progress: { step: 'Building preview and saving batch', current: 2, total: 3 },
      })
      const result = await service.buildPreviewFromUpload(fileBuffer, originalName, {
        customerName,
        createdBy,
        allowMatchFailure: Boolean(allowMatchFailure),
      })
      await store.updateClearingJob(jobId, {
        status: 'completed',
        batchId: result?.batchId || result?.batch?.batchId || null,
        progress: { step: 'Upload complete', current: 3, total: 3 },
        result,
        completedAt: new Date().toISOString(),
      })
    } catch (err) {
      await store.updateClearingJob(jobId, {
        status: 'failed',
        error: safeError(err),
        completedAt: new Date().toISOString(),
      })
      console.error('[noon-payment-clearing-upload]', jobId, err?.message || err)
    }
  })

  return job
}

async function getPreviewUploadJob(jobId) {
  return store.getClearingJobById(jobId)
}

module.exports = {
  startPreviewUploadJob,
  getPreviewUploadJob,
}
