'use strict'

/**
 * Amazon side of the Daily Ecommerce Report.
 *
 * Covers the sales definition (`OrderTotal` once per order, item-level fallback, never a silent
 * zero), SAR conversion, deduplication, status filtering, and NextToken pagination in the sync.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { getSarToAedRate } = require('../src/services/dailyEcommerceReport/money')
const { dubaiDayBounds } = require('../src/services/dailyEcommerceReport/dateBounds')

const FX = { rate: getSarToAedRate().rate }
const NO_ADS = { adSpendAED: null, clicks: null, adsStatus: 'not_configured', adsProvider: 'amazon_advertising_reporting_v3' }

/** Replace a module in the require cache so the unit under test gets a stub. */
function stubModule(relativePath, exports) {
  const resolved = require.resolve(relativePath)
  const previous = require.cache[resolved]
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }
  return () => {
    if (previous) require.cache[resolved] = previous
    else delete require.cache[resolved]
  }
}

function freshModule(relativePath) {
  delete require.cache[require.resolve(relativePath)]
  return require(relativePath)
}

/**
 * Load the Amazon provider against canned database rows.
 * @param {{ orders: object[], items: object[], fees?: object[] }} data
 */
function loadProviderWith(data) {
  const restore = stubModule('../src/db', {
    query: async (sql) => {
      if (/FROM amazon_orders/.test(sql)) return { rows: data.orders }
      if (/FROM amazon_order_items/.test(sql)) return { rows: data.items }
      if (/amazon_payment_clearing_rows/.test(sql)) return { rows: data.fees || [] }
      throw new Error(`unexpected query: ${sql}`)
    },
  })
  const mod = freshModule('../src/services/dailyEcommerceReport/providers/amazonOrdersProvider')
  return { mod, restore }
}

function money(amount, currency = 'AED') {
  return { Amount: String(amount), CurrencyCode: currency }
}

