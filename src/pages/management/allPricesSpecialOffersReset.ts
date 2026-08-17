import { PREF_ALL_PRICES_SPECIAL_OFFERS_DRAFT_RESET } from '../../constants/userPreferenceKeys'
import { PRICES_MARKET_UAE_SPECIAL_OFFERS } from './allPricesMarket'
import { buildAllPricesBundle, DEFAULT_RATES } from './allPricesEcommerceUtils'
import { normalizeSavedListsStore } from './allPricesSavedLists'

interface ResetOptions {
  market: string
  getPref: (key: string, fallback: unknown) => unknown
  setPref: (key: string, value: unknown) => void
  prefs: { ec: string; savedLists: string; recovery: string }
}

export function isSpecialOffersDraftResetComplete(raw: unknown): boolean {
  return Boolean(raw && typeof raw === 'object' && (raw as { completedAt?: unknown }).completedAt)
}

/**
 * Special offer prices are pasted by hand, so the catalog must start empty. A market-switch bug
 * autosaved the standard UAE table into this draft; clear it once, unless the user already saved
 * an offers list (their own data).
 *
 * @returns true when the draft was cleared
 */
export function applySpecialOffersDraftResetIfNeeded({
  market,
  getPref,
  setPref,
  prefs,
}: ResetOptions): boolean {
  if (market !== PRICES_MARKET_UAE_SPECIAL_OFFERS) return false
  if (isSpecialOffersDraftResetComplete(getPref(PREF_ALL_PRICES_SPECIAL_OFFERS_DRAFT_RESET, null))) {
    return false
  }

  const markDone = (reason: string) => {
    setPref(PREF_ALL_PRICES_SPECIAL_OFFERS_DRAFT_RESET, {
      completedAt: new Date().toISOString(),
      reason,
    })
  }

  if (normalizeSavedListsStore(getPref(prefs.savedLists, null)).savedLists.length) {
    markDone('kept_existing_offer_lists')
    return false
  }

  setPref(prefs.ec, buildAllPricesBundle(DEFAULT_RATES, []))
  setPref(prefs.recovery, { snapshots: [] })
  markDone('clear_standard_prices_leak')
  return true
}
