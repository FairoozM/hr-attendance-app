import { beforeEach, describe, expect, it } from 'vitest'
import {
  PREF_ALL_PRICES_EC_SPECIAL_OFFERS,
  PREF_ALL_PRICES_HISTORY_SPECIAL_OFFERS,
  PREF_ALL_PRICES_RECOVERY_SNAPSHOTS_SPECIAL_OFFERS,
  PREF_ALL_PRICES_SAVED_LISTS_SPECIAL_OFFERS,
  PREF_ALL_PRICES_SPECIAL_OFFERS_DRAFT_RESET,
} from '../../constants/userPreferenceKeys'
import { getAllPricesMarket } from './allPricesMarket'
import { applySpecialOffersDraftResetIfNeeded } from './allPricesSpecialOffersReset'

const OFFERS_PREFS = getAllPricesMarket('uae-special-offers').prefs

const LEAKED_STANDARD_ROWS = [
  { id: 'r1', itemNo: 'BRKH-64-1', purchasePrice: 26.83, shipping: 21 },
  { id: 'r2', itemNo: 'BRKH-64-2', purchasePrice: 19.63, shipping: 20 },
]

let store: Record<string, any>

function run(market: string) {
  return applySpecialOffersDraftResetIfNeeded({
    market,
    getPref: (key, fallback) =>
      Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback,
    setPref: (key, value) => {
      store[key] = value
    },
    prefs: OFFERS_PREFS,
  })
}

beforeEach(() => {
  store = {
    [PREF_ALL_PRICES_EC_SPECIAL_OFFERS]: { rates: {}, rows: LEAKED_STANDARD_ROWS },
    [PREF_ALL_PRICES_RECOVERY_SNAPSHOTS_SPECIAL_OFFERS]: { snapshots: [{ id: 's1' }] },
  }
})

describe('special offers draft reset', () => {
  it('clears a draft that inherited the standard prices, once', () => {
    expect(run('uae-special-offers')).toBe(true)
    expect(store[PREF_ALL_PRICES_EC_SPECIAL_OFFERS].rows).toEqual([])
    expect(store[PREF_ALL_PRICES_RECOVERY_SNAPSHOTS_SPECIAL_OFFERS]).toEqual({ snapshots: [] })
    expect(store[PREF_ALL_PRICES_SPECIAL_OFFERS_DRAFT_RESET].completedAt).toBeTruthy()

    store[PREF_ALL_PRICES_EC_SPECIAL_OFFERS] = { rates: {}, rows: [{ id: 'own', itemNo: 'OFFER-1' }] }
    expect(run('uae-special-offers')).toBe(false)
    expect(store[PREF_ALL_PRICES_EC_SPECIAL_OFFERS].rows).toHaveLength(1)
  })

  it('keeps the draft when the user already saved an offers list', () => {
    store[PREF_ALL_PRICES_SAVED_LISTS_SPECIAL_OFFERS] = {
      activeSavedListId: 'list-1',
      savedLists: [{ id: 'list-1', name: 'Ramadan offers', rates: {}, rows: [], updatedAt: '2026-08-17T00:00:00.000Z' }],
    }

    expect(run('uae-special-offers')).toBe(false)
    expect(store[PREF_ALL_PRICES_EC_SPECIAL_OFFERS].rows).toHaveLength(2)
    expect(store[PREF_ALL_PRICES_SPECIAL_OFFERS_DRAFT_RESET].completedAt).toBeTruthy()
  })

  it('never touches the standard or KSA markets', () => {
    expect(run('uae')).toBe(false)
    expect(run('ksa')).toBe(false)
    expect(store[PREF_ALL_PRICES_EC_SPECIAL_OFFERS].rows).toHaveLength(2)
    expect(store[PREF_ALL_PRICES_SPECIAL_OFFERS_DRAFT_RESET]).toBeUndefined()
  })

  it('leaves history untouched', () => {
    store[PREF_ALL_PRICES_HISTORY_SPECIAL_OFFERS] = { rows: [{ itemNo: 'OFFER-1' }] }
    run('uae-special-offers')
    expect(store[PREF_ALL_PRICES_HISTORY_SPECIAL_OFFERS].rows).toHaveLength(1)
  })
})
