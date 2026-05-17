/**
 * QA scenarios J: export row building (draft vs saved paths share builder).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  buildExportRowsFromRatesAndRows,
  exportCurrentDraftToExcel,
  exportSavedListToExcel,
  sanitizeExportFilename,
} from './allPricesSavedListExport'

vi.mock('xlsx', () => ({
  utils: {
    json_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}))

const DEFAULT_RATES = { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 }

describe('allPricesSavedListExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('buildExportRowsFromRatesAndRows includes item and computed columns', () => {
    const rows = buildExportRowsFromRatesAndRows({
      rates: DEFAULT_RATES,
      rows: [{ itemNo: 'SKU-1', purchasePrice: '10', shipping: '5', dateOfPrices: '2026-01-01' }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]['Item no.']).toBe('SKU-1')
    expect(rows[0]['Purchase price']).toBe(10)
  })

  it('sanitizeExportFilename uses draft prefix', () => {
    const name = sanitizeExportFilename('2026-05-17T12:00:00.000Z', 'draft-prices')
    expect(name).toMatch(/^draft-prices-/)
    expect(name.endsWith('.xlsx')).toBe(true)
  })

  it('exportSavedListToExcel returns false for empty rows', () => {
    expect(exportSavedListToExcel({ rates: DEFAULT_RATES, rows: [] })).toBe(false)
  })

  it('exportCurrentDraftToExcel returns false for empty draft', () => {
    expect(exportCurrentDraftToExcel({ rates: DEFAULT_RATES, rows: [] })).toBe(false)
  })
})
