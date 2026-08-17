import { describe, expect, it } from 'vitest'
import {
  computeOfferBundleEconomics,
  computeOfferLineEconomics,
  type CompositeRates,
} from './compositeOffersBundlePricing'
import { COMPOSITE_PRICES_VARIANTS } from './compositePricesVariants'
import { computeBundleEconomics } from './compositeBundlePricingUtils'

const RATES: CompositeRates = {
  vatPct: 5,
  commissionPct: 15,
  advertisingPct: 15,
  requiredProfitPct: 25,
}

/** Rates that take nothing, so a component's margin is purely sales − purchase. */
const NO_FEES: CompositeRates = { vatPct: 0, commissionPct: 0, advertisingPct: 0 }

function line(salesPrice: number, purchasePrice: number, shipping = 0, quantity = 1) {
  const economics = computeOfferLineEconomics({ salesPrice, purchasePrice, shipping, quantity }, NO_FEES)
  if (!economics) throw new Error('expected line economics')
  return economics
}

describe('special offers bundle pricing', () => {
  it('sells the bundle for the sum of the component offer prices', () => {
    const lines = [
      computeOfferLineEconomics({ salesPrice: 210, purchasePrice: 60.8, shipping: 28, quantity: 1 }, RATES)!,
      computeOfferLineEconomics({ salesPrice: 114, purchasePrice: 28.28, shipping: 20, quantity: 1 }, RATES)!,
    ]

    const bundle = computeOfferBundleEconomics(lines, RATES)

    expect(bundle.ok).toBe(true)
    if (!bundle.ok) return
    expect(bundle.salesPrice).toBe(324)
    expect(bundle.totalPurchase).toBeCloseTo(89.08, 6)
    expect(bundle.shipping).toBe(48)
    expect(bundle.vatAmount).toBeCloseTo(16.2, 6)
    expect(bundle.commissionAmount).toBeCloseTo(48.6, 6)
    expect(bundle.advertisingAmount).toBeCloseTo(48.6, 6)
    expect(bundle.totalCost).toBeCloseTo(89.08 + 48 + 16.2 + 48.6 + 48.6, 6)
    expect(bundle.profit).toBeCloseTo(324 - bundle.totalCost, 6)
  })

  it('blends a 30% and a 20% component of equal value into 25%', () => {
    const thirtyPct = line(100, 70)
    const twentyPct = line(100, 80)
    expect(thirtyPct.profitPct).toBeCloseTo(30, 6)
    expect(twentyPct.profitPct).toBeCloseTo(20, 6)

    const bundle = computeOfferBundleEconomics([thirtyPct, twentyPct], NO_FEES)

    expect(bundle.ok).toBe(true)
    if (!bundle.ok) return
    expect(bundle.salesPrice).toBe(200)
    expect(bundle.profitPct).toBeCloseTo(25, 6)
  })

  it('weights the blend by sales value, not by component count', () => {
    // A 30% margin on 300 of sales plus a 20% margin on 100 → 27.5% overall.
    const bundle = computeOfferBundleEconomics([line(300, 210), line(100, 80)], NO_FEES)

    expect(bundle.ok).toBe(true)
    if (!bundle.ok) return
    expect(bundle.profitPct).toBeCloseTo(27.5, 6)
  })

  it('keeps a negative offer margin negative instead of bumping the price up', () => {
    const bundle = computeOfferBundleEconomics([line(100, 130)], NO_FEES)

    expect(bundle.ok).toBe(true)
    if (!bundle.ok) return
    expect(bundle.salesPrice).toBe(100)
    expect(bundle.profitPct).toBeCloseTo(-30, 6)
  })

  it('multiplies sales, purchase and shipping by quantity', () => {
    const l = computeOfferLineEconomics({ salesPrice: 100, purchasePrice: 60, shipping: 10, quantity: 3 }, NO_FEES)!

    expect(l.lineSales).toBe(300)
    expect(l.linePurchase).toBe(180)
    expect(l.lineShipping).toBe(30)
    expect(l.profitPct).toBeCloseTo(30, 6)
  })

  it('replaces the components’ shipping when a bundle figure is given', () => {
    const lines = [line(100, 50, 10), line(100, 50, 10)]

    const fromList = computeOfferBundleEconomics(lines, NO_FEES)
    const overridden = computeOfferBundleEconomics(lines, NO_FEES, 5)

    expect(fromList.ok && fromList.shipping).toBe(20)
    expect(overridden.ok && overridden.shipping).toBe(5)
    expect(overridden.ok && overridden.profit).toBeCloseTo(200 - 100 - 5, 6)
  })

  it('has no bundle price without at least one component offer price', () => {
    const empty = computeOfferBundleEconomics([], RATES)
    expect(empty.ok).toBe(false)

    expect(computeOfferLineEconomics({ salesPrice: '', purchasePrice: 60, quantity: 1 }, RATES)).toBeNull()
    expect(computeOfferLineEconomics({ salesPrice: null, purchasePrice: 60, quantity: 1 }, RATES)).toBeNull()
  })

  it('rejects fee rates that take the whole sales price', () => {
    const bundle = computeOfferBundleEconomics([line(100, 50)], {
      vatPct: 40,
      commissionPct: 40,
      advertisingPct: 40,
    })
    expect(bundle.ok).toBe(false)
  })
})

describe('only the special offers variant blends component sales prices', () => {
  it('flags the pricing mode per variant', () => {
    expect(COMPOSITE_PRICES_VARIANTS['special-offers'].bundlePricing).toBe('sum-component-sales')
    expect(COMPOSITE_PRICES_VARIANTS.standard.bundlePricing).toBe('target-profit')
  })

  it('leaves the standard target-profit math untouched', () => {
    // 100 purchase + 20 shipping over a 40% divisor, rounded up to the next whole AED.
    const standard = computeBundleEconomics(100, 20, { ...RATES, requiredProfitPct: 25 })

    expect(standard.ok).toBe(true)
    expect(standard.salesPrice).toBe(300)
    expect(standard.profitPct).toBeGreaterThanOrEqual(25)
  })
})
