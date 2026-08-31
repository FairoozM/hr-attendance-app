'use strict'

const assert = require('node:assert/strict')
const { beforeEach, describe, it } = require('node:test')

const opc = require('../src/services/amazonInitialDraft/opcPackage')
const s3 = require('../src/services/amazonInitialDraft/marketplaceImageS3')
const { openTemplateWorkbook } = require('../src/services/amazonInitialDraft/amazonTemplateWorkbook')
const { parseSharedStrings, readSheetCells } = require('../src/services/amazonInitialDraft/worksheetXml')
const { resolveProductImages } = require('../src/services/amazonInitialDraft/productImageResolver')
const {
  buildImageColumnMap,
  isInScopeImageColumn,
  readSlotNumber,
} = require('../src/services/amazonInitialDraft/imageColumnMapping')
const { runInitialDraftPipeline } = require('../src/services/amazonInitialDraft/draftGenerator')
const { UAE_EXAMPLE, UAE_HEADERS, UAE_LABELS, buildTemplateWorkbook } = require('./helpers/amazonTemplateFixture')

const ENV = {
  AMAZON_IMAGE_SOURCE_BUCKET: 'lifesmile-amazon-images-2026',
  AMAZON_IMAGE_SOURCE_ROOTS: 'marketplace-originals/amazon-ae/',
  AMAZON_IMAGE_DELIVERY_BUCKET: 'lifesmile-amazon-images-2026',
  AMAZON_IMAGE_DELIVERY_PREFIX: 'amazon-public/amazon-ae/',
  AMAZON_IMAGE_PUBLIC_BASE_URL: 'https://images.lifesmile.ae',
}

const BATCH = 'marketplace-originals/amazon-ae/batch-2026-08/'
const SKU = 'NSEL-20'
const URL_FOR = (slot) => `https://images.lifesmile.ae/amazon-public/amazon-ae/${SKU}/${slot}.jpg`

/**
 * Secondary image columns are deliberately placed at AG, AH and AJ — out of order and with
 * a gap — so nothing can pass by assuming fixed column letters or contiguous slots.
 */
const IMAGE_HEADERS = {
  AG: 'other_product_image_locator#1.media_location',
  AH: 'other_product_image_locator#2.media_location',
  AJ: 'other_product_image_locator#4.media_location',
  AK: 'swatch_product_image_locator#1.media_location',
}

const IMAGE_LABELS = {
  AG: 'Other Image URL 1',
  AH: 'Other Image URL 2',
  AJ: 'Other Image URL 4',
  AK: 'Swatch Image URL',
}

function jpegHeader(width = 2000, height = 2000) {
  const buffer = Buffer.alloc(20, 0)
  buffer[0] = 0xff
  buffer[1] = 0xd8
  buffer[2] = 0xff
  buffer[3] = 0xc0
  buffer.writeUInt16BE(17, 4)
  buffer[6] = 8
  buffer.writeUInt16BE(height, 7)
  buffer.writeUInt16BE(width, 9)
  return buffer
}

function stubS3(keys) {
  const delivery = new Map()
  s3.setClientForTests({
    async send(command) {
      const name = command.constructor.name
      const input = command.input

      if (name === 'ListObjectsV2Command') {
        const prefix = input.Prefix || ''
        return {
          Contents: keys
            .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
            .map((key) => ({ Key: key, Size: 1024, ETag: '"etag"', LastModified: new Date('2026-08-01') })),
          CommonPrefixes: [],
        }
      }
      if (name === 'HeadObjectCommand') {
        const found = delivery.get(input.Key)
        if (!found) throw Object.assign(new Error('Not Found'), { name: 'NotFound' })
        return { ContentLength: found.size, ETag: '"d"', ContentType: found.contentType, Metadata: found.metadata }
      }
      if (name === 'GetObjectCommand') return { Body: { transformToByteArray: async () => jpegHeader() } }
      if (name === 'CopyObjectCommand') {
        delivery.set(input.Key, { size: 1024, contentType: input.ContentType, metadata: input.Metadata })
        return {}
      }
      throw new Error(`unexpected command ${name}`)
    },
  })
}

