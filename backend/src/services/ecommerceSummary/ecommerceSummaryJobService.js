'use strict'

/**
 * Background build for management Ecommerce Summary (CloudFront-safe).
 * Month day-by-day Zoho sales + expense trees routinely exceed the 25–30s edge timeout.
 */

const crypto = require('crypto')
const { assertYmd, todayUaeYmd } = require('../ecommerceAccounting/accountNature')
const { buildEcommerceSummaryReport } = require('./ecommerceSummaryService')

const JOB_RETENTION_MS = 15 * 60 * 1000

/** @type {Map<string, object>} */
const jobs = new Map()
/** @type {Map<string, string>} date -> jobId */
const activeJobByDate = new Map()

function newJobId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isOpen(job) {
  return Boolean(job) && (job.status === 'queued' || job.status === 'running')
}

function pruneFinishedJobs(now = Date.now()) {
  for (const [jobId, job] of jobs) {
    if (isOpen(job)) continue
    const finished = job.completedAt ? Date.parse(job.completedAt) : 0
    if (finished && now - finished > JOB_RETENTION_MS) jobs.delete(jobId)
  }
}

function serializeJob(job) {
  if (!job) return null
  return {
    jobId: job.jobId,
    date: job.date,
    status: job.status,
    progress: job.progress || '',
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error || null,
    report: job.report || null,
    alreadyRunning: job.alreadyRunning === true,
  }
}

function getSummaryJob(jobId) {
  pruneFinishedJobs()
  return serializeJob(jobs.get(String(jobId || '').trim()))
}

function getActiveSummaryJob(date) {
  const key = String(date || '').trim()
  const jobId = activeJobByDate.get(key)
  if (!jobId) return null
  const job = jobs.get(jobId)
  if (!isOpen(job)) {
    activeJobByDate.delete(key)
    return null
  }
  return serializeJob(job)
}

function startSummaryJob(opts = {}) {
  pruneFinishedJobs()
  const date = assertYmd(opts.date || todayUaeYmd())
  const existing = getActiveSummaryJob(date)
  if (existing) {
    return { ...existing, alreadyRunning: true }
  }

  const jobId = newJobId()
  const job = {
    jobId,
    date,
    status: 'queued',
    progress: 'Queued',
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    report: null,
  }
  jobs.set(jobId, job)
  activeJobByDate.set(date, jobId)

  setImmediate(() => {
    void runJob(jobId)
  })

  return serializeJob(job)
}

async function runJob(jobId) {
  const job = jobs.get(jobId)
  if (!job) return
  job.status = 'running'
  job.progress = 'Loading Zoho sales, returns, and expenses…'
  try {
    job.report = await buildEcommerceSummaryReport({ date: job.date })
    job.status = 'completed'
    job.progress = 'Done'
    job.completedAt = new Date().toISOString()
  } catch (err) {
    job.status = 'failed'
    job.progress = 'Failed'
    job.error = err?.message || String(err)
    job.completedAt = new Date().toISOString()
    console.error('[ecommerceSummaryJob]', job.date, err)
  } finally {
    if (activeJobByDate.get(job.date) === jobId) activeJobByDate.delete(job.date)
  }
}

module.exports = {
  startSummaryJob,
  getSummaryJob,
  getActiveSummaryJob,
}
