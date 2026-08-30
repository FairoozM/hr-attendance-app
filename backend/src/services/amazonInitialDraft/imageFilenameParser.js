'use strict'

/**
 * Filename parsing and exact-SKU matching for approved Amazon marketplace images.
 *
 * The content team's convention, confirmed against the approved S3 batch:
 *
 *   1. LIFESMILE_LIFEP29_LIFEP29-6-2_WEBSITE_Main.jpg
 *   1. LIFESMILE_LIFEP29_LIFEP29-6-2_WEBSITE_1.jpg
 *
 * `LIFESMILE` is branding, `LIFEP29` is the family code, `LIFEP29-6-2` is the seller SKU,
 * `WEBSITE` is naming metadata and the final token is the Amazon image position. The
 * leading `1. ` is a manual sort prefix and means nothing.
 *
 * Two rules matter more than the rest:
 *
 *   - Position comes from the filename, never from S3 listing order, upload time or
 *     alphabetical order. `Main, 1, 2, 4` stays `Main, 1, 2, 4`.
 *   - A SKU is only matched when it equals a whole underscore-delimited segment of the
 *     filename. Substring matching would let the family code `LIFEP29` claim an image
 *     that belongs to `LIFEP29-6-2`, and would let `NSEL` claim an `NSEL-20` image. When
 *     several workbook SKUs match, the longest wins, so a child SKU always beats the
 *     family code it starts with.
 *
 * Adding a further consistent naming convention means adding a marker to
 * `POSITION_MARKERS`; nothing else here needs to change.
 */

/** Amazon UAE flat files expose one main image plus eight numbered secondary slots. */
const MAX_SECONDARY_POSITION = 8

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg'])

/** A manual ordering prefix such as `1. ` or `12.` that is not part of the SKU. */
const SORT_PREFIX = /^\s*\d+\s*[.)-]\s*/

/**
 * Ways the position token can be introduced, tried in order. Each entry captures the
 * token in group 1 and must be anchored to the end of the base name.
 */
const POSITION_MARKERS = [
  { name: 'website-suffix', pattern: /_WEBSITE_([A-Za-z0-9]+)$/i },
  { name: 'bare-suffix', pattern: /_(MAIN|0?[1-9]|1[0-9])$/i },
]

function cleanText(value) {
  return String(value == null ? '' : value).trim()
}

/** `a/b/c.jpg` → `c.jpg`. Handles both separators; S3 keys use `/`. */
function basename(key) {
  const text = cleanText(key)
  const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  return cut === -1 ? text : text.slice(cut + 1)
}

function splitExtension(filename) {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return { base: filename, extension: '' }
  return { base: filename.slice(0, dot), extension: filename.slice(dot).toLowerCase() }
}

/**
 * `Main` → the main image, `1`..`8` → that secondary slot. A leading zero is tolerated
 * because `_01` and `_1` mean the same thing to a person naming files.
 */
function readPositionToken(token) {
  const text = cleanText(token)
  if (!text) return null
  if (text.toUpperCase() === 'MAIN') {
    return { kind: 'main', number: 0, slot: 'MAIN', label: 'Main', token: text }
  }
  if (!/^\d{1,2}$/.test(text)) return null

  const number = Number(text)
  if (!Number.isInteger(number) || number < 1) return null
  return {
    kind: 'secondary',
    number,
    slot: `PT${String(number).padStart(2, '0')}`,
    label: String(number),
    token: text,
  }
}

function splitSegments(baseName) {
  return baseName
    .split('_')
    .map((part) => cleanText(part))
    .filter(Boolean)
}

/**
 * Splits the base name into the underscore segments a SKU may equal. Contiguous runs are
 * joined too, so a SKU that itself contains an underscore can still match exactly.
 */
function candidateSegments(baseName) {
  const parts = splitSegments(baseName)

  const segments = new Set()
  for (let start = 0; start < parts.length; start += 1) {
    let joined = parts[start]
    segments.add(joined)
    for (let end = start + 1; end < parts.length; end += 1) {
      joined = `${joined}_${parts[end]}`
      segments.add(joined)
    }
  }
  return segments
}

/**
 * The segment runs that end the name. In the approved convention the SKU is the token
 * immediately before the position marker, so these are the trustworthy candidates:
 * `LIFESMILE_NSEL_NSEL-20` offers `NSEL-20`, then `NSEL_NSEL-20`, then the whole string —
 * and never the bare family token `NSEL`.
 */
function suffixSegments(baseName) {
  const parts = splitSegments(baseName)
  const runs = new Set()
  for (let start = parts.length - 1; start >= 0; start -= 1) {
    runs.add(parts.slice(start).join('_'))
  }
  return runs
}

/**
 * @param {string} key S3 key or bare filename
 * @returns {{
 *   key: string, filename: string, baseName: string, extension: string,
 *   skuText: string, position: object|null, positionToken: string,
 *   ok: boolean, reason: string|null,
 * }}
 */
