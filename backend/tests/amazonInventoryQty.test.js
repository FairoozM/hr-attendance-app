const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  mapInventorySummary,
  classifyInactiveListingRow,
  mapInactiveListingRow,
  mapAfnManageInventoryRow,
  mergeAmazonInventoryRecords,
  isAmazonFbaOutOfStock,
  amazonOnHandQty,
} = require('../src/services/amazonListingsInventoryReadService')

describe('Amazon FBA quantity mapping', () => {
  it('treats Seller Central on-hand (totalQuantity) as in stock when fulfillable is 0', () => {
    const mapped = mapInventorySummary({
      sellerSku: 'LIFEP12-10SILVERR',
      totalQuantity: 3,
      inventoryDetails: {
        fulfillableQuantity: 0,
        reservedQuantity: { totalReservedQuantity: 2 },
      },
    })
    assert.equal(mapped.totalQty, 3)
    assert.equal(mapped.availableQty, 0)
    assert.equal(mapped.stockStatus, 'In Stock')
    assert.equal(isAmazonFbaOutOfStock(mapped), false)
    assert.equal(amazonOnHandQty(mapped), 3)
  })

  it('classifies inactive report row as Seller Central out_of_stock when qty is 0', () => {
    assert.equal(classifyInactiveListingRow({ quantity: '0', status: 'Inactive' }), 'out_of_stock')
    const mapped = mapInactiveListingRow(
      {
        'seller-sku': 'LIFEP12-10SILVERR',
        quantity: '0',
        'item-name': 'Test',
        asin1: 'B0TEST',
      },
      'uae',
      'AE'
    )
    assert.equal(mapped?.listingStatus, 'INACTIVE_OOS')
    assert.equal(mapped?.sellerSku, 'LIFEP12-10SILVERR')
  })

  it('excludes blocked inactive rows from Seller Central OOS mapping', () => {
    assert.equal(classifyInactiveListingRow({ status: 'blocked' }), 'blocked')
    const mapped = mapInactiveListingRow({ 'seller-sku': 'X', status: 'blocked' }, 'uae', 'AE')
    assert.equal(mapped, null)
  })

  it('uses AFN manage inventory report when FBA API returns zero (Seller Flex)', () => {
    const api = mapInventorySummary({
      sellerSku: 'LIFEP17-24-BLACK-001',
      totalQuantity: 0,
      inventoryDetails: { fulfillableQuantity: 0 },
    })
    const report = mapAfnManageInventoryRow({
      sku: 'LIFEP17-24-BLACK-001',
      'afn-warehouse-quantity': '3',
      'afn-fulfillable-quantity': '3',
      'afn-reserved-quantity': '0',
    })
    const merged = mergeAmazonInventoryRecords(api, report)
    assert.equal(merged.totalQty, 3)
    assert.equal(merged.availableQty, 3)
    assert.equal(merged.stockSource, 'afn_manage_inventory_report')
    assert.equal(isAmazonFbaOutOfStock(merged), false)
  })

  it('marks out of stock only when on-hand and fulfillable are both zero', () => {
    const mapped = mapInventorySummary({
      sellerSku: 'ZERO-SKU',
      totalQuantity: 0,
      inventoryDetails: { fulfillableQuantity: 0 },
    })
    assert.equal(isAmazonFbaOutOfStock(mapped), true)
  })
})
