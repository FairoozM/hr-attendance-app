import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AllPricesPage } from './AllPricesPage'
import { PREF_ALL_PRICES_EC } from '../../constants/userPreferenceKeys'
import { requestUserPrefSave } from '../../lib/userPreferencesBridge'

const setPrefMock = vi.fn()
let prefsReady = false
let prefsStore = {}

vi.mock('../../contexts/UserPreferencesContext.jsx', () => ({
  useUserPreferences: () => ({
    ready: prefsReady,
    getPref: (key, fallback) => (Object.prototype.hasOwnProperty.call(prefsStore, key) ? prefsStore[key] : fallback),
    setPref: setPrefMock,
    prefsVersion: 0,
  }),
}))

vi.mock('../../lib/userPreferencesBridge', () => ({
  getUserPrefKey: vi.fn((key, fallback) => (Object.prototype.hasOwnProperty.call(prefsStore, key) ? prefsStore[key] : fallback)),
  requestUserPrefSave: vi.fn(),
}))

function brkhSeedRows(count = 17) {
  return Array.from({ length: count }, (_, i) => ({
    id: `seed-${i + 1}`,
    itemNo: `BRKH-64-${i + 1}`,
    purchasePrice: i === 0 ? 26.83 : '',
    shipping: i === 0 ? 21 : '',
    dateOfPrices: '',
  }))
}

describe('AllPricesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prefsStore = {}
    prefsReady = false
    vi.stubEnv('PROD', true)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('shows loading state before preferences hydrate and does not save', async () => {
    render(<AllPricesPage />)
    expect(screen.getByText(/Loading your saved price list/i)).toBeInTheDocument()
    expect(screen.queryByText(/BRKH-64-1/i)).not.toBeInTheDocument()
    expect(requestUserPrefSave).not.toHaveBeenCalled()
    expect(setPrefMock).not.toHaveBeenCalled()
  })

  it('shows empty state when preference key is missing after hydrate', async () => {
    prefsReady = true
    prefsStore = {}
    render(<AllPricesPage />)
    await waitFor(() => {
      expect(screen.queryAllByText(/No saved lists yet/i).length).toBeGreaterThan(0)
    })
    expect(screen.queryByText(/BRKH-64-1/i)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(requestUserPrefSave).not.toHaveBeenCalled()
    })
    expect(setPrefMock).not.toHaveBeenCalled()
  })

  it('does not show BRKH seed when DB bundle contains template rows in production', async () => {
    prefsReady = true
    prefsStore = {
      [PREF_ALL_PRICES_EC]: { rates: { vatPct: 5 }, rows: brkhSeedRows() },
    }
    render(<AllPricesPage />)
    await waitFor(() => {
      expect(screen.queryAllByText(/No saved lists yet/i).length).toBeGreaterThan(0)
    })
    expect(screen.queryByText(/BRKH-64-1/i)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(requestUserPrefSave).not.toHaveBeenCalled()
    })
  })
})
