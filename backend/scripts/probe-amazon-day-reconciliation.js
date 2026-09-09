#!/usr/bin/env node
'use strict'

/**
 * Read-only Amazon SP-API probe used to reconcile a Dubai calendar day against
 * `amazon_orders` / `amazon_order_items`.
 *
 * Usage: node scripts/probe-amazon-day-reconciliation.js 2026-09-08 uae
 *
 * Prints, per order: status, OrderTotal, item-level prices, and whether the
 * order carries any Amazon-reported money at all. No writes.
 */

require('dotenv').config()

const {
  callAmazonSpApi,
  getAmazonOrderItems,
  getAmazonConfig,
  normalizeMarketplaceKey,
} = require('../src/services/amazonSpApiService')

const dateYmd = process.argv[2] || '2026-09-08'
const marketplaceKey = normalizeMarketplaceKey(process.argv[3] || 'uae')

function dubaiDayBounds(ymd) {
  const start = new Date(`${ymd}T00:00:00.000+04:00`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}

function iso(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

async function fetchAllOrders(cfg, bounds) {
  const pages = []
  let nextToken = null
  let guard = 0
  do {
    const params = nextToken
      ? { NextToken: nextToken, MarketplaceIds: cfg.defaultMarketplaceId }
      : {
          MarketplaceIds: cfg.defaultMarketplaceId,
          CreatedAfter: iso(bounds.start),
          CreatedBefore: iso(bounds.end),
          MaxResultsPerPage: 100,
        }
    const res = await callAmazonSpApi('/orders/v0/orders', {
      marketplaceKey,
      method: 'GET',
      params,
      paramsSerializer: { indexes: null },
      amazonOperation: 'getOrders',
    })
    if (res.status !== 200) {
      console.error('getOrders failed', res.status, JSON.stringify(res.data).slice(0, 400))
      break
    }
    const payload = res.data?.payload || {}
    pages.push(payload.Orders || [])
    nextToken = payload.NextToken || null
    guard += 1
    if (nextToken) await new Promise((r) => setTimeout(r, 1200))
  } while (nextToken && guard < 20)
  return { pages, pageCount: guard }
}

;(async () => {
  const cfg = getAmazonConfig(marketplaceKey)
  const bounds = dubaiDayBounds(dateYmd)
  console.log(
    `# ${marketplaceKey.toUpperCase()} ${dateYmd} | marketplace ${cfg.defaultMarketplaceId} | CreatedAfter ${iso(bounds.start)} CreatedBefore ${iso(bounds.end)}`,
  )
  const { pages, pageCount } = await fetchAllOrders(cfg, bounds)
  const orders = pages.flat()
  console.log(`pages=${pageCount} rowsPerPage=${pages.map((p) => p.length).join(',')} total=${orders.length}`)

  let sumTotal = 0
  let missing = 0
  for (const o of orders) {
    const amt = o.OrderTotal?.Amount != null ? Number(o.OrderTotal.Amount) : null
    if (amt != null) sumTotal += amt
    else missing += 1
    console.log(
      [
        o.AmazonOrderId,
        o.OrderStatus,
        o.PurchaseDate,
        o.OrderTotal?.CurrencyCode || '-',
        amt == null ? 'NO_ORDER_TOTAL' : amt.toFixed(2),
        `shipped=${o.NumberOfItemsShipped} unshipped=${o.NumberOfItemsUnshipped}`,
      ].join(' | '),
    )
  }
  console.log(`SUM(OrderTotal)=${sumTotal.toFixed(2)} ordersWithoutTotal=${missing}`)

  const noTotal = orders.filter((o) => o.OrderTotal?.Amount == null)
  for (const o of noTotal.slice(0, 8)) {
    await new Promise((r) => setTimeout(r, 1500))
    const res = await getAmazonOrderItems(o.AmazonOrderId, { marketplaceKey })
    const items = res.data?.payload?.OrderItems || []
    console.log(
      `-- items for ${o.AmazonOrderId} (${o.OrderStatus}) http=${res.status} count=${items.length}`,
    )
    for (const it of items) {
      console.log(
        '   ',
        JSON.stringify({
          SellerSKU: it.SellerSKU,
          QuantityOrdered: it.QuantityOrdered,
          ItemPrice: it.ItemPrice,
          ItemTax: it.ItemTax,
          ShippingPrice: it.ShippingPrice,
          PromotionDiscount: it.PromotionDiscount,
        }),
      )
    }
  }
})().catch((e) => {
  console.error('probe failed:', e?.message || e)
  process.exit(1)
})
