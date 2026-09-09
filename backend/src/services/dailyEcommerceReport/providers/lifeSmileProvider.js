'use strict'

/**
 * Combined Life Smile website, app and physical-shop orders.
 *
 * Source chain: Life Smile website platform → its own orders database
 * (read-only connection, `LIFESMILE_WEBSITE_DATABASE_URL`) → report.
 *
 * `orders.shop_order` is the website platform's own channel flag: true means a
 * Burjman physical-shop sale, which is displayed with a " (SHOP)" suffix.
 * Website and app orders share the same online channel in the platform, so
 * they stay in one section without inventing a split the source does not have.
 */

const lifesmileWebsiteDb = require('../../../db/lifesmileWebsiteDb')
const { computeChannelFinancials } = require('../formulas')
const { round2, toFiniteNumber } = require('../money')
const { buildChannelShell, CHANNELS } = require('../channels')

const INCLUDED_STATUSES = new Set([
  'ordered',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'partiallyReturned',
  'returnRequested',
  'pending',
])

const EXCLUDED_STATUSES = new Set(['cancelled', 'returned'])

const META = CHANNELS.find((c) => c.key === 'life_smile')

const ORDERS_SQL = `
SELECT
  o.id,
  o.invoice_number,
  o.order_status,
  o.total_amount,
  o.discount_amount,
  o.points_redeemed,
  o.wallet_redeemed,
  o.shipping_charge,
  o.refund_amount,
  o.payment_method,
  o.shop_order,
  o.created_at,
  o.user_agent,
  ci.id AS cart_item_id,
  ci.quantity,
  ci.total_amount AS line_amount,
  ci.is_cancelled AS item_cancelled,
  ci.is_returned AS item_returned,
  COALESCE(NULLIF(TRIM(pv.item_code), ''), NULLIF(TRIM(p.item_code), ''), '') AS item_code
FROM orders o
INNER JOIN cart_items ci
  ON ci.cart_id = o.cart_id
 AND ci.deleted_at IS NULL
LEFT JOIN product_variants pv ON pv.id = ci.variant_id
LEFT JOIN products p ON p.id = ci.product_id
WHERE o.deleted_at IS NULL
  AND o.created_at >= $1
  AND o.created_at < $2
ORDER BY o.created_at ASC, o.id ASC, ci.id ASC
`

