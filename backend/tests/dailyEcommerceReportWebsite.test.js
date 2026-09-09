'use strict'

/**
 * Life Smile website / app / physical-shop side of the Daily Ecommerce Report.
 *
 * The HR & BI backend reads the website platform's own order store server-to-server over TLS with
 * a SELECT-only role; the browser never touches it. These tests cover the channel classification
 * that decides the "(SHOP)" suffix, the Dubai day boundary, multi-item orders, single-precision
 * money columns, and every failure mode being surfaced as a diagnosable Data Error rather than a
 * silent zero.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const NO_ADS = {
  adSpendAED: null,
  clicks: null,
  adsStatus: 'not_configured',
  adsProvider: null,
  adsMetricLabel: 'link_clicks',
}

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

/** @param {{ rows?: object[], error?: Error, configured?: boolean }} website */
function loadProviderWith(website) {
  const calls = []
  const restore = stubModule('../src/db/lifesmileWebsiteDb', {
    ENV_VAR: 'LIFESMILE_WEBSITE_DATABASE_URL',
    isConfigured: () => website.configured !== false,
    readQuery: async (sql, params) => {
      calls.push({ sql, params })
      if (website.error) throw website.error
      return { rows: website.rows || [] }
    },
  })
  const mod = freshModule('../src/services/dailyEcommerceReport/providers/lifeSmileProvider')
  return { mod, calls, restore }
}

const BOUNDS = {
  start: new Date('2026-09-07T20:00:00.000Z'),
  end: new Date('2026-09-08T20:00:00.000Z'),
  dateYmd: '2026-09-08',
}

/** One row as the website returns it: order header repeated per cart line, money already rounded. */
function row(overrides = {}) {
  return {
    id: 10592,
    invoice_number: '20979',
    order_status: 'confirmed',
    total_amount: '118.15',
    sub_total: '139.00',
    discount_amount: '20.85',
    points_redeemed: '0.00',
    wallet_redeemed: null,
    shipping_charge: '0.00',
    refund_amount: null,
    payment_method: 'tamara',
    tabby_payment_id: null,
    tamara_order_id: 'tamara-abc',
    shop_order: false,
    created_at: new Date('2026-09-08T11:15:17.478Z'),
    user_agent: 'app',
    cart_item_id: 501,
    quantity: 1,
    line_amount: '139.00',
    item_cancelled: false,
    item_returned: false,
    item_code: 'LIFEP17-20-BEIGE',
    ...overrides,
  }
}

test('website, app and shop orders share one section, with (SHOP) only on shop sales', async () => {
  const { mod, restore } = loadProviderWith({
    rows: [
      row({ id: 1, invoice_number: '20975', user_agent: 'web', shop_order: false, total_amount: '253.40' }),
      row({ id: 2, invoice_number: '20979', user_agent: 'app', shop_order: false, total_amount: '118.15' }),
      row({
        id: 3,
        invoice_number: '20980',
        user_agent: 'app',
        shop_order: true,
        payment_method: 'pos',
        total_amount: '2038.30',
      }),
    ],
  })
  try {
    const ch = await mod.loadLifeSmileChannel(BOUNDS, NO_ADS)
    assert.equal(ch.integrationStatus, 'available')
    assert.equal(ch.orders.length, 3)
    assert.deepEqual(
      ch.orders.map((o) => o.orderNumber),
      ['20975', '20979', '20980 (SHOP)'],
    )
    assert.deepEqual(
      ch.orders.map((o) => o.sourceChannel),
      ['web', 'app', 'shop'],
    )
    assert.deepEqual(ch.reconciliation.ordersByChannel, { web: 1, app: 1, shop: 1 })
    assert.equal(ch.summary.salesAmountAED, 2409.85)
  } finally {
    restore()
  }
})

test('a multi-item order lists every line and counts the order amount once', async () => {
  const { mod, restore } = loadProviderWith({
    rows: [
      row({ cart_item_id: 1, item_code: 'LIFEP32-32P', quantity: 2, line_amount: '400.00' }),
      row({ cart_item_id: 2, item_code: 'LIFEP32-40P', quantity: 1, line_amount: '157.00' }),
    ],
  })
  try {
    const ch = await mod.loadLifeSmileChannel(BOUNDS, NO_ADS)
    assert.equal(ch.orders.length, 1)
    assert.equal(ch.orders[0].items.length, 2)
    assert.equal(ch.summary.quantity, 3)
    assert.equal(ch.summary.salesAmountAED, 118.15, 'the order total is not added once per line')
    assert.equal(ch.orders[0].items[0].unitAmount, 200)
  } finally {
    restore()
  }
})

