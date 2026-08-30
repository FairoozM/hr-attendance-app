'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { DRAFT_NOTICE, isSameValue, runInitialDraftPipeline } = require('../src/services/amazonInitialDraft/draftGenerator')
const { BRAND_NAME, MANUFACTURER_NAME, neverWriteReason } = require('../src/services/amazonInitialDraft/fieldMapping')
const { normalizeSpecEntries } = require('../src/services/amazonInitialDraft/specParsers')
const { readSheetCells, parseSharedStrings } = require('../src/services/amazonInitialDraft/worksheetXml')
const opc = require('../src/services/amazonInitialDraft/opcPackage')
const {
  UAE_BULLET_COLUMNS,
  UAE_EXAMPLE,
  UAE_HEADERS,
  UAE_LABELS,
  buildTemplateWorkbook,
} = require('./helpers/amazonTemplateFixture')

/** Builds the stored `short_description` HTML for the given features, in order. */
function featureListHtml(...features) {
  return `<ul>${features.map((text) => `<li>${text}</li>`).join('')}</ul>`
}

const COOKING_POT = {
  itemCode: 'LS-POT-24',
  productName: 'Life Smile 24cm Stainless Steel Cooking Pot',
  longDescription: '<p>18/10 stainless steel pot.</p><p>Induction ready.</p>',
  shortDescription: 'Stainless steel pot',
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
  specs: normalizeSpecEntries('[{"title":"Guarantee","description":" 1 Year"},{"title":"Capacity","description":"5 L"},{"title":"Pieces","description":"3"},{"title":"Stove Compatibility","description":"Ceramic, Gas, Electric, Induction"}]'),
  weightDimensions: normalizeSpecEntries('[{"title":"Weight","description":"2.5 KG"},{"title":"Dimensions","description":"30 x 20 x 10 cm"}]'),
}

function catalogItem(overrides = {}) {
  return { ...COOKING_POT, ...overrides }
}

function matched(item) {
  return { status: 'matched', item, candidates: [] }
}

/** Builds a workbook, runs the pipeline and reads the resulting draft back. */
async function generate({ dataRows, catalog = {}, headers = UAE_HEADERS, extraHeaders = {}, resolveCatalog }) {
  const technicalHeaders = { ...headers, ...extraHeaders }
  const { buffer } = buildTemplateWorkbook({
    technicalHeaders,
    displayLabels: UAE_LABELS,
    exampleRow: UAE_EXAMPLE,
    dataRows,
  })

  const requestedSkus = []
  const result = await runInitialDraftPipeline({
    buffer,
    filename: 'uae-template.xlsm',
    resolveCatalog: async (skus) => {
      requestedSkus.push(...skus)
      if (resolveCatalog) return resolveCatalog(skus)
      return new Map(Object.entries(catalog))
    },
  })

  const draftPkg = opc.readPackage(result.draftBuffer)
  const draftXml = opc.readEntryContent(opc.findEntry(draftPkg, 'xl/worksheets/sheet1.xml')).toString('utf8')
  const strings = parseSharedStrings(
    opc.readEntryContent(opc.findEntry(draftPkg, 'xl/sharedStrings.xml')).toString('utf8')
  )
  const cells = readSheetCells(draftXml, strings)

  const columnOf = (letters) => {
    let index = 0
    for (const character of letters) index = index * 26 + (character.charCodeAt(0) - 64)
    return index
  }

  return {
    result,
    requestedSkus,
    uploaded: buffer,
    /** Reads a cell out of the generated draft, e.g. cell('G', 8). */
    cell: (letters, row) => {
      const cell = (cells.get(row) || new Map()).get(columnOf(letters))
      return cell ? String(cell.value ?? '') : ''
    },
  }
}

describe('isSameValue', () => {
  it('treats whitespace and letter-case differences as the same value', () => {
    assert.equal(isSameValue(' Life Smile ', 'life smile'), true)
    assert.equal(isSameValue('Kilograms', 'kilograms'), true)
  })

  it('compares numbers numerically so 16.60 matches 16.6', () => {
    assert.equal(isSameValue('16.60', '16.6'), true)
    assert.equal(isSameValue('3', '3.0'), true)
    assert.equal(isSameValue('16.6', '16.7'), false)
  })

  it('does not treat different text as the same', () => {
    assert.equal(isSameValue('Silver', 'Grey'), false)
    assert.equal(isSameValue('', 'Silver'), false)
  })
})

