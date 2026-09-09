'use strict'

/**
 * Excel export — side-by-side channel sections matching the operational sheet.
 * Column count follows the report's channel list (five sections).
 */

const ExcelJS = require('exceljs')

const CHANNEL_FILLS = {
  amazon_uae: 'FF93C5FD',
  amazon_ksa: 'FFA5B4FC',
  noon_uae: 'FFFCD34D',
  noon_ksa: 'FFFBBF24',
  life_smile: 'FF6EE7B7',
}

const MONEY_FMT = '#,##0.00;[Red]-#,##0.00'
const PCT_FMT = '0.00"%"'
const THIN = { style: 'thin', color: { argb: 'FF94A3B8' } }

function border(cell) {
  cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
}

/** Advertising cells never show a fabricated zero. */
function naAds(status, value) {
  if (status === 'not_configured') return 'Not Configured'
  if (status === 'unavailable') return 'Data Error'
  if (value == null) return 'Not Configured'
  return value
}

/** Costs that the marketplace has not reported yet stay Pending. */
function pendingOrNumber(value) {
  return value == null ? 'Pending' : value
}

function statusPlaceholder(channel) {
  if (channel.integrationStatus === 'not_configured') return 'Not Configured'
  if (channel.integrationStatus === 'unavailable') return 'Data Error'
  if (channel.integrationStatus === 'pending') return 'Pending'
  return null
}

function channelLines(channel) {
  const placeholder = statusPlaceholder(channel)
  if (placeholder) return [{ order: placeholder, sku: '', qty: '' }]
  const lines = []
  for (const order of channel.orders || []) {
    const items = order.items?.length ? order.items : [{ sku: '', quantity: 0 }]
    items.forEach((item, i) => {
      lines.push({
        order: i === 0 ? order.orderNumber : '',
        sku: item.sku || '',
        qty: item.quantity == null ? 'N/A' : item.quantity,
      })
    })
  }
  if (!lines.length) lines.push({ order: 'No orders', sku: '', qty: '' })
  return lines
}

function summarySpecs(channel) {
  const s = channel.summary || {}
  const ads = channel.adsStatus || 'not_configured'
  const placeholder = statusPlaceholder(channel)
  if (placeholder) {
    // A channel with no data must not print zeros for money or quantity
    const p = channel.family === 'amazon' ? 'Amazon' : channel.family === 'noon' ? 'Noon' : 'Website'
    return ['Qty', 'Ads', 'Clicks', 'Commission', 'Shipping', 'Cost %', 'Amount', 'Balance'].map(
      (metric) => [`${p} ${metric}`, placeholder, 'raw'],
    )
  }
  const qty = s.quantity == null ? ['N/A', 'raw'] : [s.quantity, 'int']
  if (channel.family === 'life_smile') {
    return [
      ['Website Qty', qty[0], qty[1]],
      ['FB/Instagram Ads', naAds(ads, s.adSpendAED), 'raw'],
      ['Website Clicks', naAds(ads, s.clicks), 'raw'],
      ['Tabby & Tamara Commission', pendingOrNumber(s.tabbyTamaraCommissionAED), 'money'],
      ['Smile Point & Coupon', s.smilePointCouponAED || 0, 'money'],
      ['Website Shipping', pendingOrNumber(s.shippingAED), 'money'],
      ['Website Cost %', s.costPercentage, 'pct'],
      ['Website Amount', s.salesAmountAED || 0, 'money'],
      ['Website Balance', s.balanceAED || 0, 'money'],
    ]
  }
  const prefix = channel.family === 'amazon' ? 'Amazon' : 'Noon'
  return [
    [`${prefix} Qty`, qty[0], qty[1]],
    [`${prefix} Ads`, naAds(ads, s.adSpendAED), 'raw'],
    [`${prefix} Clicks`, naAds(ads, s.clicks), 'raw'],
    [`${prefix} Commission`, pendingOrNumber(s.commissionAED), 'money'],
    [`${prefix} Shipping`, pendingOrNumber(s.shippingAED), 'money'],
    [`${prefix} Cost %`, s.costPercentage, 'pct'],
    [`${prefix} Amount`, s.salesAmountAED || 0, 'money'],
    [`${prefix} Balance`, s.balanceAED || 0, 'money'],
  ]
}

