import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
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
})
