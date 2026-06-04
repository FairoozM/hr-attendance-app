const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { buildZohoStockEntry, buildZohoStockMap } = require('../src/services/zohoLifeSmileWarehouseService')

describe('Zoho Life Smile warehouse stock for Amazon comparison', () => {
  it('uses warehouse_stock_on_hand when actual_available is 0 (list API quirk)', () => {
    const entry = buildZohoStockEntry(
      {
        sku: 'LIFEP32SHR-24',
        name: 'Pan 24',
        warehouse_actual_available_stock: '0',
        warehouse_stock_on_hand: '3',
        stock_on_hand: '99',
      },
      'Life Smile Warehouse',
      'wh-life-smile'
    )
    assert.equal(entry.availableQty, 3)
    assert.equal(entry.stockStatus, 'In Stock')
    assert.equal(entry.actualQty, undefined)
  })

  it('reads qty from warehouses[] when top-level fields are missing', () => {
    const entry = buildZohoStockEntry(
      {
        sku: 'LIFEP32SHR-24',
        warehouses: [{ warehouse_id: 'wh-life-smile', warehouse_stock_on_hand: '3' }],
      },
      'Life Smile Warehouse',
      'wh-life-smile'
    )
    assert.equal(entry.availableQty, 3)
  })

  it('looks up Amazon SKU keys from full warehouse index', () => {
    const items = [
      {
        sku: 'LIFEP32SHR-24',
        warehouse_stock_on_hand: '3',
        warehouse_id: 'wh1',
      },
    ]
    const skuSet = new Set(['lifep32shr-24'])
    const { map, matchedKeys } = buildZohoStockMap(items, skuSet, 'Life Smile Warehouse', 'wh1')
    assert.equal(matchedKeys, 1)
    assert.equal(map.get('lifep32shr-24')?.availableQty, 3)
  })
})
