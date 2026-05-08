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

function buildVigilIndexes(vigilRows) {
  const exact = new Map()
  for (const row of Array.isArray(vigilRows) ? vigilRows : []) {
    const rawCode = row.itemCode || row.item_code || row.code || row.sku
    const code = normalizeSku(rawCode)
    if (!code || exact.has(code)) continue
    const entry = {
      code,
      qty: toQty(row.availableStock ?? row.available_stock ?? row.availableQty ?? row.qty),
      row,
    }
    for (const key of expandExactMatchVariants(rawCode)) {
      if (!exact.has(key)) exact.set(key, entry)
    }
  }
  return { exact }
}

function matchZohoSkuToVigil(zohoSku, vigilRows) {
  const indexes = buildVigilIndexes(vigilRows)
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

module.exports = {
  COLORS,
  CORE_COLORS,
  normalizeSku,
  extractColor,
  getParentSku,
  expandMatchCandidates,
  matchZohoSkuToVigil,
}
