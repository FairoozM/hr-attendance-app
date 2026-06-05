import { PREF_ALL_PRICES_UAE_WHOLESALE_RESET } from '../../constants/userPreferenceKeys'
import { PRICES_MARKET_UAE } from './allPricesMarket'
import { buildAllPricesBundle, DEFAULT_RATES } from './allPricesEcommerceUtils'
import { emptySavedListsStore } from './allPricesSavedLists'

/**
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isUaeWholesaleResetComplete(raw) {
  return Boolean(raw && typeof raw === 'object' && raw.completedAt)
}

/**
 * Clear UAE All Prices draft + saved lists once so users can re-paste wholesale prices.
 *
 * @param {{
 *   market: string,
 *   getPref: (key: string, fallback: unknown) => unknown,
 *   setPref: (key: string, value: unknown) => void,
 *   prefs: { ec: string, savedLists: string, recovery: string },
 * }} options
 * @returns {boolean} true when reset ran
 */
export function applyUaeWholesaleResetIfNeeded({ market, getPref, setPref, prefs }) {
  if (market !== PRICES_MARKET_UAE) return false
  if (isUaeWholesaleResetComplete(getPref(PREF_ALL_PRICES_UAE_WHOLESALE_RESET, null))) return false

  setPref(prefs.savedLists, emptySavedListsStore())
  setPref(prefs.ec, buildAllPricesBundle(DEFAULT_RATES, []))
  setPref(prefs.recovery, { snapshots: [] })
  setPref(PREF_ALL_PRICES_UAE_WHOLESALE_RESET, {
    completedAt: new Date().toISOString(),
    reason: 'wholesale_repaste_20260605',
  })
  return true
}
