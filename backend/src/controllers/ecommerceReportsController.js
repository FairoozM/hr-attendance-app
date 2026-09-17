'use strict'

const {
  buildDailyEcommerceLedger,
} = require('../services/ecommerceLedger/dailyEcommerceLedgerService')
const {
  startLedgerJob,
  getLedgerJob,
} = require('../services/ecommerceLedger/dailyEcommerceLedgerJobService')
const {
  buildEcommerceSummaryReport,
} = require('../services/ecommerceSummary/ecommerceSummaryService')
const { assertYmd, todayUaeYmd } = require('../services/ecommerceAccounting/accountNature')

function resolveDate(req) {
  const raw = String(req.query?.date || req.body?.date || '').trim()
  if (!raw) return todayUaeYmd()
  return assertYmd(raw)
}

/**
 * Synchronous build — fine for scripts / local probes.
 * The UI must use startDailyEcommerceLedger + poll (CloudFront ~30s).
 */
async function getDailyEcommerceLedger(req, res) {
  try {
    const date = resolveDate(req)
    const report = await buildDailyEcommerceLedger({ date })
    return res.json(report)
  } catch (err) {
    const status = err.code === 'BAD_REQUEST' ? 400 : 500
    console.error('[dailyEcommerceLedger]', err)
    return res.status(status).json({
      error: err.message || 'Failed to build Daily Ecommerce Ledger',
      code: err.code || 'LEDGER_ERROR',
    })
  }
}

/**
 * Start a background ledger build and return immediately (202).
 * UI polls getDailyEcommerceLedgerJob until status is completed/failed.
 */
async function startDailyEcommerceLedger(req, res) {
  try {
    const date = resolveDate(req)
    const job = startLedgerJob({ date })
    return res.status(202).json(job)
  } catch (err) {
    const status = err.code === 'BAD_REQUEST' ? 400 : 500
    console.error('[dailyEcommerceLedger] start', err)
    return res.status(status).json({
      error: err.message || 'Failed to start Daily Ecommerce Ledger build',
      code: err.code || 'LEDGER_JOB_START_ERROR',
    })
  }
}

async function getDailyEcommerceLedgerJob(req, res) {
  try {
    const job = getLedgerJob(req.params.jobId)
    if (!job) {
      return res.status(404).json({
        error: 'Ledger job not found — it may have expired. Try again.',
        code: 'LEDGER_JOB_NOT_FOUND',
      })
    }
    return res.json(job)
  } catch (err) {
    console.error('[dailyEcommerceLedger] job status', err)
    return res.status(500).json({ error: 'Failed to read ledger job status' })
  }
}

async function getEcommerceSummaryReport(req, res) {
  try {
    const date = resolveDate(req)
    const report = await buildEcommerceSummaryReport({ date })
    return res.json(report)
  } catch (err) {
    const status = err.code === 'BAD_REQUEST' ? 400 : 500
    console.error('[ecommerceSummary]', err)
    return res.status(status).json({
      error: err.message || 'Failed to build Ecommerce Summary Report',
      code: err.code || 'SUMMARY_ERROR',
    })
  }
}

module.exports = {
  getDailyEcommerceLedger,
  startDailyEcommerceLedger,
  getDailyEcommerceLedgerJob,
  getEcommerceSummaryReport,
}
