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

/**
 * @param {{ lines: object[], finance?: object[], statements?: object[], countries?: [string, number][], lastRun?: object|null }} data
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
      selectLastSuccessfulRun: async () =>
        data.lastRun === undefined
          ? { from_date: '2026-09-07', to_date: '2026-09-08', finished_at: new Date('2026-09-09T08:00:00Z') }
          : data.lastRun,
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
    assert.ok(ch.warnings.some((w) => /no Noon orders export has been run yet/.test(w)))
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
      selectNoonFinanceByOrders: async () => {
        throw new Error('finance cache unreachable')
      },
      selectLastSuccessfulRun: async () => ({ from_date: '2026-09-08', to_date: '2026-09-08' }),
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
      selectNoonFinanceByOrders: async () => [],
      selectLastSuccessfulRun: async () => ({ from_date: '2026-09-08', to_date: '2026-09-08' }),
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

test('Noon provider reads no accounting system and no catalog price', () => {
  const src = require('node:fs').readFileSync(
    require.resolve('../src/services/dailyEcommerceReport/providers/noonOrdersProvider'),
    'utf8',
  )
  assert.ok(!/zoho/i.test(src))
  assert.ok(!/\bprice\b/.test(src), 'a catalog price is not a sale amount and must not be used')
})
