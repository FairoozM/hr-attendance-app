import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import {
  buildWeeklySalesExportRows,
  exportWeeklySalesSnapshotToExcel,
} from './WeeklySalesReportPage'

vi.mock('xlsx', () => ({
  utils: {
    json_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  api: { get: vi.fn() },
  fetchBinary: vi.fn(),
  downloadBlob: vi.fn(),
}))

vi.mock('../../hooks/useWeeklySalesReport', () => ({
  useWeeklySalesReport: vi.fn(() => ({
    items: [],
    loading: false,
    error: null,
    errorHint: '',
    notConfigured: false,
    validationErrors: [],
    refetch: vi.fn(),
    zoho: null,
  })),
}))

vi.mock('../../contexts/UserPreferencesContext', () => ({
  useUserPreferences: vi.fn(() => ({
    getPref: vi.fn(() => ({ version: 1, snapshots: [] })),
    setPref: vi.fn(),
    prefsVersion: 1,
  })),
}))

vi.mock('../../utils/zohoWeeklyItemImageCache', () => ({
  getCachedZohoItemBlob: vi.fn(),
  setCachedZohoItemBlob: vi.fn(),
}))

describe('WeeklySalesReportPage saved snapshot export', () => {
  it('builds export rows from saved snapshot items', () => {
    const rows = buildWeeklySalesExportRows([
      {
        family: 'Bags',
        opening_stock: 10,
        purchase_amount: 20,
        returned_to_wholesale: 0,
        closing_stock: 5,
        sales_amount: 100,
      },
    ])

    expect(rows).toEqual([
      {
        'Sr. No': 1,
        Family: 'Bags',
        'Opening Stock': 10,
        'Purchase Amount': 20,
        'Returned to Wholesale': 0,
        'Closing Stock': 5,
        'Sales Amount': 100,
      },
    ])
  })

  it('writes an xlsx file for an opened saved snapshot without fetching live export', () => {
    exportWeeklySalesSnapshotToExcel({
      reportGroup: 'slow_moving',
      title: 'Slow Moving',
      fromDate: '2026-04-23',
      toDate: '2026-04-29',
      items: [
        { family: 'Bags', opening_stock: 10, purchase_amount: 20, closing_stock: 5, sales_amount: 100 },
      ],
      totals: { opening_stock: 10, purchase_amount: 20, returned_to_wholesale: 0, closing_stock: 5, sales_amount: 100 },
      salesSort: 'desc',
      suppressSalesAmount: false,
    })

    expect(XLSX.utils.json_to_sheet).toHaveBeenCalled()
    expect(XLSX.writeFile).toHaveBeenCalledWith(
      expect.any(Object),
      'weekly-slow-moving-report-2026-04-23-to-2026-04-29.xlsx',
    )
  })
})
