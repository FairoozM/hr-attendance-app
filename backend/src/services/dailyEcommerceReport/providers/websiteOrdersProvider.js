'use strict'

/**
 * Life Smile Website + Shop orders from the read-only website catalog DB
 * (`LIFESMILE_WEBSITE_DATABASE_URL` via lifesmileWebsiteDb).
 *
 * Separation: `orders.shop_order = true` → Shop; otherwise Website.
 * Line items come from `cart_items` joined to `product_variants` / `products` for item_code.
 *
 * Sales amount uses `orders.total_amount` (already net of discount / points / wallet
 * in the stored total — coupon and Smile Points are informational only).
 * Customer `shipping_charge` is part of sales, not a channel cost.
 * Tabby/Tamara fee rates are not stored → paymentFees remain 0 with a warning.
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

const WEBSITE_META = CHANNELS.find((c) => c.key === 'website')
const SHOP_META = CHANNELS.find((c) => c.key === 'shop')

const ORDERS_SQL = `
SELECT
  o.id,
  o.invoice_number,
  o.order_status,
  o.total_amount,
  o.sub_total,
  o.discount_amount,
  o.points_redeemed,
  o.wallet_redeemed,
  o.shipping_charge,
  o.refund_amount,
  o.payment_method,
  o.shop_order,
  o.created_at,
  o.updated_at,
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

/**
 * @param {boolean} shopOrder
 * @param {{ start: Date, end: Date }} bounds
 * @param {{ adSpendAED: number|null, clicks: number|null, adsStatus: string, adsProvider: string|null, adsMetricLabel?: string|null }} ads
 */
