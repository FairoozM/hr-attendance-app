'use strict'

/**
 * Unit tests for corrected Daily Ecommerce Report formulas, layout helpers, and Excel.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { dubaiDayBounds, assertYmd } = require('../src/services/dailyEcommerceReport/dateBounds')
const { getSarToAedRate, toAed, round2 } = require('../src/services/dailyEcommerceReport/money')
const { computeChannelFinancials, computeOverallTotals } = require('../src/services/dailyEcommerceReport/formulas')
const { CHANNELS } = require('../src/services/dailyEcommerceReport/channels')
const { formatAdsDisplay } = require('../src/services/dailyEcommerceReport/providers/amazonAdsProvider')
const { lineItemCode, isProductLine } = require('../src/services/dailyEcommerceReport/providers/zohoDailyInvoicesProvider')
const { buildDailyEcommerceReportXlsxBuffer } = require('../src/services/dailyEcommerceReport/dailyEcommerceReportXlsxService')

test('six channels including combined life_smile, no separate shop', () => {
  assert.equal(CHANNELS.length, 6)
  assert.ok(CHANNELS.some((c) => c.key === 'life_smile'))
  assert.ok(!CHANNELS.some((c) => c.key === 'shop'))
})

test('UAE day bounds for 2026-09-07', () => {
  const b = dubaiDayBounds('2026-09-07')
  assert.equal(b.start.toISOString(), '2026-09-06T20:00:00.000Z')
  assert.equal(b.end.toISOString(), '2026-09-07T20:00:00.000Z')
})

test('SAR display rate is four decimals without dumping formula text to UI', () => {
  const fx = getSarToAedRate()
  assert.equal(Number(fx.rate).toFixed(4), '0.9787')
  assert.equal(toAed(100, 'SAR', fx), round2(100 * fx.rate))
})

test('cost % with zero sales is 0 not DIV/0; null ads excluded', () => {
  const z = computeChannelFinancials({
    salesAmountAED: 0,
    adSpendAED: null,
    commissionAED: 0,
    shippingAED: 0,
  })
  assert.equal(z.costPercentage, 0)

  const withAdsNull = computeChannelFinancials({
    salesAmountAED: 1000,
    adSpendAED: null,
    commissionAED: 50,
    shippingAED: 25,
  })
  assert.equal(withAdsNull.totalIncludedCostsAED, 75)
  assert.equal(withAdsNull.costPercentage, 7.5)
  assert.equal(withAdsNull.balanceAED, 925)
})

test('Life Smile tabby commission included; smile/coupon not in costs', () => {
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

test('Amazon Ads display Not Configured not zero', () => {
  assert.equal(formatAdsDisplay('not_configured', null), 'Not Configured')
  assert.equal(formatAdsDisplay('not_configured', 0), 'Not Configured')
})

test('Zoho line item code prefers product name over barcode', () => {
  assert.equal(lineItemCode({ name: 'LIFEP7-MIX-29', sku: '929402100737' }), 'LIFEP7-MIX-29')
  assert.equal(isProductLine({ name: 'Coupon Discount', quantity: 1 }), false)
  assert.equal(isProductLine({ name: 'Courier Charges', quantity: 1 }), false)
  assert.equal(isProductLine({ name: 'LIFEP7', sku: '1', quantity: 2 }), true)
})

test('overall incomplete logic: ads null does not invent totals ads as zero', () => {
  const t = computeOverallTotals([
    { quantity: 2, salesAmountAED: 100, adSpendAED: null, clicks: null, commissionAED: 10, shippingAED: 0 },
    { quantity: 1, salesAmountAED: 50, adSpendAED: null, clicks: null, commissionAED: 0, shippingAED: 5 },
  ])
  assert.equal(t.adSpendAED, null)
  assert.equal(t.clicks, null)
  assert.equal(t.commissionAED, 10)
  assert.equal(t.shippingAED, 5)
  assert.equal(t.salesAmountAED, 150)
})

test('Excel export six columns and Not Configured for Amazon ads', async () => {
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
        country: 'AE',
        integrationStatus: 'available',
        adsStatus: 'not_configured',
        orders: [
          {
            orderNumber: '171-1',
            items: [
              { sku: 'A', quantity: 1 },
              { sku: 'B', quantity: 2 },
            ],
          },
        ],
        summary: {
          quantity: 3,
          salesAmountAED: 100,
          adSpendAED: null,
          clicks: null,
          commissionAED: 10,
          shippingAED: 5,
          costPercentage: 15,
          balanceAED: 85,
        },
      },
      {
        channel: 'amazon_ksa',
        label: 'Amazon KSA',
        family: 'amazon',
        country: 'SA',
        integrationStatus: 'available',
        adsStatus: 'not_configured',
        orders: [],
        summary: {
          quantity: 0,
          salesAmountAED: 0,
          adSpendAED: null,
          clicks: null,
          commissionAED: 0,
          shippingAED: 0,
          costPercentage: 0,
          balanceAED: 0,
        },
      },
      {
        channel: 'noon_uae',
        label: 'Noon UAE',
        family: 'noon',
        country: 'AE',
        integrationStatus: 'available',
        adsStatus: 'not_configured',
        orders: [{ orderNumber: 'NAEI1', items: [{ sku: 'N1', quantity: 1 }] }],
        summary: {
          quantity: 1,
          salesAmountAED: 50,
          adSpendAED: null,
          clicks: null,
          commissionAED: 0,
          shippingAED: 0,
          costPercentage: 0,
          balanceAED: 50,
        },
      },
      {
        channel: 'noon_ksa',
        label: 'Noon KSA',
        family: 'noon',
        country: 'SA',
        integrationStatus: 'available',
        adsStatus: 'not_configured',
        orders: [],
        summary: {
          quantity: 0,
          salesAmountAED: 0,
          adSpendAED: null,
          clicks: null,
          commissionAED: 0,
          shippingAED: 0,
          costPercentage: 0,
          balanceAED: 0,
        },
      },
      {
        channel: 'life_smile',
        label: 'Life Smile Website',
        family: 'life_smile',
        country: 'AE',
        integrationStatus: 'available',
        adsStatus: 'not_configured',
        orders: [{ orderNumber: '20964 (SHOP)', items: [{ sku: 'S1', quantity: 1 }] }],
        summary: {
          quantity: 1,
          salesAmountAED: 80,
          adSpendAED: null,
          clicks: null,
          commissionAED: 0,
          tabbyTamaraCommissionAED: 0,
          smilePointCouponAED: 12,
          shippingAED: 0,
          costPercentage: 0,
          balanceAED: 80,
        },
      },
      {
        channel: 'carrefour_uae',
        label: 'Carrefour UAE',
        family: 'carrefour',
        country: 'AE',
        integrationStatus: 'available',
        adsStatus: 'not_configured',
        orders: [],
        summary: {
          quantity: 0,
          salesAmountAED: 0,
          adSpendAED: null,
          clicks: null,
          commissionAED: 0,
          shippingAED: 0,
          costPercentage: 0,
          balanceAED: 0,
        },
      },
    ],
    totals: {
      quantity: 5,
      adSpendAED: null,
      clicks: null,
      commissionAED: 10,
      shippingAED: 5,
      costPercentage: 6.52,
      salesAmountAED: 230,
      balanceAED: 215,
      generalEcommerceCostsStatus: 'not_configured',
    },
  }

  const buf = await buildDailyEcommerceReportXlsxBuffer(report)
  assert.ok(buf.length > 800)
  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const ws = wb.getWorksheet('Daily Ecommerce')
  let foundNa = false
  let foundDiv = false
  let foundShop = false
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      const v = cell.value == null ? '' : String(cell.value)
      if (v.includes('Not Configured')) foundNa = true
      if (v.includes('#DIV/0')) foundDiv = true
      if (v.includes('(SHOP)')) foundShop = true
    })
  })
  assert.equal(foundNa, true)
  assert.equal(foundDiv, false)
  assert.equal(foundShop, true)
})

test('assertYmd', () => {
  assert.equal(assertYmd('2026-09-07'), '2026-09-07')
})