test('cancelled and returned orders are excluded; pending and delivered are included', async () => {
  const { mod, restore } = loadProviderWith({
    rows: [
      row({ id: 1, order_status: 'cancelled', total_amount: '118.15' }),
      row({ id: 2, order_status: 'returned', total_amount: '99.00' }),
      row({ id: 3, order_status: 'pending', total_amount: '229.00' }),
      row({ id: 4, order_status: 'delivered', total_amount: '104.55' }),
    ],
  })
  try {
    const ch = await mod.loadLifeSmileChannel(BOUNDS, NO_ADS)
    assert.equal(ch.orders.length, 2)
    assert.equal(ch.summary.salesAmountAED, 333.55)
  } finally {
    restore()
  }
})

test('a partially returned order is reduced by the website refund only', async () => {
  const { mod, restore } = loadProviderWith({
    rows: [row({ order_status: 'partiallyReturned', total_amount: '500.00', refund_amount: '120.00' })],
  })
  try {
    const ch = await mod.loadLifeSmileChannel(BOUNDS, NO_ADS)
    assert.equal(ch.orders[0].amountAED, 380)
    assert.equal(ch.orders[0].originalAmount, 500)
    assert.equal(ch.summary.salesAmountAED, 380)
  } finally {
    restore()
  }
})

test('an order whose cart lines were removed keeps its amount and is flagged', async () => {
  const { mod, restore } = loadProviderWith({
    rows: [
      row({
        cart_item_id: null,
        quantity: null,
        line_amount: null,
        item_code: '',
        item_cancelled: null,
        item_returned: null,
        total_amount: '229.00',
      }),
    ],
  })
  try {
    const ch = await mod.loadLifeSmileChannel(BOUNDS, NO_ADS)
    assert.equal(ch.orders.length, 1, 'the order must not vanish with its cart lines')
    assert.equal(ch.summary.salesAmountAED, 229)
    assert.deepEqual(ch.orders[0].items, [{ sku: '(no line items)', quantity: 0 }])
    assert.ok(ch.warnings.some((w) => /no remaining cart line/.test(w)))
  } finally {
    restore()
  }
})

test('the query asks the website for exactly the Dubai day, with a row cap', async () => {
  const { mod, calls, restore } = loadProviderWith({ rows: [] })
  try {
    await mod.loadLifeSmileChannel(BOUNDS, NO_ADS)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].params.slice(0, 2), [BOUNDS.start, BOUNDS.end])
    assert.equal(typeof calls[0].params[2], 'number')
    assert.match(calls[0].sql, /o\.created_at >= \$1/)
    assert.match(calls[0].sql, /o\.created_at < \$2/)
  } finally {
    restore()
  }
})

test('every money column is rounded in SQL, because the website stores them as real', () => {
  const { ORDERS_SQL } = require('../src/services/dailyEcommerceReport/providers/lifeSmileProvider')
  for (const column of [
    'total_amount',
    'sub_total',
    'discount_amount',
    'points_redeemed',
    'shipping_charge',
    'refund_amount',
  ]) {
    assert.match(
      ORDERS_SQL,
      new RegExp(`ROUND\\(o\\.${column}::numeric, 2\\)`),
      `${column} must be cast to numeric before it reaches JavaScript`,
    )
  }
  assert.match(ORDERS_SQL, /ROUND\(ci\.total_amount::numeric, 2\)/)
  assert.match(ORDERS_SQL, /LEFT JOIN cart_items/, 'an order without cart lines must still be read')
})

test('an authentication or permission failure reads as a diagnosable Data Error, not zero', async () => {
  const error = new Error('permission denied for table orders')
  error.code = 'CATALOG_QUERY_FAILED'
  error.pgCode = '42501'
  const { mod, restore } = loadProviderWith({ error })
  try {
    const ch = await mod.loadLifeSmileChannel(BOUNDS, NO_ADS)
    assert.equal(ch.integrationStatus, 'unavailable')
    assert.equal(ch.summary.salesAmountAED, null, 'a failed read must not report zero sales')
    assert.equal(ch.summary.quantity, null)
    assert.match(ch.errorDetail, /permission denied for table orders/)
    assert.ok(ch.warnings.some((w) => /Data Error/.test(w)))
  } finally {
    restore()
  }
})

