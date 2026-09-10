'use strict'

const { buildDailyEcommerceReport } = require('../services/dailyEcommerceReport/dailyEcommerceReportService')
const { buildDailyEcommerceReportXlsxBuffer } = require('../services/dailyEcommerceReport/dailyEcommerceReportXlsxService')
const { assertYmd, todayUaeYmd } = require('../services/dailyEcommerceReport/dateBounds')
const {
  startRefreshJob,
  getRefreshJob,
} = require('../services/dailyEcommerceReport/dailyEcommerceRefreshJobService')

async function getDailyEcommerceReport(req, res) {
  try {
    const date = req.query.date ? String(req.query.date).trim() : todayUaeYmd()
    assertYmd(date)
    const includeLiveAds = String(req.query.include_live_ads || '1') !== '0'
    const report = await buildDailyEcommerceReport({ date, includeLiveAds })
    return res.json(report)
  } catch (err) {
    if (err && err.code === 'BAD_REQUEST') {
      return res.status(400).json({ error: err.message })
    }
    console.error('[dailyEcommerceReport] getDailyEcommerceReport:', err)
    return res.status(500).json({ error: 'Failed to build daily ecommerce report' })
  }
}

async function exportDailyEcommerceReportXlsx(req, res) {
  try {
    const date = req.query.date ? String(req.query.date).trim() : todayUaeYmd()
    assertYmd(date)
    const includeLiveAds = String(req.query.include_live_ads || '1') !== '0'
    const report = await buildDailyEcommerceReport({ date, includeLiveAds })
    const buffer = await buildDailyEcommerceReportXlsxBuffer(report)
    const filename = `daily-ecommerce-report-${date}.xlsx`
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(buffer)
  } catch (err) {
    if (err && err.code === 'BAD_REQUEST') {
      return res.status(400).json({ error: err.message })
    }
    console.error('[dailyEcommerceReport] exportDailyEcommerceReportXlsx:', err)
    return res.status(500).json({ error: 'Failed to export daily ecommerce report' })
  }
}

/**
 * Refresh pulls each channel's own integration for the selected UAE day and then re-queries the
 * report. The Noon order and finance feeds are export jobs that have to be created and polled, so
 * the whole pass runs well past the 30s CloudFront origin timeout in front of this API: this
 * handler starts a background job and answers immediately with its id, and the page polls
 * `GET /daily-ecommerce/refresh/:jobId` for the finished report.
 */
async function refreshDailyEcommerceReport(req, res) {
  try {
    const date = req.body?.date || req.query.date
      ? String(req.body?.date || req.query.date).trim()
      : todayUaeYmd()
    assertYmd(date)

    const skipAmazon = String(req.body?.sync_amazon ?? req.query.sync_amazon ?? '1') === '0'
    const skipNoon = String(req.body?.sync_noon ?? req.query.sync_noon ?? '1') === '0'

    const job = startRefreshJob({ date, skipAmazon, skipNoon })
    return res.status(202).json(job)
  } catch (err) {
    if (err && err.code === 'BAD_REQUEST') {
      return res.status(400).json({ error: err.message })
    }
    console.error('[dailyEcommerceReport] refreshDailyEcommerceReport:', err)
    return res
      .status(500)
      .json({ error: `Failed to start daily ecommerce refresh: ${err.message || String(err)}` })
  }
}

/**
 * Status for a refresh started by `refreshDailyEcommerceReport`. While the job runs this returns
 * the per-integration progress; once it completes it also carries `sync` and the rebuilt `report`,
 * so the page never has to issue a second report request.
 */
async function getDailyEcommerceRefreshStatus(req, res) {
  try {
    const job = getRefreshJob(req.params.jobId)
    if (!job) {
      return res.status(404).json({
        error: 'Refresh job not found — it may have expired. Press Refresh again.',
        code: 'REFRESH_JOB_NOT_FOUND',
      })
    }
    return res.json(job)
  } catch (err) {
    console.error('[dailyEcommerceReport] getDailyEcommerceRefreshStatus:', err)
    return res.status(500).json({ error: 'Failed to read refresh job status' })
  }
}

module.exports = {
  getDailyEcommerceReport,
  exportDailyEcommerceReportXlsx,
  refreshDailyEcommerceReport,
  getDailyEcommerceRefreshStatus,
}
