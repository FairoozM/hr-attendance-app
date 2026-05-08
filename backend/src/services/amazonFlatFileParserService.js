const path = require('path')
const ExcelJS = require('exceljs')
const XLSX = require('xlsx')

const MAX_SKUS_PER_BATCH = 330

function normalizeKey(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[\s/\\().?]+/g, '_')
    .replace(/[^a-z0-9_]+/g, '')
    .replace(/^_+|_+$/g, '')
}

function cellText(cell) {
  const v = cell?.value
  if (v == null) return ''
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((x) => x.text || '').join('').trim()
    if (v.text != null) return String(v.text).trim()
    if (v.result != null) return String(v.result).trim()
    if (v.hyperlink && v.text) return String(v.text).trim()
  }
  return String(v).trim()
}

function findTemplateWorksheet(workbook) {
  return (
    workbook.worksheets.find((ws) => /^template$/i.test(String(ws.name || '').trim())) ||
    workbook.worksheets.find((ws) => /template/i.test(String(ws.name || ''))) ||
    workbook.worksheets[0]
  )
}

function scoreHeaderRow(values) {
  const keys = values.map(normalizeKey)
  let score = 0
  if (keys.includes('sku')) score += 10
  if (keys.includes('item_sku')) score += 8
  if (keys.includes('item_name')) score += 6
  if (keys.includes('product_type')) score += 4
  if (keys.includes('brand_name')) score += 4
  score += keys.filter(Boolean).length
  return score
}

function findHeaderRow(ws) {
  let best = { rowNumber: 1, score: -1, values: [] }
  const max = Math.min(ws.rowCount || 1, 20)
  for (let rowNumber = 1; rowNumber <= max; rowNumber++) {
    const row = ws.getRow(rowNumber)
    const values = []
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      values[colNumber - 1] = cellText(cell)
    })
    const score = scoreHeaderRow(values)
    if (score > best.score) best = { rowNumber, score, values }
  }
  return best
}

function collectColumns(ws, headerRowNumber) {
  const header = ws.getRow(headerRowNumber)
  const columns = []
  const seen = new Map()
  const maxCell = Math.max(header.cellCount || 0, ws.columnCount || 0)
  for (let colNumber = 1; colNumber <= maxCell; colNumber++) {
    const label = cellText(header.getCell(colNumber))
    if (!label) continue
    const base = normalizeKey(label) || `column_${colNumber}`
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    const key = count === 0 ? base : `${base}_${count + 1}`
    columns.push({ key, label, colNumber })
  }
  return columns
}

function findSkuColumn(columns) {
  return (
    columns.find((c) => c.key === 'sku') ||
    columns.find((c) => c.key === 'item_sku') ||
    columns.find((c) => /(^|_)sku($|_)/i.test(c.key))
  )
}

function rowHasAnyValue(values) {
  return Object.values(values).some((v) => String(v || '').trim() !== '')
}

function detectActiveColumns(rows, columns) {
  const active = []
  for (const col of columns) {
    const count = rows.reduce((n, row) => n + (String(row.values[col.key] || '').trim() ? 1 : 0), 0)
    if (count > 0) active.push({ ...col, filledCount: count })
  }
  return active
}

function buildSourceMap(values) {
  const source = {}
  for (const [key, val] of Object.entries(values)) {
    if (String(val || '').trim()) source[key] = 'Uploaded File'
  }
  return source
}

