'use strict'

/**
 * Deterministic readers for the website's semi-structured catalog columns.
 *
 * Two rules govern everything here:
 *
 * 1. Both stored JSON shapes are supported. `en_specifications` and `weight_dimensions`
 *    are sometimes an object (`{"Material": "Steel"}`) and sometimes an array of
 *    `{title, description}` pairs. In this catalog the array form is the majority, so
 *    treating either as canonical would drop most rows.
 * 2. Ambiguity is never guessed. Real values include compound strings such as
 *    `1.0 L (18x17x17 CM) / 1.5 L (18.5x17x17.5 CM)` and axis-labelled strings in
 *    non-standard order such as `32L*45H*36W (CM)`. Anything that cannot be read
 *    unambiguously returns a rejection with a reason, and the caller writes nothing.
 */

const { toAmazonUnit } = require('./unitConversion')

/** Keys whose values may be written into the draft. Everything else is report-only. */
const WRITABLE_SPEC_KEYS = new Set(['material', 'guarantee', 'capacity', 'pieces'])

/**
 * Values that record the absence of data rather than data. 21 products store "None" as
 * their guarantee, which must not become a warranty description on a live listing.
 *
 * "No" is deliberately absent: it is a real answer for specs such as "Dishwasher Safe".
 */
const PLACEHOLDER_VALUES = new Set(['n/a', 'na', 'n.a', 'none', 'null', 'undefined', 'nil', 'tbd', '-', '--', '.'])

function isPlaceholder(text) {
  return PLACEHOLDER_VALUES.has(String(text).trim().toLowerCase())
}

const DIMENSION_SEPARATOR = /[*x×]/i

function rejected(reason, raw) {
  return { ok: false, reason, raw: raw === undefined ? null : raw }
}

/** Stored values routinely carry stray tabs, non-breaking spaces and doubled spaces. */
function cleanText(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** pg returns json columns pre-parsed; strings still appear via other callers. */
function parseJsonColumn(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

/**
 * Flattens either stored shape into ordered entries. Keys keep their original spelling
 * for the report and gain a whitespace-stripped lowercase lookup key, because the
 * catalog contains keys such as `"Material\t"` and `"Item Weight   "`.
 */
function normalizeSpecEntries(rawColumn) {
  const parsed = parseJsonColumn(rawColumn)
  const entries = []

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const key = cleanText(item.title ?? item.key ?? item.name)
      const value = cleanText(item.description ?? item.value)
      if (key) entries.push({ key, value })
    }
  } else if (parsed && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed)) {
      const cleanKey = cleanText(key)
      if (cleanKey) entries.push({ key: cleanKey, value: cleanText(value) })
    }
  }

  // `entries` keeps everything for the report; `lookup` feeds the draft, so placeholder
  // values are excluded from it.
  const lookup = new Map()
  for (const entry of entries) {
    const lookupKey = entry.key.toLowerCase()
    // First occurrence wins; duplicates differ only by stray whitespace in practice.
    if (!lookup.has(lookupKey) && entry.value && !isPlaceholder(entry.value)) lookup.set(lookupKey, entry.value)
  }

  return { entries, lookup }
}

function readSpec(specs, key) {
  if (!specs || !specs.lookup) return ''
  // The query key is normalised the same way the stored keys were, so a caller passing
  // a key copied verbatim out of the catalog still matches.
  return specs.lookup.get(cleanText(key).toLowerCase()) || ''
}

/**
 * Reads a single `<number> <unit>` measurement.
 * Compound values (`1.0L + 2.0L`, `1.0 L / 1.5 L`, `100ML (2 pcs)`) are rejected.
 */
function parseMeasurement(rawValue, dimension) {
  const text = cleanText(rawValue)
  if (!text) return rejected('empty')

  if (/[/+,]/.test(text)) return rejected('compound-value', text)
  if (/\(|\)/.test(text)) return rejected('compound-value', text)

  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z"']+)?$/.exec(text)
  if (!match) return rejected('unrecognised-format', text)

  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return rejected('non-positive-number', text)
  if (!match[2]) return rejected('missing-unit', text)

  const unit = toAmazonUnit(match[2], dimension)
  if (!unit) return rejected('unknown-unit', text)

  return { ok: true, value, unit, raw: text }
}

/**
 * Splits a package-dimensions string into length, width and height.
 *
 * Accepts the plain `L*W*H UNIT` form in Amazon's own axis order, and the explicitly
 * labelled form (`32L*45H*36W (CM)`) where the stored order is *not* L-W-H and the
 * labels are the only reliable signal. Everything else is rejected.
 */
