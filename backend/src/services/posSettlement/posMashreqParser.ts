'use strict'

/**
 * Mashreq POS settlement file parser (Enrich CSV is canonical; the simpler CSV and the detailed
 * TXT use the same reader; MSA statements are kept as control documents only).
 *
 * The layout is read from the file, never assumed: the delimiter is detected, the header row is
 * found by its column names, and every column is mapped through an alias table (extendable with
 * POS_MASHREQ_HEADER_ALIASES). Files with a record-type column ("H" / "DT" / "T") are split into
 * header, transaction ("DT") and trailer records. Amounts are integer fils from the source text;
 * the RRN is kept exactly as written (text, leading zeros intact) and never padded or converted.
 *
 * Nothing is invented: a value the file does not carry stays null, a derived value is flagged.
 */

const crypto = require('crypto')
const { parseMoneyToFils, formatFils } = require('./posMoney.ts')
const { SOURCE_FORMAT } = require('../../config/posSettlement.ts')

const PARSER_VERSION = 'mashreq-pos-1'

type Issue = { code: string; message: string; sourceRow?: number; field?: string }
type Raw = Record<string, string>

const FIELD_ALIASES: Record<string, string[]> = {
  recordType: ['RECORDTYPE', 'RECTYPE', 'RECORDTYP', 'RT', 'RECORDIND', 'RECORDINDICATOR'],
  merchantId: ['MID', 'MERCHANTID', 'MERCHANTNO', 'MERCHANTNUMBER', 'MERCHANTCODE', 'MERCHID', 'MERCHANT'],
  merchantName: ['MERCHANTNAME', 'OUTLETNAME', 'DBANAME', 'MERCHANTDBANAME', 'STORENAME'],
  terminalId: ['TID', 'TERMINALID', 'TERMINALNO', 'TERMINALNUMBER', 'TERMID', 'TERMINAL'],
  rrn: ['RRN', 'RRNNO', 'RRNNUMBER', 'RETRIEVALREFERENCENUMBER', 'RETRIEVALREFNO', 'RETRIEVALREFERENCENO', 'RETREFNO'],
  stan: ['STAN', 'SYSTEMTRACEAUDITNUMBER', 'TRACENO', 'TRACENUMBER', 'SEQUENCENO', 'SEQNO', 'SEQUENCENUMBER'],
  authCode: ['AUTHCODE', 'AUTHORIZATIONCODE', 'AUTHORISATIONCODE', 'APPROVALCODE', 'AUTHNO', 'APPRCODE', 'AUTHID'],
  transactionType: ['TRANTYPE', 'TXNTYPE', 'TRANSACTIONTYPE', 'TRANSTYPE', 'TYPE'],
  transactionDateTime: ['TRANSACTIONDATETIME', 'TXNDATETIME', 'TRANDATETIME', 'TRANSDATETIME'],
  transactionDate: ['TRANDATE', 'TXNDATE', 'TRANSACTIONDATE', 'TRANSDATE', 'DATE'],
  transactionTime: ['TRANTIME', 'TXNTIME', 'TRANSACTIONTIME', 'TRANSTIME', 'TIME'],
  currency: ['CURRENCY', 'CCY', 'CURRENCYCODE', 'TRANCURRENCY', 'TXNCURRENCY'],
  grossAmount: ['TRANAMOUNT', 'TXNAMOUNT', 'TRANSACTIONAMOUNT', 'GROSSAMOUNT', 'AMOUNT', 'SALEAMOUNT', 'TRANSAMOUNT', 'GROSS'],
  commission: ['COMMISSION', 'COMMISSIONAMOUNT', 'COMMISSIONAMT', 'MDR', 'MDRAMOUNT', 'MSC', 'MSCAMOUNT'],
  otherFees: ['OTHERFEES', 'OTHERFEE', 'SERVICEFEE', 'FEES', 'FEE', 'FEEAMOUNT'],
  vat: ['VAT', 'VATAMOUNT', 'VATAMT', 'VATONCOMMISSION', 'VATONFEE', 'VATONMDR', 'TAXAMOUNT'],
  netAmount: ['NETAMOUNT', 'NET', 'NETSETTLEMENT', 'NETSETTLEMENTAMOUNT', 'SETTLEMENTAMOUNT', 'NETPAYABLE', 'PAYABLEAMOUNT', 'NETAMT'],
  batchNumber: ['BATCH', 'BATCHNO', 'BATCHNUMBER', 'BATCHID'],
  settlementId: ['SETTLEMENTID', 'SETTLEMENTNO', 'SETTLEMENTREF', 'SETTLEMENTREFERENCE', 'SETTLEMENTNUMBER'],
  settlementDate: ['SETTLEMENTDATE', 'SETTLDATE', 'SETTLEDATE', 'PAYMENTDATE', 'VALUEDATE', 'PAYOUTDATE', 'CREDITDATE'],
  bankReference: ['BANKREFERENCE', 'BANKREF', 'PAYMENTREFERENCE', 'PAYMENTREF', 'UTR', 'TRANSFERREFERENCE'],
  cardScheme: ['CARDTYPE', 'CARDSCHEME', 'SCHEME', 'CARDBRAND'],
  maskedCard: ['CARDNO', 'CARDNUMBER', 'MASKEDCARD', 'MASKEDCARDNO', 'PAN', 'MASKEDPAN'],
}

