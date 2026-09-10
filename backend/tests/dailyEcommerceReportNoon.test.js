'use strict'

/**
 * Noon side of the Daily Ecommerce Report.
 *
 * Noon's marketplace order feed is an export job, not a paged list endpoint, so the loop that has
 * to be right is the status poll: it must keep asking until Noon publishes a download, never treat
 * a still-running export as an empty day, and never loop forever. These tests cover that poll, the
 * CSV parsing, the UAE/KSA split from Noon's own country field, and the report aggregation
 * (multi-unit orders, cancelled lines, Pending money before settlement).
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { getSarToAedRate } = require('../src/services/dailyEcommerceReport/money')
const { dubaiDayBounds } = require('../src/services/dailyEcommerceReport/dateBounds')

const FX = { rate: getSarToAedRate().rate }
const NO_ADS = { adSpendAED: null, clicks: null, adsStatus: 'not_configured', adsProvider: null }

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

function lastRunFor(data) {
  if (data.lastRun !== undefined) return data.lastRun
  return { from_date: '2026-09-07', to_date: '2026-09-08', finished_at: new Date('2026-09-09T08:00:00Z') }
}

/**
 * @param {{ lines: object[], finance?: object[], statements?: object[], countries?: [string, number][],
 *           lastRun?: object|null, skuSales?: object[], skuSalesError?: Error }} data
 */
function loadProviderWith(data) {
  const restores = [
    stubModule('../src/services/noon/noonOrdersStore', {
      ensureNoonOrderTables: async () => {},
      selectNoonOrderLines: async ({ countryCode }) =>
        data.lines.filter((l) => String(l.country_code).toUpperCase() === countryCode.toUpperCase()),
      countLinesByCountry: async () => new Map(data.countries || [['AE', data.lines.length]]),
      selectNoonFinanceByOrders: async (orderNumbers) =>
        (data.finance || []).filter((r) => orderNumbers.includes(r.order_nr)),
      selectNoonSkuDailySales: async () => {
        if (data.skuSalesError) throw data.skuSalesError
        return data.skuSales || []
      },
      selectLastSuccessfulRun: async () => lastRunFor(data),
      // Mirrors the store's own `from_date <= ymd AND to_date >= ymd` filter.
      findSuccessfulRunCoveringDate: async (_category, ymd) => {
        const run = lastRunFor(data)
        if (!run) return null
        return run.from_date <= ymd && run.to_date >= ymd ? run : null
      },
    }),
    stubModule('../src/services/noon/noonConfig', {
      readNoonConfig: () => ({ configured: true, enabled: true, projectCode: 'PRJ11752', missing: [] }),
    }),
    stubModule('../src/db', {
      query: async (sql, params) => {
        if (/noon_payment_clearing_rows/.test(sql)) {
          const wanted = params[0]
          return { rows: (data.statements || []).filter((r) => wanted.includes(r.order_nr)) }
        }
        if (/noon_product_snapshots/.test(sql)) return { rows: data.snapshots || [] }
        throw new Error(`unexpected query: ${sql}`)
      },
    }),
  ]
  const mod = freshModule('../src/services/dailyEcommerceReport/providers/noonOrdersProvider')
  return { mod, restore: () => restores.forEach((r) => r()) }
}

function line(orderNr, itemNr, overrides = {}) {
  return {
    country_code: 'AE',
    order_nr: orderNr,
    item_nr: itemNr,
    noon_sku: 'ZAAAAAAAAAAAAAAAAAAAZ-1',
    partner_sku: null,
    item_status: 'shipped',
    order_placed_at: new Date('2026-09-08T09:00:00Z'),
    last_synced_at: new Date('2026-09-09T12:00:00Z'),
    ...overrides,
  }
}

