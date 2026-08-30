'use strict'

/**
 * Maps the image positions found in filenames onto the image columns the uploaded
 * workbook actually declares.
 *
 * Column letters are never assumed. The technical header decides everything: the main
 * image locator becomes position `Main`, and each numbered secondary locator becomes the
 * position in its `#N` qualifier. Reading the number from `#N` rather than from the slot
 * order is what keeps a gap a gap — a template declaring `#1, #2, #4` must not quietly
 * shift image 4 into position 3.
 *
 * Swatch, parent and any other image-shaped column stays out of scope: it is reported,
 * never written.
 */

const MAIN_IMAGE_PATTERNS = [/^main_product_image_locator/i, /^main_image_url/i, /^main_offer_image/i]

const SECONDARY_IMAGE_PATTERNS = [
  /^other_product_image_locator/i,
  /^other_image_url/i,
  /^other_offer_image/i,
]

/** Image columns this feature deliberately leaves alone. */
const OUT_OF_SCOPE_IMAGE_PATTERNS = [
  { pattern: /swatch/i, reason: 'swatch-image-out-of-scope' },
  { pattern: /parent/i, reason: 'parent-image-out-of-scope' },
]

function matchesAny(patterns, technicalHeader) {
  return patterns.some((pattern) => pattern.test(technicalHeader))
}

/** `other_product_image_locator#4.media_location` → 4 */
function readSlotNumber(technicalHeader) {
  const match = String(technicalHeader || '').match(/#(\d+)/)
  if (!match) return null
  const number = Number(match[1])
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
