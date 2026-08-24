'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  cleanText,
  extractListItems,
  firstNonBlank,
  isPlaceholder,
  normalizeSpecEntries,
  parseCount,
  parseJsonColumn,
  parseMeasurement,
  parsePackageDimensions,
  readSpec,
  stripHtml,
} = require('../src/services/amazonInitialDraft/specParsers')
const { toAmazonUnit } = require('../src/services/amazonInitialDraft/unitConversion')

describe('cleanText', () => {
  it('trims the stray tabs and non-breaking spaces present in the catalog', () => {
    assert.equal(cleanText('Material\t'), 'Material')
    assert.equal(cleanText(' 1 Year'), '1 Year')
    assert.equal(cleanText('Stainless\u00a0Steel'), 'Stainless Steel')
    assert.equal(cleanText('Hand Wash, Easy to Clean\t'), 'Hand Wash, Easy to Clean')
  })

  it('collapses runs of whitespace introduced by tabs', () => {
    assert.equal(cleanText('a\t\tb'), 'a b')
    assert.equal(cleanText('a   b'), 'a b')
  })

  it('returns an empty string for blank input', () => {
    for (const value of [null, undefined, '', '   ', '\t']) {
      assert.equal(cleanText(value), '', `expected ${JSON.stringify(value)} to be blank`)
    }
  })
})

describe('isPlaceholder / firstNonBlank', () => {
  it('recognises the absence markers the catalog stores', () => {
    // 21 products store "None" as their guarantee.
    for (const value of ['None', 'none', 'N/A', 'n/a', 'NIL', '-', '--', 'null', 'TBD']) {
      assert.equal(isPlaceholder(value), true, `expected ${value} to be a placeholder`)
    }
  })

  it('keeps "No", which is a real answer for boolean specs such as Dishwasher Safe', () => {
    assert.equal(isPlaceholder('No'), false)
    assert.equal(isPlaceholder('Yes'), false)
  })

  it('skips blanks and placeholders and returns the first real value', () => {
    assert.equal(firstNonBlank('', '  ', 'None', 'Life Smile'), 'Life Smile')
    assert.equal(firstNonBlank(null, undefined, ''), '')
    assert.equal(firstNonBlank('\tStainless Steel'), 'Stainless Steel')
  })
})

describe('stripHtml', () => {
  it('unwraps the HTML the website stores for descriptions', () => {
    assert.equal(stripHtml('<p>Strong <b>pot</b></p>'), 'Strong pot')
    assert.equal(stripHtml('<li>A</li><li>B</li>'), 'A\nB')
    assert.equal(stripHtml('Line one<br>Line two'), 'Line one\nLine two')
  })

  it('decodes entities', () => {
    assert.equal(stripHtml('caf&eacute;'), 'caf&eacute;')
    assert.equal(stripHtml('Salt &amp; Pepper'), 'Salt & Pepper')
    assert.equal(stripHtml('220&deg; oven safe'), '220° oven safe')
    assert.equal(stripHtml('a&nbsp;b'), 'a b')
    assert.equal(stripHtml('&#8482;'), '\u2122')
  })

  it('drops script and style content rather than inlining it', () => {
    assert.equal(stripHtml('<style>.a{color:red}</style>Real text'), 'Real text')
    assert.equal(stripHtml('<script>alert(1)</script>Real text'), 'Real text')
  })

  it('adds, removes and reorders no words of its own', () => {
    const source = '<p>18/10 Stainless Steel, PFOA free.</p><p>Induction ready.</p>'
    assert.equal(stripHtml(source), '18/10 Stainless Steel, PFOA free.\nInduction ready.')
  })
})

