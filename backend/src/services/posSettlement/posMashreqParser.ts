'use strict'

/**
 * Mashreq POS settlement file parser. The merchant-portal exports (Enrich CSV, csv1, detailed batch
 * TXT, MSA statement) are recognised from their content and read by their own layouts; MSA
 * statements are kept as control documents only.
 *
 * Any other export falls back to a generic reader: the delimiter is detected, the header row is
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

const PARSER_VERSION = 'mashreq-pos-2'

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
  [/^(PURCHASE|SALE|SALES|PUR|PURCH|PRCH|00|DEBIT|POS PURCHASE|PURCHASE TRANSACTION)$/i, 'SALE'],
  [/^(REFUND|RETURN|CREDIT|RFND|REFD|20|POS REFUND)$/i, 'REFUND'],
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

// ── Mashreq merchant-portal layouts ─────────────────────────────────────────
//
// The portal exports one settlement (REF / trailer reference, e.g. 2461288) in four files:
//   *_Enrich_csv1.csv  HD / DH (column names) / DT / TR / GT records
//   *csv1.csv          HD / DT / TR records per terminal batch, no column-name row (57 columns)
//   *.txt              "DETAILED BATCH REPORT - SETTLEMENT", fixed-width pages with Total lines
//   *MSA.txt           daily payment statement (summary only, no RRNs)
// All report commission and VAT as negative deductions; they are stored as positive charges.
// The 12-digit transaction reference (the RRN on the Zoho invoice) is under "ARN REFNO" in Enrich.

type MashreqLayout = 'ENRICH' | 'CSV1' | 'DETAIL' | 'MSA'
type Cells = { sourceRow: number; cells: string[] }

const LAYOUT_FORMAT: Record<MashreqLayout, string> = {
  ENRICH: SOURCE_FORMAT.ENRICH_CSV,
  CSV1: SOURCE_FORMAT.SIMPLE_CSV,
  DETAIL: SOURCE_FORMAT.DETAIL_TXT,
  MSA: SOURCE_FORMAT.MSA,
}

function detectMashreqLayout(lines: string[]): MashreqLayout | null {
  const head = lines.slice(0, 80).join('\n')
  if (/DETAILED BATCH REPORT/i.test(head)) return 'DETAIL'
  if (/SETTLEMENT SUMMARY BY CARD TYPE|Today net payment/i.test(head)) return 'MSA'
  const first = lines.find((l) => l.trim()) || ''
  if (/^HD,/.test(first)) return lines.some((l) => /^DH,/.test(l)) ? 'ENRICH' : 'CSV1'
  return null
}

/** Enrich DH column names (normalised) for each field; `extras` must be zero to book automatically. */
const ENRICH_COLUMNS = {
  merchantId: 'MERCHID', terminalId: 'POSTNO', batch: 'BATCH', seq: 'SEQ', mmdd: 'DATE', time: 'TIME', tranType: 'TRANTYPE',
  card: 'CARD', auth: 'AUTHCD', issuer: 'CARDISSUER', region: 'REGION', gross: 'AMOUNT', currency: 'CRNCY', commission: 'COMMAMNT',
  vat: 'VATAMT', net: 'STTLAMNT', rrn: 'ARNREFNO', tranxDate: 'TRANXDATE',
} as const
const ENRICH_OPTIONAL = { flatFee: 'FLATFEEONTRANSACTION', vatFlatFee: 'VATFLATFEEONTRANSACTION' } as const
const ENRICH_EXTRAS = ['LOYAMNT', 'LOYAMNT1', 'LOYAMNT2', 'EPPAMNT', 'DCCAMNT']

/** csv1 DT positions (no column-name row). */
const CSV1_WIDTH = 57
const CSV1_COLUMNS = {
  merchantId: 1, terminalId: 2, batch: 3, seq: 4, mmdd: 5, time: 6, tranType: 7, card: 8, auth: 9, issuer: 10, gross: 15, currency: 16,
  commission: 17, vat: 19, net: 33, rrn: 43, region: 48, flatFee: 53, vatFlatFee: 54, tranxDate: 55,
} as const
const CSV1_EXTRAS: Record<string, number> = { 'LOY AMNT': 23, 'LOY AMNT1': 27, 'LOY AMNT2': 31, 'EPP AMNT': 41 }

