const COLORS = [
  'AQUA',
  'ASH',
  'BABY',
  'BEIGE',
  'BLACK',
  'BLUE',
  'BRONZE',
  'BROWN',
  'BURGUNDY',
  'CAMEL',
  'CHAMPAGNE',
  'CLEAR',
  'COPPER',
  'CORAL',
  'CREAM',
  'DARK',
  'DEEP',
  'GOLD',
  'GOLDEN',
  'GRAY',
  'GREEN',
  'GREY',
  'IVORY',
  'KHAKI',
  'LAVENDER',
  'LIGHT',
  'LILAC',
  'MAGENTA',
  'MAROON',
  'MINT',
  'MIX',
  'MIXED',
  'MOCHA',
  'MULTI',
  'MULTICOLOR',
  'MULTICOLOUR',
  'MUSTARD',
  'NATURAL',
  'NAVY',
  'OFF',
  'OLIVE',
  'ORANGE',
  'PEACH',
  'PINK',
  'PURPLE',
  'RED',
  'ROSE',
  'ROYAL',
  'SILVER',
  'SKY',
  'TAN',
  'TEAL',
  'TRANSPARENT',
  'TURQUOISE',
  'VIOLET',
  'WHITE',
  'YELLOW',
]

const CORE_COLORS = [
  'AQUA',
  'ASH',
  'BEIGE',
  'BLACK',
  'BLUE',
  'BRONZE',
  'BROWN',
  'BURGUNDY',
  'CAMEL',
  'CHAMPAGNE',
  'CLEAR',
  'COPPER',
  'CORAL',
  'CREAM',
  'GOLD',
  'GOLDEN',
  'GRAY',
  'GREEN',
  'GREY',
  'IVORY',
  'KHAKI',
  'LAVENDER',
  'LILAC',
  'MAGENTA',
  'MAROON',
  'MINT',
  'MIX',
  'MIXED',
  'MOCHA',
  'MULTI',
  'MULTICOLOR',
  'MULTICOLOUR',
  'MUSTARD',
  'NATURAL',
  'NAVY',
  'OLIVE',
  'ORANGE',
  'PEACH',
  'PINK',
  'PURPLE',
  'RED',
  'SILVER',
  'TAN',
  'TEAL',
  'TRANSPARENT',
  'TURQUOISE',
  'VIOLET',
  'WHITE',
  'YELLOW',
]

const COLOR_SET = new Set(COLORS)
const CORE_COLOR_SET = new Set(CORE_COLORS)

