import { getAllPricesMarket, normalizeAllPricesMarketId, PRICES_MARKET_UAE } from './allPricesMarket'

let activeMarketId = PRICES_MARKET_UAE

/** @param {string} marketId */
export function setAllPricesMarketScope(marketId) {
  activeMarketId = normalizeAllPricesMarketId(marketId)
}

export function getAllPricesMarketScope() {
  return getAllPricesMarket(activeMarketId)
}

export function getAllPricesPrefsScope() {
  return getAllPricesMarketScope().prefs
}