test('a connection timeout is surfaced with its real driver message', async () => {
  const error = new Error('timeout expired')
  error.code = 'CATALOG_QUERY_FAILED'
  const { mod, restore } = loadProviderWith({ error })
  try {
    const ch = await mod.loadLifeSmileChannel(BOUNDS, NO_ADS)
    assert.equal(ch.integrationStatus, 'unavailable')
    assert.match(ch.errorDetail, /timeout expired/)
  } finally {
    restore()
  }
})

test('an unset connection is Not Configured and names the environment variable', async () => {
  const { mod, restore } = loadProviderWith({ configured: false })
  try {
    const ch = await mod.loadLifeSmileChannel(BOUNDS, NO_ADS)
    assert.equal(ch.integrationStatus, 'not_configured')
    assert.ok(ch.warnings.some((w) => /LIFESMILE_WEBSITE_DATABASE_URL/.test(w)))
    assert.equal(ch.summary.salesAmountAED, null)
  } finally {
    restore()
  }
})

test('an unexpected response shape is rejected instead of being read as sales', async () => {
  const restore = stubModule('../src/db/lifesmileWebsiteDb', {
    ENV_VAR: 'LIFESMILE_WEBSITE_DATABASE_URL',
    isConfigured: () => true,
    // What a proxy returning HTML, or a schema change, looks like by the time it reaches here.
    readQuery: async () => ({ rows: [{ unexpected: '<html>404</html>' }] }),
  })
  try {
    const mod = freshModule('../src/services/dailyEcommerceReport/providers/lifeSmileProvider')
    const ch = await mod.loadLifeSmileChannel(BOUNDS, NO_ADS)
    // No recognisable order status, so nothing is counted and nothing is invented.
    assert.equal(ch.orders.length, 0)
    assert.equal(ch.summary.salesAmountAED, 0)
    assert.equal(ch.reconciliation.rawRows, 1)
  } finally {
    restore()
  }
})

test('Tabby/Tamara commission is a cost and only applied when the fee rate is configured', async () => {
  const previous = process.env.WEBSITE_TABBY_TAMARA_FEE_PERCENT
  const { mod, restore } = loadProviderWith({
    rows: [row({ payment_method: 'tabby', total_amount: '1000.00' })],
  })
  try {
    process.env.WEBSITE_TABBY_TAMARA_FEE_PERCENT = '6'
    const withFee = await mod.loadLifeSmileChannel(BOUNDS, NO_ADS)
    assert.equal(withFee.summary.salesAmountAED, 1000, 'the fee is never deducted from sales')
    assert.equal(withFee.summary.tabbyTamaraCommissionAED, 60)
    assert.equal(withFee.summary.balanceAED, 940)

    delete process.env.WEBSITE_TABBY_TAMARA_FEE_PERCENT
    const withoutFee = await mod.loadLifeSmileChannel(BOUNDS, NO_ADS)
    assert.equal(withoutFee.summary.tabbyTamaraCommissionAED, 0)
    assert.ok(
      withoutFee.warnings.some((w) => /WEBSITE_TABBY_TAMARA_FEE_PERCENT is not set/.test(w)),
    )
  } finally {
    if (previous === undefined) delete process.env.WEBSITE_TABBY_TAMARA_FEE_PERCENT
    else process.env.WEBSITE_TABBY_TAMARA_FEE_PERCENT = previous
    restore()
  }
})

test('coupon and Smile Points are reported but not added to sales', async () => {
  const { mod, restore } = loadProviderWith({
    rows: [row({ total_amount: '118.15', discount_amount: '20.85', points_redeemed: '5.00' })],
  })
  try {
    const ch = await mod.loadLifeSmileChannel(BOUNDS, NO_ADS)
    assert.equal(ch.summary.salesAmountAED, 118.15)
    assert.equal(ch.summary.smilePointCouponAED, 25.85)
    assert.equal(ch.orders[0].discountAED, 20.85)
    assert.equal(ch.orders[0].smilePointsAED, 5)
  } finally {
    restore()
  }
})

test('the provider reads the website store only, and no customer table', () => {
  const src = require('node:fs').readFileSync(
    require.resolve('../src/services/dailyEcommerceReport/providers/lifeSmileProvider'),
    'utf8',
  )
  assert.ok(!/zoho/i.test(src))
  assert.ok(!/\bcustomers\b/.test(src), 'customer records are out of scope for this report')
})
