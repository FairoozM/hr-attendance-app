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
 * Refresh pulls each channel's own integration for the selected UAE day and
 * then re-queries the report. Providers are settled independently so one
 * failing marketplace never blocks the others.
 *
 * - Amazon UAE/KSA: SP-API orders sync (`amazonOrdersSyncService`)
 * - Noon: no order API exists; statements are imported through payment clearing
 * - Life Smile: read-only live query against the website database, nothing to sync
 * - Amazon ads: re-fetched while building the report
 */
async function refreshDailyEcommerceReport(req, res) {
  try {
    const date = req.body?.date || req.query.date
      ? String(req.body?.date || req.query.date).trim()
      : todayUaeYmd()
    assertYmd(date)

    const skipAmazon = String(req.body?.sync_amazon ?? req.query.sync_amazon ?? '1') === '0'
    const { dubaiDayBounds } = require('../services/dailyEcommerceReport/dateBounds')
    const bounds = dubaiDayBounds(date)

    /** @type {Record<string, unknown>} */
    const sync = {}

    const tasks = []
    if (!skipAmazon) {
      const { syncAmazonOrders } = require('../services/amazonOrdersSyncService')
      for (const mk of ['uae', 'ksa']) {
        tasks.push(
          (async () => {
            const createdBefore = new Date(
              Math.max(bounds.start.getTime() + 1000, bounds.end.getTime() - 1),
            )
            const result = await syncAmazonOrders({
              marketplaceKey: mk,
              createdAfter: bounds.start,
              createdBefore,
              includeItems: true,
            })
            return [
              `amazon_${mk}`,
              {
                status: result?.skipped ? 'skipped' : 'ok',
                ordersFetched: result?.ordersFetched ?? null,
                ordersSaved: result?.ordersSaved ?? null,
                orderItemsFetched: result?.orderItemsFetched ?? null,
                message: result?.message,
              },
            ]
          })().catch((err) => [
            `amazon_${mk}`,
            {
              status: 'error',
              code: err && err.code ? err.code : undefined,
              message: err && err.message ? err.message : String(err),
            },
          ]),
        )
      }
    } else {
      sync.amazon_uae = { status: 'skipped', message: 'sync_amazon=0' }
      sync.amazon_ksa = { status: 'skipped', message: 'sync_amazon=0' }
    }

    tasks.push(
      (async () => {
        const websiteDb = require('../db/lifesmileWebsiteDb')
        if (!websiteDb.isConfigured()) {
          return ['life_smile', { status: 'not_configured', message: `${websiteDb.ENV_VAR} is unset` }]
        }
        const health = await websiteDb.checkHealth()
        return ['life_smile', { status: health?.ok === false ? 'error' : 'ok', ...health }]
      })().catch((err) => [
        'life_smile',
        { status: 'error', message: err && err.message ? err.message : String(err) },
      ]),
    )

    const settled = await Promise.allSettled(tasks)
    for (const entry of settled) {
      if (entry.status !== 'fulfilled') continue
      const [key, value] = entry.value
      sync[key] = value
    }
    sync.noon = {
      status: 'not_supported',
      message:
        'Noon has no order API in this application; Noon order data arrives through imported Noon settlement statements.',
    }

    const report = await buildDailyEcommerceReport({ date, includeLiveAds: true })
    return res.json({ sync, report })
  } catch (err) {
    if (err && err.code === 'BAD_REQUEST') {
      return res.status(400).json({ error: err.message })
    }
    console.error('[dailyEcommerceReport] refreshDailyEcommerceReport:', err)
    return res
      .status(500)
      .json({ error: `Failed to refresh daily ecommerce report: ${err.message || String(err)}` })
  }
}

module.exports = {
  getDailyEcommerceReport,
  exportDailyEcommerceReportXlsx,
  refreshDailyEcommerceReport,
}