describe('initial draft pipeline — populating blank cells', () => {
  it('fills the mapped blank cells and leaves the SKU exactly as uploaded', async () => {
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })

    assert.equal(cell('A', 8), 'LS-POT-24')
    assert.equal(cell('G', 8), 'Life Smile 24cm Stainless Steel Cooking Pot')
    assert.equal(cell('I', 8), BRAND_NAME)
    assert.equal(cell('J', 8), MANUFACTURER_NAME)
    assert.equal(cell('K', 8), '18/10 stainless steel pot.\nInduction ready.')
    assert.equal(cell('L', 8), 'Silver')
    assert.equal(cell('M', 8), '24 cm')
    assert.equal(cell('O', 8), '', 'warranty is never written')
    assert.equal(result.summary.matched, 1)
    assert.equal(result.summary.conflictCells, 0)
  })

  it('writes each measurement next to its own unit', async () => {
    const { cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })

    assert.equal(cell('Q', 8), '2.5')
    assert.equal(cell('R', 8), 'Kilograms')
    assert.equal(cell('S', 8), '30')
    assert.equal(cell('T', 8), 'Centimeters')
    assert.equal(cell('U', 8), '20')
    assert.equal(cell('V', 8), 'Centimeters')
    assert.equal(cell('W', 8), '10')
    assert.equal(cell('X', 8), 'Centimeters')
    assert.equal(cell('AA', 8), '5')
    assert.equal(cell('AB', 8), 'Liters')
    assert.equal(cell('AC', 8), '3')
  })

  it('reports a value it cannot parse instead of writing a guess', async () => {
    const item = catalogItem({
      weightDimensions: normalizeSpecEntries(
        '[{"title":"Weight","description":"about 2 kg"},{"title":"Dimensions","description":"1.0 L (18x17x17 CM) / 1.5 L (20x19x19 CM)"}]'
      ),
    })
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(item) },
    })

    for (const letters of ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X']) {
      assert.equal(cell(letters, 8), '', `expected ${letters}8 to be left blank`)
    }
    const reasons = result.missingValues.map((entry) => entry.reason)
    assert.ok(reasons.includes('compound-value'), 'the compound dimensions should be reported')
  })
})

describe('initial draft pipeline — never overwriting the seller', () => {
  it('preserves an identical existing value without rewriting it', async () => {
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24', I: 'life smile', L: 'Silver' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })

    assert.equal(cell('I', 8), 'life smile', 'the seller spelling must survive')
    assert.equal(cell('L', 8), 'Silver')
    const preserved = result.preservedIdentical.filter((entry) => entry.rowNumber === 8)
    assert.deepEqual(preserved.map((entry) => entry.column).sort(), ['I', 'L'])
    assert.ok(preserved.every((entry) => entry.reason === 'already-identical'))
  })

  it('preserves a conflicting existing value and reports the conflict', async () => {
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24', G: 'My Own Product Title', L: 'Charcoal' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })

    assert.equal(cell('G', 8), 'My Own Product Title')
    assert.equal(cell('L', 8), 'Charcoal')

    const conflicts = result.conflicts.filter((entry) => entry.rowNumber === 8)
    assert.deepEqual(conflicts.map((entry) => entry.column).sort(), ['G', 'L'])
    const title = conflicts.find((entry) => entry.column === 'G')
    assert.equal(title.existingValue, 'My Own Product Title')
    assert.equal(title.databaseValue, 'Life Smile 24cm Stainless Steel Cooking Pot')
    assert.equal(result.summary.conflictCells, 2)
  })

  it('leaves a unit blank when the seller kept a conflicting number beside it', async () => {
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24', Q: '999' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })

    assert.equal(cell('Q', 8), '999', 'the seller weight must be kept')
    assert.equal(cell('R', 8), '', 'our unit must not relabel the seller number')

    const reasons = result.missingValues.filter((entry) => entry.column === 'R').map((entry) => entry.reason)
    assert.deepEqual(reasons, ['paired-value-kept-from-workbook'])
  })

  it('still fills a unit when the seller value agrees', async () => {
    const { cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24', Q: '2.50' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })
    assert.equal(cell('Q', 8), '2.50')
    assert.equal(cell('R', 8), 'Kilograms')
  })

  it('never writes warranty fields, even when the catalog stores a Guarantee', async () => {
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })

    assert.equal(cell('O', 8), '', 'warranty description must stay blank')
    assert.equal(cell('P', 8), '', 'the second warranty slot must stay blank')
    const byColumn = new Map(result.neverWriteColumns.map((column) => [column.column, column.reason]))
    assert.equal(byColumn.get('O'), 'warranty-never-write')
    assert.equal(byColumn.get('P'), 'warranty-never-write')
  })

  it('preserves a seller-entered warranty without reporting a conflict', async () => {
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24', O: 'Seller warranty text' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })

    assert.equal(cell('O', 8), 'Seller warranty text')
    assert.equal(
      result.conflicts.filter((entry) => entry.column === 'O').length,
      0,
      'warranty is never-write, so no conflict is proposed'
    )
  })
})

