import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PREF_ALL_PRICES_EC_SPECIAL_OFFERS } from '../../constants/userPreferenceKeys'

const prefsStore: Record<string, unknown> = {}
let prefsVersion = 0
let bumpPrefsVersion: () => void = () => {}

vi.mock('../../contexts/UserPreferencesContext', async () => {
  const { useState } = await import('react')
  return {
    useUserPreferences: () => {
      const [, setTick] = useState(0)
      bumpPrefsVersion = () => {
        prefsVersion += 1
        setTick((t) => t + 1)
      }
      return {
        ready: true,
        prefsVersion,
        getPref: (key: string, fallback: unknown) =>
          Object.prototype.hasOwnProperty.call(prefsStore, key) ? prefsStore[key] : fallback,
        setPref: (key: string, value: unknown) => {
          prefsStore[key] = value
        },
      }
    },
  }
})

vi.mock('../../lib/userPreferencesBridge', () => ({
  getUserPrefKey: (key: string, fallback: unknown) =>
    Object.prototype.hasOwnProperty.call(prefsStore, key) ? prefsStore[key] : fallback,
  setUserPrefKeyLocal: (key: string, value: unknown) => {
    prefsStore[key] = value
  },
  requestUserPrefSave: (key: string, value: unknown) => {
    prefsStore[key] = value
  },
  hydratePrefCache: () => {},
}))

vi.mock('../../api/client', () => ({ api: { post: vi.fn(async () => ({})) } }))

const { CompositeItemsPricesPage } = await import('./CompositeItemsPricesPage')

beforeEach(() => {
  for (const key of Object.keys(prefsStore)) delete prefsStore[key]
  prefsVersion = 0
})

afterEach(() => {
  cleanup()
})

describe('composite offers page follows the offers catalog', () => {
  it('reflects a newly saved offers list without a manual reload', async () => {
    prefsStore[PREF_ALL_PRICES_EC_SPECIAL_OFFERS] = {
      rates: { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 },
      rows: [],
    }

    render(
      <MemoryRouter>
        <CompositeItemsPricesPage variant="special-offers" />
      </MemoryRouter>,
    )

    const ratesNote = () => screen.getByRole('note').textContent || ''

    await waitFor(() => {
      expect(ratesNote()).toContain('VAT 5.0%')
    })

    prefsStore[PREF_ALL_PRICES_EC_SPECIAL_OFFERS] = {
      rates: { vatPct: 7, commissionPct: 12, advertisingPct: 15, requiredProfitPct: 25 },
      rows: [{ id: 'o1', itemNo: 'LIFEP12FRY-32SILVER', purchasePrice: 60.8, shipping: 28 }],
    }
    bumpPrefsVersion()

    await waitFor(() => {
      expect(ratesNote()).toContain('VAT 7.0%')
    })
    expect(ratesNote()).toContain('Commission 12.0%')
  })
})
