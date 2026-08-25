'use strict'

/**
 * Focused coverage for universal listing defaults, cell applicability and the
 * warranty never-write rule. Builds its own small workbooks so the cases can
 * express black fills, validations and defined names without reshaping the
 * shared UAE fixture used by the rest of the suite.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { runInitialDraftPipeline } = require('../src/services/amazonInitialDraft/draftGenerator')
const { neverWriteReason, resolveFieldsForItem, MAPPED_KEYS } = require('../src/services/amazonInitialDraft/fieldMapping')
const { normalizeSpecEntries } = require('../src/services/amazonInitialDraft/specParsers')
const { fillLooksDisabled, parseStyles, assessCellApplicability } = require('../src/services/amazonInitialDraft/cellApplicability')
const { pickAcceptedOption, resolveIndirectName } = require('../src/services/amazonInitialDraft/validationOptions')
const { readSheetCells, parseSharedStrings, columnLettersToIndex } = require('../src/services/amazonInitialDraft/worksheetXml')
const opc = require('../src/services/amazonInitialDraft/opcPackage')
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
    shortDescription: '<ul><li>1 year guarantee included</li><li>Easy clean</li></ul>',
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
    specs: normalizeSpecEntries(
      '[{"title":"Guarantee","description":"1 Year"},{"title":"Capacity","description":"5 L"}]'
    ),
    weightDimensions: normalizeSpecEntries('[{"title":"Weight","description":"2.5 KG"}]'),
    ...overrides,
  }
}

function matched(item) {
  return { status: 'matched', item, candidates: [] }
}

/**
 * Minimal Amazon-shaped workbook with optional blacked-out cells, list validations
 * and defined names. Column letters are discovered only through technical headers.
 */
