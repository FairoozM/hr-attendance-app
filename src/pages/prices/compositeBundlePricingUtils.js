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
    const k = String(r.itemNo || '')
      .trim()
      .toLowerCase()
    if (!k) continue
    const p = Number(r.purchasePrice)
    if (Number.isFinite(p)) m.set(k, p)
  }
  return m
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
