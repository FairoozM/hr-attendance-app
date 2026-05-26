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

function computeEcommercePriceRow(row, rates = DEFAULT_RATES) {
  const purchase = Number(row?.purchasePrice)
  const shipping = Number(row?.shipping)
  const vat = toDec(rates.vatPct)
  const commission = toDec(rates.commissionPct)
  const advertising = toDec(rates.advertisingPct)
  const reqProfit = toDec(rates.requiredProfitPct)
  const denominator = 1 - vat - commission - advertising - reqProfit
  const safePurchase = Number.isFinite(purchase) ? purchase : 0
  const safeShipping = Number.isFinite(shipping) ? shipping : 0

  if (denominator <= 0 || denominator >= 1) {
    return {
      denominatorInvalid: true,
      salesPriceRaw: 0,
      salesPrice: 0,
      vatAmount: 0,
      commissionAmount: 0,
      advertisingAmount: 0,
      totalCost: 0,
      profit: 0,
      profitPct: 0,
    }
  }

  const salesPriceRaw = (safePurchase + safeShipping) / denominator
  const salesPrice = Math.round(salesPriceRaw)
  const vatAmount = salesPrice * vat
  const commissionAmount = salesPrice * commission
  const advertisingAmount = salesPrice * advertising
  const totalCost = safePurchase + vatAmount + commissionAmount + advertisingAmount + safeShipping
  const profit = salesPrice - totalCost
  const profitPct = salesPrice > 0 ? (profit / salesPrice) * 100 : 0

  return {
    denominatorInvalid: false,
    salesPriceRaw,
    salesPrice,
    vatAmount,
    commissionAmount,
    advertisingAmount,
    totalCost,
    profit,
    profitPct,
  }
}

function normalizeAllPricesRow(row) {
  const itemNo = String(row?.itemNo || '').trim()
  if (!itemNo) return null
  if (row?.isActive === false) return null
  const purchasePrice = Number(row?.purchasePrice)
  const shipping = Number(row?.shipping)
  return {
    ...row,
    itemNo,
    sku: row?.sku != null && String(row.sku).trim() ? String(row.sku).trim() : itemNo,
    purchasePrice: Number.isFinite(purchasePrice) ? purchasePrice : null,
    shipping: Number.isFinite(shipping) ? shipping : null,
    dateOfPrices: row?.dateOfPrices != null ? String(row.dateOfPrices) : '',
  }
}

function buildPurchasePriceMap(rows) {
  const m = new Map()
  if (!Array.isArray(rows)) return m
  for (const rawRow of rows) {
    const row = normalizeAllPricesRow(rawRow)
    if (!row || !Number.isFinite(Number(row.purchasePrice))) continue
    for (const v of expandExactMatchVariants(row.itemNo)) {
      const prev = m.get(v)
      if (prev) {
        const list = Array.isArray(prev) ? prev : [prev]
        list.push(row)
        m.set(v, list)
      } else {
        m.set(v, row)
      }
    }
  }
  return m
}

function rawComponentKeys(component) {
  if (Array.isArray(component?.match_keys) && component.match_keys.length) return component.match_keys
  return [component?.sku, component?.name].filter(Boolean)
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
        const row = normalizeAllPricesRow(value)
        if (!row || !Number.isFinite(Number(row.purchasePrice))) continue
        matches.push({
          itemNo: row.itemNo,
          sku: row.sku || row.itemNo,
          purchasePrice: Number(row.purchasePrice),
          shipping: row.shipping,
          dateOfPrices: row.dateOfPrices || '',
          matchedKey: key,
          matchKind,
          row,
        })
      }
    }
  }

  const uniq = []
  const seen = new Set()
  for (const match of matches) {
    const id = `${String(match.itemNo).toLowerCase()}::${match.purchasePrice}`
    if (seen.has(id)) continue
    seen.add(id)
    uniq.push(match)
  }
  if (uniq.length === 0) return { status: 'unmatched', match: null, matches: [] }
  if (uniq.length > 1) return { status: 'duplicate_active_price', match: null, matches: uniq }
  return { status: 'matched', match: uniq[0], matches: uniq }
}

function resolveCompositeComponentPricing(component, allPricesRowsOrMap, rates = DEFAULT_RATES) {
  const purchaseMap = allPricesRowsOrMap instanceof Map
    ? allPricesRowsOrMap
    : buildPurchasePriceMap(allPricesRowsOrMap)
  const result = findPurchaseMatchForComponent(purchaseMap, component)
  const quantity = Number(component?.quantity)
  const safeQty = Number.isFinite(quantity) ? quantity : 0
  const match = result.match
  const matchedRecordFound = result.status === 'matched' && !!match?.row
  const economics = matchedRecordFound ? computeEcommercePriceRow(match.row, rates) : null
  const purchasePrice = matchedRecordFound ? Number(match.purchasePrice) : null
  const linePurchaseTotal = Number.isFinite(purchasePrice) ? purchasePrice * safeQty : null
  const pricingStatus = matchedRecordFound && economics && !economics.denominatorInvalid ? 'complete' : 'incomplete'

  return {
    componentSku: component?.sku || '',
    componentName: component?.name || '',
    quantity: safeQty,
    zohoComponentItemId: component?.item_id || '',
    zohoPurchaseRateReference: component?.zoho_purchase_rate ?? null,
    matchedAllPricesItemNo: matchedRecordFound ? match.itemNo : null,
    matchedAllPricesSku: matchedRecordFound ? (match.sku || match.itemNo) : null,
    matchedAllPricesRecordFound: matchedRecordFound,
    matchStatus: result.status === 'matched'
      ? 'matched'
      : result.status === 'duplicate_active_price'
        ? 'DUPLICATE_ACTIVE_PRICE'
        : 'unmatched',
    matchKeyUsed: match?.matchedKey || null,
    matchKind: match?.matchKind || null,
    matchedAllPricesRecord: matchedRecordFound ? match.row : null,
    salesPriceAed: economics && !economics.denominatorInvalid ? economics.salesPrice : null,
    vat5: economics && !economics.denominatorInvalid ? economics.vatAmount : null,
    commission15: economics && !economics.denominatorInvalid ? economics.commissionAmount : null,
    advertising15: economics && !economics.denominatorInvalid ? economics.advertisingAmount : null,
    shipping: matchedRecordFound ? match.row.shipping : null,
    purchasePrice,
    linePurchaseTotal,
    totalCost: economics && !economics.denominatorInvalid ? economics.totalCost : null,
    profitAed: economics && !economics.denominatorInvalid ? economics.profit : null,
    profitPercent: economics && !economics.denominatorInvalid ? economics.profitPct : null,
    pricingStatus,
    dateOfPrice: matchedRecordFound ? match.row.dateOfPrices : '',
    possibleMatches: result.matches,
  }
}

export {
  DEFAULT_RATES,
  buildPurchasePriceMap,
  computeEcommercePriceRow,
  expandMatchCandidates,
  findPurchaseMatchForComponent,
  resolveCompositeComponentPricing,
}
