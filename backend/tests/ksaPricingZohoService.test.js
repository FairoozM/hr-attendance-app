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
})
