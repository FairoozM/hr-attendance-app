import { describe, expect, it, vi } from 'vitest'
import {
  buildSavedListExportRows,
  sanitizeSavedListExportFilename,
} from './allPricesSavedListExport'

describe('allPricesSavedListExport', () => {
  it('sanitizeSavedListExportFilename produces filesystem-safe xlsx name', () => {
    const name = sanitizeSavedListExportFilename('2026-05-17T15:49:00.000Z')
    expect(name).toMatch(/^saved-prices-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.xlsx$/)
    expect(name).not.toMatch(/[/:\\?%*|"<>]/)
  })

  it('buildSavedListExportRows includes calculated columns', () => {
    const rows = buildSavedListExportRows({
      rates: { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 },
      rows: [{ itemNo: 'SKU-1', purchasePrice: '26.83', shipping: '21', dateOfPrices: '2026-05-17' }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]['Item no.']).toBe('SKU-1')
    expect(rows[0]['Sales price (AED)']).toBe(120)
    expect(rows[0]['Purchase price']).toBe(26.83)
  })

  it('buildSavedListExportRows returns empty array when no rows', () => {
    expect(buildSavedListExportRows({ rates: {}, rows: [] })).toEqual([])
  })
})
