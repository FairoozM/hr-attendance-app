/**
 * Read-only Zoho lookups that decide whether an accounting record already exists
 * before (or after an ambiguous) create. Every lookup is injectable so posting code
 * and tests share the same matching rules.
 */

const AMOUNT_TOLERANCE = 0.01

/**
 * @typedef {{ field: string, expected: unknown, actual: unknown }} FieldDiff
 * @typedef {{ diffs: FieldDiff[], unverified: string[] }} Comparison
 * @typedef {'none'|'exact'|'conflict'|'multiple'|'missing'} LookupOutcome
 * @typedef {{
 *   outcome: LookupOutcome,
 *   match: { zohoId: string, zohoNumber: string, date: string } | null,
 *   candidates: Array<{ zohoId: string, zohoNumber: string, date: string, diffs: FieldDiff[], unverified: string[] }>,
 *   message: string,
 * }} LookupResult
 */

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function sameText(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase()
}

function money(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN
}

function sameAmount(a, b) {
  const x = money(a)
  const y = money(b)
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < AMOUNT_TOLERANCE
}

/**
 * @param {Comparison} cmp
 * @param {string} field
 * @param {unknown} expected
 * @param {unknown} actual
 * @param {(a: unknown, b: unknown) => boolean} equals
 */
function check(cmp, field, expected, actual, equals) {
  if (expected == null || expected === '') return
  if (actual == null || actual === '') {
    cmp.unverified.push(field)
    return
  }
  if (!equals(expected, actual)) cmp.diffs.push({ field, expected, actual })
}

/**
 * @param {Array<{ id: string, amount: number }>} expected
 * @param {Array<{ id: string, amount: number }>} actual
 */
function sameAllocationSet(expected, actual) {
  if (expected.length !== actual.length) return false
  const byId = new Map(actual.map((row) => [row.id, row.amount]))
  return expected.every((row) => byId.has(row.id) && sameAmount(row.amount, byId.get(row.id)))
}

function allocationSummary(rows) {
  const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  return `${rows.length} invoices / ${money(total)}`
}

/**
 * @typedef {{
 *   customerId: string, referenceNumber: string, date?: string|null, amount: number,
 *   accountId: string, currencyCode?: string|null,
 *   invoices: Array<{ invoiceId: string, amountApplied: number }>,
 * }} ExpectedPayment
 */

/** @param {ExpectedPayment} expected @param {any} actual @returns {Comparison} */
function comparePayment(expected, actual) {
  const cmp = { diffs: [], unverified: [] }
  check(cmp, 'customer', expected.customerId, actual?.customer_id, sameText)
  check(cmp, 'reference', expected.referenceNumber, actual?.reference_number, sameText)
  check(cmp, 'date', expected.date, actual?.date, sameText)
  check(cmp, 'currency', expected.currencyCode, actual?.currency_code, sameText)
  check(cmp, 'amount', expected.amount, actual?.amount, sameAmount)
  check(cmp, 'account', expected.accountId, actual?.account_id, sameText)
  if (Array.isArray(expected.invoices)) {
    if (!Array.isArray(actual?.invoices)) {
      cmp.unverified.push('invoice allocations')
    } else {
      const exp = expected.invoices.map((row) => ({ id: clean(row.invoiceId), amount: Number(row.amountApplied) || 0 }))
      const act = actual.invoices
        .map((row) => ({ id: clean(row.invoice_id), amount: Number(row.amount_applied) || 0 }))
        .filter((row) => row.id)
      if (!sameAllocationSet(exp, act)) {
        cmp.diffs.push({ field: 'invoice allocations', expected: allocationSummary(exp), actual: allocationSummary(act) })
      }
    }
  }
  if (actual?.account_id && expected.accountId && !sameText(expected.accountId, actual.account_id) && actual.account_name) {
    const diff = cmp.diffs.find((row) => row.field === 'account')
    if (diff) diff.actual = `${actual.account_id} (${actual.account_name})`
  }
  return cmp
}

/**
 * @typedef {{
 *   referenceNumber: string, date?: string|null, amount: number, currencyCode?: string|null,
 *   lines: Array<{ accountId: string, debitOrCredit: 'debit'|'credit', amount: number }>,
 * }} ExpectedJournal
 */

