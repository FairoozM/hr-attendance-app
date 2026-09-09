'use strict'

/**
 * Excel export — six side-by-side channel columns matching the operational spreadsheet.
 */

const ExcelJS = require('exceljs')

const CHANNEL_FILLS = {
  amazon_uae: 'FF93C5FD',
  amazon_ksa: 'FFA5B4FC',
  noon_uae: 'FFFCD34D',
  noon_ksa: 'FFFBBF24',
  life_smile: 'FF6EE7B7',
  carrefour_uae: 'FFF9A8D4',
}

const MONEY_FMT = '#,##0.00;[Red]-#,##0.00'
const PCT_FMT = '0.00"%"'
const THIN = { style: 'thin', color: { argb: 'FF94A3B8' } }

function border(cell) {
  cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
}

function naAds(status, value, kind) {
  if (status === 'not_configured') return 'Not Configured'
  if (status === 'unavailable') return 'Unavailable'
  if (value == null) return 'Not Configured'
  if (kind === 'int') return Math.round(value)
  return Number(value)
}

/**
 * @param {object} report
 * @returns {Promise<Buffer>}
 */
async function buildDailyEcommerceReportXlsxBuffer(report) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Life Smile HR & BI'
  const ws = wb.addWorksheet('Daily Ecommerce', {
    views: [{ state: 'frozen', ySplit: 2 }],
  })

  const channels = report.channels || []
  const colW = 12
  // 6 channels × 3 cols
  for (let i = 1; i <= 18; i += 1) {
    ws.getColumn(i).width = i % 3 === 2 ? 16 : colW
  }

  // Title
  ws.mergeCells(1, 1, 1, 18)
  ws.getCell(1, 1).value = `Daily Ecommerce Report — ${report.date}`
  ws.getCell(1, 1).alignment = { horizontal: 'center' }
  ws.getCell(1, 1).font = { bold: true, size: 14 }

  ws.mergeCells(2, 1, 2, 18)
  const rate = report.exchangeRate?.rateDisplay || Number(report.exchangeRate?.rate || 0).toFixed(4)
  ws.getCell(2, 1).value = `Timezone: ${report.timezone || 'Asia/Dubai'} · SAR to AED: ${rate}`
  ws.getCell(2, 1).alignment = { horizontal: 'center' }
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF64748B' } }

  // Channel headers (row 4)
  const headerRow = 4
  channels.forEach((ch, idx) => {
    const c0 = idx * 3 + 1
    ws.mergeCells(headerRow, c0, headerRow, c0 + 2)
    const cell = ws.getCell(headerRow, c0)
    cell.value = ch.label
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: CHANNEL_FILLS[ch.channel] || 'FFE2E8F0' },
    }
    cell.font = { bold: true }
    cell.alignment = { horizontal: 'center' }
    border(cell)
  })

  // Column titles
  const colTitleRow = 5
  channels.forEach((_, idx) => {
    const c0 = idx * 3 + 1
    ;['Order', 'Item Code', 'Qty'].forEach((h, j) => {
      const cell = ws.getCell(colTitleRow, c0 + j)
      cell.value = h
      cell.font = { bold: true, size: 9 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
      border(cell)
    })
  })

  // Order rows — align channels by row index of flattened item lines
  const channelLines = channels.map((ch) => {
    if (ch.integrationStatus === 'not_configured') {
      return [{ order: 'Not Configured', sku: '', qty: '' }]
    }
    if (ch.integrationStatus === 'unavailable') {
      return [{ order: 'Data Error', sku: '', qty: '' }]
    }
    const lines = []
    for (const order of ch.orders || []) {
      const items = order.items?.length ? order.items : [{ sku: '', quantity: 0 }]
      items.forEach((item, i) => {
        lines.push({
          order: i === 0 ? order.orderNumber : '',
          sku: item.sku || '',
          qty: item.quantity || 0,
        })
      })
    }
    if (!lines.length) lines.push({ order: 'No orders', sku: '', qty: '' })
    return lines
  })

  const maxLines = Math.max(1, ...channelLines.map((l) => l.length))
  let row = 6
  for (let i = 0; i < maxLines; i += 1) {
    channels.forEach((_, idx) => {
      const line = channelLines[idx][i] || { order: '', sku: '', qty: '' }
      const c0 = idx * 3 + 1
      ws.getCell(row, c0).value = line.order
      ws.getCell(row, c0 + 1).value = line.sku
      ws.getCell(row, c0 + 2).value = line.qty === '' ? '' : line.qty
      for (let j = 0; j < 3; j += 1) border(ws.getCell(row, c0 + j))
    })
    row += 1
  }

  row += 1
  // Summary labels per family
  const summarySpecs = (ch) => {
    const s = ch.summary || {}
    const ads = ch.adsStatus || 'not_configured'
    if (ch.family === 'life_smile') {
      return [
        ['Website Qty', s.quantity, 'int'],
        ['FB/Instagram Ads', naAds(ads, s.adSpendAED, 'money'), 'raw'],
        ['Website Clicks', naAds(ads, s.clicks, 'int'), 'raw'],
        ['Tabby & Tamara Commission', s.tabbyTamaraCommissionAED || 0, 'money'],
        ['Smile Point & Coupon', s.smilePointCouponAED || 0, 'money'],
        ['Website Shipping', s.shippingAED || 0, 'money'],
        ['Website Cost %', s.costPercentage, 'pct'],
        ['Website Amount', s.salesAmountAED || 0, 'money'],
        ['Website Balance', s.balanceAED || 0, 'money'],
      ]
    }
    const prefix =
      ch.family === 'amazon' ? 'Amazon' : ch.family === 'noon' ? 'Noon' : 'Carrefour'
    return [
      [`${prefix} Qty`, s.quantity, 'int'],
      [`${prefix} Ads`, naAds(ads, s.adSpendAED, 'money'), 'raw'],
      [`${prefix} Clicks`, naAds(ads, s.clicks, 'int'), 'raw'],
      [`${prefix} Commission`, s.commissionAED || 0, 'money'],
      [`${prefix} Shipping`, s.shippingAED || 0, 'money'],
      [`${prefix} Cost %`, s.costPercentage, 'pct'],
      [`${prefix} Amount`, s.salesAmountAED || 0, 'money'],
      [`${prefix} Balance`, s.balanceAED || 0, 'money'],
    ]
  }

  const specs = channels.map(summarySpecs)
  const maxSummary = Math.max(...specs.map((s) => s.length))
  for (let i = 0; i < maxSummary; i += 1) {
    channels.forEach((_, idx) => {
      const spec = specs[idx][i]
      const c0 = idx * 3 + 1
      if (!spec) return
      ws.mergeCells(row, c0, row, c0 + 1)
      ws.getCell(row, c0).value = spec[0]
      ws.getCell(row, c0).font = { size: 9 }
      const valCell = ws.getCell(row, c0 + 2)
      const kind = spec[2]
      const val = spec[1]
      if (kind === 'raw') valCell.value = val
      else if (kind === 'pct') {
        if (val == null) valCell.value = 'N/A'
        else {
          valCell.value = Number(val)
          valCell.numFmt = PCT_FMT
        }
      } else if (kind === 'int') valCell.value = Math.round(Number(val) || 0)
      else {
        valCell.value = Number(val) || 0
        valCell.numFmt = MONEY_FMT
      }
      for (let j = 0; j < 3; j += 1) border(ws.getCell(row, c0 + j))
    })
    row += 1
  }

  row += 1
  ws.mergeCells(row, 1, row, 18)
  ws.getCell(row, 1).value = 'Consolidated Totals'
  ws.getCell(row, 1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
  row += 1

  const t = report.totals || {}
  const totals = [
    ['Total Qty', t.quantity, 'int'],
    [
      'Total Ads',
      t.adSpendAED == null ? 'Not Configured' : t.adSpendAED,
      t.adSpendAED == null ? 'raw' : 'money',
    ],
    [
      'Total Clicks',
      t.clicks == null ? 'Not Configured' : t.clicks,
      t.clicks == null ? 'raw' : 'int',
    ],
    ['Total Commission', t.commissionAED || 0, 'money'],
    ['Total Shipping', t.shippingAED || 0, 'money'],
    ['Total Cost %', t.costPercentage, 'pct'],
    ['General Ecommerce', 'Not Configured', 'raw'],
    ['Total Amount', t.salesAmountAED || 0, 'money'],
    ['Total Balance', t.balanceAED || 0, 'money'],
  ]
  for (const [label, val, kind] of totals) {
    ws.getCell(row, 1).value = label
    ws.getCell(row, 1).font = { bold: true }
    const cell = ws.getCell(row, 2)
    if (kind === 'raw') cell.value = val
    else if (kind === 'pct') {
      cell.value = Number(val) || 0
      cell.numFmt = PCT_FMT
    } else if (kind === 'int') cell.value = Math.round(Number(val) || 0)
    else {
      cell.value = Number(val) || 0
      cell.numFmt = MONEY_FMT
    }
    border(ws.getCell(row, 1))
    border(cell)
    row += 1
  }

  if (report.amazonAdsExcluded) {
    row += 1
    ws.mergeCells(row, 1, row, 18)
    ws.getCell(row, 1).value =
      'Note: Amazon advertising is Not Configured and excluded from cost calculations.'
    ws.getCell(row, 1).font = { italic: true, size: 9, color: { argb: 'FF64748B' } }
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

module.exports = {
  buildDailyEcommerceReportXlsxBuffer,
}
