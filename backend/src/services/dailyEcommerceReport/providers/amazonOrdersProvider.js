'use strict'

/**
 * Amazon UAE / KSA orders for the Daily Ecommerce Report.
 *
 * Source chain: Amazon SP-API → `amazon_orders` / `amazon_order_items`
 * (written only by `amazonOrdersSyncService`) → report.
 *
 * Order money comes from `OrderTotal` where Amazon publishes it. While an order is `Pending` Amazon
 * withholds `OrderTotal` *and* every item money field from the Orders API, so those orders fall back
 * to Amazon's own flat-file order report (`amazon_order_report_lines`), which does carry their price
 * from the moment the order is placed. On 2026-09-09 UAE that was the difference between AED 1,306
 * (Orders API only) and the true AED 2,411.
 *
 * Order numbers are the real Amazon order IDs (123-1234567-1234567) and the
 * marketplace split uses `marketplace_key` / `marketplace_id` from SP-API.
 *
 * Commission and fulfillment come from Amazon settlement rows
 * (`amazon_payment_clearing_rows`, Amazon Reports API or Seller Central
 * settlement export). When Amazon has not settled the day yet the values stay
 * null so the report can show "Pending" instead of a fake zero.
 */

const { query } = require('../../../db')
const { computeChannelFinancials } = require('../formulas')
const { round2, toAed, toFiniteNumber } = require('../money')
const { buildChannelShell, channelMeta } = require('../channels')

const EXCLUDED_STATUSES = new Set(['canceled', 'cancelled'])
const FEE_CATEGORIES = ['Commission', 'FBA / Fulfillment Fee']

/** Amazon-reported line components that add to what the customer pays. */
const ITEM_CHARGE_KEYS = ['ItemPrice', 'ItemTax', 'ShippingPrice', 'ShippingTax']
/** Amazon-reported line components that reduce it. */
const ITEM_CREDIT_KEYS = [
  'PromotionDiscount',
  'PromotionDiscountTax',
  'ShippingDiscount',
  'ShippingDiscountTax',
]