describe('initial draft pipeline — columns that are never written', () => {
  it('never writes price, quantity, listing action, product type or the SKU', async () => {
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
      extraHeaders: {
        AG: 'standard_price#1.value',
        AH: 'swatch_product_image_locator#1.media_location',
        AI: 'list_price[marketplace_id=A2VIGQ35RCS4UG]#1.value',
      },
    })

    for (const letters of ['B', 'C', 'H', 'Y', 'Z', 'AG', 'AH', 'AI']) {
      assert.equal(cell(letters, 8), '', `expected ${letters}8 to be left alone`)
    }

    const byColumn = new Map(result.neverWriteColumns.map((column) => [column.column, column.reason]))
    assert.equal(byColumn.get('A'), 'seller-sku-column')
    assert.equal(byColumn.get('B'), 'subtype-column')
    assert.equal(byColumn.get('C'), 'listing-action-column')
    assert.equal(byColumn.get('Y'), 'price-never-populated')
    assert.equal(byColumn.get('Z'), 'quantity-never-populated')
    assert.equal(byColumn.get('AG'), 'price-never-populated')
    assert.equal(byColumn.get('AH'), 'images-out-of-scope')
  })

  it('leaves the main and secondary image columns blank when no image batch was selected', async () => {
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
      extraHeaders: { AH: 'other_image_url#3.media_location' },
    })

    assert.equal(cell('H', 8), '', 'main image column stays blank without an image batch')
    assert.equal(cell('AH', 8), '', 'secondary image column stays blank without an image batch')

    // In scope for the image feature, so no longer reported as a never-write column.
    const neverWriteLetters = new Set(result.neverWriteColumns.map((column) => column.column))
    assert.equal(neverWriteLetters.has('H'), false)
    assert.equal(neverWriteLetters.has('AH'), false)
    assert.equal(result.summary.imageColumnCount, 2)
    assert.equal(result.images.enabled, false)
  })

  it('classifies the never-write patterns directly', () => {
    assert.equal(neverWriteReason('swatch_product_image_locator#1.media_location'), 'images-out-of-scope')
    assert.equal(neverWriteReason('product_type#1.value'), 'subtype-column')
    assert.equal(neverWriteReason('feed_product_type'), 'subtype-column')
    assert.equal(neverWriteReason('item_type_keyword#1.value'), 'subtype-column')
    assert.equal(neverWriteReason('standard_price#1.value'), 'price-never-populated')
    assert.equal(neverWriteReason('fulfillment_availability#1.quantity'), 'quantity-never-populated')
    assert.equal(neverWriteReason('warranty_description[marketplace_id=X]#1.value'), 'warranty-never-write')
    assert.equal(neverWriteReason('item_name[marketplace_id=X]#1.value'), null)
  })

  it('leaves material and stove compatibility to the human, and says why', async () => {
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
      extraHeaders: { AG: 'stove_compatibility[marketplace_id=A2VIGQ35RCS4UG]#1.value' },
    })

    assert.equal(cell('N', 8), '', 'material vocabulary is per product type')
    assert.equal(cell('F', 8), '', 'variation theme vocabulary is per product type')
    assert.equal(cell('AG', 8), '', 'stove compatibility is not mapped universally')

    const ignored = new Map(result.ignoredColumns.map((column) => [column.column, column.note]))
    assert.match(ignored.get('N'), /differ per product type/)
    assert.match(ignored.get('F'), /no universal equivalent/)
    assert.ok(ignored.has('AG'))

    // The catalog value is still surfaced so a human can finish the job.
    const reportOnly = result.reportOnlyFields.map((entry) => entry.field)
    assert.ok(reportOnly.includes('material (website)'))
    assert.ok(reportOnly.some((field) => field.startsWith('en_specifications.Stove Compatibility')))
  })
})

