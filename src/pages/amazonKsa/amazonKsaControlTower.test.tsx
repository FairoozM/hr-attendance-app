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
const { default: AmazonKsaCapacityPage } = await import('./AmazonKsaCapacityPage')
const { default: AmazonKsaInventoryHealthPage } = await import('./AmazonKsaInventoryHealthPage')

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

    const fulfillable = (await screen.findByText('Active FBA Fulfillable', { selector: '.ainv-summary-card__label' })).closest('.ainv-summary-card') as HTMLElement
    expect(within(fulfillable).getByText('—')).toBeTruthy()
    const today = screen.getByText('Today Sales (SAR) · provisional').closest('.ainv-summary-card') as HTMLElement
    expect(within(today).getByText('—')).toBeTruthy()
    expect(screen.getByText('SAR 300.00')).toBeTruthy()

    // Unverified fulfillment model: never a confident "Out of Stock" label.
    const notes = screen.getAllByRole('note').map((n) => n.textContent)
    expect(notes.some((t) => /Seller Flex/.test(t || ''))).toBe(true)
    expect(notes.some((t) => /active stock is unknown/.test(t || ''))).toBe(true)
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

  it('shows ACTIVE-only KPIs, inactive-stock warnings and the listing status of each SKU', async () => {
    const cc = commandCenter()
    get.mockImplementation(async (path: string) => {
      if (path === `${BASE}/command-center`) {
        return {
          ...cc,
          kpis: {
            ...cc.kpis,
            activeSkus: 18,
            activeFbaSkus: 18,
            activeMfnSkus: 0,
            activeAmazonStockUnits: 140,
            fbaFulfillableUnits: 120,
            inactiveSkusWithFbaStock: 3,
            unitsInInactiveSkus: 45,
            estimatedCapacityWastedByInactive: { volumeCm3: 2_000_000, coveragePct: 50, source: 'CALCULATED', confidence: 'ESTIMATE', asOf: '2026-10-05T09:00:00Z' },
          },
          listingStatus: { known: true, operationalBasis: 'AMAZON_LISTING_STATUS_ACTIVE', refreshedAt: '2026-10-05T08:00:00Z', statusCounts: { ACTIVE: 18, INACTIVE: 884 }, source: 'x', error: null },
          physicalAllListings: { note: 'n', fulfillable: 500, inbound: 0, reserved: 10, unfulfillable: 4 },
          tables: {
            ...cc.tables,
            outOfStock: { total: 1, rows: [{ ...cc.tables.outOfStock.rows[0], listingStatus: 'ACTIVE' }] },
          },
        }
      }
      if (path.startsWith(`${BASE}/runs`)) return { runs: [] }
      throw new Error(`unexpected GET ${path}`)
    })
    render(<MemoryRouter><AmazonKsaCommandCenterPage /></MemoryRouter>)
    const card = (label: string) => screen.getByText(label, { selector: '.ainv-summary-card__label' }).closest('.ainv-summary-card') as HTMLElement
    await screen.findByText('Active KSA SKUs')
    expect(within(card('Active Amazon KSA Stock')).getByText('140')).toBeTruthy()
    expect(screen.queryByText(/active stock is unknown/)).toBeNull()
    expect(within(card('Active KSA SKUs')).getByText('18')).toBeTruthy()
    expect(within(card('Active FBA Fulfillable')).getByText('120')).toBeTruthy()
    expect(within(card('Inactive SKUs with FBA Stock')).getByText('3')).toBeTruthy()
    expect(within(card('Units in Inactive SKUs')).getByText('45')).toBeTruthy()
    const wasted = card('Estimated Capacity Wasted by Inactive Stock')
    expect(within(wasted).getByText(/2 m³/)).toBeTruthy()
    expect(within(wasted).getByText('ESTIMATE')).toBeTruthy()
    expect(screen.getByText(/count ACTIVE Amazon listings only/)).toBeTruthy()
    expect(screen.getByText(/All listings, physical at Amazon \(capacity view\): 500 fulfillable/)).toBeTruthy()
    const oosRow = screen.getByText('LIFEP17-OOS').closest('tr') as HTMLElement
    expect(within(oosRow).getByText('ACTIVE')).toBeTruthy()
  })

  it('before the first listing-status refresh shows active stock as unknown instead of guessing', async () => {
    const cc = commandCenter()
    get.mockImplementation(async (path: string) => {
      if (path === `${BASE}/command-center`) {
        return {
          ...cc,
          kpis: { ...cc.kpis, activeSkus: null, activeAmazonStockUnits: null, outOfStockSkus: null, inactiveSkusWithFbaStock: null, unitsInInactiveSkus: null },
          listingStatus: { known: false, operationalBasis: 'LISTING_STATUS_NOT_REFRESHED', refreshedAt: null, statusCounts: null, source: 'x', error: null },
          tables: { ...cc.tables, outOfStock: { total: 0, rows: [] } },
        }
      }
      if (path.startsWith(`${BASE}/runs`)) return { runs: [] }
      throw new Error(`unexpected GET ${path}`)
    })
    render(<MemoryRouter><AmazonKsaCommandCenterPage /></MemoryRouter>)
    const card = (label: string) => screen.getByText(label, { selector: '.ainv-summary-card__label' }).closest('.ainv-summary-card') as HTMLElement
    await screen.findByText(/active stock is unknown and no SKU is treated as active/)
    expect(within(card('Active Amazon KSA Stock')).getByText('—')).toBeTruthy()
    expect(within(card('Active KSA SKUs')).getByText('—')).toBeTruthy()
    expect(within(card('Active KSA SKUs')).getByText('Needs listing status refresh')).toBeTruthy()
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

const tally = (units: number, unitsWithVolume: number, volumeCm3: number) => ({
  units,
  unitsWithVolume,
  volumeCm3,
  coveragePct: units ? (unitsWithVolume / units) * 100 : null,
  isLowerBound: unitsWithVolume < units,
})

const NOT_CALCULATED = { status: 'NOT_CALCULATED_YET', reason: 'Replenishment engine is not built yet.' }

function capacityResponse(overrides: Record<string, unknown> = {}) {
  return {
    marketplaceKey: 'ksa',
    today: '2026-10-05',
    inventorySnapshotAt: '2026-10-05T09:00:00Z',
    listingStatusRefreshedAt: '2026-10-05T08:00:00Z',
    thresholds: { warnPct: 80, highPct: 90, criticalPct: 100, coverageMinPct: 95 },
    officialCapacityApi: { status: 'NOT_EXPOSED', note: 'Amazon SP-API exposes no capacity endpoint; enter the limit from Seller Central.' },
    currentPeriods: [],
    kpis: [
      {
        storageType: 'ALL',
        period: null,
        periodId: null,
        unit: null,
        officialCapacity: { value: null, status: 'LIMIT_MISSING', source: null, asOf: null, confidence: 'NONE' },
        used: null,
        inboundCommitted: null,
        available: null,
        utilizationPct: null,
        requiredByHealthyReplenishment: NOT_CALCULATED,
        shortfall: NOT_CALCULATED,
      },
    ],
    usage: {
      source: 'CALCULATED',
      asOf: '2026-10-05T09:00:00Z',
      onHand: tally(100, 80, 800_000),
      inbound: tally(0, 0, 0),
      total: tally(100, 80, 800_000),
      buckets: { fulfillable: tally(90, 72, 720_000), reserved: tally(0, 0, 0), researching: tally(0, 0, 0), unfulfillable: tally(10, 8, 80_000), inboundWorking: tally(0, 0, 0), inboundShipped: tally(0, 0, 0), inboundReceiving: tally(0, 0, 0) },
      byListingClass: { ACTIVE: tally(50, 50, 500_000), INACTIVE: tally(40, 22, 220_000), UNFULFILLABLE: tally(10, 8, 80_000), OTHER_UNKNOWN: tally(0, 0, 0) },
      byStorageType: { STANDARD: { onHand: tally(100, 80, 800_000), inbound: tally(0, 0, 0) } },
      coveragePct: 80,
      volumeSources: { AMAZON_PLANNING_ITEM_VOLUME: 3 },
      missingVolume: [{ sellerSku: 'NO-DIMS-1', title: 'Box without dims', onHandUnits: 20, inboundUnits: 0, listingClass: 'INACTIVE' }],
    },
    amazonPlanningStorageVolume: { volumeCm3: 900_000, skuCount: 3, source: 'AMAZON_REPORT', sourceLabel: 'Planning report', asOf: '2026-10-04', confidence: 'AMAZON_REPORTED', note: 'Not the capacity-monitor figure.' },
    volumeSourcePriority: [{ source: 'AMAZON_PLANNING_ITEM_VOLUME', label: 'Amazon planning item volume' }],
    storageTypesWithStock: ['STANDARD'],
    formula: 'Per SKU and bucket: volume = unit volume (cm³) × units in the bucket.',
    history: [],
    usageHistory: [{ id: 1, computedAt: '2026-10-05T09:00:00Z', inventorySnapshotAt: null, onHandUnits: 100, onHandUnitsWithVolume: 80, onHandVolumeCm3: 800_000, inboundWorkingVolumeCm3: 0, inboundShippedVolumeCm3: 0, inboundReceivingVolumeCm3: 0, coveragePct: 80, amazonPlanningStorageVolumeM3: 0.9 }],
    events: [],
    ...overrides,
  }
}

const period = {
  id: 5,
  marketplaceKey: 'ksa',
  periodStart: '2026-10-01',
  periodEnd: '2026-12-31',
  storageType: 'ALL',
  storageTypeLabel: null,
  capacityLimit: 100,
  capacityUnit: 'CUBIC_FEET',
  capacityUnitLabel: null,
  amazonReportedUsage: 40,
  calculatedUsage: 28.25,
  inboundUsage: 0,
  committedUsage: null,
  availableCapacity: 71.75,
  calculationSnapshotId: 1,
  source: 'SELLER_CENTRAL_MANUAL',
  sourceReference: null,
  enteredBy: 'user:1',
  enteredAt: '2026-10-05T09:10:00Z',
  verifiedAt: null,
  verifiedBy: null,
  notes: null,
  supersedesId: null,
  supersededById: null,
  supersededAt: null,
}

const calcFigure = (value: number) => ({ value, status: 'ESTIMATE', source: 'CALCULATED', asOf: '2026-10-05T09:00:00Z', confidence: 'LOW', coveragePct: 80, isLowerBound: true })
const officialFigure = (value: number) => ({ value, status: 'OFFICIAL', source: 'SELLER_CENTRAL_MANUAL', asOf: '2026-10-05T09:10:00Z', confidence: 'OFFICIAL' })

describe('Amazon KSA Capacity', () => {
  it('shows LIMIT MISSING, labels estimates, flags missing volume and history, and saves a manual capacity period', async () => {
    let loads = 0
    get.mockImplementation(async (path: string) => {
      if (path === `${BASE}/capacity`) {
        loads += 1
        return capacityResponse()
      }
      if (path.startsWith(`${BASE}/runs`)) return { runs: [] }
      throw new Error(`unexpected GET ${path}`)
    })
    post.mockResolvedValue({ period })
    render(<MemoryRouter><AmazonKsaCapacityPage /></MemoryRouter>)

    await screen.findByText('LIMIT MISSING')
    expect(screen.getAllByText('NOT CALCULATED YET').length).toBe(2)
    expect(screen.getByText(/Official capacity API: NOT EXPOSED/)).toBeTruthy()
    expect(screen.getAllByText('ESTIMATE').length).toBeGreaterThan(0)
    expect(screen.getByText('NO-DIMS-1')).toBeTruthy()
    expect(screen.getByText(/below 95%/)).toBeTruthy()
    expect(screen.getByText(/INSUFFICIENT HISTORY/)).toBeTruthy()
    expect(screen.getByText(/volume = unit volume/)).toBeTruthy()
    const planning = screen.getByText('Amazon planning storage volume').closest('.ainv-summary-card') as HTMLElement
    expect(within(planning).getByText(/Amazon report/)).toBeTruthy()
    const capCard = (label: string) => screen.getByText(label, { selector: '.ainv-summary-card__label' }).closest('.ainv-summary-card') as HTMLElement
    expect(screen.getByText('Physical Capacity Used (calculated)')).toBeTruthy()
    expect(within(capCard('Physical capacity used — total')).getByText(/needs an ALL-storage limit/)).toBeTruthy()
    expect(within(capCard('Active listings')).getByText(/50 units · 62\.5% of physical volume/)).toBeTruthy()
    expect(within(capCard('Inactive listings')).getByText(/40 units · 27\.5% of physical volume/)).toBeTruthy()
    expect(within(capCard('Unfulfillable')).getByText(/10 units · 10\.0% of physical volume/)).toBeTruthy()
    expect(within(capCard('Other / status unknown')).getByText(/0 units/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Period start'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Period end'), { target: { value: '2026-12-31' } })
    fireEvent.change(screen.getByLabelText('Capacity limit'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('Amazon-reported usage'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save capacity period' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`${BASE}/capacity/periods`, {
        periodStart: '2026-10-01',
        periodEnd: '2026-12-31',
        storageType: 'ALL',
        storageTypeLabel: null,
        capacityLimit: 100,
        capacityUnit: 'CUBIC_FEET',
        capacityUnitLabel: null,
        amazonReportedUsage: 40,
        source: 'SELLER_CENTRAL_MANUAL',
        sourceReference: null,
        notes: null,
      }),
    )
    await waitFor(() => expect(loads).toBe(2))
  })

  it('keeps official and calculated figures apart, and revises with only the changed fields', async () => {
    const kpi = {
      storageType: 'ALL',
      period,
      periodId: 5,
      unit: 'CUBIC_FEET',
      officialCapacity: { value: 100, status: 'OFFICIAL', source: 'SELLER_CENTRAL_MANUAL', asOf: '2026-10-05T09:10:00Z', confidence: 'OFFICIAL' },
      used: { official: officialFigure(40), calculated: calcFigure(28.25) },
      inboundCommitted: { calculated: calcFigure(0) },
      available: { official: officialFigure(60), calculated: calcFigure(71.75) },
      utilizationPct: { official: officialFigure(40), calculated: calcFigure(28.25) },
      requiredByHealthyReplenishment: NOT_CALCULATED,
      shortfall: NOT_CALCULATED,
    }
    get.mockImplementation(async (path: string) => {
      if (path === `${BASE}/capacity`) {
        return capacityResponse({
          currentPeriods: [period],
          kpis: [kpi],
          history: [{ ...period, calculatedUsageInPeriod: 28.25, calculatedAt: '2026-10-05T09:00:00Z', calculatedCoveragePct: 80, officialAvailable: 60, calculatedAvailable: 71.75, officialUtilizationPct: 40, calculatedUtilizationPct: 28.25 }],
          events: [{ id: 1, periodId: 5, previousPeriodId: null, action: 'CREATED', changes: { capacityLimit: 100 }, actor: 'user:1', createdAt: '2026-10-05T09:10:00Z' }],
        })
      }
      if (path.startsWith(`${BASE}/runs`)) return { runs: [] }
      throw new Error(`unexpected GET ${path}`)
    })
    put.mockResolvedValue({ period: { ...period, id: 6, capacityLimit: 120, supersedesId: 5 } })
    render(<MemoryRouter><AmazonKsaCapacityPage /></MemoryRouter>)

    const used = (await screen.findByText('Used', { selector: '.ainv-summary-card__label' })).closest('.ainv-summary-card') as HTMLElement
    expect(within(used).getByText('Official (Seller Central): 40 ft³')).toBeTruthy()
    expect(within(used).getByText('Calculated estimate: ≥ 28.25 ft³')).toBeTruthy()
    expect(within(used).getByText('ESTIMATE')).toBeTruthy()
    expect(within(used).getByText(/Seller Central \(manual entry\)/)).toBeTruthy()
    const capCard = (label: string) => screen.getByText(label, { selector: '.ainv-summary-card__label' }).closest('.ainv-summary-card') as HTMLElement
    expect(within(capCard('Physical capacity used — total')).getByText(/28\.3% of official limit/)).toBeTruthy()
    expect(within(capCard('Active listings')).getByText(/17\.7% of official limit/)).toBeTruthy()
    expect(within(capCard('Inactive listings')).getByText(/7\.8% of official limit/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Revise' }))
    await screen.findByText('Revise capacity period #5')
    fireEvent.change(screen.getByLabelText('Capacity limit'), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }))
    await waitFor(() => expect(put).toHaveBeenCalledWith(`${BASE}/capacity/periods/5`, { capacityLimit: 120 }))
    expect(screen.getByText('capacityLimit: 100')).toBeTruthy()
  })
})

function healthRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    sellerSku: 'ACT-1',
    asin: 'B0ACT',
    fnsku: null,
    title: 'Active pan',
    fulfillmentChannel: 'AMAZON',
    listingStatus: 'ACTIVE',
    listingStatusRaw: 'Active',
    listingStatusReason: null,
    searchSuppressed: false,
    fulfillable: 10,
    reserved: 1,
    inbound: null,
    unfulfillable: 0,
    researching: 0,
    units7d: 2,
    units30d: 9,
    units90d: 30,
    sales30Source: 'APP_DAILY_SALES',
    sales90Source: 'AMAZON_PLANNING_UNITS_SHIPPED',
    velocity7d: 0.29,
    velocity30d: 0.3,
    daysOfCover: 33,
    oldestAgeBucket: '0–30 days',
    agedUnits: 0,
    ageSnapshotDate: '2026-10-03',
    lastSaleDate: '2026-10-04',
    warehouseAvailable: null,
    mappingStatus: 'UNMAPPED',
    mappingIndicator: 'UNMAPPED',
    physicalFbaUnits: 11,
    unitVolumeCm3: null,
    volumeSource: null,
    storageType: 'Standard',
    capacityUsedCm3: null,
    healthStatus: 'HEALTHY',
    healthReason: 'Within thresholds',
    flags: ['VOLUME_DATA_MISSING'],
    recommendedAction: 'No action',
    amazonRecommendedAction: null,
    margin: null,
    replenishment: { eligible: true, reason: 'Amazon listing is ACTIVE' },
    ...overrides,
  }
}

