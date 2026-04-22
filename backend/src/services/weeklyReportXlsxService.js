/**
 * Weekly sales / inventory Excel export — column schema + sheet title / filename helpers.
 * Workbook layout and styling live in `../utils/businessTableXlsx` so new report types can
 * call `buildBusinessTableXlsxBuffer` with their own `columns` and shared `items` / `totals`.
 */

const { buildBusinessTableXlsxBuffer } = require('../utils/businessTableXlsx')

function itemLabelFromRow(row) {
  return (row.item_name && String(row.item_name).trim()) || row.sku || row.item_id || '—'
}

/**
 * Default column layout for Zoho weekly stock–movement reports (SR, item, five quantity fields).
 * Reuse or copy for a new `buildXxxReportXlsxBuffer` that passes a different schema.
 */
const WEEKLY_STOCK_MOVEMENT_XLSX_COLUMNS = [
  { header: 'SR. NO', width: 7.5, type: 'index' },
  {
    header: 'ITEM',
    width: 44,
    type: 'rowText',
    getValue: (row) => itemLabelFromRow(row),
    grandTotalText: 'Grand Total',
  },
  { header: 'Opening Stock', width: 16, type: 'sum', key: 'opening_stock' },
  { header: 'Purchases', width: 16, type: 'sum', key: 'purchases' },
  { header: 'Returned to Wholesale', width: 24, type: 'sum', key: 'returned_to_wholesale' },
  { header: 'Closing Stock', width: 16, type: 'sum', key: 'closing_stock' },
  { header: 'SOLD', width: 12, type: 'sum', key: 'sold' },
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
