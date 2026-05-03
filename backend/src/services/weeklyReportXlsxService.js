/**
 * Weekly sales / inventory Excel export — column schema + sheet title / filename helpers.
 * Workbook layout and styling live in `../utils/businessTableXlsx` so new report types can
 * call `buildBusinessTableXlsxBuffer` with their own `columns` and shared `items` / `totals`.
 */

const { buildBusinessTableXlsxBuffer } = require('../utils/businessTableXlsx')
const ExcelJS = require('exceljs')

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
  {
    header: 'Photo',
    width: 12,
    type: 'image',
    grandTotalText: '\u00A0',
  },
  {
    header: 'Zoho item id (photo ref)',
    width: 20,
    type: 'rowText',
    getValue: (row) =>
      row.zoho_representative_item_id != null && String(row.zoho_representative_item_id).trim() !== ''
        ? String(row.zoho_representative_item_id)
        : '—',
    grandTotalText: '—',
  },
  { header: 'Opening Stock', width: 16, type: 'sum', key: 'opening_stock', numFmt: WEEKLY_REPORT_CURRENCY_NUMFMT },
  { header: 'Purchase Amount', width: 18, type: 'sum', key: 'purchase_amount', numFmt: WEEKLY_REPORT_CURRENCY_NUMFMT },
  { header: 'Returned to Wholesale', width: 24, type: 'sum', key: 'returned_to_wholesale', numFmt: WEEKLY_REPORT_CURRENCY_NUMFMT },
  { header: 'Closing Stock', width: 16, type: 'sum', key: 'closing_stock', numFmt: WEEKLY_REPORT_CURRENCY_NUMFMT },
  { header: 'Sales Amount', width: 18, type: 'sum', key: 'sales_amount', numFmt: WEEKLY_REPORT_CURRENCY_NUMFMT },
]

/**
 * @param {object} params
 * @param {string} params.sheetTitle
 * @param {string} params.fromDate
 * @param {string} params.toDate
 * @param {object[]} params.items
 * @param {object} params.totals
 * @param {(item: object) => Promise<null|{ buffer: import('buffer').Buffer, extension: 'png'|'jpeg'|'gif' }>} [params.fetchImageForItem] — for Zoho product thumbnails in the Photo column
 * @returns {Promise<Buffer>}
 */
function buildWeeklyReportXlsxBuffer(params) {
  return buildBusinessTableXlsxBuffer({
    ...params,
    columns: WEEKLY_STOCK_MOVEMENT_XLSX_COLUMNS,
  })
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function safeSheetName(value) {
  const base = String(value || 'Closing Stock')
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim()
  return (base || 'Closing Stock').slice(0, 31)
}

/**
 * Family details export: Closing Stock matrix only.
 *
 * @param {object} params
 * @param {string} params.family
 * @param {string} params.fromDate
 * @param {string} params.toDate
 * @param {Array<{warehouse_id:string, warehouse_name:string}>} params.warehouses
 * @param {{ rows?: object[], totals_by_warehouse?: object, total_qty?: number, total_amount?: number }} params.closingSection
 * @returns {Promise<Buffer>}
 */
async function buildFamilyClosingStockXlsxBuffer({ family, fromDate, toDate, warehouses, closingSection }) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'LifeSmile HR Attendance App'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(safeSheetName(`${family} Closing`), {
    views: [{ state: 'frozen', ySplit: 3, xSplit: 2 }],
  })

  const whs = Array.isArray(warehouses) ? warehouses : []
  const rows = Array.isArray(closingSection?.rows) ? closingSection.rows : []
  const title = `Closing Stock - ${family || 'Family'}`

  const totalColumns = 4 + whs.length * 2
  sheet.mergeCells(1, 1, 1, totalColumns)
  sheet.getCell(1, 1).value = title
  sheet.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FF1E2D4E' } }
  sheet.getCell(1, 1).alignment = { horizontal: 'center' }
  sheet.mergeCells(2, 1, 2, totalColumns)
  sheet.getCell(2, 1).value = `${fromDate || ''} to ${toDate || ''}`
  sheet.getCell(2, 1).alignment = { horizontal: 'center' }
  sheet.getCell(2, 1).font = { color: { argb: 'FF64748B' } }

  const headers = ['Product', 'SKU']
  whs.forEach((wh) => {
    const name = wh?.warehouse_name || wh?.warehouse_id || 'Warehouse'
    headers.push(`${name} Qty`, `${name} Amount`)
  })
  headers.push('Total Qty', 'Total Amount')
  sheet.addRow(headers)

  sheet.getRow(3).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF1E2D4E' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F5' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    }
  })

  rows.forEach((row) => {
    const values = [
      row.item_name || row.item_id || 'Product',
      row.sku || '—',
    ]
    whs.forEach((wh) => {
      const wid = String(wh?.warehouse_id || '')
      const cell = (row.warehouses && row.warehouses[wid]) || {}
      values.push(toNumber(cell.qty), toNumber(cell.amount))
    })
    values.push(toNumber(row.total_qty), toNumber(row.total_amount))
    sheet.addRow(values)
  })

  const totals = closingSection?.totals_by_warehouse || {}
  const totalRowValues = ['Grand Total', '']
  whs.forEach((wh) => {
    const wid = String(wh?.warehouse_id || '')
    const total = totals[wid] || {}
    totalRowValues.push(toNumber(total.qty), toNumber(total.amount))
  })
  totalRowValues.push(toNumber(closingSection?.total_qty), toNumber(closingSection?.total_amount))
  const totalRow = sheet.addRow(totalRowValues)

  totalRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF1E2D4E' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE8FF' } }
  })

  sheet.columns.forEach((column, index) => {
    if (index === 0) column.width = 34
    else if (index === 1) column.width = 18
    else column.width = 16
    column.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
      cell.alignment = {
        horizontal: rowNumber <= 3 || index < 2 ? 'left' : 'right',
        vertical: 'middle',
        wrapText: true,
      }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      }
      if (rowNumber > 3 && index >= 2) {
        cell.numFmt = WEEKLY_REPORT_CURRENCY_NUMFMT
      }
    })
  })

  return workbook.xlsx.writeBuffer()
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
  buildFamilyClosingStockXlsxBuffer,
  getExportSheetTitleForGroup,
  getExportDownloadFilename,
  WEEKLY_STOCK_MOVEMENT_XLSX_COLUMNS,
}
