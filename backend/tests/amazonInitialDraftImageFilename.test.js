'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const {
  MAX_SECONDARY_POSITION,
  matchWorkbookSku,
  parseImageFilename,
  resolveImageKey,
} = require('../src/services/amazonInitialDraft/imageFilenameParser')

/** Real approved filenames, taken from the content team's batch. */
const NSEL = '1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg'

describe('amazon image filenames — position parsing', () => {
  it('reads the main image from the approved naming convention', () => {
    const parsed = parseImageFilename(`Amazon_169_Matched_Images/${NSEL}`)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.filename, '1. LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg')
    assert.equal(parsed.position.kind, 'main')
    assert.equal(parsed.position.slot, 'MAIN')
    assert.equal(parsed.skuText, 'LIFESMILE_NSEL_NSEL-20')
  })

  it('reads every supported secondary position', () => {
    for (let position = 1; position <= MAX_SECONDARY_POSITION; position += 1) {
      const parsed = parseImageFilename(`1. LIFESMILE_NSEL_NSEL-20_WEBSITE_${position}.jpg`)
      assert.equal(parsed.ok, true, `position ${position} should parse`)
      assert.equal(parsed.position.kind, 'secondary')
      assert.equal(parsed.position.number, position)
      assert.equal(parsed.position.slot, `PT0${position}`)
    }
  })

  it('treats the Main marker and the extension case-insensitively', () => {
    for (const name of [
      '1. LIFESMILE_NSEL_NSEL-20_website_MAIN.JPG',
      '1. LIFESMILE_NSEL_NSEL-20_Website_main.jpeg',
    ]) {
      const parsed = parseImageFilename(name)
      assert.equal(parsed.ok, true, name)
      assert.equal(parsed.position.slot, 'MAIN')
    }
  })

  it('accepts .jpeg as well as .jpg', () => {
    const parsed = parseImageFilename('1. LIFESMILE_NSEL_NSEL-20_WEBSITE_3.jpeg')
    assert.equal(parsed.ok, true)
    assert.equal(parsed.extension, '.jpeg')
    assert.equal(parsed.position.number, 3)
  })

  it('rejects anything that is not a JPEG', () => {
    for (const name of ['x_WEBSITE_Main.webp', 'x_WEBSITE_Main.png', 'x_WEBSITE_Main.pdf']) {
      const parsed = parseImageFilename(name)
      assert.equal(parsed.ok, false, name)
      assert.equal(parsed.reason, 'unsupported-file')
    }
  })

  it('reports a position beyond the supported Amazon slots', () => {
    const parsed = parseImageFilename('1. LIFESMILE_NSEL_NSEL-20_WEBSITE_9.jpg')
    assert.equal(parsed.ok, false)
    assert.equal(parsed.reason, 'unsupported-position')
    assert.equal(parsed.position.number, 9)
  })

  it('reports a filename with no recognisable position', () => {
    const parsed = parseImageFilename('1. LIFESMILE_NSEL_NSEL-20_WEBSITE.jpg')
    assert.equal(parsed.ok, false)
    assert.equal(parsed.reason, 'position-marker-not-found')
  })

  it('ignores any leading manual numbering', () => {
    for (const prefix of ['1. ', '12. ', '7.', '3 - ']) {
      const parsed = parseImageFilename(`${prefix}LIFESMILE_NSEL_NSEL-20_WEBSITE_Main.jpg`)
      assert.equal(parsed.ok, true, prefix)
      assert.equal(parsed.skuText, 'LIFESMILE_NSEL_NSEL-20', prefix)
    }
  })
})

