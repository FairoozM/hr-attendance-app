import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  buildAllPricesBundle,
  computeCostUpEcommercePriceRow,
  computeCustomUaePriceRow,
  computeEcommercePriceRow,
  CUSTOM_FIXED_COMMISSION_PCT,
  areCustomUaeRatesValid,
  formatLastSavedAt,
  hydrateAllPricesStateFromBundle,
  isBrkhTemplateSeedRows,
  parseExcelTsvPaste,
  profitMarginDisplayClass,
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

  it('profitMarginDisplayClass colors low and high margins', () => {
    expect(profitMarginDisplayClass(24.9)).toBe('ap-ec-profit--low')
    expect(profitMarginDisplayClass(25)).toBe('')
    expect(profitMarginDisplayClass(26)).toBe('')
    expect(profitMarginDisplayClass(26.1)).toBe('ap-ec-profit--high')
  })

  it('keeps wholesales sales price exactly and derives margin from it', () => {
    const computed = computeEcommercePriceRow(
      { salesPrice: '10', purchasePrice: '3.5', shipping: '0' },
      { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 },
    )

    expect(computed.salesPrice).toBe(10)
    expect(computed.salesPriceFromWholesale).toBe(true)
    expect(computed.profit).toBeCloseTo(3, 5)
    expect(computed.profitPct).toBeCloseTo(30, 5)
  })

  it('imports sales price from full wholesales paste rows', () => {
    const { rows } = parseExcelTsvPaste(
      'IFE-DBGL-BLAC\t10\t0.50\t1.5\t1.5\t0\t3.50\t7.00\t3.00\t30.00%',
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].itemNo).toBe('IFE-DBGL-BLAC')
    expect(rows[0].salesPrice).toBe('10')
    expect(rows[0].shipping).toBe('0')
    expect(rows[0].purchasePrice).toBe('3.5')
  })
})

describe('cost-up / All UAE Prices (Custom) helpers', () => {
  it('computeCostUpEcommercePriceRow ignores wholesale salesPrice', () => {
    const computed = computeCostUpEcommercePriceRow(
      { salesPrice: '999', purchasePrice: '26.83', shipping: '21' },
      { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 },
    )
    // denominator = 1 - 0.05 - 0.15 - 0.15 - 0.25 = 0.40
    // (26.83 + 21) / 0.40 = 119.575 → round 120
    expect(computed.salesPriceFromWholesale).toBe(false)
    expect(computed.salesPrice).toBe(120)
    expect(computed.denominatorInvalid).toBe(false)
  })

  it('allows 0% VAT, advertising, and profit with fixed commission', () => {
    const computed = computeCustomUaePriceRow(
      { purchasePrice: '40', shipping: '10', salesPrice: '500' },
      { vatPct: 0, advertisingPct: 0, requiredProfitPct: 0 },
    )
    // denominator = 1 - 0.15 = 0.85; (40+10)/0.85 ≈ 58.82 → 59
    expect(computed.salesPrice).toBe(59)
    expect(computed.denominatorInvalid).toBe(false)
  })

  it('forces commission to 15% even if rates say otherwise', () => {
    const computed = computeCustomUaePriceRow(
      { purchasePrice: '40', shipping: '10' },
      { vatPct: 0, advertisingPct: 0, requiredProfitPct: 0, commissionPct: 99 },
    )
    expect(CUSTOM_FIXED_COMMISSION_PCT).toBe(15)
    expect(computed.salesPrice).toBe(59)
  })

  it('marks denominator invalid when rates sum to 100%+', () => {
    const computed = computeCustomUaePriceRow(
      { purchasePrice: '10', shipping: '5' },
      { vatPct: 40, advertisingPct: 30, requiredProfitPct: 15 },
    )
    // 40 + 15 + 30 + 15 = 100
    expect(computed.denominatorInvalid).toBe(true)
    expect(computed.salesPrice).toBe(0)
  })

  it('areCustomUaeRatesValid enforces under-100% with fixed commission', () => {
    expect(areCustomUaeRatesValid(5, 15, 25)).toBe(true)
    expect(areCustomUaeRatesValid(0, 0, 0)).toBe(true)
    expect(areCustomUaeRatesValid(40, 30, 15)).toBe(false)
    expect(areCustomUaeRatesValid(-1, 0, 0)).toBe(false)
  })
})
