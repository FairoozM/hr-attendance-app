/** Composite bundle economics — mirrors All Prices formula with single bundle shipping. */

function toDec(pct) {
  const n = Number(pct)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n)) / 100
}

const COLOR_SUFFIX_TOKENS = new Set([
  'aqua',
  'ash',
  'baby',
  'beige',
  'black',
  'blue',
  'bronze',
  'brown',
  'burgundy',
  'camel',
  'champagne',
  'clear',
  'copper',
  'coral',
  'cream',
  'dark',
  'deep',
  'gold',
  'golden',
  'gray',
  'green',
  'grey',
  'ivory',
  'khaki',
  'lavender',
  'light',
  'lilac',
  'magenta',
  'maroon',
  'mint',
  'mix',
  'mixed',
  'mocha',
  'multi',
  'multicolor',
  'multicolour',
  'mustard',
  'natural',
  'navy',
  'off',
  'olive',
  'orange',
  'peach',
  'pink',
  'purple',
  'red',
  'rose',
  'royal',
  'silver',
  'sky',
  'tan',
  'teal',
  'transparent',
  'turquoise',
  'violet',
  'white',
  'yellow',
])

const CORE_COLOR_SUFFIX_TOKENS = new Set([
  'aqua',
  'ash',
  'beige',
  'black',
  'blue',
  'bronze',
  'brown',
  'burgundy',
  'camel',
  'champagne',
  'clear',
  'copper',
  'coral',
  'cream',
  'gold',
  'golden',
  'gray',
  'green',
  'grey',
  'ivory',
  'khaki',
  'lavender',
  'lilac',
  'magenta',
  'maroon',
  'mint',
  'mix',
  'mixed',
  'mocha',
  'multi',
  'multicolor',
  'multicolour',
  'mustard',
  'natural',
  'navy',
  'olive',
  'orange',
  'peach',
  'pink',
  'purple',
  'red',
  'silver',
  'tan',
  'teal',
  'transparent',
  'turquoise',
  'violet',
  'white',
  'yellow',
])

function normalizeSeparators(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function addExactMatchVariants(set, raw) {
  const t = String(raw || '').trim().toLowerCase()
  if (!t) return
  set.add(t)
  set.add(t.replace(/\s+/g, '-'))
  set.add(t.replace(/_/g, '-'))
  set.add(normalizeSeparators(t))
  set.add(t.replace(/\s+/g, ''))
}

function expandExactMatchVariants(raw) {
  const set = new Set()
  addExactMatchVariants(set, raw)
  return [...set].filter(Boolean)
}

function looksLikeColorSuffix(tokens) {
  if (!tokens.length || tokens.length > 3) return false
  return (
    tokens.every((token) => COLOR_SUFFIX_TOKENS.has(token)) &&
    tokens.some((token) => CORE_COLOR_SUFFIX_TOKENS.has(token))
  )
}

function looksLikeSkuBase(raw) {
  const t = String(raw || '').trim()
  return t.length >= 3 && /[a-z]/i.test(t) && /\d/.test(t)
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
    addMatchCandidates(out, seen, base, 'base_without_color')
  }
  return out
}

function normalizePurchaseMatch(value, matchedKey, matchKind) {
  if (value == null) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return {
      itemNo: matchedKey,
      purchasePrice: value,
      matchedKey,
      matchKind,
    }
  }

  const purchasePrice = Number(value.purchasePrice)
  if (!Number.isFinite(purchasePrice)) return null
  const shipping = Number(value.shipping)
  return {
    itemNo: value.itemNo || matchedKey,
    purchasePrice,
    shipping: Number.isFinite(shipping) ? shipping : null,
    dateOfPrices: value.dateOfPrices != null ? String(value.dateOfPrices) : '',
    matchedKey,
    matchKind,
  }
}

/**
 * Build lookup from ecommerce price list rows: itemNo variant → row match metadata.
 */
export function buildPurchasePriceMap(rows) {
  const m = new Map()
  if (!Array.isArray(rows)) return m
  for (const r of rows) {
    const raw = String(r.itemNo || '').trim()
    if (!raw) continue
    const p = Number(r.purchasePrice)
    if (!Number.isFinite(p)) continue
    const shipping = Number(r.shipping)
    const entry = {
      itemNo: raw,
      purchasePrice: p,
      shipping: Number.isFinite(shipping) ? shipping : null,
      dateOfPrices: r.dateOfPrices != null ? String(r.dateOfPrices) : '',
    }
    for (const v of expandExactMatchVariants(raw)) {
      if (!m.has(v)) m.set(v, entry)
    }
  }
  return m
}

