const crypto = require('crypto')
const store = require('./noonPaymentClearingStore')

function safeError(err) {
  const msg = err && err.message ? String(err.message) : 'Noon payment clearing job failed'
  return msg.slice(0, 800)
}

async function startJob(batchId, kind, runner, progressStep, completedStep = 'Completed', createdBy = null) {
  const id = Number(batchId)
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('Noon payment clearing batch not found.')
    err.code = 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }

  const existing = await store.findActiveClearingJobForBatch(id)
  if (existing) return existing

  const jobId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const job = await store.createClearingJob({
    jobId,
    batchId: id,
    kind,
    createdBy,
    progress: { step: 'Queued', current: 0, total: 3 },
  })

  setImmediate(async () => {
    try {
      await store.updateClearingJob(jobId, {
        status: 'running',
        progress: { step: progressStep, current: 1, total: 3 },
      })
      await store.updateClearingJob(jobId, {
        progress: { step: progressStep, current: 2, total: 3 },
      })
      const result = await runner()
      await store.updateClearingJob(jobId, {
        status: 'completed',
        progress: { step: completedStep, current: 3, total: 3 },
        result,
        completedAt: new Date().toISOString(),
      })
    } catch (err) {
      await store.updateClearingJob(jobId, {
        status: 'failed',
        error: safeError(err),
        completedAt: new Date().toISOString(),
      })
      console.error('[noon-payment-clearing-job]', kind, id, err?.message || err)
    }
  })

  return job
}

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
    'Posting Noon payments and journals to Zoho',
    'Posting completed',
    options.postedBy
  )
}

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
    'Force reposting Noon payments and journals to Zoho',
    'Force repost completed',
    options.actorUserId
  )
}

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
    'Payment preview ready',
    options.createdBy
  )
}

function startReconcileOpenBalancesJob(batchId, options = {}) {
  return startJob(
    batchId,
    'reconcile_open_balances',
    async () => {
      const service = require('./noonPaymentClearingService')
      return service.reconcileOpenBalances(batchId)
    },
    'Checking live Zoho open balances',
    'Open balance check complete',
    options.createdBy
  )
}

async function getPostingJob(jobId) {
  return store.getClearingJobById(jobId)
}

module.exports = {
  startPostToZohoJob,
  startForceRepostJob,
  startPaymentPreviewJob,
  startReconcileOpenBalancesJob,
  getPostingJob,
}