test('an order with several Noon item numbers keeps its real quantity and appears once', async () => {
  const { mod, restore } = loadProviderWith({
    lines: [
      line('NAEI90045069032', 'NAEI90045069032-1'),
      line('NAEI90045069032', 'NAEI90045069032-2'),
      line('NAEI90045069032', 'NAEI90045069032-3'),
      line('NAEI90079648553', 'NAEI90079648553-1'),
    ],
  })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.orders.length, 2)
    const multi = ch.orders.find((o) => o.orderNumber === 'NAEI90045069032')
    assert.equal(multi.items.length, 1, 'three units of one SKU collapse into one line')
    assert.equal(multi.items[0].quantity, 3)
    assert.equal(ch.summary.quantity, 4)
    assert.equal(ch.reconciliation.rawApiLines, 4)
    assert.equal(ch.reconciliation.uniqueOrderIds, 2)
    assert.equal(ch.reconciliation.includedOrders, 2)
  } finally {
    restore()
  }
})

test('more than two orders are reported — the report imposes no order limit', async () => {
  const lines = Array.from({ length: 37 }, (_, i) =>
    line(`NAEI9000000${String(i).padStart(4, '0')}`, `item-${i}`, {
      order_placed_at: new Date(Date.UTC(2026, 8, 8, 4 + (i % 12), i)),
    }),
  )
  const { mod, restore } = loadProviderWith({ lines })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.orders.length, 37)
    assert.equal(ch.summary.quantity, 37)
  } finally {
    restore()
  }
})

test('UAE and KSA are split by Noon’s own marketplace country, never mixed', async () => {
  const { mod, restore } = loadProviderWith({
    lines: [
      line('NAEI90045069032', 'NAEI90045069032-1'),
      line('NSAI80001111111', 'NSAI80001111111-1', { country_code: 'SA' }),
    ],
    countries: [
      ['AE', 1],
      ['SA', 1],
    ],
  })
  try {
    const uae = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    const ksa = await mod.loadNoonChannel('noon_ksa', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.deepEqual(uae.orders.map((o) => o.orderNumber), ['NAEI90045069032'])
    assert.deepEqual(ksa.orders.map((o) => o.orderNumber), ['NSAI80001111111'])
    assert.equal(mod.countryCodeFor('noon_uae'), 'AE')
    assert.equal(mod.countryCodeFor('noon_ksa'), 'SA')
  } finally {
    restore()
  }
})

test('a country the partner account has no contract for reads Not Configured, not an empty day', async () => {
  const { mod, restore } = loadProviderWith({
    lines: [line('NAEI90045069032', 'NAEI90045069032-1')],
    countries: [['AE', 306]],
  })
  try {
    const ksa = await mod.loadNoonChannel('noon_ksa', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ksa.integrationStatus, 'not_configured')
    assert.equal(ksa.summary.salesAmountAED, null, 'an unread channel must not report zero sales')
    assert.equal(ksa.summary.quantity, null)
    assert.ok(ksa.warnings.some((w) => /no SA marketplace contract/.test(w)))
  } finally {
    restore()
  }
})

test('an export that has never run is Pending, not an empty day', async () => {
  const { mod, restore } = loadProviderWith({ lines: [], lastRun: null, countries: [] })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.integrationStatus, 'pending')
    assert.equal(ch.summary.quantity, null)
    assert.equal(ch.summary.salesAmountAED, null)
    assert.ok(ch.warnings.some((w) => /no Noon orders export has covered 2026-09-08/.test(w)))
  } finally {
    restore()
  }
})

test('a day no export window reached is Pending, even though earlier days were exported', async () => {
  // The export that ran covered 7–8 September, so it says nothing about the 9th: reporting AED 0
  // for the 9th would claim Noon sold nothing on a day Noon was never asked about.
  const { mod, restore } = loadProviderWith({
    lines: [],
    lastRun: { from_date: '2026-09-07', to_date: '2026-09-08', finished_at: new Date('2026-09-09T08:00:00Z') },
    countries: [['AE', 12]],
  })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-09'), FX, NO_ADS)
    assert.equal(ch.integrationStatus, 'pending')
    assert.equal(ch.summary.salesAmountAED, null)
    assert.equal(ch.summary.quantity, null)
    assert.ok(
      ch.warnings.some((w) => /no Noon orders export has covered 2026-09-09/.test(w)),
      'the warning must name the uncovered date and the window that was covered',
    )
    assert.ok(ch.warnings.some((w) => /2026-09-07 → 2026-09-08/.test(w)))
  } finally {
    restore()
  }
})

