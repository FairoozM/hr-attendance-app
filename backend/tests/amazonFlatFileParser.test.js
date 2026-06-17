const test = require('node:test')
const assert = require('node:assert/strict')
const ExcelJS = require('exceljs')
const { parseAmazonFlatFile, normalizeKey } = require('../src/services/amazonFlatFileParserService')
const { validateRow } = require('../src/services/listingValidationService')

async function workbookBuffer(rows) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Template')
  rows.forEach((row) => ws.addRow(row))
  return Buffer.from(await wb.xlsx.writeBuffer())
}

test('amazon flat-file parser detects Template headers, SKUs, and active columns', async () => {
  const buffer = await workbookBuffer([
    ['Some Amazon instruction row'],
    ['SKU', 'Brand Name', 'Manufacturer', 'Item Name', 'Bullet Point 1'],
    ['LIFEP17-10', '', '', '', 'Non-stick coating'],
    ['LIFEP17-20', 'Life Smile', '', 'Existing title', ''],
  ])

  const parsed = await parseAmazonFlatFile({ buffer, filename: 'sample.xlsx' })
  assert.equal(parsed.sheetName, 'Template')
  assert.equal(parsed.headerRowNumber, 2)
  assert.equal(parsed.rows.length, 2)
  assert.equal(parsed.rows[0].sku, 'LIFEP17-10')
  assert.ok(parsed.columns.some((c) => c.key === 'brand_name'))
  assert.ok(parsed.activeColumns.some((c) => c.key === 'bullet_point_1'))
})

test('normalizeKey maps Amazon labels to stable column keys', () => {
  assert.equal(normalizeKey('Are batteries required?'), 'are_batteries_required')
  assert.equal(normalizeKey('Fulfillment Channel Code AE'), 'fulfillment_channel_code_ae')
})

test('listing validation separates missing generated fields as warnings', () => {
  const columns = [
    { key: 'sku', label: 'SKU' },
    { key: 'brand_name', label: 'Brand Name' },
    { key: 'manufacturer', label: 'Manufacturer' },
    { key: 'item_name', label: 'Item Name' },
    { key: 'product_description', label: 'Product Description' },
  ]
  const result = validateRow(
    { sku: 'ABC', current_values: { sku: 'ABC', brand_name: '', manufacturer: '', item_name: 'Test title' } },
    columns,
    new Set()
  )
  assert.equal(result.errors.length, 0)
  assert.ok(result.warnings.some((w) => w.field === 'brand_name'))
  assert.ok(result.warnings.some((w) => w.field === 'product_description'))
})
