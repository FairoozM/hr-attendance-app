'use strict'

/**
 * Excel export for Daily Ecommerce Report (ExcelJS).
 * Layout: date header → colored channel sections (orders + summary) → consolidated totals.
 */

const ExcelJS = require('exceljs')
const { formatAdsDisplay } = require('./providers/amazonAdsProvider')

const THIN = { style: 'thin', color: { argb: 'FF94A3B8' } }

const CHANNEL_FILLS = {
  amazon_uae: 'FFDBEAFE',
  amazon_ksa: 'FFE0E7FF',
  noon_uae: 'FFFEF3C7',
  noon_ksa: 'FFFDE68A',
  website: 'FFD1FAE5',
  shop: 'FFA7F3D0',
  carrefour_uae: 'FFFCE7F3',
}

const MONEY_FMT = '#,##0.00;[Red]-#,##0.00'
const PCT_FMT = '0.00"%"'

function borderAll(cell) {
  cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
}

function styleHeader(cell, fillArgb) {
  cell.font = { bold: true, size: 12, color: { argb: 'FF0F172A' } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
  borderAll(cell)
}

/**
 * @param {object} report - buildDailyEcommerceReport result
 * @returns {Promise<Buffer>}
 */
async function buildDailyEcommerceReportXlsxBuffer(report) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Life Smile HR & BI'
  wb.created = new Date()

  const ws = wb.addWorksheet('Daily Ecommerce', {
    views: [{ state: 'frozen', ySplit: 3 }],
  })

  ws.columns = [
    { header: 'A', key: 'a', width: 28 },
    { header: 'B', key: 'b', width: 28 },
    { header: 'C', key: 'c', width: 14 },
    { header: 'D', key: 'd', width: 16 },
    { header: 'E', key: 'e', width: 16 },
    { header: 'F', key: 'f', width: 16 },
  ]

  const date = report.date
  ws.mergeCells('A1:F1')
  ws.getCell('A1').value = 'Daily Ecommerce Report'
  ws.getCell('A1').font = { bold: true, size: 16 }
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }

  ws.mergeCells('A2:F2')
  ws.getCell('A2').value = `Date: ${date} (${report.timezone || 'Asia/Dubai'})`
  ws.getCell('A2').font = { size: 12 }

  ws.mergeCells('A3:F3')
  const fx = report.exchangeRate || {}
  ws.getCell('A3').value = `SAR→AED rate: ${fx.rate} (source: ${fx.source || 'n/a'})`
  ws.getCell('A3').font = { size: 10, italic: true, color: { argb: 'FF64748B' } }

  let row = 5

  for (const channel of report.channels || []) {
    const fill = CHANNEL_FILLS[channel.channel] || 'FFF1F5F9'
    ws.mergeCells(`A${row}:F${row}`)
    const titleCell = ws.getCell(`A${row}`)
    titleCell.value = `${channel.label} [${channel.country}] — ${statusLabel(channel.integrationStatus)}`
    styleHeader(titleCell, fill)
    row += 1

    if (channel.integrationStatus === 'not_configured') {
      ws.mergeCells(`A${row}:F${row}`)
      ws.getCell(`A${row}`).value = 'Not Configured'
      ws.getCell(`A${row}`).font = { italic: true, color: { argb: 'FF64748B' } }
      row += 2
      row = writeSummaryBlock(ws, row, channel, fill)
      row += 2
      continue
    }

    // Column headers
    const headers = ['Order Number', 'Item Code / SKU', 'Quantity', 'Line Amount', 'Order Amount (AED)', 'Status']
    headers.forEach((h, i) => {
      const cell = ws.getCell(row, i + 1)
      cell.value = h
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCBD5E0' } }
      borderAll(cell)
    })
    row += 1

    if (!channel.orders || channel.orders.length === 0) {
      ws.mergeCells(`A${row}:F${row}`)
      ws.getCell(`A${row}`).value = 'No orders for this date'
      row += 1
    } else {
      for (const order of channel.orders) {
        const items = order.items && order.items.length ? order.items : [{ sku: '', quantity: 0 }]
        items.forEach((item, idx) => {
          ws.getCell(row, 1).value = idx === 0 ? order.orderNumber : ''
          ws.getCell(row, 2).value = item.sku || ''
          ws.getCell(row, 3).value = item.quantity || 0
          ws.getCell(row, 4).value = item.lineAmount != null ? item.lineAmount : ''
          if (item.lineAmount != null) ws.getCell(row, 4).numFmt = MONEY_FMT
          ws.getCell(row, 5).value = idx === 0 ? order.amountAED : ''
          if (idx === 0) ws.getCell(row, 5).numFmt = MONEY_FMT
          ws.getCell(row, 6).value = idx === 0 ? order.status : ''
          for (let c = 1; c <= 6; c += 1) borderAll(ws.getCell(row, c))
          row += 1
        })
      }
    }

    row += 1
    row = writeSummaryBlock(ws, row, channel, fill)
    row += 2
  }

  // Totals
  const totalsFill = 'FF1E293B'
  ws.mergeCells(`A${row}:F${row}`)
  const totTitle = ws.getCell(`A${row}`)
  totTitle.value = 'Consolidated Daily Totals (AED)'
  totTitle.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
  totTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: totalsFill } }
  row += 1

  const t = report.totals || {}
  const totalRows = [
    ['Total Quantity', t.quantity, 'int'],
    ['Total Advertising Cost', t.adSpendAED, 'ads'],
    ['Total Clicks', t.clicks, 'adsInt'],
    ['Total Commission', t.commissionAED, 'money'],
    ['Total Shipping / Fulfillment', t.shippingAED, 'money'],
    ['Total Payment Fees', t.paymentFeesAED, 'money'],
    ['Total Other Included Costs', t.otherIncludedCostsAED, 'money'],
    ['General Ecommerce Costs', t.generalEcommerceCostsAED, 'general'],
    ['Overall Cost %', t.costPercentage, 'pct'],
    ['Total Sales Amount', t.salesAmountAED, 'money'],
    ['Total Balance', t.balanceAED, 'money'],
  ]

  for (const [label, value, kind] of totalRows) {
    ws.getCell(row, 1).value = label
    ws.getCell(row, 1).font = { bold: true }
    borderAll(ws.getCell(row, 1))
    const cell = ws.getCell(row, 2)
    writeMetricCell(cell, value, kind, report)
    borderAll(cell)
    row += 1
  }

  if (report.incomplete) {
    row += 1
    ws.mergeCells(`A${row}:F${row}`)
    ws.getCell(`A${row}`).value =
      'WARNING: Report incomplete — some integrations are Not Configured or Unavailable. Totals use available values only.'
    ws.getCell(`A${row}`).font = { bold: true, color: { argb: 'FFB45309' } }
  }

  if (Array.isArray(report.warnings) && report.warnings.length) {
    row += 2
    ws.getCell(row, 1).value = 'Data quality warnings'
    ws.getCell(row, 1).font = { bold: true }
    row += 1
    for (const w of report.warnings.slice(0, 40)) {
      ws.mergeCells(`A${row}:F${row}`)
      ws.getCell(`A${row}`).value = w
      ws.getCell(`A${row}`).font = { size: 9, color: { argb: 'FF64748B' } }
      row += 1
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

function statusLabel(status) {
  if (status === 'not_configured') return 'Not Configured'
  if (status === 'unavailable') return 'Unavailable'
  if (status === 'pending') return 'Pending'
  return 'Available'
}

function writeSummaryBlock(ws, row, channel, fill) {
  const s = channel.summary || {}
  const adsStatus = channel.adsStatus || 'not_configured'
  const lines = [
    ['Total Quantity', s.quantity, 'int'],
    ['Advertising Cost (AED)', s.adSpendAED, 'ads'],
    ['Advertising Clicks', s.clicks, 'adsInt'],
    ['Commission (AED)', s.commissionAED, 'money'],
    ['Shipping / Fulfillment (AED)', s.shippingAED, 'money'],
    ['Payment Fees (AED)', s.paymentFeesAED, 'money'],
    ['Other Included Costs (AED)', s.otherIncludedCostsAED, 'money'],
    ['Coupon Discount (info, AED)', s.couponDiscountAED, 'money'],
    ['Smile Points (info, AED)', s.smilePointsAED, 'money'],
    ['Cost %', s.costPercentage, 'pct'],
    ['Sales Amount (AED)', s.salesAmountAED, 'money'],
    ['Balance (AED)', s.balanceAED, 'money'],
  ]

  ws.mergeCells(`A${row}:B${row}`)
  const h = ws.getCell(`A${row}`)
  h.value = 'Channel Summary'
  h.font = { bold: true }
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
  row += 1

  for (const [label, value, kind] of lines) {
    ws.getCell(row, 1).value = label
    borderAll(ws.getCell(row, 1))
    const cell = ws.getCell(row, 2)
    if (kind === 'ads' || kind === 'adsInt') {
      if (adsStatus === 'not_configured') {
        cell.value = 'Not Configured'
      } else if (adsStatus === 'unavailable') {
        cell.value = 'Unavailable'
      } else if (value == null) {
        cell.value = 'Unavailable'
      } else if (kind === 'adsInt') {
        cell.value = Math.round(value)
      } else {
        cell.value = Number(value)
        cell.numFmt = MONEY_FMT
      }
    } else if (kind === 'pct') {
      if (value == null) cell.value = 'N/A'
      else {
        cell.value = Number(value)
        cell.numFmt = PCT_FMT
      }
    } else if (kind === 'int') {
      cell.value = Math.round(Number(value) || 0)
    } else {
      cell.value = Number(value) || 0
      cell.numFmt = MONEY_FMT
    }
    borderAll(cell)
    row += 1
  }
  return row
}

function writeMetricCell(cell, value, kind, report) {
  if (kind === 'general') {
    if (report.totals?.generalEcommerceCostsStatus === 'not_configured' || value == null) {
      cell.value = 'Not Configured'
      return
    }
  }
  if (kind === 'ads' || kind === 'adsInt') {
    // Overall ads: if any channel has ads configured show sum; else Not Configured when all null
    const anyAdsConfigured = (report.channels || []).some(
      (c) => c.adsStatus === 'available' || c.adsStatus === 'unavailable' || c.adsStatus === 'pending',
    )
    const allNotConfigured = (report.channels || []).every(
      (c) => c.adsStatus === 'not_configured' || c.adsStatus == null,
    )
    if (allNotConfigured && value == null) {
      cell.value = 'Not Configured'
      return
    }
    if (value == null) {
      cell.value = anyAdsConfigured ? 'Unavailable' : 'Not Configured'
      return
    }
    if (kind === 'adsInt') {
      cell.value = Math.round(value)
      return
    }
    cell.value = Number(value)
    cell.numFmt = MONEY_FMT
    return
  }
  if (kind === 'pct') {
    if (value == null) {
      cell.value = 'N/A'
      return
    }
    cell.value = Number(value)
    cell.numFmt = PCT_FMT
    return
  }
  if (kind === 'int') {
    cell.value = Math.round(Number(value) || 0)
    return
  }
  cell.value = Number(value) || 0
  cell.numFmt = MONEY_FMT
}

module.exports = {
  buildDailyEcommerceReportXlsxBuffer,
  formatAdsDisplay,
}