test('a day the export did cover, with no order, is a real zero', async () => {
  const { mod, restore } = loadProviderWith({
    lines: [],
    lastRun: { from_date: '2026-09-08', to_date: '2026-09-08', finished_at: new Date('2026-09-09T08:00:00Z') },
    countries: [['AE', 12]],
  })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.integrationStatus, 'available')
    assert.equal(ch.summary.salesAmountAED, 0)
    assert.equal(ch.summary.quantity, 0)
    assert.ok(ch.warnings.some((w) => /returned no AE order for 2026-09-08/.test(w)))
  } finally {
    restore()
  }
})

test('cancelled Noon item lines are excluded and counted', async () => {
  const { mod, restore } = loadProviderWith({
    lines: [
      line('NAEI90002098801', 'NAEI90002098801-1', { item_status: 'cancelled' }),
      line('NAEI90079648553', 'NAEI90079648553-1'),
    ],
  })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.orders.length, 1)
    assert.equal(ch.reconciliation.cancelledLines, 1)
    assert.ok(ch.warnings.some((w) => /1 cancelled Noon item line/.test(w)))
  } finally {
    restore()
  }
})

test('unsettled orders show Pending money; settled ones use Noon’s finance report', async () => {
  const { mod, restore } = loadProviderWith({
    lines: [
      line('NAEI80000105300', 'NAEI80000105300-1'),
      line('NAEI90079648553', 'NAEI90079648553-1'),
    ],
    finance: [
      {
        order_nr: 'NAEI80000105300',
        net_proceeds: '120.5000',
        referral_fee: '-12.0000',
        logistics: '-8.5000',
        currency: 'AED',
      },
    ],
  })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    const settled = ch.orders.find((o) => o.orderNumber === 'NAEI80000105300')
    const pending = ch.orders.find((o) => o.orderNumber === 'NAEI90079648553')
    assert.equal(settled.amountAED, 120.5)
    assert.equal(settled.commissionAED, 12)
    assert.equal(settled.shippingAED, 8.5)
    assert.equal(settled.amountSource, 'noon_finance_transaction_report')
    assert.equal(pending.amountAED, null)
    assert.equal(pending.amountSource, 'pending_noon_settlement')
    assert.equal(ch.summary.salesAmountAED, 120.5)
    assert.equal(ch.reconciliation.settledOrders, 1)
    assert.ok(ch.warnings.some((w) => /has not settled 1 of 2 order/.test(w)))
  } finally {
    restore()
  }
})

test('the finance API report wins over a re-imported settlement statement', async () => {
  const { mod, restore } = loadProviderWith({
    lines: [line('NAEI80000105300', 'NAEI80000105300-1')],
    finance: [
      { order_nr: 'NAEI80000105300', net_proceeds: '120.5000', referral_fee: '0', logistics: '0', currency: 'AED' },
    ],
    statements: [
      { order_nr: 'NAEI80000105300', net_proceed: '999.0000', referral_fee: '0', logistics: '0', currency: 'AED' },
    ],
  })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.summary.salesAmountAED, 120.5, 'the same order must not be counted twice')
    assert.equal(ch.orders[0].amountSource, 'noon_finance_transaction_report')
  } finally {
    restore()
  }
})

