/**
 * Special Offers composite pricing.
 *
 * Standard composites derive a sales price from cost and a required profit. Offers instead take
 * each component's own offer sales price from the master All Prices (UAE) Special Offers list: the
 * bundle sells for the sum of its parts, and its margin is whatever that blend works out to. Two
 * components at 30% and 20% of equal value therefore give a 25% bundle margin.
 *
 * Only the Special Offers variant uses this; standard and custom composites keep their own math in
 * compositeBundlePricingUtils.
 */

export type CompositeRates = {
  vatPct: number
  commissionPct: number
  advertisingPct: number
  requiredProfitPct?: number
}

export type OfferLineInput = {
  quantity?: unknown
  salesPrice?: unknown
  purchasePrice?: unknown
  shipping?: unknown
}

export type OfferLineEconomics = {
  quantity: number
  lineSales: number
  linePurchase: number
  lineShipping: number
  salesPrice: number
  vatAmount: number
  commissionAmount: number
  advertisingAmount: number
  totalCost: number
  profit: number
  profitPct: number
}

export type OfferBundleEconomics =
  | {
      ok: true
      salesPrice: number
      vatAmount: number
      commissionAmount: number
      advertisingAmount: number
      totalCost: number
      totalPurchase: number
      shipping: number
      profit: number
      profitPct: number
    }
  | { ok: false; error: string }

function toDec(pct: unknown): number {
  const n = Number(pct)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n)) / 100
}

function num(value: unknown): number | null {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function qtyOf(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Per-component economics straight off the offer list row — mirrors the All Prices row math. */
export function computeOfferLineEconomics(
  line: OfferLineInput,
  rates: CompositeRates,
): OfferLineEconomics | null {
  const salesPrice = num(line.salesPrice)
  if (salesPrice == null) return null

  const quantity = qtyOf(line.quantity)
  const purchase = num(line.purchasePrice) ?? 0
  const shipping = num(line.shipping) ?? 0

  const lineSales = salesPrice * quantity
  const linePurchase = purchase * quantity
  const lineShipping = shipping * quantity

  const vatAmount = lineSales * toDec(rates.vatPct)
  const commissionAmount = lineSales * toDec(rates.commissionPct)
  const advertisingAmount = lineSales * toDec(rates.advertisingPct)
  const totalCost = linePurchase + lineShipping + vatAmount + commissionAmount + advertisingAmount
  const profit = lineSales - totalCost

  return {
    quantity,
    lineSales,
    linePurchase,
    lineShipping,
    salesPrice,
    vatAmount,
    commissionAmount,
    advertisingAmount,
    totalCost,
    profit,
    profitPct: lineSales > 0 ? (profit / lineSales) * 100 : 0,
  }
}

/**
 * @param lines component economics from `computeOfferLineEconomics` (skip unmatched components)
 * @param shippingOverride one shipping figure for the whole bundle; when null the components'
 *   own shipping from the offer list is used, which keeps the bundle margin equal to the blend
 *   of the component margins.
 */
export function computeOfferBundleEconomics(
  lines: OfferLineEconomics[],
  rates: CompositeRates,
  shippingOverride: unknown = null,
): OfferBundleEconomics {
  const feePct =
    (Number(rates.vatPct) || 0) + (Number(rates.commissionPct) || 0) + (Number(rates.advertisingPct) || 0)
  if (feePct >= 100) {
    return { ok: false, error: 'VAT + commission + advertising must stay below 100%.' }
  }

  const salesPrice = lines.reduce((sum, l) => sum + l.lineSales, 0)
  if (!(salesPrice > 0)) {
    return {
      ok: false,
      error: 'No component offer sales prices found — the bundle price is the sum of its components.',
    }
  }

  const totalPurchase = lines.reduce((sum, l) => sum + l.linePurchase, 0)
  const override = num(shippingOverride)
  const shipping = override != null && override >= 0
    ? override
    : lines.reduce((sum, l) => sum + l.lineShipping, 0)

  const vatAmount = salesPrice * toDec(rates.vatPct)
  const commissionAmount = salesPrice * toDec(rates.commissionPct)
  const advertisingAmount = salesPrice * toDec(rates.advertisingPct)
  const totalCost = totalPurchase + shipping + vatAmount + commissionAmount + advertisingAmount
  const profit = salesPrice - totalCost

  return {
    ok: true,
    salesPrice,
    vatAmount,
    commissionAmount,
    advertisingAmount,
    totalCost,
    totalPurchase,
    shipping,
    profit,
    profitPct: (profit / salesPrice) * 100,
  }
}
