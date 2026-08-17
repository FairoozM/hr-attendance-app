import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRICES_MARKET_UAE_SPECIAL_OFFERS } from '../management/allPricesMarket'
import {
  PREF_ALL_PRICES_EC_SPECIAL_OFFERS,
  PREF_ALL_PRICES_SAVED_LISTS_SPECIAL_OFFERS,
} from '../../constants/userPreferenceKeys'

const prefsStore: Record<string, unknown> = {}

vi.mock('../../lib/userPreferencesBridge', () => ({
  getUserPrefKey: (key: string, fallback: unknown) =>
    Object.prototype.hasOwnProperty.call(prefsStore, key) ? prefsStore[key] : fallback,
  setUserPrefKeyLocal: (key: string, value: unknown) => {
    prefsStore[key] = value
  },
  requestUserPrefSave: (key: string, value: unknown) => {
    prefsStore[key] = value
  },
}))

const { allPricesBundleStamp, resolveAllPricesCatalog } = await import('./allPricesCatalogSource')

const RATES = { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 }

function setDraft(rows: unknown[], stamps: Record<string, string> = {}) {
  prefsStore[PREF_ALL_PRICES_EC_SPECIAL_OFFERS] = { rates: RATES, rows, ...stamps }
}

function setSavedList(rows: unknown[], updatedAt: string) {
  prefsStore[PREF_ALL_PRICES_SAVED_LISTS_SPECIAL_OFFERS] = {
    activeSavedListId: 'list-1',
    savedLists: [
      {
        id: 'list-1',
        name: 'Saved Prices - 17/08/2026 10:29',
        createdAt: '2026-08-17T06:29:19.024Z',
        updatedAt,
        revision: 2,
        rates: RATES,
        rows,
      },
    ],
  }
}

const OLD_ROW = { id: 'a', itemNo: 'LIFEP12SHR32GOLD', purchasePrice: '62.06', shipping: '28' }
const NEW_ROW = { id: 'b', itemNo: 'LIFEP12SHR32SILVER', purchasePrice: '60.98', shipping: '28' }

beforeEach(() => {
  for (const key of Object.keys(prefsStore)) delete prefsStore[key]
})

describe('resolveAllPricesCatalog', () => {
  it('uses the active saved list when the draft is older (a stale tab overwrote it)', () => {
    setDraft([OLD_ROW], { lastSavedAt: '2026-08-17T06:29:19.024Z', draftUpdatedAt: '2026-08-17T06:29:19.024Z' })
    setSavedList([OLD_ROW, NEW_ROW], '2026-08-17T06:42:24.827Z')

    const catalog = resolveAllPricesCatalog(PRICES_MARKET_UAE_SPECIAL_OFFERS)

    expect(catalog.source).toBe('saved-list')
    expect(catalog.savedListName).toBe('Saved Prices - 17/08/2026 10:29')
    expect(catalog.rows.map((r) => r.itemNo)).toContain('LIFEP12SHR32SILVER')
  })

  it('keeps using the draft while it carries unsaved edits newer than the list', () => {
    setDraft([OLD_ROW, NEW_ROW], { draftUpdatedAt: '2026-08-17T07:00:00.000Z' })
    setSavedList([OLD_ROW], '2026-08-17T06:42:24.827Z')

    const catalog = resolveAllPricesCatalog(PRICES_MARKET_UAE_SPECIAL_OFFERS)

    expect(catalog.source).toBe('draft')
    expect(catalog.rows.map((r) => r.itemNo)).toContain('LIFEP12SHR32SILVER')
  })

  it('prefers a saved list over a draft that carries no stamp at all', () => {
    setDraft([OLD_ROW])
    setSavedList([OLD_ROW, NEW_ROW], '2026-08-17T06:42:24.827Z')

    expect(resolveAllPricesCatalog(PRICES_MARKET_UAE_SPECIAL_OFFERS).source).toBe('saved-list')
  })

  it('falls back to the draft when no list is active', () => {
    setDraft([OLD_ROW], { draftUpdatedAt: '2026-08-17T06:29:19.024Z' })
    prefsStore[PREF_ALL_PRICES_SAVED_LISTS_SPECIAL_OFFERS] = { activeSavedListId: null, savedLists: [] }

    const catalog = resolveAllPricesCatalog(PRICES_MARKET_UAE_SPECIAL_OFFERS)

    expect(catalog.source).toBe('draft')
    expect(catalog.rows).toHaveLength(1)
  })

  it('reads freshness from either stamp', () => {
    expect(allPricesBundleStamp(null)).toBe(0)
    expect(allPricesBundleStamp({ rows: [] })).toBe(0)
    expect(allPricesBundleStamp({ lastSavedAt: '2026-08-17T06:29:19.024Z' })).toBe(
      Date.parse('2026-08-17T06:29:19.024Z'),
    )
    expect(
      allPricesBundleStamp({
        lastSavedAt: '2026-08-17T06:29:19.024Z',
        draftUpdatedAt: '2026-08-17T06:45:24.420Z',
      }),
    ).toBe(Date.parse('2026-08-17T06:45:24.420Z'))
  })
})