const MONEY_FIELDS = ['grossAmount', 'commission', 'otherFees', 'vat', 'netAmount']
const TRANSACTION_MARKERS = new Set(['DT', 'D', 'DTL', 'DETAIL'])
const HEADER_MARKERS = new Set(['H', 'HD', 'HDR', 'HEADER', 'FH', 'BH'])
const TRAILER_MARKERS = new Set(['T', 'TR', 'TRL', 'TRAILER', 'FT', 'BT', 'TT', 'TOTAL'])

const TYPE_MAP: Array<[RegExp, string]> = [
  [/^(PURCHASE|SALE|SALES|PUR|PURCH|00|DEBIT|POS PURCHASE|PURCHASE TRANSACTION)$/i, 'SALE'],
  [/^(REFUND|RETURN|CREDIT|RFND|20|POS REFUND)$/i, 'REFUND'],
  [/^(VOID|REVERSAL|REV|CANCEL|CANCELLED)$/i, 'REVERSAL'],
  [/^(CHARGEBACK|CB|DISPUTE)$/i, 'CHARGEBACK'],
]

function normHeader(h: string): string {
  return String(h || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function clean(v: unknown): string {
  return v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim()
}

/** Excel text guards: ="003046469826" and '003046469826 keep their digits. */
function unwrapText(v: string): string {
  return v.replace(/^="(.*)"$/, '$1').replace(/^'/, '').trim()
}

function aliasTable(extra: Record<string, unknown> | null): Map<string, string> {
  const table = new Map<string, string>()
  const add = (field: string, aliases: unknown) => {
    for (const a of Array.isArray(aliases) ? aliases : []) table.set(normHeader(String(a)), field)
  }
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) add(field, aliases)
  if (extra) for (const [field, aliases] of Object.entries(extra)) if (FIELD_ALIASES[field]) add(field, aliases)
  return table
}

// ── Text / CSV ──────────────────────────────────────────────────────────────

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"' && cur.trim() === '') {
      quoted = true
      cur = ''
    } else if (ch === delimiter) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((c) => clean(c))
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.filter((l) => l.trim()).slice(0, 30)
  let best = ','
  let bestScore = -1
  for (const d of [',', '|', '\t', ';']) {
    const counts = sample.map((l) => splitLine(l, d).length - 1).filter((n) => n > 0)
    if (!counts.length) continue
    const freq = new Map<number, number>()
    for (const n of counts) freq.set(n, (freq.get(n) || 0) + 1)
    const [mode, hits] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
    const score = hits * 100 + mode
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

// ── Values ──────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 }

function ymd(y: number, m: number, d: number): string | null {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** "2026-09-05", "05/09/2026", "05-09-26", "05.09.2026", "20260905", "05-Sep-2026", with an optional time. */
function parseDate(raw: string, order: 'DMY' | 'MDY'): { date: string | null; time: string | null } {
  const s = clean(raw)
  if (!s) return { date: null, time: null }
  const timeMatch = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(s)
  let time: string | null = null
  if (timeMatch) {
    let h = Number(timeMatch[1])
    if (timeMatch[4]) h = (h % 12) + (/PM/i.test(timeMatch[4]) ? 12 : 0)
    time = `${String(h).padStart(2, '0')}:${timeMatch[2]}:${timeMatch[3] || '00'}`
  }
  const d = s.replace(/[T\s].*$/, '')
  let m: RegExpExecArray | null
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(d))) return { date: ymd(+m[1], +m[2], +m[3]), time }
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(d))) return { date: ymd(+m[1], +m[2], +m[3]), time }
  if ((m = /^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ](\d{2,4})$/.exec(d))) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return { date: ymd(y, MONTHS[m[2].toUpperCase()] || 0, +m[1]), time }
  }
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(d))) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const [day, month] = order === 'MDY' ? [+m[2], +m[1]] : [+m[1], +m[2]]
    return { date: ymd(y, month, day), time }
  }
  return { date: null, time }
}

