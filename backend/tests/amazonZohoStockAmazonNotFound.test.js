const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  ZOHO_ONLY_LISTING_STATUS,
  NOON_ONLY_LISTING_STATUS,
  CREATE_LISTING_ACTION,
  _internals: {
    buildAmazonNotFoundRows,
    appendNoonOnlyRows,
    attachNoonToRows,
    matchVigilStockForComparisonItems,
    isZohoItemActive,
    deriveRecommendedAction,
    rowsToCsv,
    noonCountryCode,
  },
} = require('../src/services/amazonZohoStockComparisonService')
const {
  _internals: { buildWhere, appendListingStatusScope },
} = require('../src/services/amazonZohoStockComparisonStore')

describe('amazonZohoStock amazonNotFound anti-join', () => {
  const warehouse = { warehouseId: 'wh1', warehouseName: 'Life Smile Warehouse' }
  const baseOpts = {
    warehouse,
    marketplaceKey: 'uae',
    marketplaceId: 'A2VIGQ35RCS4UG',
    amazonFetchedAt: '2026-07-31T10:00:00.000Z',
    zohoFetchedAt: '2026-07-31T10:00:00.000Z',
    comparisonGeneratedAt: '2026-07-31T10:01:00.000Z',
  }

  it('isZohoItemActive excludes inactive and deleted', () => {
    assert.equal(isZohoItemActive({ sku: 'A', status: 'active' }), true)
    assert.equal(isZohoItemActive({ sku: 'A' }), true)
    assert.equal(isZohoItemActive({ sku: 'A', status: 'inactive' }), false)
    assert.equal(isZohoItemActive({ sku: 'A', item_status: 'deleted' }), false)
  })

  it('emits ZOHO_ONLY row for unmatched active Zoho item', () => {
    const zohoBySku = new Map()
    const rows = buildAmazonNotFoundRows({
      ...baseOpts,
      zohoBySku,
      amazonListings: [{ sellerSku: 'AMZ-1', normalizedSku: 'amz-1' }],
      rawItems: [
        {
          item_id: 'z1',
          sku: 'ZOHO-ONLY-1',
          name: 'Zoho Only Product',
          status: 'active',
          warehouse_stock_on_hand: '12',
        },
      ],
    })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].listingStatus, ZOHO_ONLY_LISTING_STATUS)
    assert.equal(rows[0].sellerSku, 'ZOHO-ONLY-1')
    assert.equal(rows[0].amazon.stockStatus, 'Not Found')
    assert.equal(rows[0].comparison.isMismatch, false)
    assert.equal(rows[0].comparison.recommendedAction, CREATE_LISTING_ACTION)
    assert.equal(rows[0].zoho.availableQty, 12)
  })

  it('excludes Zoho items already matched via Amazon→Zoho join', () => {
    const zohoBySku = new Map([
      [
        'amz-1',
        {
          itemId: 'z-matched',
          sku: 'MATCHED-SKU',
          normalizedSku: 'amz-1',
          itemName: 'Matched',
          availableQty: 5,
          stockStatus: 'In Stock',
        },
      ],
    ])
    const rows = buildAmazonNotFoundRows({
      ...baseOpts,
      zohoBySku,
      amazonListings: [{ sellerSku: 'AMZ-1', normalizedSku: 'amz-1' }],
      rawItems: [
        {
          item_id: 'z-matched',
          sku: 'MATCHED-SKU',
          name: 'Matched',
          status: 'active',
          warehouse_stock_on_hand: '5',
        },
        {
          item_id: 'z-only',
          sku: 'ONLY-SKU',
          name: 'Only',
          status: 'active',
          warehouse_stock_on_hand: '1',
        },
      ],
    })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].zoho.itemId, 'z-only')
  })

  it('excludes inactive Zoho items', () => {
    const rows = buildAmazonNotFoundRows({
      ...baseOpts,
      zohoBySku: new Map(),
      amazonListings: [],
      rawItems: [
        {
          item_id: 'z-inactive',
          sku: 'INACTIVE-SKU',
          name: 'Inactive',
          status: 'inactive',
          warehouse_stock_on_hand: '9',
        },
      ],
    })
    assert.equal(rows.length, 0)
  })

  it('excludes Zoho item whose lookup key hits an Amazon listing SKU', () => {
    const rows = buildAmazonNotFoundRows({
      ...baseOpts,
      zohoBySku: new Map(),
      amazonListings: [{ sellerSku: '2FP17SET-BEIGE', normalizedSku: '2fp17set-beige' }],
      rawItems: [
        {
          item_id: 'z-alias',
          sku: '6294021006859',
          name: '2FP17SET-BEIGE',
          status: 'active',
          warehouse_stock_on_hand: '28',
        },
      ],
    })
    assert.equal(rows.length, 0)
  })

  it('skips Zoho-only insert when normalized_sku collides with Amazon row', () => {
    const rows = buildAmazonNotFoundRows({
      ...baseOpts,
      zohoBySku: new Map(),
      amazonListings: [{ sellerSku: 'SAME-SKU', normalizedSku: 'same-sku' }],
      rawItems: [
        {
          item_id: 'z-collide',
          sku: 'SAME-SKU',
          name: 'Should collide',
          status: 'active',
          warehouse_stock_on_hand: '3',
        },
      ],
    })
    assert.equal(rows.length, 0)
  })

  it('deriveRecommendedAction returns Create listing on Amazon when amazon Not Found', () => {
    assert.equal(
      deriveRecommendedAction({
        amazonAvailable: 0,
        zohoAvailable: 10,
        zohoStatus: 'In Stock',
        difference: 10,
        threshold: 5,
        amazonStatus: 'Not Found',
      }),
      CREATE_LISTING_ACTION
    )
  })
})

