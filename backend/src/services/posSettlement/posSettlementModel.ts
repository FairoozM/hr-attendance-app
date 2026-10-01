'use strict'

/**
 * Pure Mashreq POS settlement rules. No I/O; amounts are integer fils until a Zoho payload is built.
 *
 * Three separate things are modelled:
 *   POS transaction   one row Mashreq reports (RRN, terminal, gross, commission, VAT, net)
 *   payout            the Mashreq settlement those rows were paid in (may mix website, web-app and
 *                     BurJuman shop terminals, several batches and merchants)
 *   RAK deposit       the money that actually arrived; the payout net must equal it
 *
 * Channel is an analytical dimension of each transaction; it never splits a payout.
 *
 * Accounting per payout (all amounts from the statement; nothing is forced to balance):
 *   RECEIPT_NET      one customer payment per Zoho customer  Dr POS Undeposited  / Cr AR (net per invoice)
 *   RECEIPT_FEE      one customer payment per Zoho customer  Dr POS Processing   / Cr AR (commission + fees + VAT)
 *   RECEIPT_RECLASS  journal for receipts already in Zoho whose Undeposited part ≠ statement net
 *   FEE_RECOGNITION  journal  Dr POS Machine Transaction Fee / Dr Input VAT / Cr POS Processing
 *   BANK_CLEARING    transfer POS Undeposited → RAK Bank (only when the RAK deposit is evidenced
 *                    and no transfer exists yet)
 * Sales invoices, revenue and output VAT are never created: invoices already exist in Zoho.
 */

const crypto = require('crypto')
const { buildCustomerPaymentPayload, buildManualJournalPayload } = require('../amazonPaymentClearingZohoPaymentService')
const { POS_ACCOUNT_ROLE: ROLE, POS_CHANNEL: CHANNEL } = require('../../config/posSettlement.ts')
const { filsToMajor, formatFils, majorToFils, allocateProportionally } = require('./posMoney.ts')

type Issue = { code: string; message: string; [k: string]: unknown }
type Minor = { gross: number | null; commission: number | null; otherFees: number | null; vat: number | null; net: number | null }
type Txn = {
  id?: string
  sourceRow?: number
  merchantId: string | null
  terminalId: string | null
  rrn: string | null
  stan: string | null
  authCode: string | null
  transactionType: string | null
  transactionDate: string | null
  transactionTime?: string | null
  settlementId?: string | null
  settlementDate?: string | null
  bankReference?: string | null
  batchNumber?: string | null
  currency?: string | null
  minor: Minor
  [k: string]: unknown
}
type Line = { role: string; side: 'debit' | 'credit'; amountMinor: number; accountId?: string | null }
type Allocation = { invoiceId: string; invoiceNumber: string; amountMinor: number; amount?: number }

const COMPONENT = Object.freeze({
  RECEIPT_NET: 'RECEIPT_NET',
  RECEIPT_FEE: 'RECEIPT_FEE',
  RECEIPT_RECLASS: 'RECEIPT_RECLASS',
  FEE_RECOGNITION: 'FEE_RECOGNITION',
  BANK_CLEARING: 'BANK_CLEARING',
})

const PHASE: Record<string, number> = Object.freeze({
  RECEIPT_NET: 10,
  RECEIPT_FEE: 11,
  RECEIPT_RECLASS: 20,
  FEE_RECOGNITION: 30,
  BANK_CLEARING: 50,
})

const TXN_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', DUPLICATE: 'DUPLICATE', CONFLICT: 'CONFLICT', DISMISSED: 'DISMISSED' })

const MATCH_STATUS = Object.freeze({
  MATCHED: 'MATCHED',
  MANUAL: 'MANUAL',
  RRN_NOT_FOUND: 'RRN_NOT_FOUND',
  RRN_AMBIGUOUS: 'RRN_AMBIGUOUS',
  RRN_INVALID: 'RRN_INVALID',
  INVOICE_NOT_PAYABLE: 'INVOICE_NOT_PAYABLE',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  CUSTOMER_MISMATCH: 'CUSTOMER_MISMATCH',
  CHANNEL_MISMATCH: 'CHANNEL_MISMATCH',
  AMOUNT_EXCEEDS_INVOICE: 'AMOUNT_EXCEEDS_INVOICE',
  LOOKUP_FAILED: 'LOOKUP_FAILED',
  NOT_CHECKED: 'NOT_CHECKED',
})

const INVOICE_MODE = Object.freeze({
  NEW: 'NEW',
  EXISTING_RECEIPTS: 'EXISTING_RECEIPTS',
  BLOCKED: 'BLOCKED',
})

const BANK_STATUS = Object.freeze({
  BANK_MATCHED: 'BANK_MATCHED',
  BANK_DEPOSIT_SEEN: 'BANK_DEPOSIT_SEEN',
  BANK_DEPOSIT_NOT_FOUND: 'BANK_DEPOSIT_NOT_FOUND',
  BANK_MATCH_AMBIGUOUS: 'BANK_MATCH_AMBIGUOUS',
  BANK_LOOKUP_FAILED: 'BANK_LOOKUP_FAILED',
  BANK_NOT_REQUIRED: 'BANK_NOT_REQUIRED',
})

const FEE_STATUS = Object.freeze({
  NONE_FOUND: 'NONE_FOUND',
  ALREADY_RECOGNIZED: 'ALREADY_RECOGNIZED',
  UNCERTAIN: 'UNCERTAIN',
  LOOKUP_FAILED: 'LOOKUP_FAILED',
})