function parsePackageDimensions(rawValue) {
  const text = cleanText(rawValue)
  if (!text) return rejected('empty')

  // A trailing parenthesised unit is the one bracket form that is unambiguous.
  const bracketUnit = /^(.*?)\(\s*([A-Za-z"']+)\s*\)\s*$/.exec(text)
  let body = text
  let trailingUnit = null
  if (bracketUnit) {
    body = bracketUnit[1].trim()
    trailingUnit = bracketUnit[2]
  }

  // Any remaining bracket, slash or plus means several products or nested measurements.
  if (/[()/+]/.test(body)) return rejected('compound-value', text)

  const parts = body.split(DIMENSION_SEPARATOR).map((part) => part.trim()).filter(Boolean)
  if (parts.length !== 3) return rejected(parts.length < 3 ? 'incomplete-dimensions' : 'compound-value', text)

  const axes = []
  let inlineUnit = null

  for (const part of parts) {
    // Spaces inside a component carry no meaning: `14W cm` is one axis, label and unit.
    const match = /^([0-9]+(?:\.[0-9]+)?)([A-Za-z"']*)$/.exec(part.replace(/\s+/g, ''))
    if (!match) return rejected('unrecognised-format', text)

    const value = Number(match[1])
    if (!Number.isFinite(value) || value <= 0) return rejected('non-positive-number', text)

    let suffix = match[2] || ''
    let axis = null
    // A single leading L/W/H before the unit labels the axis: `24.6Hx`, `36W`, `32L`.
    const labelled = /^([LWH])(.*)$/i.exec(suffix)
    if (labelled && (labelled[2] === '' || toAmazonUnit(labelled[2], 'length'))) {
      axis = labelled[1].toUpperCase()
      suffix = labelled[2]
    }

    if (suffix) {
      const unit = toAmazonUnit(suffix, 'length')
      if (!unit) return rejected('unknown-unit', text)
      if (inlineUnit && inlineUnit !== unit) return rejected('inconsistent-units', text)
      inlineUnit = unit
    }

    axes.push({ value, axis })
  }

  const labelledCount = axes.filter((axis) => axis.axis).length
  let ordered
  if (labelledCount === 3) {
    const byAxis = new Map(axes.map((axis) => [axis.axis, axis.value]))
    if (byAxis.size !== 3) return rejected('duplicate-axis-labels', text)
    ordered = { length: byAxis.get('L'), width: byAxis.get('W'), height: byAxis.get('H') }
  } else if (labelledCount === 0) {
    ordered = { length: axes[0].value, width: axes[1].value, height: axes[2].value }
  } else {
    return rejected('partially-labelled-axes', text)
  }

  let unit = inlineUnit
  if (trailingUnit) {
    const resolved = toAmazonUnit(trailingUnit, 'length')
    if (!resolved) return rejected('unknown-unit', text)
    if (unit && unit !== resolved) return rejected('inconsistent-units', text)
    unit = resolved
  }
  if (!unit) return rejected('missing-unit', text)

  return { ok: true, ...ordered, unit, raw: text, axisLabelled: labelledCount === 3 }
}

/** A plain positive integer count. `23PCS` and `3 Pan Set` are rejected. */
function parseCount(rawValue) {
  const text = cleanText(rawValue)
  if (!text) return rejected('empty')
  const match = /^([0-9]{1,6})$/.exec(text)
  if (!match) return rejected('unrecognised-format', text)
  const value = Number(match[1])
  if (!Number.isInteger(value) || value <= 0) return rejected('non-positive-number', text)
  return { ok: true, value, raw: text }
}

const BLOCK_BOUNDARY = /<\/(?:p|div|li|ul|ol|h[1-6]|tr|table|section)\s*>|<br\s*\/?>/gi
const HTML_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
  ['ndash', '\u2013'],
  ['mdash', '\u2014'],
  ['hellip', '\u2026'],
  ['deg', '\u00b0'],
  ['reg', '\u00ae'],
  ['trade', '\u2122'],
  ['copy', '\u00a9'],
])

/**
 * Removes markup and decodes entities. Block boundaries become line breaks so bullet
 * lists stay readable; no word is added, removed, reordered or rewritten.
 */
function stripHtml(html) {
  if (html === null || html === undefined) return ''
  let text = String(html)

  text = text.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
  text = text.replace(BLOCK_BOUNDARY, '\n')
  text = text.replace(/<[^>]*>/g, '')

  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
  text = text.replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
  text = text.replace(/&([a-zA-Z]+);/g, (whole, name) => {
    const decoded = HTML_ENTITIES.get(name.toLowerCase())
    return decoded === undefined ? whole : decoded
  })

  return text
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

const LIST_ITEM_PATTERN = /<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi

/**
 * Reads the ordered list items out of a stored HTML fragment.
 *
 * The website stores each product's feature list as a `<ul>` of `<li>` elements in
 * `short_description`, so document order is the authoring order and is kept exactly.
 * Each item is unwrapped to its own text: markup is removed, entities are decoded and
 * anchors collapse to their link text. No item is reworded, merged, split or dropped for
 * content, and nothing is added.
 */
function extractListItems(html) {
  if (html === null || html === undefined) return []

  const source = String(html).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
  const items = []

  for (const match of source.matchAll(LIST_ITEM_PATTERN)) {
    // A <br> inside one item is a line break within that feature, not a new feature.
    const text = cleanText(stripHtml(match[1]).replace(/\n+/g, ' '))
    if (text && !isPlaceholder(text)) items.push(text)
  }

  return items
}

/** Returns the first value that is genuinely present, skipping blanks and placeholders. */
function firstNonBlank(...values) {
  for (const value of values) {
    const text = cleanText(value)
    if (text && !isPlaceholder(text)) return text
  }
  return ''
}

module.exports = {
  PLACEHOLDER_VALUES,
  WRITABLE_SPEC_KEYS,
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
}
