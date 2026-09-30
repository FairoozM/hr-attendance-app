'use strict'

/**
 * Tabby AED settlement report (XLSX) → classified rows. Pure: no I/O besides reading the buffer.
 *
 * Nothing is taken from fixed row numbers or column letters: the header row is the row that
 * carries the known column titles, columns resolve by normalized title, and statement metadata
 * ("Statement #", "Date", "Company Name") resolves by label. Every money value is kept as an
 * integer number of fils so sums and comparisons are exact.
 *
 * Meaningful rows classify as SALE, REFUND, PAYOUT_FEE, TOTAL, NOTE or UNKNOWN. Formatted blank
 * rows are dropped; nothing meaningful is dropped silently. Each row keeps its Excel row number
 * and its raw cells keyed by the original header.
 */

const crypto = require('crypto')
const XLSX = require('xlsx')

const ROW_KIND = Object.freeze({
  SALE: 'SALE',
  REFUND: 'REFUND',
  PAYOUT_FEE: 'PAYOUT_FEE',
  TOTAL: 'TOTAL',
  NOTE: 'NOTE',
  UNKNOWN: 'UNKNOWN',
})

// Normalized header → field. Normalization lowercases and drops everything but letters/digits.
const COLUMNS = Object.freeze({
  ordernumber: 'orderNumber',
  websiteorderid: 'websiteOrderId',
  salerefunddate: 'saleRefundDate',
  merchantname: 'merchantName',
  merchantcode: 'merchantCode',
  producttype: 'productType',
  type: 'type',
  currency: 'currency',
  orderamount: 'orderAmount',
  commissionrate: 'commissionRate',
  refundablecommission: 'refundableCommission',
  nonrefundablecommission: 'nonRefundableCommission',
  fixedfee: 'fixedFee',
  totalfee: 'totalFee',
  vatamount: 'vatAmount',
  vatrate: 'vatRate',
  totaldeduction: 'totalDeduction',
  transferredamount: 'transferredAmount',
  transferdate: 'transferDate',
})

const REQUIRED_FIELDS = Object.freeze([
  'orderNumber', 'websiteOrderId', 'saleRefundDate', 'merchantCode', 'productType', 'type', 'currency', 'orderAmount',
  'refundableCommission', 'nonRefundableCommission', 'fixedFee', 'totalFee', 'vatAmount', 'totalDeduction',
  'transferredAmount', 'transferDate',
])

const MONEY_FIELDS = Object.freeze([
  'orderAmount', 'refundableCommission', 'nonRefundableCommission', 'fixedFee', 'totalFee', 'vatAmount', 'totalDeduction', 'transferredAmount',
])

const STATEMENT_PATTERN = /^Tabby\d{8}[A-Z]{3}$/

function clean(value) {
  return value == null ? '' : String(value).replace(/\s+/g, ' ').trim()
}

function normalizeHeader(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isBlank(value) {
  return value == null || clean(value) === ''
}

/**
 * Decimal-safe money → integer fils. Accepts numbers and strings ("1,019.00", "(6.30)", "AED -6.3").
 * Returns { minor, ok, blank }. More than two decimals is rejected, not rounded away silently,
 * except for float noise on numeric cells (e.g. 45.859999999).
 */
function toMinor(value) {
  if (isBlank(value)) return { minor: 0, ok: true, blank: true }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { minor: 0, ok: false, blank: false }
    const scaled = value * 100
    const rounded = Math.round(scaled)
    if (Math.abs(scaled - rounded) > 1e-6) return { minor: rounded, ok: false, blank: false }
    return { minor: rounded === 0 ? 0 : rounded, ok: true, blank: false }
  }
  let s = clean(value).replace(/aed/i, '').replace(/,/g, '').replace(/\s/g, '')
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith('+')) s = s.slice(1)
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s)
  if (!m) return { minor: 0, ok: false, blank: false }
  const minor = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'))
  return { minor: negative && minor !== 0 ? -minor : minor, ok: true, blank: false }
}

function fromMinor(minor) {
  return Math.round(Number(minor) || 0) / 100
}

function pad(n) {
  return String(n).padStart(2, '0')
}

