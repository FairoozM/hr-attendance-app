'use strict'

/**
 * Filename parsing and exact-SKU matching for approved Amazon marketplace images.
 *
 * Filenames come from a fixed macOS Quick Action and are never renamed by hand, so the
 * convention below is permanent:
 *
 *   CONTENT_{SKU-WITH-UNDERSCORE-BEFORE-COLOUR}_{CHANNEL}_{POSITION}.jpg
 *
 *   CONTENT_LIFEP17S-16P_BEIGE_WEBSITE_Main.jpg
 *   CONTENT_LIFEP17-MIX-19-1_BEIGE_WEBSITE_3.jpg
 *
 * The earlier convention is still supported:
 *
 *   1. LIFESMILE_LIFEP29_LIFEP29-6-2_WEBSITE_Main.jpg
 *
 * Three rules matter more than the rest:
 *
 *   - Position comes from the filename, never from S3 listing order, upload time or
 *     alphabetical order. `Main, 1, 2, 4` stays `Main, 1, 2, 4`.
 *   - A SKU is only matched when it equals a whole underscore-delimited run that *ends*
 *     the identity area. That is what stops the family code `LIFEP29` claiming an image
 *     belonging to `LIFEP29-6-2`, and stops the parent `LIFEP17S-16P` claiming the
 *     colour-specific `LIFEP17S-16P_BEIGE`. When several identities match, the longest
 *     wins, so a child SKU always beats the family code it starts with.
 *   - The Quick Action rewrites exactly one character: the separator immediately before
 *     the colour. `LIFEP17S-16P-BEIGE` is written `LIFEP17S-16P_BEIGE`. That single
 *     controlled alias is generated from the *verified* variant colour, so internal
 *     hyphens such as those in `LIFEP17-MIX-19-1` are never touched. Underscores and
 *     hyphens are not interchangeable anywhere else.
 */

/** Amazon UAE flat files expose one main image plus eight numbered secondary slots. */
const MAX_SECONDARY_POSITION = 8

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg'])

/** A manual ordering prefix such as `1. ` or `12.` that is not part of the SKU. */
const SORT_PREFIX = /^\s*\d+\s*[.)-]\s*/

/** Sales channels the Quick Action stamps into the name. */
const CHANNEL = {
  WEBSITE: 'WEBSITE',
  NOON: 'NOON',
  /** Older names carry no channel token at all. */
  UNSPECIFIED: '',
}

/**
 * `_WEBSITE_Main`, and the punctuation artifacts the Quick Action can leave behind:
 * `_WEBSITE__Main`, `_WEBSITE_._Main`, `_WEBSITE_-._Main`. The run of punctuation is
 * captured so a clean suffix can be preferred over a normalized one, and the cleanup is
 * confined to this narrow area after the channel — it never touches the SKU identity.
 */
const CHANNEL_SUFFIX = /_(WEBSITE|NOON)([_.\-]+)([A-Za-z0-9]+)$/i

/** Legacy names with no channel token, e.g. `NSEL-20_Main`. */
const BARE_SUFFIX = /_(MAIN|0?[1-9]|1[0-9])$/i

/** A suffix separator of exactly one underscore is the clean, preferred form. */
const CLEAN_SEPARATOR = '_'

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
 *   channel: string, suffixQuality: 'clean'|'normalized'|'', suffixSeparator: string,
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
    channel: CHANNEL.UNSPECIFIED,
    suffixQuality: '',
    suffixSeparator: '',
    ok: false,
    reason: null,
  }

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    parsed.reason = 'unsupported-file'
    return parsed
  }

  const channelMatch = withoutSortPrefix.match(CHANNEL_SUFFIX)
  const bareMatch = channelMatch ? null : withoutSortPrefix.match(BARE_SUFFIX)

  if (channelMatch) {
    parsed.channel = channelMatch[1].toUpperCase()
    parsed.suffixSeparator = channelMatch[2]
    parsed.suffixQuality = channelMatch[2] === CLEAN_SEPARATOR ? 'clean' : 'normalized'
    parsed.positionToken = channelMatch[3]
    parsed.skuText = withoutSortPrefix.slice(0, channelMatch.index)
  } else if (bareMatch) {
    parsed.suffixSeparator = CLEAN_SEPARATOR
    parsed.suffixQuality = 'clean'
    parsed.positionToken = bareMatch[1]
    parsed.skuText = withoutSortPrefix.slice(0, bareMatch.index)
  } else {
    parsed.reason = 'position-marker-not-found'
    return parsed
  }

  const position = readPositionToken(parsed.positionToken)
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