const HEALTH_COUNTS = { HEALTHY: 1, WATCH: 0, SLOW: 0, EXCESS: 0, AGED: 0, ZERO_SALES: 0, OUT_ZERO_FBA: 0, DATA_INCOMPLETE: 0 }

function healthResponse(filter: string, rows: unknown[]) {
  return {
    marketplaceKey: 'ksa',
    filter,
    today: '2026-10-05',
    thresholds: {},
    healthCounts: HEALTH_COUNTS,
    listingStatusCounts: { ACTIVE: 1, INACTIVE: 1 },
    listingStatusRefreshedAt: '2026-10-05T08:00:00Z',
    inventorySnapshotAt: '2026-10-05T09:00:00Z',
    salesHistoryDays: 6,
    salesHistoryNote: 'App sales history covers 6 days (<90). The 12-month backfill has not been run.',
    marginNote: 'Margin not shown: cost and fee data are not reconciled enough to be trusted yet.',
    total: rows.length,
    rows,
  }
}

describe('Amazon KSA Inventory Health', () => {
  const inactiveRow = healthRow({ id: 2, sellerSku: 'INACT-1', title: 'Inactive pan', listingStatus: 'INACTIVE', listingStatusRaw: 'Inactive', healthStatus: 'ZERO_SALES', oldestAgeBucket: '181–270 days', agedUnits: 6, lastSaleDate: '2026-04-02', units30d: 0, units90d: 0, recommendedAction: 'Listing is not ACTIVE but holds FBA stock — fix the listing or remove the stock (Seller Central)', replenishment: { eligible: false, reason: 'Amazon listing is INACTIVE' } })

  function mockHealthReads() {
    get.mockImplementation(async (path: string) => {
      if (path.startsWith(`${BASE}/inventory-health?`)) {
        const filter = new URLSearchParams(path.split('?')[1]).get('filter') || 'active'
        return healthResponse(filter, filter === 'active' ? [healthRow()] : [inactiveRow])
      }
      if (path === `${BASE}/inventory-health/inactive-with-stock`) {
        return { marketplaceKey: 'ksa', listingStatusRefreshedAt: '2026-10-05T08:00:00Z', inventorySnapshotAt: '2026-10-05T09:00:00Z', summary: { skus: 1, units: 11, estimatedCapacityCm3: null, coveragePct: 0, source: 'CALCULATED', confidence: 'ESTIMATE' }, rows: [{ ...inactiveRow, inferredReason: null }] }
      }
      if (path.startsWith(`${BASE}/removal-orders?`)) {
        const status = new URLSearchParams(path.split('?')[1]).get('status')
        const row = { id: 9, removalOrderId: 'RMV-1', requestDate: '2026-09-01T00:00:00Z', lastUpdatedAt: null, sellerSku: 'INACT-1', fnsku: 'X00FN', asin: null, title: 'Inactive pan', disposition: 'Sellable', orderType: 'Return', orderSource: null, orderStatus: status === 'COMPLETED' ? 'Completed' : 'Pending', statusGroup: status === 'COMPLETED' ? 'COMPLETED' : 'OPEN', orderStatusGroup: 'OPEN', requestedQuantity: 5, shippedQuantity: 2, cancelledQuantity: 0, disposedQuantity: 1, inProcessQuantity: 2, completedQuantity: 3, removalFee: null, currency: null, firstSeenAt: null, lastSeenAt: null }
        return { marketplaceKey: 'ksa', status, counts: { OPEN: 1, COMPLETED: 98, CANCELLED: 0, UNKNOWN: 0 }, source: 'GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA (read-only)', completedFormula: 'Completed = shipped + disposed.', rows: [row] }
      }
      if (path === `${BASE}/capacity-release`) {
        return {
          marketplaceKey: 'ksa',
          inventorySnapshotAt: '2026-10-05T09:00:00Z',
          note: 'Recommendations only. Potential capacity released is shown, not allocated to replenishment.',
          summary: { opportunities: 1, potentialRemovalQty: 11, potentialCapacityReleasedCm3: null, volumeMissing: 1, source: 'CALCULATED', confidence: 'ESTIMATE' },
          rows: [{ primaryReason: 'INACTIVE_LISTING_WITH_AMAZON_STOCK', reasons: [{ reason: 'INACTIVE_LISTING_WITH_AMAZON_STOCK', quantity: 11, detail: 'Listing INACTIVE with 11 FBA units' }], priority: 'HIGH', potentialRemovalQty: 11, capacityPerUnitCm3: null, potentialCapacityReleasedCm3: null, volumeStatus: 'VOLUME_DATA_MISSING', confidence: 'LOW', sellerSku: 'INACT-1', asin: null, title: 'Inactive pan', listingStatus: 'INACTIVE', fbaUnits: 11, units30d: 0, units90d: 0, sales90Source: null, daysOfCover: null, oldestAgeBucket: null, volumeSource: null, mappingIndicator: 'UNMAPPED' }],
        }
      }
      if (path.startsWith(`${BASE}/actions?`)) {
        return { marketplaceKey: 'ksa', status: 'OPEN', actions: [{ id: 1, actionKey: 'ksa:INACTIVE_WITH_STOCK:INACT-1', actionType: 'INACTIVE_WITH_STOCK', severity: 'HIGH', title: 'Inactive listing INACT-1 holds FBA stock', detail: 'Remove or fix listing', entityType: 'sku', entityId: 'INACT-1', metadata: {}, status: 'OPEN', firstSeenAt: '2026-10-05T08:00:00Z', lastSeenAt: '2026-10-05T09:00:00Z', resolvedAt: null }] }
      }
      if (path.startsWith(`${BASE}/runs`)) return { runs: [] }
      throw new Error(`unexpected GET ${path}`)
    })
  }

  it('defaults to ACTIVE listings and keeps inactive stock in its own filter', async () => {
    mockHealthReads()
    render(<MemoryRouter><AmazonKsaInventoryHealthPage /></MemoryRouter>)
    await screen.findByText('ACT-1')
    expect(get).toHaveBeenCalledWith(`${BASE}/inventory-health?filter=active&limit=1000`)
    expect(screen.queryByText('INACT-1')).toBeNull()
    expect(screen.getByText(/Showing ACTIVE Amazon listings only/)).toBeTruthy()
    expect(screen.getByText(/12-month backfill has not been run/)).toBeTruthy()
    expect(screen.getByText(/Margin not shown/)).toBeTruthy()
    for (const header of ['Fulfillable', 'Reserved', 'Inbound', 'Unfulfillable', 'Researching', '7D Sales', '30D Sales', '90D Sales', '7D Velocity', '30D Velocity', 'Days of Cover', 'Inventory Age', 'Warehouse Available', 'Capacity Used', 'Health Status', 'Recommended Action']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeTruthy()
    }
    const row = screen.getByText('ACT-1').closest('tr') as HTMLElement
    expect(within(row).getByText('VOLUME DATA MISSING')).toBeTruthy()
    expect(within(row).getByText('UNMAPPED')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Inactive with Stock' }))
    await screen.findByText('INACT-1')
    expect(get).toHaveBeenCalledWith(`${BASE}/inventory-health?filter=inactive_with_stock&limit=1000`)
    expect(screen.queryByText('ACT-1')).toBeNull()
    expect(post).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it('lists inactive listings with FBA stock, removal orders by status, ranked release opportunities and daily actions (read-only)', async () => {
    mockHealthReads()
    render(<MemoryRouter><AmazonKsaInventoryHealthPage /></MemoryRouter>)
    await screen.findByText('ACT-1')

    fireEvent.click(screen.getByRole('tab', { name: 'Inactive with FBA Stock' }))
    await screen.findByText(/High-priority removal candidates/)
    expect(screen.getByText('INACT-1')).toBeTruthy()
    for (const header of ['SKU', 'ASIN', 'Product', 'Listing status', 'Fulfillable', 'Reserved', 'Inbound', 'Unfulfillable', 'Inventory Age', 'Last Sale', '30D Sales', '90D Sales', 'Potential Capacity Used']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeTruthy()
    }
    const inactiveTr = screen.getByText('INACT-1').closest('tr') as HTMLElement
    expect(within(inactiveTr).getByText('181–270 days · 6 aged')).toBeTruthy()
    expect(within(inactiveTr).getByText('2026-04-02')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Removal Orders' }))
    await screen.findByText('RMV-1')
    expect(get).toHaveBeenCalledWith(`${BASE}/removal-orders?status=OPEN`)
    for (const header of ['Removal ID', 'Date', 'SKU', 'Product', 'FNSKU', 'Requested', 'Completed', 'Cancelled', 'Status', 'Reason / Disposition']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Completed (98)' }))
    await waitFor(() => expect(get).toHaveBeenCalledWith(`${BASE}/removal-orders?status=COMPLETED`))

    fireEvent.click(screen.getByRole('tab', { name: 'Capacity Release' }))
    await screen.findByText(/not allocated to replenishment/)
    expect(screen.getByText('INACTIVE LISTING WITH AMAZON STOCK')).toBeTruthy()
    expect(screen.getAllByText('VOLUME DATA MISSING').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('tab', { name: 'Daily Actions' }))
    await screen.findByText('Inactive listing INACT-1 holds FBA stock')
    expect(post).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })
})
