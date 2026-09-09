'use strict'

const { buildDailyEcommerceReport } = require('../services/dailyEcommerceReport/dailyEcommerceReportService')
const { buildDailyEcommerceReportXlsxBuffer } = require('../services/dailyEcommerceReport/dailyEcommerceReportXlsxService')
const { assertYmd, todayUaeYmd } = require('../services/dailyEcommerceReport/dateBounds')

/** How far past the report date a Noon settlement statement is still worth asking for. */
const FINANCE_LOOKAHEAD_DAYS = 45

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
 * - Amazon UAE/KSA: SP-API orders sync, every NextToken page, items included
 * - Noon: OMS orders export plus the finance item-level transaction report, both through the
 *   Noon Partner API (`noonOrdersExportService`)
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
            // An explicit Refresh must re-read the day even if a sync ran minutes ago: Amazon
            // withholds OrderTotal while an order is Pending, so the cached amount for a fresh
            // order is only correct after Amazon authorises it and we ask again.
            const result = await syncAmazonOrders({
              marketplaceKey: mk,
              createdAfter: bounds.start,
              createdBefore,
              includeItems: true,
              force: true,
              forceAllowed: true,
            })
            return [
              `amazon_${mk}`,
              {
                status: result?.skipped ? 'skipped' : 'ok',
                ordersFetched: result?.ordersFetched ?? null,
                ordersSaved: result?.ordersSaved ?? null,
                orderItemsFetched: result?.orderItemsFetched ?? null,
                pagesFetched: result?.pagesFetched ?? null,
                truncated: result?.truncated ?? null,
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

    const skipNoon = String(req.body?.sync_noon ?? req.query.sync_noon ?? '1') === '0'
    if (!skipNoon) {
      tasks.push(
        (async () => {
          const { syncNoonOrders } = require('../services/noon/noonOrdersExportService')
          // Noon filters the export by order date in its own calendar, so ask for the day before
          // and after as well and let `order_placed_at` decide inclusion precisely.
          const dayBefore = new Date(bounds.start.getTime() - 24 * 60 * 60 * 1000)
          const result = await syncNoonOrders({
            fromYmd: dayBefore.toISOString().slice(0, 10),
            toYmd: bounds.dateYmd,
          })
          return [
            'noon',
            {
              status: 'ok',
              exportCategoryCode: result.exportCategoryCode,
              exportCode: result.exportCode,
              pollCount: result.pollCount,
              rowsParsed: result.rowsParsed,
              rowsSaved: result.rowsSaved,
              uniqueOrders: result.uniqueOrders,
              linesByCountry: result.linesByCountry,
            },
          ]
        })().catch((err) => [
          'noon',
          {
            status: err && err.code === 'NOON_NOT_CONFIGURED' ? 'not_configured' : 'error',
            code: err && err.code ? err.code : undefined,
            message: err && err.message ? err.message : String(err),
          },
        ]),
      )
      tasks.push(
        (async () => {
          const { syncNoonFinance } = require('../services/noon/noonOrdersExportService')
          // Noon publishes an order's proceeds and fees only when the order reaches a settlement
          // statement, days later, and the finance export is filtered by that statement date. So
          // ask for every statement from the report date up to today (capped) and let the order
          // number decide which order each row belongs to.
          const todayMs = Date.now()
          const windowEndMs = Math.min(
            todayMs,
            bounds.start.getTime() + FINANCE_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
          )
          const result = await syncNoonFinance({
            fromYmd: bounds.dateYmd,
            toYmd: new Date(Math.max(bounds.start.getTime(), windowEndMs)).toISOString().slice(0, 10),
          })
          return [
            'noon_finance',
            {
              status: 'ok',
              exportCategoryCode: result.exportCategoryCode,
              exportCode: result.exportCode,
              fromDate: result.fromDate,
              toDate: result.toDate,
              pollCount: result.pollCount,
              rowsParsed: result.rowsParsed,
              rowsSaved: result.rowsSaved,
              ordersWithMoney: result.ordersWithMoney,
            },
          ]
        })().catch((err) => [
          'noon_finance',
          {
            status: err && err.code === 'NOON_NOT_CONFIGURED' ? 'not_configured' : 'error',
            code: err && err.code ? err.code : undefined,
            message: err && err.message ? err.message : String(err),
          },
        ]),
      )
    } else {
      sync.noon = { status: 'skipped', message: 'sync_noon=0' }
      sync.noon_finance = { status: 'skipped', message: 'sync_noon=0' }
    }

    tasks.push(
      (async () => {
        const websiteDb = require('../db/lifesmileWebsiteDb')
        if (!websiteDb.isConfigured()) {
          return ['life_smile', { status: 'not_configured', message: `${websiteDb.ENV_VAR} is unset` }]
        }
        const health = await websiteDb.checkHealth()
        if (!health.reachable) {
          return ['life_smile', { status: 'error', ...health }]
        }
        // Reaching the database is not the same as being allowed to read orders: the report role
        // is granted table by table, so probe the two tables the report needs and report the
        // real PostgreSQL error (42501 = permission denied) instead of a generic failure.
        let ordersReadable = null
        let ordersError = null
        try {
          const probe = await websiteDb.readQuery(
            `SELECT (SELECT COUNT(*) FROM orders WHERE created_at >= $1 AND created_at < $2) AS orders,
                    (SELECT COUNT(*) FROM cart_items WHERE created_at >= $1 AND created_at < $2) AS cart_items`,
            [bounds.start, bounds.end],
          )
          ordersReadable = true
          return [
            'life_smile',
            {
              status: 'ok',
              ...health,
              ordersReadable,
              ordersInWindow: Number(probe.rows[0]?.orders ?? 0),
              cartItemsInWindow: Number(probe.rows[0]?.cart_items ?? 0),
            },
          ]
        } catch (err) {
          ordersReadable = false
          ordersError = [err.pgCode ? `SQLSTATE ${err.pgCode}` : null, err.message]
            .filter(Boolean)
            .join(': ')
          return ['life_smile', { status: 'error', ...health, ordersReadable, message: ordersError }]
        }
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
