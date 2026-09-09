'use strict'

/**
 * Marketplace channels (Amazon / Noon / Carrefour) from Zoho Books daily invoices.
 * Optional Amazon fee enrichment from payment clearing by order reference.
 */

const { query } = require('../../../db')
const { computeChannelFinancials } = require('../formulas')
const { round2, toAed, toFiniteNumber } = require('../money')
const { buildChannelShell, CHANNELS } = require('../channels')
const { invoicesToOrders } = require('./zohoDailyInvoicesProvider')

function meta(key) {
  return CHANNELS.find((c) => c.key === key)
}

async function loadAmazonFeesByOrderIds(orderIds, fx) {
  /** @type {Map<string, { commission: number, shipping: number }>} */
  const map = new Map()
  if (!orderIds.length) return map
  try {
    const feesRes = await query(
      `SELECT order_id, category, SUM(amount)::numeric AS amount_sum, MAX(currency) AS currency
       FROM amazon_payment_clearing_rows
       WHERE order_id = ANY($1::text[])
         AND category IN ('Commission', 'FBA / Fulfillment Fee')
       GROUP BY order_id, category`,
      [orderIds],
    )
    for (const row of feesRes.rows || []) {
      const oid = String(row.order_id || '').trim()
      if (!oid) continue
      if (!map.has(oid)) map.set(oid, { commission: 0, shipping: 0 })
      const bucket = map.get(oid)
      const absAmt = Math.abs(toFiniteNumber(row.amount_sum, 0))
      const aed = toAed(absAmt, String(row.currency || 'AED'), fx)
      if (row.category === 'Commission') bucket.commission += aed
      else bucket.shipping += aed
    }
  } catch {
    // optional enrichment
  }
  return map
}

async function loadNoonFeesByOrderIds(orderIds) {
  /** @type {Map<string, { commission: number, shipping: number }>} */
  const map = new Map()
  if (!orderIds.length) return map
  try {
    // Match Zoho references (often NAEI…-1) to clearing parent_order_id / order_nr
    const bases = [
      ...new Set(
        orderIds.flatMap((id) => {
          const ref = String(id || '').trim()
          if (!ref) return []
          return [ref, ref.replace(/-\d+$/, '')]
        }),
      ),
    ]
    const feesRes = await query(
      `SELECT
         COALESCE(NULLIF(TRIM(parent_order_id), ''), NULLIF(TRIM(order_nr), '')) AS oid,
         SUM(ABS(COALESCE(referral_fee, 0)))::numeric AS commission,
         SUM(ABS(COALESCE(shipping_charges, 0)) + ABS(COALESCE(fulfillment_fee, 0)))::numeric AS shipping
       FROM noon_payment_clearing_rows
       WHERE COALESCE(NULLIF(TRIM(parent_order_id), ''), NULLIF(TRIM(order_nr), '')) = ANY($1::text[])
          OR order_nr = ANY($1::text[])
          OR parent_order_id = ANY($1::text[])
       GROUP BY 1`,
      [bases],
    )
    for (const row of feesRes.rows || []) {
      const oid = String(row.oid || '').trim()
      if (!oid) continue
      map.set(oid, {
        commission: round2(row.commission),
        shipping: round2(row.shipping),
      })
    }
  } catch {
    // optional
  }
  return map
}

function matchNoonFee(map, reference) {
  const ref = String(reference || '').trim()
  if (!ref) return null
  if (map.has(ref)) return map.get(ref)
  const base = ref.replace(/-\d+$/, '')
  if (map.has(base)) return map.get(base)
  for (const [k, v] of map.entries()) {
    if (ref.startsWith(k) || k.startsWith(base)) return v
  }
  return null
}

/**
 * @param {string} channelKey
 * @param {object[]} invoices
 * @param {{ rate: number }} fx
 * @param {{ adSpendAED: number|null, clicks: number|null, adsStatus: string, adsProvider: string|null }} ads
 * @param {string[]} zohoWarnings
 */
async function buildMarketplaceChannel(channelKey, invoices, fx, ads, zohoWarnings = []) {
  const channelMeta = meta(channelKey)
  const warnings = [...zohoWarnings]
  const parsed = invoicesToOrders(invoices, {
    currency: channelMeta.currency,
    orderNumberFn: (inv) =>
      String(inv.reference_number || inv.invoice_number || inv.invoice_id || '').trim(),
  })

  let commissionAED = 0
  let shippingAED = 0

  if (channelKey.startsWith('amazon_')) {
    const ids = parsed.orders.map((o) => o.referenceNumber || o.orderNumber).filter(Boolean)
    const fees = await loadAmazonFeesByOrderIds(ids, fx)
    for (const order of parsed.orders) {
      const key = order.referenceNumber || order.orderNumber
      const f = fees.get(String(key))
      if (f) {
        order.commissionAED = round2(f.commission)
        order.shippingAED = round2(f.shipping)
        commissionAED += f.commission
        shippingAED += f.shipping
      }
    }
  }

  if (channelKey.startsWith('noon_')) {
    const ids = parsed.orders.map((o) => o.referenceNumber || o.orderNumber).filter(Boolean)
    const feeMap = await loadNoonFeesByOrderIds(ids)
    for (const order of parsed.orders) {
      const f = matchNoonFee(feeMap, order.referenceNumber || order.orderNumber)
      if (f) {
        order.commissionAED = round2(f.commission)
        order.shippingAED = round2(f.shipping)
        commissionAED += f.commission
        shippingAED += f.shipping
      }
    }
  }

  if (parsed.missingSku > 0) {
    warnings.push(`${channelMeta.label}: ${parsed.missingSku} line(s) missing SKU`)
  }

  // KSA Zoho invoices are often already AED in Books — convert only when currency is SAR
  let salesAmountAED = 0
  for (const order of parsed.orders) {
    const cur = String(order.originalCurrency || channelMeta.currency).toUpperCase()
    const aed = toAed(order.originalAmount || 0, cur, fx)
    order.amountAED = aed
    salesAmountAED += aed
  }
  salesAmountAED = round2(salesAmountAED)
  commissionAED = round2(commissionAED)
  shippingAED = round2(shippingAED)

  const financials = computeChannelFinancials({
    salesAmountAED,
    adSpendAED: ads.adSpendAED,
    commissionAED,
    shippingAED,
  })

  return buildChannelShell(channelMeta, 'available', {
    lastSyncedAt: new Date().toISOString(),
    orders: parsed.orders,
    adsStatus: ads.adsStatus,
    adsProvider: ads.adsProvider,
    warnings,
    summary: {
      quantity: parsed.quantity,
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

function notConfiguredAds(label) {
  return {
    adsStatus: 'not_configured',
    adsProvider: null,
    adSpendAED: null,
    clicks: null,
    warnings: [`${label} advertising: Not Configured`],
  }
}

module.exports = {
  buildMarketplaceChannel,
  notConfiguredAds,
}