function normalizeColourToken(value) {
  return String(value == null ? '' : value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
}

/**
 * The single controlled alias the Quick Action produces: only the separator immediately
 * before the *verified* colour becomes an underscore.
 *
 *   LIFEP17S-16P-BEIGE     + colour BEIGE → LIFEP17S-16P_BEIGE
 *   LIFEP17-MIX-19-1-BEIGE + colour BEIGE → LIFEP17-MIX-19-1_BEIGE
 *   LIFEP17-MIX-19-1       + colour BEIGE → '' (no trailing colour, nothing is rewritten)
 *
 * Returns an empty string when the colour is unknown or the SKU does not end with it, so
 * an unverified colour can never cause a rewrite.
 *
 * @param {string} sku the authoritative seller SKU from the workbook
 * @param {string} colour the variant colour from the exact catalog match
 */
function colourSeparatorAlias(sku, colour) {
  const text = cleanText(sku)
  const wanted = normalizeColourToken(colour)
  if (!text || !wanted) return ''

  const parts = text.split('-')
  if (parts.length < 2) return ''

  // A colour can span more than one hyphenated token, e.g. `-LIGHT-BLUE` for "Light Blue".
  const maxTokens = Math.min(4, parts.length - 1)
  for (let count = 1; count <= maxTokens; count += 1) {
    const tail = parts.slice(parts.length - count)
    if (normalizeColourToken(tail.join('')) !== wanted) continue

    const head = parts.slice(0, parts.length - count).join('-')
    if (!head) return ''
    return `${head}_${tail.join('-')}`
  }

  return ''
}

function readColour(colours, sku) {
  if (!colours) return ''
  if (typeof colours.get === 'function') {
    return cleanText(colours.get(sku) || colours.get(String(sku).toLowerCase()) || '')
  }
  return cleanText(colours[sku] || colours[String(sku).toLowerCase()] || '')
}

/**
 * The names each workbook SKU may legitimately appear under: the SKU itself, plus its one
 * controlled colour alias when the variant colour is known and confirmed as the SKU's
 * trailing token. The real seller SKU is carried alongside so it is preserved unchanged
 * everywhere the match is used.
 *
 * @param {string[]} workbookSkus
 * @param {Map<string,string>|Record<string,string>} [coloursBySku]
 * @returns {Array<{ sku: string, identity: string, kind: 'exact'|'colour-alias', colour: string }>}
 */
function buildSkuIdentities(workbookSkus, coloursBySku) {
  const identities = []
  const seen = new Set()

  for (const raw of Array.isArray(workbookSkus) ? workbookSkus : []) {
    const sku = cleanText(raw)
    if (!sku) continue
    const key = sku.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    identities.push({ sku, identity: sku, kind: 'exact', colour: '' })

    const colour = readColour(coloursBySku, sku)
    const alias = colourSeparatorAlias(sku, colour)
    if (alias && alias.toLowerCase() !== key) {
      identities.push({ sku, identity: alias, kind: 'colour-alias', colour })
    }
  }

  return identities
}

/** Accepts either a plain SKU list or a prepared identity list. */
function toIdentities(workbookSkusOrIdentities, coloursBySku) {
  const input = Array.isArray(workbookSkusOrIdentities) ? workbookSkusOrIdentities : []
  if (input.length && typeof input[0] === 'object' && input[0] !== null) return input
  return buildSkuIdentities(input, coloursBySku)
}

/**
 * Matches the filename against the workbook's own SKUs — the authoritative candidate set.
 *
 * Only runs that *end* the identity area are considered. `CONTENT_LIFEP17S-16P_BEIGE`
 * offers `BEIGE`, `LIFEP17S-16P_BEIGE` and the whole string, but never the bare
 * `LIFEP17S-16P`, so a parent SKU cannot take a colour-specific child's image.
 *
 * @param {string} skuText the filename with sort prefix and position suffix removed
 * @param {string[]|Array<object>} workbookSkusOrIdentities SKUs, or prepared identities
 * @param {Map<string,string>|Record<string,string>} [coloursBySku]
 * @returns {{
 *   status: 'matched'|'unmatched'|'ambiguous', sku: string, candidates: string[],
 *   matchedIdentity: string, matchKind: string,
 * }}
 */
function matchWorkbookSku(skuText, workbookSkusOrIdentities, coloursBySku) {
  const text = cleanText(skuText)
  const identities = toIdentities(workbookSkusOrIdentities, coloursBySku).filter(
    (entry) => entry && cleanText(entry.identity) && cleanText(entry.sku)
  )
  const miss = { status: 'unmatched', sku: '', candidates: [], matchedIdentity: '', matchKind: '' }
  if (!text || !identities.length) return miss

  const runs = new Set([...suffixSegments(text)].map((run) => run.toLowerCase()))
  const matches = identities.filter((entry) => runs.has(entry.identity.toLowerCase()))
  if (!matches.length) return miss

  // Longest identity wins: a child SKU must beat the family code it begins with.
  let longest = 0
  for (const entry of matches) longest = Math.max(longest, entry.identity.length)
  const best = matches.filter((entry) => entry.identity.length === longest)

  // Two different SKUs matching equally well is a genuine ambiguity, never a guess.
  const distinctSkus = [...new Set(best.map((entry) => entry.sku.toLowerCase()))]
  if (distinctSkus.length > 1) {
    return {
      status: 'ambiguous',
      sku: '',
      candidates: [...new Set(best.map((entry) => entry.sku))].sort(),
      matchedIdentity: '',
      matchKind: '',
    }
  }

  const winner = best[0]
  return {
    status: 'matched',
    sku: winner.sku,
    candidates: [...new Set(matches.map((entry) => entry.sku))].sort(),
    matchedIdentity: winner.identity,
    matchKind: winner.kind,
  }
}

/**
 * Parses and matches one S3 key in a single step.
 *
 * @param {string} key
 * @param {string[]|Array<object>} workbookSkusOrIdentities
 * @param {Map<string,string>|Record<string,string>} [coloursBySku]
 */
function resolveImageKey(key, workbookSkusOrIdentities, coloursBySku) {
  const parsed = parseImageFilename(key)
  if (!parsed.ok) {
    return {
      ...parsed,
      sku: '',
      matchStatus: parsed.reason === 'unsupported-file' ? 'unsupported-file' : 'unsupported-position',
      candidates: [],
      matchedIdentity: '',
      matchKind: '',
    }
  }

  const match = matchWorkbookSku(parsed.skuText, workbookSkusOrIdentities, coloursBySku)
  if (match.status === 'ambiguous') {
    return { ...parsed, sku: '', matchStatus: 'ambiguous-sku', candidates: match.candidates, matchedIdentity: '', matchKind: '' }
  }
  if (match.status === 'unmatched') {
    return { ...parsed, sku: '', matchStatus: 'unmatched-filename', candidates: [], matchedIdentity: '', matchKind: '' }
  }
  return {
    ...parsed,
    sku: match.sku,
    matchStatus: 'matched',
    candidates: match.candidates,
    matchedIdentity: match.matchedIdentity,
    matchKind: match.matchKind,
  }
}

module.exports = {
  CHANNEL,
  MAX_SECONDARY_POSITION,
  SUPPORTED_EXTENSIONS,
  buildSkuIdentities,
  candidateSegments,
  colourSeparatorAlias,
  matchWorkbookSku,
  parseImageFilename,
  resolveImageKey,
  suffixSegments,
}
