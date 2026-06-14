import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import * as XLSX from 'xlsx'
import { useWeeklySalesReport } from '../../hooks/useWeeklySalesReport'
import {
  buildWeeklySalesExportRows,
  exportWeeklySalesSnapshotToExcel,
  normalizeWeeklyReportIsoDate,
  resolveWeeklyReportLoadedDateRange,
  weeklyReportFilterDateMismatch,
  WeeklySalesReportSection,
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
    reportMeta: null,
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

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

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
        'Opening Stock Value': 10,
        'Purchase Amount': 20,
        'Returned to Wholesale': 0,
        'Closing Stock Value': 5,
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

describe('WeeklySalesReportPage report metadata', () => {
  it('shows calculation metadata and source warnings when present', () => {
    const refetch = vi.fn()
    useWeeklySalesReport.mockReturnValue({
      items: [
        { family: 'Bags', opening_stock: 10, purchase_amount: 20, returned_to_wholesale: 0, closing_stock: 5, sales_amount: 100 },
      ],
      loading: false,
      error: null,
      errorHint: '',
      notConfigured: false,
      validationErrors: [],
      refetch,
      zoho: null,
      reportMeta: {
        calculation_version: 'stock-report-test',
        generated_at: '2026-05-18T10:00:00.000Z',
        report_group: 'slow_moving',
        from_date: '2026-05-01',
        to_date: '2026-05-07',
        stock_value_basis: {
          opening_stock_value: {
            warning: 'Opening Stock Value is reconstructed from current live Zoho stock and available transactions.',
          },
          closing_stock_value: {
            warning: 'Closing Stock Value uses current Zoho stock at report generation time, not selected to_date.',
          },
        },
        cache: { cached: true },
        missing_for_exact_historical_stock: ['item adjustments', 'warehouse transfers'],
        source_status: {
          sales: { source: 'zoho_inventory_reports_salesbyitem', fallback_used: true, warning: 'Fallback used.' },
        },
        completeness: { severity: 'warning', warnings: ['Sales fallback warning'] },
      },
    })

    render(
      <WeeklySalesReportSection
        reportGroup="slow_moving"
        title="Slow Moving"
        fromDate="2026-05-01"
        toDate="2026-05-07"
        datesValid
        loadToken={1}
      />,
    )

    expect(screen.getByText(/Loaded:/)).toBeTruthy()
    expect(screen.getByText(/Calc: stock-report-test/)).toBeTruthy()
    expect(screen.getByText(/Cached report/)).toBeTruthy()
    expect(screen.getByText(/Table totals match the filter range/)).toBeTruthy()
    expect(screen.getByText(/This report is not an exact historical stock snapshot/)).toBeTruthy()
    expect(screen.getByText(/Opening Stock Value is reconstructed/)).toBeTruthy()
    expect(screen.getByText(/Closing Stock Value uses current Zoho stock/)).toBeTruthy()
    expect(screen.getByText(/Missing sources for exact historical stock/)).toBeTruthy()
  })

  it('warns when filter dates differ from loaded report_meta dates', () => {
    useWeeklySalesReport.mockReturnValue({
      items: [
        { family: 'CUT', opening_stock: 3937, purchase_amount: 231, returned_to_wholesale: 0, closing_stock: 4168, sales_amount: 962.85 },
      ],
      loading: false,
      error: null,
      errorHint: '',
      notConfigured: false,
      validationErrors: [],
      refetch: vi.fn(),
      zoho: null,
      reportMeta: {
        calculation_version: 'stock-report-test',
        generated_at: '2026-06-14T10:00:00.000Z',
        report_group: 'slow_moving',
        from_date: '2026-06-01',
        to_date: '2026-06-10',
        cache: { cached: true, expires_at: '2026-06-14T11:00:00.000Z' },
        completeness: { severity: 'warning', warnings: [] },
        stock_value_basis: {
          opening_stock_value: { warning: 'Opening reconstructed.' },
          closing_stock_value: { warning: 'Closing live stock.' },
        },
      },
    })

    render(
      <WeeklySalesReportSection
        reportGroup="slow_moving"
        title="Slow Moving"
        fromDate="2026-06-04"
        toDate="2026-06-10"
        datesValid
        loadToken={1}
      />,
    )

    expect(screen.getByText(/Loaded:/)).toBeTruthy()
    expect(screen.getByText(/Date range mismatch/)).toBeTruthy()
    expect(screen.getByText(/Filters \(not loaded yet\)/)).toBeTruthy()
    expect(screen.getByText(/Loaded in this table/)).toBeTruthy()
    expect(screen.queryByText(/Table totals match the filter range/)).toBeNull()
  })
})

describe('WeeklySalesReportPage loaded date helpers', () => {
  it('normalizes ISO date strings', () => {
    expect(normalizeWeeklyReportIsoDate('2026-06-04')).toBe('2026-06-04')
    expect(normalizeWeeklyReportIsoDate('2026-06-04T12:00:00.000Z')).toBe('2026-06-04')
    expect(normalizeWeeklyReportIsoDate('')).toBe('')
  })

  it('prefers report_meta dates over snapshot fallback', () => {
    expect(
      resolveWeeklyReportLoadedDateRange(
        { from_date: '2026-06-04', to_date: '2026-06-10' },
        { fromDate: '2026-06-01', toDate: '2026-06-10' },
      ),
    ).toEqual({ from: '2026-06-04', to: '2026-06-10', source: 'report_meta' })
  })

  it('detects filter vs loaded mismatch', () => {
    expect(
      weeklyReportFilterDateMismatch('2026-06-04', '2026-06-10', '2026-06-01', '2026-06-10'),
    ).toBe(true)
    expect(
      weeklyReportFilterDateMismatch('2026-06-04', '2026-06-10', '2026-06-04', '2026-06-10'),
    ).toBe(false)
  })
})
