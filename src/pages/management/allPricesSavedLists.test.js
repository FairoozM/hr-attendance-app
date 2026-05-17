import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  addSavedListToStore,
  emptySavedListsStore,
  formatSavedListName,
  removeSavedListFromStore,
  updateSavedListInStore,
} from './allPricesSavedLists'

const DEFAULT_RATES = { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 }

describe('allPricesSavedLists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('formatSavedListName includes Saved Prices prefix', () => {
    const name = formatSavedListName(new Date('2026-05-17T11:49:00.000Z'))
    expect(name).toMatch(/^Saved Prices - /)
  })

  it('addSavedListToStore creates a visible saved instance', () => {
    const store = emptySavedListsStore()
    const result = addSavedListToStore(store, { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 }, [
      { itemNo: 'SKU-1', purchasePrice: '10', shipping: '5', dateOfPrices: '' },
    ])
    expect(result.blocked).toBe(false)
    expect(result.store.savedLists).toHaveLength(1)
    expect(result.store.activeSavedListId).toBe(result.entry.id)
    expect(result.entry.rows).toHaveLength(1)
  })

  it('updateSavedListInStore overwrites rows without duplicating list', () => {
    const first = addSavedListToStore(emptySavedListsStore(), DEFAULT_RATES, [
      { itemNo: 'A', purchasePrice: '1', shipping: '1' },
    ])
    const id = first.entry.id
    const updated = updateSavedListInStore(first.store, id, DEFAULT_RATES, [
      { itemNo: 'A', purchasePrice: '2', shipping: '2' },
      { itemNo: 'B', purchasePrice: '3', shipping: '3' },
    ])
    expect(updated.store.savedLists).toHaveLength(1)
    expect(updated.entry.rows).toHaveLength(2)
  })

  it('removeSavedListFromStore deletes one list', () => {
    const a = addSavedListToStore(emptySavedListsStore(), DEFAULT_RATES, [{ itemNo: 'A', purchasePrice: '1', shipping: '1' }])
    const b = addSavedListToStore(a.store, DEFAULT_RATES, [{ itemNo: 'B', purchasePrice: '2', shipping: '2' }])
    const next = removeSavedListFromStore(b.store, a.entry.id)
    expect(next.savedLists).toHaveLength(1)
    expect(next.savedLists[0].id).toBe(b.entry.id)
  })
})
