const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { _internals, extractPackageDetails } = require('../src/services/ksaPricingZohoService')

describe('ksaPricingZohoService', () => {
  it('extractPackageDetails reads Zoho package_details', () => {
    const dims = extractPackageDetails({
      item_id: '1',
      sku: 'SKU-1',
      package_details: { length: 10, width: 5, height: 3, dimension_unit: 'cm' },
    })
    assert.equal(dims.hasAll, true)
    assert.equal(dims.length, 10)
    assert.equal(dims.width, 5)
    assert.equal(dims.height, 3)
    assert.equal(dims.dimensionUnit, 'cm')
  })

  it('extractPackageDetails flags incomplete dimensions', () => {
    const dims = extractPackageDetails({
      package_details: { length: 10, width: '', height: 3, dimension_unit: 'cm' },
    })
    assert.equal(dims.hasAll, false)
  })

  it('matches colorless item code against Zoho item name', () => {
    const hit = _internals.pickBestItemMatch(
      [
        {
          sku: '6281234567890',
          name: '2FP17SET',
          item_id: 'item-1',
        },
      ],
      '2FP17SET-BEIGE'
    )
    assert.equal(hit.item_id, 'item-1')
  })

  it('matches catalogue code against Zoho raw_json item_name when sku is a barcode', () => {
    const hit = _internals.pickBestItemMatch(
      [
        {
          sku: '6294021002721',
          name: 'LIFE SMILE Fry Pan Set',
          item_id: 'item-flhm',
          raw_json: { item_name: 'FLHM-S-GL-10BLUE' },
        },
      ],
      'FLHM-S-GL-10BLUE'
    )
    assert.equal(hit.item_id, 'item-flhm')
  })

  it('does not treat a single unrelated search hit as a match', () => {
    const hit = _internals.pickBestItemMatch(
      [
        {
          sku: 'OTHER-SKU',
          name: 'Totally different product',
          item_id: 'item-other',
        },
      ],
      'FLHM-S-GL-10BLUE'
    )
    assert.equal(hit, null)
  })

  it('matches parent code against Zoho item_name', () => {
    const hit = _internals.pickBestItemMatch(
      [
        {
          sku: '6294021002721',
          name: 'FLHM-S-GL-10',
          item_id: 'item-flhm-base',
        },
      ],
      'FLHM-S-GL-10BLUE'
    )
    assert.equal(hit.item_id, 'item-flhm-base')
  })

  it('resolves catalogue code from shared inventory sku map keyed by item name', () => {
    const map = new Map([
      [
        'flhm-s-gl-10blue',
        {
          item_id: 'item-flhm',
          sku: '6294021002721',
          name: 'FLHM-S-GL-10BLUE',
        },
      ],
    ])
    const hit = _internals.resolveItemFromSkuMap(map, 'FLHM-S-GL-10BLUE')
    assert.equal(hit.item_id, 'item-flhm')
  })

  it('returns requestedSku separately from Zoho barcode sku', () => {
    const result = _internals.mapLookupResult({
      requestedSku: 'FLHM-S-GL-10BLUE',
      item: {
        item_id: '4265011000031882273',
        sku: '6294021007719',
        name: 'FLHM-S-GL-10BLUE',
        package_details: { length: 38, width: 54, height: 37, dimension_unit: 'cm' },
      },
      source: 'zoho_sku_map',
      status: 'found',
      message: 'Dimensions loaded from Zoho',
    })
    assert.equal(result.requestedSku, 'FLHM-S-GL-10BLUE')
    assert.equal(result.sku, '6294021007719')
    assert.equal(result.itemName, 'FLHM-S-GL-10BLUE')
    assert.equal(result.zohoDimensionStatus, 'found')
  })
})