describe('initial draft pipeline — product features as bullet points', () => {
  it('writes the website features across the bullet columns in the stored order', async () => {
    const item = catalogItem({
      shortDescription: featureListHtml('Granite non-stick coating', 'Tempered glass lid', 'Induction ready'),
    })
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(item) },
    })

    assert.deepEqual(
      UAE_BULLET_COLUMNS.map((letters) => cell(letters, 8)),
      ['Granite non-stick coating', 'Tempered glass lid', 'Induction ready']
    )

    // Each bullet is recorded against its own column, attributed to the website field.
    const written = result.populated.filter((entry) => UAE_BULLET_COLUMNS.includes(entry.column))
    assert.equal(written.length, 3)
    assert.ok(written.every((entry) => entry.source === 'product_specifications.short_description'))
  })

  it('copies each feature verbatim, unwrapping markup without rewording it', async () => {
    const item = catalogItem({
      shortDescription:
        '<ul class="editor__list">' +
        '<li><strong>1 YEAR </strong><a href="https://www.lifesmile.ae/"><strong>LIFESMILE</strong></a><strong> GUARANTEE</strong></li>' +
        '<li>7 Size Options &amp; 3 Colors<br>From 16cm to 40cm.</li>' +
        '</ul>',
    })
    const { cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(item) },
    })

    assert.equal(cell('AD', 8), '1 YEAR LIFESMILE GUARANTEE', 'the link text stays, the URL does not')
    assert.equal(cell('AE', 8), '7 Size Options & 3 Colors From 16cm to 40cm.')
  })

  it('leaves the spare bullet columns blank when there are fewer features than columns', async () => {
    const item = catalogItem({ shortDescription: featureListHtml('Granite non-stick coating') })
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(item) },
    })

    assert.equal(cell('AD', 8), 'Granite non-stick coating')
    assert.equal(cell('AE', 8), '')
    assert.equal(cell('AF', 8), '')

    const reasons = result.missingValues
      .filter((entry) => ['AE', 'AF'].includes(entry.column))
      .map((entry) => entry.reason)
    assert.deepEqual(reasons, ['fewer-values-than-columns', 'fewer-values-than-columns'])
    assert.equal(result.summary.surplusListValueCount, 0)
  })

  it('fills the columns it has and reports the features that did not fit', async () => {
    const item = catalogItem({
      shortDescription: featureListHtml('Feature one', 'Feature two', 'Feature three', 'Feature four', 'Feature five'),
    })
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(item) },
    })

    assert.deepEqual(
      UAE_BULLET_COLUMNS.map((letters) => cell(letters, 8)),
      ['Feature one', 'Feature two', 'Feature three']
    )

    // The template has three columns, so features four and five are surfaced, not dropped.
    assert.equal(result.summary.surplusListValueCount, 2)
    assert.deepEqual(
      result.surplusListValues.map((entry) => entry.value),
      ['Feature four', 'Feature five']
    )
    assert.ok(result.surplusListValues.every((entry) => entry.sku === 'LS-POT-24' && entry.rowNumber === 8))
    assert.match(result.surplusListValues[0].note, /has 3 Bullet Point columns/)
  })

  it('keeps a bullet the seller already wrote and reports the conflict', async () => {
    const item = catalogItem({
      shortDescription: featureListHtml('Granite non-stick coating', 'Tempered glass lid', 'Induction ready'),
    })
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24', AE: 'Hand written selling point' } },
      catalog: { 'LS-POT-24': matched(item) },
    })

    assert.equal(cell('AE', 8), 'Hand written selling point', 'the seller bullet must survive')
    assert.equal(cell('AD', 8), 'Granite non-stick coating', 'the blank bullets are still filled')
    assert.equal(cell('AF', 8), 'Induction ready')

    const conflict = result.conflicts.find((entry) => entry.column === 'AE')
    assert.equal(conflict.existingValue, 'Hand written selling point')
    assert.equal(conflict.databaseValue, 'Tempered glass lid')
  })

  it('does not rewrite a bullet the seller already wrote identically', async () => {
    const item = catalogItem({ shortDescription: featureListHtml('Granite non-stick coating') })
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24', AD: 'granite non-stick coating' } },
      catalog: { 'LS-POT-24': matched(item) },
    })

    assert.equal(cell('AD', 8), 'granite non-stick coating')
    assert.ok(result.preservedIdentical.some((entry) => entry.column === 'AD' && entry.reason === 'already-identical'))
  })

  it('gives a variant row its parent product features', async () => {
    // The catalog joins specifications on the parent, so a variant carries the parent's
    // feature list. See the repository test that pins that join.
    const parentFeatures = featureListHtml('Granite non-stick coating', 'Tempered glass lid', 'Induction ready')
    const variant = catalogItem({
      matchSource: 'variant',
      itemCode: 'LS-POT-24-RED',
      parentItemCode: 'LS-POT-PARENT',
      shortDescription: parentFeatures,
    })
    const parent = catalogItem({ shortDescription: parentFeatures, variantCount: 2 })

    const { cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-PARENT' }, 9: { A: 'LS-POT-24-RED' } },
      catalog: { 'LS-POT-PARENT': matched(parent), 'LS-POT-24-RED': matched(variant) },
    })

    const bulletsOn = (row) => UAE_BULLET_COLUMNS.map((letters) => cell(letters, row))
    assert.deepEqual(bulletsOn(9), ['Granite non-stick coating', 'Tempered glass lid', 'Induction ready'])
    assert.deepEqual(bulletsOn(9), bulletsOn(8), 'the child must carry the parent features')
  })

  it('leaves every bullet blank and reports it when the product stores no features', async () => {
    const item = catalogItem({ shortDescription: '<p>A pot for cooking.</p>' })
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(item) },
    })

    for (const letters of UAE_BULLET_COLUMNS) {
      assert.equal(cell(letters, 8), '', `expected ${letters}8 to stay blank`)
    }

    const reported = result.missingValues.filter((entry) => UAE_BULLET_COLUMNS.includes(entry.column))
    assert.equal(reported.length, UAE_BULLET_COLUMNS.length)
    assert.ok(reported.every((entry) => entry.reason === 'no-database-value'))
    assert.equal(result.summary.surplusListValueCount, 0)
  })

  it('does not report the later bullet columns as untouched slots', async () => {
    const { result } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(catalogItem({ shortDescription: featureListHtml('One', 'Two', 'Three') })) },
    })
    const untouched = result.additionalSlotColumns.map((column) => column.column)
    for (const letters of UAE_BULLET_COLUMNS) {
      assert.ok(!untouched.includes(letters), `${letters} is filled, so it is not an untouched slot`)
    }
  })

  it('writes the same bullets whatever the product type says', async () => {
    const item = catalogItem({ shortDescription: featureListHtml('Granite non-stick coating', 'Induction ready') })
    const outputs = []
    for (const subtype of ['', 'COOKWARE_SET', 'SOME_SUBTYPE_INVENTED_TOMORROW']) {
      const { cell } = await generate({
        dataRows: { 8: { A: 'LS-POT-24', B: subtype } },
        catalog: { 'LS-POT-24': matched(item) },
      })
      outputs.push(UAE_BULLET_COLUMNS.map((letters) => cell(letters, 8)))
    }

    for (const bullets of outputs) {
      assert.deepEqual(bullets, ['Granite non-stick coating', 'Induction ready', ''])
    }
  })
})

