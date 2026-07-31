const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  mapInventorySummary,
  classifyInactiveListingRow,
  mapInactiveListingRow,
  mapAfnManageInventoryRow,
  mergeAmazonInventoryRecords,
  emptyFbaInventory,
  isAmazonFbaOutOfStock,
  amazonOnHandQty,
  buildSingleSkuBackfillList,
  parseReportFulfillmentChannel,
  filterSellerFlexActiveListings,
  mapListingRow,
} = require('../src/services/amazonListingsInventoryReadService')
const {
  resolveAmazonSpApiHttpTimeoutMs,
} = require('../src/services/amazonSpApiService')
const {
  _internals: { refreshStaleMinutes },
} = require('../src/services/amazonZohoStockRefreshJobStore')

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

  it('treats FBA batch omission as zero, not AFN-only stale qty', () => {
    const omitted = emptyFbaInventory('fba_api_not_returned')
    const report = mapAfnManageInventoryRow({
      sku: '2FP17SET-BEIGE',
      'afn-warehouse-quantity': '1',
      'afn-fulfillable-quantity': '1',
    })
    const merged = mergeAmazonInventoryRecords(omitted, report)
    assert.equal(merged.totalQty, 1)
    assert.equal(merged.stockSource, 'afn_manage_inventory_report')
  })

  it('parses fulfillment-channel: DEFAULT is FBM, AMAZON is Seller Flex / FBA', () => {
    assert.equal(parseReportFulfillmentChannel({ 'fulfillment-channel': 'DEFAULT' }), 'DEFAULT')
    assert.equal(parseReportFulfillmentChannel({ 'fulfillment-channel': 'AMAZON' }), 'AMAZON')
    assert.equal(parseReportFulfillmentChannel({ 'fulfillment-channel': 'Amazon EU' }), 'AMAZON')
  })

  it('excludes FBM and search-suppressed SKUs from Seller Flex listing scope', () => {
    const listings = [
      {
        listingStatus: 'ACTIVE',
        fulfillmentChannel: 'AMAZON',
        normalizedSku: 'sf-sku',
        sellerSku: 'SF-SKU',
      },
      {
        listingStatus: 'ACTIVE',
        fulfillmentChannel: 'DEFAULT',
        normalizedSku: 'fbm-sku',
        sellerSku: 'FBM-SKU',
      },
      {
        listingStatus: 'ACTIVE',
        fulfillmentChannel: 'AMAZON',
        normalizedSku: 'sup-sku',
        sellerSku: 'SUP-SKU',
      },
    ]
    const suppressedSkus = new Set(['sup-sku'])
    const { listings: kept, excludedFbm, excludedSuppressed } = filterSellerFlexActiveListings(
      listings,
      suppressedSkus
    )
    assert.equal(kept.length, 1)
    assert.equal(kept[0].normalizedSku, 'sf-sku')
    assert.equal(excludedFbm, 1)
    assert.equal(excludedSuppressed, 1)
  })

  it('maps merchant report row with DEFAULT fulfillment as FBM not AMAZON', () => {
    const row = mapListingRow(
      {
        sku: '5FP2-24-BLACK',
        'fulfillment-channel': 'DEFAULT',
        status: 'Active',
        asin1: 'B0TEST',
        'item-name': 'Test Pan',
      },
      'uae',
      'A2TEST'
    )
    assert.equal(row?.fulfillmentChannel, 'DEFAULT')
    assert.equal(row?.listingStatus, 'ACTIVE')
  })

  it('queues per-SKU FBA recovery for batch omissions when AFN report is unavailable', () => {
    const listings = [
      { listingStatus: 'ACTIVE', sellerSku: 'A-SKU', normalizedSku: 'a-sku' },
      { listingStatus: 'ACTIVE', sellerSku: 'B-SKU', normalizedSku: 'b-sku' },
      { listingStatus: 'INACTIVE_OOS', sellerSku: 'C-SKU', normalizedSku: 'c-sku' },
    ]
    const fbaApiBySku = new Map([
      ['a-sku', emptyFbaInventory('fba_api_not_returned')],
      ['b-sku', mapInventorySummary({ sellerSku: 'B-SKU', totalQuantity: 2, inventoryDetails: { fulfillableQuantity: 2 } })],
    ])
    const afnReportBySku = new Map()
    const list = buildSingleSkuBackfillList(listings, fbaApiBySku, afnReportBySku, true, 10)
    assert.deepEqual(list, ['A-SKU'])
  })

  it('does not let AFN report override FBA API on-hand when both exist', () => {
    const api = mapInventorySummary({
      sellerSku: '2FP17SET-BEIGE',
      totalQuantity: 10,
      inventoryDetails: { fulfillableQuantity: 10 },
    })
    const report = mapAfnManageInventoryRow({
      sku: '2FP17SET-BEIGE',
      'afn-warehouse-quantity': '1',
      'afn-fulfillable-quantity': '1',
    })
    const merged = mergeAmazonInventoryRecords(api, report)
    assert.equal(merged.totalQty, 10)
    assert.equal(merged.availableQty, 10)
    assert.equal(merged.stockSource, 'fba_api')
  })
})

describe('Amazon + Zoho refresh guardrails', () => {
  it('uses a 60 second SP-API timeout by default', () => {
    assert.equal(resolveAmazonSpApiHttpTimeoutMs(undefined), 60_000)
    assert.equal(resolveAmazonSpApiHttpTimeoutMs('invalid'), 60_000)
  })

  it('honors explicit SP-API timeout values within safe bounds', () => {
    assert.equal(resolveAmazonSpApiHttpTimeoutMs(30_000), 30_000)
    assert.equal(resolveAmazonSpApiHttpTimeoutMs(1_000), 5_000)
    assert.equal(resolveAmazonSpApiHttpTimeoutMs(300_000), 120_000)
  })

  it('uses a 10 minute no-progress stale threshold by default', () => {
    assert.equal(refreshStaleMinutes(undefined), 10)
    assert.equal(refreshStaleMinutes('invalid'), 10)
    assert.equal(refreshStaleMinutes(5), 5)
  })
})
