const COLORS = [
  'BLACK',
  'BEIGE',
  'BLUE',
  'RED',
  'GREEN',
  'WHITE',
  'GRAY',
  'GREY',
  'PINK',
  'BROWN',
  'SILVER',
  'GOLD',
]

const COLOR_SET = new Set(COLORS)

function normalizeSku(code) {
  return String(code == null ? '' : code)
    .replace(/\u00A0/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function extractColor(code) {
  const normalized = normalizeSku(code)
  if (!normalized) return ''

  const lastHyphenPart = normalized.includes('-')
    ? normalized.slice(normalized.lastIndexOf('-') + 1).trim()
    : ''
  if (COLOR_SET.has(lastHyphenPart)) return lastHyphenPart

  const suffix = normalized.match(/\b([A-Z]+)$/)
  if (suffix && COLOR_SET.has(suffix[1])) return suffix[1]
  return ''
}

function getParentSku(code) {
  const normalized = normalizeSku(code)
  const color = extractColor(normalized)
  if (!normalized || !color) return normalized

  const hyphenSuffix = new RegExp(`\\s*-\\s*${color}$`)
  if (hyphenSuffix.test(normalized)) {
    return normalized.replace(hyphenSuffix, '').trim()
  }
  return normalized.replace(new RegExp(`\\s+${color}$`), '').trim()
}

function toQty(value) {
  if (value == null || value === '') return 0
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

function buildVigilIndexes(vigilRows) {
  const exact = new Map()
  for (const row of Array.isArray(vigilRows) ? vigilRows : []) {
    const code = normalizeSku(row.itemCode || row.item_code || row.code || row.sku)
    if (!code || exact.has(code)) continue
    exact.set(code, {
      code,
      qty: toQty(row.availableStock ?? row.available_stock ?? row.availableQty ?? row.qty),
      row,
    })
  }
  return { exact }
}

function matchZohoSkuToVigil(zohoSku, vigilRows) {
  const normalized = normalizeSku(zohoSku)
  const indexes = buildVigilIndexes(vigilRows)
  const exact = indexes.exact.get(normalized)
  if (exact) {
    return {
      matched: true,
      matchType: 'exact',
      matchedVigilCode: exact.code,
      wholesaleAvailableQty: exact.qty,
    }
  }

  const parent = getParentSku(normalized)
  if (parent && parent !== normalized) {
    const parentMatch = indexes.exact.get(parent)
    if (parentMatch) {
      return {
        matched: true,
        matchType: 'parent',
        matchedVigilCode: parentMatch.code,
        wholesaleAvailableQty: parentMatch.qty,
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
  normalizeSku,
  extractColor,
  getParentSku,
  matchZohoSkuToVigil,
}
