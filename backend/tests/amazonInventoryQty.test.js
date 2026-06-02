const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  mapInventorySummary,
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

  it('marks out of stock only when on-hand and fulfillable are both zero', () => {
    const mapped = mapInventorySummary({
      sellerSku: 'ZERO-SKU',
      totalQuantity: 0,
      inventoryDetails: { fulfillableQuantity: 0 },
    })
    assert.equal(isAmazonFbaOutOfStock(mapped), true)
  })
})
