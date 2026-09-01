'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeTechnicalHeader,
  openTemplateWorkbook,
} = require('../src/services/amazonInitialDraft/amazonTemplateWorkbook')
const { applyCellWrites, readSheetCells, parseSharedStrings } = require('../src/services/amazonInitialDraft/worksheetXml')
const opc = require('../src/services/amazonInitialDraft/opcPackage')
const {
  UAE_EXAMPLE,
  UAE_HEADERS,
  UAE_LABELS,
  buildTemplateWorkbook,
} = require('./helpers/amazonTemplateFixture')

function open(overrides = {}) {
  const { buffer } = buildTemplateWorkbook({
    technicalHeaders: UAE_HEADERS,
    displayLabels: UAE_LABELS,
    groupLabels: { A: 'Listing Identity', D: 'Variations', G: 'Product Identity' },
    exampleRow: UAE_EXAMPLE,
    dataRows: { 8: { A: 'SKU-1' }, 9: { A: 'SKU-2' } },
    ...overrides,
  })
  return openTemplateWorkbook(buffer)
}

describe('normalizeTechnicalHeader', () => {
  it('strips marketplace and language qualifiers and the occurrence index', () => {
    assert.equal(
      normalizeTechnicalHeader('item_package_dimensions[marketplace_id=A2VIGQ35RCS4UG]#1.length.unit'),
      'item_package_dimensions.length.unit'
    )
    assert.equal(
      normalizeTechnicalHeader('item_name[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#1.value'),
      'item_name.value'
    )
    assert.equal(normalizeTechnicalHeader('contribution_sku#1.value'), 'contribution_sku.value')
  })

  it('maps every occurrence of an attribute to the same key', () => {
    const first = normalizeTechnicalHeader('warranty_description[marketplace_id=X][language_tag=en_AE]#1.value')
    const fifth = normalizeTechnicalHeader('warranty_description[marketplace_id=X][language_tag=en_AE]#5.value')
    assert.equal(first, fifth)
  })

  it('is unchanged by a different marketplace or language, so the mapping survives', () => {
    assert.equal(
      normalizeTechnicalHeader('brand[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#1.value'),
      normalizeTechnicalHeader('brand[marketplace_id=SOMETHING_ELSE][language_tag=ar_AE]#1.value')
    )
  })
})

describe('openTemplateWorkbook — structure discovery', () => {
  it('finds the technical-header row by density and the SKU column, not the label row', () => {
    const workbook = open()
    assert.equal(workbook.headerRow, 5)
    assert.equal(workbook.skuColumn, 1)
    assert.equal(workbook.skuColumnLetters, 'A')
  })

  it('takes the first data row from the frozen pane', () => {
    const workbook = open()
    assert.equal(workbook.firstDataRow, 8)
    assert.equal(workbook.firstDataRowBasis, 'frozen-pane')
  })

  it('keeps listings sitting above a pane the seller froze further down', () => {
    // A pane frozen at A28 while the listings start at row 8: every row above the pane
    // used to be discarded, so those SKUs silently produced no images and no attributes.
    const dataRows = {}
    for (let row = 8; row <= 30; row += 1) dataRows[row] = { A: `SKU-${row}` }

    const workbook = open({
      pane: 'A28',
      dataRows,
    })

    assert.equal(workbook.firstDataRow, 8)
    assert.equal(workbook.firstDataRowBasis, 'sku-rows-above-frozen-pane')
    assert.equal(workbook.dataRows.filter((row) => row.sku).length, 23)
    assert.ok(workbook.dataRows.some((row) => row.sku === 'SKU-8'))
    // Amazon's placeholder must still never be treated as seller data.
    assert.ok(!workbook.dataRows.some((row) => row.sku === 'ABC123'))
  })

  it('skips the example row and the banner row when there is no frozen pane', () => {
    const workbook = open({ pane: null })
    assert.equal(workbook.firstDataRowBasis, 'annotation-scan')
    assert.equal(workbook.firstDataRow, 8)
    // Amazon's placeholder SKU must never be treated as seller data.
    assert.ok(!workbook.dataRows.some((row) => row.sku === 'ABC123'))
  })

  it('builds the column table with labels and carried-forward group headings', () => {
    const workbook = open()
    assert.equal(workbook.columns.length, Object.keys(UAE_HEADERS).length)
    const itemName = workbook.columns.find((column) => column.normalizedKey === 'item_name.value')
    assert.equal(itemName.letters, 'G')
    assert.equal(itemName.displayLabel, 'Item Name')
    assert.equal(itemName.groupLabel, 'Product Identity')
    const parentSku = workbook.columns.find((column) => column.letters === 'E')
    assert.equal(parentSku.groupLabel, 'Variations')
  })

  it('lists all sheets including hidden ones', () => {
    const workbook = open()
    assert.deepEqual(
      workbook.sheets.map((sheet) => `${sheet.name}:${sheet.state}`),
      ['Template:visible', 'Dropdown Lists:hidden']
    )
  })

  it('reads seller SKUs from the data rows only', () => {
    const workbook = open()
    const withSku = workbook.dataRows.filter((row) => row.sku)
    assert.deepEqual(withSku.map((row) => row.sku), ['SKU-1', 'SKU-2'])
  })

  it('parses identically when the subtype column is blank, unknown or renamed', () => {
    const baseline = open().columns.length
    for (const subtype of ['', 'A-SUBTYPE-WE-HAVE-NEVER-SEEN', 'COOKING_POT']) {
      const workbook = open({ dataRows: { 8: { A: 'SKU-1', B: subtype } } })
      assert.equal(workbook.headerRow, 5)
      assert.equal(workbook.firstDataRow, 8)
      assert.equal(workbook.columns.length, baseline)
    }
  })

  it('rejects a workbook with no technical-header row rather than guessing', () => {
    assert.throws(
      () => open({ technicalHeaders: { A: 'Some Heading', B: 'Another Heading' } }),
      /no technical-header row declaring a SKU column/i
    )
  })
})

