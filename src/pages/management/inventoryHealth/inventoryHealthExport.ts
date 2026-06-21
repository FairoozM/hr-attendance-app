import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import {
  formatMonthsOfCover,
  type InventoryHealthRow,
} from '../../../api/inventoryHealth'

const XLSX_SHEET_NAME = 'Inventory Health'
const EXPORT_PREFIX = 'inventory-health-dead-stock'

export function inventoryHealthExportDateStamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function inventoryHealthExportFilename(ext: 'csv' | 'xlsx' | 'pdf', date = new Date()) {
  return `${EXPORT_PREFIX}-${inventoryHealthExportDateStamp(date)}.${ext}`
}

function formatMoneyAed(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return Number(value).toLocaleString(undefined, { style: 'currency', currency: 'AED', maximumFractionDigits: 0 })
}

function formatMoneyPlain(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return ''
  return Number(value)
}

function truncateText(value: string | null | undefined, max: number) {
  const text = String(value || '').trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

function buildXlsxRows(rows: InventoryHealthRow[]) {
  return rows.map((row) => ({
    SKU: row.sku || '',
    'Item Name': row.itemName || '',
    Family: row.familyName || '',
    'Family Type': row.familyType || '',
    'Stock Qty': row.currentStockQty ?? 0,
    'Unit Sales Price (AED)': formatMoneyPlain(row.salesPrice),
    'Inventory Value (AED)': formatMoneyPlain(row.inventoryValue),
    'Sales 90d': row.salesQty90 ?? 0,
    'Sales 180d': row.salesQty180 ?? 0,
    'Sales 365d': row.salesQty365 ?? 0,
    'Avg Monthly Sales 180d': row.avgMonthlySales180 ?? 0,
    'Months of Cover': row.monthsOfCover == null ? '' : formatMonthsOfCover(row.monthsOfCover),
    'Risk Score': row.riskScore ?? 0,
    'Risk Class': row.riskClass || '',
    Tags: (row.tags || []).join(', '),
    Reason: row.reason || '',
    'Recommended Action': row.recommendedAction || '',
    'Hidden Slow Moving': row.hiddenSlowMoving ? 'Yes' : 'No',
    imageUrl: row.imageUrl || '',
  }))
}

function applyAedColumnFormat(worksheet: XLSX.WorkSheet, columnKey: string) {
  const ref = worksheet['!ref']
  if (!ref) return
  const range = XLSX.utils.decode_range(ref)
  const headerRow = range.s.r
  let moneyCol = -1

  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const cell = worksheet[XLSX.utils.encode_cell({ r: headerRow, c })]
    if (cell?.v === columnKey) {
      moneyCol = c
      break
    }
  }
  if (moneyCol < 0) return

  for (let r = headerRow + 1; r <= range.e.r; r += 1) {
    const addr = XLSX.utils.encode_cell({ r, c: moneyCol })
    const cell = worksheet[addr]
    if (cell && typeof cell.v === 'number') {
      cell.t = 'n'
      cell.z = '"AED" #,##0'
    }
  }
}

export function exportInventoryHealthXlsx(rows: InventoryHealthRow[]) {
  if (!rows.length) return false

  const exportRows = buildXlsxRows(rows)
  const worksheet = XLSX.utils.json_to_sheet(exportRows)
  applyAedColumnFormat(worksheet, 'Unit Sales Price (AED)')
  applyAedColumnFormat(worksheet, 'Inventory Value (AED)')

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, XLSX_SHEET_NAME.slice(0, 31))
  XLSX.writeFile(workbook, inventoryHealthExportFilename('xlsx'))
  return true
}

export type InventoryHealthExportSummary = {
  totalInventoryValue: number
  deadStockValue: number
  hiddenSlowMovingValue: number
  deadStockSkus: number
  hiddenSlowMovingSkus: number
  totalFilteredSkus: number
}