function normalizeType(raw: string): string | null {
  const s = clean(raw)
  if (!s) return null
  for (const [rx, t] of TYPE_MAP) if (rx.test(s)) return t
  return 'UNKNOWN'
}

/** RRN as written; problems when it is not exactly `digits` digits (never padded or trimmed of zeros). */
function readRrn(raw: string, digits: number): { rrn: string | null; problem: string | null } {
  const s = unwrapText(clean(raw))
  if (!s) return { rrn: null, problem: 'RRN is blank.' }
  if (/e\+?\d+$/i.test(s)) return { rrn: s, problem: `RRN "${s}" is in scientific notation; the export lost digits (open the CSV as text, not in Excel).` }
  if (!/^\d+$/.test(s)) return { rrn: s, problem: `RRN "${s}" is not numeric.` }
  if (s.length !== digits) {
    return { rrn: s, problem: `RRN "${s}" has ${s.length} digits, not ${digits}${s.length < digits ? '; leading zeros may have been dropped by the export' : ''}. It is not padded.` }
  }
  return { rrn: s, problem: null }
}

// ── Main ────────────────────────────────────────────────────────────────────

function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/**
 * @param buffer the uploaded file
 * @param opts.sourceFormat ENRICH_CSV | SIMPLE_CSV | DETAIL_TXT | MSA
 */
