'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { parseFbaInventorySummary, inboundTotal } = require('../src/services/amazonControlTower/fbaInventoryParser.ts')

const FULL = {
  asin: 'B0KSA00001',
  fnSku: 'X00KSA0001',
  sellerSku: 'LIFEP12–10SILVER',
  productName: 'Cookware set',
  lastUpdatedTime: '2026-10-04T10:00:00Z',
  totalQuantity: 40,
  inventoryDetails: {
    fulfillableQuantity: 20,
    inboundWorkingQuantity: 1,
    inboundShippedQuantity: 2,
    inboundReceivingQuantity: 3,
    reservedQuantity: {
      totalReservedQuantity: 6,
      pendingCustomerOrderQuantity: 3,
      pendingTransshipmentQuantity: 2,
      fcProcessingQuantity: 1,
    },
    researchingQuantity: { totalResearchingQuantity: 4, researchingQuantityBreakdown: [{ name: 'researchingQuantityInShortTerm', quantity: 4 }] },
    unfulfillableQuantity: { totalUnfulfillableQuantity: 5, customerDamagedQuantity: 2, defectiveQuantity: 3 },
  },
}

describe('Control Tower FBA inventory parser', () => {
  it('reads every bucket separately', () => {
    const d = parseFbaInventorySummary(FULL)
    assert.equal(d.sellerSku, 'LIFEP12–10SILVER')
    assert.equal(d.normalizedSku, 'LIFEP12-10SILVER')
    assert.equal(d.asin, 'B0KSA00001')
    assert.equal(d.fnsku, 'X00KSA0001')
    assert.equal(d.fulfillableQuantity, 20)
    assert.equal(d.inboundWorkingQuantity, 1)
    assert.equal(d.inboundShippedQuantity, 2)
    assert.equal(d.inboundReceivingQuantity, 3)
    assert.equal(d.reservedQuantity, 6)
    assert.equal(d.reservedCustomerOrders, 3)
    assert.equal(d.reservedFcTransfer, 2)
    assert.equal(d.reservedFcProcessing, 1)
    assert.equal(d.totalQuantity, 40)
    assert.equal(d.amazonLastUpdatedAt, '2026-10-04T10:00:00.000Z')
    assert.equal(inboundTotal(d), 6)
  })

  it('reads unfulfillable from the Amazon object shape', () => {
    assert.equal(parseFbaInventorySummary(FULL).unfulfillableQuantity, 5)
    const numeric = parseFbaInventorySummary({ sellerSku: 'A', inventoryDetails: { unfulfillableQuantity: 7 } })
    assert.equal(numeric.unfulfillableQuantity, 7)
  })

  it('reads researching quantity (object and numeric)', () => {
    assert.equal(parseFbaInventorySummary(FULL).researchingQuantity, 4)
    assert.equal(parseFbaInventorySummary({ sellerSku: 'A', inventoryDetails: { researchingQuantity: '2' } }).researchingQuantity, 2)
  })

  it('stores missing buckets as null, not 0', () => {
    const d = parseFbaInventorySummary({ sellerSku: 'NO-DETAILS', totalQuantity: 3 })
    assert.equal(d.totalQuantity, 3)
    for (const field of [
      'fulfillableQuantity',
      'inboundWorkingQuantity',
      'inboundShippedQuantity',
      'inboundReceivingQuantity',
      'reservedQuantity',
      'reservedCustomerOrders',
      'reservedFcTransfer',
      'reservedFcProcessing',
      'unfulfillableQuantity',
      'researchingQuantity',
    ]) {
      assert.equal(d[field], null, field)
    }
    assert.equal(inboundTotal(d), null)
    const noTotal = parseFbaInventorySummary({ sellerSku: 'X', inventoryDetails: { fulfillableQuantity: 1 } })
    assert.equal(noTotal.totalQuantity, null)
  })

  it('keeps real zeros as 0', () => {
    const d = parseFbaInventorySummary({
      sellerSku: 'ZERO',
      totalQuantity: 0,
      inventoryDetails: {
        fulfillableQuantity: 0,
        inboundWorkingQuantity: 0,
        reservedQuantity: { totalReservedQuantity: 0, pendingCustomerOrderQuantity: 0 },
        unfulfillableQuantity: { totalUnfulfillableQuantity: 0 },
        researchingQuantity: { totalResearchingQuantity: 0 },
      },
    })
    assert.equal(d.fulfillableQuantity, 0)
    assert.equal(d.inboundWorkingQuantity, 0)
    assert.equal(d.reservedQuantity, 0)
    assert.equal(d.reservedCustomerOrders, 0)
    assert.equal(d.unfulfillableQuantity, 0)
    assert.equal(d.researchingQuantity, 0)
    assert.equal(d.totalQuantity, 0)
    assert.equal(inboundTotal(d), 0)
  })

  it('turns malformed values into null and rejects rows without a SKU', () => {
    const d = parseFbaInventorySummary({
      sellerSku: 'BAD',
      totalQuantity: 'n/a',
      inventoryDetails: {
        fulfillableQuantity: 'abc',
        inboundShippedQuantity: -4,
        reservedQuantity: 'lots',
        unfulfillableQuantity: { somethingElse: 3 },
        researchingQuantity: [1, 2],
      },
    })
    assert.equal(d.totalQuantity, null)
    assert.equal(d.fulfillableQuantity, null)
    assert.equal(d.inboundShippedQuantity, null)
    assert.equal(d.reservedQuantity, null)
    assert.equal(d.unfulfillableQuantity, null)
    assert.equal(d.researchingQuantity, null)
    assert.equal(parseFbaInventorySummary({ asin: 'B0' }), null)
    assert.equal(parseFbaInventorySummary(null), null)
    assert.equal(parseFbaInventorySummary({ sellerSku: 'S', inventoryDetails: 'oops' }).fulfillableQuantity, null)
  })
})
