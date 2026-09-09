'use strict'

const { buildDailyEcommerceReport } = require('../services/dailyEcommerceReport/dailyEcommerceReportService')
const { buildDailyEcommerceReportXlsxBuffer } = require('../services/dailyEcommerceReport/dailyEcommerceReportXlsxService')
const { assertYmd, todayUaeYmd } = require('../services/dailyEcommerceReport/dateBounds')

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
 * Refresh rebuilds from stored Zoho invoices + website DB.
 * Does NOT trigger Amazon SP-API sync (that was hanging the Sync button).
 * Pass sync_amazon=1 only when an explicit marketplace sync is requested.
 */
async function refreshDailyEcommerceReport(req, res) {
  try {
    const date = req.body?.date || req.query.date
      ? String(req.body?.date || req.query.date).trim()
      : todayUaeYmd()
    assertYmd(date)

    const syncAmazon =
      String(req.body?.sync_amazon || req.query.sync_amazon || '0') === '1'
    const syncResults = { amazon_uae: null, amazon_ksa: null, skipped: !syncAmazon }

    if (syncAmazon) {
      const { dubaiDayBounds } = require('../services/dailyEcommerceReport/dateBounds')
      const bounds = dubaiDayBounds(date)
      const { syncAmazonOrders } = require('../services/amazonOrdersSyncService')
      for (const mk of ['uae', 'ksa']) {
        try {
          const createdBefore = new Date(
            Math.max(bounds.start.getTime() + 1000, bounds.end.getTime() - 1),
          )
          // eslint-disable-next-line no-await-in-loop
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
    }

    const report = await buildDailyEcommerceReport({ date, includeLiveAds: true })
    return res.json({ sync: syncResults, report })
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
