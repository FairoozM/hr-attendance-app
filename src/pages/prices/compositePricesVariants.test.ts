import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PREF_ALL_PRICES_EC,
  PREF_ALL_PRICES_EC_SPECIAL_OFFERS,
  PREF_SAVED_COMPOSITES,
  PREF_SAVED_COMPOSITES_SPECIAL_OFFERS,
} from '../../constants/userPreferenceKeys'

const prefsStore: Record<string, unknown> = {}
const requestUserPrefSave = vi.fn()

vi.mock('../../lib/userPreferencesBridge', () => ({
  getUserPrefKey: (key: string, fallback: unknown) =>
    Object.prototype.hasOwnProperty.call(prefsStore, key) ? prefsStore[key] : fallback,
  requestUserPrefSave: (key: string, value: unknown) => requestUserPrefSave(key, value),
}))

const { loadRatesForMarket, loadRowsForMarket } = await import('../management/allPricesEcommerceUtils')
const { buildPurchasePriceMap, computeBundleEconomics } = await import('./compositeBundlePricingUtils')
const { resolveCompositeComponentPricing } = await import('./compositeComponentPricingResolver')
const {
  COMPOSITE_PRICES_SPECIAL_OFFERS,
  COMPOSITE_PRICES_STANDARD,
  getCompositePricesVariant,
} = await import('./compositePricesVariants')

const STANDARD_RATES = { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 }

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(prefsStore)) delete prefsStore[key]

  prefsStore[PREF_ALL_PRICES_EC] = {
    rates: STANDARD_RATES,
    rows: [{ id: 'std-1', itemNo: 'LIFEEP12FRY-32SILVER', purchasePrice: 100, shipping: 28 }],
  }
  prefsStore[PREF_ALL_PRICES_EC_SPECIAL_OFFERS] = {
    rates: { ...STANDARD_RATES, advertisingPct: 10 },
    rows: [{ id: 'offer-1', itemNo: 'LIFEEP12FRY-32SILVER', purchasePrice: 60.8, shipping: 28 }],
  }
})

describe('composite prices variants', () => {
  it('binds the special offers variant to the offers catalog and its own saved list', () => {
    const offers = getCompositePricesVariant(COMPOSITE_PRICES_SPECIAL_OFFERS)
    const standard = getCompositePricesVariant(COMPOSITE_PRICES_STANDARD)

    expect(offers.pricesMarket).toBe('uae-special-offers')
    expect(standard.pricesMarket).toBe('uae')
    expect(offers.calculatorRoute).toBe('/prices/composite-items-special-offers')
    expect(offers.savedRoute).toBe('/prices/saved-composite-items-special-offers')
    expect(offers.catalogRoute).toBe('/prices/all-prices-special-offers')
  })

  it('defaults to the standard variant for unknown ids', () => {
    expect(getCompositePricesVariant().id).toBe(COMPOSITE_PRICES_STANDARD)
    expect(getCompositePricesVariant('nope').id).toBe(COMPOSITE_PRICES_STANDARD)
  })

  it('reads component purchase prices from the offers catalog, not the standard one', () => {
    const offersRows = loadRowsForMarket('uae-special-offers') || []
    const standardRows = loadRowsForMarket('uae') || []

    const component = { sku: 'LIFEEP12FRY-32SILVER', name: 'Fry pan', quantity: 2 }
    const fromOffers = resolveCompositeComponentPricing(
      component,
      buildPurchasePriceMap(offersRows),
      STANDARD_RATES,
    )
    const fromStandard = resolveCompositeComponentPricing(
      component,
      buildPurchasePriceMap(standardRows),
      STANDARD_RATES,
    )

    expect(fromOffers.matchedAllPricesRecordFound).toBe(true)
    expect(fromOffers.purchasePrice).toBe(60.8)
    expect(fromOffers.linePurchaseTotal).toBeCloseTo(121.6, 6)
    expect(fromStandard.purchasePrice).toBe(100)
  })

  it('uses the offers catalog rates for the bundle rollup', () => {
    const rates = loadRatesForMarket('uae-special-offers')
    expect(rates.advertisingPct).toBe(10)

    const economics = computeBundleEconomics(121.6, 0, rates)
    expect(economics.ok).toBe(true)
    // denominator 1 - 0.05 - 0.15 - 0.10 - 0.25 = 0.45 → ceil(121.6 / 0.45) = 271
    expect(economics.salesPrice).toBe(271)
    expect(economics.profitPct).toBeGreaterThanOrEqual(25)
  })

  it('falls back to default rates when the offers catalog is empty', () => {
    delete prefsStore[PREF_ALL_PRICES_EC_SPECIAL_OFFERS]
    expect(loadRowsForMarket('uae-special-offers')).toEqual([])
    expect(loadRatesForMarket('uae-special-offers')).toEqual(STANDARD_RATES)
  })

  it('saves composites to the variant preference key', () => {
    getCompositePricesVariant(COMPOSITE_PRICES_SPECIAL_OFFERS).savedStore.save({ sku: 'BUNDLE-1' })
    expect(requestUserPrefSave).toHaveBeenCalledWith(
      PREF_SAVED_COMPOSITES_SPECIAL_OFFERS,
      expect.arrayContaining([expect.objectContaining({ sku: 'BUNDLE-1' })]),
    )

    requestUserPrefSave.mockClear()
    getCompositePricesVariant(COMPOSITE_PRICES_STANDARD).savedStore.save({ sku: 'BUNDLE-1' })
    expect(requestUserPrefSave).toHaveBeenCalledWith(PREF_SAVED_COMPOSITES, expect.any(Array))
  })

  it('keeps the two saved lists independent', () => {
    prefsStore[PREF_SAVED_COMPOSITES] = [{ sku: 'STD-1', updated_at: '2026-08-01T00:00:00.000Z' }]
    prefsStore[PREF_SAVED_COMPOSITES_SPECIAL_OFFERS] = [
      { sku: 'OFFER-1', updated_at: '2026-08-02T00:00:00.000Z' },
    ]

    expect(getCompositePricesVariant(COMPOSITE_PRICES_STANDARD).savedStore.load().map((i) => i.sku)).toEqual([
      'STD-1',
    ])
    expect(
      getCompositePricesVariant(COMPOSITE_PRICES_SPECIAL_OFFERS).savedStore.load().map((i) => i.sku),
    ).toEqual(['OFFER-1'])
  })
})
