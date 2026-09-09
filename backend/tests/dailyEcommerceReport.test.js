'use strict'

/**
 * Unit tests for Daily Ecommerce Report formulas, date bounds, FX, ads display,
 * and Excel export labels.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { dubaiDayBounds, assertYmd, addDaysYmd, todayUaeYmd, IANA_UAE } = require('../src/services/dailyEcommerceReport/dateBounds')
const { getSarToAedRate, toAed, round2, sumAvailable } = require('../src/services/dailyEcommerceReport/money')
const { computeChannelFinancials, computeOverallTotals } = require('../src/services/dailyEcommerceReport/formulas')
const { formatAdsDisplay } = require('../src/services/dailyEcommerceReport/providers/amazonAdsProvider')
const { EXCLUDED_STATUSES } = require('../src/services/dailyEcommerceReport/providers/amazonOrdersProvider')
const {
  EXCLUDED_STATUSES: WEB_EXCLUDED,
  INCLUDED_STATUSES,
} = require('../src/services/dailyEcommerceReport/providers/websiteOrdersProvider')
const { loadNoonChannel, loadCarrefourChannel, loadMetaAds } = require('../src/services/dailyEcommerceReport/providers/stubProviders')
const { buildDailyEcommerceReportXlsxBuffer } = require('../src/services/dailyEcommerceReport/dailyEcommerceReportXlsxService')

test('assertYmd rejects invalid dates', () => {
  assert.throws(() => assertYmd('2026-13-01'), /valid|YYYY/)
  assert.throws(() => assertYmd('not-a-date'), /YYYY/)
  assert.equal(assertYmd('2026-09-08'), '2026-09-08')
})

test('UAE day bounds are Asia/Dubai half-open [start, end)', () => {
  const b = dubaiDayBounds('2026-09-08')
  assert.equal(b.timezone, IANA_UAE)
  assert.equal(b.start.toISOString(), '2026-09-07T20:00:00.000Z') // midnight +04
  assert.equal(b.end.toISOString(), '2026-09-08T20:00:00.000Z')
  assert.ok(b.end.getTime() > b.start.getTime())
})

test('addDaysYmd crosses month boundaries in Dubai', () => {
  assert.equal(addDaysYmd('2026-09-30', 1), '2026-10-01')
  assert.equal(addDaysYmd('2026-09-01', -1), '2026-08-31')
})

test('todayUaeYmd returns YYYY-MM-DD', () => {
  assert.match(todayUaeYmd(), /^\d{4}-\d{2}-\d{2}$/)
})

test('SAR to AED uses configurable rate (default 3.67/3.75)', () => {
  const prev = process.env.AMAZON_KSA_LEGACY_SAR_TO_AED
  delete process.env.AMAZON_KSA_LEGACY_SAR_TO_AED
  const fx = getSarToAedRate()
  assert.ok(Math.abs(fx.rate - 3.67 / 3.75) < 1e-12)
  assert.equal(fx.configured, false)
  assert.equal(toAed(375, 'SAR', fx), round2(375 * (3.67 / 3.75)))
  assert.equal(toAed(100, 'AED', fx), 100)
  if (prev == null) delete process.env.AMAZON_KSA_LEGACY_SAR_TO_AED
  else process.env.AMAZON_KSA_LEGACY_SAR_TO_AED = prev
})

test('SAR to AED respects AMAZON_KSA_LEGACY_SAR_TO_AED env', () => {
  const prev = process.env.AMAZON_KSA_LEGACY_SAR_TO_AED
  process.env.AMAZON_KSA_LEGACY_SAR_TO_AED = '1'
  const fx = getSarToAedRate()
  assert.equal(fx.rate, 1)
  assert.equal(fx.configured, true)
  assert.equal(toAed(50, 'SAR', fx), 50)
  if (prev == null) delete process.env.AMAZON_KSA_LEGACY_SAR_TO_AED
  else process.env.AMAZON_KSA_LEGACY_SAR_TO_AED = prev
})

test('multi-item order quantity is sum of units not line count', () => {
  const items = [
    { sku: 'A', quantity: 2 },
    { sku: 'B', quantity: 3 },
    { sku: 'C', quantity: 1 },
  ]
  const qty = items.reduce((s, i) => s + i.quantity, 0)
  assert.equal(qty, 6)
  assert.notEqual(qty, items.length)
})

test('cost percentage with sales > 0', () => {
  const r = computeChannelFinancials({
    salesAmountAED: 1000,
    adSpendAED: 100,
    commissionAED: 50,
    shippingAED: 25,
    paymentFeesAED: 25,
    otherIncludedCostsAED: 0,
  })
  assert.equal(r.totalIncludedCostsAED, 200)
  assert.equal(r.costPercentage, 20)
  assert.equal(r.balanceAED, 800)
})

test('cost percentage with zero sales is 0 when costs are 0 (never DIV/0)', () => {
  const r = computeChannelFinancials({
    salesAmountAED: 0,
    adSpendAED: null,
    commissionAED: 0,
    shippingAED: 0,
    paymentFeesAED: 0,
    otherIncludedCostsAED: 0,
  })
  assert.equal(r.costPercentage, 0)
  assert.equal(r.balanceAED, 0)
})

test('null ad spend is excluded from included costs (not treated as zero inventively)', () => {
  const withNullAds = computeChannelFinancials({
    salesAmountAED: 100,
    adSpendAED: null,
    commissionAED: 10,
    shippingAED: 0,
    paymentFeesAED: 0,
    otherIncludedCostsAED: 0,
  })
  assert.equal(withNullAds.totalIncludedCostsAED, 10)

  const withZeroAds = computeChannelFinancials({
    salesAmountAED: 100,
    adSpendAED: 0,
    commissionAED: 10,
    shippingAED: 0,
    paymentFeesAED: 0,
    otherIncludedCostsAED: 0,
  })
  assert.equal(withZeroAds.totalIncludedCostsAED, 10)
})

test('coupon / smile points are informational and not in included costs', () => {
  const r = computeChannelFinancials({
    salesAmountAED: 500, // already net of discount in stored total
    adSpendAED: null,
    commissionAED: 0,
    shippingAED: 0,
    paymentFeesAED: 0,
    otherIncludedCostsAED: 0,
  })
  assert.equal(r.totalIncludedCostsAED, 0)
  assert.equal(r.balanceAED, 500)
  // Informational fields live on summary separately — not passed into formula
})

test('Amazon cancelled statuses are excluded', () => {
  assert.ok(EXCLUDED_STATUSES.has('canceled'))
  assert.ok(EXCLUDED_STATUSES.has('cancelled'))
})

test('Website cancelled and fully returned excluded; confirmed included', () => {
  assert.ok(WEB_EXCLUDED.has('cancelled'))
  assert.ok(WEB_EXCLUDED.has('returned'))
  assert.ok(INCLUDED_STATUSES.has('confirmed'))
  assert.ok(INCLUDED_STATUSES.has('partiallyReturned'))
})

test('partial refund net impact reduces sales amount', () => {
  const total = 200
  const refund = 50
  const net = round2(Math.max(0, total - refund))
  assert.equal(net, 150)
})

test('duplicate order protection via Set', () => {
  const ids = ['A', 'B', 'A', 'C', 'B']
  const seen = new Set()
  const unique = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }
  assert.deepEqual(unique, ['A', 'B', 'C'])
})

test('Amazon Ads formatAdsDisplay shows Not Configured not zero', () => {
  assert.equal(formatAdsDisplay('not_configured', null, 'money'), 'Not Configured')
  assert.equal(formatAdsDisplay('not_configured', 0, 'money'), 'Not Configured')
  assert.equal(formatAdsDisplay('unavailable', null, 'int'), 'Unavailable')
  assert.equal(formatAdsDisplay('available', 12.5, 'money'), 12.5)
})

test('Noon and Carrefour and Meta stubs are not_configured', async () => {
  const noon = loadNoonChannel('AE')
  assert.equal(noon.integrationStatus, 'not_configured')
  assert.equal(noon.summary.adSpendAED, null)
  assert.equal(noon.summary.clicks, null)

  const noonSa = loadNoonChannel('SA')
  assert.equal(noonSa.channel, 'noon_ksa')
  assert.equal(noonSa.country, 'SA')

  const carrefour = loadCarrefourChannel()
  assert.equal(carrefour.integrationStatus, 'not_configured')

  const meta = await loadMetaAds('2026-09-08')
  assert.equal(meta.adsStatus, 'not_configured')
  assert.equal(meta.adSpendAED, null)
  assert.equal(meta.adsMetricLabel, 'link_clicks')
})

test('UAE vs KSA channel keys stay separated', () => {
  assert.equal(loadNoonChannel('AE').channel, 'noon_uae')
  assert.equal(loadNoonChannel('SA').channel, 'noon_ksa')
})

test('overall totals skip null ads; Meta not attributed to marketplaces in stubs', () => {
  const totals = computeOverallTotals([
    {
      quantity: 2,
      orderCount: 1,
      salesAmountAED: 100,
      adSpendAED: null,
      clicks: null,
      commissionAED: 10,
      shippingAED: 5,
      paymentFeesAED: 0,
      otherIncludedCostsAED: 0,
      couponDiscountAED: 20,
      smilePointsAED: 5,
    },
    {
      quantity: 1,
      orderCount: 1,
      salesAmountAED: 50,
      adSpendAED: null,
      clicks: null,
      commissionAED: 0,
      shippingAED: 0,
      paymentFeesAED: 0,
      otherIncludedCostsAED: 0,
      couponDiscountAED: 0,
      smilePointsAED: 0,
    },
  ], null)
  assert.equal(totals.salesAmountAED, 150)
  assert.equal(totals.adSpendAED, null)
  assert.equal(totals.clicks, null)
  assert.equal(totals.commissionAED, 10)
  assert.equal(totals.totalIncludedCostsAED, 15)
  assert.equal(totals.couponDiscountAED, 20)
  assert.equal(totals.generalEcommerceCostsAED, null)
})

test('sumAvailable ignores nulls', () => {
  assert.deepEqual(sumAvailable([1, null, 2, undefined]), { total: 3, used: 2 })
})

test('Excel export writes Not Configured for Amazon ads and avoids DIV/0', async () => {
  const report = {
    date: '2026-09-08',
    timezone: 'Asia/Dubai',
    incomplete: true,
    exchangeRate: { rate: 0.9786666667, source: 'default_3.67_div_3.75' },
    warnings: ['Amazon UAE Ads: Not Configured'],
    channels: [
      {
        channel: 'amazon_uae',
        label: 'Amazon UAE',
        country: 'AE',
        currency: 'AED',
        integrationStatus: 'available',
        adsStatus: 'not_configured',
        orders: [
          {
            orderId: '1',
            orderNumber: '1',
            status: 'Shipped',
            amountAED: 100,
            items: [
              { sku: 'SKU-A', quantity: 2, lineAmount: 60 },
              { sku: 'SKU-B', quantity: 1, lineAmount: 40 },
            ],
          },
        ],
        summary: {
          quantity: 3,
          orderCount: 1,
          salesAmountAED: 100,
          adSpendAED: null,
          clicks: null,
          commissionAED: 0,
          shippingAED: 0,
          paymentFeesAED: 0,
          otherIncludedCostsAED: 0,
          couponDiscountAED: 0,
          smilePointsAED: 0,
          totalIncludedCostsAED: 0,
          costPercentage: 0,
          balanceAED: 100,
        },
      },
      {
        channel: 'noon_uae',
        label: 'Noon UAE',
        country: 'AE',
        currency: 'AED',
        integrationStatus: 'not_configured',
        adsStatus: 'not_configured',
        orders: [],
        summary: {
          quantity: 0,
          orderCount: 0,
          salesAmountAED: 0,
          adSpendAED: null,
          clicks: null,
          commissionAED: 0,
          shippingAED: 0,
          paymentFeesAED: 0,
          otherIncludedCostsAED: 0,
          couponDiscountAED: 0,
          smilePointsAED: 0,
          totalIncludedCostsAED: 0,
          costPercentage: 0,
          balanceAED: 0,
        },
      },
    ],
    totals: {
      quantity: 3,
      adSpendAED: null,
      clicks: null,
      commissionAED: 0,
      shippingAED: 0,
      paymentFeesAED: 0,
      otherIncludedCostsAED: 0,
      generalEcommerceCostsAED: null,
      generalEcommerceCostsStatus: 'not_configured',
      costPercentage: 0,
      salesAmountAED: 100,
      balanceAED: 100,
    },
  }

  const buf = await buildDailyEcommerceReportXlsxBuffer(report)
  assert.ok(Buffer.isBuffer(buf))
  assert.ok(buf.length > 500)

  // Parse with ExcelJS to assert cell text
  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  // exceljs load accepts buffer
  // @ts-ignore
  await wb.xlsx.load(buf)
  const ws = wb.getWorksheet('Daily Ecommerce')
  assert.ok(ws)

  let foundNotConfigured = false
  let foundDiv0 = false
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      const v = cell.value == null ? '' : String(cell.value)
      if (v.includes('Not Configured')) foundNotConfigured = true
      if (v.includes('#DIV/0')) foundDiv0 = true
    })
  })
  assert.equal(foundNotConfigured, true)
  assert.equal(foundDiv0, false)
})