describe('extractListItems', () => {
  it('returns the list items in the order they are stored', () => {
    assert.deepEqual(extractListItems('<ul><li>First</li><li>Second</li><li>Third</li></ul>'), [
      'First',
      'Second',
      'Third',
    ])
  })

  it('keeps link text and drops the URL', () => {
    const html = '<ul><li>1 Year <a href="https://www.lifesmile.ae" target="_blank">LIFE SMILE Guarantee</a></li></ul>'
    assert.deepEqual(extractListItems(html), ['1 Year LIFE SMILE Guarantee'])
  })

  it('unwraps inline markup and decodes entities without changing the wording', () => {
    const html =
      '<ul class="editor"><li class="item"><strong>Durable &amp; Easy to Clean:</strong> ' +
      '<span style="color: rgb(1,2,3)">Hand&nbsp;wash only.</span></li></ul>'
    assert.deepEqual(extractListItems(html), ['Durable & Easy to Clean: Hand wash only.'])
  })

  it('treats a line break inside an item as part of that item', () => {
    const html = '<ul><li>7 Size Options<br>From 16cm to 40cm.</li><li>Oven safe</li></ul>'
    assert.deepEqual(extractListItems(html), ['7 Size Options From 16cm to 40cm.', 'Oven safe'])
  })

  it('finds nothing in prose that has no list', () => {
    assert.deepEqual(extractListItems('<p>A pot for cooking.</p>'), [])
    assert.deepEqual(extractListItems(''), [])
    assert.deepEqual(extractListItems(null), [])
  })

  it('skips items that hold no text or only a placeholder', () => {
    assert.deepEqual(extractListItems('<ul><li>Real</li><li></li><li> </li><li>N/A</li></ul>'), ['Real'])
  })
})

describe('parseJsonColumn / normalizeSpecEntries / readSpec', () => {
  it('handles the object shape', () => {
    const specs = normalizeSpecEntries('{"Material":"Aluminium","Capacity":"2.5 L"}')
    assert.equal(readSpec(specs, 'material'), 'Aluminium')
    assert.equal(readSpec(specs, 'capacity'), '2.5 L')
  })

  it('handles the title/description array shape used by most catalog rows', () => {
    const specs = normalizeSpecEntries(
      '[{"title":"Material","description":"Stainless Steel"},{"title":"Guarantee","description":" 1 Year"}]'
    )
    assert.equal(readSpec(specs, 'material'), 'Stainless Steel')
    assert.equal(readSpec(specs, 'guarantee'), '1 Year')
  })

  it('accepts a value the driver already parsed', () => {
    const specs = normalizeSpecEntries([{ title: 'Colour', description: 'Red' }])
    assert.equal(readSpec(specs, 'Colour'), 'Red')
  })

  it('matches keys ignoring case and the trailing tabs found in the catalog', () => {
    // "material\t" appears 144 times and "guarantee\t" 59 times.
    const specs = normalizeSpecEntries('[{"title":"Material\\t","description":"Ceramic"}]')
    assert.equal(readSpec(specs, 'material'), 'Ceramic')
    assert.equal(readSpec(specs, 'MATERIAL'), 'Ceramic')
    assert.equal(readSpec(specs, 'Material\t'), 'Ceramic')
  })

  it('keeps placeholder values out of the lookup but visible in the entries', () => {
    const specs = normalizeSpecEntries('[{"title":"Guarantee","description":"None"}]')
    assert.equal(readSpec(specs, 'guarantee'), '')
    assert.deepEqual(specs.entries, [{ key: 'Guarantee', value: 'None' }])
  })

  it('lets the first of two whitespace-variant duplicates win', () => {
    const specs = normalizeSpecEntries('[{"title":"Material","description":"Steel"},{"title":"material","description":"Iron"}]')
    assert.equal(readSpec(specs, 'material'), 'Steel')
  })

  it('returns nothing for malformed or empty input instead of throwing', () => {
    for (const value of ['', null, undefined, 'not json', '{', '[]', '{}', 42]) {
      const specs = normalizeSpecEntries(value)
      assert.equal(specs.lookup.size, 0, `expected ${JSON.stringify(value)} to yield no specs`)
    }
  })

  it('parseJsonColumn passes objects through and swallows syntax errors', () => {
    assert.deepEqual(parseJsonColumn({ a: 1 }), { a: 1 })
    assert.equal(parseJsonColumn('{bad'), null)
    assert.equal(parseJsonColumn('   '), null)
  })
})

