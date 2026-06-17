/**
 * @file Weekly Ads Zoho Books Sales-by-Customer mapping (exact customer names).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  _internals: { MARKETPLACE_TO_ZOHO_CUSTOMER_NAME, aggregateSalesWithTaxByCustomerName },
} = require('../src/services/weeklyAdsZohoSalesService')

test('MARKETPLACE_TO_ZOHO_CUSTOMER_NAME: exact Books names as agreed', () => {
  assert.equal(MARKETPLACE_TO_ZOHO_CUSTOMER_NAME['Amazon (UAE)'], 'Amazon')
  assert.equal(MARKETPLACE_TO_ZOHO_CUSTOMER_NAME['Amazon (KSA)'], 'KSA-Amazon')
  assert.equal(MARKETPLACE_TO_ZOHO_CUSTOMER_NAME.Noon, 'Noon')
  assert.equal(MARKETPLACE_TO_ZOHO_CUSTOMER_NAME.Website, 'Website')
})

test('aggregateSalesWithTaxByCustomerName: sums by exact customer_name', () => {
  const m = aggregateSalesWithTaxByCustomerName([
    { customer_name: 'Amazon', sales_with_tax: 100 },
    { customer_name: 'KSA-Amazon', sales_with_tax: 42.5 },
    { customer_name: 'Noon', sales_with_tax: '10' },
  ])
  assert.equal(m.get('Amazon'), 100)
  assert.equal(m.get('KSA-Amazon'), 42.5)
  assert.equal(m.get('Noon'), 10)
})

test('aggregateSalesWithTaxByCustomerName: trims name and merges duplicate customer rows', () => {
  const m = aggregateSalesWithTaxByCustomerName([
    { customer_name: '  Website  ', sales_with_tax: 1 },
    { customer_name: 'Website', sales_with_tax: 2 },
  ])
  assert.equal(m.get('Website'), 3)
})

test('aggregateSalesWithTaxByCustomerName: skips bad numbers', () => {
  const m = aggregateSalesWithTaxByCustomerName([{ customer_name: 'X', sales_with_tax: 'nope' }])
  assert.equal(m.has('X'), false)
})