async function loadDirectChannel(shopOrder, bounds, ads) {
  const meta = shopOrder ? SHOP_META : WEBSITE_META
  const channelLabel = meta.label

  if (!lifesmileWebsiteDb.isConfigured()) {
    return buildChannelShell(meta, 'not_configured', {
      adsStatus: ads.adsStatus,
      adsProvider: ads.adsProvider,
      adsMetricLabel: ads.adsMetricLabel || null,
      warnings: [`${channelLabel}: website database not configured (LIFESMILE_WEBSITE_DATABASE_URL)`],
      summary: {
        ...buildChannelShell(meta, 'not_configured').summary,
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
    return buildChannelShell(meta, 'unavailable', {
      adsStatus: ads.adsStatus,
      adsProvider: ads.adsProvider,
      adsMetricLabel: ads.adsMetricLabel || null,
      warnings: [`${channelLabel}: ${err.message || String(err)}`],
      summary: {
        ...buildChannelShell(meta, 'unavailable').summary,
        adSpendAED: ads.adSpendAED,
        clicks: ads.clicks,
      },
    })
  }

  /** @type {Map<number, { order: object, items: object[] }>} */
  const byId = new Map()
  for (const row of rows) {
    const isShop = row.shop_order === true
    if (isShop !== shopOrder) continue
    const status = String(row.order_status || '')
    if (EXCLUDED_STATUSES.has(status)) continue
    if (!INCLUDED_STATUSES.has(status) && status) continue

    const id = Number(row.id)
    if (!byId.has(id)) {
      byId.set(id, { order: row, items: [] })
    }
    if (row.item_cancelled === true) continue
    byId.get(id).items.push(row)
  }

  const warnings = []
  const orders = []
  let quantity = 0
  let salesAmountAED = 0
  let couponDiscountAED = 0
  let smilePointsAED = 0
  let missingSku = 0
  let tabbyTamaraCount = 0

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
      if (li.item_returned === true && status === 'partiallyReturned') {
        // still count non-returned lines only
      }
      const sku = String(li.item_code || '').trim()
      if (!sku) missingSku += 1
      const qty = Math.max(0, Math.trunc(toFiniteNumber(li.quantity, 0)))
      const lineAmount = li.line_amount == null ? undefined : toFiniteNumber(li.line_amount, 0)
      lineQty += qty
      lineItems.push({
        sku: sku || '(missing SKU)',
        quantity: qty,
        unitAmount: lineAmount != null && qty > 0 ? round2(lineAmount / qty) : undefined,
        lineAmount: lineAmount != null ? round2(lineAmount) : undefined,
      })
    }

    if (lineItems.length === 0) {
      lineItems.push({ sku: '(no line items)', quantity: 0 })
    }

    const discount = toFiniteNumber(order.discount_amount, 0)
    const points = toFiniteNumber(order.points_redeemed, 0)
    couponDiscountAED += discount
    smilePointsAED += points

    const pm = String(order.payment_method || '')
    if (pm === 'tabby' || pm === 'tamara') tabbyTamaraCount += 1

    const orderNumber =
      order.invoice_number != null && String(order.invoice_number).trim()
        ? String(order.invoice_number).trim()
        : String(order.id)

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
      discountAED: discount || undefined,
      smilePointsAED: points || undefined,
      shippingChargedAED: toFiniteNumber(order.shipping_charge, 0) || undefined,
      paymentMethod: pm || undefined,
    })
  }

  if (missingSku > 0) {
    warnings.push(`${channelLabel}: ${missingSku} line(s) missing item code/SKU`)
  }
  if (tabbyTamaraCount > 0) {
    warnings.push(
      `${channelLabel}: ${tabbyTamaraCount} Tabby/Tamara order(s); BNPL fee rates are not stored — payment fees shown as 0`,
    )
  }
  // Customer shipping is revenue, not cost
  warnings.push(
    `${channelLabel}: customer shipping charges are included in sales totals, not in shipping cost`,
  )

  // Meta ads only on website (direct ecommerce), not shop — caller passes ads
  salesAmountAED = round2(salesAmountAED)
  couponDiscountAED = round2(couponDiscountAED)
  smilePointsAED = round2(smilePointsAED)

  const financials = computeChannelFinancials({
    salesAmountAED,
    adSpendAED: ads.adSpendAED,
    commissionAED: 0,
    shippingAED: 0,
    paymentFeesAED: 0,
    otherIncludedCostsAED: 0,
  })

  let lastSyncedAt = null
  if (orders.length) {
    const latest = orders.reduce((max, o) => {
      const t = o.orderDate ? Date.parse(o.orderDate) : 0
      return t > max ? t : max
    }, 0)
    lastSyncedAt = latest ? new Date(latest).toISOString() : new Date().toISOString()
  } else {
    lastSyncedAt = new Date().toISOString()
  }

  return buildChannelShell(meta, 'available', {
    lastSyncedAt,
    orders,
    adsStatus: ads.adsStatus,
    adsProvider: ads.adsProvider,
    adsMetricLabel: ads.adsMetricLabel || null,
    warnings,
    summary: {
      orderCount: orders.length,
      quantity,
      salesAmountAED,
      adSpendAED: ads.adSpendAED,
      clicks: ads.clicks,
      commissionAED: 0,
      shippingAED: 0,
      paymentFeesAED: 0,
      otherIncludedCostsAED: 0,
      couponDiscountAED,
      smilePointsAED,
      totalIncludedCostsAED: financials.totalIncludedCostsAED,
      costPercentage: financials.costPercentage,
      balanceAED: financials.balanceAED,
    },
  })
}

async function loadWebsiteChannel(bounds, ads) {
  return loadDirectChannel(false, bounds, ads)
}

async function loadShopChannel(bounds, ads) {
  // Shop does not receive Meta ads attribution
  return loadDirectChannel(true, bounds, {
    adSpendAED: null,
    clicks: null,
    adsStatus: 'not_configured',
    adsProvider: null,
    adsMetricLabel: null,
  })
}

module.exports = {
  loadWebsiteChannel,
  loadShopChannel,
  INCLUDED_STATUSES,
  EXCLUDED_STATUSES,
  ORDERS_SQL,
}