async function parseWithExcelJs(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const ws = findTemplateWorksheet(workbook)
  if (!ws) throw new Error('Template sheet not found')
  const header = findHeaderRow(ws)
  const columns = collectColumns(ws, header.rowNumber)
  const skuColumn = findSkuColumn(columns)
  if (!skuColumn) {
    const err = new Error('Could not find SKU column in Template sheet')
    err.code = 'SKU_COLUMN_MISSING'
    throw err
  }

  const allRows = []
  for (let rowNumber = header.rowNumber + 1; rowNumber <= ws.rowCount; rowNumber++) {
    const row = ws.getRow(rowNumber)
    const values = {}
    for (const col of columns) {
      values[col.key] = cellText(row.getCell(col.colNumber))
    }
    const sku = String(values[skuColumn.key] || '').trim()
    if (!sku && !rowHasAnyValue(values)) continue
    if (!sku) continue
    allRows.push({
      rowIndex: allRows.length,
      sheetRowNumber: rowNumber,
      sku,
      itemName: values.item_name || values.product_name || values.item_title || '',
      values,
      sourceMap: buildSourceMap(values),
    })
  }

  const importedRows = allRows.slice(0, MAX_SKUS_PER_BATCH)
  return {
    sheetName: ws.name,
    headerRowNumber: header.rowNumber,
    columns,
    activeColumns: detectActiveColumns(importedRows, columns),
    rows: importedRows,
    totalSkuCount: allRows.length,
    overflowCount: Math.max(0, allRows.length - MAX_SKUS_PER_BATCH),
    validValues: {},
    warning:
      allRows.length > MAX_SKUS_PER_BATCH
        ? `This file contains ${allRows.length} SKUs. Maximum allowed per batch is ${MAX_SKUS_PER_BATCH}.`
        : '',
  }
}

function parseLegacyXls(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false })
  const sheetName =
    workbook.SheetNames.find((name) => /^template$/i.test(String(name).trim())) ||
    workbook.SheetNames.find((name) => /template/i.test(String(name))) ||
    workbook.SheetNames[0]
  if (!sheetName) throw new Error('Template sheet not found')
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false })
  let best = { rowIndex: 0, score: -1, values: [] }
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const values = (matrix[i] || []).map((v) => String(v || '').trim())
    const score = scoreHeaderRow(values)
    if (score > best.score) best = { rowIndex: i, score, values }
  }
  const seen = new Map()
  const columns = best.values
    .map((label, i) => {
      if (!label) return null
      const base = normalizeKey(label) || `column_${i + 1}`
      const count = seen.get(base) || 0
      seen.set(base, count + 1)
      return { key: count === 0 ? base : `${base}_${count + 1}`, label, colNumber: i + 1 }
    })
    .filter(Boolean)
  const skuColumn = findSkuColumn(columns)
  if (!skuColumn) {
    const err = new Error('Could not find SKU column in Template sheet')
    err.code = 'SKU_COLUMN_MISSING'
    throw err
  }
  const allRows = []
  for (let i = best.rowIndex + 1; i < matrix.length; i++) {
    const values = {}
    for (const col of columns) values[col.key] = String(matrix[i]?.[col.colNumber - 1] || '').trim()
    const sku = String(values[skuColumn.key] || '').trim()
    if (!sku && !rowHasAnyValue(values)) continue
    if (!sku) continue
    allRows.push({
      rowIndex: allRows.length,
      sheetRowNumber: i + 1,
      sku,
      itemName: values.item_name || values.product_name || values.item_title || '',
      values,
      sourceMap: buildSourceMap(values),
    })
  }
  const importedRows = allRows.slice(0, MAX_SKUS_PER_BATCH)
  return {
    sheetName,
    headerRowNumber: best.rowIndex + 1,
    columns,
    activeColumns: detectActiveColumns(importedRows, columns),
    rows: importedRows,
    totalSkuCount: allRows.length,
    overflowCount: Math.max(0, allRows.length - MAX_SKUS_PER_BATCH),
    validValues: {},
    warning:
      allRows.length > MAX_SKUS_PER_BATCH
        ? `This file contains ${allRows.length} SKUs. Maximum allowed per batch is ${MAX_SKUS_PER_BATCH}.`
        : '',
  }
}

async function parseAmazonFlatFile({ buffer, filename }) {
  const ext = path.extname(filename || '').toLowerCase()
  if (!['.xlsx', '.xlsm', '.xls'].includes(ext)) {
    const err = new Error('Unsupported file type. Upload .xlsx, .xlsm, or .xls.')
    err.code = 'UNSUPPORTED_FILE_TYPE'
    throw err
  }
  if (ext === '.xls') return parseLegacyXls(buffer)
  return parseWithExcelJs(buffer)
}

module.exports = {
  MAX_SKUS_PER_BATCH,
  normalizeKey,
  parseAmazonFlatFile,
}
