import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PurchasePlanningPage } from './PurchasePlanningPage'

const items = Array.from({ length: 88 }, (_, index) => ({
  id: index + 1,
  sku: `SKU-${index + 1}`,
  itemName: `Item ${index + 1}`,
  included: index < 79,
  finalQty: index < 79 ? 12 : 0,
  zohoItemId: `z-${index + 1}`,
  purchasePrice: 4,
  zohoItemActive: true,
  wholesaleAvailableQty: 20,
  suggestedQty: 12,
  currentZohoStock: 1,
  totalSalesLast3Months: 3,
  totalBundleUsageLast3Months: 0,
  totalUsageLast3Months: 3,
  matchType: 'exact',
  notes: '',
}))

const draftSummary = {
  id: 9,
  planNumber: 'PP-20261023140644-Q53Z',
  status: 'draft',
  itemsCount: 88,
  includedCount: 79,
  totalFinalQty: 948,
  createdAt: '2026-10-23T14:06:44.000Z',
}

const fullDraft = { ...draftSummary, items }

vi.mock('../../contexts/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    ready: true,
    prefsVersion: 1,
    getPref: () => null,
  }),
}))

vi.mock('../../api/client', () => ({
  PURCHASE_PLANNING_TIMEOUT_MS: 1000,
  api: {
    get: vi.fn(async (path) => {
      if (String(path).includes('enrichment-status')) return { running: false, lastError: null, lastSummary: null }
      if (String(path).includes('/plans/')) return { plan: fullDraft }
      if (String(path).includes('/plans')) {
        return {
          plans: [
            draftSummary,
            {
              id: 4,
              planNumber: 'PP-SENT',
              status: 'sent_to_zoho',
              zohoPurchaseOrderId: '4265011000043488001',
              purchaseOrderNumber: 'PO-2025100',
              itemsCount: 10,
              includedCount: 10,
              totalFinalQty: 20,
              createdAt: '2026-10-01T00:00:00.000Z',
            },
          ],
        }
      }
      if (String(path).includes('vigil-uploads')) {
        return { uploads: [{ id: 1, fileName: 'vigil.xlsx', rowsCount: 674, uploadedAt: '2026-09-15T14:00:00.000Z' }] }
      }
      if (String(path).includes('low-stock')) return { items: [] }
      return {}
    }),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    postForm: vi.fn(),
  },
}))

afterEach(() => {
  cleanup()
})

describe('PurchasePlanningPage', () => {
  it('shows a consumed batch as a finished workflow with one review step', async () => {
    render(<PurchasePlanningPage />)

    expect(await screen.findByRole('button', { name: /Continue to create Zoho PO/i })).toBeInTheDocument()
    expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(4)
    expect(screen.getAllByText('In progress').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('79 included · 88 lines')).toBeInTheDocument()
    expect(screen.queryByText('Blocked')).not.toBeInTheDocument()
    expect(screen.queryByText('Locked')).not.toBeInTheDocument()
    expect(screen.queryByText(/Upload low-stock SKUs first/i)).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Continue to create Zoho PO/i })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Review Quantities & Prices' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Upload Vigil Stock' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Continue to create Zoho PO/i }))
    expect(screen.getByRole('heading', { name: 'Create Zoho PO' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review Quantities & Prices' })).not.toBeInTheDocument()
    const createButton = screen.getByRole('button', { name: 'Create Draft PO in Zoho' })
    expect(createButton).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('e.g. PO-2026-001'), { target: { value: 'PO-2026-014' } })
    expect(createButton).toBeEnabled()
  })
})