function journalLineKey(line) {
  return `${clean(line.accountId).toLowerCase()}|${clean(line.debitOrCredit).toLowerCase()}|${money(line.amount).toFixed(2)}`
}

/** @param {ExpectedJournal} expected @param {any} actual @returns {Comparison} */
function compareJournal(expected, actual) {
  const cmp = { diffs: [], unverified: [] }
  check(cmp, 'reference', expected.referenceNumber, actual?.reference_number, sameText)
  check(cmp, 'date', expected.date, actual?.journal_date, sameText)
  check(cmp, 'currency', expected.currencyCode, actual?.currency_code, sameText)
  check(cmp, 'amount', expected.amount, actual?.total, sameAmount)
  if (!Array.isArray(actual?.line_items)) {
    cmp.unverified.push('journal lines')
  } else {
    const exp = expected.lines.map(journalLineKey).sort()
    const act = actual.line_items
      .map((row) => journalLineKey({ accountId: row.account_id, debitOrCredit: row.debit_or_credit, amount: row.amount }))
      .sort()
    if (exp.join(',') !== act.join(',')) {
      cmp.diffs.push({
        field: 'journal lines',
        expected: expected.lines.map((l) => `${l.debitOrCredit} ${l.accountId} ${money(l.amount)}`).join('; '),
        actual: actual.line_items
          .map((l) => `${l.debit_or_credit} ${l.account_id}${l.account_name ? ` (${l.account_name})` : ''} ${money(l.amount)}`)
          .join('; '),
      })
    }
  }
  return cmp
}

/**
 * @typedef {{ customerId: string, referenceNumber: string, date?: string|null, total: number, currencyCode?: string|null }} ExpectedCreditNote
 */

/** @param {ExpectedCreditNote} expected @param {any} actual @returns {Comparison} */
function compareCreditNote(expected, actual) {
  const cmp = { diffs: [], unverified: [] }
  check(cmp, 'customer', expected.customerId, actual?.customer_id, sameText)
  check(cmp, 'reference', expected.referenceNumber, actual?.reference_number, sameText)
  check(cmp, 'date', expected.date, actual?.date, sameText)
  check(cmp, 'currency', expected.currencyCode, actual?.currency_code, sameText)
  check(cmp, 'amount', expected.total, actual?.total, sameAmount)
  return cmp
}

/**
 * @typedef {{ referenceNumber: string, date?: string|null, amount: number, fromAccountId?: string|null }} ExpectedRefund
 */

/** @param {ExpectedRefund} expected @param {any} actual @returns {Comparison} */
function compareRefund(expected, actual) {
  const cmp = { diffs: [], unverified: [] }
  check(cmp, 'reference', expected.referenceNumber, actual?.reference_number, sameText)
  check(cmp, 'date', expected.date, actual?.date, sameText)
  check(cmp, 'amount', expected.amount, actual?.amount ?? actual?.amount_bcy ?? actual?.amount_fcy, sameAmount)
  check(cmp, 'account', expected.fromAccountId, actual?.from_account_id ?? actual?.account_id, sameText)
  return cmp
}

/**
 * @param {Array<{ zohoId: string, zohoNumber: string, date: string, cmp: Comparison }>} evaluated
 * @param {string} label
 * @returns {LookupResult}
 */
function classify(evaluated, label) {
  const candidates = evaluated.map((row) => ({
    zohoId: row.zohoId,
    zohoNumber: row.zohoNumber,
    date: row.date,
    diffs: row.cmp.diffs,
    unverified: row.cmp.unverified,
  }))
  const exact = candidates.filter((row) => row.diffs.length === 0 && row.unverified.length === 0)
  if (!candidates.length) {
    return { outcome: 'none', match: null, candidates, message: `No existing Zoho ${label} matches this entry.` }
  }
  if (exact.length === 1 && candidates.length === 1) {
    const only = exact[0]
    return {
      outcome: 'exact',
      match: { zohoId: only.zohoId, zohoNumber: only.zohoNumber, date: only.date },
      candidates,
      message: `Exactly one Zoho ${label} (${only.zohoNumber || only.zohoId}) matches every checked field.`,
    }
  }
  if (exact.length > 1) {
    return {
      outcome: 'multiple',
      match: null,
      candidates,
      message: `${exact.length} Zoho ${label}s match this entry; possible duplicate. Resolve in Zoho before continuing.`,
    }
  }
  const described = candidates
    .map((row) => {
      const parts = row.diffs.map((d) => `${d.field}: expected ${d.expected}, found ${d.actual}`)
      if (row.unverified.length) parts.push(`not returned by Zoho: ${row.unverified.join(', ')}`)
      return `${row.zohoNumber || row.zohoId} (${parts.join('; ') || 'matches'})`
    })
    .join(' | ')
  return {
    outcome: 'conflict',
    match: null,
    candidates,
    message: `Zoho has ${candidates.length} related ${label}(s) that do not exactly match: ${described}`,
  }
}

