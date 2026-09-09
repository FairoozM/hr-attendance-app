'use strict'

/**
 * Amazon SP-API orders cache → Daily Ecommerce channel report (UAE / KSA).
 * Reuses `amazon_orders` / `amazon_order_items`. Does not call SP-API on read.
 *
 * Optional fee enrichment from `amazon_payment_clearing_rows` when settlement
 * lines exist for the same Amazon order IDs (commission / FBA fees as costs;
 * customer shipping collected is NOT treated as a channel cost).
 */

const { query } = require('../../../db')
const { computeChannelFinancials } = require('../formulas')
const { round2, toAed, toFiniteNumber } = require('../money')
const { buildChannelShell, CHANNELS } = require('../channels')

const EXCLUDED_STATUSES = new Set(['canceled', 'cancelled'])

function metaForMarketplace(marketplaceKey) {
  return CHANNELS.find((c) => c.key === (marketplaceKey === 'ksa' ? 'amazon_ksa' : 'amazon_uae'))
}

/**
 * @param {'uae'|'ksa'} marketplaceKey
 * @param {{ start: Date, end: Date }} bounds
 * @param {{ rate: number }} fx
 * @param {{ adSpendAED: number|null, clicks: number|null, adsStatus: string, adsProvider: string|null }} ads
 */
