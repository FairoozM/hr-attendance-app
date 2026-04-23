/**
 * @file Pure merge logic for Zoho line maps → report rows
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildItemIdToSkuMap,
  sumLinesToMap,
  mapLookupForReportRow,
  applyTransactionMapsToRow,
  _internals: { lineCanonicalKey },
} = require('../src/services/weeklyReportZohoLineMerge')

const rawItems = [
  { item_id: '100', sku: 'S-A', name: 'Alpha' },
]

test('lineCanonicalKey: prefers catalog sku for item_id', () => {
  const id = buildItemIdToSkuMap(rawItems)
  const k = lineCanonicalKey({ item_id: 100, name: 'Alpha', quantity: 1 }, id)
  assert.equal(k, 's:s-a')
})

test('sumLinesToMap + applyTransactionMapsToRow: opening_stays stock placeholder (TEMP, not derived)', () => {
  const id = buildItemIdToSkuMap(rawItems)
  const soldM = sumLinesToMap(
    [
      { item_id: '100', name: 'X', quantity: 2 },
      { item_id: '200', name: 'OnlyId', quantity: 1 },
    ],
    id
  )
  const pM = sumLinesToMap([{ item_id: '100', name: 'X', quantity: 5 }], id)
  const rM = sumLinesToMap([{ item_id: '100', name: 'X', quantity: 1 }], id)
  const row = { sku: 'S-A', item_id: '100', item_name: 'Alpha', closing_stock: 10, opening_stock: 10, sold: 0, purchases: 0, returned_to_wholesale: 0 }
  applyTransactionMapsToRow(row, soldM, pM, rM)
  assert.equal(row.sold, 2)
  assert.equal(row.purchases, 5)
  assert.equal(row.returned_to_wholesale, 1)
  assert.equal(row.opening_stock, 10, 'Phase 4 TEMP: opening mirrors stock_on_hand, not closing−purchases+sold+returns')
  assert.equal(mapLookupForReportRow(soldM, row), 2)
})
