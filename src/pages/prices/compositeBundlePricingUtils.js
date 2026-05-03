/** Composite bundle economics — mirrors All Prices formula with single bundle shipping + extras. */

function toDec(pct) {
  const n = Number(pct)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n)) / 100
}

/**
 * Build lookup from ecommerce price list rows: itemNo → purchase price (number).
 */
export function buildPurchasePriceMap(rows) {
  const m = new Map()
  if (!Array.isArray(rows)) return m
  for (const r of rows) {
    const raw = String(r.itemNo || '').trim()
    if (!raw) continue
    const p = Number(r.purchasePrice)
    if (!Number.isFinite(p)) continue
    for (const v of expandMatchVariants(raw)) {
      if (!m.has(v)) m.set(v, p)
    }
  }
  return m
}

/** Normalize keys the same way users type Item no. vs Zoho (spaces vs hyphens). */
export function expandMatchVariants(raw) {
  const t = String(raw || '').trim().toLowerCase()
  if (!t) return []
  const set = new Set([t])
  set.add(t.replace(/\s+/g, '-'))
  set.add(t.replace(/_/g, '-'))
  set.add(t.replace(/\s+/g, ''))
  return [...set].filter(Boolean)
}

/**
 * Try Zoho match_keys + sku + name against the ecommerce price map.
 * @param {Map<string, number>} purchaseMap — lower-case keys
 * @param {{ sku?: string, name?: string, match_keys?: string[] }} component
 */
export function findPurchaseForComponent(purchaseMap, component) {
  const rawKeys = []
  if (Array.isArray(component.match_keys) && component.match_keys.length) {
    rawKeys.push(...component.match_keys)
  } else {
    if (component.sku) rawKeys.push(component.sku)
    if (component.name) rawKeys.push(component.name)
  }

  const tried = new Set()
  for (const raw of rawKeys) {
    for (const v of expandMatchVariants(raw)) {
      if (tried.has(v)) continue
      tried.add(v)
      if (purchaseMap.has(v)) return purchaseMap.get(v)
    }
  }
  return null
}

/**
 * @param {number} totalPurchaseCost — sum of component purchase × qty
 * @param {number} bundleShipping
 * @param {number} extrasSum
 * @param {{ vatPct: number, commissionPct: number, advertisingPct: number, requiredProfitPct: number }} rates — 0–100
 */
export function computeBundleEconomics(totalPurchaseCost, bundleShipping, extrasSum, rates) {
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
  const E = Number(extrasSum) || 0
  const numerator = P + S + E

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
    const totalCost = P + vatAmt + commAmt + advAmt + S + E
    const profit = sp - totalCost
    const profitPct = sp > 0 ? (profit / sp) * 100 : profit >= 0 ? 100 : 0

    if (sp === 0) {
      if (numerator <= 0 && S <= 0 && E <= 0) {
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