describe('amazonZohoStock amazonNotFound filter SQL scope', () => {
  it('scopes amazonNotFound to ZOHO_ONLY listing_status', () => {
    const clauses = []
    appendListingStatusScope(clauses, 'amazonNotFound')
    assert.deepEqual(clauses, [`listing_status = 'ZOHO_ONLY'`])
  })

  it('keeps default scope on ACTIVE + Amazon fulfillment', () => {
    const clauses = []
    appendListingStatusScope(clauses, 'all')
    assert.ok(clauses.some((c) => c.includes(`listing_status = 'ACTIVE'`)))
    assert.ok(clauses.some((c) => c.includes('AMAZON')))
  })

  it('buildWhere for amazonNotFound does not apply ACTIVE+AMAZON', () => {
    const { whereSql } = buildWhere({ stockFilter: 'amazonNotFound', marketplace: 'uae' })
    assert.match(whereSql, /listing_status = 'ZOHO_ONLY'/)
    assert.doesNotMatch(whereSql, /listing_status = 'ACTIVE'/)
    assert.doesNotMatch(whereSql, /AMAZON/)
  })

  it('buildWhere for all does not include ZOHO_ONLY rows', () => {
    const { whereSql } = buildWhere({ stockFilter: 'all' })
    assert.match(whereSql, /listing_status = 'ACTIVE'/)
    assert.doesNotMatch(whereSql, /ZOHO_ONLY/)
  })

  it('coverage listingScope excludes ZOHO_ONLY', () => {
    const { whereSql } = buildWhere({ listingScope: 'coverage', stockFilter: 'all', marketplace: 'uae' })
    assert.match(whereSql, /NOT IN \('ZOHO_ONLY', 'NOON_ONLY'\)/)
    assert.doesNotMatch(whereSql, /listing_status = 'ACTIVE'/)
  })

  it('builds cache-only Noon channel filters without changing default Amazon scope', () => {
    const missingAmazon = buildWhere({ stockFilter: 'noonLiveAmazonMissing', marketplace: 'uae' }).whereSql
    assert.match(missingAmazon, /noon_is_active IS TRUE/)
    assert.match(missingAmazon, /amazon_stock_status = 'Not Found'/)
    assert.doesNotMatch(missingAmazon, /listing_status = 'ACTIVE'/)

    const missingNoon = buildWhere({ stockFilter: 'amazonLiveNoonMissing', marketplace: 'uae' }).whereSql
    assert.match(missingNoon, /listing_status = 'ACTIVE'/)
    assert.match(missingNoon, /noon_partner_sku IS NULL/)
  })
})

describe('amazonZohoStock Noon matching', () => {
  const baseRow = {
    marketplaceKey: 'uae',
    marketplace: 'UAE',
    marketplaceId: 'A2VIGQ35RCS4UG',
    sellerSku: 'AMAZON-SKU',
    normalizedSku: 'AMAZON-SKU',
    listingStatus: 'ACTIVE',
    amazon: { stockStatus: 'In Stock', totalQty: 2, availableQty: 2 },
    zoho: { sku: 'ZOHO-ALIAS', itemName: 'NOON-PSKU', availableQty: 4, stockStatus: 'In Stock' },
    comparison: {},
    timestamps: {},
  }

  it('locks Noon comparison matching to UAE', () => {
    assert.equal(noonCountryCode('uae'), 'ae')
    assert.equal(noonCountryCode('ksa'), 'ae')
  })

  it('matches a Noon PSKU through the Zoho item-name alias', () => {
    const result = attachNoonToRows(
      [baseRow],
      [{
        partner_sku: 'PARTNER-1',
        psku: 'NOON-PSKU',
        noon_sku: 'N123',
        title: 'Noon item',
        is_active: true,
        stock_quantity: '8',
      }],
      'ae'
    )
    assert.equal(result.rows[0].noon.partnerSku, 'PARTNER-1')
    assert.equal(result.rows[0].noon.stockQty, 8)
    assert.deepEqual([...result.matchedPartnerSkus], ['PARTNER-1'])
  })

  it('appends active unmatched Noon rows and ignores inactive rows', () => {
    const rows = appendNoonOnlyRows({
      rows: [],
      snapshots: [
        { partner_sku: 'LIVE-1', psku: 'LIVE-1', title: 'Live', is_active: true, stock_quantity: 5 },
        { partner_sku: 'OLD-1', psku: 'OLD-1', title: 'Old', is_active: false, stock_quantity: 9 },
      ],
      countryCode: 'ae',
      marketplaceKey: 'uae',
      marketplaceId: 'A2VIGQ35RCS4UG',
      warehouseStock: null,
      amazonFetchedAt: '2026-08-02T10:00:00.000Z',
      zohoFetchedAt: null,
      comparisonGeneratedAt: '2026-08-02T10:01:00.000Z',
    })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].listingStatus, NOON_ONLY_LISTING_STATUS)
    assert.equal(rows[0].amazon.stockStatus, 'Not Found')
    assert.equal(rows[0].noon.stockQty, 5)
  })
})

