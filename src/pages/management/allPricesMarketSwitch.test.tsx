import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PricesMarketId } from './allPricesMarket'
import {
  PREF_ALL_PRICES_EC,
  PREF_ALL_PRICES_EC_SPECIAL_OFFERS,
  PREF_ALL_PRICES_SPECIAL_OFFERS_DRAFT_RESET,
  PREF_ALL_PRICES_UAE_WHOLESALE_RESET,
} from '../../constants/userPreferenceKeys'

const prefsStore: Record<string, any> = {}

vi.mock('../../contexts/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    ready: true,
    prefsVersion: 0,
    getPref: (key: string, fallback: unknown) =>
      Object.prototype.hasOwnProperty.call(prefsStore, key) ? prefsStore[key] : fallback,
    setPref: (key: string, value: unknown) => {
      prefsStore[key] = value
    },
  }),
}))

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

const { AllPricesPage } = await import('./AllPricesPage')

const STANDARD_ROWS = [
  { id: 'r1', itemNo: 'BRKH-64-1', purchasePrice: 26.83, shipping: 21, dateOfPrices: '' },
  { id: 'r2', itemNo: 'BRKH-64-2', purchasePrice: 19.63, shipping: 20, dateOfPrices: '' },
]

function renderMarket(market: PricesMarketId) {
  return render(
    <MemoryRouter>
      <AllPricesPage market={market} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  for (const key of Object.keys(prefsStore)) delete prefsStore[key]
  prefsStore[PREF_ALL_PRICES_EC] = {
    rates: { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 },
    rows: STANDARD_ROWS,
  }
  // Both one-time resets already ran for this user, so they cannot mask the assertions.
  prefsStore[PREF_ALL_PRICES_UAE_WHOLESALE_RESET] = { completedAt: '2026-06-05T00:00:00.000Z' }
  prefsStore[PREF_ALL_PRICES_SPECIAL_OFFERS_DRAFT_RESET] = { completedAt: '2026-08-17T00:00:00.000Z' }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('All Prices market switching', () => {
  it('loads the standard UAE draft on the standard route', async () => {
    renderMarket('uae')
    expect(await screen.findByDisplayValue('BRKH-64-1')).toBeTruthy()
  })

  it('does not carry the standard table into Special Offers', async () => {
    // Navigating between markets reuses this component instance, so the switch is a prop change.
    const { rerender } = renderMarket('uae')
    await screen.findByDisplayValue('BRKH-64-1')

    rerender(
      <MemoryRouter>
        <AllPricesPage market="uae-special-offers" />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText(/All Prices \(UAE\) Special Offers/)).toBeTruthy()
    })
    expect(screen.queryByDisplayValue('BRKH-64-1')).toBeNull()
  })

  it('never writes standard rows into the special offers draft', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { rerender } = render(
      <MemoryRouter>
        <AllPricesPage market="uae" />
      </MemoryRouter>,
    )
    await vi.waitFor(() => expect(screen.getByDisplayValue('BRKH-64-1')).toBeTruthy())

    rerender(
      <MemoryRouter>
        <AllPricesPage market="uae-special-offers" />
      </MemoryRouter>,
    )
    await vi.advanceTimersByTimeAsync(2000)

    const offersRows = prefsStore[PREF_ALL_PRICES_EC_SPECIAL_OFFERS]?.rows ?? []
    expect(offersRows).toEqual([])
    expect(prefsStore[PREF_ALL_PRICES_EC].rows).toHaveLength(2)
  })
})