function bnplFeeRate() {
  const raw = process.env.WEBSITE_TABBY_TAMARA_FEE_PERCENT
  if (raw == null || String(raw).trim() === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  return n > 1 ? n / 100 : n
}

/**
 * @param {{ start: Date, end: Date }} bounds
 * @param {{ adSpendAED: number|null, clicks: number|null, adsStatus: string, adsProvider: string|null, adsMetricLabel?: string|null }} ads
 */
async function loadLifeSmileChannel(bounds, ads) {
  if (!lifesmileWebsiteDb.isConfigured()) {
    return buildChannelShell(META, 'not_configured', {
      dataSource: 'lifesmile_website_orders_db',
      adsStatus: ads.adsStatus,
      adsProvider: ads.adsProvider,
      adsMetricLabel: ads.adsMetricLabel || 'link_clicks',
      warnings: [
        `Life Smile Website: read-only website database connection is not configured (${lifesmileWebsiteDb.ENV_VAR} is unset in this process)`,
      ],
      summary: {
        ...buildChannelShell(META, 'not_configured').summary,
        adSpendAED: ads.adSpendAED,
        clicks: ads.clicks,
      },
    })
  }

  let rows
  try {
    const result = await lifesmileWebsiteDb.readQuery(ORDERS_SQL, [bounds.start, bounds.end])
    rows = result.rows || []
  } catch (err) {
    // Log the real technical error; the API also returns it so it is diagnosable
    console.error('[dailyEcommerceReport] Life Smile website orders query failed:', err)
    const detail = [err && err.code ? `code ${err.code}` : null, err && err.message ? err.message : String(err)]
      .filter(Boolean)
      .join(': ')
    return buildChannelShell(META, 'unavailable', {
      dataSource: 'lifesmile_website_orders_db',
      adsStatus: ads.adsStatus,
      adsProvider: ads.adsProvider,
      adsMetricLabel: ads.adsMetricLabel || 'link_clicks',
      warnings: [`Life Smile Website: Data Error — ${detail}`],
      errorDetail: detail,
      summary: {
        ...buildChannelShell(META, 'unavailable').summary,
        adSpendAED: ads.adSpendAED,
        clicks: ads.clicks,
      },
    })
  }

  /** @type {Map<number, { order: object, items: object[] }>} */
  const byId = new Map()
  for (const row of rows) {
    const status = String(row.order_status || '')
    if (EXCLUDED_STATUSES.has(status)) continue
    if (!INCLUDED_STATUSES.has(status)) continue
    const id = Number(row.id)
    if (!byId.has(id)) byId.set(id, { order: row, items: [] })
    if (row.item_cancelled === true) continue
    byId.get(id).items.push(row)
  }

  const warnings = []
  const orders = []
  let quantity = 0
  let salesAmountAED = 0
  let smilePointCouponAED = 0
  let shippingAED = 0
  let tabbyBase = 0
  let missingSku = 0

  for (const { order, items } of byId.values()) {
    const status = String(order.order_status || '')
    const refund = toFiniteNumber(order.refund_amount, 0)
    let amount = toFiniteNumber(order.total_amount, 0)
    if (status === 'partiallyReturned' && refund > 0) {
      amount = round2(Math.max(0, amount - refund))
    }

    const lineItems = []
    let lineQty = 0
    for (const li of items) {
      if (li.item_returned === true) continue
      const sku = String(li.item_code || '').trim()
      if (!sku) missingSku += 1
      const qty = Math.max(0, Math.trunc(toFiniteNumber(li.quantity, 0)))
      lineQty += qty
      const lineAmount = li.line_amount == null ? undefined : toFiniteNumber(li.line_amount, 0)
      lineItems.push({
        sku: sku || '(missing SKU)',
        quantity: qty,
        unitAmount: lineAmount != null && qty > 0 ? round2(lineAmount / qty) : undefined,
        lineAmount: lineAmount != null ? round2(lineAmount) : undefined,
      })
    }
    if (lineItems.length === 0) lineItems.push({ sku: '(no line items)', quantity: 0 })

    const discount = toFiniteNumber(order.discount_amount, 0)
    const points = toFiniteNumber(order.points_redeemed, 0)
    // Informational only — total_amount is already net of these
    smilePointCouponAED += discount + points

    const pm = String(order.payment_method || '')
    if (pm === 'tabby' || pm === 'tamara') tabbyBase += amount

    const baseNumber =
      order.invoice_number != null && String(order.invoice_number).trim()
        ? String(order.invoice_number).trim()
        : String(order.id)
    const isShop = order.shop_order === true
    const orderNumber = isShop ? `${baseNumber} (SHOP)` : baseNumber

    quantity += lineQty
    salesAmountAED += amount

    orders.push({
      orderId: String(order.id),
      orderNumber,
      orderDate: order.created_at ? new Date(order.created_at).toISOString() : null,
      status,
      items: lineItems,
      originalAmount: round2(toFiniteNumber(order.total_amount, 0)),
      originalCurrency: 'AED',
      amountAED: round2(amount),
      isShop,
      paymentMethod: pm || undefined,
      discountAED: discount || undefined,
      smilePointsAED: points || undefined,
    })
  }

  if (missingSku > 0) {
    warnings.push(`Life Smile Website: ${missingSku} line(s) missing item code/SKU`)
  }

  const feeRate = bnplFeeRate()
  let tabbyTamaraCommissionAED = 0
  if (feeRate != null && tabbyBase > 0) {
    tabbyTamaraCommissionAED = round2(tabbyBase * feeRate)
  } else if (tabbyBase > 0 && feeRate == null) {
    warnings.push(
      'Life Smile Website: Tabby/Tamara orders present but WEBSITE_TABBY_TAMARA_FEE_PERCENT is not set — commission shown as 0',
    )
  }

  // Customer shipping is part of sales, not a channel fulfillment cost
  shippingAED = 0

  salesAmountAED = round2(salesAmountAED)
  smilePointCouponAED = round2(smilePointCouponAED)

  const financials = computeChannelFinancials({
    salesAmountAED,
    adSpendAED: ads.adSpendAED,
    commissionAED: 0,
    shippingAED,
    tabbyTamaraCommissionAED,
  })

  return buildChannelShell(META, 'available', {
    dataSource: 'lifesmile_website_orders_db',
    lastSyncedAt: new Date().toISOString(),
    orders,
    adsStatus: ads.adsStatus,
    adsProvider: ads.adsProvider,
    adsMetricLabel: ads.adsMetricLabel || 'link_clicks',
    warnings,
    summary: {
      quantity,
      salesAmountAED,
      adSpendAED: ads.adSpendAED,
      clicks: ads.clicks,
      commissionAED: 0,
      tabbyTamaraCommissionAED,
      smilePointCouponAED,
      shippingAED,
      costPercentage: financials.costPercentage,
      balanceAED: financials.balanceAED,
    },
  })
}

module.exports = {
  loadLifeSmileChannel,
  INCLUDED_STATUSES,
  EXCLUDED_STATUSES,
  ORDERS_SQL,
}
