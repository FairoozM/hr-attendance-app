'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { rollupDailySales } = require('../src/services/amazonControlTower/dailySalesRollup.ts')
const { zonedDayStartUtc, zonedDateString } = require('../src/services/amazonControlTower/controlTowerTime.ts')

const KSA = { marketplaceKey: 'ksa', timeZone: 'Asia/Riyadh', vatRate: 0.15 }

function line(over: Record<string, unknown>) {
  return {
    amazon_order_id: '403-1',
    order_item_id: 'i1',
    purchase_date: '2026-10-01T09:00:00Z',
    order_status: 'Shipped',
    item_status: 'Shipped',
    seller_sku: 'SKU-A',
    asin: 'B0A',
    quantity: 1,
    currency: 'SAR',
    item_price: '115.00',
    item_tax: '',
    item_promotion_discount: '',
    ...over,
  }
}

describe('Control Tower daily sales rollup', () => {
  it('normal order: one unit, VAT-inclusive price → net ex VAT', () => {
    const { rows } = rollupDailySales([line({})], KSA)
    assert.equal(rows.length, 1)
    const r = rows[0]
    assert.equal(r.salesDate, '2026-10-01')
    assert.equal(r.sellerSku, 'SKU-A')
    assert.equal(r.asin, 'B0A')
    assert.equal(r.unitsOrdered, 1)
    assert.equal(r.orderCount, 1)
    assert.equal(r.grossItemSales, 115)
    assert.equal(r.netSalesExVat, 100)
    assert.equal(r.currency, 'SAR')
  })

  it('multi-unit line counts every unit', () => {
    const { rows } = rollupDailySales([line({ quantity: 3, item_price: '345' })], KSA)
    assert.equal(rows[0].unitsOrdered, 3)
    assert.equal(rows[0].orderCount, 1)
    assert.equal(rows[0].netSalesExVat, 300)
  })

  it('multiple orders for the same SKU-day', () => {
    const { rows } = rollupDailySales(
      [line({}), line({ amazon_order_id: '403-2', quantity: 2, item_price: '230' }), line({ amazon_order_id: '403-2', order_item_id: 'i2', seller_sku: 'SKU-B' })],
      KSA
    )
    const a = rows.find((r: any) => r.sellerSku === 'SKU-A')
    const b = rows.find((r: any) => r.sellerSku === 'SKU-B')
    assert.equal(a.unitsOrdered, 3)
    assert.equal(a.orderCount, 2)
    assert.equal(a.netSalesExVat, 300)
    assert.equal(b.unitsOrdered, 1)
    assert.equal(b.orderCount, 1)
  })

  it('cancelled lines add to units_cancelled only', () => {
    const { rows } = rollupDailySales(
      [line({}), line({ amazon_order_id: '403-9', item_status: 'Cancelled', order_status: 'Cancelled', quantity: 2, item_price: '230' })],
      KSA
    )
    const r = rows[0]
    assert.equal(r.unitsOrdered, 1)
    assert.equal(r.unitsCancelled, 2)
    assert.equal(r.orderCount, 1)
    assert.equal(r.cancelledOrderCount, 1)
    assert.equal(r.grossItemSales, 115)
  })

  it('splits days on Riyadh midnight, not UTC', () => {
    const { rows } = rollupDailySales(
      [
        line({ amazon_order_id: 'late', purchase_date: '2026-10-01T20:59:59Z' }),
        line({ amazon_order_id: 'next', purchase_date: '2026-10-01T21:00:00Z' }),
      ],
      KSA
    )
    assert.deepEqual(rows.map((r: any) => [r.salesDate, r.orderCount]), [['2026-10-01', 1], ['2026-10-02', 1]])
    assert.equal(zonedDayStartUtc('2026-10-02', 'Asia/Riyadh').toISOString(), '2026-10-01T21:00:00.000Z')
    assert.equal(zonedDateString(new Date('2026-10-01T21:00:00Z'), 'Asia/Riyadh'), '2026-10-02')
  })

  it('VAT: tax charged on top of a VAT-exclusive price is not divided again', () => {
    const { rows, vatExclusiveLines, vatInclusiveLines } = rollupDailySales(
      [line({ item_price: '100', item_tax: '15' }), line({ amazon_order_id: '403-3', item_price: '115', item_tax: '0' })],
      KSA
    )
    assert.equal(vatExclusiveLines, 1)
    assert.equal(vatInclusiveLines, 1)
    assert.equal(rows[0].itemTax, 15)
    assert.equal(rows[0].grossItemSales, 215)
    assert.equal(rows[0].netSalesExVat, 200)
  })

  it('item-tax blank on every line (amazon.sa) → item_tax NULL, not 0; net still VAT-inclusive', () => {
    const { rows } = rollupDailySales([line({ item_price: '925', item_tax: '' })], KSA)
    assert.equal(rows[0].itemTax, null)
    assert.equal(rows[0].grossItemSales, 925)
    assert.equal(rows[0].netSalesExVat, 804.3478)
  })

  it('promotions reduce net sales (sign-agnostic)', () => {
    const { rows } = rollupDailySales(
      [line({ item_price: '230', item_promotion_discount: '23' }), line({ amazon_order_id: '403-4', item_price: '115', item_promotion_discount: '-11.5' })],
      KSA
    )
    assert.equal(rows[0].promotions, 34.5)
    assert.equal(rows[0].netSalesExVat, 270)
  })

  it('lines without a price count units but leave money unknown', () => {
    const { rows } = rollupDailySales([line({ item_price: '', order_status: 'Pending', item_status: 'Unshipped' })], KSA)
    assert.equal(rows[0].unitsOrdered, 1)
    assert.equal(rows[0].linesWithoutPrice, 1)
    assert.equal(rows[0].grossItemSales, null)
    assert.equal(rows[0].netSalesExVat, null)
  })

  it('normalizes SKUs and skips lines without SKU or date', () => {
    const out = rollupDailySales([line({ seller_sku: 'sku–a ' }), line({ seller_sku: '' }), line({ purchase_date: null })], KSA)
    assert.equal(out.rows.length, 1)
    assert.equal(out.rows[0].sellerSku, 'SKU-A')
    assert.equal(out.skippedNoSku, 1)
    assert.equal(out.skippedNoDate, 1)
  })

  it('is reproducible: re-running on the same lines gives identical rows', () => {
    const lines = [line({}), line({ amazon_order_id: '403-2', quantity: 2, item_price: '230' }), line({ amazon_order_id: 'x', seller_sku: 'SKU-C', purchase_date: '2026-10-02T03:00:00Z' })]
    const first = rollupDailySales(lines, KSA)
    const second = rollupDailySales([...lines].reverse(), KSA)
    assert.deepEqual(second.rows, first.rows)
  })
})
