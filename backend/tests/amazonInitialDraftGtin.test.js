'use strict'

/**
 * Zoho barcode → Amazon GTIN transform and Excel text preservation.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  computeGtinCheckDigit,
  transformZohoBarcodeToGtin,
  validateGtinCheckDigit,
} = require('../src/services/amazonInitialDraft/gtinTransform')
const { runInitialDraftPipeline, isSameValue } = require('../src/services/amazonInitialDraft/draftGenerator')
const { normalizeSpecEntries } = require('../src/services/amazonInitialDraft/specParsers')
const { readSheetCells, parseSharedStrings, columnLettersToIndex } = require('../src/services/amazonInitialDraft/worksheetXml')
const opc = require('../src/services/amazonInitialDraft/opcPackage')
const { openTemplateWorkbook } = require('../src/services/amazonInitialDraft/amazonTemplateWorkbook')
const { buildZip } = require('./helpers/amazonTemplateFixture')

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function catalogItem(overrides = {}) {
  return {
    itemCode: 'LS-POT-24',
    productName: 'Life Smile Cooking Pot',
    longDescription: '<p>Steel pot</p>',
    shortDescription: '<ul><li>Easy clean</li></ul>',
    color: 'Silver',
    size: '24 cm',
    material: 'Stainless Steel',
    variantType: 'Single',
    categoryName: 'Cookware',
    subCategoryName: 'Pots',
    status: 'active',
    matchSource: 'product',
    parentItemCode: null,
    variantCount: 0,
    specs: normalizeSpecEntries('[{"title":"Capacity","description":"5 L"}]'),
    weightDimensions: normalizeSpecEntries('[{"title":"Weight","description":"2.5 KG"}]'),
    ...overrides,
  }
}

function matched(item) {
  return { status: 'matched', item, candidates: [] }
}

function resolveZohoFromMap(barcodeBySku) {
  return async (skus) => {
    const map = new Map()
    for (const sku of skus) {
      const entry = barcodeBySku[sku]
      if (entry && typeof entry === 'object' && 'barcode' in entry) {
        map.set(sku, {
          sku,
          status: entry.status || 'found',
          zohoSku: sku,
          itemId: entry.itemId || '1',
          barcode: entry.barcode,
          reason: entry.reason || null,
        })
      } else if (typeof entry === 'string') {
        map.set(sku, {
          sku,
          status: 'found',
          zohoSku: sku,
          itemId: '1',
          barcode: entry,
          reason: null,
        })
      } else {
        map.set(sku, {
          sku,
          status: 'not-found',
          zohoSku: '',
          itemId: '',
          barcode: '',
          reason: 'zoho-sku-not-found',
        })
      }
    }
    return map
  }
}

function buildGtinWorkbook({ dataRows = {}, existingProductId = '' } = {}) {
  const headers = {
    A: 'contribution_sku#1.value',
    B: 'product_type#1.value',
    C: 'item_name[marketplace_id=X][language_tag=en_AE]#1.value',
    D: 'amzn1.volt.ca.product_id_type',
    E: 'amzn1.volt.ca.product_id_value',
  }
  const labels = {
    A: 'SKU',
    B: 'Product Type',
    C: 'Item Name',
    D: 'Product ID Type',
    E: 'Product ID',
  }

  const cell = (ref, value, type = 'inlineStr') => {
    if (value === '' || value == null) return `<c r="${ref}"/>`
    if (type === 'n') return `<c r="${ref}"><v>${escapeXml(value)}</v></c>`
    return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
  }

  const defaultRows = {
    8: { A: 'LS-POT-24', B: '', C: '', D: '', E: existingProductId },
  }
  const rows = { ...defaultRows, ...dataRows }

  const sheetRows = [
    `<row r="3">${Object.keys(headers)
      .map((letter) => cell(`${letter}3`, 'Identity'))
      .join('')}</row>`,
    `<row r="4">${Object.keys(headers)
      .map((letter) => cell(`${letter}4`, labels[letter]))
      .join('')}</row>`,
    `<row r="5">${Object.keys(headers)
      .map((letter) => cell(`${letter}5`, headers[letter]))
      .join('')}</row>`,
    `<row r="6"/>`,
    `<row r="7"/>`,
  ]

  for (const [rowNumber, values] of Object.entries(rows)) {
    sheetRows.push(
      `<row r="${rowNumber}">${Object.keys(headers)
        .map((letter) => cell(`${letter}${rowNumber}`, values[letter] ?? ''))
        .join('')}</row>`
    )
  }

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetData>
    ${sheetRows.join('\n    ')}
  </sheetData>
  <dataValidations count="1">
    <dataValidation type="list" allowBlank="1" sqref="D8:D100">
      <formula1>"EAN,GTIN,UPC,ASIN"</formula1>
    </dataValidation>
  </dataValidations>
</worksheet>`

  return buildZip([
    { name: '[Content_Types].xml', content: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`) },
    { name: '_rels/.rels', content: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`) },
    { name: 'xl/workbook.xml', content: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Template" sheetId="1" r:id="rId1"/></sheets>
</workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', content: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`) },
    {
      name: 'xl/styles.xml',
      content: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs>
</styleSheet>`),
    },
    { name: 'xl/worksheets/sheet1.xml', content: Buffer.from(sheetXml) },
  ])
}

function cellValue(draftBuffer, letter, rowNumber = 8) {
  const workbook = openTemplateWorkbook(draftBuffer)
  const pkg = opc.readPackage(draftBuffer)
  const xml = opc.readEntryContent(opc.findEntry(pkg, workbook.sheet.partName)).toString('utf8')
  const ssEntry = opc.findEntry(pkg, 'xl/sharedStrings.xml')
  const ss = ssEntry ? parseSharedStrings(opc.readEntryContent(ssEntry).toString('utf8')) : []
  const cells = readSheetCells(xml, ss)
  const col = columnLettersToIndex(letter)
  return cells.get(rowNumber)?.get(col)?.value ?? ''
}

function cellXmlSnippet(draftBuffer, letter, rowNumber = 8) {
  const workbook = openTemplateWorkbook(draftBuffer)
  const pkg = opc.readPackage(draftBuffer)
  const xml = opc.readEntryContent(opc.findEntry(pkg, workbook.sheet.partName)).toString('utf8')
  const ref = `${letter}${rowNumber}`
  const match = new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*(?:/>|>[\\s\\S]*?</c>)`).exec(xml)
  return match ? match[0] : ''
}

describe('gtinTransform', () => {
  it('adds exactly one leading zero to a 13-digit Zoho barcode', () => {
    const result = transformZohoBarcodeToGtin('6294015161236')
    assert.equal(result.ok, true)
    assert.equal(result.amazonGtin, '06294015161236')
    assert.equal(result.leadingZeroAdded, 'Yes')
    assert.equal(result.gtinLength, 14)
    assert.equal(result.checkDigitStatus, 'valid')
    assert.equal(result.originalZohoBarcode, '6294015161236')
  })

  it('does not change a valid 14-digit GTIN', () => {
    const result = transformZohoBarcodeToGtin('06294015161236')
    assert.equal(result.ok, true)
    assert.equal(result.amazonGtin, '06294015161236')
    assert.equal(result.leadingZeroAdded, 'No')
    assert.equal(result.checkDigitStatus, 'valid')
  })

  it('rejects blank, non-numeric and unexpected lengths', () => {
    assert.equal(transformZohoBarcodeToGtin('').reason, 'zoho-barcode-blank')
    assert.equal(transformZohoBarcodeToGtin('ABC123').reason, 'zoho-barcode-non-numeric')
    assert.equal(transformZohoBarcodeToGtin('12345').reason, 'zoho-barcode-unexpected-length')
    assert.equal(transformZohoBarcodeToGtin('123456789012345').reason, 'zoho-barcode-unexpected-length')
  })

  it('still populates when the check digit is invalid and records an advisory warning', () => {
    const result = transformZohoBarcodeToGtin('6294015161235')
    assert.equal(result.ok, true)
    assert.equal(result.amazonGtin, '06294015161235')
    assert.equal(result.leadingZeroAdded, 'Yes')
    assert.equal(result.checkDigitStatus, 'invalid')
    assert.equal(result.warning, 'gtin-check-digit-invalid')
    assert.equal(result.reason, null)
  })

  it('never mutates the original Zoho string beyond reading it as text', () => {
    const original = '6294015161236'
    transformZohoBarcodeToGtin(original)
    assert.equal(original, '6294015161236')
  })

  it('computes the GS1 check digit used by the example GTIN', () => {
    assert.equal(computeGtinCheckDigit('0629401516123'), 6)
    assert.equal(validateGtinCheckDigit('06294015161236'), true)
  })
})

describe('isSameValue text comparison for GTINs', () => {
  it('does not treat a leading-zero GTIN as identical to the 13-digit form', () => {
    assert.equal(isSameValue('06294015161236', '6294015161236'), true)
    assert.equal(isSameValue('06294015161236', '6294015161236', { compareAsText: true }), false)
    assert.equal(isSameValue('06294015161236', '06294015161236', { compareAsText: true }), true)
  })
})

describe('pipeline Zoho barcode → Amazon GTIN', () => {
  it('writes a 13-digit Zoho barcode as a 14-digit text GTIN and sets type to GTIN', async () => {
    const buffer = buildGtinWorkbook()
    const result = await runInitialDraftPipeline({
      buffer,
      filename: 'gtin.xlsm',
      resolveCatalog: async () => new Map([['LS-POT-24', matched(catalogItem())]]),
      resolveZohoBarcodes: resolveZohoFromMap({ 'LS-POT-24': '6294015161236' }),
    })

    assert.equal(cellValue(result.draftBuffer, 'E'), '06294015161236')
    assert.equal(cellValue(result.draftBuffer, 'D'), 'GTIN')
    const snippet = cellXmlSnippet(result.draftBuffer, 'E')
    assert.match(snippet, /t="inlineStr"/)
    assert.match(snippet, /06294015161236/)

    const report = result.gtinTransformations.find((row) => row.sku === 'LS-POT-24')
    assert.ok(report)
    assert.equal(report.originalZohoBarcode, '6294015161236')
    assert.equal(report.finalAmazonGtin, '06294015161236')
    assert.equal(report.leadingZeroAdded, 'Yes')
    assert.equal(report.gtinLength, 14)
    assert.equal(report.checkDigitStatus, 'valid')
    assert.equal(report.duplicateStatus, 'No')
    assert.equal(report.populationStatus, 'populated')
  })

  it('preserves the leading zero after saving and reopening the workbook bytes', async () => {
    const buffer = buildGtinWorkbook()
    const result = await runInitialDraftPipeline({
      buffer,
      filename: 'gtin.xlsm',
      resolveCatalog: async () => new Map([['LS-POT-24', matched(catalogItem())]]),
      resolveZohoBarcodes: resolveZohoFromMap({ 'LS-POT-24': '6294015161236' }),
    })

    // Re-open the written package the same way Excel would: parse sheet XML again.
    const reopened = openTemplateWorkbook(result.draftBuffer)
    const pkg = opc.readPackage(result.draftBuffer)
    const xml = opc.readEntryContent(opc.findEntry(pkg, reopened.sheet.partName)).toString('utf8')
    const cells = readSheetCells(xml, [])
    const value = cells.get(8)?.get(columnLettersToIndex('E'))?.value
    assert.equal(value, '06294015161236')
    assert.equal(String(value).startsWith('0'), true)
    assert.equal(String(value).length, 14)
  })

  it('leaves a valid 14-digit Zoho GTIN unchanged', async () => {
    const buffer = buildGtinWorkbook()
    const result = await runInitialDraftPipeline({
      buffer,
      filename: 'gtin.xlsm',
      resolveCatalog: async () => new Map([['LS-POT-24', matched(catalogItem())]]),
      resolveZohoBarcodes: resolveZohoFromMap({ 'LS-POT-24': '06294015161236' }),
    })

    assert.equal(cellValue(result.draftBuffer, 'E'), '06294015161236')
    const report = result.gtinTransformations[0]
    assert.equal(report.leadingZeroAdded, 'No')
    assert.equal(report.populationStatus, 'populated')
  })

  it('populates an invalid check-digit GTIN with an advisory warning', async () => {
    const buffer = buildGtinWorkbook()
    const result = await runInitialDraftPipeline({
      buffer,
      filename: 'gtin.xlsm',
      resolveCatalog: async () => new Map([['LS-POT-24', matched(catalogItem())]]),
      resolveZohoBarcodes: resolveZohoFromMap({ 'LS-POT-24': '6294015161235' }),
    })

    assert.equal(cellValue(result.draftBuffer, 'E'), '06294015161235')
    const report = result.gtinTransformations[0]
    assert.equal(report.finalAmazonGtin, '06294015161235')
    assert.equal(report.checkDigitStatus, 'invalid')
    assert.equal(report.populationStatus, 'populated-with-check-digit-warning')
    assert.match(report.warningOrConflict, /gtin-check-digit-invalid/)
  })

  it('leaves unusable-format barcodes blank but keeps the original in the report', async () => {
    const buffer = buildGtinWorkbook()
    const result = await runInitialDraftPipeline({
      buffer,
      filename: 'gtin.xlsm',
      resolveCatalog: async () => new Map([['LS-POT-24', matched(catalogItem())]]),
      resolveZohoBarcodes: resolveZohoFromMap({ 'LS-POT-24': '12345' }),
    })

    assert.equal(cellValue(result.draftBuffer, 'E'), '')
    const report = result.gtinTransformations[0]
    assert.equal(report.originalZohoBarcode, '12345')
    assert.equal(report.finalAmazonGtin, '')
    assert.equal(report.populationStatus, 'unusable-format')
    assert.equal(report.warningOrConflict, 'zoho-barcode-unexpected-length')
    assert.ok(result.missingValues.some((row) => row.reason === 'zoho-barcode-unexpected-length'))
  })

  it('leaves missing Zoho barcodes blank and reports missing-zoho-barcode', async () => {
    const buffer = buildGtinWorkbook()
    const result = await runInitialDraftPipeline({
      buffer,
      filename: 'gtin.xlsm',
      resolveCatalog: async () => new Map([['LS-POT-24', matched(catalogItem())]]),
      resolveZohoBarcodes: resolveZohoFromMap({ 'LS-POT-24': { status: 'found', barcode: '' } }),
    })

    assert.equal(cellValue(result.draftBuffer, 'E'), '')
    const report = result.gtinTransformations[0]
    assert.equal(report.populationStatus, 'missing-zoho-barcode')
    assert.equal(report.originalZohoBarcode, '')
  })

  it('preserves a conflicting existing Product ID and reports existing-value-preserved', async () => {
    const buffer = buildGtinWorkbook({ existingProductId: '99999999999999' })
    const result = await runInitialDraftPipeline({
      buffer,
      filename: 'gtin.xlsm',
      resolveCatalog: async () => new Map([['LS-POT-24', matched(catalogItem())]]),
      resolveZohoBarcodes: resolveZohoFromMap({ 'LS-POT-24': '6294015161236' }),
    })

    assert.equal(cellValue(result.draftBuffer, 'E'), '99999999999999')
    const report = result.gtinTransformations[0]
    assert.equal(report.populationStatus, 'existing-value-preserved')
    assert.match(report.warningOrConflict, /99999999999999/)
    assert.equal(result.conflicts.length, 1)
  })

  it('populates a duplicated Zoho barcode for every exact SKU and warns', async () => {
    const buffer = buildGtinWorkbook({
      dataRows: {
        8: { A: 'LS-POT-24', E: '' },
        9: { A: 'LS-POT-28', E: '' },
      },
    })
    const result = await runInitialDraftPipeline({
      buffer,
      filename: 'gtin.xlsm',
      resolveCatalog: async () =>
        new Map([
          ['LS-POT-24', matched(catalogItem({ itemCode: 'LS-POT-24' }))],
          ['LS-POT-28', matched(catalogItem({ itemCode: 'LS-POT-28', productName: 'Pot 28' }))],
        ]),
      resolveZohoBarcodes: resolveZohoFromMap({
        'LS-POT-24': '6294015161236',
        'LS-POT-28': '6294015161236',
      }),
    })

    assert.equal(cellValue(result.draftBuffer, 'E', 8), '06294015161236')
    assert.equal(cellValue(result.draftBuffer, 'E', 9), '06294015161236')
    assert.ok(
      result.gtinTransformations.every(
        (row) =>
          row.duplicateStatus === 'Yes' &&
          row.populationStatus === 'populated-with-duplicate-warning' &&
          row.finalAmazonGtin === '06294015161236'
      )
    )
  })
})
