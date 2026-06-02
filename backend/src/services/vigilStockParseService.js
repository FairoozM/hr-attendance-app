const XLSX = require('xlsx')
const { parseCsv, indexHeaders, cellOf } = require('../utils/csv')
const { normalizeSku } = require('../utils/purchasePlanningSkuMatcher')

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function toNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : fallback
}

function findHeader(headerIdx, candidates) {
  for (const name of candidates) {
    if (headerIdx.has(name)) return name
  }
  return ''
}

function vigilStockFromRawRow(raw, headerIdx, stockHeader, codeColumnIndex) {
  if (stockHeader) {
    return toNumber(cellOf(raw, headerIdx, stockHeader), NaN)
  }
  const start = Number.isInteger(codeColumnIndex) && codeColumnIndex >= 0 ? codeColumnIndex + 1 : 1
  for (let i = start; i < raw.length; i += 1) {
    const n = toNumber(raw[i], NaN)
    if (Number.isFinite(n)) return n
  }
  return NaN
}

function parseTabularExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const sheetName = workbook.SheetNames && workbook.SheetNames[0]
  if (!sheetName) {
    const err = new Error('Excel workbook does not contain any sheets')
    err.code = 'EXCEL_PARSE_ERROR'
    throw err
  }
  const worksheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  })
  if (!rows.length) {
    const err = new Error('Excel sheet is empty')
    err.code = 'EXCEL_PARSE_ERROR'
    throw err
  }
  const headers = rows[0].map((cell) => clean(cell))
  if (!headers.length || headers.every((header) => !header)) {
    const err = new Error('Excel header row is empty')
    err.code = 'EXCEL_PARSE_ERROR'
    throw err
  }
  const bodyRows = rows
    .slice(1)
    .filter((row) => Array.isArray(row) && row.some((cell) => clean(cell) !== ''))
    .map((row) => {
      const out = row.map((cell) => clean(cell))
      while (out.length < headers.length) out.push('')
      out.length = headers.length
      return out
    })
  return { headers, rows: bodyRows }
}

const ITEM_CODE_CANDIDATES = [
  'item code',
  'item_code',
  'itemcode',
  'item no',
  'item no.',
  'item number',
  'item #',
  'product code',
  'product',
  'material code',
  'article',
  'code',
  'sku',
  'item',
]

const STOCK_CANDIDATES = [
  'available stock',
  'available_stock',
  'available qty',
  'available_qty',
  'available quantity',
  'wholesale stock',
  'wholesale qty',
  'free stock',
  'on hand',
  'onhand',
  'balance',
  'stock',
  'qty',
  'quantity',
  'available',
]

const ITEM_NAME_CANDIDATES = ['item name', 'item_name', 'name', 'description', 'product name', 'product_name']

function resolveHeaders(headerIdx, columnMapping = {}) {
  const itemCodeHeader =
    columnMapping.itemCodeHeader && headerIdx.has(String(columnMapping.itemCodeHeader).toLowerCase())
      ? String(columnMapping.itemCodeHeader).toLowerCase()
      : findHeader(headerIdx, ITEM_CODE_CANDIDATES)
  const stockHeader =
    columnMapping.stockHeader && headerIdx.has(String(columnMapping.stockHeader).toLowerCase())
      ? String(columnMapping.stockHeader).toLowerCase()
      : findHeader(headerIdx, STOCK_CANDIDATES)
  const itemNameHeader =
    columnMapping.itemNameHeader && headerIdx.has(String(columnMapping.itemNameHeader).toLowerCase())
      ? String(columnMapping.itemNameHeader).toLowerCase()
      : findHeader(headerIdx, ITEM_NAME_CANDIDATES)
  return { itemCodeHeader, stockHeader, itemNameHeader }
}

function detectColumnMappingConfidence(headers, columnMapping = {}) {
  const headerIdx = indexHeaders(headers)
  const resolved = resolveHeaders(headerIdx, columnMapping)
  const needsColumnMapping = !resolved.itemCodeHeader || !resolved.stockHeader
  const ambiguousItemCode =
    !columnMapping.itemCodeHeader &&
    ITEM_CODE_CANDIDATES.filter((c) => headerIdx.has(c)).length > 1 &&
    !resolved.itemCodeHeader
  return {
    needsColumnMapping: needsColumnMapping || ambiguousItemCode,
    ...resolved,
    availableHeaders: headers.filter(Boolean),
  }
}

function parseVigilRows(headers, rawRows, options = {}) {
  const headerIdx = indexHeaders(headers)
  const { itemCodeHeader, stockHeader, itemNameHeader } = resolveHeaders(headerIdx, options.columnMapping || {})
  const confidence = detectColumnMappingConfidence(headers, options.columnMapping || {})
  const codeColumnIndex = itemCodeHeader ? headerIdx.get(itemCodeHeader) : 0

  const rows = rawRows.map((raw, index) => {
    const itemCode = itemCodeHeader ? cellOf(raw, headerIdx, itemCodeHeader) : clean(raw[0])
    const itemName = itemNameHeader ? cellOf(raw, headerIdx, itemNameHeader) : ''
    const availableStock = vigilStockFromRawRow(raw, headerIdx, stockHeader, codeColumnIndex)
    const errors = []
    if (!itemCode) errors.push('Missing item code')
    if (!Number.isFinite(availableStock)) errors.push('Invalid available stock')
    return {
      rowNumber: index + 2,
      itemCode: clean(itemCode),
      itemName: clean(itemName),
      normalizedItemCode: normalizeSku(itemCode),
      availableStock: Number.isFinite(availableStock) ? availableStock : 0,
      errors,
      valid: errors.length === 0,
    }
  })

  return {
    headers,
    rows,
    summary: {
      rows: rows.length,
      validRows: rows.filter((row) => row.valid).length,
      invalidRows: rows.filter((row) => !row.valid).length,
      itemCodeHeader,
      stockHeader,
      itemNameHeader,
    },
    needsColumnMapping: confidence.needsColumnMapping,
    availableHeaders: confidence.availableHeaders,
  }
}

function parseVigilCsv(text, options = {}) {
  const parsed = parseCsv(text)
  if (!parsed.headers.length && !parsed.rows.length) {
    const err = new Error('Vigil file is empty')
    err.code = 'VIGIL_FILE_EMPTY'
    throw err
  }
  return parseVigilRows(parsed.headers, parsed.rows, options)
}

function parseVigilExcel(buffer, options = {}) {
  const parsed = parseTabularExcel(buffer)
  return parseVigilRows(parsed.headers, parsed.rows, options)
}

function isExcelFile(fileName) {
  return /\.(xlsx|xls)$/i.test(clean(fileName))
}

async function previewVigilUpload(buffer, fileName = '', options = {}) {
  if (!buffer || !buffer.length) {
    const err = new Error('Vigil file is empty')
    err.code = 'VIGIL_FILE_EMPTY'
    throw err
  }
  if (isExcelFile(fileName)) return parseVigilExcel(buffer, options)
  return parseVigilCsv(buffer.toString('utf8'), options)
}

module.exports = {
  previewVigilUpload,
  parseVigilRows,
  parseVigilCsv,
  parseVigilExcel,
  parseTabularExcel,
  isExcelFile,
  detectColumnMappingConfidence,
  ITEM_CODE_CANDIDATES,
  STOCK_CANDIDATES,
}
