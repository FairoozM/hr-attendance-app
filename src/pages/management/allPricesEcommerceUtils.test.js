import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  buildAllPricesBundle,
  formatLastSavedAt,
  hydrateAllPricesStateFromBundle,
  isBrkhTemplateSeedRows,
  resolveAllPricesRowsFromBundle,
  saveAllPricesEcommerceBundle,
  seedEcommerceRowsForDevOnly,
} from './allPricesEcommerceUtils'
import { requestUserPrefSave } from '../../lib/userPreferencesBridge'

vi.mock('../../lib/userPreferencesBridge', () => ({
  getUserPrefKey: vi.fn(() => null),
  requestUserPrefSave: vi.fn(),
}))

describe('allPricesEcommerceUtils seed safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('seedEcommerceRowsForDevOnly returns empty array in production', () => {
    vi.stubEnv('PROD', true)
    expect(seedEcommerceRowsForDevOnly()).toEqual([])
    vi.unstubAllEnvs()
  })

  it('detects BRKH template fingerprint', () => {
    const seed = Array.from({ length: 17 }, (_, i) => ({
      itemNo: `BRKH-64-${i + 1}`,
      purchasePrice: i === 0 ? 26.83 : '',
      shipping: i === 0 ? 21 : '',
    }))
    expect(isBrkhTemplateSeedRows(seed)).toBe(true)
    expect(isBrkhTemplateSeedRows([{ itemNo: 'TOOL-1', purchasePrice: '10', shipping: '5' }])).toBe(false)
  })

  it('resolveAllPricesRowsFromBundle strips BRKH seed in production', () => {
    const seed = Array.from({ length: 17 }, (_, i) => ({
      itemNo: `BRKH-64-${i + 1}`,
      purchasePrice: i === 0 ? 26.83 : '',
      shipping: i === 0 ? 21 : '',
    }))
    const rows = resolveAllPricesRowsFromBundle({ rows: seed }, { isProd: true })
    expect(rows).toEqual([])
  })

  it('blocks saving BRKH template in production', () => {
    vi.stubEnv('PROD', true)
    const seed = Array.from({ length: 17 }, (_, i) => ({
      itemNo: `BRKH-64-${i + 1}`,
      purchasePrice: i === 0 ? 26.83 : '',
      shipping: i === 0 ? 21 : '',
    }))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = saveAllPricesEcommerceBundle(
      { rates: { vatPct: 5 }, rows: seed },
      { source: 'test', action: 'save' },
    )
    expect(result.blocked).toBe(true)
    expect(requestUserPrefSave).not.toHaveBeenCalled()
    errSpy.mockRestore()
    vi.unstubAllEnvs()
  })

  it('buildAllPricesBundle includes lastSavedAt when provided', () => {
    const bundle = buildAllPricesBundle(
      { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 },
      [{ itemNo: 'X-1', purchasePrice: '10', shipping: '5', dateOfPrices: '' }],
      '2026-05-17T10:30:00.000Z',
    )
    expect(bundle.lastSavedAt).toBe('2026-05-17T10:30:00.000Z')
    expect(bundle.rows).toHaveLength(1)
  })

  it('hydrateAllPricesStateFromBundle restores rates rows and timestamp', () => {
    const state = hydrateAllPricesStateFromBundle({
      rates: { vatPct: 7 },
      rows: [{ itemNo: 'SKU-1', purchasePrice: '12', shipping: '3' }],
      lastSavedAt: '2026-05-17T10:30:00.000Z',
    })
    expect(state.rates.vatPct).toBe(7)
    expect(state.rows[0].itemNo).toBe('SKU-1')
    expect(state.lastSavedAt).toBe('2026-05-17T10:30:00.000Z')
  })

  it('formatLastSavedAt renders dd/mm/yyyy hh:mm', () => {
    const formatted = formatLastSavedAt('2026-05-17T10:30:00.000Z')
    expect(formatted).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)
  })
})
