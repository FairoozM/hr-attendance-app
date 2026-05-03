const test = require('node:test')
const assert = require('node:assert/strict')
const XLSX = require('xlsx')

const {
  normalizeSku,
  extractColor,
  getParentSku,
  matchZohoSkuToVigil,
} = require('../src/utils/purchasePlanningSkuMatcher')
const { parseVigilExcel } = require('../src/services/purchasePlanningService')

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
