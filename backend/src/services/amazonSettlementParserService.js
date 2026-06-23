const { categorizeSettlementRow, classifySettlementRow } = require('./amazonPaymentClearingCategoryService')

function clean(value) {
  return String(value == null ? '' : value).trim()
}

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

/** Amazon KSA settlement flat files use DD.MM.YYYY (e.g. 07.05.2026 00:00:00 UTC). */
function normalizeSettlementDate(value) {
  const s = clean(value)
  if (!s) return ''
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const amazon = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s)
  if (amazon) return `${amazon[3]}-${amazon[2]}-${amazon[1]}`
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

function extractReportMetadata(rows) {
  const firstWith = (keys, directKeys = []) => {
    for (const row of rows) {
      for (const directKey of directKeys) {
        const direct = row && row[directKey]
        if (direct != null && clean(direct)) return clean(direct)
      }
      const v = pick(row, keys)
      if (v) return v
    }
    return ''
  }
  return {
    settlementId: firstWith(['settlement-id', 'settlement id'], ['settlementId']),
    settlementStartDate: normalizeSettlementDate(firstWith(['settlement-start-date', 'settlement start date'], ['settlementStartDate'])),
    settlementEndDate: normalizeSettlementDate(firstWith(['settlement-end-date', 'settlement end date'], ['settlementEndDate'])),
    depositDate: normalizeSettlementDate(firstWith(['deposit-date', 'deposit date'], ['depositDate'])),
    currency: firstWith(['currency', 'currency-code', 'currency code'], ['currency']) || 'SAR',
  }
}

function normalizeSettlementRow(row) {
  const amount = parseAmount(pick(row, ['amount', 'amount-value', 'amount value']))
  const normalized = {
    settlementId: pick(row, ['settlement-id', 'settlement id']),
    settlementStartDate: normalizeSettlementDate(pick(row, ['settlement-start-date', 'settlement start date'])),
    settlementEndDate: normalizeSettlementDate(pick(row, ['settlement-end-date', 'settlement end date'])),
    depositDate: normalizeSettlementDate(pick(row, ['deposit-date', 'deposit date'])),
    totalAmount: parseAmount(pick(row, ['total-amount', 'total amount'])),
    currency: pick(row, ['currency', 'currency-code', 'currency code']) || 'SAR',
    transactionType: pick(row, ['transaction-type', 'transaction type']),
    orderId: pick(row, ['order-id', 'order id', 'amazon-order-id', 'amazon order id']),
    merchantOrderId: pick(row, ['merchant-order-id', 'merchant order id']),
    postedDate: normalizeSettlementDate(pick(row, ['posted-date', 'posted date'])),
    amountType: pick(row, ['amount-type', 'amount type']),
    amountDescription: pick(row, ['amount-description', 'amount description']),
    amount,
    sku: pick(row, ['sku', 'seller-sku', 'seller sku']),
    quantityPurchased: pick(row, ['quantity-purchased', 'quantity purchased']),
    marketplaceName: pick(row, ['marketplace-name', 'marketplace name']),
    originalRawRow: row,
  }
  normalized.category = categorizeSettlementRow(normalized)
  normalized.rowClass = classifySettlementRow(normalized)
  return normalized
}

function parseAmazonSettlementReport(text) {
  const warnings = []
  const { headers, rows } = parseDelimitedRows(text)
  if (headers.length === 0) {
    return { rows: [], warnings: ['Settlement report is empty or has no header row.'], rawRowCount: 0, metadata: {} }
  }
  const important = [
    ['transaction-type', 'transaction type'],
    ['amount-type', 'amount type'],
    ['amount', 'amount-value', 'amount value'],
    ['order-id', 'order id', 'amazon-order-id'],
  ]
  for (const aliases of important) {
    if (!aliases.some((alias) => headers.includes(normalizeHeader(alias)))) {
      warnings.push(`Settlement report is missing expected column: ${aliases[0]}`)
    }
  }

  const normalized = rows.map(normalizeSettlementRow)
  const missingOrderIdCount = normalized.filter((row) => !row.orderId).length
  if (missingOrderIdCount > 0) {
    warnings.push(`${missingOrderIdCount} settlement row(s) do not include an Amazon order ID.`)
  }
  return {
    rows: normalized,
    warnings,
    rawRowCount: rows.length,
    metadata: extractReportMetadata(normalized),
    headers,
  }
}

module.exports = {
  parseAmazonSettlementReport,
  parseDelimitedRows,
  normalizeSettlementRow,
  normalizeSettlementDate,
  parseAmount,
  normalizeHeader,
}
