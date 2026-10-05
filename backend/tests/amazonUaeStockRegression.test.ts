'use strict'

/**
 * UAE Amazon + Zoho stock comparison must keep producing the same aggregates while the Control
 * Tower adds KSA inventory detail. These pin the shape of `mapInventorySummary`, the AFN merge and
 * the comparison rows built from them.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  mapInventorySummary,
  mergeAmazonInventoryRecords,
  mapAfnManageInventoryRow,
  amazonOnHandQty,
  isAmazonFbaOutOfStock,
} = require('../src/services/amazonListingsInventoryReadService')
const { buildZohoStockEntry } = require('../src/services/zohoLifeSmileWarehouseService')
const {
  _internals: { mergeRows },
} = require('../src/services/amazonZohoStockComparisonService')

const FULL_SUMMARY = {
  asin: 'B0UAE00001',
  fnSku: 'X00UAE0001',
  sellerSku: 'LIFEP12-10SILVERR',
  condition: 'NewItem',
  productName: 'Cookware set',
  totalQuantity: 31,
  inventoryDetails: {
    fulfillableQuantity: 20,
    inboundWorkingQuantity: 1,
    inboundShippedQuantity: 2,
    inboundReceivingQuantity: 3,
    reservedQuantity: {
      totalReservedQuantity: 4,
      pendingCustomerOrderQuantity: 2,
      pendingTransshipmentQuantity: 1,
      fcProcessingQuantity: 1,
    },
    researchingQuantity: { totalResearchingQuantity: 1, researchingQuantityBreakdown: [] },
    unfulfillableQuantity: {
      totalUnfulfillableQuantity: 5,
      customerDamagedQuantity: 2,
      warehouseDamagedQuantity: 3,
    },
  },
}

describe('UAE stock regression: mapInventorySummary aggregates', () => {
  it('keeps available / inbound / reserved / total / status for a full payload', () => {
    const mapped = mapInventorySummary(FULL_SUMMARY)
    assert.equal(mapped.sellerSku, 'LIFEP12-10SILVERR')
    assert.equal(mapped.availableQty, 20)
    assert.equal(mapped.inboundQty, 6)
    assert.equal(mapped.reservedQty, 4)
    assert.equal(mapped.totalQty, 31)
    assert.equal(mapped.stockStatus, 'In Stock')
    assert.equal(mapped.stockSource, 'fba_api')
    assert.equal(amazonOnHandQty(mapped), 31)
    assert.equal(isAmazonFbaOutOfStock(mapped), false)
  })

  it('reads unfulfillable units from Amazon object shape (was always 0)', () => {
    assert.equal(mapInventorySummary(FULL_SUMMARY).unfulfillableQty, 5)
  })

  it('still accepts a plain numeric unfulfillableQuantity', () => {
    const mapped = mapInventorySummary({
      sellerSku: 'A',
      totalQuantity: 3,
      inventoryDetails: { fulfillableQuantity: 1, unfulfillableQuantity: 2 },
    })
    assert.equal(mapped.unfulfillableQty, 2)
  })

  it('falls back to fulfillable + inbound + reserved when totalQuantity is missing', () => {
    const mapped = mapInventorySummary({
      sellerSku: 'NO-TOTAL',
      inventoryDetails: {
        fulfillableQuantity: 2,
        inboundShippedQuantity: 1,
        reservedQuantity: { totalReservedQuantity: 1 },
      },
    })
    assert.equal(mapped.totalQty, 4)
    assert.equal(mapped.unfulfillableQty, 0)
  })

  it('keeps AFN merge behaviour when the API reports zero', () => {
    const api = mapInventorySummary({ sellerSku: 'SF', totalQuantity: 0, inventoryDetails: { fulfillableQuantity: 0 } })
    const report = mapAfnManageInventoryRow({ sku: 'SF', 'afn-warehouse-quantity': '4', 'afn-fulfillable-quantity': '4' })
    const merged = mergeAmazonInventoryRecords(api, report)
    assert.equal(merged.totalQty, 4)
    assert.equal(merged.availableQty, 4)
    assert.equal(merged.stockSource, 'afn_manage_inventory_report')
  })
})

describe('UAE stock regression: comparison rows', () => {
  it('produces the same on-hand, Zoho qty, difference and action', () => {
    const warehouseId = 'wh-uae'
    const zohoEntry = buildZohoStockEntry(
      {
        item_id: 'z1',
        sku: '6291100000001',
        name: 'LIFEP12-10SILVERR',
        warehouse_stock_on_hand: '25',
        warehouse_available_for_sale_stock: '22',
      },
      'Life Smile Warehouse',
      warehouseId
    )
    assert.equal(zohoEntry.availableQty, 25)

    const listing = {
      marketplaceKey: 'uae',
      marketplace: 'UAE',
      sellerSku: 'LIFEP12-10SILVERR',
      normalizedSku: 'LIFEP12-10SILVERR',
      asin: 'B0UAE00001',
      title: 'Cookware set',
    }
    const inv = mapInventorySummary(FULL_SUMMARY)
    const rows = mergeRows({
      listings: [listing],
      inventoryBySku: new Map([['LIFEP12-10SILVERR', inv]]),
      zohoBySku: new Map([['LIFEP12-10SILVERR', zohoEntry]]),
      amazonFetchedAt: '2026-10-01T00:00:00.000Z',
      zohoFetchedAt: '2026-10-01T00:00:00.000Z',
      comparisonGeneratedAt: '2026-10-01T00:00:00.000Z',
    })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].amazon.totalQty, 31)
    assert.equal(rows[0].amazon.availableQty, 20)
    assert.equal(rows[0].zoho.availableQty, 25)
    assert.equal(rows[0].comparison.difference, -6)
    assert.equal(rows[0].comparison.isMismatch, true)
    assert.equal(typeof rows[0].comparison.recommendedAction, 'string')
  })
})
