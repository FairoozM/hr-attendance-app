'use strict'

/**
 * Unit tests for the Daily Ecommerce Report: five channels, marketplace-native
 * sources only, pending vs not-configured semantics, and Excel export.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { dubaiDayBounds, assertYmd } = require('../src/services/dailyEcommerceReport/dateBounds')
const { getSarToAedRate, toAed, round2 } = require('../src/services/dailyEcommerceReport/money')
const {
  computeChannelFinancials,
  computeOverallTotals,
} = require('../src/services/dailyEcommerceReport/formulas')
const { CHANNELS } = require('../src/services/dailyEcommerceReport/channels')
const { formatAdsDisplay } = require('../src/services/dailyEcommerceReport/providers/amazonAdsProvider')
const { parseStatementDate } = require('../src/services/dailyEcommerceReport/providers/noonOrdersProvider')
const {
  buildDailyEcommerceReportXlsxBuffer,
  channelLines,
  summarySpecs,
} = require('../src/services/dailyEcommerceReport/dailyEcommerceReportXlsxService')

const REPORT_DIR = path.join(__dirname, '..', 'src', 'services', 'dailyEcommerceReport')

test('five channels, combined life_smile, no shop or carrefour section', () => {
  assert.equal(CHANNELS.length, 5)
  assert.deepEqual(
    CHANNELS.map((c) => c.key),
    ['amazon_uae', 'amazon_ksa', 'noon_uae', 'noon_ksa', 'life_smile'],
  )
  assert.ok(!CHANNELS.some((c) => c.key === 'shop'))
  assert.ok(!CHANNELS.some((c) => /carrefour/i.test(c.key)))
})

test('report implementation contains no accounting-system source', () => {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js')) files.push(full)
    }
  }
  walk(REPORT_DIR)
  assert.ok(files.length >= 6)
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    assert.ok(!/zoho/i.test(src), `${path.basename(file)} must not reference an accounting system`)
    assert.ok(!/carrefour/i.test(src), `${path.basename(file)} must not reference Carrefour`)
  }
})

test('UAE day bounds for 2026-09-07 and 2026-09-08 are Dubai midnight in UTC', () => {
  const d7 = dubaiDayBounds('2026-09-07')
  assert.equal(d7.start.toISOString(), '2026-09-06T20:00:00.000Z')
  assert.equal(d7.end.toISOString(), '2026-09-07T20:00:00.000Z')
  const d8 = dubaiDayBounds('2026-09-08')
  assert.equal(d8.start.toISOString(), '2026-09-07T20:00:00.000Z')
  assert.equal(d8.end.toISOString(), '2026-09-08T20:00:00.000Z')
  assert.equal(assertYmd('2026-09-08'), '2026-09-08')
})

test('SAR display rate is four decimals', () => {
  const fx = getSarToAedRate()
  assert.equal(Number(fx.rate).toFixed(4), '0.9787')
  assert.equal(toAed(100, 'SAR', fx), round2(100 * fx.rate))
})

test('null costs are excluded from cost %, never treated as zero', () => {
  const pending = computeChannelFinancials({
    salesAmountAED: 1000,
    adSpendAED: null,
    commissionAED: null,
    shippingAED: null,
  })
  assert.equal(pending.totalIncludedCostsAED, 0)
  assert.equal(pending.costPercentage, 0)
  assert.equal(pending.balanceAED, 1000)

  const known = computeChannelFinancials({
    salesAmountAED: 1000,
    adSpendAED: null,
    commissionAED: 50,
    shippingAED: 25,
  })
  assert.equal(known.totalIncludedCostsAED, 75)
  assert.equal(known.costPercentage, 7.5)
  assert.equal(known.balanceAED, 925)
})

test('zero sales gives 0% instead of a division error', () => {
  const z = computeChannelFinancials({
    salesAmountAED: 0,
    adSpendAED: null,
    commissionAED: 0,
    shippingAED: 0,
  })
  assert.equal(z.costPercentage, 0)
})

test('Life Smile tabby commission counts as cost; smile points do not', () => {
  const r = computeChannelFinancials({
    salesAmountAED: 500,
    adSpendAED: null,
    commissionAED: 0,
    shippingAED: 0,
    tabbyTamaraCommissionAED: 30,
  })
  assert.equal(r.totalIncludedCostsAED, 30)
  assert.equal(r.balanceAED, 470)
})

test('totals keep null for unavailable metrics and sum known ones', () => {
  const t = computeOverallTotals([
    { quantity: 2, salesAmountAED: 100, adSpendAED: null, clicks: null, commissionAED: 10, shippingAED: 0 },
    { quantity: null, salesAmountAED: 50, adSpendAED: null, clicks: null, commissionAED: null, shippingAED: null },
  ])
  assert.equal(t.adSpendAED, null)
  assert.equal(t.clicks, null)
  assert.equal(t.commissionAED, 10)
  assert.equal(t.shippingAED, 0)
  assert.equal(t.salesAmountAED, 150)
  assert.equal(t.quantity, 2)
})

test('Amazon Ads display Not Configured rather than zero', () => {
  assert.equal(formatAdsDisplay('not_configured', null), 'Not Configured')
  assert.equal(formatAdsDisplay('not_configured', 0), 'Not Configured')
})

test('Noon statement dates parse from M/D/YY and ISO', () => {
  assert.equal(parseStatementDate('7/27/26'), '2026-07-27')
  assert.equal(parseStatementDate('12/5/2026'), '2026-12-05')
  assert.equal(parseStatementDate('2026-09-07'), '2026-09-07')
  assert.equal(parseStatementDate(''), null)
  assert.equal(parseStatementDate('not-a-date'), null)
})

test('channel order lines show status placeholders instead of fake zeros', () => {
  assert.deepEqual(channelLines({ integrationStatus: 'pending', orders: [] }), [
    { order: 'Pending', sku: '', qty: '' },
  ])
  assert.deepEqual(channelLines({ integrationStatus: 'not_configured', orders: [] }), [
    { order: 'Not Configured', sku: '', qty: '' },
  ])
  assert.deepEqual(channelLines({ integrationStatus: 'unavailable', orders: [] }), [
    { order: 'Data Error', sku: '', qty: '' },
  ])
  assert.deepEqual(channelLines({ integrationStatus: 'available', orders: [] }), [
    { order: 'No orders', sku: '', qty: '' },
  ])
  assert.deepEqual(
    channelLines({
      integrationStatus: 'available',
      orders: [{ orderNumber: 'NAEI1', items: [{ sku: 'A', quantity: null }] }],
    }),
    [{ order: 'NAEI1', sku: 'A', qty: 'N/A' }],
  )
})

test('summary rows render Pending for unsettled marketplace costs', () => {
  const specs = summarySpecs({
    family: 'amazon',
    adsStatus: 'not_configured',
    summary: {
      quantity: 3,
      salesAmountAED: 100,
      adSpendAED: null,
      clicks: null,
      commissionAED: null,
      shippingAED: null,
      costPercentage: 0,
      balanceAED: 100,
    },
  })
  const byLabel = new Map(specs.map(([label, value]) => [label, value]))
  assert.equal(byLabel.get('Amazon Ads'), 'Not Configured')
  assert.equal(byLabel.get('Amazon Commission'), 'Pending')
  assert.equal(byLabel.get('Amazon Shipping'), 'Pending')
  assert.equal(byLabel.get('Amazon Qty'), 3)
})

test('Excel export builds five side-by-side sections', async () => {
  const report = {
    date: '2026-09-07',
    timezone: 'Asia/Dubai',
    amazonAdsExcluded: true,
    exchangeRate: { rate: 0.9786666667, rateDisplay: '0.9787', source: 'default' },
    channels: [
      {
        channel: 'amazon_uae',
        label: 'Amazon UAE',
        family: 'amazon',
        integrationStatus: 'available',
        adsStatus: 'not_configured',
        orders: [
          {
            orderNumber: '171-3766613-5532349',
            items: [{ sku: 'LIFEP7-MIX-29', quantity: 2 }],
          },
        ],
        summary: {
          quantity: 2,
          salesAmountAED: 299,
          adSpendAED: null,
          clicks: null,
          commissionAED: null,
          shippingAED: null,
          costPercentage: 0,
          balanceAED: 299,
        },
      },
      {
        channel: 'amazon_ksa',
        label: 'Amazon KSA',
        family: 'amazon',
        integrationStatus: 'available',
        adsStatus: 'not_configured',
        orders: [],
        summary: {
          quantity: 0,
          salesAmountAED: 0,
          adSpendAED: null,
          clicks: null,
          commissionAED: null,
          shippingAED: null,
          costPercentage: 0,
          balanceAED: 0,
        },
      },
      {
        channel: 'noon_uae',
        label: 'Noon UAE',
        family: 'noon',
        integrationStatus: 'pending',
        adsStatus: 'not_configured',
        orders: [],
        summary: {
          quantity: null,
          salesAmountAED: 0,
          adSpendAED: null,
          clicks: null,
          commissionAED: null,
          shippingAED: null,
          costPercentage: 0,
          balanceAED: 0,
        },
      },
      {
        channel: 'noon_ksa',
        label: 'Noon KSA',
        family: 'noon',
        integrationStatus: 'not_configured',
        adsStatus: 'not_configured',
        orders: [],
        summary: {
          quantity: null,
          salesAmountAED: 0,
          adSpendAED: null,
          clicks: null,
          commissionAED: null,
          shippingAED: null,
          costPercentage: 0,
          balanceAED: 0,
        },
      },
      {
        channel: 'life_smile',
        label: 'Life Smile Website',
        family: 'life_smile',
        integrationStatus: 'available',
        adsStatus: 'not_configured',
        orders: [
          { orderNumber: '20974', items: [{ sku: 'LIFE-A', quantity: 1 }] },
          { orderNumber: '20972 (SHOP)', items: [{ sku: 'LIFE-B', quantity: 2 }] },
        ],
        summary: {
          quantity: 3,
          salesAmountAED: 480.5,
          adSpendAED: null,
          clicks: null,
          commissionAED: 0,
          shippingAED: 0,
          tabbyTamaraCommissionAED: 0,
          smilePointCouponAED: 25,
          costPercentage: 0,
          balanceAED: 480.5,
        },
      },
    ],
    totals: {
      quantity: 5,
      salesAmountAED: 779.5,
      adSpendAED: null,
      clicks: null,
      commissionAED: 0,
      shippingAED: 0,
      costPercentage: 0,
      balanceAED: 779.5,
    },
    warnings: [],
  }

  const buf = await buildDailyEcommerceReportXlsxBuffer(report)
  assert.ok(Buffer.isBuffer(buf))
  assert.ok(buf.length > 3000)

  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const ws = wb.getWorksheet('Daily Ecommerce')
  assert.ok(ws)
  assert.equal(ws.getCell(4, 1).value, 'Amazon UAE')
  assert.equal(ws.getCell(4, 4).value, 'Amazon KSA')
  assert.equal(ws.getCell(4, 7).value, 'Noon UAE')
  assert.equal(ws.getCell(4, 10).value, 'Noon KSA')
  assert.equal(ws.getCell(4, 13).value, 'Life Smile Website')
  assert.equal(ws.getCell(4, 16).value, null)
  assert.equal(ws.getCell(6, 1).value, '171-3766613-5532349')
  assert.equal(ws.getCell(6, 7).value, 'Pending')
  assert.equal(ws.getCell(6, 10).value, 'Not Configured')
  const shopCell = [ws.getCell(6, 13).value, ws.getCell(7, 13).value]
  assert.ok(shopCell.includes('20972 (SHOP)'))
})
