'use strict'

/**
 * Background build for Daily Ecommerce Ledger (CloudFront-safe).
 * Full Zoho bank history + invoices routinely exceeds the 25–30s edge timeout,
 * so the API starts a job and the page polls for the finished report.
 */

const crypto = require('crypto')
const { assertYmd, todayUaeYmd } = require('../ecommerceAccounting/accountNature')
const { buildDailyEcommerceLedger } = require('./dailyEcommerceLedgerService')

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

function getLedgerJob(jobId) {
  pruneFinishedJobs()
  return serializeJob(jobs.get(String(jobId || '').trim()))
}

function getActiveLedgerJob(date) {
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

/**
 * Start (or join) a ledger build for a UAE calendar date.
 * @returns {object} serialized job
 */
function startLedgerJob(opts = {}) {
  pruneFinishedJobs()
  const date = assertYmd(opts.date || todayUaeYmd())
  const existing = getActiveLedgerJob(date)
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
  job.progress = 'Loading Zoho sales, expenses, and account ledgers…'
  try {
    job.report = await buildDailyEcommerceLedger({ date: job.date })
    job.status = 'completed'
    job.progress = 'Done'
    job.completedAt = new Date().toISOString()
  } catch (err) {
    job.status = 'failed'
    job.progress = 'Failed'
    job.error = err?.message || String(err)
    job.completedAt = new Date().toISOString()
    console.error('[dailyEcommerceLedgerJob]', job.date, err)
  } finally {
    if (activeJobByDate.get(job.date) === jobId) activeJobByDate.delete(job.date)
  }
}

module.exports = {
  startLedgerJob,
  getLedgerJob,
  getActiveLedgerJob,
}