describe('amazonZohoStock Vigil quantity matching', () => {
  it('prefers an Amazon SKU exact match over the Zoho SKU', () => {
    const matches = matchVigilStockForComparisonItems({
      vigilRows: [
        { itemCode: 'AMAZON-RED', availableStock: 4 },
        { itemCode: 'ZOHO-RED', availableStock: 9 },
      ],
      items: [
        {
          rowKey: 'UAE:amazon-red',
          sellerSku: 'AMAZON-RED',
          zohoSku: 'ZOHO-RED',
        },
      ],
    })
    assert.deepEqual(matches[0], {
      rowKey: 'UAE:amazon-red',
      vigilStockQty: 4,
      matchType: 'exact',
      ambiguous: false,
    })
  })

  it('falls back to a colorless Vigil family through the Zoho SKU', () => {
    const matches = matchVigilStockForComparisonItems({
      vigilRows: [{ itemCode: 'LIFEP17-16', availableStock: 12 }],
      items: [
        {
          rowKey: 'UAE:barcode',
          sellerSku: '6294021006859',
          zohoSku: 'LIFEP17-16-BLUE',
        },
      ],
    })
    assert.deepEqual(matches[0], {
      rowKey: 'UAE:barcode',
      vigilStockQty: 12,
      matchType: 'parent',
      ambiguous: false,
    })
  })

  it('matches family prefixes from Vigil and Zoho item names when their SKUs differ', () => {
    const matches = matchVigilStockForComparisonItems({
      vigilRows: [
        {
          itemCode: '629110000001',
          itemName: 'LIFE P17-16 Fry Pan',
          availableStock: 18,
        },
      ],
      items: [
        {
          rowKey: 'UAE:different-barcode',
          sellerSku: 'AMAZON-UNRELATED',
          zohoSku: '629110999999',
          zohoItemName: 'LIFE P17-16 BLUE Fry Pan',
        },
      ],
    })
    assert.deepEqual(matches[0], {
      rowKey: 'UAE:different-barcode',
      vigilStockQty: 18,
      matchType: 'parent',
      ambiguous: false,
    })
  })

  it('returns no quantity for unmatched comparison rows', () => {
    const matches = matchVigilStockForComparisonItems({
      vigilRows: [{ itemCode: 'OTHER-SKU', availableStock: 6 }],
      items: [{ rowKey: 'UAE:missing', sellerSku: 'NO-MATCH', zohoSku: '' }],
    })
    assert.deepEqual(matches[0], {
      rowKey: 'UAE:missing',
      vigilStockQty: null,
      matchType: 'not_found',
      ambiguous: false,
    })
  })

  it('includes Vigil stock quantity in CSV exports', () => {
    const csv = rowsToCsv([
      {
        marketplace: 'UAE',
        sellerSku: 'FAMILY-1-BLUE',
        zoho: { availableQty: 3 },
        amazon: { availableQty: 0, totalQty: 0 },
        comparison: {},
        vigilStockQty: 27,
      },
    ])
    const [headers, values] = csv.split('\n').map((line) => line.split(','))
    assert.equal(values[headers.indexOf('Vigil Stock Qty')], '27')
  })

  it('includes Noon listing and stock fields in CSV exports', () => {
    const csv = rowsToCsv([
      {
        marketplace: 'UAE',
        sellerSku: 'SKU-1',
        amazon: {},
        zoho: {},
        noon: {
          partnerSku: 'NOON-1',
          sku: 'N-1',
          isActive: true,
          listingStatus: 'ACTIVE',
          stockQty: 11,
          catalogSyncedAt: '2026-08-02T10:00:00.000Z',
          stockSyncedAt: '2026-08-02T10:01:00.000Z',
        },
        comparison: {},
      },
    ])
    const [headers, values] = csv.split('\n').map((line) => line.split(','))
    assert.equal(values[headers.indexOf('Noon Partner SKU')], 'NOON-1')
    assert.equal(values[headers.indexOf('Noon Stock Qty')], '11')
  })
})