function clean(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

function issue(code: string, message: string, extra: Record<string, unknown> = {}): Issue {
  return { code, message, ...extra }
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ── Transaction identity & duplicates ───────────────────────────────────────

const typeClass = (t: string | null) => (t === 'REFUND' || t === 'REVERSAL' || t === 'CHARGEBACK' ? t : 'SALE')

/** Strongest identity the row carries. RRN alone is never assumed globally unique. */
function transactionIdentity(t: Txn, { organizationId, provider }: { organizationId: string; provider: string }): string {
  return sha256([organizationId, provider, clean(t.merchantId), clean(t.terminalId), clean(t.rrn), typeClass(t.transactionType), clean(t.stan), clean(t.authCode)].join('|'))
}

function economicHash(t: Txn): string {
  const m = t.minor
  return sha256([typeClass(t.transactionType), clean(t.transactionDate), m.gross, m.commission, m.otherFees, m.vat, m.net, clean(t.currency) || 'AED'].join('|'))
}

const IDENTITY_FIELDS = ['merchantId', 'terminalId', 'stan', 'authCode'] as const
const ECONOMIC_FIELDS: Array<[string, (t: Txn) => unknown]> = [
  ['transactionDate', (t) => t.transactionDate],
  ['transactionType', (t) => typeClass(t.transactionType)],
  ['gross', (t) => t.minor.gross],
  ['commission', (t) => t.minor.commission],
  ['otherFees', (t) => t.minor.otherFees],
  ['vat', (t) => t.minor.vat],
  ['net', (t) => t.minor.net],
]

/** Same transaction as `b` (fields one side does not carry never contradict). */
function sameTransaction(a: Txn, b: Txn): boolean {
  if (!a.rrn || a.rrn !== b.rrn) return false
  if (typeClass(a.transactionType) !== typeClass(b.transactionType)) return false
  for (const f of IDENTITY_FIELDS) if (a[f] && b[f] && a[f] !== b[f]) return false
  // An RRN can come back after the acquirer's cycle; a year apart is another transaction.
  if (a.transactionDate && b.transactionDate && dayDiff(a.transactionDate, b.transactionDate) > 180) return false
  return true
}

/** Economic fields that differ (only fields both rows carry are compared). */
function economicDifferences(a: Txn, b: Txn): string[] {
  const out: string[] = []
  for (const [name, get] of ECONOMIC_FIELDS) {
    const x = get(a)
    const y = get(b)
    if (x == null || y == null) continue
    if (x !== y) out.push(name)
  }
  return out
}

/**
 * Classify an incoming row against rows already imported with the same RRN.
 * @returns NEW, DUPLICATE (identical economics; not imported again) or CONFLICT (same transaction,
 *   different amounts/date/type: never a second transaction).
 */
function classifyIncoming(incoming: Txn, existing: Txn[]): { status: string; match: Txn | null; differences: string[]; rrnReused: boolean } {
  const same = existing.filter((e) => sameTransaction(incoming, e))
  const rrnReused = existing.length > 0 && same.length === 0
  if (!same.length) return { status: 'NEW', match: null, differences: [], rrnReused }
  const identical = same.find((e) => economicDifferences(incoming, e).length === 0)
  if (identical) return { status: TXN_STATUS.DUPLICATE, match: identical, differences: [], rrnReused: false }
  return { status: TXN_STATUS.CONFLICT, match: same[0], differences: economicDifferences(incoming, same[0]), rrnReused: false }
}

/** Rows of one file that describe the same transaction twice (the file is refused). */
function inFileDuplicates(rows: Txn[]): Issue[] {
  const out: Issue[] = []
  rows.forEach((r, i) => {
    for (let j = 0; j < i; j++) {
      if (sameTransaction(r, rows[j])) {
        out.push(issue('DUPLICATE_ROW_IN_FILE', `Rows ${rows[j].sourceRow} and ${r.sourceRow} are the same transaction (RRN ${r.rrn}).`, { sourceRow: r.sourceRow }))
        break
      }
    }
  })
  return out
}

// ── Payout grouping ─────────────────────────────────────────────────────────

const PAYOUT_BASIS = Object.freeze({
  SETTLEMENT_ID: 'SETTLEMENT_ID',
  BANK_REFERENCE: 'BANK_REFERENCE',
  SETTLEMENT_DATE: 'SETTLEMENT_DATE',
  TRANSACTION_DATE: 'TRANSACTION_DATE',
})

/**
 * Which Mashreq payout a row belongs to, from the strongest evidence the row carries. Rows from
 * every channel, terminal and batch with the same key are one payout. Date-based keys are an
 * inference that the RAK deposit match then has to confirm.
 */
function payoutKeyOf(t: Txn): { key: string; basis: string; date: string | null } {
  if (clean(t.settlementId)) return { key: `SID:${clean(t.settlementId)}`, basis: PAYOUT_BASIS.SETTLEMENT_ID, date: t.settlementDate || t.transactionDate }
  if (clean(t.bankReference)) return { key: `REF:${clean(t.bankReference)}`, basis: PAYOUT_BASIS.BANK_REFERENCE, date: t.settlementDate || t.transactionDate }
  if (t.settlementDate) return { key: `SDATE:${t.settlementDate}`, basis: PAYOUT_BASIS.SETTLEMENT_DATE, date: t.settlementDate }
  return { key: `TDATE:${t.transactionDate}`, basis: PAYOUT_BASIS.TRANSACTION_DATE, date: t.transactionDate }
}

/** Zoho-facing code for a payout: "MSQ-20260905-3F2A1C" (no app name). */
function settlementCodeOf(payoutKey: string, date: string | null, prefix: string): string {
  const day = clean(date).replace(/-/g, '') || 'UNDATED'
  return `${prefix}-${day}-${sha256(payoutKey).slice(0, 6).toUpperCase()}`
}

// ── RRN in Zoho ─────────────────────────────────────────────────────────────

/**
 * RRNs written in a Zoho field. With a label (notes: "RRN : 003042448545"), only digits on lines
 * that carry the label (and digit-only lines right after them) count; a custom field holds RRNs only.
 * Leading zeros are kept; numbers of the wrong length are returned as `malformed`, never fixed.
 */
function extractRrns(text: unknown, { label, digits, labelled }: { label: RegExp; digits: number; labelled: boolean }): { rrns: string[]; malformed: string[] } {
  const s = clean(text)
  if (!s) return { rrns: [], malformed: [] }
  const lines = s.split(/\r\n|\n|\r/)
  const picked: string[] = []
  if (!labelled) picked.push(s)
  else {
    let carry = false
    for (const line of lines) {
      if (label.test(line)) {
        picked.push(line.replace(label, ' '))
        carry = true
      } else if (carry && /^[\s\d,;/&+-]+$/.test(line) && /\d/.test(line)) picked.push(line)
      else carry = false
    }
  }
  const rrns: string[] = []
  const malformed: string[] = []
  for (const chunk of picked) {
    for (const m of chunk.match(/\d+/g) || []) {
      if (m.length === digits) {
        if (!rrns.includes(m)) rrns.push(m)
      } else if (m.length >= digits - 3 && m.length <= digits + 2) malformed.push(m)
    }
  }
  return { rrns, malformed }
}

// ── Settlement analysis ─────────────────────────────────────────────────────

const UNSUPPORTED_TYPES = new Set(['REFUND', 'REVERSAL', 'CHARGEBACK', 'UNKNOWN'])

/**
 * Validate every active transaction of one payout and total it, overall and per channel.
 * `channelOf(t)` gives the channel resolved for the row (UNKNOWN until matched).
 */
function analyzeSettlement(transactions: Txn[], config: { currency: string; vatRate: number; vatToleranceMinor: number }, channelOf: (t: Txn) => string = () => CHANNEL.UNKNOWN) {
  const blockers: Issue[] = []
  const warnings: Issue[] = []
  const rows = transactions.map((t) => {
    const problems: Issue[] = []
    const m = t.minor
    const type = t.transactionType || 'SALE'
    if (UNSUPPORTED_TYPES.has(type)) problems.push(issue('UNSUPPORTED_TRANSACTION_TYPE', `${type} rows are not booked automatically (a refund needs its Zoho credit note); book it manually and re-import without it, or extend the workflow.`))
    if (m.gross == null || m.net == null) problems.push(issue('AMOUNT_MISSING', 'Gross and net are both required.'))
    else if (type === 'SALE' && m.gross <= 0) problems.push(issue('SALE_NOT_POSITIVE', `Sale gross ${formatFils(m.gross)} is not positive.`))
    if (m.commission == null && m.vat == null) problems.push(issue('CHARGES_SPLIT_MISSING', 'The file does not split Mashreq charges into commission and VAT; fee and VAT cannot be recognised.'))
    if (m.gross != null && m.net != null && (m.commission != null || m.vat != null)) {
      const charges = (m.commission || 0) + (m.otherFees || 0) + (m.vat || 0)
      if (m.gross - charges !== m.net) problems.push(issue('CHARGES_NOT_RECONCILED', `Gross ${formatFils(m.gross)} − commission ${formatFils(m.commission || 0)} − fees ${formatFils(m.otherFees || 0)} − VAT ${formatFils(m.vat || 0)} = ${formatFils(m.gross - charges)}, but net is ${formatFils(m.net)}.`))
      const base = (m.commission || 0) + (m.otherFees || 0)
      const expected = Math.round(base * config.vatRate)
      if (Math.abs((m.vat || 0) - expected) > config.vatToleranceMinor) problems.push(issue('VAT_RATE_MISMATCH', `VAT ${formatFils(m.vat || 0)} is not ${config.vatRate * 100}% of charges ${formatFils(base)} (expected ≈ ${formatFils(expected)}).`))
      if (charges < 0) problems.push(issue('CHARGES_NEGATIVE', 'Mashreq charges are negative.'))
    }
    if (t.currency && t.currency !== config.currency) problems.push(issue('CURRENCY_NOT_AED', `Currency ${t.currency}.`))
    return { ...t, problems }
  })
  for (const r of rows) for (const p of r.problems) blockers.push({ ...p, transactionId: r.id, rrn: r.rrn })
  if (!rows.length) blockers.push(issue('NO_TRANSACTIONS', 'This payout has no active transactions.'))

  const sum = (list: typeof rows, f: (t: Txn) => number | null) => list.reduce((s, t) => s + (f(t) || 0), 0)
  const totalsOf = (list: typeof rows) => ({
    count: list.length,
    grossMinor: sum(list, (t) => t.minor.gross),
    commissionMinor: sum(list, (t) => t.minor.commission),
    otherFeesMinor: sum(list, (t) => t.minor.otherFees),
    vatMinor: sum(list, (t) => t.minor.vat),
    netMinor: sum(list, (t) => t.minor.net),
  })
  const totals = totalsOf(rows)
  const byChannel: Record<string, ReturnType<typeof totalsOf>> = {}
  for (const ch of new Set(rows.map((r) => channelOf(r)))) byChannel[ch] = totalsOf(rows.filter((r) => channelOf(r) === ch))
  const merchants = [...new Set(rows.map((r) => clean(r.merchantId)).filter(Boolean))]
  const terminals = [...new Set(rows.map((r) => `${clean(r.merchantId)}/${clean(r.terminalId)}`).filter((x) => x !== '/'))]
  const batches = [...new Set(rows.map((r) => clean(r.batchNumber)).filter(Boolean))]
  const dates = rows.map((r) => r.transactionDate).filter(Boolean).sort() as string[]
  return { rows, totals, byChannel, merchants, terminals, batches, firstDate: dates[0] || null, lastDate: dates[dates.length - 1] || null, blockers, warnings }
}

// ── Channel ─────────────────────────────────────────────────────────────────

type TerminalMapping = { merchantId: string; terminalId: string | null; channel: string; location?: string | null; active?: boolean }
type Order = { orderId: string; orderNumber: string; shopOrder: boolean; userAgent: string | null; paymentMethod: string | null; deleted?: boolean }

function orderChannel(order: Order): string {
  if (order.shopOrder) return CHANNEL.BURJUMAN_SHOP
  if (clean(order.userAgent).toLowerCase() === 'app') return CHANNEL.WEB_APP
  if (clean(order.userAgent).toLowerCase() === 'web') return CHANNEL.WEBSITE
  return CHANNEL.UNKNOWN
}

function terminalChannel(t: Txn, mappings: TerminalMapping[]): TerminalMapping | null {
  const live = mappings.filter((m) => m.active !== false && clean(m.merchantId) === clean(t.merchantId))
  return live.find((m) => m.terminalId && clean(m.terminalId) === clean(t.terminalId)) || live.find((m) => !m.terminalId) || null
}

/**
 * Channel from the strongest evidence: the RRN-linked website order, a verified terminal
 * mapping, then the Zoho customer (the shop customer only holds BurJuman orders). Never from
 * amount or date. Disagreeing evidence is a mismatch.
 */
function resolveChannel({ txn, order, invoiceCustomerId, terminalMappings, config }: { txn: Txn; order: Order | null; invoiceCustomerId: string | null; terminalMappings: TerminalMapping[]; config: { shopZohoCustomerId: string; websiteZohoCustomerId: string } }) {
  const evidence: Array<{ source: string; channel: string; detail: string }> = []
  if (order) evidence.push({ source: 'WEBSITE_ORDER', channel: orderChannel(order), detail: `Website order ${order.orderNumber} (${order.shopOrder ? 'shop order' : `${order.userAgent || 'unknown'} order`})` })
  const tm = terminalChannel(txn, terminalMappings)
  if (tm) evidence.push({ source: 'TERMINAL_MAPPING', channel: tm.channel, detail: `Terminal ${tm.merchantId}/${tm.terminalId || '*'}${tm.location ? ` (${tm.location})` : ''}` })
  if (invoiceCustomerId && invoiceCustomerId === config.shopZohoCustomerId) evidence.push({ source: 'ZOHO_CUSTOMER', channel: CHANNEL.BURJUMAN_SHOP, detail: 'Zoho customer Burjman Shop - Web & App' })
  const decisive = evidence.filter((e) => e.channel !== CHANNEL.UNKNOWN)
  const channels = [...new Set(decisive.map((e) => e.channel))]
  // The website customer covers both WEBSITE and WEB_APP; it contradicts BurJuman only.
  const websiteCustomerConflict = invoiceCustomerId === config.websiteZohoCustomerId && channels.includes(CHANNEL.BURJUMAN_SHOP)
  if (channels.length > 1 || websiteCustomerConflict) {
    return { channel: CHANNEL.UNKNOWN, source: 'CONFLICT', evidence, mismatch: `Channel evidence disagrees: ${evidence.map((e) => `${e.detail} → ${e.channel}`).join('; ')}${websiteCustomerConflict ? '; Zoho customer is Website' : ''}.` }
  }
  if (!channels.length) return { channel: CHANNEL.UNKNOWN, source: null, evidence, mismatch: null }
  const best = decisive[0]
  return { channel: best.channel, source: best.source, evidence, mismatch: null }
}

// ── Matching ────────────────────────────────────────────────────────────────

type InvoiceRef = { invoiceId: string; invoiceNumber: string; customerId: string; customerName?: string; referenceNumber: string; status: string; totalMinor: number; balanceMinor: number; currencyCode: string; date: string; rrns?: string[] }

/**
 * Invoice(s) a transaction pays: a manual mapping when one is saved, otherwise the single live
 * invoice whose RRN equals the transaction's RRN. Date + amount never match automatically.
 */
function matchTransaction({ txn, rrnHits, manual, config }: { txn: Txn; rrnHits: InvoiceRef[] | null; manual: { allocations: Array<{ invoiceId: string; invoiceNumber: string; customerId: string; grossMinor: number }> } | null; config: { currency: string } }) {
  const out = (status: string, reason: string, extra: Record<string, unknown> = {}) => ({ status, reason, matched: status === MATCH_STATUS.MATCHED || status === MATCH_STATUS.MANUAL, allocations: [] as Array<{ invoiceId: string; invoiceNumber: string; customerId: string; grossMinor: number }>, ...extra })
  if (manual && manual.allocations.length) {
    const customers = new Set(manual.allocations.map((a) => a.customerId))
    if (customers.size > 1) return out(MATCH_STATUS.CUSTOMER_MISMATCH, 'The manual mapping spans more than one Zoho customer; one POS transaction can only pay invoices of one customer.')
    const sum = manual.allocations.reduce((s, a) => s + a.grossMinor, 0)
    if (sum !== txn.minor.gross) return out(MATCH_STATUS.AMOUNT_EXCEEDS_INVOICE, `The manual mapping allocates ${formatFils(sum)}, not the transaction's ${formatFils(txn.minor.gross || 0)}.`)
    return out(MATCH_STATUS.MANUAL, `Manually mapped to ${manual.allocations.map((a) => a.invoiceNumber).join(', ')}.`, { allocations: manual.allocations })
  }
  if (!txn.rrn || !/^\d+$/.test(txn.rrn)) return out(MATCH_STATUS.RRN_INVALID, 'The transaction has no usable RRN; map it manually.')
  if (rrnHits == null) return out(MATCH_STATUS.NOT_CHECKED, 'Zoho invoices were not searched.')
  const live = rrnHits.filter((i) => i.status !== 'void')
  if (!live.length) return out(MATCH_STATUS.RRN_NOT_FOUND, rrnHits.length ? `Only void Zoho invoices carry RRN ${txn.rrn}.` : `No Zoho invoice carries RRN ${txn.rrn}.`)
  if (live.length > 1) return out(MATCH_STATUS.RRN_AMBIGUOUS, `RRN ${txn.rrn} is on ${live.length} Zoho invoices: ${live.map((i) => i.invoiceNumber).join(', ')}.`, { candidates: live })
  const inv = live[0]
  if (inv.status === 'draft') return out(MATCH_STATUS.INVOICE_NOT_PAYABLE, `Zoho invoice ${inv.invoiceNumber} is a draft.`, { invoice: inv })
  if (clean(inv.currencyCode).toUpperCase() !== config.currency) return out(MATCH_STATUS.CURRENCY_MISMATCH, `Zoho invoice ${inv.invoiceNumber} is in ${inv.currencyCode}.`, { invoice: inv })
  if ((txn.minor.gross || 0) > inv.totalMinor) return out(MATCH_STATUS.AMOUNT_EXCEEDS_INVOICE, `Transaction ${formatFils(txn.minor.gross || 0)} is more than invoice ${inv.invoiceNumber} total ${formatFils(inv.totalMinor)}.`, { invoice: inv })
  return out(MATCH_STATUS.MATCHED, `RRN ${txn.rrn} → Zoho ${inv.invoiceNumber}.`, { invoice: inv, allocations: [{ invoiceId: inv.invoiceId, invoiceNumber: inv.invoiceNumber, customerId: inv.customerId, grossMinor: txn.minor.gross || 0 }] })
}

/** Invoices with the transaction's amount, dated near it, and no RRN of their own: shown only. */
function possibleMatches(txn: Txn, scanned: InvoiceRef[], days: number): InvoiceRef[] {
  if (!txn.transactionDate || txn.minor.gross == null) return []
  return scanned
    .filter((i) => i.status !== 'void' && i.totalMinor === txn.minor.gross && i.date && dayDiff(i.date, txn.transactionDate as string) <= days && !(i.rrns && i.rrns.length))
    .slice(0, 5)
}

/** Net / fee / commission / VAT of one transaction split over its invoice allocations, exactly. */
function splitTransaction(txn: Txn, allocations: Array<{ invoiceId: string; grossMinor: number }>) {
  const weights = allocations.map((a) => a.grossMinor)
  const net = allocateProportionally(txn.minor.net || 0, weights)
  const commission = allocateProportionally((txn.minor.commission || 0) + (txn.minor.otherFees || 0), weights)
  const vat = allocateProportionally(txn.minor.vat || 0, weights)
  return allocations.map((a, i) => ({ invoiceId: a.invoiceId, grossMinor: a.grossMinor, netMinor: net[i], chargesMinor: commission[i], vatMinor: vat[i], feeMinor: a.grossMinor - net[i] }))
}

// ── Invoice assessment ──────────────────────────────────────────────────────

type InvoicePayment = { paymentId: string; amountMinor: number; referenceNumber: string; description?: string; accountId: string; accountName?: string; date?: string }
type InvoiceState = InvoiceRef & { payments: InvoicePayment[] }

/**
 * How one invoice is settled by this payout.
 *  NEW                no POS receipt is applied: plan NET + FEE receipts (balance must cover them)
 *  EXISTING_RECEIPTS  POS receipts outside this workflow already pay exactly this payout's gross on
 *                     the invoice: reuse them (never pay again), reclassify any NET/FEE difference
 *  BLOCKED            anything else (conflicting or partial POS receipts, overpayment)
 */
function assessInvoice({ state, parts, accounts, ownPrefix, workflowPrefix, rrns }: {
  state: InvoiceState
  parts: Array<{ grossMinor: number; netMinor: number; feeMinor: number }>
  accounts: Record<string, { accountId: string; accountName: string } | undefined>
  ownPrefix: string
  workflowPrefix: string
  rrns: string[]
}) {
  const grossMinor = parts.reduce((s, p) => s + p.grossMinor, 0)
  const netMinor = parts.reduce((s, p) => s + p.netMinor, 0)
  const feeMinor = parts.reduce((s, p) => s + p.feeMinor, 0)
  const und = accounts[ROLE.UNDEPOSITED]
  const proc = accounts[ROLE.PROCESSING]
  const isAccount = (p: InvoicePayment, a?: { accountId: string; accountName: string }) => Boolean(a && (p.accountId ? p.accountId === a.accountId : clean(p.accountName).toLowerCase() === clean(a.accountName).toLowerCase()))
  const own = state.payments.filter((p) => p.referenceNumber.startsWith(ownPrefix))
  const otherWorkflow = state.payments.filter((p) => !p.referenceNumber.startsWith(ownPrefix) && p.referenceNumber.startsWith(`${workflowPrefix}-`))
  const outside = state.payments.filter((p) => !p.referenceNumber.startsWith(`${workflowPrefix}-`))
  const posUnd = outside.filter((p) => isAccount(p, und))
  const posProc = outside.filter((p) => isAccount(p, proc))
  const nonPos = outside.filter((p) => !isAccount(p, und) && !isAccount(p, proc))
  const withRrn = state.payments.filter((p) => rrns.some((r) => `${p.referenceNumber} ${clean(p.description)}`.includes(r)))
  const sum = (l: InvoicePayment[]) => l.reduce((s, p) => s + p.amountMinor, 0)
  const ownApplied = sum(own)
  const posUndMinor = sum(posUnd)
  const posProcMinor = sum(posProc)
  const base = { invoiceId: state.invoiceId, invoiceNumber: state.invoiceNumber, customerId: state.customerId, date: state.date, totalMinor: state.totalMinor, balanceMinor: state.balanceMinor, grossMinor, netMinor, feeMinor, ownAppliedMinor: ownApplied, existing: { undepositedMinor: posUndMinor, processingMinor: posProcMinor, payments: [...posUnd, ...posProc].map((p) => ({ paymentId: p.paymentId, referenceNumber: p.referenceNumber, amountMinor: p.amountMinor, account: p.accountName || p.accountId })) }, otherPaymentsMinor: sum(nonPos) + sum(otherWorkflow), paymentsWithRrn: withRrn.map((p) => p.referenceNumber) }
  const blocked = (code: string, message: string) => ({ ...base, mode: INVOICE_MODE.BLOCKED, reclassMinor: 0, problem: issue(code, message, { invoiceNumber: state.invoiceNumber }) })
  const rrnElsewhere = withRrn.filter((p) => !isAccount(p, und) && !isAccount(p, proc) && !p.referenceNumber.startsWith(ownPrefix))
  if (rrnElsewhere.length) return blocked('CONFLICTING_PAYMENT', `Invoice ${state.invoiceNumber} has payment "${rrnElsewhere[0].referenceNumber}" carrying the RRN outside the POS accounts.`)
  if (posUndMinor + posProcMinor === 0) {
    const available = state.balanceMinor + ownApplied
    if (grossMinor > available) {
      return blocked(state.balanceMinor === 0 && ownApplied === 0 ? 'INVOICE_ALREADY_PAID' : 'BALANCE_INSUFFICIENT', `Invoice ${state.invoiceNumber} has ${formatFils(available)} open for this payout but the POS transactions total ${formatFils(grossMinor)} (other payments ${formatFils(sum(nonPos) + sum(otherWorkflow))}).`)
    }
    return { ...base, mode: INVOICE_MODE.NEW, reclassMinor: 0, problem: null, partial: grossMinor < available }
  }
  if (ownApplied > 0) return blocked('RECEIPTS_MIXED', `Invoice ${state.invoiceNumber} has POS receipts from both this workflow and outside it.`)
  if (posUndMinor + posProcMinor !== grossMinor) {
    return blocked('EXISTING_RECEIPTS_MISMATCH', `Invoice ${state.invoiceNumber} already has POS receipts of ${formatFils(posUndMinor + posProcMinor)} (Undeposited ${formatFils(posUndMinor)}, Processing ${formatFils(posProcMinor)}), not this payout's ${formatFils(grossMinor)}; review before posting.`)
  }
  return { ...base, mode: INVOICE_MODE.EXISTING_RECEIPTS, reclassMinor: posUndMinor - netMinor, problem: null, partial: false }
}

// ── Posting plan ────────────────────────────────────────────────────────────

const reference = (code: string, ...parts: string[]) => [code, ...parts].filter(Boolean).join('/')

function accountIdOf(accounts: Record<string, { accountId: string } | undefined>, role: string): string | null {
  const a = accounts && accounts[role]
  return a && a.accountId ? a.accountId : null
}

function withAccounts(lines: Line[], accounts: Record<string, { accountId: string } | undefined>): Line[] {
  return lines.filter((l) => l.amountMinor !== 0).map((l) => ({ ...l, accountId: accountIdOf(accounts, l.role) }))
}

function customerTag(customerId: string, config: { shopZohoCustomerId: string; websiteZohoCustomerId: string }): string {
  if (customerId === config.shopZohoCustomerId) return 'SHOP'
  if (customerId === config.websiteZohoCustomerId) return 'WEB'
  return `C${customerId.slice(-6)}`
}

/**
 * Every Zoho record one payout needs, in execution order, with deterministic keys and references.
 * @param invoices assessed invoices (only NEW and EXISTING_RECEIPTS take part)
 * @param totals payout totals from the statement
 * @param feeRecognition existing recognition found in Zoho (ALREADY_RECOGNIZED skips the journal)
 * @param bank BANK_DEPOSIT_SEEN plans the transfer; BANK_MATCHED links the existing one
 */
function buildPostingPlan({ code, invoices, totals, accounts, date, config, feeRecognition, bank }: {
  code: string
  invoices: Array<ReturnType<typeof assessInvoice>>
  totals: { grossMinor: number; commissionMinor: number; otherFeesMinor: number; vatMinor: number; netMinor: number }
  accounts: Record<string, { accountId: string } | undefined>
  date: string
  config: { currency: string; paymentMode: string; shopZohoCustomerId: string; websiteZohoCustomerId: string }
  feeRecognition: { status: string } | null
  bank: { status: string; amountMinor: number; date?: string | null } | null
}) {
  const components: any[] = []
  const push = (c: any) => {
    c.settlementCode = code
    c.key = `${code}|${c.component}|${c.scope}`
    c.phase = PHASE[c.component]
    c.amount = filsToMajor(c.amountMinor)
    c.currency = config.currency
    c.date = c.date || date
    components.push(c)
  }
  const fresh = invoices.filter((i) => i.mode === INVOICE_MODE.NEW).sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber))
  const byCustomer = new Map<string, typeof fresh>()
  for (const inv of fresh) byCustomer.set(inv.customerId, [...(byCustomer.get(inv.customerId) || []), inv])
  for (const [customerId, list] of [...byCustomer.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const tag = customerTag(customerId, config)
    const parts: Array<[string, (i: (typeof list)[number]) => number, string, string]> = [
      [COMPONENT.RECEIPT_NET, (i) => i.netMinor, ROLE.UNDEPOSITED, 'NET'],
      [COMPONENT.RECEIPT_FEE, (i) => i.feeMinor, ROLE.PROCESSING, 'FEE'],
    ]
    for (const [component, amountOf, depositRole, suffix] of parts) {
      const applied = list.filter((i) => amountOf(i) > 0)
      if (!applied.length) continue
      // Zoho refuses a payment dated before the invoice it pays.
      const latestInvoice = applied.map((i) => i.date || '').sort().pop() || ''
      push({
        component,
        scope: `CUSTOMER:${customerId}`,
        zohoRecordType: 'customer_payment',
        date: latestInvoice > date ? latestInvoice : date,
        customerId,
        amountMinor: applied.reduce((s, i) => s + amountOf(i), 0),
        reference: reference(code, suffix, tag),
        depositRole,
        depositAccountId: accountIdOf(accounts, depositRole),
        allocations: applied.map((i) => ({ invoiceId: i.invoiceId, invoiceNumber: i.invoiceNumber, amount: filsToMajor(amountOf(i)) })),
      })
    }
  }

  const reclass = invoices.filter((i) => i.mode === INVOICE_MODE.EXISTING_RECEIPTS).reduce((s, i) => s + i.reclassMinor, 0)
  if (reclass !== 0) {
    // > 0: existing receipts put part of the charges into Undeposited; < 0: the reverse.
    const lines = withAccounts(reclass > 0
      ? [{ role: ROLE.PROCESSING, side: 'debit', amountMinor: reclass }, { role: ROLE.UNDEPOSITED, side: 'credit', amountMinor: reclass }]
      : [{ role: ROLE.UNDEPOSITED, side: 'debit', amountMinor: -reclass }, { role: ROLE.PROCESSING, side: 'credit', amountMinor: -reclass }], accounts)
    push({ component: COMPONENT.RECEIPT_RECLASS, scope: 'PAYOUT', zohoRecordType: 'journal', amountMinor: Math.abs(reclass), reference: reference(code, 'RECLASS'), lines })
  }

  const charges = totals.commissionMinor + totals.otherFeesMinor
  const feeTotal = charges + totals.vatMinor
  if (feeTotal > 0 && !(feeRecognition && feeRecognition.status === FEE_STATUS.ALREADY_RECOGNIZED)) {
    const lines = withAccounts([
      { role: ROLE.FEE_EXPENSE, side: 'debit', amountMinor: charges },
      { role: ROLE.INPUT_VAT, side: 'debit', amountMinor: totals.vatMinor },
      { role: ROLE.PROCESSING, side: 'credit', amountMinor: feeTotal },
    ], accounts)
    push({ component: COMPONENT.FEE_RECOGNITION, scope: 'PAYOUT', zohoRecordType: 'journal', amountMinor: feeTotal, reference: reference(code, 'FEES'), lines })
  }

  if (bank && bank.status === BANK_STATUS.BANK_DEPOSIT_SEEN && bank.amountMinor > 0) {
    push({
      component: COMPONENT.BANK_CLEARING,
      scope: 'PAYOUT',
      zohoRecordType: 'bank_transfer',
      date: bank.date || date,
      amountMinor: bank.amountMinor,
      reference: reference(code, 'BANK'),
      fromRole: ROLE.UNDEPOSITED,
      toRole: ROLE.BANK,
      fromAccountId: accountIdOf(accounts, ROLE.UNDEPOSITED),
      toAccountId: accountIdOf(accounts, ROLE.BANK),
    })
  }

  components.sort((a, b) => a.phase - b.phase || a.key.localeCompare(b.key))
  for (const c of components) c.payload = payloadFor(c, config)
  return components
}

function payloadFor(c: any, config: { paymentMode: string }) {
  if (c.zohoRecordType === 'customer_payment') {
    return plain(buildCustomerPaymentPayload({
      customerId: c.customerId,
      paymentMode: config.paymentMode,
      amount: c.amount,
      paymentDate: c.date,
      referenceNumber: c.reference,
      depositToAccountId: c.depositAccountId,
      invoices: c.allocations.map((a: Allocation) => ({ invoiceId: a.invoiceId, amountApplied: a.amount })),
    }))
  }
  if (c.zohoRecordType === 'journal') {
    return plain(buildManualJournalPayload({ date: c.date, referenceNumber: c.reference, lineItems: c.lines.map((l: Line) => ({ accountId: l.accountId, debitOrCredit: l.side, amount: filsToMajor(l.amountMinor) })) }))
  }
  if (c.zohoRecordType === 'bank_transfer') {
    return plain({ transaction_type: 'transfer_fund', from_account_id: c.fromAccountId, to_account_id: c.toAccountId, amount: c.amount, date: c.date, reference_number: c.reference })
  }
  return null
}

/** Journals balance to the fils, every account is resolved, every amount is positive. */
function componentProblems(c: any): string[] {
  const problems: string[] = []
  if (c.zohoRecordType === 'journal') {
    const dr = c.lines.filter((l: Line) => l.side === 'debit').reduce((s: number, l: Line) => s + l.amountMinor, 0)
    const cr = c.lines.filter((l: Line) => l.side === 'credit').reduce((s: number, l: Line) => s + l.amountMinor, 0)
    if (dr !== cr) problems.push(`${c.component} debits ${formatFils(dr)} ≠ credits ${formatFils(cr)}.`)
    if (c.lines.some((l: Line) => !l.accountId)) problems.push(`${c.component} has an unmapped account (${c.lines.filter((l: Line) => !l.accountId).map((l: Line) => l.role).join(', ')}).`)
    if (c.lines.some((l: Line) => l.amountMinor <= 0)) problems.push(`${c.component} has a non-positive line.`)
  }
  if (c.zohoRecordType === 'customer_payment') {
    if (!c.depositAccountId) problems.push(`${c.component} has no ${c.depositRole} account.`)
    const applied = c.allocations.reduce((s: number, a: Allocation) => s + majorToFils(a.amount), 0)
    if (applied !== c.amountMinor) problems.push(`${c.component} applies ${formatFils(applied)} but pays ${formatFils(c.amountMinor)}.`)
  }
  if (c.zohoRecordType === 'bank_transfer' && (!c.fromAccountId || !c.toAccountId)) problems.push('BANK_CLEARING has an unmapped account.')
  if (!(c.amountMinor > 0)) problems.push(`${c.component} amount ${formatFils(c.amountMinor)} is not positive.`)
  return problems
}

// ── Ledger simulation ───────────────────────────────────────────────────────

/**
 * Account balances (fils, debit positive) for this payout after the plan: existing POS receipts
 * and an existing RAK transfer count as already booked; AR per invoice opens at the payout's gross.
 */
function simulateLedger(components: any[], { invoices = [], existingBankMinor = 0, existingFeeMinor = 0 }: { invoices?: Array<ReturnType<typeof assessInvoice>>; existingBankMinor?: number; existingFeeMinor?: number } = {}) {
  const bal: Record<string, number> = {}
  const add = (k: string, v: number) => {
    bal[k] = (bal[k] || 0) + v
  }
  for (const inv of invoices) {
    if (inv.mode === INVOICE_MODE.BLOCKED) continue
    add(`AR:${inv.invoiceId}`, inv.grossMinor)
    if (inv.mode === INVOICE_MODE.EXISTING_RECEIPTS) {
      add(ROLE.UNDEPOSITED, inv.existing.undepositedMinor)
      add(ROLE.PROCESSING, inv.existing.processingMinor)
      add(`AR:${inv.invoiceId}`, -inv.grossMinor)
    }
  }
  for (const c of [...components].sort((a, b) => a.phase - b.phase)) {
    if (c.zohoRecordType === 'customer_payment') {
      add(c.depositRole, c.amountMinor)
      for (const a of c.allocations) add(`AR:${a.invoiceId}`, -majorToFils(a.amount))
    } else if (c.zohoRecordType === 'journal') {
      for (const l of c.lines) add(l.role, l.side === 'debit' ? l.amountMinor : -l.amountMinor)
    } else if (c.zohoRecordType === 'bank_transfer') {
      add(c.toRole, c.amountMinor)
      add(c.fromRole, -c.amountMinor)
    }
  }
  if (existingBankMinor) {
    add(ROLE.BANK, existingBankMinor)
    add(ROLE.UNDEPOSITED, -existingBankMinor)
  }
  if (existingFeeMinor) add(ROLE.PROCESSING, -existingFeeMinor)
  return bal
}

function postingFingerprint({ code, date, components, bank, feeRecognition, transactions }: { code: string; date: string; components: any[]; bank: any; feeRecognition: any; transactions: Txn[] }): string {
  return sha256({
    code,
    date,
    transactions: transactions.map((t) => [t.id, t.rrn, t.minor.gross, t.minor.net]).sort(),
    bank: bank ? { status: bank.status, amountMinor: bank.amountMinor, transactionId: bank.matched ? bank.matched.transactionId : null } : null,
    fee: feeRecognition ? { status: feeRecognition.status, recordId: feeRecognition.recordId || null } : null,
    components: components.map((c) => ({
      key: c.key,
      type: c.zohoRecordType,
      amount: c.amountMinor,
      reference: c.reference,
      customer: c.customerId || null,
      allocations: (c.allocations || []).map((a: Allocation) => [a.invoiceId, majorToFils(a.amount)]),
      deposit: c.depositAccountId || null,
      from: c.fromAccountId || null,
      to: c.toAccountId || null,
      lines: (c.lines || []).map((l: Line) => [l.accountId, l.side, l.amountMinor]),
    })),
  })
}

module.exports = {
  COMPONENT,
  PHASE,
  TXN_STATUS,
  MATCH_STATUS,
  INVOICE_MODE,
  BANK_STATUS,
  FEE_STATUS,
  PAYOUT_BASIS,
  addDays,
  dayDiff,
  transactionIdentity,
  economicHash,
  sameTransaction,
  economicDifferences,
  classifyIncoming,
  inFileDuplicates,
  payoutKeyOf,
  settlementCodeOf,
  extractRrns,
  analyzeSettlement,
  orderChannel,
  terminalChannel,
  resolveChannel,
  matchTransaction,
  possibleMatches,
  splitTransaction,
  assessInvoice,
  customerTag,
  buildPostingPlan,
  payloadFor,
  componentProblems,
  simulateLedger,
  postingFingerprint,
}
