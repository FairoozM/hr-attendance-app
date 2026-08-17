import {
  PREF_ALL_PRICES_CLEANUP_BATCHES,
  PREF_ALL_PRICES_CLEANUP_BATCHES_KSA,
  PREF_ALL_PRICES_CLEANUP_BATCHES_SPECIAL_OFFERS,
  PREF_ALL_PRICES_EC,
  PREF_ALL_PRICES_EC_KSA,
  PREF_ALL_PRICES_EC_SPECIAL_OFFERS,
  PREF_ALL_PRICES_HISTORY,
  PREF_ALL_PRICES_HISTORY_KSA,
  PREF_ALL_PRICES_HISTORY_SPECIAL_OFFERS,
  PREF_ALL_PRICES_IMPORT_BATCHES,
  PREF_ALL_PRICES_IMPORT_BATCHES_KSA,
  PREF_ALL_PRICES_IMPORT_BATCHES_SPECIAL_OFFERS,
  PREF_ALL_PRICES_RECOVERY_SNAPSHOTS,
  PREF_ALL_PRICES_RECOVERY_SNAPSHOTS_KSA,
  PREF_ALL_PRICES_RECOVERY_SNAPSHOTS_SPECIAL_OFFERS,
  PREF_ALL_PRICES_SAVED_LISTS,
  PREF_ALL_PRICES_SAVED_LISTS_KSA,
  PREF_ALL_PRICES_SAVED_LISTS_SPECIAL_OFFERS,
} from '../../constants/userPreferenceKeys'

export const PRICES_MARKET_UAE = 'uae'
export const PRICES_MARKET_KSA = 'ksa'
export const PRICES_MARKET_UAE_SPECIAL_OFFERS = 'uae-special-offers'

/** @typedef {'uae'|'ksa'|'uae-special-offers'} PricesMarketId */

/** Profit % is expected around the 25% target — flag rows that fall short. */
export const PROFIT_POLICY_TARGET = 'target'
/** Offer prices: any profit % is valid, so only an actual loss is flagged. */
export const PROFIT_POLICY_ANY = 'any'

/** @typedef {'target'|'any'} ProfitPolicy */

/**
 * @type {Record<PricesMarketId, {
 *   id: PricesMarketId,
 *   label: string,
 *   pageTitle: string,
 *   pageDescription: string,
 *   routeAllPrices: string,
 *   routeDuplicateCleanup: string | null,
 *   profitPolicy: ProfitPolicy,
 *   exportFilePrefix: string,
 *   features: { cogs: boolean, formulaSandbox: boolean, purchaseMarkup: boolean },
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
    pageDescription:
      'Ecommerce selling price calculator (UAE · AED). Enter purchase price and shipping; sales price is derived so marketplace VAT, commission, advertising, and target profit are covered.',
    routeAllPrices: '/prices/all-prices',
    routeDuplicateCleanup: '/prices/duplicate-cleanup',
    profitPolicy: PROFIT_POLICY_TARGET,
    exportFilePrefix: 'saved-prices',
    features: { cogs: true, formulaSandbox: true, purchaseMarkup: false },
    prefs: {
      ec: PREF_ALL_PRICES_EC,
      savedLists: PREF_ALL_PRICES_SAVED_LISTS,
      recovery: PREF_ALL_PRICES_RECOVERY_SNAPSHOTS,
      history: PREF_ALL_PRICES_HISTORY,
      cleanupBatches: PREF_ALL_PRICES_CLEANUP_BATCHES,
      importBatches: PREF_ALL_PRICES_IMPORT_BATCHES,
    },
  },
  [PRICES_MARKET_UAE_SPECIAL_OFFERS]: {
    id: PRICES_MARKET_UAE_SPECIAL_OFFERS,
    label: 'UAE Special Offers',
    pageTitle: 'All Prices (UAE) Special Offers',
    pageDescription:
      'Promotional offer prices for the UAE marketplace (AED). The offer sales price is kept exactly as pasted, so any profit % is valid — well above 25%, only a few percent, or even a loss.',
    routeAllPrices: '/prices/all-prices-special-offers',
    routeDuplicateCleanup: null,
    profitPolicy: PROFIT_POLICY_ANY,
    exportFilePrefix: 'special-offer-prices',
    features: { cogs: false, formulaSandbox: true, purchaseMarkup: true },
    prefs: {
      ec: PREF_ALL_PRICES_EC_SPECIAL_OFFERS,
      savedLists: PREF_ALL_PRICES_SAVED_LISTS_SPECIAL_OFFERS,
      recovery: PREF_ALL_PRICES_RECOVERY_SNAPSHOTS_SPECIAL_OFFERS,
      history: PREF_ALL_PRICES_HISTORY_SPECIAL_OFFERS,
      cleanupBatches: PREF_ALL_PRICES_CLEANUP_BATCHES_SPECIAL_OFFERS,
      importBatches: PREF_ALL_PRICES_IMPORT_BATCHES_SPECIAL_OFFERS,
    },
  },
  [PRICES_MARKET_KSA]: {
    id: PRICES_MARKET_KSA,
    label: 'KSA',
    pageTitle: 'All Prices (KSA)',
    pageDescription:
      'Ecommerce selling price calculator (KSA · SAR · shipment batches). Enter purchase price and shipping; sales price is derived so marketplace VAT, commission, advertising, and target profit are covered.',
    routeAllPrices: '/prices/all-prices-ksa',
    routeDuplicateCleanup: null,
    profitPolicy: PROFIT_POLICY_TARGET,
    exportFilePrefix: 'saved-prices',
    features: { cogs: false, formulaSandbox: false, purchaseMarkup: false },
    prefs: {
      /** Legacy UAE-style ecommerce keys — KSA page uses ksa_pricing_store_v1 instead */
      ec: PREF_ALL_PRICES_EC_KSA,
      savedLists: PREF_ALL_PRICES_SAVED_LISTS_KSA,
      recovery: PREF_ALL_PRICES_RECOVERY_SNAPSHOTS_KSA,
      history: PREF_ALL_PRICES_HISTORY_KSA,
      cleanupBatches: PREF_ALL_PRICES_CLEANUP_BATCHES_KSA,
      importBatches: PREF_ALL_PRICES_IMPORT_BATCHES_KSA,
    },
  },
}

/** @param {string} [marketId] @returns {PricesMarketId} */
export function normalizeAllPricesMarketId(marketId) {
  const id = String(marketId ?? '')
  return Object.prototype.hasOwnProperty.call(ALL_PRICES_MARKETS, id) ? id : PRICES_MARKET_UAE
}

/** @param {string} [marketId] */
export function getAllPricesMarket(marketId) {
  return ALL_PRICES_MARKETS[normalizeAllPricesMarketId(marketId)]
}

/** @param {string} pathname */
export function resolveAllPricesMarketFromPath(pathname) {
  if (pathname.startsWith('/prices/all-prices-special-offers')) return PRICES_MARKET_UAE_SPECIAL_OFFERS
  if (pathname.startsWith('/prices/all-prices-ksa')) return PRICES_MARKET_KSA
  if (pathname.startsWith('/prices/all-prices-custom')) return PRICES_MARKET_UAE
  if (pathname.startsWith('/prices/all-prices')) return PRICES_MARKET_UAE
  return PRICES_MARKET_UAE
}
