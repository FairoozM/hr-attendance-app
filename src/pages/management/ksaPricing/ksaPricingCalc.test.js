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
        cbm: 0,
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
    expect(result.newPriceAfterVat).toBeCloseTo((155 / 0.4) * 0.85, 4)
  })
})