/**
 * @typedef {{
 *   listCustomerPayments: (params: Record<string, string>) => Promise<any[]>,
 *   getCustomerPayment: (id: string) => Promise<any|null>,
 *   listJournals: (params: Record<string, string>) => Promise<any[]>,
 *   getJournal: (id: string) => Promise<any|null>,
 *   listCreditNotes: (params: Record<string, string>) => Promise<any[]>,
 *   listCreditNoteRefunds: (creditNoteId: string) => Promise<any[]>,
 * }} ZohoLookupDeps
 */

/** @param {ExpectedPayment} expected @param {ZohoLookupDeps} deps @returns {Promise<LookupResult>} */
async function lookupCustomerPayment(expected, deps) {
  const rows = await deps.listCustomerPayments({ reference_number_contains: clean(expected.referenceNumber) })
  const related = rows.filter(
    (row) => sameText(row.reference_number, expected.referenceNumber) && sameText(row.customer_id, expected.customerId)
  )
  const evaluated = []
  for (const row of related) {
    const detail = (await deps.getCustomerPayment(clean(row.payment_id))) || row
    evaluated.push({
      zohoId: clean(detail.payment_id || row.payment_id),
      zohoNumber: clean(detail.payment_number || row.payment_number),
      date: clean(detail.date || row.date),
      cmp: comparePayment(expected, detail),
    })
  }
  return classify(evaluated, 'customer payment')
}

/** @param {ExpectedJournal} expected @param {ZohoLookupDeps} deps @returns {Promise<LookupResult>} */
async function lookupJournal(expected, deps) {
  const rows = await deps.listJournals({ reference_number_contains: clean(expected.referenceNumber) })
  const related = rows.filter(
    (row) => sameText(row.reference_number, expected.referenceNumber) && sameAmount(row.total, expected.amount)
  )
  const evaluated = []
  for (const row of related) {
    const detail = (await deps.getJournal(clean(row.journal_id))) || row
    evaluated.push({
      zohoId: clean(detail.journal_id || row.journal_id),
      zohoNumber: clean(detail.entry_number || row.entry_number),
      date: clean(detail.journal_date || row.journal_date),
      cmp: compareJournal(expected, detail),
    })
  }
  return classify(evaluated, 'manual journal')
}

/** @param {ExpectedCreditNote} expected @param {ZohoLookupDeps} deps @returns {Promise<LookupResult>} */
async function lookupCreditNote(expected, deps) {
  const rows = await deps.listCreditNotes({
    customer_id: clean(expected.customerId),
    reference_number_contains: clean(expected.referenceNumber),
  })
  const related = rows.filter(
    (row) => sameText(row.reference_number, expected.referenceNumber) && sameText(row.customer_id, expected.customerId)
  )
  return classify(
    related.map((row) => ({
      zohoId: clean(row.creditnote_id),
      zohoNumber: clean(row.creditnote_number),
      date: clean(row.date),
      cmp: compareCreditNote(expected, row),
    })),
    'credit note'
  )
}

/**
 * @param {string} creditNoteId
 * @param {ExpectedRefund} expected
 * @param {ZohoLookupDeps} deps
 * @returns {Promise<LookupResult>}
 */
async function lookupCreditNoteRefund(creditNoteId, expected, deps) {
  const rows = await deps.listCreditNoteRefunds(clean(creditNoteId))
  const related = rows.filter((row) => sameText(row.reference_number, expected.referenceNumber))
  const evaluated = []
  for (const row of related) {
    const refundId = clean(row.creditnote_refund_id || row.id)
    const detail = (deps.getCreditNoteRefund && (await deps.getCreditNoteRefund(clean(creditNoteId), refundId))) || row
    evaluated.push({ zohoId: refundId, zohoNumber: '', date: clean(detail.date || row.date), cmp: compareRefund(expected, detail) })
  }
  return classify(evaluated, 'credit note refund')
}

