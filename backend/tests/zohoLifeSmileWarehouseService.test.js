const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  buildZohoStockEntry,
  buildZohoStockMap,
  indexZohoWarehouseItems,
} = require('../src/services/zohoLifeSmileWarehouseService')

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

  it('matches Amazon seller SKU to Zoho item when Zoho name equals Amazon SKU (barcode SKU)', () => {
    const items = [
      {
        sku: '6294021006859',
        name: '2FP17SET-BEIGE',
        warehouse_stock_on_hand: '28',
      },
    ]
    const index = indexZohoWarehouseItems(items, 'LIFE SMILE', 'wh1')
    assert.ok(index.has('2FP17SET-BEIGE'))
    assert.ok(index.has('6294021006859'))

    const skuSet = new Set(['2FP17SET-BEIGE'])
    const { map, matchedKeys } = buildZohoStockMap(items, skuSet, 'LIFE SMILE', 'wh1')
    assert.equal(matchedKeys, 1)
    const row = map.get('2FP17SET-BEIGE')
    assert.equal(row.availableQty, 28)
    assert.equal(row.sku, '6294021006859')
    assert.equal(row.itemName, '2FP17SET-BEIGE')
    assert.equal(row.matchedBy, 'zoho_item_name')
  })
})
