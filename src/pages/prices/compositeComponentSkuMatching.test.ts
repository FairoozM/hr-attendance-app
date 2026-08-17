import { describe, expect, it } from 'vitest'
import {
  buildPurchasePriceMap,
  resolveCompositeComponentPricing,
} from './compositeComponentPricingResolver'

const RATES = { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 }

/** Zoho keeps the EAN in `sku` and the catalog code in `name`, often without the list's hyphen. */
const HYPHENLESS_COMPONENT = {
  item_id: '4265011000008395725',
  sku: 'LIFEP12SHR32SILVER',
  name: 'LIFEP12SHR32SILVER',
  match_keys: ['6294021003384', 'LIFEP12SHR32SILVER'],
  quantity: 2,
}

function resolve(component: unknown, rows: unknown[]) {
  return resolveCompositeComponentPricing(component, buildPurchasePriceMap(rows), RATES)
}

describe('composite component SKU matching ignores separators', () => {
  it('matches a hyphen-less Zoho code to a hyphenated price row', () => {
    const resolved = resolve(HYPHENLESS_COMPONENT, [
      { id: '1', itemNo: 'LIFEP12SHR-32SILVER', purchasePrice: 60.8, shipping: 28 },
    ])

    expect(resolved.matchedAllPricesRecordFound).toBe(true)
    expect(resolved.matchedAllPricesItemNo).toBe('LIFEP12SHR-32SILVER')
    expect(resolved.purchasePrice).toBe(60.8)
    expect(resolved.linePurchaseTotal).toBeCloseTo(121.6, 6)
  })

  it('matches a hyphenated Zoho code to a hyphen-less price row', () => {
    const resolved = resolve(
      { sku: 'LIFEP12SHR-32-SILVER', match_keys: ['LIFEP12SHR-32-SILVER'], quantity: 1 },
      [{ id: '1', itemNo: 'LIFEP12SHR32SILVER', purchasePrice: 60.8 }],
    )

    expect(resolved.matchedAllPricesItemNo).toBe('LIFEP12SHR32SILVER')
    expect(resolved.purchasePrice).toBe(60.8)
  })

  it('still matches codes that already agree on separators', () => {
    const rows = [
      { id: '1', itemNo: 'LIFEP12SAU-16SILVER', purchasePrice: 40 },
      { id: '2', itemNo: 'LIFEP12-6SILVER', purchasePrice: 25 },
    ]
    expect(resolve({ sku: 'LIFEP12SAU-16SILVER', quantity: 1 }, rows).purchasePrice).toBe(40)
    expect(resolve({ sku: 'LIFEP12-6SILVER', quantity: 1 }, rows).purchasePrice).toBe(25)
  })

  it('does not collapse distinct codes into one another', () => {
    const resolved = resolve({ sku: 'LIFEP12SHR32SILVER', quantity: 1 }, [
      { id: '1', itemNo: 'LIFEP12SHR-32BLACK', purchasePrice: 60.8 },
      { id: '2', itemNo: 'LIFEP12SHR-30SILVER', purchasePrice: 55 },
    ])

    expect(resolved.matchedAllPricesRecordFound).toBe(false)
    expect(resolved.matchStatus).toBe('unmatched')
  })

  it('flags two price rows that differ only by separators instead of guessing', () => {
    const resolved = resolve({ sku: 'LIFEP12SHR32SILVER', quantity: 1 }, [
      { id: '1', itemNo: 'LIFEP12SHR-32SILVER', purchasePrice: 60.8 },
      { id: '2', itemNo: 'LIFEP12SHR32SILVER', purchasePrice: 71.5 },
    ])

    expect(resolved.matchStatus).toBe('DUPLICATE_ACTIVE_PRICE')
    expect(resolved.matchedAllPricesRecordFound).toBe(false)
  })

  it('ignores inactive price rows', () => {
    const resolved = resolve({ sku: 'LIFEP12SHR32SILVER', quantity: 1 }, [
      { id: '1', itemNo: 'LIFEP12SHR-32SILVER', purchasePrice: 60.8, isActive: false },
    ])

    expect(resolved.matchedAllPricesRecordFound).toBe(false)
  })
})
