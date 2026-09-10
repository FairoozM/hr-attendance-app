'use strict'

/**
 * Amazon flat-file order report → `amazon_order_report_lines`.
 *
 * Why this exists alongside the Orders API sync: while an order is `Pending` (Amazon has not yet
 * cleared the buyer's payment) `getOrders` omits `OrderTotal` and `getOrderItems` omits every money
 * field, so a same-day report built only from the Orders API silently loses those orders' value.
 * The `GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL` report publishes `item-price` for the
 * very same orders immediately, which makes it the authoritative money source for a fresh day.
 *
 * Verified against Amazon UAE for 2026-09-09: for every order where the Orders API does report
 * `OrderTotal`, the report's line composition equals it exactly, and the seven orders it withheld
 * are the AED 1,105.00 the report had all along.
 *
 * Read-only against Amazon; the only writes are to our own cache tables.
 */

const {
  marketplaceIdForKey,
  createAmazonOrdersReport,
  listAmazonReports,
  getAmazonReport,
  getAmazonReportDocument,
  downloadAmazonReportDocument,
  throwAmazonSpApiIfFailed,
  AMAZON_ALL_ORDERS_REPORT_TYPE,
} = require('./amazonSpApiService')
const cacheStore = require('./amazonOrdersCacheStore')

/** `amazon_sync_log.sync_type` for this sync, so coverage is tracked separately from the Orders API sync. */
const ORDER_REPORT_SYNC_TYPE = 'orders_report'

const REPORT_POLL_INTERVAL_MS = 5_000
const REPORT_TIMEOUT_MS = 4 * 60_000
/**
 * Amazon throttles `createReport` to roughly one call per minute. A refresh pressed twice in a row
 * would hit that, so a DONE report for the exact same window created this recently is reused.
 */
const REPORT_REUSE_MAX_AGE_MS = 10 * 60_000

/** Report columns that add to what the customer pays. */
const CHARGE_COLUMNS = [
  'item-price',
  'item-tax',
  'shipping-price',
  'shipping-tax',
  'gift-wrap-price',
  'gift-wrap-tax',
]
/** Report columns that reduce it. */
const CREDIT_COLUMNS = ['item-promotion-discount', 'ship-promotion-discount']

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clean(value) {
  return String(value == null ? '' : value).trim()
}

