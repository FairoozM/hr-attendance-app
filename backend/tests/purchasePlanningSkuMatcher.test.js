const test = require('node:test')
const assert = require('node:assert/strict')
const XLSX = require('xlsx')

const {
  normalizeSku,
  extractColor,
  getParentSku,
  matchZohoSkuToVigil,
} = require('../src/utils/purchasePlanningSkuMatcher')
const {
  parseVigilExcel,
  previewLowStockUpload,
  _internals,
} = require('../src/services/purchasePlanningService')

test('normalizes SKU spacing, case, non-breaking spaces, and long dashes', () => {
  assert.equal(normalizeSku(' ab\u00A0cd — black  '), 'AB CD - BLACK')
})

test('extracts color suffix from hyphen or trailing word', () => {
  assert.equal(extractColor('ABC-RED'), 'RED')
  assert.equal(extractColor('ABC blue'), 'BLUE')
  assert.equal(extractColor('ABC-XL'), '')
})

test('returns parent SKU when a color suffix is present', () => {
  assert.equal(getParentSku('ABC-RED'), 'ABC')
  assert.equal(getParentSku('ABC BLUE'), 'ABC')
})

test('matches Zoho SKU to Vigil by exact code before parent code', () => {
  const rows = [
    { itemCode: 'ABC', availableStock: 4 },
    { itemCode: 'ABC-BLACK', availableStock: 2 },
  ]
  assert.deepEqual(matchZohoSkuToVigil('abc-black', rows), {
    matched: true,
    matchType: 'exact',
    matchedVigilCode: 'ABC-BLACK',
    wholesaleAvailableQty: 2,
  })
})

test('falls back to parent SKU match when exact color code is absent', () => {
  assert.deepEqual(matchZohoSkuToVigil('abc-black', [{ itemCode: 'ABC', availableStock: 7 }]), {
    matched: true,
    matchType: 'parent',
    matchedVigilCode: 'ABC',
    wholesaleAvailableQty: 7,
  })
})

test('parses Vigil Excel stock sheets', () => {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Item Code', 'Available Stock'],
    ['abc-black', 5],
    ['', 3],
  ])
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock')
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const parsed = parseVigilExcel(buffer)

  assert.equal(parsed.summary.validRows, 1)
  assert.equal(parsed.summary.invalidRows, 1)
  assert.equal(parsed.rows[0].normalizedItemCode, 'ABC-BLACK')
  assert.equal(parsed.rows[0].availableStock, 5)
})

test('parses low-stock SKU upload without a header row', () => {
  const parsed = previewLowStockUpload(Buffer.from('abc-black\nabc-blue\n'), 'low-stock.csv')

  assert.equal(parsed.summary.validRows, 2)
  assert.equal(parsed.rows[0].normalizedSku, 'ABC-BLACK')
  assert.equal(parsed.rows[1].normalizedSku, 'ABC-BLUE')
})

test('purchase planning item index matches Zoho item names and prefers warehouse available stock', () => {
  const index = _internals.buildZohoItemIndex([
    {
      item_id: 'z1',
      name: 'DSH-14',
      sku: '6291109111320',
      warehouse_available_for_sale_stock: '2',
      warehouse_actual_available_for_sale_stock: '-1',
      warehouse_actual_available_stock: '0',
      available_stock: '2',
      stock_on_hand: '9',
    },
  ])

  assert.deepEqual(index.get('DSH-14'), {
    sku: '6291109111320',
    itemName: 'DSH-14',
    zohoItemId: 'z1',
    currentZohoStock: 2,
  })
})

test('purchase planning composite usage rolls sold kits down to component quantities', async () => {
  const usage = await _internals.buildCompositeUsageAggregate(
    [
      { item_id: 'kit-1', sku: 'KIT-1-SET', name: 'KIT-1-SET', quantity: 3 },
      { item_id: 'regular-1', sku: 'REGULAR-1', quantity: 5 },
    ],
    async (itemId) => itemId === 'kit-1'
      ? [
        { item_id: 'component-a', sku: 'COMP-A', quantity: 2 },
        { item_id: 'component-b', sku: 'COMP-B', quantity: 1 },
      ]
      : []
  )

  assert.equal(_internals.bundleUsageQtyForItem(usage, { sku: 'COMP-A', zoho_item_id: 'component-a' }), 6)
  assert.equal(_internals.bundleUsageQtyForItem(usage, { sku: 'COMP-B', zoho_item_id: 'component-b' }), 3)
  assert.equal(_internals.bundleUsageQtyForItem(usage, { sku: 'REGULAR-1', zoho_item_id: 'regular-1' }), 0)
})
