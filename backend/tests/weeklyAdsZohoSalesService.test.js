/**
 * @file Weekly Ads Zoho warehouse name matching (word boundaries).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  _internals: { tokenMatchesInWarehouseName },
} = require('../src/services/weeklyAdsZohoSalesService')

test('tokenMatchesInWarehouseName: direct does not match inside Directship', () => {
  assert.equal(tokenMatchesInWarehouseName('noon return (directship)', 'direct'), false)
})

test('tokenMatchesInWarehouseName: direct matches standalone word', () => {
  assert.equal(tokenMatchesInWarehouseName('web direct channel', 'direct'), true)
})

test('tokenMatchesInWarehouseName: noon matches Noon Express', () => {
  assert.equal(tokenMatchesInWarehouseName('noon express', 'noon'), true)
})
