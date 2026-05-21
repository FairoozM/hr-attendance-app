import {
  PREF_ALL_PRICES_CLEANUP_BATCHES,
  PREF_ALL_PRICES_CLEANUP_BATCHES_KSA,
  PREF_ALL_PRICES_EC,
  PREF_ALL_PRICES_EC_KSA,
  PREF_ALL_PRICES_HISTORY,
  PREF_ALL_PRICES_HISTORY_KSA,
  PREF_ALL_PRICES_IMPORT_BATCHES,
  PREF_ALL_PRICES_IMPORT_BATCHES_KSA,
  PREF_ALL_PRICES_RECOVERY_SNAPSHOTS,
  PREF_ALL_PRICES_RECOVERY_SNAPSHOTS_KSA,
  PREF_ALL_PRICES_SAVED_LISTS,
  PREF_ALL_PRICES_SAVED_LISTS_KSA,
} from '../../constants/userPreferenceKeys'

export const PRICES_MARKET_UAE = 'uae'
export const PRICES_MARKET_KSA = 'ksa'

/** @typedef {'uae'|'ksa'} PricesMarketId */

/**
 * @type {Record<PricesMarketId, {
 *   id: PricesMarketId,
 *   label: string,
 *   pageTitle: string,
 *   currencyHint: string,
 *   routeAllPrices: string,
 *   prefs: {
 *     ec: string,
 *     savedLists: string,
 *     recovery: string,
 *     history: string,
 *     cleanupBatches: string,
 *     importBatches: string,
 *   },
 * }>}
 */
export const ALL_PRICES_MARKETS = {
  [PRICES_MARKET_UAE]: {
    id: PRICES_MARKET_UAE,
    label: 'UAE',
    pageTitle: 'All Prices (UAE)',
    currencyHint: 'UAE · AED',
    routeAllPrices: '/prices/all-prices',
    prefs: {
      ec: PREF_ALL_PRICES_EC,
      savedLists: PREF_ALL_PRICES_SAVED_LISTS,
      recovery: PREF_ALL_PRICES_RECOVERY_SNAPSHOTS,
      history: PREF_ALL_PRICES_HISTORY,
      cleanupBatches: PREF_ALL_PRICES_CLEANUP_BATCHES,
      importBatches: PREF_ALL_PRICES_IMPORT_BATCHES,
    },
  },
  [PRICES_MARKET_KSA]: {
    id: PRICES_MARKET_KSA,
    label: 'KSA',
    pageTitle: 'All Prices (KSA)',
    currencyHint: 'KSA · SAR',
    routeAllPrices: '/prices/all-prices-ksa',
    prefs: {
      ec: PREF_ALL_PRICES_EC_KSA,
      savedLists: PREF_ALL_PRICES_SAVED_LISTS_KSA,
      recovery: PREF_ALL_PRICES_RECOVERY_SNAPSHOTS_KSA,
      history: PREF_ALL_PRICES_HISTORY_KSA,
      cleanupBatches: PREF_ALL_PRICES_CLEANUP_BATCHES_KSA,
      importBatches: PREF_ALL_PRICES_IMPORT_BATCHES_KSA,
    },
  },
}

/** @param {string} [marketId] */
export function getAllPricesMarket(marketId) {
  const id = marketId === PRICES_MARKET_KSA ? PRICES_MARKET_KSA : PRICES_MARKET_UAE
  return ALL_PRICES_MARKETS[id]
}

/** @param {string} pathname */
export function resolveAllPricesMarketFromPath(pathname) {
  if (pathname.startsWith('/prices/all-prices-ksa')) return PRICES_MARKET_KSA
  if (pathname.startsWith('/prices/all-prices')) return PRICES_MARKET_UAE
  return PRICES_MARKET_UAE
}
