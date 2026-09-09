'use strict'

const { buildDailyEcommerceReport } = require('../services/dailyEcommerceReport/dailyEcommerceReportService')
const { buildDailyEcommerceReportXlsxBuffer } = require('../services/dailyEcommerceReport/dailyEcommerceReportXlsxService')
const { assertYmd, todayUaeYmd, dubaiDayBounds } = require('../services/dailyEcommerceReport/dateBounds')

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
 * Refresh: optionally sync Amazon orders for the report day (both marketplaces),
 * then rebuild the report. Website/shop are live reads — no sync needed.
 */
async function refreshDailyEcommerceReport(req, res) {
  try {
    const date = req.body?.date || req.query.date
      ? String(req.body?.date || req.query.date).trim()
      : todayUaeYmd()
    assertYmd(date)
    const bounds = dubaiDayBounds(date)
    const syncResults = { amazon_uae: null, amazon_ksa: null }

    try {
      const { syncAmazonOrders } = require('../services/amazonOrdersSyncService')
      for (const mk of ['uae', 'ksa']) {
        try {
          // eslint-disable-next-line no-await-in-loop
          // SP-API window is inclusive-ish; use end-1ms so createdBefore > createdAfter
          const createdBefore = new Date(Math.max(bounds.start.getTime() + 1000, bounds.end.getTime() - 1))
          const result = await syncAmazonOrders({
            marketplaceKey: mk,
            createdAfter: bounds.start,
            createdBefore,
          })
          syncResults[`amazon_${mk}`] = {
            status: 'ok',
            ordersFetched: result?.ordersFetched ?? result?.orders_fetched ?? null,
          }
        } catch (err) {
          syncResults[`amazon_${mk}`] = {
            status: 'error',
            message: err && err.message ? err.message : String(err),
            code: err && err.code ? err.code : undefined,
          }
        }
      }
    } catch (err) {
      syncResults.amazon_uae = { status: 'error', message: err.message }
      syncResults.amazon_ksa = { status: 'error', message: err.message }
    }

    const report = await buildDailyEcommerceReport({ date, includeLiveAds: true })
    return res.json({
      sync: syncResults,
      report,
    })
  } catch (err) {
    if (err && err.code === 'BAD_REQUEST') {
      return res.status(400).json({ error: err.message })
    }
    console.error('[dailyEcommerceReport] refreshDailyEcommerceReport:', err)
    return res.status(500).json({ error: 'Failed to refresh daily ecommerce report' })
  }
}

module.exports = {
  getDailyEcommerceReport,
  exportDailyEcommerceReportXlsx,
  refreshDailyEcommerceReport,
}