function moneyAmount(node) {
  if (!node || typeof node !== 'object') return null
  const raw = node.Amount
  if (raw == null || raw === '') return null
  const n = typeof raw === 'string' ? Number(raw.replace(/,/g, '')) : Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Rebuild one order's customer-paid value from its Amazon line items.
 *
 * `ItemPrice.Amount` is already the extended line total (unit price × quantity), so it is never
 * multiplied by quantity again. Returns null when Amazon reported no money on any line, which is
 * what happens while an order is Pending — that is unknown, not zero.
 *
 * @param {object[]} itemRows
 * @returns {{ amount: number, currency: string|null }|null}
 */
function deriveOrderAmountFromItems(itemRows) {
  let total = 0
  let currency = null
  let sawMoney = false
  for (const row of itemRows) {
    const raw = row.raw_safe_json && typeof row.raw_safe_json === 'object' ? row.raw_safe_json : {}
    for (const key of ITEM_CHARGE_KEYS) {
      const value = moneyAmount(raw[key])
      if (value == null) continue
      sawMoney = true
      total += value
      if (!currency && raw[key].CurrencyCode) currency = String(raw[key].CurrencyCode)
    }
    for (const key of ITEM_CREDIT_KEYS) {
      const value = moneyAmount(raw[key])
      if (value == null) continue
      sawMoney = true
      total -= value
    }
    if (!currency && row.item_currency_code) currency = String(row.item_currency_code)
  }
  if (!sawMoney) return null
  return { amount: round2(total), currency }
}

function metaForMarketplace(marketplaceKey) {
  return channelMeta(marketplaceKey === 'ksa' ? 'amazon_ksa' : 'amazon_uae')
}

async function loadOrderRows(marketplaceKey, bounds) {
  const res = await query(
    `SELECT
       o.amazon_order_id,
       o.marketplace_id,
       o.purchase_date,
       o.order_status,
       o.currency_code,
       o.order_amount,
       o.last_synced_at
     FROM amazon_orders o
     WHERE o.marketplace_key = $1
       AND o.purchase_date >= $2
       AND o.purchase_date < $3
     ORDER BY o.purchase_date ASC, o.amazon_order_id ASC`,
    [marketplaceKey, bounds.start, bounds.end],
  )
  return res.rows || []
}

/**
 * Was a successful SP-API orders sync run over this whole day? The sync stores its window as
 * [day start, day end − 1ms], so the end is compared with a one-second tolerance rather than
 * demanding an exact match.
 *
 * @param {'uae'|'ksa'} marketplaceKey
 * @param {{ start: Date, end: Date }} bounds
 */
async function findCoveringOrdersSync(marketplaceKey, bounds) {
  const cacheStore = require('../../amazonOrdersCacheStore')
  try {
    return await cacheStore.findSuccessfulSyncCoveringRange(
      marketplaceKey,
      bounds.start,
      new Date(bounds.end.getTime() - 1000),
    )
  } catch (err) {
    // The sync log is only used to tell "empty" from "never asked". If it cannot be read, say so
    // rather than silently choosing either answer.
    console.error(
      `[dailyEcommerceReport] amazon ${marketplaceKey} sync-log lookup failed:`,
      err,
    )
    return null
  }
}

/**
 * Amazon's flat-file order report, grouped per order.
 *
 * This is the only Amazon source that reports money for a `Pending` order, so it is what keeps a
 * same-day Amazon Amount honest. Returns null when the lookup itself fails, so the caller can warn
 * instead of quietly reporting a smaller day.
 *
 * @param {'uae'|'ksa'} marketplaceKey
 * @param {{ start: Date, end: Date }} bounds
 * @returns {Promise<{ byOrder: Map<string, { amount: number, currency: string|null, lines: object[], lastSyncedAt: Date|null }>, error: string|null }>}
 */
async function loadOrderReportAmounts(marketplaceKey, bounds) {
  const cacheStore = require('../../amazonOrdersCacheStore')
  /** @type {Map<string, { amount: number, currency: string|null, lines: object[], lastSyncedAt: Date|null }>} */
  const byOrder = new Map()
  let rows
  try {
    rows = await cacheStore.selectOrderReportLines(marketplaceKey, bounds.start, bounds.end)
  } catch (err) {
    console.error(
      `[dailyEcommerceReport] amazon ${marketplaceKey} order-report lookup failed:`,
      err,
    )
    return { byOrder, error: err && err.message ? err.message : String(err) }
  }
  for (const row of rows) {
    const orderId = String(row.amazon_order_id || '').trim()
    if (!orderId) continue
    if (!byOrder.has(orderId)) {
      byOrder.set(orderId, { amount: 0, currency: null, lines: [], lastSyncedAt: null })
    }
    const bucket = byOrder.get(orderId)
    bucket.amount += toFiniteNumber(row.line_amount, 0)
    if (!bucket.currency && row.currency) bucket.currency = String(row.currency).toUpperCase()
    bucket.lines.push(row)
    const syncedAt = row.last_synced_at ? new Date(row.last_synced_at) : null
    if (syncedAt && (!bucket.lastSyncedAt || syncedAt > bucket.lastSyncedAt)) {
      bucket.lastSyncedAt = syncedAt
    }
  }
  for (const bucket of byOrder.values()) bucket.amount = round2(bucket.amount)
  return { byOrder, error: null }
}

/**
 * Was Amazon's order report actually pulled for this day? Used only to word a warning correctly:
 * "Amazon reported no money" and "we never asked Amazon's report" are different problems.
 *
 * @param {'uae'|'ksa'} marketplaceKey
 * @param {{ start: Date, end: Date }} bounds
 */
async function findCoveringOrderReportRun(marketplaceKey, bounds) {
  try {
    const {
      findSuccessfulReportRunCoveringRange,
    } = require('../../amazonOrderReportSyncService')
    return await findSuccessfulReportRunCoveringRange(marketplaceKey, bounds.start, bounds.end)
  } catch (err) {
    console.error(
      `[dailyEcommerceReport] amazon ${marketplaceKey} order-report run lookup failed:`,
      err,
    )
    return null
  }
}

async function loadItemRows(marketplaceKey, orderIds) {
  if (!orderIds.length) return []
  const res = await query(
    `SELECT
       amazon_order_id,
       seller_sku,
       asin,
       quantity_ordered,
       item_amount,
       item_currency_code,
       raw_safe_json
     FROM amazon_order_items
     WHERE marketplace_key = $1
       AND amazon_order_id = ANY($2::text[])
     ORDER BY amazon_order_id, id`,
    [marketplaceKey, orderIds],
  )
  return res.rows || []
}

async function loadSettlementFees(orderIds, fallbackCurrency, fx) {
  /** @type {Map<string, { commission: number, fulfillment: number }>} */
  const map = new Map()
  if (!orderIds.length) return map
  const res = await query(
    `SELECT order_id, category, SUM(amount)::numeric AS amount_sum, MAX(currency) AS currency
     FROM amazon_payment_clearing_rows
     WHERE order_id = ANY($1::text[])
       AND category = ANY($2::text[])
     GROUP BY order_id, category`,
    [orderIds, FEE_CATEGORIES],
  )
  for (const row of res.rows || []) {
    const oid = String(row.order_id || '').trim()
    if (!oid) continue
    if (!map.has(oid)) map.set(oid, { commission: 0, fulfillment: 0 })
    const bucket = map.get(oid)
    const aed = toAed(
      Math.abs(toFiniteNumber(row.amount_sum, 0)),
      String(row.currency || fallbackCurrency),
      fx,
    )
    if (row.category === 'Commission') bucket.commission += aed
    else bucket.fulfillment += aed
  }
  return map
}

/**
 * @param {'uae'|'ksa'} marketplaceKey
 * @param {{ start: Date, end: Date, dateYmd: string }} bounds
 * @param {{ rate: number }} fx
 * @param {{ adSpendAED: number|null, clicks: number|null, adsStatus: string, adsProvider: string|null }} ads
 */
async function loadAmazonChannel(marketplaceKey, bounds, fx, ads) {
  const meta = metaForMarketplace(marketplaceKey)
  const warnings = []

  let orderRows
  try {
    orderRows = await loadOrderRows(marketplaceKey, bounds)
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    console.error(
      `[dailyEcommerceReport] ${meta.label} amazon_orders query failed:`,
      err,
    )
    return buildChannelShell(meta, 'unavailable', {
      dataSource: 'amazon_sp_api_orders_cache',
      warnings: [`${meta.label}: Data Error — ${message}`],
      adsStatus: ads.adsStatus,
      adsProvider: ads.adsProvider,
      summary: {
        ...buildChannelShell(meta, 'unavailable').summary,
        adSpendAED: ads.adSpendAED,
        clicks: ads.clicks,
        commissionAED: null,
        shippingAED: null,
      },
    })
  }

  const included = []
  const seen = new Set()
  for (const row of orderRows) {
    if (EXCLUDED_STATUSES.has(String(row.order_status || '').trim().toLowerCase())) continue
    const orderId = String(row.amazon_order_id || '').trim()
    if (!orderId || seen.has(orderId)) continue
    seen.add(orderId)
    included.push(row)
  }

  // An empty cache means one of two very different things, and reporting AED 0.00 for both would
  // claim a day was worth nothing when in fact Amazon was never asked about it. So check the sync
  // log: only a day that a successful orders sync actually covered can be reported as empty.
  if (!orderRows.length) {
    const covered = await findCoveringOrdersSync(marketplaceKey, bounds)
    if (!covered) {
      return buildChannelShell(meta, 'pending', {
        dataSource: 'amazon_sp_api_orders_cache',
        adsStatus: ads.adsStatus,
        adsProvider: ads.adsProvider,
        warnings: [
          `${meta.label}: no Amazon orders sync has covered ${bounds.dateYmd} yet, so the day is unknown rather than empty — press Refresh to pull it from SP-API`,
        ],
        summary: {
          ...buildChannelShell(meta, 'pending').summary,
          adSpendAED: ads.adSpendAED,
          clicks: ads.clicks,
        },
      })
    }
  }

  const orderIds = included.map((r) => String(r.amazon_order_id))

  const itemRows = await loadItemRows(marketplaceKey, orderIds)
  /** @type {Map<string, object[]>} */
  const itemsByOrder = new Map()
  for (const item of itemRows) {
    const oid = String(item.amazon_order_id)
    if (!itemsByOrder.has(oid)) itemsByOrder.set(oid, [])
    itemsByOrder.get(oid).push(item)
  }

  const { byOrder: reportByOrder, error: reportError } = await loadOrderReportAmounts(
    marketplaceKey,
    bounds,
  )
  if (reportError) {
    warnings.push(
      `${meta.label}: Amazon order-report lookup failed (${reportError}); orders Amazon has not authorised yet will have no amount`,
    )
  }

  let feesByOrder = new Map()
  let feeLookupFailed = false
  try {
    feesByOrder = await loadSettlementFees(orderIds, meta.currency, fx)
  } catch (err) {
    feeLookupFailed = true
    console.error(
      `[dailyEcommerceReport] ${meta.label} settlement fee lookup failed:`,
      err,
    )
    warnings.push(
      `${meta.label}: Amazon settlement fee lookup failed (${err.message || String(err)}); commission and shipping shown as Pending`,
    )
  }

  const orders = []
  let quantity = 0
  let salesAmountAED = 0
  let commissionKnown = 0
  let fulfillmentKnown = 0
  let ordersWithFees = 0
  let missingItems = 0
  let missingAmount = 0
  let derivedAmounts = 0
  let reportAmounts = 0
  const reportMismatches = []

  for (const row of included) {
    const orderId = String(row.amazon_order_id)
    const itemRows = itemsByOrder.get(orderId) || []
    const reportOrder = reportByOrder.get(orderId) || null

    // Per-SKU money for a Pending order exists only in the order report, so use it to fill the
    // drill-down lines the Orders API left blank.
    const reportLineBySku = new Map()
    for (const line of reportOrder ? reportOrder.lines : []) {
      const key = String(line.seller_sku || line.asin || '').trim().toUpperCase()
      if (key) reportLineBySku.set(key, line)
    }

    const items = []
    let lineQty = 0
    for (const li of itemRows) {
      const sku = String(li.seller_sku || li.asin || '').trim()
      const qty = Math.max(0, Math.trunc(toFiniteNumber(li.quantity_ordered, 0)))
      lineQty += qty
      let lineAmount = li.item_amount == null ? null : round2(toFiniteNumber(li.item_amount, 0))
      if (lineAmount == null) {
        const reportLine = reportLineBySku.get(sku.toUpperCase())
        if (reportLine) lineAmount = round2(toFiniteNumber(reportLine.line_amount, 0))
      }
      items.push({
        sku: sku || '(SKU pending item sync)',
        quantity: qty,
        lineAmount: lineAmount == null ? undefined : lineAmount,
      })
    }
    if (!items.length) {
      missingItems += 1
      items.push({ sku: '(items pending Amazon sync)', quantity: 0 })
    }

    // `OrderTotal` is Amazon's own order-level figure, counted exactly once per order. Amazon
    // withholds it while an order is Pending, so fall back to Amazon's flat-file order report, which
    // publishes the same order's price immediately, and only then to the cached item breakdown. If
    // no Amazon source reported money at all, the value stays unknown rather than becoming zero.
    let amountSource = 'amazon_order_total'
    let originalAmount = row.order_amount == null ? null : toFiniteNumber(row.order_amount, 0)
    let currency = String(row.currency_code || '').trim().toUpperCase()
    if (originalAmount == null) {
      const derived = reportOrder
        ? { amount: reportOrder.amount, currency: reportOrder.currency, source: 'amazon_order_report' }
        : (() => {
            const fromItems = deriveOrderAmountFromItems(itemRows)
            return fromItems ? { ...fromItems, source: 'amazon_order_items' } : null
          })()
      if (derived) {
        originalAmount = derived.amount
        currency = String(derived.currency || meta.currency).trim().toUpperCase()
        amountSource = derived.source
        if (derived.source === 'amazon_order_report') reportAmounts += 1
        else derivedAmounts += 1
      } else {
        amountSource = 'pending_at_amazon'
        missingAmount += 1
      }
    } else if (reportOrder && Math.abs(reportOrder.amount - originalAmount) > 0.011) {
      // Both Amazon sources spoke and disagree by more than currency rounding. Keep `OrderTotal` —
      // it is the order-level figure Amazon settles on — but never hide the discrepancy.
      reportMismatches.push(
        `${orderId} (OrderTotal ${round2(originalAmount)} vs order report ${reportOrder.amount})`,
      )
    }
    if (!currency) currency = meta.currency
    const amountAED = originalAmount == null ? null : toAed(originalAmount, currency, fx)

    const fees = feesByOrder.get(orderId)
    if (fees) {
      ordersWithFees += 1
      commissionKnown += fees.commission
      fulfillmentKnown += fees.fulfillment
    }

    quantity += lineQty
    if (amountAED != null) salesAmountAED += amountAED

    orders.push({
      orderId,
      orderNumber: orderId,
      orderDate: row.purchase_date ? new Date(row.purchase_date).toISOString() : null,
      status: String(row.order_status || ''),
      marketplaceId: row.marketplace_id || null,
      items,
      originalAmount: originalAmount == null ? null : round2(originalAmount),
      originalCurrency: currency,
      amountAED: amountAED == null ? null : round2(amountAED),
      amountSource,
      commissionAED: fees ? round2(fees.commission) : null,
      shippingAED: fees ? round2(fees.fulfillment) : null,
      feesSource: fees ? 'amazon_settlement_report' : null,
    })
  }

  if (missingItems > 0) {
    warnings.push(
      `${meta.label}: ${missingItems} order(s) have no cached Amazon line items yet (run an Amazon orders sync with items)`,
    )
  }
  if (reportAmounts > 0) {
    warnings.push(
      `${meta.label}: ${reportAmounts} order(s) are still Pending at Amazon, which withholds OrderTotal from the Orders API, so their amount comes from Amazon's own order report (item price, tax, shipping and promotions) and is included in Amazon Amount`,
    )
  }
  if (derivedAmounts > 0) {
    warnings.push(
      `${meta.label}: ${derivedAmounts} order(s) had no Amazon OrderTotal yet, so their amount is derived from Amazon's own item price, tax, shipping and promotion figures`,
    )
  }
  if (missingAmount > 0) {
    // Two very different causes, and blaming Amazon for the wrong one sends whoever reads this
    // looking in the wrong place.
    const reportPulled = reportError ? null : await findCoveringOrderReportRun(marketplaceKey, bounds)
    warnings.push(
      reportPulled || reportError
        ? `${meta.label}: ${missingAmount} order(s) carry no Amazon-reported money in either the Orders API or the Amazon order report, so they are listed without an amount and excluded from Amazon Amount`
        : `${meta.label}: ${missingAmount} order(s) have no amount because Amazon withholds it from the Orders API while an order is Pending, and Amazon's order report has not been pulled for ${bounds.dateYmd} yet — press Refresh to pull it`,
    )
  }
  if (reportMismatches.length > 0) {
    warnings.push(
      `${meta.label}: Amazon's OrderTotal and its own order report disagree on ${reportMismatches.length} order(s) — ${reportMismatches.slice(0, 5).join('; ')}${reportMismatches.length > 5 ? '; …' : ''}`,
    )
  }

  // No settlement coverage for the day → Pending, never a fake zero
  const feesAvailable = !feeLookupFailed && ordersWithFees > 0
  if (!feeLookupFailed && orderIds.length && ordersWithFees === 0) {
    warnings.push(
      `${meta.label}: Amazon has not settled these orders yet, so commission and shipping are Pending (excluded from cost %)`,
    )
  }

  const commissionAED = feesAvailable ? round2(commissionKnown) : null
  const shippingAED = feesAvailable ? round2(fulfillmentKnown) : null
  salesAmountAED = round2(salesAmountAED)
  // Amazon gave a money figure for no order at all, yet orders exist: reporting 0 would claim the
  // day was worth nothing, so the amount stays unknown until Amazon authorises them.
  const salesUnknown = included.length > 0 && missingAmount === included.length

  const financials = computeChannelFinancials({
    salesAmountAED,
    adSpendAED: ads.adSpendAED,
    commissionAED,
    shippingAED,
  })

  // The order report is pulled separately from the Orders API sync, so the freshest of the two is
  // what the page's "data as of" line should show.
  let lastSyncedAt = included.reduce((acc, r) => {
    const t = r.last_synced_at ? new Date(r.last_synced_at).getTime() : 0
    return t > acc ? t : acc
  }, 0)
  for (const bucket of reportByOrder.values()) {
    const t = bucket.lastSyncedAt ? bucket.lastSyncedAt.getTime() : 0
    if (t > lastSyncedAt) lastSyncedAt = t
  }

  return buildChannelShell(meta, 'available', {
    dataSource: 'amazon_sp_api_orders_cache',
    lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null,
    reconciliation: {
      rawOrders: orderRows.length,
      uniqueOrderIds: new Set(
        orderRows.map((r) => String(r.amazon_order_id || '').trim()).filter(Boolean),
      ).size,
      includedOrders: included.length,
      excludedStatuses: orderRows.length - included.length,
      // Amazon's own order totals for the included orders, before any currency conversion, so the
      // report figure can be checked against SP-API without re-deriving anything.
      rawOrderTotalSum: round2(
        included.reduce((acc, r) => acc + (r.order_amount == null ? 0 : toFiniteNumber(r.order_amount, 0)), 0),
      ),
      rawOrderTotalCurrency: meta.currency,
      normalizedSalesAED: salesAmountAED,
      ordersFromOrderTotal: orders.filter((o) => o.amountSource === 'amazon_order_total').length,
      ordersFromOrderReport: reportAmounts,
      ordersDerivedFromItems: derivedAmounts,
      ordersWithoutAmazonAmount: missingAmount,
      // What Amazon's own order report says the included orders are worth, so the report figure can
      // be checked against the Seller Central order export without re-deriving anything.
      reportOrderTotalSum: round2(
        included.reduce(
          (acc, r) => acc + (reportByOrder.get(String(r.amazon_order_id))?.amount ?? 0),
          0,
        ),
      ),
      orderTotalReportMismatches: reportMismatches.length,
    },
    orders,
    adsStatus: ads.adsStatus,
    adsProvider: ads.adsProvider,
    warnings,
    summary: {
      quantity,
      salesAmountAED: salesUnknown ? null : salesAmountAED,
      adSpendAED: ads.adSpendAED,
      clicks: ads.clicks,
      commissionAED,
      shippingAED,
      costPercentage: salesUnknown ? null : financials.costPercentage,
      balanceAED: salesUnknown ? null : financials.balanceAED,
    },
  })
}

module.exports = {
  loadAmazonChannel,
  deriveOrderAmountFromItems,
  loadOrderReportAmounts,
  EXCLUDED_STATUSES,
  FEE_CATEGORIES,
}
