import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AllPricesPage } from './AllPricesPage'
import {
  PREF_ALL_PRICES_EC,
  PREF_ALL_PRICES_SAVED_LISTS,
  PREF_ALL_PRICES_UAE_WHOLESALE_RESET,
} from '../../constants/userPreferenceKeys'
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

vi.mock('../../components/Modal.jsx', () => ({
  Modal: ({ open, children, title }) => (open ? <div data-testid="modal">{title}{children}</div> : null),
}))

vi.mock('./AllPricesConfirmModal.jsx', () => ({
  AllPricesConfirmModal: () => null,
}))
vi.mock('./AllPricesLoadGuardModal.jsx', () => ({
  AllPricesLoadGuardModal: () => null,
}))
vi.mock('./AllPricesRevisionConflictModal.jsx', () => ({
  AllPricesRevisionConflictModal: () => null,
}))
vi.mock('./AllPricesActionToast.jsx', () => ({
  AllPricesActionToast: () => null,
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
    prefsStore = {
      [PREF_ALL_PRICES_UAE_WHOLESALE_RESET]: { completedAt: '2026-06-05T00:00:00.000Z' },
    }
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
    prefsStore = {
      [PREF_ALL_PRICES_UAE_WHOLESALE_RESET]: { completedAt: '2026-06-05T00:00:00.000Z' },
    }
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

  it('shows Save as Price List when no active saved list', async () => {
    prefsReady = true
    prefsStore = {}
    render(<AllPricesPage />)
    await waitFor(() => {
      const btn = screen.getAllByTestId('all-prices-primary-save')[0]
      expect(btn).toHaveTextContent(/Save as Price List/i)
    })
  })

  it('shows Saved disabled label when active list matches draft', async () => {
    prefsReady = true
    prefsStore = {
      [PREF_ALL_PRICES_SAVED_LISTS]: {
        activeSavedListId: 'list-a',
        savedLists: [
          {
            id: 'list-a',
            name: 'Test List',
            createdAt: '2026-05-17T10:00:00.000Z',
            updatedAt: '2026-05-17T10:00:00.000Z',
            revision: 1,
            rates: { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 },
            rows: [{ itemNo: 'A', purchasePrice: '1', shipping: '1', dateOfPrices: '' }],
          },
        ],
      },
    }
    render(<AllPricesPage />)
    expect(await screen.findByText('Test List')).toBeInTheDocument()
    await waitFor(() => {
      const savedBtn = screen
        .getAllByTestId('all-prices-primary-save')
        .find((el) => /^Saved$/i.test(el.textContent || ''))
      expect(savedBtn).toBeDefined()
      expect(savedBtn).toBeDisabled()
    })
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
