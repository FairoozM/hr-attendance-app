import { describe, expect, it } from 'vitest'
import {
  PREF_ALL_PRICES_EC,
  PREF_ALL_PRICES_EC_SPECIAL_OFFERS,
} from '../../constants/userPreferenceKeys'
import {
  getAllPricesMarket,
  PRICES_MARKET_UAE,
  PRICES_MARKET_UAE_SPECIAL_OFFERS,
  PROFIT_POLICY_ANY,
  PROFIT_POLICY_TARGET,
  resolveAllPricesMarketFromPath,
} from './allPricesMarket'
import {
  computeEcommercePriceRow,
  DEFAULT_RATES,
  parseExcelTsvPaste,
  profitMarginDisplayClass,
  purchaseMarkupPct,
} from './allPricesEcommerceUtils'
import { buildExportRowsFromRatesAndRows } from './allPricesSavedListExport'

/** Rows copied from the wholesales special offers sheet (item, sales, vat, comm, adv, shipping, purchase, …). */
const OFFERS_PASTE = [
  'LIFEEP12FRY-32SILVER\t210.00\t10.50\t31.50\t31.50\t28.00\t60.80\t162.30\t47.70\t245.39%\t22.71%',
  'LIFEEP17-10-BEIGE\t354.00\t17.70\t53.10\t53.10\t38.00\t170.02\t331.92\t22.08\t108.21%\t6.24%',
  'LIFEEP17-16\t35.00\t1.75\t5.25\t5.25\t17.00\t17.42\t46.67\t-11.67\t100.92%\t-33.34%',
].join('\n')

describe('All Prices (UAE) Special Offers market', () => {
  it('is a separate catalog from the standard UAE list', () => {
    const offers = getAllPricesMarket(PRICES_MARKET_UAE_SPECIAL_OFFERS)
    const uae = getAllPricesMarket(PRICES_MARKET_UAE)

    expect(offers.pageTitle).toBe('All Prices (UAE) Special Offers')
    expect(offers.routeAllPrices).toBe('/prices/all-prices-special-offers')
    expect(offers.prefs.ec).toBe(PREF_ALL_PRICES_EC_SPECIAL_OFFERS)
    expect(uae.prefs.ec).toBe(PREF_ALL_PRICES_EC)
    expect(Object.values(offers.prefs)).not.toContain(PREF_ALL_PRICES_EC)
  })

  it('allows any profit percentage while the standard list targets 25%', () => {
    const offers = getAllPricesMarket(PRICES_MARKET_UAE_SPECIAL_OFFERS)
    expect(offers.profitPolicy).toBe(PROFIT_POLICY_ANY)
    expect(getAllPricesMarket(PRICES_MARKET_UAE).profitPolicy).toBe(PROFIT_POLICY_TARGET)

    expect(profitMarginDisplayClass(6.24, PROFIT_POLICY_ANY)).toBe('')
    expect(profitMarginDisplayClass(22.71, PROFIT_POLICY_ANY)).toBe('')
    expect(profitMarginDisplayClass(0, PROFIT_POLICY_ANY)).toBe('')
    expect(profitMarginDisplayClass(-33.34, PROFIT_POLICY_ANY)).toBe('ap-ec-profit--low')

    expect(profitMarginDisplayClass(6.24)).toBe('ap-ec-profit--low')
    expect(profitMarginDisplayClass(22.71, PROFIT_POLICY_TARGET)).toBe('ap-ec-profit--low')
  })

  it('resolves the market from its own route without shadowing /prices/all-prices', () => {
    expect(resolveAllPricesMarketFromPath('/prices/all-prices-special-offers')).toBe(
      PRICES_MARKET_UAE_SPECIAL_OFFERS,
    )
    expect(resolveAllPricesMarketFromPath('/prices/all-prices')).toBe(PRICES_MARKET_UAE)
  })

  it('keeps pasted offer prices and reproduces the sheet totals', () => {
    const { rows, skippedHeader } = parseExcelTsvPaste(OFFERS_PASTE)
    expect(skippedHeader).toBe(false)
    expect(rows).toHaveLength(3)

    const [first, , loss] = rows
    expect(first.itemNo).toBe('LIFEEP12FRY-32SILVER')
    expect(first.salesPrice).toBe('210')
    expect(first.shipping).toBe('28')
    expect(first.purchasePrice).toBe('60.8')

    const computedFirst = computeEcommercePriceRow(first, DEFAULT_RATES)
    expect(computedFirst.salesPrice).toBe(210)
    expect(computedFirst.totalCost).toBeCloseTo(162.3, 2)
    expect(computedFirst.profit).toBeCloseTo(47.7, 2)
    expect(computedFirst.profitPct).toBeCloseTo(22.71, 2)
    expect(purchaseMarkupPct(computedFirst.salesPrice, first.purchasePrice)).toBeCloseTo(245.39, 2)

    const computedLoss = computeEcommercePriceRow(loss, DEFAULT_RATES)
    expect(computedLoss.profit).toBeCloseTo(-11.67, 2)
    expect(computedLoss.profitPct).toBeCloseTo(-33.34, 2)
    expect(purchaseMarkupPct(computedLoss.salesPrice, loss.purchasePrice)).toBeCloseTo(100.92, 2)
  })

  it('adds the profit % of purchase column only when requested', () => {
    const list = {
      rates: DEFAULT_RATES,
      rows: [{ itemNo: 'LIFEEP12FRY-32SILVER', salesPrice: '210', shipping: '28', purchasePrice: '60.8' }],
    }

    const withMarkup = buildExportRowsFromRatesAndRows(list, { includePurchaseMarkup: true })[0]
    expect(withMarkup['Profit % of purchase']).toBeCloseTo(245.39, 2)
    expect(withMarkup['Profit % of sales']).toBeCloseTo(22.71, 2)

    expect(buildExportRowsFromRatesAndRows(list)[0]).not.toHaveProperty('Profit % of purchase')
  })

  it('returns no markup when purchase price is missing', () => {
    expect(purchaseMarkupPct(210, '')).toBeNull()
    expect(purchaseMarkupPct(210, 0)).toBeNull()
  })
})
