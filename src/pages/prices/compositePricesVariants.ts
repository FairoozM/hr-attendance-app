/**
 * Composite bundle pricing comes in variants that share the same math but read component
 * purchase prices from different All Prices catalogs and save to different lists.
 */

import {
  PRICES_MARKET_UAE,
  PRICES_MARKET_UAE_SPECIAL_OFFERS,
  type PricesMarketId,
} from '../management/allPricesMarket'
import {
  loadSavedCompositeItems,
  loadSavedCompositeItemsSpecialOffers,
  removeSavedCompositeItem,
  removeSavedCompositeItemSpecialOffers,
  SAVED_COMPOSITES_SPECIAL_OFFERS_UPDATED_EVENT,
  SAVED_COMPOSITES_UPDATED_EVENT,
  saveSavedCompositeItem,
  saveSavedCompositeItemSpecialOffers,
  STORAGE_KEY_SAVED_COMPOSITES,
  STORAGE_KEY_SAVED_COMPOSITES_SPECIAL_OFFERS,
} from './compositeBundlePricingUtils'

export const COMPOSITE_PRICES_STANDARD = 'standard'
export const COMPOSITE_PRICES_SPECIAL_OFFERS = 'special-offers'

export type CompositePricesVariantId = 'standard' | 'special-offers'

export type SavedCompositeRecord = Record<string, any>

export interface SavedCompositeStore {
  load: () => SavedCompositeRecord[]
  save: (record: SavedCompositeRecord) => SavedCompositeRecord
  remove: (sku: string) => SavedCompositeRecord[]
  updatedEvent: string
  storageKey: string
}

export interface CompositePricesVariant {
  id: CompositePricesVariantId
  /** All Prices market the component purchase prices and rates are read from. */
  pricesMarket: PricesMarketId
  calculatorTitle: string
  calculatorRoute: string
  savedTitle: string
  savedRoute: string
  catalogLabel: string
  /** Short form for table headers. */
  catalogShortLabel: string
  catalogRoute: string
  /** Where duplicate active prices for this catalog are resolved. */
  duplicateFixLabel: string
  duplicateFixRoute: string
  savedStore: SavedCompositeStore
}

export const COMPOSITE_PRICES_VARIANTS: Record<CompositePricesVariantId, CompositePricesVariant> = {
  [COMPOSITE_PRICES_STANDARD]: {
    id: COMPOSITE_PRICES_STANDARD,
    pricesMarket: PRICES_MARKET_UAE as PricesMarketId,
    calculatorTitle: 'Composite Items Prices',
    calculatorRoute: '/prices/composite-items',
    savedTitle: 'Saved Composite Items',
    savedRoute: '/prices/saved-composite-items',
    catalogLabel: 'All Prices (UAE)',
    catalogShortLabel: 'All Prices',
    catalogRoute: '/prices/all-prices',
    duplicateFixLabel: 'Duplicate Price Cleanup',
    duplicateFixRoute: '/prices/duplicate-cleanup',
    savedStore: {
      load: loadSavedCompositeItems,
      save: saveSavedCompositeItem,
      remove: removeSavedCompositeItem,
      updatedEvent: SAVED_COMPOSITES_UPDATED_EVENT,
      storageKey: STORAGE_KEY_SAVED_COMPOSITES,
    },
  },
  [COMPOSITE_PRICES_SPECIAL_OFFERS]: {
    id: COMPOSITE_PRICES_SPECIAL_OFFERS,
    pricesMarket: PRICES_MARKET_UAE_SPECIAL_OFFERS as PricesMarketId,
    calculatorTitle: 'Composite Items Prices — Special Offers',
    calculatorRoute: '/prices/composite-items-special-offers',
    savedTitle: 'Saved Composite Items (Special Offers)',
    savedRoute: '/prices/saved-composite-items-special-offers',
    catalogLabel: 'All Prices (UAE) Special Offers',
    catalogShortLabel: 'Special Offers',
    catalogRoute: '/prices/all-prices-special-offers',
    duplicateFixLabel: 'All Prices (UAE) Special Offers',
    duplicateFixRoute: '/prices/all-prices-special-offers',
    savedStore: {
      load: loadSavedCompositeItemsSpecialOffers,
      save: saveSavedCompositeItemSpecialOffers,
      remove: removeSavedCompositeItemSpecialOffers,
      updatedEvent: SAVED_COMPOSITES_SPECIAL_OFFERS_UPDATED_EVENT,
      storageKey: STORAGE_KEY_SAVED_COMPOSITES_SPECIAL_OFFERS,
    },
  },
}

export function getCompositePricesVariant(id?: string): CompositePricesVariant {
  return id === COMPOSITE_PRICES_SPECIAL_OFFERS
    ? COMPOSITE_PRICES_VARIANTS[COMPOSITE_PRICES_SPECIAL_OFFERS]
    : COMPOSITE_PRICES_VARIANTS[COMPOSITE_PRICES_STANDARD]
}