type MashreqRow = {
  sourceRow: number
  recordType: string | null
  raw: Raw
  merchantId: string
  terminalId: string
  batch: string
  seq: string
  mmdd: string
  time: string
  tranType: string
  card: string
  auth: string
  issuer: string
  region: string
  currency: string
  gross: string
  commission: string
  vat: string
  net: string
  flatFee: string
  vatFlatFee: string
  extras: Record<string, string>
  rrn: string
  tranxDate: string
}

type MashreqContext = { settlementId: string | null; settlementDate: string | null; merchantName: string | null; digits: number; currency: string }

/** "1642" / "18:19" → "16:42:00". */
function hhmm(raw: string): string | null {
  const d = clean(raw).replace(/\D/g, '')
  if (d.length < 3 || d.length > 4) return null
  const p = d.padStart(4, '0')
  const h = Number(p.slice(0, 2))
  const m = Number(p.slice(2))
  return h < 24 && m < 60 ? `${p.slice(0, 2)}:${p.slice(2)}:00` : null
}

/** One Mashreq transaction in the parser's common shape (charges positive, STAN = batch sequence). */
function mashreqTransaction(r: MashreqRow, ctx: MashreqContext) {
  const problems: Issue[] = []
  const warnings: Issue[] = []
  const rrnRead = readRrn(r.rrn, ctx.digits)
  if (rrnRead.problem) problems.push({ code: rrnRead.rrn ? 'RRN_FORMAT' : 'RRN_MISSING', message: rrnRead.problem, field: 'rrn' })

  const dt = parseDate(r.tranxDate, 'MDY')
  if (!dt.date) problems.push({ code: 'DATE_FORMAT', message: `Transaction date "${r.tranxDate}" could not be read.`, field: 'transactionDate' })
  const md = clean(r.mmdd).replace(/\D/g, '')
  if (dt.date && md.length === 4 && md !== dt.date.slice(5, 7) + dt.date.slice(8, 10)) {
    problems.push({ code: 'DATE_MISMATCH', message: `Transaction date ${r.tranxDate} disagrees with the MM/DD column "${r.mmdd}".`, field: 'transactionDate' })
  }

  const money = (label: string, raw: string, required: boolean): number | null => {
    const p = parseMoneyToFils(clean(raw), { blankIsZero: !required })
    if (!p.ok) {
      problems.push({ code: 'AMOUNT_FORMAT', message: `${label}: ${p.reason}.`, field: label })
      return null
    }
    return p.fils
  }
  const deduction = (fils: number | null) => (fils == null || fils === 0 ? (fils == null ? null : 0) : -fils)
  const gross = money('grossAmount', r.gross, true)
  const net = money('netAmount', r.net, true)
  const commission = deduction(money('commission', r.commission, false))
  const flatFee = deduction(money('flatFee', r.flatFee, false))
  const vatMain = deduction(money('vat', r.vat, false))
  const vatFlat = deduction(money('vatFlatFee', r.vatFlatFee, false))
  for (const [name, raw] of Object.entries(r.extras)) {
    const p = parseMoneyToFils(clean(raw), { blankIsZero: true })
    if (!p.ok || p.fils !== 0) warnings.push({ code: 'UNSUPPORTED_COMPONENT', message: `${name} is ${clean(raw)}; loyalty / EPP / DCC amounts are not booked automatically, so this payout will not reconcile until it is handled.` })
  }

  const transactionType = normalizeType(r.tranType)
  if (transactionType === 'UNKNOWN' || !transactionType) problems.push({ code: 'TYPE_UNKNOWN', message: `Transaction type "${clean(r.tranType)}" is not understood.`, field: 'transactionType' })
  const currency = clean(r.currency).toUpperCase() || null
  if (currency && currency !== ctx.currency) problems.push({ code: 'CURRENCY_NOT_AED', message: `Currency is ${currency}, not ${ctx.currency}.`, field: 'currency' })
  const seq = unwrapText(clean(r.seq)).replace(/^0+(?=\d)/, '')

  return {
    sourceRow: r.sourceRow,
    recordType: r.recordType,
    raw: r.raw,
    merchantId: unwrapText(clean(r.merchantId)) || null,
    merchantName: ctx.merchantName,
    terminalId: unwrapText(clean(r.terminalId)) || null,
    rrn: rrnRead.rrn,
    stan: seq || null,
    authCode: unwrapText(clean(r.auth)) || null,
    transactionTypeRaw: clean(r.tranType) || null,
    transactionType,
    transactionDate: dt.date,
    transactionTime: hhmm(r.time),
    currency,
    batchNumber: unwrapText(clean(r.batch)) || null,
    settlementId: ctx.settlementId,
    settlementDate: ctx.settlementDate,
    bankReference: null,
    cardScheme: clean(r.issuer) || null,
    maskedCard: clean(r.card) || null,
    minor: {
      gross,
      commission,
      otherFees: flatFee,
      vat: vatMain == null || vatFlat == null ? null : vatMain + vatFlat,
      net,
    },
    netDerived: false,
    problems,
    warnings,
  }
}