test('a failing money lookup leaves the orders listed with Pending money', async () => {
  const restores = [
    stubModule('../src/services/noon/noonOrdersStore', {
      ensureNoonOrderTables: async () => {},
      selectNoonOrderLines: async () => [line('NAEI90079648553', 'NAEI90079648553-1')],
      countLinesByCountry: async () => new Map([['AE', 1]]),
      selectNoonSkuDailySales: async () => [],
      selectNoonFinanceByOrders: async () => {
        throw new Error('finance cache unreachable')
      },
      selectLastSuccessfulRun: async () => ({ from_date: '2026-09-08', to_date: '2026-09-08' }),
      findSuccessfulRunCoveringDate: async () => ({ from_date: '2026-09-08', to_date: '2026-09-08' }),
    }),
    stubModule('../src/services/noon/noonConfig', {
      readNoonConfig: () => ({ configured: true, enabled: true, projectCode: 'PRJ11752', missing: [] }),
    }),
    stubModule('../src/db', { query: async () => ({ rows: [] }) }),
  ]
  try {
    const mod = freshModule('../src/services/dailyEcommerceReport/providers/noonOrdersProvider')
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.integrationStatus, 'available')
    assert.equal(ch.orders.length, 1, 'one broken feed must not erase the orders the other returned')
    assert.equal(ch.summary.salesAmountAED, null)
    assert.ok(ch.warnings.some((w) => /settlement lookup failed/.test(w)))
  } finally {
    restores.forEach((r) => r())
  }
})

test('Dubai day boundaries decide inclusion, using the Noon order timestamp in UTC', async () => {
  const bounds = dubaiDayBounds('2026-09-08')
  assert.equal(bounds.start.toISOString(), '2026-09-07T20:00:00.000Z')
  assert.equal(bounds.end.toISOString(), '2026-09-08T20:00:00.000Z')

  const inside = line('NAEI-IN', 'NAEI-IN-1', { order_placed_at: new Date('2026-09-08T19:59:59Z') })
  const after = line('NAEI-OUT', 'NAEI-OUT-1', { order_placed_at: new Date('2026-09-08T20:00:00Z') })
  const restores = [
    stubModule('../src/services/noon/noonOrdersStore', {
      ensureNoonOrderTables: async () => {},
      // Mirrors the store's own `>= start AND < end` filter.
      selectNoonOrderLines: async ({ start, end }) =>
        [inside, after].filter((l) => l.order_placed_at >= start && l.order_placed_at < end),
      countLinesByCountry: async () => new Map([['AE', 2]]),
      selectNoonSkuDailySales: async () => [],
      selectNoonFinanceByOrders: async () => [],
      selectLastSuccessfulRun: async () => ({ from_date: '2026-09-08', to_date: '2026-09-08' }),
      findSuccessfulRunCoveringDate: async () => ({ from_date: '2026-09-08', to_date: '2026-09-08' }),
    }),
    stubModule('../src/services/noon/noonConfig', {
      readNoonConfig: () => ({ configured: true, enabled: true, projectCode: 'PRJ11752', missing: [] }),
    }),
    stubModule('../src/db', { query: async () => ({ rows: [] }) }),
  ]
  try {
    const mod = freshModule('../src/services/dailyEcommerceReport/providers/noonOrdersProvider')
    const ch = await mod.loadNoonChannel('noon_uae', bounds, FX, NO_ADS)
    assert.deepEqual(ch.orders.map((o) => o.orderNumber), ['NAEI-IN'])
  } finally {
    restores.forEach((r) => r())
  }
})

test('the export poll waits for Noon to publish a download instead of reporting no orders', async () => {
  const statuses = ['PENDING', 'RUNNING', 'RUNNING', 'COMPLETE']
  let statusCalls = 0
  const restores = [
    stubModule('../src/services/noon/noonClient', {
      noonPost: async (path) => {
        if (path.endsWith('/create')) return { data: { export_code: 'EXP1' } }
        const status = statuses[Math.min(statusCalls, statuses.length - 1)]
        statusCalls += 1
        return {
          data: {
            export_status: status,
            download_url: status === 'COMPLETE' ? 'https://example.invalid/export.csv' : null,
          },
        }
      },
      noonGet: async () => ({ data: {} }),
    }),
    stubModule('axios', {
      get: async () => ({
        data: Buffer.from(
          'order_nr,item_nr,sku,item_status,order_placed_at,market_place_country_code,market_place\n' +
            'NAEI1,NAEI1-1,ZAAAZ-1,shipped,2026-09-08 09:00:00 UTC,AE,noon\n' +
            'NAEI2,NAEI2-1,ZBBBZ-1,delivered,2026-09-08 11:00:00 UTC,AE,noon\n',
        ),
      }),
    }),
  ]
  try {
    const svc = freshModule('../src/services/noon/noonOrdersExportService')
    const result = await svc.runExport({
      exportCategoryCode: svc.ORDERS_EXPORT_CATEGORY,
      params: { from_date: '2026-09-08', to_date: '2026-09-08' },
      sleepFn: async () => {},
    })
    assert.equal(result.exportCode, 'EXP1')
    assert.equal(result.pollCount, 4, 'the poll must continue while Noon reports PENDING/RUNNING')
    assert.equal(result.rows.length, 2)
    assert.equal(result.rows[0].order_nr, 'NAEI1')
  } finally {
    restores.forEach((r) => r())
    delete require.cache[require.resolve('../src/services/noon/noonOrdersExportService')]
  }
})

