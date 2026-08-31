'use strict'

/**
 * Maps the image positions found in filenames onto the image columns the uploaded
 * workbook actually declares.
 *
 * Column letters are never assumed and neither is column order. The technical header
 * decides everything: the main image locator becomes position `Main`, and a secondary
 * locator takes the number written in its own attribute name, falling back to its `#N`
 * qualifier. The real UAE template numbers the attribute and leaves every qualifier at
 * `#1`:
 *
 *   other_product_image_locator_1[marketplace_id=A2VIGQ35RCS4UG]#1.media_location
 *   other_product_image_locator_8[marketplace_id=A2VIGQ35RCS4UG]#1.media_location
 *
 * while the older shape numbers the qualifier instead:
 *
 *   other_product_image_locator#4.media_location
 *
 * Both are read, because taking the number from the header rather than from the order of
 * appearance is what keeps a gap a gap — a template declaring 1, 2 and 4 must not quietly
 * shift image 4 into position 3.
 *
 * Swatch, parent, the offer-image group and any other image-shaped column stays out of
 * scope: it is reported, never written.
 */

const MAIN_IMAGE_PATTERNS = [/^main_product_image_locator/i, /^main_image_url/i]

const SECONDARY_IMAGE_PATTERNS = [/^other_product_image_locator/i, /^other_image_url/i]

/**
 * Image columns this feature deliberately leaves alone. The offer-image locators are a
 * separate group belonging to the offer rather than the product listing, and they would
 * otherwise compete with the product locators for the same positions.
 */
const OUT_OF_SCOPE_IMAGE_PATTERNS = [
  { pattern: /swatch/i, reason: 'swatch-image-out-of-scope' },
  { pattern: /parent/i, reason: 'parent-image-out-of-scope' },
  { pattern: /offer_image/i, reason: 'offer-image-out-of-scope' },
]

function matchesAny(patterns, technicalHeader) {
  return patterns.some((pattern) => pattern.test(technicalHeader))
}

/**
 * The image position a secondary locator column declares.
 *
 *   other_product_image_locator_4[marketplace_id=…]#1.media_location → 4
 *   other_product_image_locator#4.media_location                     → 4
 *
 * The attribute name wins, because the real template numbers there and leaves every
 * qualifier at `#1`; reading the qualifier first would collapse all eight columns onto
 * position 1 and discard seven of them.
 */
function readSlotNumber(technicalHeader) {
  const header = String(technicalHeader || '')

  // The attribute name is everything before the first marketplace/qualifier bracket.
  const attributeName = header.split(/[[#]/)[0]
  const named = attributeName.match(/_(\d+)$/)
  if (named) {
    const number = Number(named[1])
    if (Number.isInteger(number) && number > 0) return number
  }

  const qualified = header.match(/#(\d+)/)
  if (!qualified) return null
  const number = Number(qualified[1])
  return Number.isInteger(number) && number > 0 ? number : null
}

function isImageColumn(technicalHeader) {
  return /image/i.test(String(technicalHeader || ''))
}

/**
 * Whether this feature is allowed to populate the column. Every other image-shaped
 * column stays a never-write, so swatch and parent image cells behave exactly as before.
 */
function isInScopeImageColumn(technicalHeader) {
  const header = String(technicalHeader || '')
  if (!isImageColumn(header)) return false
  if (OUT_OF_SCOPE_IMAGE_PATTERNS.some((entry) => entry.pattern.test(header))) return false
  return matchesAny(MAIN_IMAGE_PATTERNS, header) || matchesAny(SECONDARY_IMAGE_PATTERNS, header)
}

/**
 * @param {Array<{column:number,letters:string,technicalHeader:string,normalizedKey:string,displayLabel:string,groupLabel:string}>} columns
 * @returns {{
 *   main: object|null,
 *   secondary: Map<number, object>,
 *   outOfScope: Array<{ column: object, reason: string }>,
 *   supportedSecondaryPositions: number[],
 * }}
 */
function buildImageColumnMap(columns) {
  const map = { main: null, secondary: new Map(), outOfScope: [], supportedSecondaryPositions: [] }

  // Secondary columns without a `#N` qualifier fall back to their order of appearance.
  const secondaryWithoutNumber = []

  for (const column of Array.isArray(columns) ? columns : []) {
    const header = String(column.technicalHeader || '')
    if (!isImageColumn(header)) continue

    const outOfScope = OUT_OF_SCOPE_IMAGE_PATTERNS.find((entry) => entry.pattern.test(header))
    if (outOfScope) {
      map.outOfScope.push({ column, reason: outOfScope.reason })
      continue
    }

    if (matchesAny(MAIN_IMAGE_PATTERNS, header)) {
      // A template repeating the main locator gives the first declared column the position.
      if (!map.main) map.main = column
      else map.outOfScope.push({ column, reason: 'duplicate-main-image-column' })
      continue
    }

    if (matchesAny(SECONDARY_IMAGE_PATTERNS, header)) {
      const slot = readSlotNumber(header)
      if (slot === null) secondaryWithoutNumber.push(column)
      else if (!map.secondary.has(slot)) map.secondary.set(slot, column)
      else map.outOfScope.push({ column, reason: 'duplicate-secondary-image-column' })
      continue
    }

    map.outOfScope.push({ column, reason: 'unrecognised-image-column' })
  }

  if (secondaryWithoutNumber.length) {
    let next = 1
    for (const column of secondaryWithoutNumber.sort((a, b) => a.column - b.column)) {
      while (map.secondary.has(next)) next += 1
      map.secondary.set(next, column)
      next += 1
    }
  }

  map.supportedSecondaryPositions = [...map.secondary.keys()].sort((a, b) => a - b)
  return map
}

/**
 * The workbook column for one filename position, or null when the template has no such
 * slot. A missing slot is reported as `unsupported-position`; images are never renumbered
 * to fit.
 *
 * @param {ReturnType<typeof buildImageColumnMap>} imageColumns
 * @param {{ kind: 'main'|'secondary', number: number }} position
 */
function columnForPosition(imageColumns, position) {
  if (!imageColumns || !position) return null
  if (position.kind === 'main') return imageColumns.main || null
  return imageColumns.secondary.get(position.number) || null
}

module.exports = {
  MAIN_IMAGE_PATTERNS,
  OUT_OF_SCOPE_IMAGE_PATTERNS,
  SECONDARY_IMAGE_PATTERNS,
  buildImageColumnMap,
  columnForPosition,
  isImageColumn,
  isInScopeImageColumn,
  readSlotNumber,
}