export function buildExportSummary(rows: InventoryHealthRow[]): InventoryHealthExportSummary {
  let totalInventoryValue = 0
  let deadStockValue = 0
  let hiddenSlowMovingValue = 0
  let deadStockSkus = 0
  let hiddenSlowMovingSkus = 0

  for (const row of rows) {
    const value = Number(row.inventoryValue) || 0
    totalInventoryValue += value
    if (row.riskClass === 'Dead Stock') {
      deadStockSkus += 1
      deadStockValue += value
    }
    if (row.hiddenSlowMoving) {
      hiddenSlowMovingSkus += 1
      hiddenSlowMovingValue += value
    }
  }

  return {
    totalInventoryValue,
    deadStockValue,
    hiddenSlowMovingValue,
    deadStockSkus,
    hiddenSlowMovingSkus,
    totalFilteredSkus: rows.length,
  }
}

function formatGeneratedAt(date = new Date()) {
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function exportInventoryHealthPdf(rows: InventoryHealthRow[]) {
  if (!rows.length) return false

  const summary = buildExportSummary(rows)
  const generatedAt = formatGeneratedAt()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })

  const pageWidth = doc.internal.pageSize.getWidth()
  const marginX = 28

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('Life Smile - Inventory Health & Dead Stock Report', marginX, 32)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(80, 80, 80)
  doc.text(`Generated: ${generatedAt}`, marginX, 46)

  doc.setTextColor(0, 0, 0)
  doc.setFontSize(8)

  const summaryLines = [
    `Total Inventory Value: ${formatMoneyAed(summary.totalInventoryValue)}`,
    `Dead Stock Value: ${formatMoneyAed(summary.deadStockValue)}`,
    `Hidden Slow Moving Value: ${formatMoneyAed(summary.hiddenSlowMovingValue)}`,
    `Dead Stock SKUs: ${summary.deadStockSkus.toLocaleString()}`,
    `Hidden Slow Moving SKUs: ${summary.hiddenSlowMovingSkus.toLocaleString()}`,
    `Total Filtered SKUs: ${summary.totalFilteredSkus.toLocaleString()}`,
  ]

  let summaryY = 58
  for (const line of summaryLines) {
    doc.text(line, marginX, summaryY)
    summaryY += 11
  }

  const tableBody = rows.map((row) => [
    truncateText(row.sku, 18),
    truncateText(row.itemName, 28),
    truncateText(row.familyName, 16),
    String(row.currentStockQty ?? 0),
    formatMoneyAed(row.inventoryValue),
    `${row.salesQty90 ?? 0}/${row.salesQty180 ?? 0}/${row.salesQty365 ?? 0}`,
    formatMonthsOfCover(row.monthsOfCover),
    `${row.riskScore ?? 0} (${row.riskClass || '—'})`,
    truncateText((row.tags || []).join(', '), 36),
    truncateText(row.recommendedAction, 40),
  ])

  autoTable(doc, {
    startY: summaryY + 6,
    margin: { left: marginX, right: marginX },
    head: [['SKU', 'Item', 'Family', 'Stock', 'Value', '90/180/365 Sales', 'Cover', 'Risk', 'Tags', 'Action']],
    body: tableBody,
    styles: {
      fontSize: 6.5,
      cellPadding: 2,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [51, 65, 85],
      fontStyle: 'bold',
      fontSize: 6.5,
    },
    columnStyles: {
      0: { cellWidth: 52 },
      1: { cellWidth: 78 },
      2: { cellWidth: 52 },
      3: { cellWidth: 30, halign: 'right' },
      4: { cellWidth: 48, halign: 'right' },
      5: { cellWidth: 52, halign: 'right' },
      6: { cellWidth: 30, halign: 'right' },
      7: { cellWidth: 52 },
      8: { cellWidth: 72 },
    },
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages()
      doc.setFontSize(7)
      doc.setTextColor(120, 120, 120)
      doc.text(
        `Page ${data.pageNumber} of ${pageCount}`,
        pageWidth - marginX,
        doc.internal.pageSize.getHeight() - 14,
        { align: 'right' },
      )
    },
  })

  doc.save(inventoryHealthExportFilename('pdf'))
  return true
}
