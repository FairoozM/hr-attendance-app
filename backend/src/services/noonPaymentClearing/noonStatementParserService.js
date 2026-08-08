const {
  classifyNoonStatementRow,
  normalizeNoonFeeType,
  round2,
  num,
  clean,
} = require('./noonPaymentClearingCategoryService')
const { resolveNoonOrderIds } = require('./noonOrderIdHelper')

function normalizeHeader(value) {
  return clean(value)
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/[_\s]+/g, '-')
}

function splitLine(line, delimiter) {
  if (delimiter === '\t') return String(line).split('\t')
  const out = []
  let cur = ''
  let quoted = false
  const raw = String(line)
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (ch === '"') {
      if (quoted && raw[i + 1] === '"') {
        cur += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (ch === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function parseAmount(value) {
  const raw = clean(value)
  if (!raw) return 0
  const normalized = raw.replace(/,/g, '')
  const paren = /^\((.+)\)$/.exec(normalized)
  const n = Number(paren ? `-${paren[1]}` : normalized)
  return Number.isFinite(n) ? n : 0
}

/** Noon statements use DD/MM/YYYY. */
function normalizeNoonDate(value) {
  const s = clean(value)
  if (!s) return ''
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s)
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`
  const dmyDot = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s)
  if (dmyDot) return `${dmyDot[3]}-${dmyDot[2]}-${dmyDot[1]}`
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return ''
}

function pick(row, keys) {
  for (const key of keys) {
    const v = row[normalizeHeader(key)]
    if (v != null && clean(v)) return clean(v)
  }
  return ''
}

function parseDelimitedRows(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) return { headers: [], rows: [] }
  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const headers = splitLine(lines[0], delimiter).map(normalizeHeader)
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line, delimiter)
    const row = {}
    headers.forEach((header, idx) => {
      row[header] = cells[idx] != null ? clean(cells[idx]) : ''
    })
    return row
  })
  return { headers, rows }
}

function normalizeNoonStatementRow(row, rowNumber = 0) {
  const orderNr = pick(row, ['order-nr', 'order nr', 'order-number', 'order number', 'order-id', 'order id'])
  const itemNr = pick(row, ['item-nr', 'item nr', 'item-number', 'item number', 'item-id', 'item id'])
  const ids = resolveNoonOrderIds({ orderNr, itemNr })
  const normalized = {
    rowNumber,
    contract: pick(row, ['contract', 'merchant-account', 'merchant account']),
    contractType: pick(row, ['contract-type', 'contract type']),
    referenceNr: pick(row, ['reference-nr', 'reference nr', 'reference-number', 'reference number', 'statement-id', 'statement id']),
    orderNr,
    itemNr,
    parentOrderId: ids.parentOrderId,
    itemOrderId: ids.itemOrderId,
    itemSuffix: ids.itemSuffix,
    orderDate: normalizeNoonDate(pick(row, ['order-date', 'order date'])),
    transactionDate: normalizeNoonDate(pick(row, ['transaction-date', 'transaction date'])),
    title: pick(row, ['title', 'item-title', 'item title', 'product-title', 'product title']),
    sku: pick(row, ['skus', 'sku', 'seller-sku', 'seller sku']),
    partnerSku: pick(row, ['partner-sku', 'partner sku', 'psku']),
    transactionType: pick(row, ['transaction-type', 'transaction type']),
    currency: pick(row, ['currency', 'currency-code', 'currency code']) || 'AED',
    netProceed: parseAmount(pick(row, ['net-proceed', 'net proceed', 'net-proceeds', 'net proceeds'])),
    referralFee: parseAmount(pick(row, ['referral-fee', 'referral fee'])),
    fulfillmentFee: parseAmount(pick(row, ['fulfillment-fee', 'fulfillment fee', 'fulfillment'])),
    shippingCharges: parseAmount(pick(row, ['shipping-charges', 'shipping charges', 'shipping-charge', 'shipping charge'])),
    otherOrderFees: parseAmount(pick(row, ['other-order-fees', 'other order fees', 'other-order', 'other order'])),
    orderSubscriptionFees: parseAmount(
      pick(row, ['order-subscription-fees', 'order subscription fees', 'subs', 'order-subs'])
    ),
    nonOrderFees: parseAmount(pick(row, ['non-order-fees', 'non order fees', 'non-order', 'non order'])),
    nonOrderSubscriptionFees: parseAmount(
      pick(row, ['non-order-subscription-fees', 'non order subscription fees', 'non-order-subs'])
    ),
    othersInclVat: parseAmount(
      pick(row, ['others-incl.-vat', 'others-incl-vat', 'others incl. vat', 'others incl vat', 'others'])
    ),
    total: parseAmount(pick(row, ['total', 'total-amount', 'total amount'])),
    originalRawRow: row,
  }
  // If Total column empty, derive from components.
  if (!pick(row, ['total', 'total-amount', 'total amount'])) {
    normalized.total = round2(
      normalized.netProceed +
        normalized.referralFee +
        normalized.fulfillmentFee +
        normalized.shippingCharges +
        normalized.otherOrderFees +
        normalized.orderSubscriptionFees +
        normalized.nonOrderFees +
        normalized.nonOrderSubscriptionFees +
        normalized.othersInclVat
    )
  }
  normalized.rowClass = classifyNoonStatementRow(normalized)
  normalized.normalizedFeeType = normalizeNoonFeeType(normalized)
  return normalized
}

function extractStatementMetadata(rows) {
  const first = (keys) => {
    for (const row of rows) {
      for (const key of keys) {
        if (row[key] != null && clean(row[key])) return clean(row[key])
      }
    }
    return ''
  }
  const dates = []
  for (const row of rows) {
    for (const d of [row.transactionDate, row.orderDate]) {
      if (d) dates.push(d)
    }
  }
  dates.sort()
  return {
    referenceNr: first(['referenceNr']),
    contract: first(['contract']),
    contractType: first(['contractType']) || 'NOON-AE',
    currency: first(['currency']) || 'AED',
    statementStartDate: dates[0] || '',
    statementEndDate: dates[dates.length - 1] || '',
    marketplace: 'AE',
  }
}

function parseNoonStatementReport(text) {
  const warnings = []
  const { headers, rows } = parseDelimitedRows(text)
  if (headers.length === 0) {
    return { rows: [], warnings: ['Noon statement is empty or has no header row.'], rawRowCount: 0, metadata: {} }
  }
  const important = [
    ['transaction-type', 'transaction type'],
    ['reference-nr', 'reference nr', 'reference-number'],
    ['total', 'net-proceed', 'net proceed'],
  ]
  for (const aliases of important) {
    if (!aliases.some((alias) => headers.includes(normalizeHeader(alias)))) {
      warnings.push(`Noon statement may be missing expected column: ${aliases[0]}`)
    }
  }
  const normalized = rows.map((row, idx) => normalizeNoonStatementRow(row, idx + 1))
  const metadata = extractStatementMetadata(normalized)
  if (!metadata.referenceNr) {
    warnings.push('Noon statement has no Reference Nr — duplicate protection will be limited.')
  }
  const actualSettlement = round2(normalized.reduce((acc, row) => acc + num(row.total), 0))
  metadata.actualSettlementTotal = actualSettlement
  return {
    rows: normalized,
    warnings,
    rawRowCount: rows.length,
    metadata,
    headers,
  }
}

function isSpreadsheetFilename(fileName) {
  return /\.(xlsx|xls|xlsm)$/i.test(clean(fileName))
}

function statementTextFromBuffer(buffer, fileName = '') {
  if (buffer == null) {
    const err = new Error('Noon statement file is empty.')
    err.code = 'NOON_PAYMENT_CLEARING_UPLOAD_EMPTY'
    err.status = 400
    throw err
  }
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  if (!buf.length) {
    const err = new Error('Noon statement file is empty.')
    err.code = 'NOON_PAYMENT_CLEARING_UPLOAD_EMPTY'
    err.status = 400
    throw err
  }
  if (isSpreadsheetFilename(fileName)) {
    const XLSX = require('xlsx')
    const workbook = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) {
      const err = new Error('Noon statement spreadsheet has no sheets.')
      err.code = 'NOON_PAYMENT_CLEARING_UPLOAD_INVALID'
      err.status = 400
      throw err
    }
    return XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { FS: '\t', blankrows: false })
  }
  return buf.toString('utf8')
}

function parseNoonStatementReportBuffer(buffer, fileName = '') {
  return parseNoonStatementReport(statementTextFromBuffer(buffer, fileName))
}

module.exports = {
  parseNoonStatementReport,
  parseNoonStatementReportBuffer,
  statementTextFromBuffer,
  parseDelimitedRows,
  normalizeNoonStatementRow,
  normalizeNoonDate,
  parseAmount,
  normalizeHeader,
  extractStatementMetadata,
}