function parseMashreqFile(buffer: Buffer, opts: { fileName?: string; sourceFormat?: string; config: { dateOrder: 'DMY' | 'MDY'; headerAliases: Record<string, unknown> | null; currency: string; rrnSource: { digits: number } } }) {
  const config = opts.config
  const sourceFormat = opts.sourceFormat || SOURCE_FORMAT.ENRICH_CSV
  const fileHash = sha256(buffer)
  const problems: Issue[] = []
  const warnings: Issue[] = []
  const base = { parserVersion: PARSER_VERSION, fileHash, fileName: opts.fileName || null, sourceFormat }

  if (sourceFormat === SOURCE_FORMAT.MSA) {
    // Control document: never booked. Totals in MSA statements were found inconsistent (OTHERS/EPP),
    // so nothing is read from it automatically.
    return { ...base, role: 'CONTROL', delimiter: null, recordMarkers: false, headers: [], fieldMap: {}, unmappedHeaders: [], transactions: [], headerRecords: [], trailerRecords: [], totalsRows: [], problems, warnings: [{ code: 'MSA_CONTROL_ONLY', message: 'MSA statements are stored as control documents; they never create accounting.' }] }
  }

  let text = buffer.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (/\u0000/.test(text.slice(0, 200))) text = buffer.toString('utf16le').replace(/^\ufeff/, '')
  const lines = text.split(/\r\n|\n|\r/)
  if (!lines.some((l) => l.trim())) {
    problems.push({ code: 'FILE_EMPTY', message: 'The file is empty.' })
    return { ...base, role: 'TRANSACTIONS', delimiter: null, recordMarkers: false, headers: [], fieldMap: {}, unmappedHeaders: [], transactions: [], headerRecords: [], trailerRecords: [], totalsRows: [], problems, warnings }
  }
  const delimiter = detectDelimiter(lines)
  const rows = lines.map((l, i) => ({ sourceRow: i + 1, cells: l.trim() ? splitLine(l, delimiter) : [] })).filter((r) => r.cells.length)
  const aliases = aliasTable(config.headerAliases)

  // Header row: the first row naming an RRN column and at least two other known columns.
  let headerIndex = -1
  let fieldMap: Record<string, number> = {}
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const map: Record<string, number> = {}
    let known = 0
    rows[i].cells.forEach((c, idx) => {
      const f = aliases.get(normHeader(c))
      if (f && map[f] == null) {
        map[f] = idx
        known++
      }
    })
    if (map.rrn != null && known >= 3) {
      headerIndex = i
      fieldMap = map
      break
    }
  }
  if (headerIndex < 0) {
    problems.push({ code: 'HEADERS_NOT_FOUND', message: 'No row names an RRN column plus amount/date columns. Add the file\'s column names to POS_MASHREQ_HEADER_ALIASES or check the export type.' })
    return { ...base, role: 'TRANSACTIONS', delimiter, recordMarkers: false, headers: rows[0] ? rows[0].cells : [], fieldMap: {}, unmappedHeaders: [], transactions: [], headerRecords: [], trailerRecords: [], totalsRows: [], problems, warnings }
  }
  const headerRow = rows[headerIndex]
  const headers = headerRow.cells
  const duplicates = new Map<string, string[]>()
  headers.forEach((h) => {
    const f = aliases.get(normHeader(h))
    if (f) duplicates.set(f, [...(duplicates.get(f) || []), h])
  })
  for (const [f, hs] of duplicates) if (hs.length > 1) problems.push({ code: 'HEADER_AMBIGUOUS', message: `Columns ${hs.map((h) => `"${h}"`).join(', ')} all map to ${f}; map them explicitly in POS_MASHREQ_HEADER_ALIASES.`, field: f })
  const unmappedHeaders = headers.filter((h) => h && !aliases.get(normHeader(h)))
  const missing = ['rrn', 'grossAmount'].filter((f) => fieldMap[f] == null)
  if (fieldMap.transactionDate == null && fieldMap.transactionDateTime == null) missing.push('transactionDate')
  if (fieldMap.netAmount == null && fieldMap.commission == null) missing.push('netAmount or commission')
  for (const f of missing) problems.push({ code: 'MISSING_REQUIRED_HEADER', message: `Required column ${f} was not found (headers: ${headers.join(', ')}).`, field: f })

  const markerCol = fieldMap.recordType != null ? fieldMap.recordType : 0
  const markerOf = (r: { cells: string[] }) => clean(r.cells[markerCol]).toUpperCase()
  const recordMarkers = rows.some((r, i) => i !== headerIndex && TRANSACTION_MARKERS.has(markerOf(r)) && markerOf(r) === 'DT')

  const headerRecords: Array<{ sourceRow: number; cells: string[] }> = []
  const trailerRecords: Array<{ sourceRow: number; cells: string[]; raw: Raw }> = []
  const totalsRows: Array<{ sourceRow: number; raw: Raw; minor: Record<string, number | null> }> = []
  const transactions: any[] = []
  const toRaw = (cells: string[]): Raw => Object.fromEntries(headers.map((h, idx) => [h || `col${idx + 1}`, cells[idx] == null ? '' : cells[idx]]))
  const moneyOf = (cells: string[], field: string) => (fieldMap[field] == null ? null : parseMoneyToFils(cells[fieldMap[field]], { blankIsZero: field !== 'grossAmount' && field !== 'netAmount' }))
  const minorTotals = (cells: string[]) => Object.fromEntries(MONEY_FIELDS.map((f) => {
    const p = moneyOf(cells, f)
    return [f, p && p.ok ? p.fils : null]
  }))

  for (let i = 0; i < rows.length; i++) {
    if (i === headerIndex) continue
    const r = rows[i]
    const marker = markerOf(r)
    if (i < headerIndex) {
      headerRecords.push(r)
      continue
    }
    if (recordMarkers) {
      if (HEADER_MARKERS.has(marker)) {
        headerRecords.push(r)
        continue
      }
      if (TRAILER_MARKERS.has(marker)) {
        trailerRecords.push({ ...r, raw: toRaw(r.cells) })
        if (r.cells.length === headers.length) totalsRows.push({ sourceRow: r.sourceRow, raw: toRaw(r.cells), minor: minorTotals(r.cells) })
        continue
      }
      if (!TRANSACTION_MARKERS.has(marker)) {
        warnings.push({ code: 'UNKNOWN_RECORD', message: `Row ${r.sourceRow} has record type "${marker || '(blank)'}"; it was not read as a transaction.`, sourceRow: r.sourceRow })
        continue
      }
    } else {
      const first = r.cells.find((c) => c) || ''
      if (/^(grand\s*)?total|^sub\s*total|^summary/i.test(first) || (fieldMap.rrn != null && !clean(r.cells[fieldMap.rrn]) && /total/i.test(r.cells.join(' ')))) {
        totalsRows.push({ sourceRow: r.sourceRow, raw: toRaw(r.cells), minor: minorTotals(r.cells) })
        continue
      }
      if (r.cells.every((c) => !c)) continue
    }

    const raw = toRaw(r.cells)
    const cell = (f: string) => (fieldMap[f] == null ? '' : clean(r.cells[fieldMap[f]]))
    const rowProblems: Issue[] = []
    const rowWarnings: Issue[] = []
    const rrnRead = readRrn(cell('rrn'), config.rrnSource.digits)
    if (rrnRead.problem) rowProblems.push({ code: rrnRead.rrn ? 'RRN_FORMAT' : 'RRN_MISSING', message: rrnRead.problem, field: 'rrn' })
    const dt = parseDate(cell('transactionDateTime') || cell('transactionDate'), config.dateOrder)
    const time = cell('transactionTime') || dt.time || null
    if (!dt.date) rowProblems.push({ code: 'DATE_FORMAT', message: `Transaction date "${cell('transactionDateTime') || cell('transactionDate')}" could not be read.`, field: 'transactionDate' })
    const settlement = fieldMap.settlementDate != null ? parseDate(cell('settlementDate'), config.dateOrder) : { date: null, time: null }
    if (cell('settlementDate') && !settlement.date) rowProblems.push({ code: 'DATE_FORMAT', message: `Settlement date "${cell('settlementDate')}" could not be read.`, field: 'settlementDate' })

    const minor: Record<string, number> = {}
    for (const f of MONEY_FIELDS) {
      if (fieldMap[f] == null) continue
      const p = moneyOf(r.cells, f)
      if (!p || !p.ok) rowProblems.push({ code: 'AMOUNT_FORMAT', message: `${f}: ${p ? p.reason : 'missing'}.`, field: f })
      else minor[f] = p.fils
    }
    let netDerived = false
    if (fieldMap.netAmount == null && minor.grossAmount != null) {
      minor.netAmount = minor.grossAmount - (minor.commission || 0) - (minor.otherFees || 0) - (minor.vat || 0)
      netDerived = true
      rowWarnings.push({ code: 'NET_DERIVED', message: 'The file has no net column; net = gross − commission − fees − VAT.' })
    }
    const typeRaw = cell('transactionType')
    let transactionType = normalizeType(typeRaw)
    if (!transactionType && minor.grossAmount != null) {
      transactionType = minor.grossAmount < 0 ? 'REFUND' : 'SALE'
      rowWarnings.push({ code: 'TYPE_INFERRED', message: `The file has no transaction type; read as ${transactionType} from the amount sign.` })
    }
    if (transactionType === 'UNKNOWN') rowProblems.push({ code: 'TYPE_UNKNOWN', message: `Transaction type "${typeRaw}" is not understood.`, field: 'transactionType' })
    const currency = cell('currency').toUpperCase() || null
    if (currency && currency !== config.currency && currency !== '784') rowProblems.push({ code: 'CURRENCY_NOT_AED', message: `Currency is ${currency}, not ${config.currency}.`, field: 'currency' })

    transactions.push({
      sourceRow: r.sourceRow,
      recordType: recordMarkers ? marker : null,
      raw,
      merchantId: unwrapText(cell('merchantId')) || null,
      merchantName: cell('merchantName') || null,
      terminalId: unwrapText(cell('terminalId')) || null,
      rrn: rrnRead.rrn,
      stan: unwrapText(cell('stan')) || null,
      authCode: unwrapText(cell('authCode')) || null,
      transactionTypeRaw: typeRaw || null,
      transactionType,
      transactionDate: dt.date,
      transactionTime: time,
      currency: currency === '784' ? 'AED' : currency,
      batchNumber: unwrapText(cell('batchNumber')) || null,
      settlementId: unwrapText(cell('settlementId')) || null,
      settlementDate: settlement.date,
      bankReference: unwrapText(cell('bankReference')) || null,
      cardScheme: cell('cardScheme') || null,
      maskedCard: cell('maskedCard') || null,
      minor: {
        gross: minor.grossAmount ?? null,
        commission: minor.commission ?? (fieldMap.commission == null ? null : 0),
        otherFees: minor.otherFees ?? (fieldMap.otherFees == null ? null : 0),
        vat: minor.vat ?? (fieldMap.vat == null ? null : 0),
        net: minor.netAmount ?? null,
      },
      netDerived,
      problems: rowProblems,
      warnings: rowWarnings,
    })
  }
  if (!transactions.length && !problems.length) problems.push({ code: 'NO_TRANSACTIONS', message: 'The file has no transaction rows.' })

  // File totals (totals row / trailer) must equal the sum of the rows.
  const sums: Record<string, number> = {}
  const keyOf: Record<string, string> = { grossAmount: 'gross', commission: 'commission', otherFees: 'otherFees', vat: 'vat', netAmount: 'net' }
  for (const f of MONEY_FIELDS) sums[f] = transactions.reduce((s, t) => s + (t.minor[keyOf[f]] || 0), 0)
  for (const t of totalsRows) {
    for (const f of MONEY_FIELDS) {
      const v = t.minor[f]
      if (v == null || fieldMap[f] == null) continue
      if (v !== sums[f]) problems.push({ code: 'TOTALS_NOT_RECONCILED', message: `Totals row ${t.sourceRow}: ${f} ${formatFils(v)} ≠ sum of transactions ${formatFils(sums[f])}.`, sourceRow: t.sourceRow, field: f })
    }
  }
  if (recordMarkers && !trailerRecords.length) warnings.push({ code: 'TRAILER_MISSING', message: 'The file uses record types but has no trailer record to reconcile against.' })

  const fieldNames = Object.fromEntries(Object.entries(fieldMap).map(([f, idx]) => [f, headers[idx]]))
  return { ...base, role: 'TRANSACTIONS', delimiter, recordMarkers, headers, fieldMap: fieldNames, unmappedHeaders, transactions, headerRecords, trailerRecords, totalsRows, problems, warnings }
}

module.exports = { PARSER_VERSION, FIELD_ALIASES, parseMashreqFile, parseDate, readRrn, normalizeType, detectDelimiter, splitLine }