test('an export that never completes raises a timeout rather than an empty result', async () => {
  const restores = [
    stubModule('../src/services/noon/noonClient', {
      noonPost: async (path) =>
        path.endsWith('/create')
          ? { data: { export_code: 'EXP2' } }
          : { data: { export_status: 'RUNNING', download_url: null } },
      noonGet: async () => ({ data: {} }),
    }),
    stubModule('axios', { get: async () => ({ data: Buffer.from('') }) }),
  ]
  try {
    const svc = freshModule('../src/services/noon/noonOrdersExportService')
    await assert.rejects(
      svc.runExport({
        exportCategoryCode: svc.ORDERS_EXPORT_CATEGORY,
        params: {},
        sleepFn: async () => {},
      }),
      (err) => err.code === 'NOON_EXPORT_TIMEOUT' && err.pollCount > 0,
    )
  } finally {
    restores.forEach((r) => r())
    delete require.cache[require.resolve('../src/services/noon/noonOrdersExportService')]
  }
})

test('a failed export is reported as failed, never as zero orders', async () => {
  const restores = [
    stubModule('../src/services/noon/noonClient', {
      noonPost: async (path) =>
        path.endsWith('/create')
          ? { data: { export_code: 'EXP3' } }
          : { data: { export_status: 'FAILED', download_url: null } },
      noonGet: async () => ({ data: {} }),
    }),
    stubModule('axios', { get: async () => ({ data: Buffer.from('') }) }),
  ]
  try {
    const svc = freshModule('../src/services/noon/noonOrdersExportService')
    await assert.rejects(
      svc.runExport({ exportCategoryCode: 'x', params: {}, sleepFn: async () => {} }),
      (err) => err.code === 'NOON_EXPORT_FAILED',
    )
  } finally {
    restores.forEach((r) => r())
    delete require.cache[require.resolve('../src/services/noon/noonOrdersExportService')]
  }
})

test('the export CSV parser handles quoted fields, embedded commas and blank rows', () => {
  const svc = require('../src/services/noon/noonOrdersExportService')
  const rows = svc.parseCsv(
    'order_nr,title,item_status\r\n' +
      'NAEI1,"Pan, 24cm ""non-stick""",shipped\r\n' +
      '\r\n' +
      'NAEI2,Simple,delivered\r\n',
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[0].title, 'Pan, 24cm "non-stick"')
  assert.equal(rows[1].order_nr, 'NAEI2')
})

test('Noon timestamps parse from its "YYYY-MM-DD HH:MM:SS UTC" format', () => {
  const svc = require('../src/services/noon/noonOrdersExportService')
  assert.equal(
    svc.parseNoonTimestamp('2026-09-07 06:03:52 UTC').toISOString(),
    '2026-09-07T06:03:52.000Z',
  )
  assert.equal(svc.parseNoonTimestamp(''), null)
  assert.equal(svc.parseNoonTimestamp('not-a-date'), null)
})