/** Excel serial (1900 system) → { date: 'YYYY-MM-DD', dateTime: 'YYYY-MM-DDTHH:MM:SS' } (report-local time). */
function excelSerialToParts(serial) {
  const ms = Math.round((Number(serial) - 25569) * 86400 * 1000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  return { date, dateTime: `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` }
}

/** Report date cell → parts; accepts Excel serials, "dd/mm/yyyy[ hh:mm[:ss]]" and ISO strings. */
function toDateParts(value) {
  if (isBlank(value)) return null
  if (typeof value === 'number') return excelSerialToParts(value)
  if (value instanceof Date) return excelSerialToParts(value.getTime() / 86400000 + 25569)
  const s = clean(value)
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (m) {
    const date = `${m[3]}-${pad(m[2])}-${pad(m[1])}`
    return { date, dateTime: `${date}T${pad(m[4] || 0)}:${m[5] || '00'}:${m[6] || '00'}` }
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s)
  if (m) {
    const date = `${m[1]}-${m[2]}-${m[3]}`
    return { date, dateTime: `${date}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}` }
  }
  return null
}

function identifier(value) {
  if (isBlank(value)) return ''
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value)
  return clean(value)
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function problem(code, message, extra = {}) {
  return { code, message, ...extra }
}

function sheetRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true })
}

/** The row holding the most known column titles (at least 8). */
function findHeaderRow(rows) {
  let best = { index: -1, hits: 0 }
  rows.forEach((row, index) => {
    const hits = new Set((row || []).map(normalizeHeader).filter((h) => COLUMNS[h])).size
    if (hits > best.hits) best = { index, hits }
  })
  return best.hits >= 8 ? best.index : -1
}

/** "Label" cell followed (same row) by its value in the next non-empty cell. */
function readMetadata(rows, headerIndex) {
  const meta = {}
  const labels = { statement: 'statementNumber', statementno: 'statementNumber', statementnumber: 'statementNumber', date: 'statementDate', companyname: 'companyName', merchantname: 'merchantName', merchantcode: 'merchantCode' }
  const limit = headerIndex >= 0 ? headerIndex : rows.length
  for (let i = 0; i < limit; i++) {
    const row = rows[i] || []
    for (let c = 0; c < row.length; c++) {
      const key = labels[normalizeHeader(row[c])]
      if (!key || meta[key] !== undefined) continue
      for (let v = c + 1; v < row.length; v++) {
        if (!isBlank(row[v])) {
          meta[key] = { value: row[v], excelRow: i + 1 }
          break
        }
      }
    }
  }
  return meta
}

function looksLikeNote(cells) {
  const texts = cells.filter((c) => !isBlank(c.value))
  return texts.length === 1 && typeof texts[0].value === 'string' && (/^note\b/i.test(clean(texts[0].value)) || clean(texts[0].value).length > 60)
}

function classify(fields, cells) {
  const type = normalizeHeader(fields.type)
  const product = normalizeHeader(fields.productType)
  const hasId = !isBlank(fields.orderNumber) || !isBlank(fields.websiteOrderId)
  if (type === 'sale') return { kind: ROW_KIND.SALE, subtype: 'sale' }
  if (type === 'refund') return { kind: ROW_KIND.REFUND, subtype: 'refund' }
  if (type === 'partialrefund') return { kind: ROW_KIND.REFUND, subtype: 'partial refund' }
  if (!hasId && cells.some((c) => normalizeHeader(c.value) === 'payoutfee')) return { kind: ROW_KIND.PAYOUT_FEE, subtype: 'payout fee' }
  if (looksLikeNote(cells)) return { kind: ROW_KIND.NOTE, subtype: null }
  const moneyCount = MONEY_FIELDS.filter((f) => !isBlank(fields[f])).length
  if (!hasId && isBlank(fields.type) && isBlank(fields.productType) && moneyCount >= 3) return { kind: ROW_KIND.TOTAL, subtype: null }
  return { kind: ROW_KIND.UNKNOWN, subtype: null }
}

/**
 * @param {Buffer} buffer XLSX file
 * @param {{ fileName?: string }} [opts]
 */
