'use strict'

/**
 * Amazon flat-file order report parsing.
 *
 * The fixture below is the real header and row shape Amazon UAE returned for 2026-09-09 from
 * GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL, including the free-shipping order where a
 * 2.50 shipping-price is exactly offset by a 2.50 ship-promotion-discount, and the cancelled line
 * that carries no money.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  parseAllOrdersReport,
} = require('../src/services/amazonOrderReportSyncService')

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

const HEADER = [
  'amazon-order-id',
  'merchant-order-id',
  'purchase-date',
  'last-updated-date',
  'order-status',
  'fulfillment-channel',
  'sales-channel',
  'order-channel',
  'ship-service-level',
  'product-name',
  'sku',
  'asin',
  'item-status',
  'quantity',
  'currency',
  'item-price',
  'item-tax',
  'shipping-price',
  'shipping-tax',
  'gift-wrap-price',
  'gift-wrap-tax',
  'item-promotion-discount',
  'ship-promotion-discount',
  'ship-city',
  'ship-state',
  'ship-postal-code',
  'ship-country',
  'promotion-ids',
  'fulfilled-by',
  'order-item-id',
  'is-prime',
].join('\t')

function row(values) {
  const cells = new Array(31).fill('')
  for (const [key, value] of Object.entries(values)) {
    cells[HEADER.split('\t').indexOf(key)] = value
  }
  return cells.join('\t')
}

const FIXTURE = [
  HEADER,
  row({
    'amazon-order-id': '406-7702438-5147528',
    'purchase-date': '2026-09-09T08:15:39+00:00',
    'order-status': 'Unshipped',
    sku: 'LIFEP17-MIX-14-1-BEIGE-001',
    asin: 'B0CYX864ZW',
    'item-status': 'Unshipped',
    quantity: '1',
    currency: 'AED',
    'item-price': '466.0',
    'order-item-id': '81234567890123',
  }),
  row({
    'amazon-order-id': '408-5483166-7689147',
    'purchase-date': '2026-09-09T11:02:11+00:00',
    'order-status': 'Shipped',
    sku: 'SPHM-S-16P-BLACK',
    'item-status': 'Shipped',
    quantity: '1',
    currency: 'AED',
    'item-price': '104.0',
    'shipping-price': '2.5',
    'ship-promotion-discount': '2.5',
    'order-item-id': '81234567890124',
  }),
  row({
    'amazon-order-id': '407-9799640-1805109',
    'purchase-date': '2026-09-09T06:00:00+00:00',
    'order-status': 'Cancelled',
    sku: 'LIFEP12-6-3SILVER',
    'item-status': 'Cancelled',
    quantity: '0',
    currency: 'AED',
    'order-item-id': '81234567890125',
  }),
].join('\n')

test('report lines compose the customer-paid amount from Amazon money columns', () => {
  const lines = parseAllOrdersReport(FIXTURE)
  assert.equal(lines.length, 3)

  const pending = lines[0]
  assert.equal(pending.amazonOrderId, '406-7702438-5147528')
  assert.equal(pending.lineAmount, 466)
  assert.equal(pending.itemStatus, 'Unshipped')
  assert.equal(pending.currency, 'AED')
  assert.equal(pending.quantity, 1)
  assert.equal(pending.purchaseDate.toISOString(), '2026-09-09T08:15:39.000Z')

  // Free shipping: the shipping charge and its promotion cancel out, so the line is still 104.00 —
  // which is exactly what the Orders API reports as this order's OrderTotal.
  assert.equal(lines[1].lineAmount, 104)
})

test('a cancelled line with no money is null, not zero', () => {
  const cancelled = parseAllOrdersReport(FIXTURE)[2]
  assert.equal(cancelled.lineAmount, null)
  assert.equal(cancelled.itemStatus, 'Cancelled')
})

test('blank money cells never become zero', () => {
  const [line] = parseAllOrdersReport(
    [HEADER, row({ 'amazon-order-id': '1-1-1', 'item-price': '38.0', 'item-tax': '' })].join('\n'),
  )
  assert.equal(line.itemTax, null)
  assert.equal(line.shippingPrice, null)
  assert.equal(line.lineAmount, 38)
})

test('an unrecognised report is an error, not an empty day', () => {
  assert.throws(
    () => parseAllOrdersReport('some-other-column\tvalue\nfoo\tbar'),
    /missing the amazon-order-id column/,
  )
  // A genuinely empty document is a legitimate "no orders" answer.
  assert.deepEqual(parseAllOrdersReport(''), [])
})

test('the whole 2026-09-09 fixture day sums to what Amazon reports', () => {
  const lines = parseAllOrdersReport(FIXTURE)
  const total = lines
    .filter((l) => !/^cancel/i.test(String(l.itemStatus)))
    .reduce((acc, l) => acc + (l.lineAmount ?? 0), 0)
  assert.equal(total, 570)
})

/**
 * The stale-row cleanup once keyed rows by joining the order id and the order-item id with a NUL
 * byte, which PostgreSQL `text` cannot hold: every run inserted its rows and then died on the
 * delete with "invalid byte sequence for encoding UTF8: 0x00", so the sync recorded itself as failed
 * even though the money had landed.
 */