test('finance rows map Noon money and drop account-level lines that belong to no order', () => {
  const svc = require('../src/services/noon/noonOrdersExportService')
  const now = new Date()
  const mapped = svc.mapFinanceRow(
    {
      Contract: 'MPABUKYTZQAE',
      'Contract Title': 'NOON-AE',
      'Reference Nr': 'PS-11752-AE20260831',
      'Order Nr': 'NAEI80000105300',
      'Item Nr': '',
      'Order Date': '2026-08-25',
      'Transaction Date': '2026-08-31',
      'Transaction Type': 'order',
      Currency: 'AED',
      'Net Proceeds': '120.50',
      'Referral Fee including VAT': '-12',
      'Fullfilment & Logistics Fees including VAT': '-37.8',
      'Shipping Credits including VAT': '0',
      Total: '70.70',
    },
    now,
  )
  assert.equal(mapped.orderNr, 'NAEI80000105300')
  assert.equal(mapped.countryCode, 'AE')
  assert.equal(mapped.netProceeds, 120.5)
  assert.equal(mapped.fulfillmentFee, -37.8)
  assert.equal(mapped.transactionDate, '2026-08-31')
  assert.equal(mapped.transactionType, 'order')

  // Advertising and other statement-level fees carry "NA" as the order number.
  assert.equal(
    svc.mapFinanceRow({ 'Order Nr': 'NA', 'Transaction Type': 'statement_fee' }, now),
    null,
  )
})

test("Noon's sales report rows map their units and revenue, and browse-only rows carry no price", () => {
  const { mapSkuSalesRow } = require('../src/services/noon/noonOrdersExportService')
  const now = new Date('2026-09-10T06:00:00Z')

  const sold = mapSkuSalesRow(
    {
      Visit_Date: '2026-09-08',
      Partner_SKU: 'LIFEP7-MIX-29-5C-GRAY',
      SKU: 'Z15BF5B8CB05061E0D9BDZ-1',
      Currency_Code: 'AED',
      Country_Code: 'AE',
      Your_Visitors: '4',
      Gross_Units: '2',
      Shipped_Units: '2',
      Cancelled_Units: '0',
      Revenue_Shipped: '1330',
    },
    now,
  )
  assert.equal(sold.noonSku, 'Z15BF5B8CB05061E0D9BDZ-1')
  assert.equal(sold.partnerSku, 'LIFEP7-MIX-29-5C-GRAY')
  assert.equal(sold.salesDate, '2026-09-08')
  assert.equal(sold.countryCode, 'AE')
  assert.equal(sold.revenueShipped, 1330)
  assert.equal(sold.shippedUnits, 2)

  // Most rows in this report are products that were only browsed. Their blank cells must not become
  // zeros that look like a real zero-priced sale.
  const browsed = mapSkuSalesRow(
    {
      Visit_Date: '2026-09-08',
      SKU: 'ZBROWSEDZ-1',
      Country_Code: 'AE',
      Your_Visitors: '1',
      Gross_Units: '',
      Shipped_Units: '',
      Cancelled_Units: '',
      Revenue_Shipped: '',
    },
    now,
  )
  assert.equal(browsed.revenueShipped, null)
  assert.equal(browsed.shippedUnits, null)

  assert.equal(mapSkuSalesRow({ SKU: 'ZXZ-1', Visit_Date: 'not-a-date' }, now), null)
  assert.equal(mapSkuSalesRow({ SKU: '', Visit_Date: '2026-09-08' }, now), null)
})

/** One row of Noon's per-SKU daily sales report. */
function skuSales(noonSku, overrides = {}) {
  return {
    noon_sku: noonSku,
    partner_sku: null,
    currency: 'AED',
    gross_units: '1',
    shipped_units: '1',
    cancelled_units: '0',
    revenue_shipped: '100',
    last_synced_at: new Date('2026-09-09T12:00:00Z'),
    ...overrides,
  }
}

/**
 * The 2026-09-08 Noon UAE regression: Noon settles an order 1–8 days after it is placed, so summing
 * only the settled orders reported AED 590 of a day Noon itself puts at AED 2,329. The unsettled
 * orders have to be valued from Noon's own per-SKU sales report.
 */
