import { describe, expect, it, vi } from 'vitest'
import {
  PREF_ALL_PRICES_EC,
  PREF_ALL_PRICES_RECOVERY_SNAPSHOTS,
  PREF_ALL_PRICES_SAVED_LISTS,
  PREF_ALL_PRICES_UAE_WHOLESALE_RESET,
} from '../../constants/userPreferenceKeys'
import { applyUaeWholesaleResetIfNeeded } from './allPricesUaeWholesaleReset'

describe('allPricesUaeWholesaleReset', () => {
  it('clears UAE draft and saved lists once', () => {
    const setPref = vi.fn()
    const getPref = vi.fn((key) => {
      if (key === PREF_ALL_PRICES_UAE_WHOLESALE_RESET) return null
      if (key === PREF_ALL_PRICES_EC) return { rows: [{ itemNo: 'SKU-1', purchasePrice: '10', shipping: '2' }] }
      return null
    })

    const ran = applyUaeWholesaleResetIfNeeded({
      market: 'uae',
      getPref,
      setPref,
      prefs: {
        ec: PREF_ALL_PRICES_EC,
        savedLists: PREF_ALL_PRICES_SAVED_LISTS,
        recovery: PREF_ALL_PRICES_RECOVERY_SNAPSHOTS,
      },
    })

    expect(ran).toBe(true)
    expect(setPref).toHaveBeenCalledWith(PREF_ALL_PRICES_SAVED_LISTS, {
      activeSavedListId: null,
      savedLists: [],
    })
    expect(setPref).toHaveBeenCalledWith(PREF_ALL_PRICES_EC, expect.objectContaining({ rows: [] }))
    expect(setPref).toHaveBeenCalledWith(PREF_ALL_PRICES_RECOVERY_SNAPSHOTS, { snapshots: [] })
    expect(setPref).toHaveBeenCalledWith(
      PREF_ALL_PRICES_UAE_WHOLESALE_RESET,
      expect.objectContaining({ reason: 'wholesale_repaste_20260605' }),
    )
  })

  it('skips when reset already completed', () => {
    const setPref = vi.fn()
    const getPref = vi.fn(() => ({ completedAt: '2026-06-05T00:00:00.000Z' }))

    const ran = applyUaeWholesaleResetIfNeeded({
      market: 'uae',
      getPref,
      setPref,
      prefs: {
        ec: PREF_ALL_PRICES_EC,
        savedLists: PREF_ALL_PRICES_SAVED_LISTS,
        recovery: PREF_ALL_PRICES_RECOVERY_SNAPSHOTS,
      },
    })

    expect(ran).toBe(false)
    expect(setPref).not.toHaveBeenCalled()
  })
})