function writeValue(cell, value, kind) {
  if (kind === 'raw' || typeof value === 'string') {
    cell.value = value
    return
  }
  if (kind === 'pct') {
    cell.value = Number(value) || 0
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
  const totalCols = Math.max(3, channels.length * 3)
  for (let i = 1; i <= totalCols; i += 1) {
    ws.getColumn(i).width = i % 3 === 2 ? 18 : 14
  }

  ws.mergeCells(1, 1, 1, totalCols)
  ws.getCell(1, 1).value = `Daily Ecommerce Report — ${report.date}`
  ws.getCell(1, 1).alignment = { horizontal: 'center' }
  ws.getCell(1, 1).font = { bold: true, size: 14 }

  ws.mergeCells(2, 1, 2, totalCols)
  const rate = report.exchangeRate?.rateDisplay || Number(report.exchangeRate?.rate || 0).toFixed(4)
  ws.getCell(2, 1).value = `Timezone: ${report.timezone || 'Asia/Dubai'} · SAR to AED: ${rate}`
  ws.getCell(2, 1).alignment = { horizontal: 'center' }
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF64748B' } }

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

  const lineSets = channels.map(channelLines)
  const maxLines = Math.max(1, ...lineSets.map((l) => l.length))
  let row = 6
  for (let i = 0; i < maxLines; i += 1) {
    channels.forEach((_, idx) => {
      const line = lineSets[idx][i] || { order: '', sku: '', qty: '' }
      const c0 = idx * 3 + 1
      ws.getCell(row, c0).value = line.order
      ws.getCell(row, c0 + 1).value = line.sku
      ws.getCell(row, c0 + 2).value = line.qty
      for (let j = 0; j < 3; j += 1) border(ws.getCell(row, c0 + j))
    })
    row += 1
  }

  row += 1
  const specs = channels.map(summarySpecs)
  const maxSummary = Math.max(0, ...specs.map((s) => s.length))
  for (let i = 0; i < maxSummary; i += 1) {
    channels.forEach((_, idx) => {
      const spec = specs[idx][i]
      if (!spec) return
      const c0 = idx * 3 + 1
      ws.mergeCells(row, c0, row, c0 + 1)
      ws.getCell(row, c0).value = spec[0]
      ws.getCell(row, c0).font = { size: 9 }
      writeValue(ws.getCell(row, c0 + 2), spec[1], spec[2])
      for (let j = 0; j < 3; j += 1) border(ws.getCell(row, c0 + j))
    })
    row += 1
  }

  row += 1
  ws.mergeCells(row, 1, row, totalCols)
  ws.getCell(row, 1).value = 'Consolidated Totals'
  ws.getCell(row, 1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
  row += 1

  const t = report.totals || {}
  const totals = [
    ['Total Qty', t.quantity == null ? 'N/A' : t.quantity, 'int'],
    ['Total Ads', t.adSpendAED == null ? 'Not Configured' : t.adSpendAED, 'money'],
    ['Total Clicks', t.clicks == null ? 'Not Configured' : t.clicks, 'int'],
    ['Total Commission', pendingOrNumber(t.commissionAED), 'money'],
    ['Total Shipping', pendingOrNumber(t.shippingAED), 'money'],
    ['Total Cost %', t.costPercentage, 'pct'],
    ['General Ecommerce', 'Not Configured', 'raw'],
    ['Total Amount', t.salesAmountAED || 0, 'money'],
    ['Total Balance', t.balanceAED || 0, 'money'],
  ]
  for (const [label, val, kind] of totals) {
    ws.getCell(row, 1).value = label
    ws.getCell(row, 1).font = { bold: true }
    writeValue(ws.getCell(row, 2), val, kind)
    border(ws.getCell(row, 1))
    border(ws.getCell(row, 2))
    row += 1
  }

  const notes = []
  if (report.amazonAdsExcluded) {
    notes.push('Note: Amazon advertising is Not Configured and excluded from cost calculations.')
  }
  notes.push(
    'Note: FB/Instagram Ads are Not Configured — no Meta Marketing API integration exists in this application.',
  )
  for (const note of notes) {
    row += 1
    ws.mergeCells(row, 1, row, totalCols)
    ws.getCell(row, 1).value = note
    ws.getCell(row, 1).font = { italic: true, size: 9, color: { argb: 'FF64748B' } }
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

module.exports = {
  buildDailyEcommerceReportXlsxBuffer,
  channelLines,
  summarySpecs,
}
