const DEFAULT_RATES = {
  vatPct: 5,
  commissionPct: 15,
  advertisingPct: 15,
  requiredProfitPct: 25,
}

const COLOR_SUFFIX_TOKENS = new Set([
  'aqua', 'ash', 'baby', 'beige', 'black', 'blue', 'bronze', 'brown', 'burgundy',
  'camel', 'champagne', 'clear', 'copper', 'coral', 'cream', 'dark', 'deep', 'gold',
  'golden', 'gray', 'green', 'grey', 'ivory', 'khaki', 'lavender', 'light', 'lilac',
  'magenta', 'maroon', 'mint', 'mix', 'mixed', 'mocha', 'multi', 'multicolor',
  'multicolour', 'mustard', 'natural', 'navy', 'off', 'olive', 'orange', 'peach',
  'pink', 'purple', 'red', 'rose', 'royal', 'silver', 'sky', 'tan', 'teal',
  'transparent', 'turquoise', 'violet', 'white', 'yellow',
])

const CORE_COLOR_SUFFIX_TOKENS = new Set([
  'aqua', 'ash', 'beige', 'black', 'blue', 'bronze', 'brown', 'burgundy', 'camel',
  'champagne', 'clear', 'copper', 'coral', 'cream', 'gold', 'golden', 'gray',
  'green', 'grey', 'ivory', 'khaki', 'lavender', 'lilac', 'magenta', 'maroon',
  'mint', 'mix', 'mixed', 'mocha', 'multi', 'multicolor', 'multicolour',
  'mustard', 'natural', 'navy', 'olive', 'orange', 'peach', 'pink', 'purple',
  'red', 'silver', 'tan', 'teal', 'transparent', 'turquoise', 'violet', 'white',
  'yellow',
])

function toDec(pct) {
  const n = Number(pct)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n)) / 100
}

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
  return (
    tokens.length > 0 &&
    tokens.length <= 3 &&
    tokens.every((token) => COLOR_SUFFIX_TOKENS.has(token)) &&
    tokens.some((token) => CORE_COLOR_SUFFIX_TOKENS.has(token))
  )
}

function looksLikeSkuBase(raw) {
  const t = String(raw || '').trim()
  return t.length >= 3 && /[a-z]/i.test(t) && (/\d/.test(t) || t.includes('-'))
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

function buildPurchasePriceMap(rows) {
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
      const prev = m.get(v)
      if (prev) {
        const list = Array.isArray(prev) ? prev : [prev]
        list.push(entry)
        m.set(v, list)
      } else {
        m.set(v, entry)
      }
    }
  }
  return m
}

function rawComponentKeys(component) {
  if (Array.isArray(component.match_keys) && component.match_keys.length) return component.match_keys
  return [component.sku, component.name].filter(Boolean)
}

function findPurchaseMatchForComponent(purchaseMap, component) {
  const matches = []
  const tried = new Set()
  for (const raw of rawComponentKeys(component)) {
    for (const { key, matchKind } of expandMatchCandidates(raw)) {
      if (tried.has(key)) continue
      tried.add(key)
      if (!purchaseMap.has(key)) continue
      const values = purchaseMap.get(key)
      const list = Array.isArray(values) ? values : [values]
      for (const value of list) {
        const normalized = normalizePurchaseMatch(value, key, matchKind)
        if (normalized) matches.push(normalized)
      }
    }
  }
  const uniq = []
  const seen = new Set()
  for (const m of matches) {
    const id = `${String(m.itemNo).toLowerCase()}::${m.purchasePrice}`
    if (seen.has(id)) continue
    seen.add(id)
    uniq.push(m)
  }
  if (uniq.length === 0) return { status: 'unmatched', match: null, matches: [] }
  if (uniq.length > 1) return { status: 'ambiguous', match: null, matches: uniq }
  return { status: 'matched', match: uniq[0], matches: uniq }
}

function computeBundleEconomics(totalPurchaseCost, bundleShipping, rates = DEFAULT_RATES) {
  const vat = toDec(rates.vatPct)
  const commission = toDec(rates.commissionPct)
  const advertising = toDec(rates.advertisingPct)
  const requiredProfit = toDec(rates.requiredProfitPct)
  const denominator = 1 - vat - commission - advertising - requiredProfit
  if (denominator <= 0 || denominator >= 1) {
    return { ok: false, error: 'VAT + commission + advertising + required profit must stay below 100%.' }
  }
  const purchase = Number(totalPurchaseCost) || 0
  const shipping = Number(bundleShipping) || 0
  const rawSales = (purchase + shipping) / denominator
  let salesPrice = Math.ceil(rawSales - 1e-12)
  if (!Number.isFinite(salesPrice) || salesPrice < 0) salesPrice = 0

  for (let guard = 0; guard < 500000; guard += 1) {
    const vatAmount = salesPrice * vat
    const commissionAmount = salesPrice * commission
    const advertisingAmount = salesPrice * advertising
    const totalCost = purchase + vatAmount + commissionAmount + advertisingAmount + shipping
    const profit = salesPrice - totalCost
    const profitPct = salesPrice > 0 ? (profit / salesPrice) * 100 : profit >= 0 ? 100 : 0
    if (profitPct + 1e-9 >= (Number(rates.requiredProfitPct) || DEFAULT_RATES.requiredProfitPct)) {
      return {
        ok: true,
        salesPrice,
        vatAmount,
        commissionAmount,
        advertisingAmount,
        shipping,
        totalCost,
        profit,
        profitPct,
      }
    }
    salesPrice += 1
  }
  return { ok: false, error: 'Could not reach minimum profit % — check amounts and rates.' }
}

module.exports = {
  DEFAULT_RATES,
  buildPurchasePriceMap,
  findPurchaseMatchForComponent,
  computeBundleEconomics,
  expandMatchCandidates,
}