/** HD / DH / DT / TR / GT files (Enrich and csv1). */
function parseMashreqRecords(layout: 'ENRICH' | 'CSV1', rows: Cells[], config: { currency: string; rrnSource: { digits: number } }) {
  const problems: Issue[] = []
  const warnings: Issue[] = []
  const byType = (t: string) => rows.filter((r) => clean(r.cells[0]).toUpperCase() === t)
  const headerRecords = byType('HD')
  const dhRows = byType('DH')
  const dtRows = byType('DT')
  const trRows = byType('TR')
  const gtRows = byType('GT')
  for (const r of rows) {
    const t = clean(r.cells[0]).toUpperCase()
    if (!['HD', 'DH', 'DT', 'TR', 'GT'].includes(t)) problems.push({ code: 'UNKNOWN_RECORD', message: `Row ${r.sourceRow} has record type "${t || '(blank)'}"; the file was not imported so nothing is skipped silently.`, sourceRow: r.sourceRow })
  }

  // Columns: by name from the DH row (Enrich), by position (csv1).
  let headers: string[] = []
  let col: Record<string, number> = {}
  let extraCols: Record<string, number> = {}
  let width = CSV1_WIDTH
  if (layout === 'ENRICH') {
    headers = dhRows[0].cells
    width = headers.length
    const idx = new Map(headers.map((h, i) => [normHeader(h), i]))
    const missing: string[] = []
    for (const [field, name] of Object.entries(ENRICH_COLUMNS)) {
      if (idx.has(name)) col[field] = idx.get(name) as number
      else missing.push(name)
    }
    for (const [field, name] of Object.entries(ENRICH_OPTIONAL)) if (idx.has(name)) col[field] = idx.get(name) as number
    for (const name of ENRICH_EXTRAS) if (idx.has(name)) extraCols[headers[idx.get(name) as number]] = idx.get(name) as number
    if (missing.length) problems.push({ code: 'MISSING_REQUIRED_HEADER', message: `The Enrich column row has no ${missing.join(', ')} column(s); the Mashreq export layout changed.` })
  } else {
    col = { ...CSV1_COLUMNS }
    extraCols = { ...CSV1_EXTRAS }
    headers = Array.from({ length: CSV1_WIDTH }, (_, i) => `col${i + 1}`)
  }

  const dates = [...new Set(headerRecords.map((r) => clean(r.cells[6])))]
  const settlementDate = dates.length === 1 ? parseDate(dates[0], 'DMY').date : null
  if (dates.length !== 1 || !settlementDate) problems.push({ code: 'SETTLEMENT_DATE', message: `The HD record(s) carry ${dates.length ? `dates ${dates.join(', ')}` : 'no date'}; expected one settlement date.` })
  const refs = [...new Set(trRows.map((r) => unwrapText(clean(r.cells[4]))))].filter(Boolean)
  if (refs.length !== 1) problems.push({ code: 'SETTLEMENT_REF', message: `The TR record(s) carry ${refs.length ? `references ${refs.join(', ')}` : 'no settlement reference'}; expected one.` })
  const merchantName = headerRecords.map((r) => clean(r.cells[13])).find(Boolean) || null
  const ctx: MashreqContext = { settlementId: refs.length === 1 ? refs[0] : null, settlementDate, merchantName, digits: config.rrnSource.digits, currency: config.currency }

  const cell = (cells: string[], field: string) => (col[field] == null ? '' : cells[col[field]] ?? '')
  const transactions: any[] = []
  for (const r of dtRows) {
    if (r.cells.length !== width) {
      problems.push({ code: 'LAYOUT_CHANGED', message: `Row ${r.sourceRow} has ${r.cells.length} columns, expected ${width}; the Mashreq export layout changed.`, sourceRow: r.sourceRow })
      continue
    }
    const raw: Raw = Object.fromEntries(headers.map((h, i) => [h || `col${i + 1}`, r.cells[i] ?? '']))
    transactions.push(mashreqTransaction({
      sourceRow: r.sourceRow,
      recordType: 'DT',
      raw,
      merchantId: cell(r.cells, 'merchantId'),
      terminalId: cell(r.cells, 'terminalId'),
      batch: cell(r.cells, 'batch'),
      seq: cell(r.cells, 'seq'),
      mmdd: cell(r.cells, 'mmdd'),
      time: cell(r.cells, 'time'),
      tranType: cell(r.cells, 'tranType'),
      card: cell(r.cells, 'card'),
      auth: cell(r.cells, 'auth'),
      issuer: cell(r.cells, 'issuer'),
      region: cell(r.cells, 'region'),
      currency: cell(r.cells, 'currency'),
      gross: cell(r.cells, 'gross'),
      commission: cell(r.cells, 'commission'),
      vat: cell(r.cells, 'vat'),
      net: cell(r.cells, 'net'),
      flatFee: cell(r.cells, 'flatFee'),
      vatFlatFee: cell(r.cells, 'vatFlatFee'),
      extras: Object.fromEntries(Object.entries(extraCols).map(([name, i]) => [name, r.cells[i] ?? ''])),
      rrn: cell(r.cells, 'rrn'),
      tranxDate: cell(r.cells, 'tranxDate'),
    }, ctx))
  }
  if (!dtRows.length) problems.push({ code: 'NO_TRANSACTIONS', message: 'The file has no DT (transaction) records.' })

  // Trailers: TR counts (and Enrich gross / net), GT gross / net, against the DT rows.
  const sum = (f: 'gross' | 'net') => transactions.reduce((s, t) => s + (t.minor[f] || 0), 0)
  const fils = (v: string) => {
    const p = parseMoneyToFils(clean(v))
    return p.ok ? p.fils : null
  }
  const trCount = trRows.reduce((s, r) => s + (Number(clean(r.cells[5])) || 0), 0)
  if (trRows.length && trCount !== dtRows.length) problems.push({ code: 'TOTALS_NOT_RECONCILED', message: `TR records count ${trCount} transaction(s), the file has ${dtRows.length}.` })
  const totalsRows: Array<{ sourceRow: number; raw: Raw; minor: Record<string, number | null> }> = []
  const checkTotals = (r: Cells, grossAt: number, netAt: number, label: string) => {
    const g = fils(r.cells[grossAt] || '')
    const n = fils(r.cells[netAt] || '')
    if (g == null && n == null) return
    totalsRows.push({ sourceRow: r.sourceRow, raw: { record: label }, minor: { grossAmount: g, netAmount: n } })
    if (g != null && g !== sum('gross')) problems.push({ code: 'TOTALS_NOT_RECONCILED', message: `${label} row ${r.sourceRow}: gross ${formatFils(g)} ≠ sum of transactions ${formatFils(sum('gross'))}.`, sourceRow: r.sourceRow, field: 'grossAmount' })
    if (n != null && n !== sum('net')) problems.push({ code: 'TOTALS_NOT_RECONCILED', message: `${label} row ${r.sourceRow}: net ${formatFils(n)} ≠ sum of transactions ${formatFils(sum('net'))}.`, sourceRow: r.sourceRow, field: 'netAmount' })
  }
  if (layout === 'ENRICH') for (const r of trRows) checkTotals(r, 6, 7, 'TR')
  for (const r of gtRows) checkTotals(r, 3, 4, 'GT')
  if (!trRows.length) warnings.push({ code: 'TRAILER_MISSING', message: 'The file has no TR record to reconcile against.' })

  const fieldMap = Object.fromEntries(Object.entries(col).map(([f, i]) => [f, layout === 'ENRICH' ? headers[i] : `column ${i + 1}`]))
  return {
    delimiter: ',',
    recordMarkers: true,
    headers,
    fieldMap,
    unmappedHeaders: [] as string[],
    transactions,
    headerRecords,
    trailerRecords: [...trRows, ...gtRows].map((r) => ({ ...r, raw: {} as Raw })),
    totalsRows,
    problems,
    warnings,
  }
}

