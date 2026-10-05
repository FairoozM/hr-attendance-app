'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { buildZohoMatchIndex, matchAmazonSku } = require('../src/services/amazonControlTower/skuMatcher.ts')

const CATALOG = [
  { zohoItemId: '1', itemCode: 'LIFEP12-10SILVER', itemName: 'Cookware Silver 10' },
  { zohoItemId: '2', itemCode: '6291100000002', itemName: 'LIFEP17-24-BLACK' },
  { zohoItemId: '3', itemCode: 'FP SET BEIGE', itemName: 'Frying pan set beige' },
  // Two Zoho items that both answer to "DUP-ITEM": one by code, one by name.
  { zohoItemId: '4', itemCode: 'DUP-ITEM', itemName: 'Duplicate A' },
  { zohoItemId: '5', itemCode: '6291100000005', itemName: 'DUP ITEM' },
]

describe('Control Tower SKU matcher', () => {
  const index = buildZohoMatchIndex(CATALOG)

  it('exact item-code match is AUTO_MATCHED (never CONFIRMED)', () => {
    const m = matchAmazonSku('LIFEP12-10SILVER', index)
    assert.equal(m.status, 'AUTO_MATCHED')
    assert.equal(m.zohoItemId, '1')
    assert.equal(m.method, 'EXACT_ITEM_CODE')
    assert.equal(m.confidence, 1)
  })

  it('unicode dash in the Amazon SKU still matches exactly', () => {
    const m = matchAmazonSku('lifep12–10silver', index)
    assert.equal(m.status, 'AUTO_MATCHED')
    assert.equal(m.zohoItemId, '1')
    assert.equal(m.method, 'EXACT_ITEM_CODE')
  })

  it('spaces vs dashes match through the normalized tier', () => {
    const m = matchAmazonSku('FP-SET-BEIGE', index)
    assert.equal(m.status, 'AUTO_MATCHED')
    assert.equal(m.zohoItemId, '3')
    assert.equal(m.method, 'NORMALIZED_ITEM_CODE')
    assert.ok(m.confidence < 1)
  })

  it('matches the Zoho item name when the Zoho code is a barcode', () => {
    const m = matchAmazonSku('LIFEP17-24-BLACK', index)
    assert.equal(m.status, 'AUTO_MATCHED')
    assert.equal(m.zohoItemId, '2')
    assert.equal(m.method, 'EXACT_ITEM_NAME')
    assert.equal(m.confidence, 0.95)
  })

  it('multiple reasonable Zoho items → REVIEW_REQUIRED with candidates, no mapping', () => {
    const m = matchAmazonSku('DUP-ITEM', index)
    assert.equal(m.status, 'REVIEW_REQUIRED')
    assert.equal(m.zohoItemId, null)
    assert.deepEqual(m.candidates.map((c: any) => c.zohoItemId).sort(), ['4', '5'])
    assert.equal(m.candidates[0].zohoItemId, '4')
    assert.ok(m.confidence <= 0.5)
  })

  it('no match → UNMAPPED', () => {
    const m = matchAmazonSku('UNKNOWN-SKU-9', index)
    assert.equal(m.status, 'UNMAPPED')
    assert.equal(m.zohoItemId, null)
    assert.equal(m.candidates.length, 0)
  })

  it('a prefix is not a match', () => {
    assert.equal(matchAmazonSku('LIFEP12', index).status, 'UNMAPPED')
  })
})
