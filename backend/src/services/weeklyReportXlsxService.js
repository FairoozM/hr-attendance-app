/**
 * Weekly sales / inventory Excel export — column schema + sheet title / filename helpers.
 * Workbook layout and styling live in `../utils/businessTableXlsx` so new report types can
 * call `buildBusinessTableXlsxBuffer` with their own `columns` and shared `items` / `totals`.
 */

const { buildBusinessTableXlsxBuffer } = require('../utils/businessTableXlsx')

/** 2dp currency / stock value in Excel (no symbol — org may use any currency) */
const WEEKLY_REPORT_CURRENCY_NUMFMT = '#,##0.00'

/**
 * Family-level column layout for Zoho weekly reports (value columns only: no item/qty movement).
 * Each row is one Zoho Family (aggregated from individual items).
 */
const WEEKLY_STOCK_MOVEMENT_XLSX_COLUMNS = [
  { header: 'SR. NO', width: 7.5, type: 'index' },
  {
    header: 'FAMILY',
    width: 28,
    type: 'rowText',
    getValue: (row) => row.family || '—',
    grandTotalText: 'Grand Total',
  },
  { header: 'Opening Stock', width: 16, type: 'sum', key: 'opening_stock', numFmt: WEEKLY_REPORT_CURRENCY_NUMFMT },
  { header: 'Closing Stock', width: 16, type: 'sum', key: 'closing_stock', numFmt: WEEKLY_REPORT_CURRENCY_NUMFMT },
  { header: 'Purchase Amount', width: 18, type: 'sum', key: 'purchase_amount', numFmt: WEEKLY_REPORT_CURRENCY_NUMFMT },
  { header: 'Returned to Wholesale', width: 24, type: 'sum', key: 'returned_to_wholesale', numFmt: WEEKLY_REPORT_CURRENCY_NUMFMT },
  { header: 'Sales Amount', width: 18, type: 'sum', key: 'sales_amount', numFmt: WEEKLY_REPORT_CURRENCY_NUMFMT },
]

/**
 * @param {object} params
 * @param {string} params.sheetTitle
 * @param {string} params.fromDate
 * @param {string} params.toDate
 * @param {object[]} params.items
 * @param {object} params.totals
 * @returns {Promise<Buffer>}
 */
function buildWeeklyReportXlsxBuffer(params) {
  return buildBusinessTableXlsxBuffer({
    ...params,
    columns: WEEKLY_STOCK_MOVEMENT_XLSX_COLUMNS,
  })
}

const EXPORT_SHEET_TITLES = {
  slow_moving: 'ECOMMERCE SLOW MOVING SALES REPORT',
  other_family: 'ECOMMERCE OTHER FAMILY SALES REPORT',
}

function getExportSheetTitleForGroup(reportGroup) {
  if (EXPORT_SHEET_TITLES[reportGroup]) {
    return EXPORT_SHEET_TITLES[reportGroup]
  }
  const label = String(reportGroup)
    .split('_')
    .filter(Boolean)
    .map((s) => s.toUpperCase())
    .join(' ')
  return `ECOMMERCE ${label} SALES REPORT`
}

/**
 * e.g. slow_moving -> weekly-slow-moving-report-2026-01-01-to-2026-01-07.xlsx
 */
function getExportDownloadFilename(reportGroup, fromDate, toDate) {
  const slug =
    {
      slow_moving: 'slow-moving',
      other_family: 'other-family',
    }[reportGroup] || String(reportGroup).replace(/_/g, '-')
  return `weekly-${slug}-report-${fromDate}-to-${toDate}.xlsx`
}

module.exports = {
  buildWeeklyReportXlsxBuffer,
  getExportSheetTitleForGroup,
  getExportDownloadFilename,
  WEEKLY_STOCK_MOVEMENT_XLSX_COLUMNS,
}
