const test = require('node:test')
const assert = require('node:assert')

const {
  collectRawIdentifiers,
  pickDisplaySku,
} = require('../src/services/compositeItemsZohoLookup')

/** Real Zoho shape: SKU holds the EAN, the catalog code is the name, custom fields hold attributes. */
const ITEM_WITH_BIN_LOCATION = {
  item_id: '4265011000008395725',
  name: 'LIFEP12SHR32SILVER',
  sku: '6294021003384',
  part_number: '',
  cf_warehouse_location: 'A-J-2',
  cf_warehouse_location_unformatted: 'A-J-2',
  cf_family: 'LIFEP12',
  cf_family_unformatted: 'LIFEP12',
}

test('display SKU is the catalog code, not the warehouse bin location', () => {
  const identifiers = collectRawIdentifiers(ITEM_WITH_BIN_LOCATION, '6294021003384', '')
  assert.strictEqual(pickDisplaySku(identifiers), 'LIFEP12SHR32SILVER')
})

test('warehouse location and family never become match keys', () => {
  const identifiers = collectRawIdentifiers(ITEM_WITH_BIN_LOCATION, '6294021003384', '')
  assert.ok(!identifiers.includes('A-J-2'), 'rack location must not be a match key')
  assert.ok(!identifiers.includes('LIFEP12'), 'family code must not be a match key')
  assert.ok(identifiers.includes('LIFEP12SHR32SILVER'))
  assert.ok(identifiers.includes('6294021003384'), 'EAN stays a valid match key')
})

test('labelled custom fields are filtered the same way as cf_ keys', () => {
  const identifiers = collectRawIdentifiers(
    {
      name: 'LIFEP12SAU-16SILVER',
      sku: '6294021003377',
      custom_fields: [
        { label: 'Warehouse Location', api_name: 'cf_warehouse_location', value: 'B-3-1' },
        { label: 'Item Code', api_name: 'cf_item_code', value: 'LIFEP12SAU16' },
      ],
    },
    '',
    '',
  )
  assert.ok(!identifiers.includes('B-3-1'))
  assert.ok(identifiers.includes('LIFEP12SAU16'), 'code-bearing custom fields are kept')
})

test('hyphenated catalog codes still win over barcodes and titles', () => {
  assert.strictEqual(
    pickDisplaySku(['6294021003384', 'LIFEP12SAU-16SILVER', 'Life Smile 16cm Saucepan Silver']),
    'LIFEP12SAU-16SILVER',
  )
})

test('bin-style codes lose to any real code', () => {
  assert.strictEqual(pickDisplaySku(['A-J-2', 'LIFEP12SHR32SILVER']), 'LIFEP12SHR32SILVER')
  assert.strictEqual(pickDisplaySku(['B-1', 'BRKHSILVER']), 'BRKHSILVER')
})

test('a barcode is still the fallback when no code-like identifier exists', () => {
  assert.strictEqual(pickDisplaySku(['A-J-2', '6294021003384']), '6294021003384')
})