/** "DETAILED BATCH REPORT - SETTLEMENT": fixed-width pages, each closed by a Total line. */
const DETAIL_ROW = new RegExp(
  '^(\\d{12})\\s+(\\S+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d{2}/\\d{2})\\s+(\\d{1,2}:\\d{2})\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)\\s+(.+?)\\s+(\\S+)\\s+(-?[\\d.,]+)' + // merchant … capture mode, rate
    '\\s+(-?[\\d.,]+)\\s+([A-Z]{3})\\s+(-?[\\d.,]+)\\s+([A-Z]{3})\\s+(-?[\\d.,]+)\\s+([A-Z]{3})\\s+(-?[\\d.,]+)\\s+([A-Z]{3})' + // txn, mashreq, commission, VAT
    '\\s+(-?[\\d.,]+)\\s+([A-Z]{3})\\s+(-?[\\d.,]+)\\s+([A-Z]{3})\\s+(-?[\\d.,]+)\\s+(-?[\\d.,]+)\\s+(\\S+)(.*)$', // loyalty, settlement, card holder, subvention, txn reference
)

function parseMashreqDetail(lines: string[], config: { currency: string; rrnSource: { digits: number } }) {
  const problems: Issue[] = []
  const warnings: Issue[] = []
  const refs = new Set<string>()
  const headerRecords: Cells[] = []
  const pending: Array<{ row: MashreqRow; page: number }> = []
  const pageTotals: Array<{ sourceRow: number; page: number; gross: number | null; commission: number | null; vat: number | null; net: number | null }> = []
  let page = 0
  lines.forEach((line, i) => {
    const sourceRow = i + 1
    const ref = /REF:\s*(\d+)/.exec(line)
    if (ref) {
      refs.add(ref[1])
      page++
      headerRecords.push({ sourceRow, cells: [line.trim()] })
    }
    if (/^\d{12}\s/.test(line)) {
      const m = DETAIL_ROW.exec(line.trim())
      if (!m) {
        problems.push({ code: 'ROW_NOT_UNDERSTOOD', message: `Line ${sourceRow} looks like a transaction but does not match the Mashreq detail layout.`, sourceRow })
        return
      }
      const rest = m[28].trim().split(/\s+/)
      const tranxDate = [...rest].reverse().find((t) => /^\d{2}\/\d{2}\/\d{4}$/.test(t)) || ''
      const at = rest.lastIndexOf(tranxDate)
      const raw: Raw = { line: line.trim() }
      pending.push({
        page,
        row: {
          sourceRow, recordType: null, raw,
          merchantId: m[1], terminalId: m[2], batch: m[3], seq: m[4], mmdd: m[5], time: m[6], tranType: m[7], card: m[8], auth: m[9], issuer: m[10],
          region: rest[1] || '', currency: m[14], gross: m[13], commission: m[17], vat: m[19], net: m[23],
          flatFee: at >= 2 ? rest[at - 2] : '', vatFlatFee: at >= 1 ? rest[at - 1] : '',
          extras: { 'LOYALTY AMOUNT': m[21] }, rrn: m[27], tranxDate,
        },
      })
      return
    }
    if (/^Total\s/.test(line)) {
      const amounts = [...line.matchAll(/(-?[\d.,]+)\s+[A-Z]{3}\b/g)].map((x) => {
        const p = parseMoneyToFils(x[1])
        return p.ok ? p.fils : null
      })
      pageTotals.push({ sourceRow, page, gross: amounts[0] ?? null, commission: amounts[1] ?? null, vat: amounts[2] ?? null, net: amounts[4] ?? null })
    }
  })
  if (refs.size !== 1) problems.push({ code: 'SETTLEMENT_REF', message: `The report pages carry ${refs.size ? `references ${[...refs].join(', ')}` : 'no REF'}; expected one settlement reference.` })
  // The report is dated the day after the business date; the CSV exports date the settlement by the
  // business date, which is the latest transaction date. Use the same here so all formats agree.
  const businessDate = pending.map((p) => parseDate(p.row.tranxDate, 'MDY').date).filter(Boolean).sort().pop() || null
  const ctx: MashreqContext = { settlementId: refs.size === 1 ? [...refs][0] : null, settlementDate: businessDate, merchantName: null, digits: config.rrnSource.digits, currency: config.currency }
  const transactions = pending.map((p) => ({ ...mashreqTransaction(p.row, ctx), page: p.page }))
  if (!transactions.length && !problems.length) problems.push({ code: 'NO_TRANSACTIONS', message: 'The report has no transaction lines.' })

  const totalsRows: Array<{ sourceRow: number; raw: Raw; minor: Record<string, number | null> }> = []
  for (const t of pageTotals) {
    const rows = transactions.filter((x) => x.page === t.page)
    const sums = {
      gross: rows.reduce((s, x) => s + (x.minor.gross || 0), 0),
      commission: rows.reduce((s, x) => s + (x.minor.commission || 0), 0),
      vat: rows.reduce((s, x) => s + (x.minor.vat || 0), 0),
      net: rows.reduce((s, x) => s + (x.minor.net || 0), 0),
    }
    totalsRows.push({ sourceRow: t.sourceRow, raw: { record: 'Total' }, minor: { grossAmount: t.gross, commission: t.commission, vat: t.vat, netAmount: t.net } })
    // The report prints commission negative and the VAT total with either sign; compare magnitudes.
    const checks: Array<[string, number | null, number]> = [['gross', t.gross, sums.gross], ['commission', t.commission == null ? null : Math.abs(t.commission), sums.commission], ['VAT', t.vat == null ? null : Math.abs(t.vat), sums.vat], ['net', t.net, sums.net]]
    for (const [label, v, s] of checks) {
      if (v != null && v !== s) problems.push({ code: 'TOTALS_NOT_RECONCILED', message: `Total line ${t.sourceRow}: ${label} ${formatFils(v)} ≠ sum of the page's transactions ${formatFils(s)}.`, sourceRow: t.sourceRow, field: label })
    }
  }
  if (transactions.length && !pageTotals.length) warnings.push({ code: 'TRAILER_MISSING', message: 'The report has no Total lines to reconcile against.' })
  for (const t of transactions) delete (t as { page?: number }).page

  return { delimiter: null, recordMarkers: false, headers: [] as string[], fieldMap: {}, unmappedHeaders: [] as string[], transactions, headerRecords, trailerRecords: [], totalsRows, problems, warnings }
}