const APPROVED_BATCH = [
  `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`,
  `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_1.jpg`,
  `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_2.jpg`,
  `${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_4.jpg`,
]

const okFetch = async () => ({
  ok: true,
  status: 200,
  headers: { get: (header) => (header.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
})

async function generate({ dataRows = { 8: { A: SKU } }, keys = APPROVED_BATCH, batchPrefix = BATCH } = {}) {
  stubS3(keys)

  const { buffer } = buildTemplateWorkbook({
    technicalHeaders: { ...UAE_HEADERS, ...IMAGE_HEADERS },
    displayLabels: { ...UAE_LABELS, ...IMAGE_LABELS },
    exampleRow: UAE_EXAMPLE,
    dataRows,
  })

  const result = await runInitialDraftPipeline({
    buffer,
    resolveCatalog: async () => new Map(),
    resolveImages: ({ workbookSkus, columns }) =>
      batchPrefix
        ? resolveProductImages({ workbookSkus, columns, batchPrefix, env: ENV, fetchImpl: okFetch })
        : Promise.resolve({}),
  })

  const draft = opc.readPackage(result.draftBuffer)
  const sheetXml = opc.readEntryContent(opc.findEntry(draft, 'xl/worksheets/sheet1.xml')).toString('utf8')
  const sharedEntry = opc.findEntry(draft, 'xl/sharedStrings.xml')
  const shared = parseSharedStrings(sharedEntry ? opc.readEntryContent(sharedEntry).toString('utf8') : '')
  const cells = readSheetCells(sheetXml, shared)

  const columnOf = (letters) => {
    let index = 0
    for (const character of letters) index = index * 26 + (character.charCodeAt(0) - 64)
    return index
  }

  const cell = (letters, row) => {
    const found = (cells.get(row) || new Map()).get(columnOf(letters))
    return found ? String(found.value ?? '') : ''
  }

  return { result, draft, sheetXml, cell, uploaded: buffer }
}

beforeEach(() => {
  s3.setClientForTests(null)
})

describe('amazon image Excel behaviour — column mapping', () => {
  it('writes the main URL into the detected main image header, not a fixed letter', async () => {
    const { cell, result } = await generate()

    assert.equal(cell('H', 8), URL_FOR('MAIN'))
    assert.equal(result.summary.imageCellsPopulated, 4)

    const mainCell = result.populated.find((entry) => entry.column === 'H')
    assert.equal(mainCell.technicalHeader, 'main_product_image_locator#1.media_location')
    assert.equal(mainCell.source, 'aws-marketplace-image')
  })

  it('writes each secondary URL into its own numbered header and keeps the gap', async () => {
    const { cell } = await generate()

    assert.equal(cell('AG', 8), URL_FOR('PT01'))
    assert.equal(cell('AH', 8), URL_FOR('PT02'))
    // Position 4 belongs in the `#4` column, and position 3 stays empty rather than
    // pulling image 4 forward.
    assert.equal(cell('AJ', 8), URL_FOR('PT04'))
    assert.equal(cell('AK', 8), '', 'swatch column is out of scope')
  })

  it('leaves every non-image cell alone when only images are available', async () => {
    const { cell, result } = await generate()

    for (const letters of ['B', 'C', 'G', 'Y', 'Z', 'AK']) {
      assert.equal(cell(letters, 8), '', `${letters}8 must be untouched`)
    }
    assert.equal(cell('A', 8), SKU)
    assert.equal(result.summary.matched, 0, 'no catalog match was resolved in this run')
  })

  it('populates images for a row the website catalog could not match', async () => {
    const { result } = await generate()
    const row = result.rows.find((entry) => entry.rowNumber === 8)
    assert.equal(row.status, 'unmatched')
    assert.equal(row.counts.images, 4)
  })
})

/**
 * The live UAE template numbers the attribute name and leaves every qualifier at `#1`:
 *
 *   other_product_image_locator_1[marketplace_id=A2VIGQ35RCS4UG]#1.media_location
 *   other_product_image_locator_8[marketplace_id=A2VIGQ35RCS4UG]#1.media_location
 *
 * Reading the qualifier first collapses all eight columns onto position 1, so seven of them
 * are discarded as duplicates and a seven-image SKU only ever gets its main image plus one.
 */
describe('amazon image Excel behaviour — real UAE header shape', () => {
  const MARKETPLACE = '[marketplace_id=A2VIGQ35RCS4UG]'
  const realHeader = (attribute) => `${attribute}${MARKETPLACE}#1.media_location`

  const columnsFor = (attributes) =>
    attributes.map((attribute, index) => ({
      column: index + 1,
      letters: `C${index + 1}`,
      technicalHeader: realHeader(attribute),
      normalizedKey: attribute,
      displayLabel: attribute,
      groupLabel: 'Images',
    }))

  it('reads the position from the attribute name when every qualifier is #1', () => {
    for (let position = 1; position <= 8; position += 1) {
      assert.equal(readSlotNumber(realHeader(`other_product_image_locator_${position}`)), position)
    }
  })

  it('still reads the position from the #N qualifier when the attribute is unnumbered', () => {
    assert.equal(readSlotNumber('other_product_image_locator#4.media_location'), 4)
    assert.equal(readSlotNumber('other_product_image_locator'), null)
  })

  it('maps all eight secondary columns instead of discarding seven as duplicates', () => {
    const attributes = ['main_product_image_locator']
    for (let position = 1; position <= 8; position += 1) {
      attributes.push(`other_product_image_locator_${position}`)
    }
    const columns = columnsFor(attributes)
    const map = buildImageColumnMap(columns)

    assert.equal(map.main.letters, 'C1')
    assert.deepEqual(map.supportedSecondaryPositions, [1, 2, 3, 4, 5, 6, 7, 8])
    for (let position = 1; position <= 8; position += 1) {
      assert.equal(map.secondary.get(position).letters, `C${position + 1}`)
    }
    assert.deepEqual(map.outOfScope, [])
  })

  it('keeps the offer-image group out of scope so it cannot claim the product positions', () => {
    const columns = columnsFor([
      'main_product_image_locator',
      'other_product_image_locator_1',
      'swatch_product_image_locator',
      'main_offer_image_locator',
      'other_offer_image_locator_1',
      'other_offer_image_locator_2',
    ])
    const map = buildImageColumnMap(columns)

    assert.equal(map.main.letters, 'C1')
    assert.deepEqual(map.supportedSecondaryPositions, [1])
    assert.equal(map.secondary.get(1).letters, 'C2')

    assert.deepEqual(
      map.outOfScope.map((entry) => [entry.column.letters, entry.reason]),
      [
        ['C3', 'swatch-image-out-of-scope'],
        ['C4', 'offer-image-out-of-scope'],
        ['C5', 'offer-image-out-of-scope'],
        ['C6', 'offer-image-out-of-scope'],
      ]
    )

    for (const attribute of ['main_offer_image_locator', 'other_offer_image_locator_1']) {
      assert.equal(isInScopeImageColumn(realHeader(attribute)), false)
    }
    assert.equal(isInScopeImageColumn(realHeader('other_product_image_locator_8')), true)
  })
})

describe('amazon image Excel behaviour — existing values', () => {
  it('preserves an identical URL without rewriting it', async () => {
    const { result } = await generate({ dataRows: { 8: { A: SKU, H: URL_FOR('MAIN') } } })

    const preserved = result.preservedIdentical.find((entry) => entry.column === 'H')
    assert.equal(preserved.reason, 'already-identical')
    assert.equal(result.conflicts.some((entry) => entry.column === 'H'), false)

    const mapping = result.imageMappings.find((entry) => entry.detectedPosition === 'Main')
    assert.equal(mapping.populationStatus, 'existing-identical-value')
  })

  it('preserves a different existing URL and reports the conflict', async () => {
    const existing = 'https://images.example.com/legacy/main.jpg'
    const { cell, result } = await generate({ dataRows: { 8: { A: SKU, H: existing } } })

    assert.equal(cell('H', 8), existing, 'a user-entered image URL is never overwritten')
    const conflict = result.conflicts.find((entry) => entry.column === 'H')
    assert.equal(conflict.existingValue, existing)
    assert.equal(conflict.databaseValue, URL_FOR('MAIN'))
    assert.equal(result.summary.imageCellConflicts, 1)

    const mapping = result.imageMappings.find((entry) => entry.detectedPosition === 'Main')
    assert.equal(mapping.populationStatus, 'existing-value-preserved')
    assert.equal(mapping.existingExcelValue, existing)
  })

  it('leaves the image cells blank when no batch was selected', async () => {
    const { cell, result } = await generate({ batchPrefix: '' })

    for (const letters of ['H', 'AG', 'AH', 'AJ']) assert.equal(cell(letters, 8), '')
    assert.equal(result.summary.imageCellsPopulated, 0)
    assert.equal(result.imageMappings.length, 0)
  })

  it('leaves the image cells blank when AWS fails, and still produces a draft', async () => {
    s3.setClientForTests({
      async send() {
        throw Object.assign(new Error('denied'), { name: 'AccessDenied' })
      },
    })

    const { buffer } = buildTemplateWorkbook({
      technicalHeaders: { ...UAE_HEADERS, ...IMAGE_HEADERS },
      displayLabels: { ...UAE_LABELS, ...IMAGE_LABELS },
      exampleRow: UAE_EXAMPLE,
      dataRows: { 8: { A: SKU } },
    })

    const result = await runInitialDraftPipeline({
      buffer,
      resolveCatalog: async () => new Map(),
      resolveImages: ({ workbookSkus, columns }) =>
        resolveProductImages({ workbookSkus, columns, batchPrefix: BATCH, env: ENV, fetchImpl: okFetch }),
    })

    assert.match(result.images.error, /source-listing-failed/)
    assert.equal(result.summary.imageCellsPopulated, 0)
    assert.ok(Buffer.isBuffer(result.draftBuffer) && result.draftBuffer.length > 0)
  })

  it('survives an image resolver that throws', async () => {
    const { buffer } = buildTemplateWorkbook({
      technicalHeaders: { ...UAE_HEADERS, ...IMAGE_HEADERS },
      displayLabels: { ...UAE_LABELS, ...IMAGE_LABELS },
      exampleRow: UAE_EXAMPLE,
      dataRows: { 8: { A: SKU } },
    })

    const result = await runInitialDraftPipeline({
      buffer,
      resolveCatalog: async () => new Map(),
      resolveImages: async () => {
        throw new Error('aws exploded')
      },
    })

    assert.match(result.images.error, /^image-resolution-failed/)
    assert.ok(result.draftBuffer.length > 0)
  })
})

describe('amazon image Excel behaviour — workbook preservation', () => {
  it('changes only the template worksheet and keeps every other part byte-identical', async () => {
    const { draft, uploaded } = await generate()
    const original = opc.readPackage(uploaded)

    assert.deepEqual(
      draft.entries.map((entry) => entry.name),
      original.entries.map((entry) => entry.name)
    )

    for (const entry of original.entries) {
      const after = opc.findEntry(draft, entry.name)
      if (entry.name === 'xl/worksheets/sheet1.xml') continue
      assert.deepEqual(
        opc.readEntryContent(after),
        opc.readEntryContent(entry),
        `${entry.name} must be preserved byte-for-byte`
      )
    }
  })

  it('reopens cleanly, keeping the header rows, hidden sheet and preference-profile row', async () => {
    const { result, draft, sheetXml, cell } = await generate()

    // Reopening the produced draft is what Excel does; a corrupt package would throw.
    const reopened = openTemplateWorkbook(opc.writePackage(draft))
    assert.equal(reopened.headerRow, result.summary.headerRow)
    assert.equal(reopened.skuColumnLetters, 'A')
    assert.deepEqual(
      reopened.sheets.map((sheet) => sheet.state),
      result.sheets.map((sheet) => sheet.state)
    )
    assert.equal(reopened.sheets.some((sheet) => sheet.state === 'hidden'), true)

    assert.equal(cell('A', 5), 'contribution_sku#1.value', 'technical header row intact')
    assert.equal(cell('H', 4), 'Main Image URL', 'display label row intact')
    assert.match(cell('A', 7), /prefilled attributes from your selected Preference Profiles/)
    assert.match(sheetXml, /<pane /, 'frozen pane retained')
    assert.match(sheetXml, /<dataValidations/, 'validations retained')
    assert.match(sheetXml, /<conditionalFormatting/, 'conditional formatting retained')

    const image = reopened.dataRows.find((row) => row.rowNumber === 8)
    assert.equal(image.sku, SKU)
  })

  it('writes the URL as text so no image cell becomes a number or loses characters', async () => {
    const { sheetXml } = await generate()
    const url = URL_FOR('MAIN')
    assert.match(sheetXml, new RegExp(`t="inlineStr"`))
    assert.equal(sheetXml.includes(url), true)
  })
})

describe('amazon image Excel behaviour — report rows', () => {
  it('reports one row per source file plus the missing positions', async () => {
    const { result } = await generate()

    const positions = result.imageMappings.map((entry) => entry.detectedPosition).sort()
    assert.deepEqual(positions, ['1', '2', '3', '4', 'Main'])

    const populated = result.imageMappings.filter((entry) => entry.populationStatus === 'populated')
    assert.equal(populated.length, 4)
    for (const entry of populated) {
      assert.equal(entry.sku, SKU)
      assert.equal(entry.contentType, 'image/jpeg')
      assert.equal(entry.httpStatus, 200)
      assert.equal(entry.width, 2000)
      assert.equal(entry.height, 2000)
      assert.match(entry.publicUrl, /^https:\/\//)
      assert.match(entry.deliveryKey, /^amazon-public\/amazon-ae\/NSEL-20\//)
      assert.equal(entry.sourceKey.startsWith(BATCH), true)
    }

    const gap = result.imageMappings.find((entry) => entry.populationStatus === 'missing-secondary-image')
    assert.equal(gap.detectedPosition, '3')
    assert.match(gap.warning, /later positions were not shifted/)
  })

  it('reports a SKU with no approved main image', async () => {
    const { result } = await generate({
      keys: [`${BATCH}1. LIFESMILE_NSEL_NSEL-20_WEBSITE_1.jpg`],
    })

    const missing = result.imageMappings.find((entry) => entry.populationStatus === 'missing-main-image')
    assert.equal(missing.sku, SKU)
    assert.equal(result.images.summary.skusMissingMainImage, 1)
  })

  it('groups the preview by SKU with the main image first', async () => {
    const { result } = await generate()

    assert.equal(result.images.skus.length, 1)
    const group = result.images.skus[0]
    assert.equal(group.sku, SKU)
    assert.equal(group.hasMainImage, true)
    assert.equal(group.main.publicUrl, URL_FOR('MAIN'))
    assert.deepEqual(group.secondary.map((image) => image.detectedPosition), ['1', '2', '4'])
    assert.match(result.images.retentionNote, /^Amazon normally stores its own copy/)
  })
})
