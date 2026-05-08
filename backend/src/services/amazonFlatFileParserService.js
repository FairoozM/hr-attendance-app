const path = require('path')
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

function sheetCellText(cell) {
  if (!cell) return ''
  if (cell.w != null) return String(cell.w).trim()
  if (cell.v != null) return String(cell.v).trim()
  return ''
}

function chooseTemplateSheetName(workbook) {
  return (
    workbook.SheetNames.find((name) => /^template$/i.test(String(name).trim())) ||
    workbook.SheetNames.find((name) => /template/i.test(String(name))) ||
    workbook.SheetNames[0]
  )
}

function addColumn(columns, seen, label, colNumber) {
  if (!label) return
  const base = normalizeKey(label) || `column_${colNumber}`
  const count = seen.get(base) || 0
  seen.set(base, count + 1)
  columns.push({ key: count === 0 ? base : `${base}_${count + 1}`, label, colNumber })
}

function parseWithSheetJs(buffer) {
  const sheetBook = XLSX.read(buffer, { type: 'buffer', bookSheets: true })
  const sheetName = chooseTemplateSheetName(sheetBook)
  if (!sheetName) throw new Error('Template sheet not found')
  // Parse only the Template sheet; Amazon flat files can contain many helper sheets and macros.
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false, sheets: sheetName })
  const sheet = workbook.Sheets[sheetName]
  const rowCells = new Map()
  for (const addr of Object.keys(sheet || {})) {
    if (addr[0] === '!') continue
    const pos = XLSX.utils.decode_cell(addr)
    const rowNumber = pos.r + 1
    const colNumber = pos.c + 1
    const row = rowCells.get(rowNumber) || new Map()
    row.set(colNumber, sheetCellText(sheet[addr]))
    rowCells.set(rowNumber, row)
  }

  let best = { rowIndex: 0, score: -1, values: [] }
  for (let rowNumber = 1; rowNumber <= 20; rowNumber++) {
    const row = rowCells.get(rowNumber) || new Map()
    const values = []
    for (const [colNumber, value] of row.entries()) values[colNumber - 1] = value
    const score = scoreHeaderRow(values)
    if (score > best.score) best = { rowIndex: rowNumber - 1, score, values }
  }

  const seen = new Map()
  const columns = []
  best.values.forEach((label, i) => addColumn(columns, seen, String(label || '').trim(), i + 1))

  const skuColumn = findSkuColumn(columns)
  if (!skuColumn) {
    const err = new Error('Could not find SKU column in Template sheet')
    err.code = 'SKU_COLUMN_MISSING'
    throw err
  }
  const allRows = []
  const rowNumbers = [...rowCells.keys()]
    .filter((rowNumber) => rowNumber > best.rowIndex + 1)
    .sort((a, b) => a - b)
  for (const rowNumber of rowNumbers) {
    const row = rowCells.get(rowNumber) || new Map()
    const values = {}
    for (const col of columns) values[col.key] = String(row.get(col.colNumber) || '').trim()
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
  return parseWithSheetJs(buffer)
}

module.exports = {
  MAX_SKUS_PER_BATCH,
  normalizeKey,
  parseAmazonFlatFile,
}