test('the stale-row cleanup never puts a NUL byte in a query parameter', async () => {
  const captured = []
  const restore = stubModule('../src/db', {
    query: async (sql, params) => {
      captured.push({ sql, params })
      return { rows: [], rowCount: /^DELETE/.test(sql.trim()) ? 2 : 0 }
    },
  })
  try {
    const store = freshModule('../src/services/amazonOrdersCacheStore')
    const result = await store.replaceOrderReportLines(
      'uae',
      { start: new Date('2026-09-08T20:00:00Z'), end: new Date('2026-09-09T20:00:00Z') },
      [
        { amazonOrderId: '406-7702438-5147528', orderItemId: '81234567890123', sellerSku: 'A', quantity: 1, currency: 'AED', itemPrice: 466, lineAmount: 466 },
        { amazonOrderId: '404-1517091-1373964', orderItemId: '81234567890124', sellerSku: 'B', quantity: 1, currency: 'AED', itemPrice: 226, lineAmount: 226 },
      ],
      '58382020706',
    )
    assert.deepEqual(result, { saved: 2, removed: 2 })

    for (const { params } of captured) {
      for (const value of params) {
        const values = Array.isArray(value) ? value : [value]
        for (const v of values) {
          assert.ok(
            typeof v !== 'string' || !v.includes('\u0000'),
            `parameter ${JSON.stringify(v)} contains a NUL byte PostgreSQL text cannot store`,
          )
        }
      }
    }

    const del = captured.find(({ sql }) => /^DELETE/.test(sql.trim()))
    assert.ok(del, 'stale rows in the window are cleaned up')
    // The two id arrays line up so a row is kept only when both parts match.
    assert.deepEqual(del.params[3], ['406-7702438-5147528', '404-1517091-1373964'])
    assert.deepEqual(del.params[4], ['81234567890123', '81234567890124'])
  } finally {
    restore()
  }
})

test('a line with no order id is skipped rather than written under an empty key', async () => {
  const inserts = []
  const restore = stubModule('../src/db', {
    query: async (sql, params) => {
      if (/^INSERT/.test(sql.trim())) inserts.push(params)
      return { rows: [], rowCount: 0 }
    },
  })
  try {
    const store = freshModule('../src/services/amazonOrdersCacheStore')
    const result = await store.replaceOrderReportLines(
      'uae',
      { start: new Date('2026-09-08T20:00:00Z'), end: new Date('2026-09-09T20:00:00Z') },
      [{ amazonOrderId: '', orderItemId: 'x', lineAmount: 10 }],
    )
    assert.equal(result.saved, 0)
    assert.equal(inserts.length, 0)
  } finally {
    restore()
  }
})