test('multi-item order counts OrderTotal once and keeps every SKU', async () => {
  const { mod, restore } = loadProviderWith({
    orders: [
      {
        amazon_order_id: '405-9225207-7653965',
        marketplace_id: 'A2VIGQ35RCS4UG',
        purchase_date: new Date('2026-09-08T13:09:48Z'),
        order_status: 'Shipped',
        currency_code: 'AED',
        order_amount: '275.0000',
        last_synced_at: new Date(),
      },
    ],
    items: [
      { amazon_order_id: '405-9225207-7653965', seller_sku: 'A', quantity_ordered: 1, item_amount: '190.0000', item_currency_code: 'AED', raw_safe_json: { ItemPrice: money(190) } },
      { amazon_order_id: '405-9225207-7653965', seller_sku: 'B', quantity_ordered: 1, item_amount: '85.0000', item_currency_code: 'AED', raw_safe_json: { ItemPrice: money(85) } },
    ],
  })
  try {
    const ch = await mod.loadAmazonChannel('uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.orders.length, 1)
    assert.equal(ch.orders[0].items.length, 2)
    assert.equal(ch.summary.quantity, 2)
    assert.equal(ch.summary.salesAmountAED, 275)
    assert.equal(ch.orders[0].amountSource, 'amazon_order_total')
    assert.equal(ch.reconciliation.ordersFromOrderTotal, 1)
  } finally {
    restore()
  }
})

test('quantity above one does not multiply an already extended line total', async () => {
  const { mod, restore } = loadProviderWith({
    orders: [
      {
        amazon_order_id: '111-1111111-1111111',
        purchase_date: new Date('2026-09-08T10:00:00Z'),
        order_status: 'Shipped',
        currency_code: 'AED',
        order_amount: '300.0000',
        last_synced_at: new Date(),
      },
    ],
    items: [
      { amazon_order_id: '111-1111111-1111111', seller_sku: 'A', quantity_ordered: 3, item_amount: '300.0000', item_currency_code: 'AED', raw_safe_json: { ItemPrice: money(300), QuantityOrdered: 3 } },
    ],
  })
  try {
    const ch = await mod.loadAmazonChannel('uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.summary.quantity, 3)
    assert.equal(ch.summary.salesAmountAED, 300)
  } finally {
    restore()
  }
})

test('missing OrderTotal is derived from Amazon item price, tax, shipping and promotions', () => {
  const { mod, restore } = loadProviderWith({ orders: [], items: [] })
  try {
    const derived = mod.deriveOrderAmountFromItems([
      {
        item_currency_code: 'AED',
        raw_safe_json: {
          ItemPrice: money(100),
          ItemTax: money(5),
          ShippingPrice: money(20),
          ShippingTax: money(1),
          PromotionDiscount: money(10),
          ShippingDiscount: money(2),
        },
      },
    ])
    assert.deepEqual(derived, { amount: 114, currency: 'AED' })
    assert.equal(mod.deriveOrderAmountFromItems([{ raw_safe_json: { QuantityOrdered: 1 } }]), null)
    assert.equal(mod.deriveOrderAmountFromItems([]), null)
  } finally {
    restore()
  }
})

test('a Pending order with no Amazon money is listed without an amount, never as zero', async () => {
  const { mod, restore } = loadProviderWith({
    orders: [
      {
        amazon_order_id: '403-1913864-1040335',
        purchase_date: new Date('2026-09-08T09:00:24Z'),
        order_status: 'Pending',
        currency_code: null,
        order_amount: null,
        last_synced_at: new Date(),
      },
      {
        amazon_order_id: '408-2695079-9809144',
        purchase_date: new Date('2026-09-08T13:39:10Z'),
        order_status: 'Pending',
        currency_code: null,
        order_amount: null,
        last_synced_at: new Date(),
      },
    ],
    items: [
      { amazon_order_id: '403-1913864-1040335', seller_sku: 'X', quantity_ordered: 1, item_amount: null, item_currency_code: null, raw_safe_json: { QuantityOrdered: 1 } },
      { amazon_order_id: '408-2695079-9809144', seller_sku: 'Y', quantity_ordered: 1, item_amount: null, item_currency_code: null, raw_safe_json: { ItemPrice: money(569) } },
    ],
  })
  try {
    const ch = await mod.loadAmazonChannel('uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    const pending = ch.orders.find((o) => o.orderId === '403-1913864-1040335')
    const derived = ch.orders.find((o) => o.orderId === '408-2695079-9809144')
    assert.equal(pending.amountAED, null)
    assert.equal(pending.amountSource, 'pending_at_amazon')
    assert.equal(derived.amountAED, 569)
    assert.equal(derived.amountSource, 'amazon_order_items')
    assert.equal(ch.summary.salesAmountAED, 569)
    assert.equal(ch.reconciliation.ordersWithoutAmazonAmount, 1)
    assert.equal(ch.reconciliation.ordersDerivedFromItems, 1)
    assert.ok(ch.warnings.some((w) => /still Pending at Amazon/.test(w)))
    assert.ok(ch.warnings.some((w) => /derived from Amazon's own item price/.test(w)))
  } finally {
    restore()
  }
})

test('cancelled orders are excluded and repeated order ids are counted once', async () => {
  const row = (id, status, amount) => ({
    amazon_order_id: id,
    purchase_date: new Date('2026-09-08T10:00:00Z'),
    order_status: status,
    currency_code: 'AED',
    order_amount: amount,
    last_synced_at: new Date(),
  })
  const { mod, restore } = loadProviderWith({
    orders: [row('A-1', 'Shipped', '100.0000'), row('A-1', 'Shipped', '100.0000'), row('C-1', 'Canceled', null)],
    items: [{ amazon_order_id: 'A-1', seller_sku: 'S', quantity_ordered: 1, item_amount: '100.0000', item_currency_code: 'AED', raw_safe_json: { ItemPrice: money(100) } }],
  })
  try {
    const ch = await mod.loadAmazonChannel('uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.orders.length, 1)
    assert.equal(ch.summary.salesAmountAED, 100)
    assert.equal(ch.reconciliation.rawOrders, 3)
    assert.equal(ch.reconciliation.uniqueOrderIds, 2)
  } finally {
    restore()
  }
})

test('KSA sales convert from SAR at the report rate and keep two decimals', async () => {
  const { mod, restore } = loadProviderWith({
    orders: [
      {
        amazon_order_id: 'K-1',
        purchase_date: new Date('2026-09-08T10:00:00Z'),
        order_status: 'Shipped',
        currency_code: 'SAR',
        order_amount: '199.9900',
        last_synced_at: new Date(),
      },
    ],
    items: [{ amazon_order_id: 'K-1', seller_sku: 'S', quantity_ordered: 1, item_amount: '199.9900', item_currency_code: 'SAR', raw_safe_json: { ItemPrice: money('199.99', 'SAR') } }],
  })
  try {
    const ch = await mod.loadAmazonChannel('ksa', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    const expected = Math.round(199.99 * FX.rate * 100) / 100
    assert.equal(ch.summary.salesAmountAED, expected)
    assert.equal(ch.orders[0].originalCurrency, 'SAR')
    assert.equal(ch.orders[0].originalAmount, 199.99)
  } finally {
    restore()
  }
})

test('commission and shipping are costs, never deducted from Amazon Amount', async () => {
  const { mod, restore } = loadProviderWith({
    orders: [
      {
        amazon_order_id: 'F-1',
        purchase_date: new Date('2026-09-08T10:00:00Z'),
        order_status: 'Shipped',
        currency_code: 'AED',
        order_amount: '1000.0000',
        last_synced_at: new Date(),
      },
    ],
    items: [{ amazon_order_id: 'F-1', seller_sku: 'S', quantity_ordered: 1, item_amount: '1000.0000', item_currency_code: 'AED', raw_safe_json: { ItemPrice: money(1000) } }],
    fees: [
      { order_id: 'F-1', category: 'Commission', amount_sum: '-150.0000', currency: 'AED' },
      { order_id: 'F-1', category: 'FBA / Fulfillment Fee', amount_sum: '-50.0000', currency: 'AED' },
    ],
  })
  try {
    const ch = await mod.loadAmazonChannel('uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.summary.salesAmountAED, 1000)
    assert.equal(ch.summary.commissionAED, 150)
    assert.equal(ch.summary.shippingAED, 50)
    assert.equal(ch.summary.balanceAED, 800)
    assert.equal(ch.summary.costPercentage, 20)
  } finally {
    restore()
  }
})

test('order sync follows every NextToken page and stops on a repeated token', async () => {
  const pages = [
    { payload: { Orders: [{ AmazonOrderId: '1-1', OrderStatus: 'Shipped', OrderTotal: money(10) }], NextToken: 'tok-2' } },
    { payload: { Orders: [{ AmazonOrderId: '2-2', OrderStatus: 'Shipped', OrderTotal: money(20) }], NextToken: 'tok-3' } },
    { payload: { Orders: [{ AmazonOrderId: '3-3', OrderStatus: 'Shipped', OrderTotal: money(30) }], NextToken: 'tok-3' } },
  ]
  const requestedTokens = []
  let call = 0
  const saved = []

  const restores = [
    stubModule('../src/services/amazonSpApiService', {
      getAmazonOrders: async (params) => {
        if (params.NextToken) requestedTokens.push(params.NextToken)
        const data = pages[Math.min(call, pages.length - 1)]
        call += 1
        return { status: 200, data, amazonRequestId: `req-${call}` }
      },
      getAmazonOrderItems: async () => ({ status: 200, data: { payload: { OrderItems: [] } } }),
      mapAmazonOrderItemSafe: (row) => row,
      normalizeMarketplaceKey: (k) => (k === 'ksa' ? 'ksa' : 'uae'),
      getAmazonConfig: () => ({ defaultMarketplaceId: 'A2VIGQ35RCS4UG' }),
      describeAmazonSpApiFailure: () => null,
    }),
    stubModule('../src/services/amazonRateLimitService', { canStartSync: async () => ({ allowed: true }) }),
    stubModule('../src/services/amazonOrdersCacheStore', {
      insertSyncLog: async () => 1,
      updateSyncLogById: async () => {},
      upsertAmazonOrder: async (row) => {
        saved.push(row.amazonOrderId)
      },
      deleteOrderItemsForOrder: async () => {},
      insertAmazonOrderItem: async () => {},
      markOrderItemsSynced: async () => {},
      selectCachedOrdersWithItems: async () => ({ orders: [], orderCount: 0 }),
    }),
    stubModule('../src/services/amazonSkuImageService', {
      enrichOrdersWithPrimaryItemImages: async (_mk, orders) => orders,
    }),
  ]

  try {
    const sync = freshModule('../src/services/amazonOrdersSyncService')
    const result = await sync.syncAmazonOrders({
      marketplaceKey: 'uae',
      createdAfter: new Date('2026-09-07T20:00:00Z'),
      createdBefore: new Date('2026-09-08T20:00:00Z'),
      includeItems: false,
    })
    assert.deepEqual(requestedTokens, ['tok-2', 'tok-3'])
    assert.equal(result.pagesFetched, 3)
    assert.equal(result.ordersFetched, 3)
    assert.deepEqual(saved, ['1-1', '2-2', '3-3'])
    assert.equal(result.truncated, true, 'a repeated cursor must end paging instead of looping')
  } finally {
    for (const restore of restores) restore()
    delete require.cache[require.resolve('../src/services/amazonOrdersSyncService')]
  }
})

test('the item payload whitelist keeps the full money breakdown and no buyer data', () => {
  delete require.cache[require.resolve('../src/services/amazonSpApiService')]
  const { mapAmazonOrderItemSafe } = require('../src/services/amazonSpApiService')
  const safe = mapAmazonOrderItemSafe({
    SellerSKU: 'SKU-1',
    QuantityOrdered: 2,
    ItemPrice: money(100),
    ItemTax: money(5),
    ShippingPrice: money(10),
    ShippingTax: money(1),
    ShippingDiscount: money(2),
    ShippingDiscountTax: money(0),
    PromotionDiscount: money(3),
    PromotionDiscountTax: money(0),
    BuyerInfo: { BuyerEmail: 'no@no.example' },
    ShippingAddress: { City: 'Dubai' },
  })
  for (const key of [
    'ItemPrice',
    'ItemTax',
    'ShippingPrice',
    'ShippingTax',
    'ShippingDiscount',
    'ShippingDiscountTax',
    'PromotionDiscount',
    'PromotionDiscountTax',
  ]) {
    assert.ok(safe[key], `${key} must be stored so an amount can be derived`)
  }
  assert.equal(safe.BuyerInfo, undefined)
  assert.equal(safe.ShippingAddress, undefined)
})

test('provider file lives in the report tree and reads only Amazon tables', () => {
  const file = path.join(
    __dirname,
    '..',
    'src',
    'services',
    'dailyEcommerceReport',
    'providers',
    'amazonOrdersProvider.js',
  )
  const src = require('node:fs').readFileSync(file, 'utf8')
  assert.ok(/FROM amazon_orders/.test(src))
  assert.ok(/FROM amazon_order_items/.test(src))
  assert.ok(!/invoice/i.test(src))
})
