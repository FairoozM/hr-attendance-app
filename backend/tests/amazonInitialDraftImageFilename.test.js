'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const {
  MAX_SECONDARY_POSITION,
  buildSkuIdentities,
  colourSeparatorAlias,
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

  it('matches nothing when an unrecognised token trails the SKU', () => {
    // The identity has to end the name. Accepting a SKU with something after it is what
    // would let a parent take a colour-specific child's image.
    const match = matchWorkbookSku('LIFESMILE_ABCDEF_GHIJKL_EXTRA', ['ABCDEF', 'GHIJKL'])
    assert.equal(match.status, 'unmatched')
    assert.equal(match.sku, '')
  })

  it('reports an ambiguity when the controlled alias collides with another workbook SKU', () => {
    // `LIFEP17S-16P-BEIGE` aliases to `LIFEP17S-16P_BEIGE`, which is also a literal SKU
    // here. Two different seller SKUs claim the same image, so nothing is populated.
    const match = matchWorkbookSku(
      'CONTENT_LIFEP17S-16P_BEIGE',
      ['LIFEP17S-16P-BEIGE', 'LIFEP17S-16P_BEIGE'],
      { 'LIFEP17S-16P-BEIGE': 'Beige' }
    )
    assert.equal(match.status, 'ambiguous')
    assert.equal(match.sku, '')
    assert.deepEqual(match.candidates, ['LIFEP17S-16P-BEIGE', 'LIFEP17S-16P_BEIGE'])
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

/**
 * The macOS Quick Action convention. These names are generated automatically and are
 * never renamed by hand, so every case below has to keep working permanently.
 */
describe('Quick Action naming — controlled colour separator', () => {
  it('rewrites only the separator immediately before a verified colour', () => {
    assert.equal(colourSeparatorAlias('LIFEP17S-16P-BEIGE', 'BEIGE'), 'LIFEP17S-16P_BEIGE')
    assert.equal(colourSeparatorAlias('LIFEP17-MIX-19-1-BEIGE', 'BEIGE'), 'LIFEP17-MIX-19-1_BEIGE')
    assert.equal(colourSeparatorAlias('LIFEP17-MIX-19-1-BLACK', 'BLACK'), 'LIFEP17-MIX-19-1_BLACK')
  })

  it('leaves internal SKU hyphens untouched when the trailing token is not the colour', () => {
    assert.equal(colourSeparatorAlias('LIFEP17-MIX-19-1', 'BEIGE'), '')
    assert.equal(colourSeparatorAlias('LIFEP29-6-2', 'BEIGE'), '')
    assert.equal(colourSeparatorAlias('NSEL-20', 'BEIGE'), '')
  })

  it('produces no alias at all when the colour is unknown', () => {
    assert.equal(colourSeparatorAlias('LIFEP17S-16P-BEIGE', ''), '')
    assert.equal(colourSeparatorAlias('LIFEP17S-16P-BEIGE', null), '')
  })

  it('matches the colour case-insensitively but keeps the SKU spelling exact', () => {
    assert.equal(colourSeparatorAlias('LIFEP17S-16P-BEIGE', 'Beige'), 'LIFEP17S-16P_BEIGE')
    assert.equal(colourSeparatorAlias('LIFEP17S-16P-Beige', 'BEIGE'), 'LIFEP17S-16P_Beige')
  })

  it('handles a colour written as two hyphenated tokens', () => {
    assert.equal(colourSeparatorAlias('LIFEX-1-LIGHT-BLUE', 'Light Blue'), 'LIFEX-1_LIGHT-BLUE')
  })

  it('never turns the whole SKU into a colour', () => {
    assert.equal(colourSeparatorAlias('BEIGE', 'BEIGE'), '')
  })

  it('offers the exact SKU and exactly one alias per SKU', () => {
    const identities = buildSkuIdentities(['LIFEP17S-16P-BEIGE'], { 'LIFEP17S-16P-BEIGE': 'Beige' })
    assert.deepEqual(
      identities.map((entry) => `${entry.kind}:${entry.identity}`),
      ['exact:LIFEP17S-16P-BEIGE', 'colour-alias:LIFEP17S-16P_BEIGE']
    )
  })

  it('does not treat underscores and hyphens as interchangeable in general', () => {
    // No colour, so no alias: an underscore filename must not match a hyphen SKU.
    const match = matchWorkbookSku('CONTENT_LIFEP29-6_2', ['LIFEP29-6-2'])
    assert.equal(match.status, 'unmatched')
  })
})

describe('Quick Action naming — real filename structure', () => {
  const COLOURS = { 'LIFEP17S-16P-BEIGE': 'Beige', 'LIFEP17-MIX-19-1-BEIGE': 'Beige' }
  const SKUS = ['LIFEP17S-16P-BEIGE', 'LIFEP17-MIX-19-1-BEIGE']

  it('matches the real main image for LIFEP17S-16P-BEIGE', () => {
    const resolved = resolveImageKey('CONTENT_LIFEP17S-16P_BEIGE_WEBSITE_Main.jpg', SKUS, COLOURS)
    assert.equal(resolved.matchStatus, 'matched')
    assert.equal(resolved.sku, 'LIFEP17S-16P-BEIGE', 'the real seller SKU is preserved unchanged')
    assert.equal(resolved.matchedIdentity, 'LIFEP17S-16P_BEIGE')
    assert.equal(resolved.matchKind, 'colour-alias')
    assert.equal(resolved.channel, 'WEBSITE')
    assert.equal(resolved.position.slot, 'MAIN')
  })

  it('matches every numbered position for the same SKU', () => {
    for (let position = 1; position <= 6; position += 1) {
      const resolved = resolveImageKey(
        `CONTENT_LIFEP17S-16P_BEIGE_WEBSITE_${position}.jpg`,
        SKUS,
        COLOURS
      )
      assert.equal(resolved.matchStatus, 'matched', `position ${position}`)
      assert.equal(resolved.sku, 'LIFEP17S-16P-BEIGE')
      assert.equal(resolved.position.number, position)
    }
  })

  it('matches a SKU whose own code contains hyphens', () => {
    const resolved = resolveImageKey('CONTENT_LIFEP17-MIX-19-1_BEIGE_WEBSITE_3.jpg', SKUS, COLOURS)
    assert.equal(resolved.sku, 'LIFEP17-MIX-19-1-BEIGE')
    assert.equal(resolved.position.number, 3)
  })

  it('keeps the colours apart', () => {
    const skus = ['LIFEP17-MIX-19-1-BEIGE', 'LIFEP17-MIX-19-1-BLACK']
    const colours = { 'LIFEP17-MIX-19-1-BEIGE': 'Beige', 'LIFEP17-MIX-19-1-BLACK': 'Black' }
    assert.equal(
      resolveImageKey('CONTENT_LIFEP17-MIX-19-1_BLACK_WEBSITE_Main.jpg', skus, colours).sku,
      'LIFEP17-MIX-19-1-BLACK'
    )
    assert.equal(
      resolveImageKey('CONTENT_LIFEP17-MIX-19-1_BEIGE_WEBSITE_Main.jpg', skus, colours).sku,
      'LIFEP17-MIX-19-1-BEIGE'
    )
  })

  it('never lets the parent SKU take a colour-specific child image', () => {
    const resolved = resolveImageKey('CONTENT_LIFEP17S-16P_BEIGE_WEBSITE_Main.jpg', ['LIFEP17S-16P'], {})
    assert.equal(resolved.matchStatus, 'unmatched-filename')
    assert.equal(resolved.sku, '')
  })

  it('prefers the longest complete child SKU over a shorter one', () => {
    const skus = ['LIFEP17S-16P-BEIGE', 'LIFEP17S-16P', 'LIFEP17S']
    const resolved = resolveImageKey('CONTENT_LIFEP17S-16P_BEIGE_WEBSITE_Main.jpg', skus, {
      'LIFEP17S-16P-BEIGE': 'Beige',
    })
    assert.equal(resolved.sku, 'LIFEP17S-16P-BEIGE')
  })

  it('populates nothing when the colour is unavailable', () => {
    const resolved = resolveImageKey('CONTENT_LIFEP17S-16P_BEIGE_WEBSITE_Main.jpg', SKUS, {})
    assert.equal(resolved.matchStatus, 'unmatched-filename')
  })
})

describe('Quick Action naming — punctuation artifacts after the channel', () => {
  const SKUS = ['LIFEP17S-16P-BEIGE']
  const COLOURS = { 'LIFEP17S-16P-BEIGE': 'Beige' }

  const MAIN_VARIANTS = [
    ['CONTENT_LIFEP17S-16P_BEIGE_WEBSITE_Main.jpg', 'clean'],
    ['CONTENT_LIFEP17S-16P_BEIGE_WEBSITE__Main.jpg', 'normalized'],
    ['CONTENT_LIFEP17S-16P_BEIGE_WEBSITE_._Main.jpg', 'normalized'],
    ['CONTENT_LIFEP17S-16P_BEIGE_WEBSITE_-._Main.jpg', 'normalized'],
  ]

  for (const [filename, quality] of MAIN_VARIANTS) {
    it(`reads Main from ${filename}`, () => {
      const resolved = resolveImageKey(filename, SKUS, COLOURS)
      assert.equal(resolved.matchStatus, 'matched')
      assert.equal(resolved.sku, 'LIFEP17S-16P-BEIGE')
      assert.equal(resolved.position.slot, 'MAIN')
      assert.equal(resolved.suffixQuality, quality)
    })
  }

  const NUMBERED_VARIANTS = [
    ['CONTENT_LIFEP17S-16P_BEIGE_WEBSITE_1.jpg', 'clean'],
    ['CONTENT_LIFEP17S-16P_BEIGE_WEBSITE__1.jpg', 'normalized'],
    ['CONTENT_LIFEP17S-16P_BEIGE_WEBSITE_._1.jpg', 'normalized'],
    ['CONTENT_LIFEP17S-16P_BEIGE_WEBSITE_-._1.jpg', 'normalized'],
  ]

  for (const [filename, quality] of NUMBERED_VARIANTS) {
    it(`reads position 1 from ${filename}`, () => {
      const resolved = resolveImageKey(filename, SKUS, COLOURS)
      assert.equal(resolved.matchStatus, 'matched')
      assert.equal(resolved.position.number, 1)
      assert.equal(resolved.suffixQuality, quality)
    })
  }

  it('does not let the cleanup touch the SKU identity', () => {
    // The artifact rule applies after the channel only, so a stray dot inside the SKU
    // area is not silently normalized into a match.
    const resolved = resolveImageKey('CONTENT_LIFEP17S-16P._BEIGE_WEBSITE_Main.jpg', SKUS, COLOURS)
    assert.equal(resolved.matchStatus, 'unmatched-filename')
  })
})

describe('Quick Action naming — channel detection', () => {
  const SKUS = ['LIFEP17-MIX-19-1-BEIGE']
  const COLOURS = { 'LIFEP17-MIX-19-1-BEIGE': 'Beige' }

  it('reads the WEBSITE and NOON channels from the filename', () => {
    const website = resolveImageKey('CONTENT_LIFEP17-MIX-19-1_BEIGE_WEBSITE_Main.jpg', SKUS, COLOURS)
    const noon = resolveImageKey('CONTENT_LIFEP17-MIX-19-1_BEIGE_NOON_Main.jpg', SKUS, COLOURS)

    assert.equal(website.channel, 'WEBSITE')
    assert.equal(noon.channel, 'NOON')
    assert.equal(noon.sku, 'LIFEP17-MIX-19-1-BEIGE', 'a NOON file still resolves to its SKU')
    assert.equal(noon.position.slot, 'MAIN')
  })

  it('treats a legacy name with no channel token as unspecified', () => {
    const resolved = resolveImageKey('NSEL-20_Main.jpg', ['NSEL-20'])
    assert.equal(resolved.matchStatus, 'matched')
    assert.equal(resolved.channel, '')
  })
})