function normalizeSku(code) {
  return String(code == null ? '' : code)
    .replace(/\u00A0/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function normalizeSeparators(code) {
  return normalizeSku(code)
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function addExactMatchVariants(set, raw) {
  const normalized = normalizeSku(raw)
  if (!normalized) return
  set.add(normalized)
  set.add(normalized.replace(/\s+/g, '-'))
  set.add(normalized.replace(/_/g, '-'))
  set.add(normalizeSeparators(normalized))
  set.add(normalized.replace(/\s+/g, ''))
}

function expandExactMatchVariants(raw) {
  const set = new Set()
  addExactMatchVariants(set, raw)
  return [...set].filter(Boolean)
}

function looksLikeColorSuffix(tokens) {
  if (!tokens.length || tokens.length > 3) return false
  return tokens.every((token) => COLOR_SET.has(token)) && tokens.some((token) => CORE_COLOR_SET.has(token))
}

function looksLikeSkuBase(raw) {
  const normalized = normalizeSku(raw)
  return normalized.length >= 3 && /[A-Z]/.test(normalized)
}

function splitAttachedColorToken(token) {
  const normalized = normalizeSku(token)
  for (const color of CORE_COLORS) {
    if (!normalized.endsWith(color) || normalized.length <= color.length) continue
    const base = normalized.slice(0, -color.length)
    if (/\d$/.test(base) || /[A-Z]\d+$/.test(base)) return { base, color }
  }
  return null
}

function expandColorlessSkuVariants(raw) {
  const normalized = normalizeSeparators(raw)
  if (!normalized) return []
  const parts = normalized.split('-').filter(Boolean)
  if (parts.length < 2) return []

  const out = []
  const maxSuffixLen = Math.min(3, parts.length - 1)
  for (let suffixLen = maxSuffixLen; suffixLen >= 1; suffixLen -= 1) {
    const suffix = parts.slice(-suffixLen)
    if (!looksLikeColorSuffix(suffix)) continue

    const base = parts.slice(0, -suffixLen).join('-')
    if (looksLikeSkuBase(base)) out.push(base)
    break
  }
  const lastPart = parts[parts.length - 1]
  const split = splitAttachedColorToken(lastPart)
  if (split) {
    const base = [...parts.slice(0, -1), split.base].join('-')
    if (looksLikeSkuBase(base) && !out.includes(base)) out.push(base)
  }
  return out
}

function addMatchCandidates(out, seen, raw, matchKind) {
  for (const key of expandExactMatchVariants(raw)) {
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, matchKind })
  }
}

function expandMatchCandidates(raw) {
  const out = []
  const seen = new Set()
  addMatchCandidates(out, seen, raw, 'exact')
  for (const base of expandColorlessSkuVariants(raw)) {
    addMatchCandidates(out, seen, base, 'parent')
  }
  return out
}

function extractColor(code) {
  const normalized = normalizeSeparators(code)
  if (!normalized) return ''

  const parts = normalized.split('-').filter(Boolean)
  const maxSuffixLen = Math.min(3, parts.length)
  for (let suffixLen = maxSuffixLen; suffixLen >= 1; suffixLen -= 1) {
    const suffix = parts.slice(-suffixLen)
    if (looksLikeColorSuffix(suffix)) return suffix.join(' ')
  }
  const split = splitAttachedColorToken(parts[parts.length - 1])
  if (split) return split.color
  return ''
}

function getParentSku(code) {
  const normalized = normalizeSku(code)
  const [parent] = expandColorlessSkuVariants(normalized)
  return parent || normalized
}

function toQty(value) {
  if (value == null || value === '') return 0
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

function vigilRowCodeSources(row) {
  const seen = new Set()
  const out = []
  for (const value of [
    row.itemCode,
    row.item_code,
    row.code,
    row.sku,
    row.normalizedItemCode,
    row.normalized_item_code,
  ]) {
    const s = cleanRowCode(value)
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function cleanRowCode(value) {
  return String(value == null ? '' : value).trim()
}

function buildVigilIndexes(vigilRows) {
  const exact = new Map()
  for (const row of Array.isArray(vigilRows) ? vigilRows : []) {
    const sources = vigilRowCodeSources(row)
    if (sources.length === 0) continue
    const primary = normalizeSku(sources[0])
    if (!primary) continue
    const entry = {
      code: primary,
      qty: toQty(
        row.availableStock ??
          row.available_stock ??
          row.availableQty ??
          row.available_qty ??
          row.qty ??
          row.quantity ??
          row.stock
      ),
      row,
    }
    for (const rawCode of sources) {
      for (const key of expandExactMatchVariants(rawCode)) {
        if (!exact.has(key)) exact.set(key, entry)
      }
    }
  }
  return { exact }
}

function buildAmbiguityAwareVigilIndexes(vigilRows) {
  const exact = new Map()
  const duplicateKeys = new Set()
  for (const row of Array.isArray(vigilRows) ? vigilRows : []) {
    const sources = vigilRowCodeSources(row)
    if (sources.length === 0) continue
    const primary = normalizeSku(sources[0])
    if (!primary) continue
    const entry = {
      code: primary,
      qty: toQty(
        row.availableStock ??
          row.available_stock ??
          row.availableQty ??
          row.available_qty ??
          row.qty ??
          row.quantity ??
          row.stock
      ),
      row,
    }
    const rowKeys = new Set()
    for (const rawCode of sources) {
      for (const key of expandExactMatchVariants(rawCode)) {
        if (rowKeys.has(key)) continue
        rowKeys.add(key)
        const previous = exact.get(key)
        if (!previous) {
          exact.set(key, entry)
        } else if (previous.code !== entry.code || previous.qty !== entry.qty) {
          duplicateKeys.add(key)
        }
      }
    }
  }
  return { exact, duplicateKeys }
}

function matchZohoSkuToVigilWithIndexes(indexes, zohoSku) {
  for (const candidate of expandMatchCandidates(zohoSku)) {
    const match = indexes.exact.get(candidate.key)
    if (match) {
      return {
        matched: true,
        matchType: candidate.matchKind,
        matchedVigilCode: match.code,
        wholesaleAvailableQty: match.qty,
      }
    }
  }

  return {
    matched: false,
    matchType: 'not_found',
    matchedVigilCode: '',
    wholesaleAvailableQty: 0,
  }
}

function matchSkuToVigilWithAmbiguity(indexes, sku) {
  for (const candidate of expandMatchCandidates(sku)) {
    if (indexes.duplicateKeys?.has(candidate.key)) {
      return {
        matched: false,
        ambiguous: true,
        matchType: candidate.matchKind,
        matchedVigilCode: '',
        wholesaleAvailableQty: null,
      }
    }
    const match = indexes.exact.get(candidate.key)
    if (match) {
      return {
        matched: true,
        ambiguous: false,
        matchType: candidate.matchKind,
        matchedVigilCode: match.code,
        wholesaleAvailableQty: match.qty,
      }
    }
  }
  return {
    matched: false,
    ambiguous: false,
    matchType: 'not_found',
    matchedVigilCode: '',
    wholesaleAvailableQty: null,
  }
}

function matchZohoSkuToVigil(zohoSku, vigilRows) {
  return matchZohoSkuToVigilWithIndexes(buildVigilIndexes(vigilRows), zohoSku)
}

module.exports = {
  COLORS,
  CORE_COLORS,
  normalizeSku,
  extractColor,
  getParentSku,
  expandExactMatchVariants,
  expandMatchCandidates,
  vigilRowCodeSources,
  buildVigilIndexes,
  buildAmbiguityAwareVigilIndexes,
  matchZohoSkuToVigilWithIndexes,
  matchSkuToVigilWithAmbiguity,
  matchZohoSkuToVigil,
}
