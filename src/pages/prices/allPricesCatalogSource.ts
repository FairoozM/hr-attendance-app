/**
 * Which copy of an All Prices market a consumer (composite pricing) should price from.
 *
 * The All Prices table lives in two places: the autosaved draft bundle and, once the user saves,
 * a named saved list that the page reloads on mount. Those can disagree — a second tab holding an
 * older table keeps autosaving its rows over the draft, so the draft can be older than the list
 * the user is actually editing. Pick whichever copy was written last.
 */
import { getAllPricesMarket, type PricesMarketId } from '../management/allPricesMarket'
import {
  DEFAULT_RATES,
  loadRatesForMarket,
  loadRowsForMarket,
  normalizeAllPricesRates,
  readBundleForMarket,
} from '../management/allPricesEcommerceUtils'
import { normalizeSavedListsStore } from '../management/allPricesSavedLists'
import { getUserPrefKey } from '../../lib/userPreferencesBridge'

export type AllPricesCatalogSourceKind = 'draft' | 'saved-list'

export type AllPricesCatalog = {
  rows: Record<string, unknown>[]
  rates: typeof DEFAULT_RATES
  source: AllPricesCatalogSourceKind
  savedListName: string | null
}

function timestamp(value: unknown): number {
  if (value == null || value === '') return 0
  const parsed = new Date(String(value)).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

/** How fresh a draft bundle is; autosaves move `draftUpdatedAt`, named saves move `lastSavedAt`. */
export function allPricesBundleStamp(bundle: unknown): number {
  if (!bundle || typeof bundle !== 'object') return 0
  const b = bundle as Record<string, unknown>
  return Math.max(timestamp(b.draftUpdatedAt), timestamp(b.lastSavedAt))
}

export function resolveAllPricesCatalog(marketId: PricesMarketId): AllPricesCatalog {
  const draft: AllPricesCatalog = {
    rows: (loadRowsForMarket(marketId) as Record<string, unknown>[] | null) || [],
    rates: loadRatesForMarket(marketId),
    source: 'draft',
    savedListName: null,
  }

  let activeList: Record<string, any> | null = null
  try {
    const store = normalizeSavedListsStore(
      getUserPrefKey(getAllPricesMarket(marketId).prefs.savedLists, null),
    )
    activeList = store.activeSavedListId
      ? store.savedLists.find((l: any) => l.id === store.activeSavedListId) || null
      : null
  } catch {
    activeList = null
  }
  if (!activeList) return draft

  const draftStamp = allPricesBundleStamp(readBundleForMarket(marketId))
  if (draftStamp >= timestamp(activeList.updatedAt)) return draft

  return {
    rows: (activeList.rows as Record<string, unknown>[]) || [],
    rates: normalizeAllPricesRates(activeList.rates),
    source: 'saved-list',
    savedListName: activeList.name != null ? String(activeList.name) : null,
  }
}