describe('seller SKU matching — exact first, then letter case', () => {
  const {
    findCatalogItemsBySku,
  } = require('../src/services/amazonInitialDraft/websiteCatalogRepository')

  let nextId = 1

  /** A catalog row as the repository query returns it. */
  function row(itemCode, overrides = {}) {
    nextId += 1
    return {
      match_source: 'product',
      product_id: nextId,
      variant_id: null,
      item_code: itemCode,
      product_name: `Product ${itemCode}`,
      variant_type: 'Single',
      status: 'active',
      color: 'Silver',
      size: '24 cm',
      material: 'Stainless Steel',
      parent_item_code: null,
      variant_count: 0,
      short_description: '<ul><li>Granite non-stick coating</li></ul>',
      long_description: '<p>A pot.</p>',
      en_specifications: '[]',
      weight_dimensions: '[]',
      category_name: 'Cookware',
      sub_category_name: 'Pots',
      ...overrides,
    }
  }

  /**
   * Stands in for the database, applying the same `upper(btrim(...))` filter the real query
   * does, so the test exercises the resolution logic rather than a hand-picked row set.
   */
  function readQueryOver(rows) {
    return async (_sql, params) => {
      const requested = new Set((params[0] || []).map((code) => code.trim().toUpperCase()))
      return { rows: rows.filter((candidate) => requested.has(String(candidate.item_code).trim().toUpperCase())) }
    }
  }

  const resolve = (skus, rows) => findCatalogItemsBySku(skus, { readQuery: readQueryOver(rows) })

  it('prefers the exact match even when a differently cased code also exists', async () => {
    const rows = [row('LS-POT-24'), row('ls-pot-24')]
    const resolved = await resolve(['LS-POT-24'], rows)

    const entry = resolved.get('LS-POT-24')
    assert.equal(entry.status, 'matched')
    assert.equal(entry.matchKind, 'exact')
    assert.equal(entry.item.itemCode, 'LS-POT-24')
  })

  it('falls back to ignoring letter case when that resolves to exactly one item', async () => {
    const resolved = await resolve(['ls-pot-24'], [row('LS-POT-24')])

    const entry = resolved.get('ls-pot-24')
    assert.equal(entry.status, 'matched')
    assert.equal(entry.matchKind, 'case-insensitive')
    assert.equal(entry.reason, 'matched-ignoring-letter-case')
    assert.equal(entry.item.itemCode, 'LS-POT-24')
  })

  it('trims surrounding whitespace before matching', async () => {
    const resolved = await resolve(['  LS-POT-24  ', '\tls-pot-24 '], [row('LS-POT-24')])

    assert.equal(resolved.get('LS-POT-24').matchKind, 'exact')
    assert.equal(resolved.get('ls-pot-24').matchKind, 'case-insensitive')
  })

  it('reports ambiguity instead of guessing when the fallback finds several items', async () => {
    const rows = [row('LS-POT-24'), row('Ls-Pot-24')]
    const resolved = await resolve(['ls-pot-24'], rows)

    const entry = resolved.get('ls-pot-24')
    assert.equal(entry.status, 'ambiguous')
    assert.equal(entry.item, null)
    assert.equal(entry.reason, 'case-insensitive-match-resolves-to-multiple-catalog-rows')
    assert.equal(entry.candidates.length, 2)
  })

  it('reports ambiguity when one code exactly matches several catalog rows', async () => {
    const resolved = await resolve(['DUP'], [row('DUP'), row('DUP', { match_source: 'variant' })])

    const entry = resolved.get('DUP')
    assert.equal(entry.status, 'ambiguous')
    assert.equal(entry.reason, 'sku-resolves-to-multiple-catalog-rows')
  })

  it('never normalises internal hyphens, underscores or spacing', async () => {
    const rows = [row('LS-POT-24')]
    const resolved = await resolve(['LS_POT_24', 'LSPOT24', 'LS POT 24', 'LS-POT-24 -'], rows)

    for (const sku of ['LS_POT_24', 'LSPOT24', 'LS POT 24', 'LS-POT-24 -']) {
      const entry = resolved.get(sku)
      assert.equal(entry.status, 'unmatched', `${sku} must not reach LS-POT-24`)
      assert.equal(entry.reason, 'not-in-catalog')
    }
  })

  it('reports a SKU that is in no catalog row at all', async () => {
    const resolved = await resolve(['NOT-A-SKU'], [row('LS-POT-24')])
    const entry = resolved.get('NOT-A-SKU')
    assert.equal(entry.status, 'unmatched')
    assert.equal(entry.reason, 'not-in-catalog')
    assert.deepEqual(entry.candidates, [])
  })

  it('keeps the seller spelling in the workbook when it matched by letter case', async () => {
    const rows = [row('LS-POT-24')]
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'ls-pot-24' } },
      resolveCatalog: (skus) => resolve(skus, rows),
    })

    assert.equal(cell('A', 8), 'ls-pot-24', 'the seller SKU text must be left exactly as uploaded')
    assert.equal(cell('G', 8), 'Product LS-POT-24', 'the row is still filled from the catalog')

    const record = result.rows.find((entry) => entry.rowNumber === 8)
    assert.equal(record.status, 'matched')
    assert.equal(record.matchKind, 'case-insensitive')
    assert.equal(record.catalogItemCode, 'LS-POT-24', 'the report shows what it resolved to')
    assert.equal(result.summary.matchedIgnoringCase, 1)
  })

  it('writes nothing on an ambiguous row and leaves the SKU alone', async () => {
    const rows = [row('LS-POT-24'), row('Ls-Pot-24')]
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'ls-pot-24' } },
      resolveCatalog: (skus) => resolve(skus, rows),
    })

    assert.equal(cell('A', 8), 'ls-pot-24')
    assert.equal(cell('G', 8), '')
    assert.equal(result.summary.ambiguous, 1)
    assert.equal(result.summary.populatedCells, 0)
  })
})