function buildDefaultsWorkbook({
  dataRows = {},
  cellStyles = {},
  productType = '',
  sheetProtected = false,
  blackoutColumns = [],
  validations = [],
  definedNames = [],
  dropdownValues = {},
} = {}) {
  const headers = {
    A: 'contribution_sku#1.value',
    B: 'product_type#1.value',
    C: 'item_name[marketplace_id=X][language_tag=en_AE]#1.value',
    D: 'amzn1.volt.ca.product_id_type',
    E: 'amzn1.volt.ca.product_id_value',
    F: 'condition_type[marketplace_id=X]#1.value',
    G: 'fulfillment_availability#1.fulfillment_channel_code',
    H: 'country_of_origin[marketplace_id=X]#1.value',
    I: 'batteries_required[marketplace_id=X]#1.value',
    J: 'contains_liquid_contents[marketplace_id=X]#1.value',
    K: 'supplier_declared_dg_hz_regulation[marketplace_id=X]#1.value',
    L: 'warranty_description[marketplace_id=X][language_tag=en_AE]#1.value',
    M: 'warranty_type[marketplace_id=X]#1.value',
    N: 'main_product_image_locator#1.media_location',
    O: 'standard_price#1.value',
    P: 'fulfillment_availability#1.quantity',
    Q: 'material[marketplace_id=X][language_tag=en_AE]#1.value',
    R: 'variation_theme#1.name',
    S: 'brand[marketplace_id=X][language_tag=en_AE]#1.value',
  }
  const labels = {
    A: 'SKU',
    B: 'Product Type',
    C: 'Item Name',
    D: 'Product Id Type',
    E: 'Product Id',
    F: 'Item Condition',
    G: 'Fulfillment Channel Code',
    H: 'Country of Origin',
    I: 'Are batteries required?',
    J: 'Contains Liquid Contents?',
    K: 'Dangerous Goods Regulations',
    L: 'Warranty Description',
    M: 'Warranty Type',
    N: 'Main Image URL',
    O: 'Your Price',
    P: 'Quantity',
    Q: 'Material',
    R: 'Variation Theme',
    S: 'Brand Name',
  }

  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="4">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor rgb="FF000000"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="1"><border/></borders>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>` +
    `<xf numFmtId="0" fontId="0" fillId="2" borderId="0" applyFill="1"/>` +
    `<xf numFmtId="0" fontId="0" fillId="3" borderId="0" applyFill="1"/>` +
    `<xf numFmtId="0" fontId="0" fillId="2" borderId="0" applyFill="1"><protection locked="0"/></xf>` +
    `</cellXfs>` +
    `<dxfs count="2">` +
    `<dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill></dxf>` +
    `<dxf><font><color rgb="FFFFFFFF"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor rgb="FF000000"/></patternFill></fill></dxf>` +
    `</dxfs>` +
    `</styleSheet>`

  const cellXml = (letters, row, value, style) => {
    if (value === undefined || value === null || value === '') {
      return style !== undefined && style !== null
        ? `<c r="${letters}${row}" s="${style}"/>`
        : ''
    }
    const styleAttr = style !== undefined && style !== null ? ` s="${style}"` : ''
    return `<c r="${letters}${row}"${styleAttr} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
  }

  const headerCells = Object.entries(headers)
    .map(([letters, value]) => cellXml(letters, 5, value, 1))
    .join('')
  const labelCells = Object.entries(labels)
    .map(([letters, value]) => cellXml(letters, 4, value, 1))
    .join('')

  const dataRowXml = Object.entries(dataRows)
    .map(([rowNumber, cells]) => {
      const stylesForRow = cellStyles[rowNumber] || {}
      const inner = Object.keys(headers)
        .map((letters) => {
          let style = stylesForRow[letters]
          if (style === undefined && blackoutColumns.includes(letters)) style = 2
          return cellXml(letters, rowNumber, cells[letters], style)
        })
        .join('')
      return `<row r="${rowNumber}">${inner}</row>`
    })
    .join('')

  // Ensure the SKU row exists even when only styles are requested.
  const ensuredRows = { ...dataRows }
  if (!Object.keys(ensuredRows).length) ensuredRows[8] = { A: 'LS-POT-24', B: productType }

  const ensuredDataXml = Object.entries(ensuredRows)
    .map(([rowNumber, cells]) => {
      const stylesForRow = cellStyles[rowNumber] || {}
      const merged = { B: productType, ...cells }
      const inner = Object.keys(headers)
        .map((letters) => {
          let style = stylesForRow[letters]
          if (style === undefined && blackoutColumns.includes(letters)) style = 2
          return cellXml(letters, rowNumber, merged[letters], style)
        })
        .join('')
      return `<row r="${rowNumber}">${inner}</row>`
    })
    .join('')

  const validationXml = validations.length
    ? `<dataValidations count="${validations.length}">${validations
        .map(
          (entry) =>
            `<dataValidation type="list" allowBlank="1" sqref="${entry.sqref}"><formula1>${escapeXml(
              entry.formula
            )}</formula1></dataValidation>`
        )
        .join('')}</dataValidations>`
    : ''

  const cfXml = blackoutColumns.length
    ? blackoutColumns
        .map(
          (letters) =>
            `<conditionalFormatting sqref="${letters}8:${letters}1048576">` +
            `<cfRule type="expression" dxfId="1" priority="1" stopIfTrue="1">` +
            `<formula>TRUE</formula></cfRule></conditionalFormatting>`
        )
        .join('')
    : ''

  const protectionXml = sheetProtected ? `<sheetProtection sheet="1" objects="1" scenarios="1"/>` : ''

  const templateSheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="7" topLeftCell="A8" state="frozen"/></sheetView></sheetViews>` +
    `<sheetData>` +
    `<row r="4">${labelCells}</row>` +
    `<row r="5">${headerCells}</row>` +
    `<row r="6"><c r="A6" t="inlineStr"><is><t>EXAMPLE</t></is></c></row>` +
    ensuredDataXml +
    `</sheetData>` +
    protectionXml +
    cfXml +
    validationXml +
    `</worksheet>`

  const dropdownRows = Object.entries(dropdownValues)
    .map(([letters, values], index) => {
      // Place each list in its own column starting at row 4.
      return values
        .map((value, offset) => {
          const row = 4 + offset
          return `<row r="${row}"><c r="${letters}${row}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c></row>`
        })
        .join('')
    })
    .join('')

  // Flatten unique rows for the dropdown sheet.
  const dropdownByRow = new Map()
  for (const [letters, values] of Object.entries(dropdownValues)) {
    values.forEach((value, offset) => {
      const row = 4 + offset
      if (!dropdownByRow.has(row)) dropdownByRow.set(row, [])
      dropdownByRow.get(row).push(`<c r="${letters}${row}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`)
    })
  }
  const dropdownSheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    [...dropdownByRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([row, cells]) => `<row r="${row}">${cells.join('')}</row>`)
      .join('') +
    `</sheetData></worksheet>`

  const definedNameXml = definedNames
    .map((entry) => `<definedName name="${escapeXml(entry.name)}">${escapeXml(entry.formula)}</definedName>`)
    .join('')

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    `<sheet name="Template" sheetId="1" r:id="rId1"/>` +
    `<sheet name="Dropdown Lists" sheetId="2" state="hidden" r:id="rId2"/>` +
    `</sheets>` +
    `<definedNames>${definedNameXml}</definedNames>` +
    `</workbook>`

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`

  return buildZip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { name: 'xl/worksheets/sheet1.xml', content: templateSheet },
    { name: 'xl/worksheets/sheet2.xml', content: dropdownSheet },
    { name: 'xl/styles.xml', content: stylesXml },
  ])
}

const STANDARD_DROPDOWNS = {
  L: ['EAN', 'GTIN', 'UPC'],
  M: ['New', 'Used'],
  N: ['Fulfilment by Amazon (EU)', 'Fulfilment by Merchant (Default)'],
  O: ['China', 'United States', 'CN'],
  P: ['Yes', 'No'],
  Q: ['Yes', 'No'],
  R: ['GHS', 'Not Applicable', 'Unknown'],
}

const STANDARD_NAMES = [
  { name: 'product_id_types', formula: "'Dropdown Lists'!$L$4:$L$6" },
  { name: 'condition_list', formula: "'Dropdown Lists'!$M$4:$M$5" },
  { name: 'fulfillment_availability1.fulfillment_channel_code', formula: "'Dropdown Lists'!$N$4:$N$5" },
  { name: 'COOKWARE_SETcountry_of_originmarketplace_idX1.value', formula: "'Dropdown Lists'!$O$4:$O$6" },
  { name: 'KITCHEN_TOOLScountry_of_originmarketplace_idX1.value', formula: "'Dropdown Lists'!$O$4:$O$6" },
  { name: 'COOKWARE_SETbatteries_requiredmarketplace_idX1.value', formula: "'Dropdown Lists'!$P$4:$P$5" },
  { name: 'KITCHEN_TOOLSbatteries_requiredmarketplace_idX1.value', formula: "'Dropdown Lists'!$P$4:$P$5" },
  { name: 'KITCHEN_TOOLScontains_liquid_contentsmarketplace_idX1.value', formula: "'Dropdown Lists'!$Q$4:$Q$5" },
  { name: 'COOKWARE_SETsupplier_declared_dg_hz_regulationmarketplace_idX1.value', formula: "'Dropdown Lists'!$R$4:$R$6" },
  { name: 'KITCHEN_TOOLSsupplier_declared_dg_hz_regulationmarketplace_idX1.value', formula: "'Dropdown Lists'!$R$4:$R$6" },
]

const STANDARD_VALIDATIONS = [
  { sqref: 'D8:D1048576', formula: 'product_id_types' },
  { sqref: 'F8:F1048576', formula: 'condition_list' },
  { sqref: 'G8:G1048576', formula: 'fulfillment_availability1.fulfillment_channel_code' },
  {
    sqref: 'H8:H1048576',
    formula:
      'INDIRECT(IF(ISNUMBER(VALUE(LEFT(B8,1))),"_","")&SUBSTITUTE(SUBSTITUTE(B8,"-","_")," ","")&"country_of_originmarketplace_idX1.value")',
  },
  {
    sqref: 'I8:I1048576',
    formula:
      'INDIRECT(IF(ISNUMBER(VALUE(LEFT(B8,1))),"_","")&SUBSTITUTE(SUBSTITUTE(B8,"-","_")," ","")&"batteries_requiredmarketplace_idX1.value")',
  },
  {
    sqref: 'J8:J1048576',
    formula:
      'INDIRECT(IF(ISNUMBER(VALUE(LEFT(B8,1))),"_","")&SUBSTITUTE(SUBSTITUTE(B8,"-","_")," ","")&"contains_liquid_contentsmarketplace_idX1.value")',
  },
  {
    sqref: 'K8:K1048576',
    formula:
      'INDIRECT(IF(ISNUMBER(VALUE(LEFT(B8,1))),"_","")&SUBSTITUTE(SUBSTITUTE(B8,"-","_")," ","")&"supplier_declared_dg_hz_regulationmarketplace_idX1.value")',
  },
]

async function runDefaults(options = {}) {
  const buffer = buildDefaultsWorkbook({
    dropdownValues: STANDARD_DROPDOWNS,
    definedNames: STANDARD_NAMES,
    validations: STANDARD_VALIDATIONS,
    productType: 'COOKWARE_SET',
    dataRows: { 8: { A: 'LS-POT-24', B: 'COOKWARE_SET' } },
    ...options,
  })

  const catalog = options.catalog || { 'LS-POT-24': matched(catalogItem()) }
  const result = await runInitialDraftPipeline({
    buffer,
    filename: 'defaults.xlsm',
    resolveCatalog: async () => new Map(Object.entries(catalog)),
  })

  const draftPkg = opc.readPackage(result.draftBuffer)
  const draftXml = opc.readEntryContent(opc.findEntry(draftPkg, 'xl/worksheets/sheet1.xml')).toString('utf8')
  const cells = readSheetCells(draftXml, [])
  const cell = (letters, row = 8) => {
    const found = (cells.get(row) || new Map()).get(columnLettersToIndex(letters))
    return found ? String(found.value ?? '') : ''
  }
  const styleOf = (letters, row = 8) => {
    const found = (cells.get(row) || new Map()).get(columnLettersToIndex(letters))
    return found ? found.style : null
  }

  return { result, cell, styleOf, uploaded: buffer, draftXml }
}

describe('fillLooksDisabled', () => {
  it('recognises Amazon black and grey disable fills', () => {
    assert.equal(
      fillLooksDisabled('<patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor rgb="FF000000"/></patternFill>'),
      true
    )
    assert.equal(
      fillLooksDisabled('<patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor rgb="FF808080"/></patternFill>'),
      true
    )
    assert.equal(
      fillLooksDisabled('<patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill>'),
      false
    )
    assert.equal(
      fillLooksDisabled('<patternFill patternType="solid"><fgColor rgb="FF00B050"/></patternFill>'),
      false
    )
  })
})

describe('pickAcceptedOption', () => {
  it('returns the workbook spelling, not the preferred label spelling', () => {
    assert.equal(
      pickAcceptedOption(['Fulfilment by Amazon (EU)', 'Fulfilment by Merchant (Default)'], [
        'Fulfillment by Amazon',
        'Fulfilment by Amazon',
      ]),
      'Fulfilment by Amazon (EU)'
    )
    assert.equal(pickAcceptedOption(['GTIN', 'EAN'], ['gtin']), 'GTIN')
    assert.equal(pickAcceptedOption(['Yes', 'No'], ['No']), 'No')
    assert.equal(pickAcceptedOption(['GHS', 'Unknown'], ['Not Applicable']), null)
  })
})

describe('resolveIndirectName', () => {
  it('sanitises the product type the way Amazon\'s INDIRECT formula does', () => {
    const formula =
      'INDIRECT(IF(ISNUMBER(VALUE(LEFT(B8,1))),"_","")&SUBSTITUTE(SUBSTITUTE(B8,"-","_")," ","")&"batteries_requiredmarketplace_idX1.value")'
    assert.equal(
      resolveIndirectName(formula, 'COOKWARE_SET'),
      'COOKWARE_SETbatteries_requiredmarketplace_idX1.value'
    )
    assert.equal(resolveIndirectName(formula, ''), null)
  })
})

describe('universal defaults', () => {
  it('populates applicable blank cells with the workbook-approved options', async () => {
    const { result, cell } = await runDefaults()

    assert.equal(cell('D'), 'GTIN')
    assert.equal(cell('F'), 'New')
    assert.equal(cell('G'), 'Fulfilment by Amazon (EU)')
    assert.equal(cell('H'), 'China')
    assert.equal(cell('I'), 'No')
    assert.equal(cell('K'), 'Not Applicable')
    assert.equal(cell('E'), '', 'never invents an actual GTIN number')
    assert.equal(cell('L'), '', 'warranty stays blank')
    assert.equal(cell('J'), '', 'liquid is not in the COOKWARE_SET validation consensus')

    const written = result.populated.map((entry) => entry.displayLabel)
    assert.ok(written.includes('Product Id Type'))
    assert.ok(written.includes('Dangerous Goods Regulations'))
    assert.ok(!result.populated.some((entry) => /warranty/i.test(entry.technicalHeader)))
  })

  it('never writes No into Dangerous Goods Regulations', async () => {
    const { cell } = await runDefaults()
    assert.equal(cell('K'), 'Not Applicable')
    assert.notEqual(cell('K'), 'No')
  })

  it('preserves identical existing defaults and reports conflicts', async () => {
    const identical = await runDefaults({
      dataRows: {
        8: {
          A: 'LS-POT-24',
          B: 'COOKWARE_SET',
          D: 'GTIN',
          F: 'New',
          I: 'No',
        },
      },
    })
    assert.ok(identical.result.preservedIdentical.some((entry) => entry.column === 'D'))
    assert.ok(identical.result.preservedIdentical.some((entry) => entry.column === 'F'))

    const conflict = await runDefaults({
      dataRows: {
        8: {
          A: 'LS-POT-24',
          B: 'COOKWARE_SET',
          D: 'EAN',
          F: 'Used',
          I: 'Yes',
          K: 'GHS',
        },
      },
    })
    assert.equal(conflict.cell('D'), 'EAN')
    assert.equal(conflict.cell('F'), 'Used')
    assert.equal(conflict.cell('I'), 'Yes')
    assert.equal(conflict.cell('K'), 'GHS')
    assert.ok(conflict.result.conflicts.some((entry) => entry.column === 'D'))
    assert.ok(conflict.result.conflicts.some((entry) => entry.column === 'I' && entry.existingValue === 'Yes'))
  })

  it('writes contains-liquid No only when that row\'s validation resolves', async () => {
    const kitchen = await runDefaults({
      productType: 'KITCHEN_TOOLS',
      dataRows: { 8: { A: 'LS-POT-24', B: 'KITCHEN_TOOLS' } },
    })
    assert.equal(kitchen.cell('J'), 'No')

    const cookware = await runDefaults({
      productType: 'COOKWARE_SET',
      dataRows: { 8: { A: 'LS-POT-24', B: 'COOKWARE_SET' } },
    })
    assert.equal(cookware.cell('J'), '')
  })
})

describe('applicability', () => {
  it('leaves a blacked-out blank cell byte-identical and reports not applicable', async () => {
    const { result, cell, styleOf, uploaded, draftXml } = await runDefaults({
      blackoutColumns: ['J'],
      cellStyles: { 8: { J: '2' } },
      dataRows: { 8: { A: 'LS-POT-24', B: 'KITCHEN_TOOLS' } },
      productType: 'KITCHEN_TOOLS',
    })

    assert.equal(cell('J'), '')
    assert.equal(styleOf('J'), '2', 'black fill style must be preserved')
    assert.ok(result.notApplicable.some((entry) => entry.column === 'J'))
    assert.ok(!result.missingValues.some((entry) => entry.column === 'J'))

    const originalPkg = opc.readPackage(uploaded)
    const originalXml = opc.readEntryContent(opc.findEntry(originalPkg, 'xl/worksheets/sheet1.xml')).toString('utf8')
    const originalJ = /<c r="J8"[^>]*\/>/.exec(originalXml)?.[0]
    const draftJ = /<c r="J8"[^>]*\/>/.exec(draftXml)?.[0]
    assert.equal(draftJ, originalJ)
  })

  it('leaves a protected cell untouched', async () => {
    const { result, cell } = await runDefaults({
      sheetProtected: true,
      dataRows: { 8: { A: 'LS-POT-24', B: 'COOKWARE_SET' } },
    })
    assert.equal(cell('D'), '')
    assert.ok(result.notApplicable.length > 0)
    assert.ok(result.notApplicable.every((entry) => entry.reason === 'protected-cell'))
  })

  it('still populates an applicable editable blank cell', async () => {
    const { cell } = await runDefaults()
    assert.equal(cell('D'), 'GTIN')
    assert.equal(cell('S'), 'Life Smile')
  })
})

describe('warranty never-write', () => {
  it('never populates warranty from a database Guarantee or title wording', async () => {
    const fields = resolveFieldsForItem(catalogItem())
    assert.equal(fields.has('warranty_description.value'), false)
    assert.equal(neverWriteReason('warranty_description[marketplace_id=X]#1.value'), 'warranty-never-write')
    assert.equal(neverWriteReason('warranty_type#1.value'), 'warranty-never-write')
    assert.equal(neverWriteReason('warranty_duration#1.value'), 'warranty-never-write')

    const { cell, result } = await runDefaults({
      dataRows: {
        8: {
          A: 'LS-POT-24',
          B: 'COOKWARE_SET',
          C: 'Pot with 1 year guarantee',
          L: '',
        },
      },
    })
    assert.equal(cell('L'), '')
    assert.equal(cell('M'), '')
    // The seller's title keeps its own guarantee wording; it is never converted into a warranty field.
    assert.equal(cell('C'), 'Pot with 1 year guarantee')
    assert.ok(result.neverWriteColumns.some((column) => column.reason === 'warranty-never-write'))
  })

  it('keeps guarantee wording that already lives inside a bullet point', async () => {
    const { cell } = await runDefaults({
      // bullet columns are not in this mini workbook; assert via field mapping instead
    })
    const fields = resolveFieldsForItem(catalogItem())
    assert.deepEqual(fields.get('bullet_point.value').values[0], '1 year guarantee included')
  })
})

describe('unmatched and ambiguous rows get no defaults', () => {
  it('leaves defaults blank for unmatched SKUs', async () => {
    const { cell, result } = await runDefaults({
      catalog: { 'LS-POT-24': { status: 'unmatched', reason: 'not-in-catalog', candidates: [] } },
    })
    assert.equal(cell('D'), '')
    assert.equal(cell('F'), '')
    assert.equal(cell('G'), '')
    assert.equal(result.summary.populatedCells, 0)
  })

  it('leaves defaults blank for ambiguous SKUs', async () => {
    const { cell, result } = await runDefaults({
      catalog: {
        'LS-POT-24': {
          status: 'ambiguous',
          reason: 'multiple-matches',
          candidates: [{ itemCode: 'a' }, { itemCode: 'b' }],
        },
      },
    })
    assert.equal(cell('D'), '')
    assert.equal(result.summary.populatedCells, 0)
  })
})

describe('mapping module guards', () => {
  it('contains no product-type identifiers and no fixed Excel column letters', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../src/services/amazonInitialDraft/fieldMapping.js'),
      'utf8'
    )
    // Strip block comments so the documentation of why material is report-only does not
    // trip the guard; executable code and string literals must still be free of subtypes.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(withoutComments, /COOKWARE_SET|KITCHEN_TOOLS|SAUTE_FRY_PAN|COOKING_POT/)
    assert.doesNotMatch(withoutComments, /\bGI\b|column\s*['"]GI['"]|letters:\s*['"]GI['"]/)
    assert.ok(!MAPPED_KEYS.has('warranty_description.value'))
  })

  it('processes an unknown subtype the same as any other matched row', async () => {
    const { cell } = await runDefaults({
      productType: 'COMPLETELY_UNKNOWN_SUBTYPE_XYZ',
      dataRows: { 8: { A: 'LS-POT-24', B: 'COMPLETELY_UNKNOWN_SUBTYPE_XYZ' } },
    })
    // Fulfillment uses a direct named range, so it still resolves.
    assert.equal(cell('G'), 'Fulfilment by Amazon (EU)')
    assert.equal(cell('D'), 'GTIN')
    assert.equal(cell('C'), 'Life Smile Cooking Pot')
  })
})
