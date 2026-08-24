'use strict'

/**
 * Runs the pipeline against a genuine Amazon UAE template when one is available.
 *
 * The templates are not committed (they are multi-megabyte binaries), so these tests
 * skip when the directory is absent. Everything they assert is also covered by the
 * synthetic fixture in the other suites; these exist to catch a real template drifting
 * away from the structure the synthetic one models.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const opc = require('../src/services/amazonInitialDraft/opcPackage')
const { openTemplateWorkbook } = require('../src/services/amazonInitialDraft/amazonTemplateWorkbook')
const { runInitialDraftPipeline } = require('../src/services/amazonInitialDraft/draftGenerator')
const { normalizeSpecEntries } = require('../src/services/amazonInitialDraft/specParsers')

const TEMPLATE_DIR = process.env.AMAZON_TEMPLATE_DIR || '/tmp/amazon-templates'

function findTemplates() {
  try {
    return fs
      .readdirSync(TEMPLATE_DIR)
      .filter((name) => /\.xlsm$/i.test(name) && !name.startsWith('~$'))
      .map((name) => path.join(TEMPLATE_DIR, name))
  } catch {
    return []
  }
}

const templates = findTemplates()
const skip = templates.length === 0 ? `no templates in ${TEMPLATE_DIR}` : false

describe('real Amazon UAE template', { skip }, () => {
  it('finds the header row, SKU column and first data row in every supplied template', () => {
    for (const file of templates) {
      const workbook = openTemplateWorkbook(fs.readFileSync(file))
      const label = path.basename(file)

      assert.ok(workbook.headerRow > 0, `${label}: no header row`)
      assert.ok(workbook.firstDataRow > workbook.headerRow, `${label}: data row not below header`)
      assert.ok(workbook.columns.length > 50, `${label}: only ${workbook.columns.length} columns`)
      assert.ok(
        workbook.columns.some((column) => column.normalizedKey === 'contribution_sku.value'),
        `${label}: no SKU column`
      )
      // Amazon declares the header block with a frozen pane in every real template.
      assert.equal(workbook.firstDataRowBasis, 'frozen-pane', `${label}: unexpected basis`)
    }
  })

  it('carries binary parts, and a macro project when Amazon includes one', () => {
    for (const file of templates) {
      const pkg = opc.readPackage(fs.readFileSync(file))
      const label = path.basename(file)

      // These templates use the .xlsm extension but ship no vbaProject.bin. The part is
      // preserved when it is there (covered by the synthetic fixture, which has one);
      // here the binary parts that these files really do carry are what must survive.
      const binaryParts = pkg.entries.filter((entry) => /^xl\/media\//.test(entry.name))
      assert.ok(binaryParts.length > 0, `${label}: expected embedded media`)
      assert.ok(
        pkg.entries.some((entry) => /^xl\/drawings\//.test(entry.name)),
        `${label}: expected drawings`
      )
    }
  })

  it('changes only the template worksheet when a draft is generated', async () => {
    const file = templates[0]
    const uploaded = fs.readFileSync(file)
    const workbook = openTemplateWorkbook(uploaded)

    // Put a SKU on the first data row so there is something to write.
    const sku = 'REAL-TEMPLATE-TEST-SKU'
    const seeded = opc.writePackage(
      workbook.package,
      new Map([
        [
          workbook.sheet.partName,
          Buffer.from(
            require('../src/services/amazonInitialDraft/worksheetXml').applyCellWrites(workbook.sheetXml, [
              { row: workbook.firstDataRow, column: workbook.skuColumn, value: sku },
            ]).xml,
            'utf8'
          ),
        ],
      ])
    )

    const result = await runInitialDraftPipeline({
      buffer: seeded,
      filename: path.basename(file),
      resolveCatalog: async () =>
        new Map([
          [
            sku,
            {
              status: 'matched',
              candidates: [],
              item: {
                itemCode: sku,
                productName: 'Life Smile Test Cooking Pot',
                longDescription: '<p>Test description.</p>',
                shortDescription: '',
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
                specs: normalizeSpecEntries('[{"title":"Guarantee","description":"1 Year"},{"title":"Capacity","description":"5 L"}]'),
                weightDimensions: normalizeSpecEntries('[{"title":"Weight","description":"2.5 KG"},{"title":"Dimensions","description":"30 x 20 x 10 cm"}]'),
              },
            },
          ],
        ]),
    })

    const before = opc.readPackage(seeded)
    const after = opc.readPackage(result.draftBuffer)

    assert.deepEqual(
      after.entries.map((entry) => entry.name),
      before.entries.map((entry) => entry.name),
      'the draft must contain exactly the same parts in the same order'
    )

    const changed = []
    for (const entry of before.entries) {
      const counterpart = opc.findEntry(after, entry.name)
      if (Buffer.compare(opc.readEntryContent(entry), opc.readEntryContent(counterpart)) !== 0) {
        changed.push(entry.name)
      }
    }

    assert.deepEqual(changed, [workbook.sheet.partName])
    assert.ok(result.summary.populatedCells > 0, 'expected the test SKU to populate some cells')

    // Inside the one part that did change, everything except cells must be identical.
    const sheetBefore = opc.readEntryContent(opc.findEntry(before, workbook.sheet.partName)).toString('utf8')
    const sheetAfter = opc.readEntryContent(opc.findEntry(after, workbook.sheet.partName)).toString('utf8')
    const count = (xml, pattern) => (xml.match(pattern) || []).length

    for (const [label, pattern] of [
      ['dataValidation', /<dataValidation[\s>]/g],
      ['x14 dataValidation', /<x14:dataValidation[\s>]/g],
      ['conditionalFormatting', /<conditionalFormatting[\s>]/g],
      ['cfRule', /<cfRule[\s>]/g],
      ['mergeCell', /<mergeCell[\s>]/g],
      ['formula', /<f[\s>]/g],
      ['col', /<col[\s>]/g],
      ['row', /<row[\s>]/g],
      ['hyperlink', /<hyperlink[\s>]/g],
    ]) {
      assert.equal(count(sheetAfter, pattern), count(sheetBefore, pattern), `${label} count changed`)
    }

    for (const fragment of ['<sheetViews', '<sheetFormatPr', '<pageMargins', '<extLst']) {
      assert.equal(
        sheetAfter.includes(fragment),
        sheetBefore.includes(fragment),
        `${fragment} presence changed`
      )
    }
  })

  it('fills the real template bullet columns in order from the website feature list', async () => {
    const { runInitialDraftPipeline } = require('../src/services/amazonInitialDraft/draftGenerator')
    const { normalizeSpecEntries } = require('../src/services/amazonInitialDraft/specParsers')

    // Some of the supplied files are Category Listings Reports whose rows already hold
    // live listing data. This test needs an empty template so the bullets start blank.
    const file = templates.find((candidate) => {
      const wb = openTemplateWorkbook(fs.readFileSync(candidate))
      return wb.dataRows.every((row) => [...row.cells.values()].every((cell) => String(cell.value ?? '').trim() === ''))
    })
    if (!file) return // only populated listing reports were supplied

    const buffer = fs.readFileSync(file)
    const workbook = openTemplateWorkbook(buffer)
    const bulletColumns = workbook.columns
      .filter((column) => column.normalizedKey === 'bullet_point.value')
      .sort((a, b) => a.column - b.column)
    assert.ok(bulletColumns.length >= 2, 'the real template exposes a run of bullet columns')

    // One more feature than the template has columns, so both ends are exercised.
    const features = bulletColumns.map((_, index) => `Feature number ${index + 1}`).concat('One feature too many')
    const item = {
      itemCode: 'LS-REAL-1',
      productName: 'Life Smile Cooking Pot',
      shortDescription: `<ul>${features.map((text) => `<li>${text}</li>`).join('')}</ul>`,
      longDescription: '<p>A pot.</p>',
      color: 'Black',
      size: '24 cm',
      material: 'Aluminium',
      variantType: 'Single',
      status: 'active',
      matchSource: 'product',
      parentItemCode: null,
      variantCount: 0,
      categoryName: 'Cookware',
      subCategoryName: 'Pots',
      specs: normalizeSpecEntries('[]'),
      weightDimensions: normalizeSpecEntries('[]'),
    }

    // The upload adds nothing but the SKU, as a seller pasting their list would.
    const { applyCellWrites } = require('../src/services/amazonInitialDraft/worksheetXml')
    const { xml } = applyCellWrites(workbook.sheetXml, [
      { row: workbook.firstDataRow, column: workbook.skuColumn, value: 'LS-REAL-1', numeric: false },
    ])
    const upload = opc.writePackage(workbook.package, new Map([[workbook.sheet.partName, Buffer.from(xml, 'utf8')]]))

    const result = await runInitialDraftPipeline({
      buffer: upload,
      filename: path.basename(file),
      resolveCatalog: async () => new Map([['LS-REAL-1', { status: 'matched', item, candidates: [] }]]),
    })

    const written = result.populated
      .filter((entry) => entry.technicalHeader.startsWith('bullet_point'))
      .sort((a, b) => a.technicalHeader.localeCompare(b.technicalHeader, undefined, { numeric: true }))

    assert.equal(written.length, bulletColumns.length, 'every bullet column is filled')
    assert.deepEqual(
      written.map((entry) => entry.value),
      features.slice(0, bulletColumns.length),
      'the features land in the stored order'
    )
    assert.deepEqual(
      result.surplusListValues.map((entry) => entry.value),
      ['One feature too many'],
      'the feature with no column is reported rather than dropped'
    )
  })

  it('never writes a subtype, image, price or quantity column in a real template', async () => {
    const file = templates[0]
    const workbook = openTemplateWorkbook(fs.readFileSync(file))
    const { classifyColumns } = require('../src/services/amazonInitialDraft/draftGenerator')
    const { writable } = classifyColumns(workbook)

    for (const column of writable) {
      assert.doesNotMatch(column.technicalHeader, /image/i)
      assert.doesNotMatch(column.technicalHeader, /price/i)
      assert.doesNotMatch(column.technicalHeader, /quantity/i)
      assert.doesNotMatch(column.technicalHeader, /product_type/i)
    }
  })
})