describe('website catalog query — where a variant gets its features', () => {
  // The website stores one specification row per product and none per variant, so a
  // variant's features can only come from its parent. This pins the join that does it,
  // because a variant-scoped join would silently blank every child row's bullets.
  const { CATALOG_QUERY, toCatalogItem } = require('../src/services/amazonInitialDraft/websiteCatalogRepository')

  it('joins specifications on the parent product for a variant row', () => {
    const variantBranch = CATALOG_QUERY.slice(CATALOG_QUERY.indexOf('FROM product_variants'))
    assert.match(variantBranch, /JOIN product_specifications ps ON ps\.product_id = parent\.id/)
    assert.doesNotMatch(variantBranch, /product_specifications ps ON ps\.product_id = v\.id/)
  })

  it('carries the parent short description onto the variant item', () => {
    const item = toCatalogItem({
      match_source: 'variant',
      item_code: 'LS-POT-24-RED',
      parent_item_code: 'LS-POT-PARENT',
      product_name: 'Life Smile Pot',
      short_description: '<ul><li>Granite non-stick coating</li></ul>',
      en_specifications: null,
      weight_dimensions: null,
    })
    assert.equal(item.matchSource, 'variant')
    assert.equal(item.shortDescription, '<ul><li>Granite non-stick coating</li></ul>')
  })
})