describe('amazon image filenames — exact SKU matching', () => {
  it('matches the exact seller SKU and not the family token', () => {
    const match = matchWorkbookSku('LIFESMILE_NSEL_NSEL-20', ['NSEL-20', 'OTHER-1'])
    assert.equal(match.status, 'matched')
    assert.equal(match.sku, 'NSEL-20')
  })

  it('prefers the longest exact SKU so a family code cannot steal a child match', () => {
    // Both `LIFEP29` and `LIFEP29-6-2` are whole segments of this real filename.
    const match = matchWorkbookSku('LIFESMILE_LIFEP29_LIFEP29-6-2', ['LIFEP29', 'LIFEP29-6-2'])
    assert.equal(match.status, 'matched')
    assert.equal(match.sku, 'LIFEP29-6-2')
  })

  it('does not let a SKU that is a prefix of another claim the longer SKU', () => {
    const skus = ['LIFEP29-6', 'LIFEP29-6-2', 'LIFEP29-10']
    assert.equal(matchWorkbookSku('LIFESMILE_LIFEP29_LIFEP29-6', skus).sku, 'LIFEP29-6')
    assert.equal(matchWorkbookSku('LIFESMILE_LIFEP29_LIFEP29-6-2', skus).sku, 'LIFEP29-6-2')
    assert.equal(matchWorkbookSku('LIFESMILE_LIFEP29_LIFEP29-10', skus).sku, 'LIFEP29-10')
  })

  it('matches the exact child SKU including a colour or size suffix', () => {
    const skus = ['ABC-20', 'ABC-20-BLACK', 'ABC-20-XL']
    assert.equal(matchWorkbookSku('LIFESMILE_ABC_ABC-20-BLACK', skus).sku, 'ABC-20-BLACK')
    assert.equal(matchWorkbookSku('LIFESMILE_ABC_ABC-20-XL', skus).sku, 'ABC-20-XL')
    assert.equal(matchWorkbookSku('LIFESMILE_ABC_ABC-20', skus).sku, 'ABC-20')
  })

  it('never reduces NSEL-20 to the shorter NSEL when only NSEL is in the workbook', () => {
    const match = matchWorkbookSku('LIFESMILE_NSEL_NSEL-20', ['NSEL'])
    assert.equal(match.status, 'unmatched')
    assert.equal(match.sku, '')
  })

  it('matches letter case insensitively but never fuzzily', () => {
    assert.equal(matchWorkbookSku('lifesmile_nsel_nsel-20', ['NSEL-20']).sku, 'NSEL-20')
    assert.equal(matchWorkbookSku('LIFESMILE_NSEL_NSEL20', ['NSEL-20']).status, 'unmatched')
    assert.equal(matchWorkbookSku('LIFESMILE_NSEL_NSEL-2', ['NSEL-20']).status, 'unmatched')
  })

  it('takes the trailing token as the SKU when an earlier segment is also a workbook SKU', () => {
    const match = matchWorkbookSku('LIFESMILE_ABCDEF_GHIJKL', ['ABCDEF', 'GHIJKL'])
    assert.equal(match.status, 'matched')
    assert.equal(match.sku, 'GHIJKL')
  })

  it('reports an ambiguity instead of guessing between two equally exact SKUs', () => {
    // Trailing metadata after the SKU, so neither candidate is the anchoring token.
    const match = matchWorkbookSku('LIFESMILE_ABCDEF_GHIJKL_EXTRA', ['ABCDEF', 'GHIJKL'])
    assert.equal(match.status, 'ambiguous')
    assert.equal(match.sku, '')
    assert.deepEqual(match.candidates, ['ABCDEF', 'GHIJKL'])
  })

  it('reports an unmatched filename rather than inserting it somewhere', () => {
    const match = matchWorkbookSku('LIFESMILE_ZZZ_ZZZ-99', ['NSEL-20'])
    assert.equal(match.status, 'unmatched')
  })
})

describe('amazon image filenames — combined resolution', () => {
  const skus = ['NSEL-20', 'LIFEP29-6', 'LIFEP29-6-2']

  it('resolves a real key to one SKU and one position', () => {
    const resolved = resolveImageKey(`Amazon_169_Matched_Images/${NSEL}`, skus)
    assert.equal(resolved.matchStatus, 'matched')
    assert.equal(resolved.sku, 'NSEL-20')
    assert.equal(resolved.position.slot, 'MAIN')
  })

  it('surfaces each failure mode with its own status', () => {
    assert.equal(resolveImageKey('a_WEBSITE_Main.webp', skus).matchStatus, 'unsupported-file')
    assert.equal(resolveImageKey('1. LIFESMILE_X_X-1_WEBSITE_9.jpg', skus).matchStatus, 'unsupported-position')
    assert.equal(resolveImageKey('1. LIFESMILE_X_X-1_WEBSITE_Main.jpg', skus).matchStatus, 'unmatched-filename')
    assert.equal(
      resolveImageKey('1. LIFEP29-6_LIFEP29-6-2_WEBSITE_Main.jpg', ['LIFEP29-6', 'LIFEP29-6-2']).sku,
      'LIFEP29-6-2',
      'longest match still wins when both SKUs appear as separate segments'
    )
  })
})