test("unsettled Noon orders are valued from Noon's own per-SKU sales report", async () => {
  const { mod, restore } = loadProviderWith({
    lines: [
      line('NAEI90030698898', 'NAEI90030698898-1', { noon_sku: 'ZA6F6C76B118328A2B8FBZ-1', item_status: 'delivered' }),
      line('NAEI90054571054', 'NAEI90054571054-1', { noon_sku: 'Z15BF5B8CB05061E0D9BDZ-1' }),
      line('NAEI90039477915', 'NAEI90039477915-1', { noon_sku: 'Z15BF5B8CB05061E0D9BDZ-1' }),
    ],
    // Only the first order has reached a Noon statement.
    finance: [
      { order_nr: 'NAEI90030698898', net_proceeds: '474', referral_fee: '-74.66', logistics: '0', currency: 'AED' },
    ],
    skuSales: [
      skuSales('ZA6F6C76B118328A2B8FBZ-1', { revenue_shipped: '474', shipped_units: '1', gross_units: '1' }),
      // Two units of the same SKU sold that day for 1330 in total, so 665 each.
      skuSales('Z15BF5B8CB05061E0D9BDZ-1', { revenue_shipped: '1330', shipped_units: '2', gross_units: '2' }),
    ],
  })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.summary.salesAmountAED, 1804, '474 settled + 665 + 665 from the sales report')
    assert.equal(ch.reconciliation.settledOrders, 1)
    assert.equal(ch.reconciliation.ordersFromSalesReport, 2)
    assert.equal(ch.reconciliation.ordersWithoutNoonAmount, 0)

    const settledOrder = ch.orders.find((o) => o.orderId === 'NAEI90030698898')
    assert.equal(settledOrder.amountSource, 'noon_finance_transaction_report')
    assert.equal(settledOrder.amountAED, 474)
    assert.equal(settledOrder.commissionAED, 74.66)

    const priced = ch.orders.find((o) => o.orderId === 'NAEI90054571054')
    assert.equal(priced.amountSource, 'noon_sku_daily_sales_report')
    assert.equal(priced.amountAED, 665)
    // Noon publishes fees only at settlement, so they stay Pending rather than becoming zero.
    assert.equal(priced.commissionAED, null)
    assert.equal(priced.shippingAED, null)

    // Commission covers only the settled order, so it must not be presented as the day's commission
    // without saying that the rest is Pending.
    assert.equal(ch.summary.commissionAED, 74.66)
    assert.ok(ch.warnings.some((w) => /valued from Noon's own per-SKU sales report/.test(w)))
    assert.ok(ch.warnings.some((w) => /has not settled 2 of 3 order\(s\)/.test(w)))
  } finally {
    restore()
  }
})

test('a settled order keeps its settled value even when the sales report disagrees', async () => {
  // Verified on 2026-09-08: order NAEI90088924890 showed 35 in the sales report but settled at 0
  // because it was returned. Settlement is what Noon actually pays, so it wins.
  const { mod, restore } = loadProviderWith({
    lines: [line('NAEI90088924890', 'NAEI90088924890-1', { noon_sku: 'Z8B25C016097B404F1DB6Z-1' })],
    finance: [
      { order_nr: 'NAEI90088924890', net_proceeds: '0', referral_fee: '0', logistics: '0', currency: 'AED' },
    ],
    skuSales: [skuSales('Z8B25C016097B404F1DB6Z-1', { revenue_shipped: '35' })],
  })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.orders[0].amountAED, 0)
    assert.equal(ch.orders[0].amountSource, 'noon_finance_transaction_report')
    assert.equal(ch.summary.salesAmountAED, 0)
  } finally {
    restore()
  }
})

test('an order the sales report cannot price fully stays Pending and the shortfall is stated', async () => {
  const { mod, restore } = loadProviderWith({
    lines: [
      line('NAEI90000000001', 'NAEI90000000001-1', { noon_sku: 'ZPRICEDZ-1' }),
      line('NAEI90000000002', 'NAEI90000000002-1', { noon_sku: 'ZUNKNOWNZ-1' }),
    ],
    finance: [],
    skuSales: [skuSales('ZPRICEDZ-1', { revenue_shipped: '250' })],
  })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.summary.salesAmountAED, 250)
    assert.equal(ch.reconciliation.ordersWithoutNoonAmount, 1)
    assert.equal(ch.orders.find((o) => o.orderId === 'NAEI90000000002').amountAED, null)
    // The number shown is smaller than the real day, so the report has to say so out loud.
    assert.ok(
      ch.warnings.some((w) => /Noon Amount is lower than the real day/.test(w)),
      'a partial total must never be presented as the whole day',
    )
  } finally {
    restore()
  }
})

