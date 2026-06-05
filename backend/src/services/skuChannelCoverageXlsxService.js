const ExcelJS = require('exceljs')
const { buildBusinessTableXlsxBuffer } = require('../utils/businessTableXlsx')

const EXPORT_COLUMNS = [
  { header: 'Zoho Item ID', key: 'zohoItemId', width: 16 },
  { header: 'Zoho Item Name', key: 'zohoItemName', width: 36 },
  { header: 'Zoho SKU', key: 'zohoSku', width: 22 },
  { header: 'Normalized Match Key', key: 'normalizedZohoKey', width: 24 },
  { header: 'Amazon UAE Matched', key: 'amazonUaeMatched', width: 14 },
  { header: 'Amazon UAE SKU', key: 'amazonUaeSku', width: 22 },
  { header: 'Amazon UAE Status', key: 'amazonUaeStatus', width: 16 },
  { header: 'Amazon KSA Matched', key: 'amazonKsaMatched', width: 14 },
  { header: 'Amazon KSA SKU', key: 'amazonKsaSku', width: 22 },
  { header: 'Amazon KSA Status', key: 'amazonKsaStatus', width: 16 },
  { header: 'Amazon Matched Any', key: 'amazonMatchedAny', width: 14 },
  { header: 'Noon Matched', key: 'noonMatched', width: 12 },
  { header: 'Noon PSKU', key: 'noonSku', width: 22 },
  { header: 'Noon Status', key: 'noonStatus', width: 14 },
  { header: 'Vigil Matched', key: 'vigilMatched', width: 12 },
  { header: 'Vigil SKU', key: 'vigilSku', width: 22 },
  { header: 'Vigil Stock Qty', key: 'vigilStockQty', width: 14 },
  { header: 'Coverage Status', key: 'coverageStatus', width: 18 },
]

function boolLabel(value) {
  return value ? 'Yes' : 'No'
}

function rowToExportObject(row) {
  return {
    zohoItemId: row.zohoItemId || '',
    zohoItemName: row.zohoItemName || '',
    zohoSku: row.zohoSku || '',
    normalizedZohoKey: row.normalizedZohoKey || '',
    amazonUaeMatched: boolLabel(row.amazonUaeMatched),
    amazonUaeSku: row.amazonUaeSku || '',
    amazonUaeStatus: row.amazonUaeStatus || '',
    amazonKsaMatched: boolLabel(row.amazonKsaMatched),
    amazonKsaSku: row.amazonKsaSku || '',
    amazonKsaStatus: row.amazonKsaStatus || '',
    amazonMatchedAny: boolLabel(row.amazonMatchedAny),
    noonMatched: boolLabel(row.noonMatched),
    noonSku: row.noonSku || '',
    noonStatus: row.noonStatus || '',
    vigilMatched: boolLabel(row.vigilMatched),
    vigilSku: row.vigilSku || '',
    vigilStockQty: row.vigilStockQty == null ? '' : String(row.vigilStockQty),
    coverageStatus: row.coverageStatus || '',
  }
}

function buildColumnSchema() {
  return EXPORT_COLUMNS.map((col) => ({
    header: col.header,
    width: col.width,
    type: 'rowText',
    getValue: (row) => {
      const v = row[col.key]
      return v == null || v === '' ? '' : String(v)
    },
    grandTotalText: col.key === 'zohoItemName' ? 'Total' : '\u00A0',
  }))
}

function filterRowsByStatus(rows, predicate) {
  return (rows || []).filter(predicate).map(rowToExportObject)
}

function buildSummarySheetItems(summary, meta) {
  const s = summary || {}
  const m = meta || {}
  return [
    { metric: 'Total Active Zoho Items', value: s.totalActiveZohoItems ?? 0 },
    { metric: 'Matched Amazon UAE', value: s.matchedAmazonUae ?? 0 },
    { metric: 'Matched Amazon KSA', value: s.matchedAmazonKsa ?? 0 },
    { metric: 'Matched Amazon (any)', value: s.matchedAmazonAny ?? 0 },
    { metric: 'Matched Noon', value: s.matchedNoon ?? 0 },
    { metric: 'Missing Amazon', value: s.missingAmazon ?? 0 },
    { metric: 'Missing Noon', value: s.missingNoon ?? 0 },
    { metric: 'Missing All Channels', value: s.missingAllChannels ?? 0 },
    { metric: 'Generated At', value: m.generatedAt || '' },
    { metric: 'Amazon UAE Listings', value: m.amazonUaeListingCount ?? 0 },
    { metric: 'Amazon KSA Listings', value: m.amazonKsaListingCount ?? 0 },
    { metric: 'Noon Items', value: m.noonItemCount ?? 0 },
    { metric: 'Noon Data Source', value: m.noonSource || '' },
  ]
}

async function addSimpleDataSheet(workbook, sheetName, items, columns) {
  const buffer = await buildBusinessTableXlsxBuffer({
    sheetTitle: sheetName,
    fromDate: new Date().toISOString().slice(0, 10),
    toDate: new Date().toISOString().slice(0, 10),
    items,
    totals: {},
    columns,
  })
  const partial = new ExcelJS.Workbook()
  await partial.xlsx.load(buffer)
  const source = partial.worksheets[0]
  const target = workbook.addWorksheet(sheetName.slice(0, 31))
  source.eachRow((row, rowNumber) => {
    const newRow = target.getRow(rowNumber)
    row.eachCell((cell, colNumber) => {
      const targetCell = newRow.getCell(colNumber)
      targetCell.value = cell.value
      if (cell.font) targetCell.font = { ...cell.font }
      if (cell.fill) targetCell.fill = { ...cell.fill }
      if (cell.border) targetCell.border = { ...cell.border }
      if (cell.alignment) targetCell.alignment = { ...cell.alignment }
    })
    newRow.height = row.height
  })
  target.views = source.views
}

/**
 * @param {{ rows: object[], summary: object, meta?: object }} params
 * @returns {Promise<Buffer>}
 */
async function buildSkuChannelCoverageXlsxBuffer({ rows, summary, meta }) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'LifeSmile HR Attendance App'
  workbook.created = new Date()

  const allRows = (rows || []).map(rowToExportObject)
  const columns = buildColumnSchema()

  const sheets = [
    { name: 'Full Coverage Report', items: allRows },
    {
      name: 'Missing Amazon',
      items: filterRowsByStatus(rows, (r) => !r.amazonMatchedAny),
    },
    {
      name: 'Missing Noon',
      items: filterRowsByStatus(rows, (r) => !r.noonMatched),
    },
    {
      name: 'Missing All Channels',
      items: filterRowsByStatus(rows, (r) => !r.amazonMatchedAny && !r.noonMatched),
    },
  ]

  for (const sheet of sheets) {
    // eslint-disable-next-line no-await-in-loop
    await addSimpleDataSheet(workbook, sheet.name, sheet.items, columns)
  }

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 36 },
    { header: 'Value', key: 'value', width: 28 },
  ]
  summarySheet.getRow(1).font = { bold: true }
  summarySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
  for (const item of buildSummarySheetItems(summary, meta)) {
    summarySheet.addRow(item)
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
}

module.exports = {
  buildSkuChannelCoverageXlsxBuffer,
  rowToExportObject,
  EXPORT_COLUMNS,
}
