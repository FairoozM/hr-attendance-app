import { describe, expect, it } from 'vitest'
import { computeCbm, computeKsaRowPricing } from './ksaPricingCalc.ts'

describe('ksaPricingCalc', () => {
  it('computes CBM from cm dimensions', () => {
    expect(computeCbm(100, 50, 40, 'cm')).toBeCloseTo(0.2, 6)
  })

  it('computes landed-cost selling price with default percentages', () => {
    const result = computeKsaRowPricing(
      {
        purchasePriceEcommerce: 100,
        length: 100,
        width: 50,
        height: 40,
        dimensionUnit: 'cm',
        storageCost: 10,
        ksaShippingCost: 5,
        commissionPercent: 15,
        advertisingPercent: 15,
        vatKsaPercent: 15,
        profitPercent: 15,
      },
      { freightRatePerCbm: 200 }
    )
    expect(result.cbm).toBeCloseTo(0.2, 6)
    expect(result.cargoCost).toBeCloseTo(40, 6)
    expect(result.totalBaseCost).toBeCloseTo(155, 6)
    expect(result.newPriceSar).toBeCloseTo(155 / 0.4, 4)
    expect(result.commissionAmount).toBeCloseTo((155 / 0.4) * 0.15, 4)
    expect(result.advertisingAmount).toBeCloseTo((155 / 0.4) * 0.15, 4)
    expect(result.vatKsaAmount).toBeCloseTo((155 / 0.4) * 0.15, 4)
    expect(result.profitAmount).toBeCloseTo((155 / 0.4) * 0.15, 4)
    expect(result.newPriceAfterVat).toBeCloseTo((155 / 0.4) * 0.85, 4)
  })

  it('ignores stale stored cbm and derives from dimensions', () => {
    const result = computeKsaRowPricing(
      {
        purchasePriceEcommerce: 67.07,
        length: 55,
        width: 31,
        height: 14,
        dimensionUnit: 'cm',
        storageCost: 15,
        ksaShippingCost: 25,
        commissionPercent: 15,
        advertisingPercent: 15,
        vatKsaPercent: 15,
        profitPercent: 15,
      },
      { freightRatePerCbm: 1353 }
    )
    expect(result.cbm).toBeCloseTo(0.02387, 4)
    expect(result.cargoCost).toBeCloseTo(32.29, 1)
    expect(result.cargoCost).not.toBeCloseTo(2.3, 1)
  })
})