/**
 * Re-fetch a record by its known Zoho id and compare it with what should exist.
 * @param {'payment'|'journal'} kind
 * @param {string} zohoId
 * @param {ExpectedPayment|ExpectedJournal} expected
 * @param {ZohoLookupDeps} deps
 * @returns {Promise<LookupResult>}
 */
async function verifyRecordById(kind, zohoId, expected, deps) {
  const id = clean(zohoId)
  const label = kind === 'payment' ? 'customer payment' : 'manual journal'
  const detail = kind === 'payment' ? await deps.getCustomerPayment(id) : await deps.getJournal(id)
  if (!detail) {
    return { outcome: 'missing', match: null, candidates: [], message: `Zoho ${label} ${id} was not found (deleted or wrong id).` }
  }
  const cmp =
    kind === 'payment'
      ? comparePayment(/** @type {ExpectedPayment} */ (expected), detail)
      : compareJournal(/** @type {ExpectedJournal} */ (expected), detail)
  const number = clean(kind === 'payment' ? detail.payment_number : detail.entry_number)
  const date = clean(kind === 'payment' ? detail.date : detail.journal_date)
  const result = classify([{ zohoId: id, zohoNumber: number, date, cmp }], label)
  if (result.outcome === 'conflict') {
    result.message = `Zoho ${label} ${number || id} exists but differs: ${result.candidates[0].diffs
      .map((d) => `${d.field}: expected ${d.expected}, found ${d.actual}`)
      .concat(result.candidates[0].unverified.length ? [`not returned: ${result.candidates[0].unverified.join(', ')}`] : [])
      .join('; ')}`
  }
  return result
}

/**
 * Timeouts, transport failures, 5xx, invalid JSON, and Zoho's generic code 1000 do not
 * prove the write was rejected; Zoho may already have created the record.
 * @param {any} err
 */
const NOT_SENT_CODES = new Set([
  'ZOHO_HTTP_429',
  'ZOHO_DAILY_LIMIT',
  'ZOHO_RATE_MINUTE_LIMIT',
  'ZOHO_SAFE_STOP',
  'ZOHO_SYNC_PAUSED',
  'ZOHO_NOT_CONFIGURED',
])

function isAmbiguousWriteError(err) {
  const code = clean(err?.code)
  if (code === 'ZOHO_API_TIMEOUT' || code === 'ZOHO_API_NETWORK_ERROR' || code === 'ZOHO_WRITE_RESPONSE_WITHOUT_ID') return true
  if (NOT_SENT_CODES.has(code) || code.startsWith('AMAZON_PAYMENT_CLEARING')) return false
  const message = clean(err?.message)
  if (/not valid JSON/i.test(message)) return true
  if (/"code"\s*:\s*1000\b|code 1000\b/.test(message)) return true
  const status = Number(err?.httpStatus || err?.status || 0)
  if (status >= 500 || status === 408) return true
  if (code === 'ZOHO_API_ERROR' && (status >= 400 || err?.zohoResponse)) return false
  return true
}

function defaultZohoLookupDeps() {
  const payments = require('./amazonPaymentClearingZohoPaymentService')
  const books = require('../integrations/zoho/zohoBooksClient')
  return {
    listCustomerPayments: (params) => payments.listZohoCustomerPayments(params),
    getCustomerPayment: (id) => payments.getZohoCustomerPayment(id),
    listJournals: (params) => payments.listZohoManualJournals(params),
    getJournal: (id) => payments.getZohoManualJournal(id),
    listCreditNotes: (params) => books.listCreditNotes(params),
    listCreditNoteRefunds: (id) =>
      books.listCreditNoteRefunds(id, { source: 'amazon_payment_clearing_verify', skipCache: true }),
    getCreditNoteRefund: (creditNoteId, refundId) => books.getCreditNoteRefund(creditNoteId, refundId),
  }
}

module.exports = {
  AMOUNT_TOLERANCE,
  comparePayment,
  compareJournal,
  compareCreditNote,
  compareRefund,
  lookupCustomerPayment,
  lookupJournal,
  lookupCreditNote,
  lookupCreditNoteRefund,
  verifyRecordById,
  isAmbiguousWriteError,
  defaultZohoLookupDeps,
}