/** Normalize component keys and also try base SKU when Zoho adds a trailing color token. */
export function expandMatchVariants(raw) {
  return expandMatchCandidates(raw).map((candidate) => candidate.key)
}

/**
 * Try Zoho match_keys + sku + name against the ecommerce price map and return the matched row.
 * @param {Map<string, { itemNo: string, purchasePrice: number, shipping?: number|null, dateOfPrices?: string }|number>} purchaseMap — lower-case keys
 * @param {{ sku?: string, name?: string, match_keys?: string[] }} component
 */
export function findPurchaseMatchForComponent(purchaseMap, component) {
  const rawKeys = []
  if (Array.isArray(component.match_keys) && component.match_keys.length) {
    rawKeys.push(...component.match_keys)
  } else {
    if (component.sku) rawKeys.push(component.sku)
    if (component.name) rawKeys.push(component.name)
  }

  const tried = new Set()
  for (const raw of rawKeys) {
    for (const { key: v, matchKind } of expandMatchCandidates(raw)) {
      if (tried.has(v)) continue
      tried.add(v)
      if (purchaseMap.has(v)) return normalizePurchaseMatch(purchaseMap.get(v), v, matchKind)
    }
  }
  return null
}

/**
 * Backwards-compatible helper for callers that only need the purchase price.
 * @param {Map<string, { itemNo: string, purchasePrice: number, shipping?: number|null, dateOfPrices?: string }|number>} purchaseMap
 * @param {{ sku?: string, name?: string, match_keys?: string[] }} component
 */
export function findPurchaseForComponent(purchaseMap, component) {
  const match = findPurchaseMatchForComponent(purchaseMap, component)
  return match ? match.purchasePrice : null
}

/**
 * @param {number} totalPurchaseCost — sum of component purchase × qty
 * @param {number} bundleShipping
 * @param {{ vatPct: number, commissionPct: number, advertisingPct: number, requiredProfitPct: number }} rates — 0–100
 */
export function computeBundleEconomics(totalPurchaseCost, bundleShipping, rates) {
  const v = toDec(rates.vatPct)
  const c = toDec(rates.commissionPct)
  const a = toDec(rates.advertisingPct)
  const r = toDec(rates.requiredProfitPct)
  const sumTake = v + c + a + r
  const denom = 1 - sumTake

  if (denom <= 0 || denom >= 1) {
    return { ok: false, error: 'VAT + commission + advertising + required profit must stay below 100%.' }
  }

  const P = Number(totalPurchaseCost) || 0
  const S = Number(bundleShipping) || 0
  const numerator = P + S

  const rawSp = numerator / denom
  let sp = Math.ceil(rawSp - 1e-12)
  if (!Number.isFinite(sp)) sp = 0
  if (sp < 0) sp = 0

  const minProfitPct = Number(rates.requiredProfitPct)
  const minPct = Number.isFinite(minProfitPct) ? minProfitPct : 25

  for (let guard = 0; guard < 500000; guard += 1) {
    const vatAmt = sp * v
    const commAmt = sp * c
    const advAmt = sp * a
    const totalCost = P + vatAmt + commAmt + advAmt + S
    const profit = sp - totalCost
    const profitPct = sp > 0 ? (profit / sp) * 100 : profit >= 0 ? 100 : 0

    if (sp === 0) {
      if (numerator <= 0 && S <= 0) {
        return {
          ok: true,
          salesPrice: 0,
          vatAmount: 0,
          commissionAmount: 0,
          advertisingAmount: 0,
          totalCost: 0,
          profit: 0,
          profitPct: 0,
        }
      }
      sp = 1
      continue
    }

    if (profitPct + 1e-9 >= minPct) {
      return {
        ok: true,
        salesPrice: sp,
        vatAmount: vatAmt,
        commissionAmount: commAmt,
        advertisingAmount: advAmt,
        totalCost,
        profit,
        profitPct,
      }
    }
    sp += 1
  }

  return { ok: false, error: 'Could not reach minimum profit % — check amounts and rates.' }
}
