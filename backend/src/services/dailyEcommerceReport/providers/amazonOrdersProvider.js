'use strict'

/**
 * Amazon UAE / KSA orders for the Daily Ecommerce Report.
 *
 * Source chain: Amazon SP-API → `amazon_orders` / `amazon_order_items`
 * (written only by `amazonOrdersSyncService`) → report.
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

async function loadItemRows(marketplaceKey, orderIds) {
  if (!orderIds.length) return []
  const res = await query(
    `SELECT
       amazon_order_id,
       seller_sku,
       asin,
       quantity_ordered,
       item_amount,
       item_currency_code
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

  const orderIds = included.map((r) => String(r.amazon_order_id))

  const itemRows = await loadItemRows(marketplaceKey, orderIds)
  /** @type {Map<string, object[]>} */
  const itemsByOrder = new Map()
  for (const item of itemRows) {
    const oid = String(item.amazon_order_id)
    if (!itemsByOrder.has(oid)) itemsByOrder.set(oid, [])
    itemsByOrder.get(oid).push(item)
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

  for (const row of included) {
    const orderId = String(row.amazon_order_id)
    const currency = String(row.currency_code || meta.currency).trim().toUpperCase() || meta.currency
    // Amazon withholds OrderTotal on unshipped/pending orders — that is unknown, not zero
    const originalAmount = row.order_amount == null ? null : toFiniteNumber(row.order_amount, 0)
    const amountAED = originalAmount == null ? null : toAed(originalAmount, currency, fx)
    if (originalAmount == null) missingAmount += 1

    const items = []
    let lineQty = 0
    for (const li of itemsByOrder.get(orderId) || []) {
      const sku = String(li.seller_sku || li.asin || '').trim()
      const qty = Math.max(0, Math.trunc(toFiniteNumber(li.quantity_ordered, 0)))
      lineQty += qty
      items.push({
        sku: sku || '(SKU pending item sync)',
        quantity: qty,
        lineAmount: li.item_amount == null ? undefined : round2(toFiniteNumber(li.item_amount, 0)),
      })
    }
    if (!items.length) {
      missingItems += 1
      items.push({ sku: '(items pending Amazon sync)', quantity: 0 })
    }

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
  if (missingAmount > 0) {
    warnings.push(
      `${meta.label}: ${missingAmount} order(s) are still Pending at Amazon and carry no order total yet, so their value is excluded from Amazon Amount`,
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

  const financials = computeChannelFinancials({
    salesAmountAED,
    adSpendAED: ads.adSpendAED,
    commissionAED,
    shippingAED,
  })

  const lastSyncedAt = included.length
    ? included.reduce((acc, r) => {
        const t = r.last_synced_at ? new Date(r.last_synced_at).getTime() : 0
        return t > acc ? t : acc
      }, 0)
    : 0

  return buildChannelShell(meta, 'available', {
    dataSource: 'amazon_sp_api_orders_cache',
    lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null,
    orders,
    adsStatus: ads.adsStatus,
    adsProvider: ads.adsProvider,
    warnings,
    summary: {
      quantity,
      salesAmountAED,
      adSpendAED: ads.adSpendAED,
      clicks: ads.clicks,
      commissionAED,
      shippingAED,
      costPercentage: financials.costPercentage,
      balanceAED: financials.balanceAED,
    },
  })
}

module.exports = {
  loadAmazonChannel,
  EXCLUDED_STATUSES,
  FEE_CATEGORIES,
}