describe('initial draft pipeline — subtype independence', () => {
  it('produces identical output for an unknown, blank or familiar product type', async () => {
    const outputs = []
    for (const subtype of ['', 'COOKWARE_SET', 'SOME_SUBTYPE_INVENTED_TOMORROW']) {
      const { result, cell } = await generate({
        dataRows: { 8: { A: 'LS-POT-24', B: subtype } },
        catalog: { 'LS-POT-24': matched(catalogItem()) },
      })
      outputs.push({
        subtype,
        populated: result.summary.populatedCells,
        name: cell('G', 8),
        weight: cell('Q', 8),
        unit: cell('R', 8),
        productType: cell('B', 8),
      })
    }

    // Same values written regardless of subtype, and the subtype cell is untouched.
    for (const output of outputs) {
      assert.equal(output.populated, outputs[0].populated, `subtype ${output.subtype} changed the field count`)
      assert.equal(output.name, outputs[0].name)
      assert.equal(output.weight, outputs[0].weight)
      assert.equal(output.unit, outputs[0].unit)
      assert.equal(output.productType, output.subtype)
    }
  })

  it('accepts a row with an unknown product type rather than rejecting it', async () => {
    const { result } = await generate({
      dataRows: { 8: { A: 'LS-POT-24', B: 'NOT_A_REAL_AMAZON_TYPE' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })
    assert.equal(result.summary.matched, 1)
    assert.ok(result.summary.populatedCells > 0)
  })
})

describe('initial draft pipeline — SKU resolution', () => {
  it('reports an unmatched SKU and writes nothing on its row', async () => {
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' }, 9: { A: 'NOT-IN-CATALOG' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })

    const row = result.rows.find((entry) => entry.rowNumber === 9)
    assert.equal(row.status, 'unmatched')
    assert.equal(row.reason, 'not-in-catalog')
    assert.deepEqual(row.counts, { populated: 0, preserved: 0, conflicts: 0, missing: 0, notApplicable: 0, images: 0 })
    assert.equal(cell('G', 9), '')
    assert.equal(cell('A', 9), 'NOT-IN-CATALOG')
    assert.equal(result.summary.unmatched, 1)
  })

  it('fills every row of a duplicated SKU and flags the duplication', async () => {
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' }, 9: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })

    assert.equal(cell('G', 8), 'Life Smile 24cm Stainless Steel Cooking Pot')
    assert.equal(cell('G', 9), 'Life Smile 24cm Stainless Steel Cooking Pot')
    assert.equal(result.summary.duplicateSkuRows, 2)
    assert.ok(result.rows.filter((row) => row.sku === 'LS-POT-24').every((row) => row.duplicateSkuInUpload))
  })

  it('asks the catalog for each distinct SKU once', async () => {
    const { requestedSkus } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' }, 9: { A: 'LS-POT-24' }, 10: { A: 'LS-PAN-20' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })
    assert.deepEqual(requestedSkus, ['LS-POT-24', 'LS-PAN-20'])
  })

  it('writes nothing for an ambiguous SKU and keeps the candidates for review', async () => {
    const candidates = [
      { matchSource: 'product', productId: 1, variantId: null, itemCode: 'DUP', productName: 'Pot A', status: 'active' },
      { matchSource: 'variant', productId: 2, variantId: 9, itemCode: 'DUP', productName: 'Pot B', status: 'active' },
    ]
    const { result, cell } = await generate({
      dataRows: { 8: { A: 'DUP' } },
      catalog: { DUP: { status: 'ambiguous', reason: 'multiple-catalog-matches', candidates } },
    })

    assert.equal(cell('G', 8), '')
    const row = result.rows.find((entry) => entry.rowNumber === 8)
    assert.equal(row.status, 'ambiguous')
    assert.equal(row.candidates.length, 2)
    assert.equal(result.summary.ambiguous, 1)
  })

  it('ignores the untouched blank rows Amazon ships in the template', async () => {
    const { result } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })
    assert.equal(result.summary.rowsWithSku, 1)
    assert.equal(result.summary.unmatched, 0)
    assert.ok(result.summary.dataRowsInSheet > 1, 'the sheet does contain trailing blank rows')
  })
})