describe('toAmazonUnit', () => {
  it('maps website weight tokens onto the template vocabulary', () => {
    assert.equal(toAmazonUnit('kg', 'weight'), 'Kilograms')
    assert.equal(toAmazonUnit('KG', 'weight'), 'Kilograms')
    assert.equal(toAmazonUnit('kgs', 'weight'), 'Kilograms')
    assert.equal(toAmazonUnit('gram', 'weight'), 'Grams')
    assert.equal(toAmazonUnit('lb', 'weight'), 'Pounds')
  })

  it('maps length and volume tokens, including the ones the catalog actually uses', () => {
    assert.equal(toAmazonUnit('cm', 'length'), 'Centimeters')
    assert.equal(toAmazonUnit('CM', 'length'), 'Centimeters')
    assert.equal(toAmazonUnit('inch', 'length'), 'Inches')
    assert.equal(toAmazonUnit('"', 'length'), 'Inches')
    // The only capacity tokens in the catalog are l, liter and ml.
    assert.equal(toAmazonUnit('l', 'volume'), 'Liters')
    assert.equal(toAmazonUnit('liter', 'volume'), 'Liters')
    assert.equal(toAmazonUnit('ml', 'volume'), 'Milliliters')
  })

  it('ignores stray spaces and full stops in the token', () => {
    assert.equal(toAmazonUnit(' k g ', 'weight'), 'Kilograms')
    assert.equal(toAmazonUnit('c.m.', 'length'), 'Centimeters')
  })

  it('returns null for a token it does not recognise rather than guessing', () => {
    assert.equal(toAmazonUnit('stones', 'weight'), null)
    assert.equal(toAmazonUnit('furlongs', 'length'), null)
    assert.equal(toAmazonUnit('', 'weight'), null)
  })

  it('throws for an unknown dimension, so a typo cannot silently disable conversion', () => {
    assert.throws(() => toAmazonUnit('kg', 'capacity'), /Unknown measurement dimension/)
  })
})

describe('parseMeasurement', () => {
  it('splits a value and unit and maps the unit', () => {
    assert.deepEqual(parseMeasurement('2.5 KG', 'weight'), { ok: true, value: 2.5, unit: 'Kilograms', raw: '2.5 KG' })
    assert.deepEqual(parseMeasurement('16cm', 'length'), { ok: true, value: 16, unit: 'Centimeters', raw: '16cm' })
  })

  it('reads the capacity spellings the catalog uses', () => {
    for (const [input, value, unit] of [
      ['0.4 L', 0.4, 'Liters'],
      ['12L', 12, 'Liters'],
      ['1 Liter', 1, 'Liters'],
      ['200ml', 200, 'Milliliters'],
    ]) {
      const result = parseMeasurement(input, 'volume')
      assert.equal(result.ok, true, `expected ${input} to parse`)
      assert.equal(result.value, value)
      assert.equal(result.unit, unit)
    }
  })

  it('rejects a bare number, because Amazon needs the unit in its own cell', () => {
    assert.deepEqual(parseMeasurement('2.5', 'weight'), { ok: false, reason: 'missing-unit', raw: '2.5' })
  })

  it('rejects an unknown unit rather than defaulting one', () => {
    assert.equal(parseMeasurement('2.5 stones', 'weight').reason, 'unknown-unit')
  })

  it('rejects compound and ranged values that cannot go in one cell', () => {
    for (const value of ['2-3 kg', '1 kg / 2 kg', '2 kg, 3 kg', '1.0 L (18x17x17 CM) / 1.5 L', '100ML (2 pcs)']) {
      assert.equal(parseMeasurement(value, 'weight').ok, false, `expected ${value} to be rejected`)
    }
  })

  it('rejects a comma decimal separator, which is ambiguous against a thousands separator', () => {
    assert.equal(parseMeasurement('2,5 kg', 'weight').ok, false)
  })

  it('rejects zero and negative values', () => {
    assert.equal(parseMeasurement('0 kg', 'weight').reason, 'non-positive-number')
    assert.equal(parseMeasurement('-1 kg', 'weight').ok, false)
  })

  it('reports empty input as empty rather than as a parse failure', () => {
    assert.equal(parseMeasurement('', 'weight').reason, 'empty')
    assert.equal(parseMeasurement(null, 'weight').reason, 'empty')
  })
})

