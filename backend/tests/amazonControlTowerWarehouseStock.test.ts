'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { parseWarehouseStockItem } = require('../src/services/amazonControlTower/warehouseStockParser.ts')

const WH = '460000000038080'

describe('Control Tower warehouse stock parser', () => {
  it('keeps on hand, available for sale and committed separately (no max())', () => {
    const r = parseWarehouseStockItem(
      {
        item_id: '9001',
        sku: '6291100000001',
        name: 'LIFEP12-10SILVER',
        status: 'active',
        warehouse_stock_on_hand: '25',
        warehouse_available_for_sale_stock: '18',
        warehouse_committed_stock: '7',
        stock_on_hand: '999',
      },
      WH
    )
    assert.equal(r.zohoItemId, '9001')
    assert.equal(r.itemCode, '6291100000001')
    assert.equal(r.itemName, 'LIFEP12-10SILVER')
    assert.equal(r.onHand, 25)
    assert.equal(r.availableForSale, 18)
    assert.equal(r.committedStock, 7)
    assert.equal(r.stockScope, 'warehouse')
  })

  it('reads the matching warehouses[] entry', () => {
    const r = parseWarehouseStockItem(
      {
        item_id: '9002',
        sku: 'X',
        warehouses: [
          { warehouse_id: 'other', warehouse_stock_on_hand: 50 },
          { warehouse_id: WH, warehouse_stock_on_hand: 4, warehouse_available_for_sale_stock: 3, warehouse_committed_stock: 1 },
        ],
      },
      WH
    )
    assert.equal(r.onHand, 4)
    assert.equal(r.availableForSale, 3)
    assert.equal(r.committedStock, 1)
    assert.equal(r.stockScope, 'warehouse')
  })

  it('available for sale lower than on hand stays lower', () => {
    const r = parseWarehouseStockItem({ item_id: '1', warehouse_stock_on_hand: 10, warehouse_available_for_sale_stock: 0 }, WH)
    assert.equal(r.onHand, 10)
    assert.equal(r.availableForSale, 0)
  })

  it('missing committed value is null, not 0', () => {
    const r = parseWarehouseStockItem({ item_id: '9003', warehouse_stock_on_hand: 5, warehouse_available_for_sale_stock: 5 }, WH)
    assert.equal(r.committedStock, null)
  })

  it('falls back to organisation fields and says so', () => {
    const r = parseWarehouseStockItem({ item_id: '9004', stock_on_hand: 12, available_for_sale_stock: 9, committed_stock: 3 }, WH)
    assert.equal(r.onHand, 12)
    assert.equal(r.availableForSale, 9)
    assert.equal(r.committedStock, 3)
    assert.equal(r.stockScope, 'organization')
  })

  it('no stock fields at all → nulls with unknown scope; no item id → skipped', () => {
    const r = parseWarehouseStockItem({ item_id: '9005', name: 'No stock fields' }, WH)
    assert.equal(r.onHand, null)
    assert.equal(r.availableForSale, null)
    assert.equal(r.committedStock, null)
    assert.equal(r.stockScope, 'unknown')
    assert.equal(parseWarehouseStockItem({ sku: 'X' }, WH), null)
  })
})