describe('initial draft pipeline — variation structure', () => {
  it('marks a row that matched a variant as a child and fills its parent SKU', async () => {
    const item = catalogItem({ matchSource: 'variant', parentItemCode: 'LS-POT-PARENT', itemCode: 'LS-POT-24-RED' })
    const { cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24-RED' } },
      catalog: { 'LS-POT-24-RED': matched(item) },
    })
    assert.equal(cell('D', 8), 'Child')
    assert.equal(cell('E', 8), 'LS-POT-PARENT')
  })

  it('marks a product that owns variants as a parent and leaves its parent SKU blank', async () => {
    const { cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(catalogItem({ variantCount: 3 })) },
    })
    assert.equal(cell('D', 8), 'Parent')
    assert.equal(cell('E', 8), '')
  })

  it('leaves parentage blank for a standalone product', async () => {
    const { cell } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(catalogItem({ variantCount: 0 })) },
    })
    assert.equal(cell('D', 8), '')
    assert.equal(cell('E', 8), '')
  })
})

describe('initial draft pipeline — workbook preservation', () => {
  it('changes only the template worksheet and keeps the macro binary identical', async () => {
    const { result, uploaded } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })

    const before = opc.readPackage(uploaded)
    const after = opc.readPackage(result.draftBuffer)

    const changed = []
    for (const entry of before.entries) {
      const counterpart = opc.findEntry(after, entry.name)
      assert.ok(counterpart, `${entry.name} disappeared from the draft`)
      if (Buffer.compare(opc.readEntryContent(entry), opc.readEntryContent(counterpart)) !== 0) {
        changed.push(entry.name)
      }
    }

    assert.deepEqual(changed, ['xl/worksheets/sheet1.xml'])
  })

  it('does not modify the uploaded buffer', async () => {
    const { buffer } = buildTemplateWorkbook({
      technicalHeaders: UAE_HEADERS,
      dataRows: { 8: { A: 'LS-POT-24' } },
    })
    const snapshot = Buffer.from(buffer)

    await runInitialDraftPipeline({
      buffer,
      resolveCatalog: async () => new Map([['LS-POT-24', matched(catalogItem())]]),
    })

    assert.equal(Buffer.compare(buffer, snapshot), 0)
  })

  it('keeps validations, conditional formatting, defined names and the hidden sheet', async () => {
    const { result } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })

    const pkg = opc.readPackage(result.draftBuffer)
    const sheet = opc.readEntryContent(opc.findEntry(pkg, 'xl/worksheets/sheet1.xml')).toString('utf8')
    const workbookXml = opc.readEntryContent(opc.findEntry(pkg, 'xl/workbook.xml')).toString('utf8')

    assert.match(sheet, /<dataValidation type="list"/)
    assert.match(sheet, /<conditionalFormatting sqref=/)
    assert.match(sheet, /<mergeCell ref=/)
    assert.match(sheet, /state="frozen"/)
    assert.match(workbookXml, /<definedName name="ptlist">/)
    assert.match(workbookXml, /state="hidden"/)
    assert.deepEqual(
      result.sheets.map((entry) => entry.name),
      ['Template', 'Dropdown Lists']
    )
  })

  it('returns a valid workbook even when there is nothing to write', async () => {
    const { result, uploaded } = await generate({
      dataRows: { 8: { A: 'NOT-IN-CATALOG' } },
      catalog: {},
    })
    assert.equal(result.summary.populatedCells, 0)
    assert.equal(Buffer.compare(result.draftBuffer, opc.writePackage(opc.readPackage(uploaded))), 0)
  })

  it('labels the output as an initial draft', async () => {
    const { result } = await generate({
      dataRows: { 8: { A: 'LS-POT-24' } },
      catalog: { 'LS-POT-24': matched(catalogItem()) },
    })
    assert.equal(result.notice, DRAFT_NOTICE)
    assert.equal(result.summary.notice, DRAFT_NOTICE)
    assert.match(DRAFT_NOTICE, /^Initial Draft — requires content enhancement and final Amazon validation before upload\.$/)
  })

  it('rejects an empty upload with a clear code', async () => {
    await assert.rejects(
      () => runInitialDraftPipeline({ buffer: Buffer.alloc(0), resolveCatalog: async () => new Map() }),
      (error) => error.code === 'FILE_REQUIRED'
    )
  })
})
