/**
 * Amazon KSA Control Tower pages: missing Amazon values render as a dash (never 0), Refresh All
 * starts a background run (202) and shows step progress from polling, and SKU mapping actions call
 * only our own API.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
const post = vi.fn()
const put = vi.fn()

vi.mock('../../api/client', () => ({ api: { get, post, put } }))

const { default: AmazonKsaCommandCenterPage } = await import('./AmazonKsaCommandCenterPage')
const { default: AmazonKsaSkuMappingPage } = await import('./AmazonKsaSkuMappingPage')

const BASE = '/api/amazon/control-tower/ksa'

function commandCenter(overrides: Record<string, unknown> = {}) {
  return {
    marketplaceKey: 'ksa',
    currency: 'SAR',
    timezone: 'Asia/Riyadh',
    today: '2026-10-05',
    generatedAt: '2026-10-05T09:30:00Z',
    settings: { lowStockUnitsThreshold: 10 },
    salesBasis: 'Net item sales excluding VAT.',
    salesProvisional: true,
    salesCaveat: 'Provisional: not yet reconciled against settlements.',
    inventorySource: {
      source: 'FBA Inventory API (getInventorySummaries)',
      fulfillmentModel: 'UNVERIFIED',
      caveat: 'KSA fulfillment model (classic FBA vs Seller Flex) is not verified.',
    },
    kpis: {
      todaySales: null,
      yesterdaySales: 300,
      last7DaysSales: 400,
      last30DaysSales: 400,
      unitsSold30d: 4,
      activeSkus: 2,
      fbaFulfillableUnits: null,
      inboundUnits: null,
      reservedUnits: null,
      unfulfillableUnits: null,
      outOfStockSkus: 1,
      lowStockSkus: 0,
      unmappedSkus: 0,
      activeSkusWithoutFbaData: 0,
    },
    tables: {
      outOfStock: {
        total: 1,
        rows: [{ id: 1, sellerSku: 'LIFEP17-OOS', asin: 'B0OOS', title: 'Pan', fbaFulfillable: 0, inbound: null, warehouseAvailable: null, mappingStatus: 'UNMAPPED', units7d: 2, units30d: 4 }],
      },
      lowStock: { total: 0, threshold: 10, rows: [] },
      unmapped: { total: 0, rows: [] },
    },
    snapshots: { inventorySnapshotAt: '2026-10-05T09:00:00Z', warehouseSnapshotAt: null },
    coverage: { orderLines: { firstPurchaseAt: null, lastPurchaseAt: null, lineCount: 0 }, dailySales: { firstDate: null, lastDate: null, daysWithSales: 0 } },
    freshness: {
      marketplaceKey: 'ksa',
      generatedAt: '2026-10-05T09:30:00Z',
      sources: [
        { key: 'fba_inventory', label: 'FBA inventory', jobType: 'fba_inventory', status: 'ERROR', lastSuccessAt: null, ageMs: null, lastError: 'Amazon throttled', warnAfterMs: 1, staleAfterMs: 2, currentRun: null },
        { key: 'warehouse_inventory', label: 'Life Smile warehouse stock', jobType: 'warehouse_stock', status: 'NEVER_SYNCED', lastSuccessAt: null, ageMs: null, lastError: null, warnAfterMs: 1, staleAfterMs: 2, currentRun: null },
      ],
    },
    ...overrides,
  }
}

function step(key: string, label: string, status: string) {
  return { key, label, runId: null, status, error: null, recordsProcessed: 0, startedAt: null, finishedAt: null }
}

function run(status: string, steps: ReturnType<typeof step>[]) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    marketplaceKey: 'ksa',
    jobType: 'refresh_all',
    triggerSource: 'manual',
    parentRunId: null,
    status,
    currentStep: null,
    progressCurrent: 0,
    progressTotal: steps.length,
    recordsProcessed: 0,
    errorMessage: null,
    metadata: { steps },
    requestedBy: 'user:1',
    queuedAt: '2026-10-05T09:30:00Z',
    startedAt: '2026-10-05T09:30:01Z',
    heartbeatAt: null,
    finishedAt: null,
    durationMs: null,
    children: [],
  }
}

beforeEach(() => {
  get.mockReset()
  post.mockReset()
  put.mockReset()
})

afterEach(() => cleanup())

describe('Amazon KSA Command Center', () => {
  it('shows missing Amazon values as a dash, not zero, and lists out-of-stock SKUs and freshness', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === `${BASE}/command-center`) return commandCenter()
      if (path.startsWith(`${BASE}/runs`)) return { runs: [] }
      throw new Error(`unexpected GET ${path}`)
    })
    render(<MemoryRouter><AmazonKsaCommandCenterPage /></MemoryRouter>)

    const fulfillable = (await screen.findByText('FBA Fulfillable', { selector: '.ainv-summary-card__label' })).closest('.ainv-summary-card') as HTMLElement
    expect(within(fulfillable).getByText('—')).toBeTruthy()
    const today = screen.getByText('Today Sales (SAR) · provisional').closest('.ainv-summary-card') as HTMLElement
    expect(within(today).getByText('—')).toBeTruthy()
    expect(screen.getByText('SAR 300.00')).toBeTruthy()

    // Unverified fulfillment model: never a confident "Out of Stock" label.
    expect(screen.getByRole('note').textContent).toMatch(/Seller Flex/)
    expect(screen.getByText('Zero FBA Fulfillable (unverified)')).toBeTruthy()
    expect(screen.queryByText('Out of Stock')).toBeNull()
    expect(screen.queryByText('Out-of-Stock SKUs')).toBeNull()

    const oosRow = screen.getByText('LIFEP17-OOS').closest('tr') as HTMLElement
    expect(within(oosRow).getByText('0')).toBeTruthy()
    expect(within(oosRow).getAllByText('—').length).toBe(2)

    expect(screen.getByText('Amazon throttled')).toBeTruthy()
    expect(screen.getByText('NEVER SYNCED')).toBeTruthy()
    expect(post).not.toHaveBeenCalled()
  })

  it('Refresh All starts a background run, shows each step, and reloads when the run finishes', async () => {
    let ccCalls = 0
    const finished = run('succeeded', [
      step('listings', 'Listings / SKU sync', 'succeeded'),
      step('sales', 'Sales (order report) sync', 'succeeded'),
      step('rollup', 'Daily sales rollup', 'succeeded'),
      step('fba_inventory', 'FBA inventory', 'failed'),
      step('warehouse_stock', 'Warehouse stock', 'succeeded'),
      step('freshness', 'Data freshness', 'succeeded'),
    ])
    get.mockImplementation(async (path: string) => {
      if (path === `${BASE}/command-center`) {
        ccCalls += 1
        return commandCenter()
      }
      if (path.startsWith(`${BASE}/runs?`)) return { runs: [] }
      if (path === `${BASE}/runs/${finished.id}`) return { run: finished }
      throw new Error(`unexpected GET ${path}`)
    })
    post.mockResolvedValue({ runIds: [finished.id], status: 'queued', alreadyRunning: false, jobType: 'refresh_all' })

    render(<MemoryRouter><AmazonKsaCommandCenterPage /></MemoryRouter>)
    await screen.findByText('LIFEP17-OOS')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh All' }))

    await screen.findByText('Listings / SKU sync')
    expect(post).toHaveBeenCalledWith(`${BASE}/refresh`, { jobType: 'refresh_all' })
    expect(screen.getByText('Warehouse stock')).toBeTruthy()
    expect(screen.getByText('Data freshness')).toBeTruthy()
    expect(screen.getByText('failed')).toBeTruthy()
    await waitFor(() => expect(ccCalls).toBe(2))
  })

  it('picks up a refresh that is already running when the page opens', async () => {
    const running = run('running', [step('listings', 'Listings / SKU sync', 'succeeded'), step('sales', 'Sales (order report) sync', 'running')])
    get.mockImplementation(async (path: string) => {
      if (path === `${BASE}/command-center`) return commandCenter()
      if (path.startsWith(`${BASE}/runs?`)) return { runs: [running] }
      if (path === `${BASE}/runs/${running.id}`) return { run: running }
      throw new Error(`unexpected GET ${path}`)
    })
    render(<MemoryRouter><AmazonKsaCommandCenterPage /></MemoryRouter>)
    await screen.findByText('Sales (order report) sync')
    expect((screen.getByRole('button', { name: 'Refreshing…' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Amazon KSA SKU Mapping', () => {
  const sku = {
    id: 7,
    marketplaceKey: 'ksa',
    sellerSku: 'SKU-A',
    normalizedSku: 'SKU-A',
    asin: 'B0A',
    fnsku: null,
    amazonTitle: 'Pan A',
    fulfillmentChannel: 'AMAZON_EU',
    listingStatus: 'ACTIVE',
    zohoItemId: 'z1',
    zohoItemCode: 'SKU-A',
    zohoItemName: 'Pan A (Zoho)',
    mappingStatus: 'AUTO_MATCHED',
    mappingMethod: 'EXACT_ITEM_CODE',
    mappingConfidence: 1,
    mappingCandidates: [{ zohoItemId: 'z1', itemCode: 'SKU-A', itemName: 'Pan A (Zoho)', method: 'EXACT_ITEM_CODE' }],
    confirmedBy: null,
    confirmedAt: null,
    packMultiplier: 1,
    cartonQuantity: null,
    active: true,
    lastSeenInListingsAt: null,
    lastSeenInInventoryAt: null,
    updatedAt: '2026-10-05T09:00:00Z',
  }

  function mockReads() {
    get.mockImplementation(async (path: string) => {
      if (path.startsWith(`${BASE}/sku-master?`)) {
        return { rows: [sku], total: 1, statusCounts: { CONFIRMED: 0, AUTO_MATCHED: 1, REVIEW_REQUIRED: 0, UNMAPPED: 0 } }
      }
      if (path === `${BASE}/settings`) {
        return {
          settings: { marketplaceKey: 'ksa', timezone: 'Asia/Riyadh', vatRate: 0.15, lowStockUnitsThreshold: 10, targetCoverDays: 45, maxCoverDays: 90, defaultLeadTimeDays: 14, defaultCartonQuantity: null, schedulerEnabled: false },
          schedules: [],
          schedulerEnvEnabled: false,
        }
      }
      if (path.startsWith(`${BASE}/runs?`)) return { runs: [] }
      throw new Error(`unexpected GET ${path}`)
    })
  }

  it('confirms an auto match and edits pack multiplier / carton quantity through our API', async () => {
    mockReads()
    post.mockResolvedValue({ sku: { ...sku, mappingStatus: 'CONFIRMED', confirmedBy: 'user:1', confirmedAt: '2026-10-05T10:00:00Z' } })
    put.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ sku: { ...sku, ...body, updatedAt: '2026-10-05T10:01:00Z' } }))

    render(<MemoryRouter><AmazonKsaSkuMappingPage /></MemoryRouter>)
    const row = (await screen.findByText('Pan A (Zoho)')).closest('tr') as HTMLElement
    expect(within(row).getByText('Exact item code')).toBeTruthy()
    expect(within(row).getByText('100%')).toBeTruthy()

    fireEvent.click(within(row).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith(`${BASE}/sku-master/7/confirm`, {}))
    await screen.findByText('CONFIRMED')

    const updatedRow = screen.getByText('Pan A (Zoho)').closest('tr') as HTMLElement
    fireEvent.change(within(updatedRow).getByLabelText('Pack multiplier'), { target: { value: '2' } })
    fireEvent.change(within(updatedRow).getByLabelText('Carton quantity'), { target: { value: '24' } })
    fireEvent.click(within(updatedRow).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(put).toHaveBeenCalledWith(`${BASE}/sku-master/7/parameters`, { packMultiplier: 2, cartonQuantity: 24 }))
    expect(screen.getByText('Timezone Asia/Riyadh', { exact: false })).toBeTruthy()
  })
})