describe('applyCellWrites — surgical worksheet patching', () => {
  function sheetOf(buffer) {
    const pkg = opc.readPackage(buffer)
    return {
      pkg,
      xml: opc.readEntryContent(opc.findEntry(pkg, 'xl/worksheets/sheet1.xml')).toString('utf8'),
      strings: parseSharedStrings(opc.readEntryContent(opc.findEntry(pkg, 'xl/sharedStrings.xml')).toString('utf8')),
    }
  }

  it('writes text as an inline string so shared strings never change', () => {
    const { buffer } = buildTemplateWorkbook({ technicalHeaders: UAE_HEADERS, dataRows: { 8: { A: 'SKU-1' } } })
    const { xml, strings } = sheetOf(buffer)
    const { xml: patched, written } = applyCellWrites(xml, [{ row: 8, column: 7, value: 'Hello & <world>' }])

    assert.equal(written.length, 1)
    assert.equal(written[0].reference, 'G8')
    assert.match(patched, /<c r="G8" t="inlineStr"><is><t xml:space="preserve">Hello &amp; &lt;world&gt;<\/t><\/is><\/c>/)
    assert.equal(readSheetCells(patched, strings).get(8).get(7).value, 'Hello & <world>')
  })

  it('writes numbers as numbers, not text', () => {
    const { buffer } = buildTemplateWorkbook({ technicalHeaders: UAE_HEADERS, dataRows: { 8: { A: 'SKU-1' } } })
    const { xml } = sheetOf(buffer)
    const { xml: patched } = applyCellWrites(xml, [{ row: 8, column: 17, value: '16.6', numeric: true }])
    assert.match(patched, /<c r="Q8"><v>16\.6<\/v><\/c>/)
  })

  it('keeps cells in ascending column order within a row', () => {
    const { buffer } = buildTemplateWorkbook({ technicalHeaders: UAE_HEADERS, dataRows: { 8: { A: 'SKU-1' } } })
    const { xml } = sheetOf(buffer)
    const { xml: patched } = applyCellWrites(xml, [
      { row: 8, column: 20, value: 'Centimeters' },
      { row: 8, column: 7, value: 'Name' },
      { row: 8, column: 9, value: 'Life Smile' },
    ])
    const row = /<row r="8"[^>]*>([\s\S]*?)<\/row>/.exec(patched)[1]
    const order = [...row.matchAll(/<c r="([A-Z]+)8"/g)].map((match) => match[1])
    assert.deepEqual(order, ['A', 'G', 'I', 'T'])
  })

  it('preserves the existing cell style when filling a styled blank cell', () => {
    const { buffer } = buildTemplateWorkbook({ technicalHeaders: UAE_HEADERS, dataRows: { 8: { A: 'SKU-1' } } })
    const { xml } = sheetOf(buffer)
    // Column A already carries s="104" in the fixture.
    const { xml: patched } = applyCellWrites(xml, [{ row: 8, column: 1, value: 'REPLACED' }])
    assert.match(patched, /<c r="A8" s="104" t="inlineStr">/)
  })

  it('leaves validations, conditional formatting and merges untouched', () => {
    const { buffer } = buildTemplateWorkbook({ technicalHeaders: UAE_HEADERS, dataRows: { 8: { A: 'SKU-1' } } })
    const { xml } = sheetOf(buffer)
    const { xml: patched } = applyCellWrites(xml, [{ row: 8, column: 7, value: 'Name' }])
    for (const fragment of [
      '<dataValidation type="list"',
      'sqref="B8:B1048576"',
      '<conditionalFormatting sqref=',
      '<mergeCell ref=',
      '<cols>',
    ]) {
      assert.ok(patched.includes(fragment), `lost ${fragment}`)
    }
  })

  it('never overwrites a formula cell', () => {
    const xml =
      '<worksheet><sheetData><row r="8" spans="1:3"><c r="A8" s="1" t="str"><f>CONCATENATE("a","b")</f><v>ab</v></c></row></sheetData></worksheet>'
    const { written, skipped } = applyCellWrites(xml, [{ row: 8, column: 1, value: 'new' }])
    assert.equal(written.length, 0)
    assert.equal(skipped[0].reason, 'formula-cell')
  })

  it('reports a write aimed at a row that does not exist instead of corrupting the sheet', () => {
    const { buffer } = buildTemplateWorkbook({ technicalHeaders: UAE_HEADERS, dataRows: { 8: { A: 'SKU-1' } } })
    const { xml } = sheetOf(buffer)
    const { xml: patched, written, skipped } = applyCellWrites(xml, [{ row: 9999, column: 7, value: 'x' }])
    assert.equal(written.length, 0)
    assert.equal(skipped[0].reason, 'row-missing')
    assert.equal(patched, xml)
  })
})