function parseTabbyStatement(buffer, opts = {}) {
  const problems = []
  const fileHash = sha256(buffer)
  let workbook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  } catch (err) {
    return { fileHash, fileName: opts.fileName || null, statement: {}, columns: {}, rows: [], problems: [problem('FILE_UNREADABLE', `The file could not be read as XLSX: ${err.message}`)] }
  }
  let sheetName = null
  let rows = []
  let headerIndex = -1
  for (const name of workbook.SheetNames) {
    const candidate = sheetRows(workbook.Sheets[name])
    const idx = findHeaderRow(candidate)
    if (idx >= 0) {
      sheetName = name
      rows = candidate
      headerIndex = idx
      break
    }
  }
  if (headerIndex < 0) {
    return {
      fileHash,
      fileName: opts.fileName || null,
      statement: {},
      columns: {},
      rows: [],
      problems: [problem('HEADERS_NOT_FOUND', 'No sheet has the Tabby settlement column titles (Order Number, Type, Order Amount, Total Deduction, …).')],
    }
  }

  const headerCells = rows[headerIndex] || []
  const columns = {}
  const headerByIndex = {}
  const unknownHeaders = []
  headerCells.forEach((cell, index) => {
    if (isBlank(cell)) return
    headerByIndex[index] = clean(cell)
    const field = COLUMNS[normalizeHeader(cell)]
    if (!field) {
      unknownHeaders.push({ header: clean(cell), index, letter: XLSX.utils.encode_col(index) })
      return
    }
    if (columns[field]) {
      problems.push(problem('DUPLICATE_HEADER', `Column "${clean(cell)}" appears more than once.`, { excelRow: headerIndex + 1 }))
      return
    }
    columns[field] = { header: clean(cell), index, letter: XLSX.utils.encode_col(index) }
  })
  const missingHeaders = REQUIRED_FIELDS.filter((f) => !columns[f])
  for (const f of missingHeaders) problems.push(problem('MISSING_REQUIRED_HEADER', `Required column for "${f}" is missing.`, { field: f }))

  const meta = readMetadata(rows, headerIndex)
  const statementNumber = meta.statementNumber ? clean(meta.statementNumber.value) : ''
  const statementDate = meta.statementDate ? toDateParts(meta.statementDate.value) : null
  const statement = {
    statementNumber,
    statementDate: statementDate ? statementDate.date : null,
    companyName: meta.companyName ? clean(meta.companyName.value) : null,
    recognized: STATEMENT_PATTERN.test(statementNumber),
    currencyFromNumber: STATEMENT_PATTERN.test(statementNumber) ? statementNumber.slice(-3) : null,
    sheetName,
    headerRow: headerIndex + 1,
  }
  if (!statementNumber) problems.push(problem('STATEMENT_NUMBER_MISSING', 'The report has no "Statement #".'))
  else if (!statement.recognized) problems.push(problem('STATEMENT_NOT_RECOGNIZED', `Statement # "${statementNumber}" is not a Tabby statement number (Tabby<yyyymmdd><CCY>).`))

  const parsedRows = []
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] || []
    const cells = row.map((value, index) => ({ value, index })).filter((c) => !isBlank(c.value))
    if (cells.length === 0) continue
    const raw = {}
    for (const c of cells) raw[headerByIndex[c.index] || `(column ${XLSX.utils.encode_col(c.index)})`] = c.value
    const fields = {}
    for (const [field, col] of Object.entries(columns)) fields[field] = row[col.index] == null ? null : row[col.index]
    const { kind, subtype } = classify(fields, cells)
    const rowProblems = []
    const money = {}
    for (const f of MONEY_FIELDS) {
      const parsed = toMinor(fields[f])
      money[f] = parsed.minor
      if (!parsed.ok) rowProblems.push(problem('INVALID_AMOUNT', `"${columns[f] ? columns[f].header : f}" value "${fields[f]}" is not an AED amount with at most two decimals.`, { field: f }))
    }
    const sale = toDateParts(fields.saleRefundDate)
    const transfer = toDateParts(fields.transferDate)
    const note = kind === ROW_KIND.NOTE
    parsedRows.push({
      excelRow: i + 1,
      kind,
      subtype,
      text: note ? cells.map((c) => clean(c.value)).join(' ') : null,
      orderNumber: note ? '' : identifier(fields.orderNumber),
      websiteOrderId: note ? '' : identifier(fields.websiteOrderId),
      saleRefundDate: sale ? sale.dateTime : null,
      saleRefundDay: sale ? sale.date : null,
      transferDate: transfer ? transfer.date : null,
      merchantName: clean(fields.merchantName) || null,
      merchantCode: clean(fields.merchantCode) || null,
      productType: clean(fields.productType) || null,
      type: clean(fields.type) || null,
      currency: clean(fields.currency).toUpperCase() || null,
      commissionRate: isBlank(fields.commissionRate) ? null : clean(fields.commissionRate),
      vatRate: isBlank(fields.vatRate) ? null : clean(fields.vatRate),
      minor: money,
      problems: rowProblems,
      raw,
    })
  }
  return {
    fileHash,
    fileName: opts.fileName || null,
    statement,
    columns,
    unknownHeaders,
    missingHeaders,
    rows: parsedRows,
    problems,
  }
}

module.exports = {
  ROW_KIND,
  COLUMNS,
  REQUIRED_FIELDS,
  MONEY_FIELDS,
  STATEMENT_PATTERN,
  normalizeHeader,
  toMinor,
  fromMinor,
  toDateParts,
  parseTabbyStatement,
  sha256,
}