test('a multi-unit order is priced per unit, not once', async () => {
  const { mod, restore } = loadProviderWith({
    lines: [
      line('NAEI90000000003', 'NAEI90000000003-1', { noon_sku: 'ZMULTIZ-1' }),
      line('NAEI90000000003', 'NAEI90000000003-2', { noon_sku: 'ZMULTIZ-1' }),
      line('NAEI90000000003', 'NAEI90000000003-3', { noon_sku: 'ZMULTIZ-1' }),
    ],
    finance: [],
    skuSales: [skuSales('ZMULTIZ-1', { revenue_shipped: '300', shipped_units: '3', gross_units: '3' })],
  })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.summary.quantity, 3)
    assert.equal(ch.orders[0].amountAED, 300, '100 per unit times three units')
  } finally {
    restore()
  }
})

test('a SKU that shipped nothing yet is still priced from its gross units', async () => {
  const { mod, restore } = loadProviderWith({
    lines: [line('NAEI90000000004', 'NAEI90000000004-1', { noon_sku: 'ZFRESHZ-1', item_status: 'exported' })],
    finance: [],
    skuSales: [skuSales('ZFRESHZ-1', { shipped_units: '0', gross_units: '2', revenue_shipped: '240' })],
  })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.orders[0].amountAED, 120)
  } finally {
    restore()
  }
})

test('a refunded Noon settlement is not flipped into a positive sale', async () => {
  // Noon posts a refund as a negative order_update against the original order. Taking the absolute
  // value of the summed proceeds would turn a refund back into revenue.
  const { mod, restore } = loadProviderWith({
    lines: [line('NAEI90000000005', 'NAEI90000000005-1')],
    finance: [
      { order_nr: 'NAEI90000000005', net_proceeds: '-120', referral_fee: '-10', logistics: '0', currency: 'AED' },
    ],
  })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.orders[0].amountAED, -120)
    assert.equal(ch.summary.salesAmountAED, -120)
    assert.equal(ch.orders[0].commissionAED, 10, 'fees are costs, so they are reported positive')
  } finally {
    restore()
  }
})

test('a failed sales-report lookup warns instead of quietly shrinking the Noon day', async () => {
  const { mod, restore } = loadProviderWith({
    lines: [line('NAEI90000000006', 'NAEI90000000006-1')],
    finance: [],
    skuSalesError: new Error('relation "noon_sku_daily_sales" does not exist'),
  })
  try {
    const ch = await mod.loadNoonChannel('noon_uae', dubaiDayBounds('2026-09-08'), FX, NO_ADS)
    assert.equal(ch.summary.salesAmountAED, null)
    assert.ok(ch.warnings.some((w) => /per-SKU sales lookup failed/.test(w)))
  } finally {
    restore()
  }
})

test('Noon provider reads no accounting system and no catalog price', () => {
  const src = require('node:fs').readFileSync(
    require.resolve('../src/services/dailyEcommerceReport/providers/noonOrdersProvider'),
    'utf8',
  )
  assert.ok(!/zoho/i.test(src))
  // A catalog or offer price is what an item is listed at, not what it sold for, so it must never
  // become a sale amount. Noon's per-SKU sales report is a different thing: it is the revenue Noon
  // itself booked for that SKU on that day, and the unit price is derived from it.
  for (const forbidden of [
    /sale_price/,
    /offer_price/,
    /list_price/,
    /\bmsrp\b/i,
    /pricing\/v1/,
    /noonProductService/,
    /noonSnapshot/,
  ]) {
    assert.ok(!forbidden.test(src), `catalog pricing source ${forbidden} must not be used`)
  }
  assert.ok(
    /revenue_shipped/.test(src),
    "the unit price must come from Noon's own reported revenue, not a catalog figure",
  )
})