/** MSA statement: control only. Its summary totals are not consistent (OTHERS / EPP rows), so nothing is booked from it. */
function readMsaSummary(text: string): { statementDate: string | null; netPayment: string | null; merchantId: string | null } {
  return {
    statementDate: (/Statement Date:\s*(\S+)/i.exec(text) || [])[1] || null,
    netPayment: (/Today net payment:\s*(-?[\d.,]+)/i.exec(text) || [])[1] || null,
    merchantId: (/MERCHANT ID\s*:\s*(\d+)/i.exec(text) || [])[1] || null,
  }
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
  const fileHash = sha256(buffer)
  const problems: Issue[] = []
  const warnings: Issue[] = []

  let text = buffer.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (/\u0000/.test(text.slice(0, 200))) text = buffer.toString('utf16le').replace(/^\ufeff/, '')
  const lines = text.split(/\r\n|\n|\r/)

  // A recognised Mashreq export is read by its own layout whatever format was picked.
  const layout = detectMashreqLayout(lines)
  const sourceFormat = layout ? LAYOUT_FORMAT[layout] : opts.sourceFormat || SOURCE_FORMAT.ENRICH_CSV
  const base = { parserVersion: PARSER_VERSION, fileHash, fileName: opts.fileName || null, sourceFormat, mashreqLayout: layout }

  if (sourceFormat === SOURCE_FORMAT.MSA) {
    // Control document: never booked. Totals in MSA statements were found inconsistent (OTHERS/EPP),
    // so nothing is read from it automatically.
    const msa = layout === 'MSA' ? readMsaSummary(text) : null
    const facts = msa && (msa.statementDate || msa.netPayment) ? ` Statement ${msa.statementDate || '?'}, net payment AED ${msa.netPayment || '?'}.` : ''
    return { ...base, role: 'CONTROL', delimiter: null, recordMarkers: false, headers: [], fieldMap: {}, unmappedHeaders: [], transactions: [], headerRecords: msa ? [{ sourceRow: 0, cells: Object.entries(msa).map(([k, v]) => `${k}=${v ?? ''}`) }] : [], trailerRecords: [], totalsRows: [], problems, warnings: [{ code: 'MSA_CONTROL_ONLY', message: `MSA statements are stored as control documents; they never create accounting.${facts} Upload the Enrich CSV, csv1 or detail TXT of the same day to import its transactions.` }] }
  }

  if (layout === 'ENRICH' || layout === 'CSV1') {
    const rows = lines.map((l, i) => ({ sourceRow: i + 1, cells: l.trim() ? splitLine(l, ',') : [] })).filter((r) => r.cells.length)
    return { ...base, role: 'TRANSACTIONS', ...parseMashreqRecords(layout, rows, config) }
  }
  if (layout === 'DETAIL') return { ...base, role: 'TRANSACTIONS', ...parseMashreqDetail(lines, config) }

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

module.exports = { PARSER_VERSION, FIELD_ALIASES, parseMashreqFile, detectMashreqLayout, parseDate, readRrn, normalizeType, detectDelimiter, splitLine }