async function loadAmazonChannel(marketplaceKey, bounds, fx, ads) {
  const meta = metaForMarketplace(marketplaceKey)
  const warnings = []

  let lastSyncedAt = null
  try {
    const syncRes = await query(
      `SELECT MAX(last_synced_at) AS last_synced_at
       FROM amazon_orders
       WHERE marketplace_key = $1`,
      [marketplaceKey],
    )
    lastSyncedAt = syncRes.rows[0]?.last_synced_at
      ? new Date(syncRes.rows[0].last_synced_at).toISOString()
      : null
  } catch (err) {
    return {
      ...buildChannelShell(meta, 'unavailable', {
        warnings: [`Amazon orders cache query failed: ${err.message}`],
        adsStatus: ads.adsStatus,
        adsProvider: ads.adsProvider,
        summary: {
          ...buildChannelShell(meta, 'unavailable').summary,
          adSpendAED: ads.adSpendAED,
          clicks: ads.clicks,
        },
      }),
    }
  }

  const ordersRes = await query(
    `SELECT
       o.amazon_order_id,
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

  const rawOrders = ordersRes.rows || []
  const included = []
  const seen = new Set()
  let duplicateCount = 0

  for (const row of rawOrders) {
    const status = String(row.order_status || '').trim()
    if (EXCLUDED_STATUSES.has(status.toLowerCase())) continue
    const orderId = String(row.amazon_order_id || '').trim()
    if (!orderId) continue
    if (seen.has(orderId)) {
      duplicateCount += 1
      continue
    }
    seen.add(orderId)
    included.push(row)
  }

  if (duplicateCount > 0) {
    warnings.push(`Amazon ${marketplaceKey.toUpperCase()}: skipped ${duplicateCount} duplicate external order ID(s)`)
  }

  const orderIds = included.map((r) => String(r.amazon_order_id))
  /** @type {Map<string, Array<object>>} */
  const itemsByOrder = new Map()

  if (orderIds.length) {
    const itemsRes = await query(
      `SELECT
         amazon_order_id,
         seller_sku,
         quantity_ordered,
         item_amount,
         item_currency_code
       FROM amazon_order_items
       WHERE marketplace_key = $1
         AND amazon_order_id = ANY($2::text[])
       ORDER BY amazon_order_id, id`,
      [marketplaceKey, orderIds],
    )
    for (const item of itemsRes.rows || []) {
      const oid = String(item.amazon_order_id)
      if (!itemsByOrder.has(oid)) itemsByOrder.set(oid, [])
      itemsByOrder.get(oid).push(item)
    }
  }

  /** @type {Map<string, { commission: number, fulfillment: number, otherFees: number }>} */
  const feesByOrder = new Map()
  if (orderIds.length) {
    try {
      const feesRes = await query(
        `SELECT
           order_id,
           category,
           SUM(amount)::numeric AS amount_sum,
           MAX(currency) AS currency
         FROM amazon_payment_clearing_rows
         WHERE order_id = ANY($1::text[])
           AND category IN ('Commission', 'FBA / Fulfillment Fee', 'Other Amazon Fee', 'Other')
         GROUP BY order_id, category`,
        [orderIds],
      )
      for (const row of feesRes.rows || []) {
        const oid = String(row.order_id || '').trim()
        if (!oid) continue
        if (!feesByOrder.has(oid)) {
          feesByOrder.set(oid, { commission: 0, fulfillment: 0, otherFees: 0 })
        }
        const bucket = feesByOrder.get(oid)
        const absAmt = Math.abs(toFiniteNumber(row.amount_sum, 0))
        const cur = String(row.currency || meta.currency).toUpperCase()
        const aed = toAed(absAmt, cur, fx)
        if (row.category === 'Commission') bucket.commission += aed
        else if (row.category === 'FBA / Fulfillment Fee') bucket.fulfillment += aed
        else bucket.otherFees += aed
      }
    } catch {
      warnings.push(
        `Amazon ${marketplaceKey.toUpperCase()}: payment clearing fee lookup unavailable; commission/shipping costs may be incomplete`,
      )
    }
  }

  const orders = []
  let quantity = 0
  let salesAmountAED = 0
  let commissionAED = 0
  let shippingAED = 0
  let otherIncludedCostsAED = 0
  let missingSku = 0
  let reconcileMismatches = 0

  for (const row of included) {
    const orderId = String(row.amazon_order_id)
    const currency = String(row.currency_code || meta.currency).trim().toUpperCase() || meta.currency
    const originalAmount = row.order_amount == null ? null : toFiniteNumber(row.order_amount, 0)
    const amountAED = originalAmount == null ? 0 : toAed(originalAmount, currency, fx)
    const lineItems = itemsByOrder.get(orderId) || []
    const items = []
    let lineQty = 0
    let lineSum = 0

    for (const li of lineItems) {
      const sku = String(li.seller_sku || '').trim()
      if (!sku) missingSku += 1
      const qty = Math.max(0, Math.trunc(toFiniteNumber(li.quantity_ordered, 0)))
      const lineAmount = li.item_amount == null ? undefined : toFiniteNumber(li.item_amount, 0)
      if (lineAmount != null) lineSum += lineAmount
      lineQty += qty
      items.push({
        sku: sku || '(missing SKU)',
        quantity: qty,
        unitAmount: lineAmount != null && qty > 0 ? round2(lineAmount / qty) : undefined,
        lineAmount: lineAmount != null ? round2(lineAmount) : undefined,
      })
    }

    if (items.length === 0) {
      items.push({ sku: '(no line items)', quantity: 0 })
      warnings.push(`Amazon order ${orderId}: no cached line items`)
    }

    if (
      originalAmount != null &&
      lineItems.length > 0 &&
      Math.abs(lineSum - originalAmount) > 0.05 * Math.max(1, Math.abs(originalAmount))
    ) {
      reconcileMismatches += 1
    }

    const fees = feesByOrder.get(orderId)
    const orderCommission = fees ? round2(fees.commission) : 0
    const orderFulfillment = fees ? round2(fees.fulfillment) : 0
    const orderOther = fees ? round2(fees.otherFees) : 0

    commissionAED += orderCommission
    shippingAED += orderFulfillment // FBA fulfillment treated as shipping/fulfillment cost
    otherIncludedCostsAED += orderOther
    quantity += lineQty
    salesAmountAED += amountAED

    orders.push({
      orderId,
      orderNumber: orderId,
      orderDate: row.purchase_date ? new Date(row.purchase_date).toISOString() : null,
      status: String(row.order_status || ''),
      items,
      originalAmount: originalAmount == null ? undefined : round2(originalAmount),
      originalCurrency: currency,
      amountAED: round2(amountAED),
      commissionAED: orderCommission || undefined,
      shippingAED: orderFulfillment || undefined,
      otherFeesAED: orderOther || undefined,
      feesSource: fees ? 'amazon_payment_clearing_rows' : null,
    })
  }

  if (missingSku > 0) {
    warnings.push(`Amazon ${marketplaceKey.toUpperCase()}: ${missingSku} line(s) missing SKU`)
  }
  if (reconcileMismatches > 0) {
    warnings.push(
      `Amazon ${marketplaceKey.toUpperCase()}: ${reconcileMismatches} order(s) where item totals diverge from order amount`,
    )
  }
  if (orderIds.length && feesByOrder.size === 0) {
    warnings.push(
      `Amazon ${marketplaceKey.toUpperCase()}: no settlement fee rows matched today’s orders (commission/fulfillment shown as 0)`,
    )
  }

  salesAmountAED = round2(salesAmountAED)
  commissionAED = round2(commissionAED)
  shippingAED = round2(shippingAED)
  otherIncludedCostsAED = round2(otherIncludedCostsAED)

  const financials = computeChannelFinancials({
    salesAmountAED,
    adSpendAED: ads.adSpendAED,
    commissionAED,
    shippingAED,
    paymentFeesAED: 0,
    otherIncludedCostsAED,
  })

  return buildChannelShell(meta, 'available', {
    lastSyncedAt,
    orders,
    adsStatus: ads.adsStatus,
    adsProvider: ads.adsProvider,
    warnings,
    summary: {
      orderCount: orders.length,
      quantity,
      salesAmountAED,
      adSpendAED: ads.adSpendAED,
      clicks: ads.clicks,
      commissionAED,
      shippingAED,
      paymentFeesAED: 0,
      otherIncludedCostsAED,
      couponDiscountAED: 0,
      smilePointsAED: 0,
      totalIncludedCostsAED: financials.totalIncludedCostsAED,
      costPercentage: financials.costPercentage,
      balanceAED: financials.balanceAED,
    },
  })
}

module.exports = {
  loadAmazonChannel,
  EXCLUDED_STATUSES,
}