/** Blank cells are genuinely absent, not zero, so they must not turn into a 0 that hides a gap. */
function optionalNumber(value) {
  const text = clean(value)
  if (!text) return null
  const n = Number(text.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

function parseReportDate(value) {
  const text = clean(value)
  if (!text) return null
  const d = new Date(text)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Parses the tab-separated order report.
 *
 * Throws on a missing `amazon-order-id` column rather than returning an empty list: an unreadable
 * report must surface as an error, not as a day with no money.
 *
 * @param {string} text
 * @returns {object[]}
 */
function parseAllOrdersReport(text) {
  const lines = String(text == null ? '' : text)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
  if (lines.length === 0) return []

  const headers = lines[0].split('\t').map((h) => clean(h).toLowerCase())
  if (!headers.includes('amazon-order-id')) {
    const err = new Error(
      `Amazon order report is missing the amazon-order-id column (got: ${headers.slice(0, 8).join(', ')})`,
    )
    err.code = 'AMAZON_ORDER_REPORT_UNRECOGNISED'
    throw err
  }

  const index = new Map(headers.map((h, i) => [h, i]))
  const cellOf = (cells, name) => {
    const i = index.get(name)
    return i == null ? '' : clean(cells[i])
  }

  const out = []
  for (const line of lines.slice(1)) {
    const cells = line.split('\t')
    const amazonOrderId = cellOf(cells, 'amazon-order-id')
    if (!amazonOrderId) continue

    let charges = 0
    let credits = 0
    let sawMoney = false
    for (const col of CHARGE_COLUMNS) {
      const v = optionalNumber(cellOf(cells, col))
      if (v == null) continue
      sawMoney = true
      charges += v
    }
    for (const col of CREDIT_COLUMNS) {
      const v = optionalNumber(cellOf(cells, col))
      if (v == null) continue
      sawMoney = true
      credits += v
    }

    out.push({
      amazonOrderId,
      // Amazon repeats the order id per line, so the order-item id is what keeps two lines of the
      // same order apart. Older report rows can omit it; the SKU then acts as the line key.
      orderItemId: cellOf(cells, 'order-item-id') || cellOf(cells, 'sku'),
      purchaseDate: parseReportDate(cellOf(cells, 'purchase-date')),
      orderStatus: cellOf(cells, 'order-status') || null,
      itemStatus: cellOf(cells, 'item-status') || null,
      sellerSku: cellOf(cells, 'sku') || null,
      asin: cellOf(cells, 'asin') || null,
      quantity: optionalNumber(cellOf(cells, 'quantity')),
      currency: cellOf(cells, 'currency').toUpperCase() || null,
      itemPrice: optionalNumber(cellOf(cells, 'item-price')),
      itemTax: optionalNumber(cellOf(cells, 'item-tax')),
      shippingPrice: optionalNumber(cellOf(cells, 'shipping-price')),
      shippingTax: optionalNumber(cellOf(cells, 'shipping-tax')),
      giftWrapPrice: optionalNumber(cellOf(cells, 'gift-wrap-price')),
      giftWrapTax: optionalNumber(cellOf(cells, 'gift-wrap-tax')),
      itemPromotionDiscount: optionalNumber(cellOf(cells, 'item-promotion-discount')),
      shipPromotionDiscount: optionalNumber(cellOf(cells, 'ship-promotion-discount')),
      // Null, not zero, when Amazon reported no money on the line at all.
      lineAmount: sawMoney ? round2(charges - credits) : null,
    })
  }
  return out
}

/** Amazon uses second precision on report windows, so compare on the same shape. */
function windowKey(value) {
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * A DONE report for exactly this window, recent enough to trust, so a repeated Refresh does not run
 * into Amazon's `createReport` rate limit.
 */
async function findReusableReport(marketplaceKey, dataStartTime, dataEndTime) {
  const wantStart = windowKey(dataStartTime)
  const wantEnd = windowKey(dataEndTime)
  const list = await listAmazonReports({
    marketplaceKey,
    reportTypes: [AMAZON_ALL_ORDERS_REPORT_TYPE],
    processingStatuses: ['DONE'],
    marketplaceIds: [marketplaceIdForKey(marketplaceKey)],
    createdSince: new Date(Date.now() - REPORT_REUSE_MAX_AGE_MS).toISOString(),
    pageSize: 100,
  })
  if (list.status < 200 || list.status >= 300) return null
  for (const report of list.data?.reports || []) {
    if (windowKey(report.dataStartTime) !== wantStart) continue
    if (windowKey(report.dataEndTime) !== wantEnd) continue
    if (!report.reportDocumentId) continue
    return { reportId: report.reportId, reportDocumentId: report.reportDocumentId, reused: true }
  }
  return null
}

async function waitForReport(marketplaceKey, reportId) {
  const deadline = Date.now() + REPORT_TIMEOUT_MS
  let polls = 0
  while (Date.now() < deadline) {
    await sleep(REPORT_POLL_INTERVAL_MS)
    polls += 1
    const status = await getAmazonReport(reportId, { marketplaceKey })
    throwAmazonSpApiIfFailed(status, 'getOrdersReport', marketplaceKey)
    const processingStatus = String(status.data?.processingStatus || '').toUpperCase()
    if (processingStatus === 'DONE') {
      return { reportDocumentId: status.data?.reportDocumentId || null, polls }
    }
    if (processingStatus === 'FATAL' || processingStatus === 'CANCELLED') {
      const err = new Error(`Amazon order report ${reportId} ended as ${processingStatus}`)
      err.code = 'AMAZON_ORDER_REPORT_FAILED'
      throw err
    }
  }
  const err = new Error(
    `Amazon order report ${reportId} did not finish within ${Math.round(REPORT_TIMEOUT_MS / 1000)}s`,
  )
  err.code = 'AMAZON_ORDER_REPORT_TIMEOUT'
  throw err
}

async function downloadReport(marketplaceKey, reportDocumentId) {
  const doc = await getAmazonReportDocument(reportDocumentId, { marketplaceKey })
  throwAmazonSpApiIfFailed(doc, 'getOrdersReportDocument', marketplaceKey)
  const download = await downloadAmazonReportDocument(doc.data?.url, {
    marketplaceKey,
    compressionAlgorithm: doc.data?.compressionAlgorithm,
  })
  if (download.status < 200 || download.status >= 300) {
    throwAmazonSpApiIfFailed(download, 'downloadOrdersReportDocument', marketplaceKey)
  }
  return typeof download.data === 'string' ? download.data : String(download.data ?? '')
}

/**
 * Pulls the order report for one purchase-date window and caches its lines.
 *
 * The sync is logged in `amazon_sync_log` under `orders_report`, so the report can tell a day with
 * genuinely no report money from a day the report was never asked about.
 *
 * @param {{ marketplaceKey: 'uae'|'ksa', dataStartTime: Date, dataEndTime: Date }} params
 */
async function syncAmazonOrderReport({ marketplaceKey, dataStartTime, dataEndTime } = {}) {
  const mk = String(marketplaceKey || 'uae').toLowerCase() === 'ksa' ? 'ksa' : 'uae'
  const start = dataStartTime instanceof Date ? dataStartTime : new Date(dataStartTime)
  const end = dataEndTime instanceof Date ? dataEndTime : new Date(dataEndTime)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    const err = new Error('syncAmazonOrderReport needs a valid dataStartTime before dataEndTime')
    err.code = 'AMAZON_REPORT_WINDOW_INVALID'
    throw err
  }

  const logId = await cacheStore.insertSyncLog({
    syncType: ORDER_REPORT_SYNC_TYPE,
    marketplaceKey: mk,
    status: 'running',
    createdAfter: start,
    createdBefore: end,
    metadata: { reportType: AMAZON_ALL_ORDERS_REPORT_TYPE },
  })

  try {
    let reportId = null
    let reportDocumentId = null
    let reused = false
    let polls = 0

    const reusable = await findReusableReport(mk, start, end).catch(() => null)
    if (reusable) {
      reportId = reusable.reportId
      reportDocumentId = reusable.reportDocumentId
      reused = true
    } else {
      const created = await createAmazonOrdersReport({
        marketplaceKey: mk,
        dataStartTime: start,
        dataEndTime: end,
      })
      throwAmazonSpApiIfFailed(created, 'createOrdersReport', mk)
      reportId = created.data?.reportId || null
      if (!reportId) {
        const err = new Error('Amazon accepted the order report request but returned no reportId')
        err.code = 'AMAZON_ORDER_REPORT_NO_ID'
        throw err
      }
      const finished = await waitForReport(mk, reportId)
      reportDocumentId = finished.reportDocumentId
      polls = finished.polls
    }

    // A DONE report with no document is Amazon's way of saying the window held no orders. That is a
    // real, successful answer: record it so the day reads as empty rather than never asked.
    const text = reportDocumentId ? await downloadReport(mk, reportDocumentId) : ''
    const lines = parseAllOrdersReport(text)
    const { saved, removed } = await cacheStore.replaceOrderReportLines(
      mk,
      { start, end },
      lines,
      reportId,
    )

    const uniqueOrders = new Set(lines.map((l) => l.amazonOrderId)).size
    const linesWithoutMoney = lines.filter((l) => l.lineAmount == null).length

    await cacheStore.updateSyncLogById(logId, {
      status: 'success',
      finishedAt: new Date(),
      ordersFetched: uniqueOrders,
      orderItemsFetched: lines.length,
      metadata: {
        reportType: AMAZON_ALL_ORDERS_REPORT_TYPE,
        reportId,
        reused,
        polls,
        rowsParsed: lines.length,
        rowsSaved: saved,
        rowsRemoved: removed,
        linesWithoutMoney,
      },
    })

    return {
      marketplaceKey: mk,
      reportId,
      reused,
      polls,
      rowsParsed: lines.length,
      rowsSaved: saved,
      rowsRemoved: removed,
      uniqueOrders,
      linesWithoutMoney,
    }
  } catch (err) {
    await cacheStore
      .updateSyncLogById(logId, {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: err && err.message ? err.message : String(err),
      })
      .catch(() => {})
    throw err
  }
}

/**
 * Did a successful order-report sync cover this whole window? Used to tell "the report says this day
 * has no extra money" from "the report was never pulled for this day".
 */
async function findSuccessfulReportRunCoveringRange(marketplaceKey, start, end) {
  return cacheStore.findSuccessfulSyncCoveringRange(
    marketplaceKey,
    start,
    end,
    ORDER_REPORT_SYNC_TYPE,
  )
}

module.exports = {
  syncAmazonOrderReport,
  parseAllOrdersReport,
  findSuccessfulReportRunCoveringRange,
  ORDER_REPORT_SYNC_TYPE,
  CHARGE_COLUMNS,
  CREDIT_COLUMNS,
}