describe('parsePackageDimensions', () => {
  it('reads an unlabelled triple with a trailing unit as length, width, height', () => {
    const result = parsePackageDimensions('30 x 20 x 10 cm')
    assert.equal(result.ok, true)
    assert.equal(result.length, 30)
    assert.equal(result.width, 20)
    assert.equal(result.height, 10)
    assert.equal(result.unit, 'Centimeters')
    assert.equal(result.axisLabelled, false)
  })

  it('honours axis labels rather than position, including the catalog L*H*W order', () => {
    const result = parsePackageDimensions('33Lx24.6Hx14W cm')
    assert.equal(result.ok, true)
    assert.deepEqual(
      { length: result.length, width: result.width, height: result.height },
      { length: 33, width: 14, height: 24.6 }
    )
    assert.equal(result.axisLabelled, true)
  })

  it('accepts a parenthesised trailing unit, as in 32L*45H*36W (CM)', () => {
    const result = parsePackageDimensions('32L*45H*36W (CM)')
    assert.equal(result.ok, true)
    assert.deepEqual(
      { length: result.length, width: result.width, height: result.height, unit: result.unit },
      { length: 32, width: 36, height: 45, unit: 'Centimeters' }
    )
  })

  it('accepts the *, x and X separators and per-part units', () => {
    assert.equal(parsePackageDimensions('30cm*20cm*10cm').unit, 'Centimeters')
    assert.equal(parsePackageDimensions('12X8X4 inch').unit, 'Inches')
    assert.equal(parsePackageDimensions('30 × 20 × 10 cm').unit, 'Centimeters')
  })

  it('rejects a compound string that lists several products', () => {
    const result = parsePackageDimensions('1.0 L (18x17x17 CM) / 1.5 L (18.5x17x17.5 CM)')
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'compound-value')
  })

  it('rejects mixed units, a missing unit, or the wrong number of axes', () => {
    assert.equal(parsePackageDimensions('30cm x 20inch x 10cm').reason, 'inconsistent-units')
    assert.equal(parsePackageDimensions('30 x 20 x 10').reason, 'missing-unit')
    assert.equal(parsePackageDimensions('30 x 20 cm').reason, 'incomplete-dimensions')
    assert.equal(parsePackageDimensions('30 x 20 x 10 x 5 cm').reason, 'compound-value')
  })

  it('rejects duplicated or partial axis labels instead of assuming an order', () => {
    assert.equal(parsePackageDimensions('30L x 20L x 10H cm').ok, false)
    assert.equal(parsePackageDimensions('30L x 20 x 10H cm').reason, 'partially-labelled-axes')
  })
})

describe('parseCount', () => {
  it('reads the plain integers the catalog stores for piece counts', () => {
    // Every "pieces" value in the catalog is a bare integer.
    for (const [input, expected] of [['12', 12], ['29', 29], ['78', 78], ['8', 8], [' 4 ', 4]]) {
      assert.equal(parseCount(input).value, expected)
    }
  })

  it('rejects anything that needs interpretation, so no count is invented', () => {
    for (const value of ['3-5', '2 + 1', 'many', '3.5', '3 pcs', 'Set of 5', '3 Pan Set', '23PCS']) {
      assert.equal(parseCount(value).ok, false, `expected ${JSON.stringify(value)} to be rejected`)
    }
  })

  it('rejects zero, negatives and blanks', () => {
    assert.equal(parseCount('0').reason, 'non-positive-number')
    assert.equal(parseCount('-2').ok, false)
    assert.equal(parseCount('').reason, 'empty')
  })
})
