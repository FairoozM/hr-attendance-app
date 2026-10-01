/**
 * Background jobs for the returns steps (refresh credit notes from Zoho, refund credit
 * notes). Zoho's per-minute request limit can make these run for minutes, longer than
 * CloudFront waits for a response, so the browser polls the job instead.
 */
const crypto = require('crypto')

const JOB_RETENTION_MS = 60 * 60 * 1000
const jobs = new Map()
const activeByKey = new Map()

function serializeJob(job) {
  if (!job) return null
  return {
    jobId: job.jobId,
    kind: job.kind,
    batchId: job.batchId,
    status: job.status,
    progress: job.progress,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    errorCode: job.errorCode || null,
    errorStatus: job.errorStatus || null,
    result: job.status === 'completed' ? job.result : undefined,
  }
}

function pruneOldJobs() {
  const cutoff = Date.now() - JOB_RETENTION_MS
  for (const [id, job] of jobs) {
    if (job.completedAt && Date.parse(job.completedAt) < cutoff) jobs.delete(id)
  }
}

/**
 * Start (or join) the job of this kind for a batch. A second click while one is running
 * returns the running job rather than starting another.
 * @param {string} kind
 * @param {number|string} batchId
 * @param {(onProgress: (p: { step: string, current: number, total: number }) => void) => Promise<any>} run
 */
function startReturnsJob(kind, batchId, run) {
  pruneOldJobs()
  const id = Number(batchId)
  const key = `${kind}:${id}`
  const existing = jobs.get(activeByKey.get(key))
  if (existing && ['queued', 'running'].includes(existing.status)) return serializeJob(existing)

  const jobId = crypto.randomUUID()
  const job = {
    jobId,
    kind,
    batchId: id,
    status: 'queued',
    progress: { step: 'Queued', current: 0, total: 0 },
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    result: null,
  }
  jobs.set(jobId, job)
  activeByKey.set(key, jobId)

  setImmediate(async () => {
    job.status = 'running'
    job.progress = { step: 'Starting', current: 0, total: 0 }
    try {
      job.result = await run((progress) => {
        job.progress = progress
      })
      job.status = 'completed'
    } catch (err) {
      job.status = 'failed'
      job.error = String(err?.message || 'Job failed').slice(0, 800)
      job.errorCode = err?.code || null
      job.errorStatus = err?.status || null
      console.error(`[amazon-payment-clearing-${kind}]`, id, err?.message || err)
    } finally {
      job.completedAt = new Date().toISOString()
      if (activeByKey.get(key) === jobId) activeByKey.delete(key)
    }
  })

  return serializeJob(job)
}

function getReturnsJob(jobId) {
  return serializeJob(jobs.get(String(jobId || '').trim()))
}

module.exports = { startReturnsJob, getReturnsJob }