function parseImageFilename(key) {
  const filename = basename(key)
  const { base, extension } = splitExtension(filename)
  const withoutSortPrefix = base.replace(SORT_PREFIX, '')

  const parsed = {
    key: cleanText(key),
    filename,
    baseName: base,
    extension,
    skuText: withoutSortPrefix,
    position: null,
    positionToken: '',
    ok: false,
    reason: null,
  }

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    parsed.reason = 'unsupported-file'
    return parsed
  }

  let markerMatch = null
  for (const marker of POSITION_MARKERS) {
    const match = withoutSortPrefix.match(marker.pattern)
    if (match) {
      markerMatch = { marker, match }
      break
    }
  }

  if (!markerMatch) {
    parsed.reason = 'position-marker-not-found'
    return parsed
  }

  parsed.positionToken = markerMatch.match[1]
  parsed.skuText = withoutSortPrefix.slice(0, markerMatch.match.index)

  const position = readPositionToken(markerMatch.match[1])
  if (!position) {
    parsed.reason = 'unsupported-position'
    return parsed
  }
  if (position.kind === 'secondary' && position.number > MAX_SECONDARY_POSITION) {
    parsed.position = position
    parsed.reason = 'unsupported-position'
    return parsed
  }

  parsed.position = position
  parsed.ok = true
  return parsed
}

/**
 * Matches the filename against the workbook's own SKUs — the authoritative candidate set.
 *
 * @param {string} skuText the filename with sort prefix and position marker removed
 * @param {string[]} workbookSkus seller SKUs exactly as they appear in the workbook
 * @returns {{ status: 'matched'|'unmatched'|'ambiguous', sku: string, candidates: string[] }}
 */
function matchWorkbookSku(skuText, workbookSkus) {
  const text = cleanText(skuText)
  const skus = (Array.isArray(workbookSkus) ? workbookSkus : []).map((sku) => cleanText(sku)).filter(Boolean)
  if (!text || !skus.length) return { status: 'unmatched', sku: '', candidates: [] }

  const matchAgainst = (runs) => {
    const lowered = new Set([...runs].map((run) => run.toLowerCase()))
    return skus.filter((sku) => lowered.has(sku.toLowerCase()))
  }

  // Preferred reading: the SKU is the token immediately before the position marker.
  let matches = matchAgainst(suffixSegments(text))

  if (!matches.length) {
    // Fallback for a name that carries trailing metadata after the SKU. A candidate that
    // is only the start of another token in the same name is rejected, so `NSEL` can never
    // stand in for `NSEL-20`.
    const segments = splitSegments(text)
    matches = matchAgainst(candidateSegments(text)).filter((sku) => {
      const lower = sku.toLowerCase()
      return !segments.some((segment) => {
        const candidate = segment.toLowerCase()
        return candidate !== lower && candidate.startsWith(lower)
      })
    })
  }

  if (!matches.length) return { status: 'unmatched', sku: '', candidates: [] }

  // Longest exact match wins: a child SKU must beat the family code it begins with.
  let longest = 0
  for (const sku of matches) longest = Math.max(longest, sku.length)
  const best = matches.filter((sku) => sku.length === longest)

  // Two different SKUs of equal length both matching is a genuine ambiguity, never a guess.
  const distinct = [...new Set(best.map((sku) => sku.toLowerCase()))]
  if (distinct.length > 1) {
    return { status: 'ambiguous', sku: '', candidates: best.sort() }
  }

  return { status: 'matched', sku: best[0], candidates: [...new Set(matches)].sort() }
}

/**
 * Parses and matches one S3 key in a single step.
 *
 * @param {string} key
 * @param {string[]} workbookSkus
 */
function resolveImageKey(key, workbookSkus) {
  const parsed = parseImageFilename(key)
  if (!parsed.ok) {
    return {
      ...parsed,
      sku: '',
      matchStatus: parsed.reason === 'unsupported-file' ? 'unsupported-file' : 'unsupported-position',
      candidates: [],
    }
  }

  const match = matchWorkbookSku(parsed.skuText, workbookSkus)
  if (match.status === 'ambiguous') {
    return { ...parsed, sku: '', matchStatus: 'ambiguous-sku', candidates: match.candidates }
  }
  if (match.status === 'unmatched') {
    return { ...parsed, sku: '', matchStatus: 'unmatched-filename', candidates: [] }
  }
  return { ...parsed, sku: match.sku, matchStatus: 'matched', candidates: match.candidates }
}

module.exports = {
  MAX_SECONDARY_POSITION,
  POSITION_MARKERS,
  SUPPORTED_EXTENSIONS,
  candidateSegments,
  matchWorkbookSku,
  parseImageFilename,
  resolveImageKey,
  suffixSegments,
}
