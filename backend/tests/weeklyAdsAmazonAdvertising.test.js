/**
 * @file Amazon Advertising helpers for Weekly Ads (report body parsing).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { sumCostAndClicksFromReportBody } = require('../src/services/amazonAdvertisingService')

test('sumCostAndClicksFromReportBody: NDJSON lines', () => {
  const text = '{"cost":1.5,"clicks":10}\n{"cost":2,"clicks":3}\n'
  const r = sumCostAndClicksFromReportBody(text)
  assert.equal(r.cost, 3.5)
  assert.equal(r.clicks, 13)
})

test('sumCostAndClicksFromReportBody: JSON array and uppercase keys', () => {
  const text = JSON.stringify([
    { cost: '1', clicks: '2' },
    { COST: 3, CLICKS: 4 },
  ])
  const r = sumCostAndClicksFromReportBody(text)
  assert.equal(r.cost, 4)
  assert.equal(r.clicks, 6)
})
