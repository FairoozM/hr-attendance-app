'use strict'

/**
 * Read-only data sources for Tabby clearing: the website database (orders) and Zoho Books GETs.
 * Nothing here writes anywhere. The preview and posting services receive this object, so tests
 * substitute a fake with the same methods.
 */

const lifesmileWebsiteDb = require('../../db/lifesmileWebsiteDb')
const { zohoBooksJsonRequest } = require('../zohoApiClient')
const stripeSources = require('../stripeClearing/stripeClearingSources')
const zohoPayments = require('../amazonPaymentClearingZohoPaymentService')

const BOOKS_V3 = '/books/v3'
const SOURCE = 'tabby_clearing_preview'

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function lookupError(code, message) {
  const err = new Error(message)
  err.code = code
  err.status = 502
  return err
}

// ── Website orders ──────────────────────────────────────────────────────────

const ORDER_COLUMNS = `
  o.id::text AS id,
  o.invoice_number,
  o.order_status,
  o.payment_status,
  o.payment_method,
  o.shop_order,
  ROUND(o.total_amount::numeric, 2) AS total_amount,
  ROUND(COALESCE(o.refund_amount, 0)::numeric, 2) AS refund_amount,
  o.created_at,
  (o.deleted_at IS NOT NULL) AS deleted
`

function mapOrder(row) {
  return {
    orderId: clean(row.id),
    orderNumber: clean(row.invoice_number),
    orderStatus: clean(row.order_status),
    paymentStatus: clean(row.payment_status),
    paymentMethod: clean(row.payment_method),
    shopOrder: row.shop_order === true,
    finalAmount: num(row.total_amount),
    refundAmount: num(row.refund_amount),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    deleted: row.deleted === true,
  }
}

function assertWebsiteDb() {
  if (!lifesmileWebsiteDb.isConfigured()) {
    const err = new Error(`Website database is not configured (${lifesmileWebsiteDb.ENV_VAR}).`)
    err.code = 'WEBSITE_DB_NOT_CONFIGURED'
    err.status = 503
    throw err
  }
}

/** Orders by website `orders.id` (Tabby "Order Number"). */
async function loadWebsiteOrdersByIds(ids) {
  const list = [...new Set(ids.map(clean).filter(Boolean))]
  if (!list.length) return []
  assertWebsiteDb()
  const { rows } = await lifesmileWebsiteDb.readQuery(`SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.id::text = ANY($1::text[])`, [list])
  return rows.map(mapOrder)
}

/** Orders by website `orders.invoice_number` (Tabby "website order ID"). */
async function loadWebsiteOrdersByInvoiceNumbers(numbers) {
  const list = [...new Set(numbers.map(clean).filter(Boolean))]
  if (!list.length) return []
  assertWebsiteDb()
  const { rows } = await lifesmileWebsiteDb.readQuery(`SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.invoice_number = ANY($1::text[])`, [list])
  return rows.map(mapOrder)
}

// ── Zoho Books (GET only) ───────────────────────────────────────────────────

function zohoGet(path, params, opts = {}) {
  return zohoBooksJsonRequest(`${BOOKS_V3}${path}`, new URLSearchParams(params), 'GET', undefined, { source: opts.source || SOURCE, skipCache: true, critical: opts.critical === true })
}

function mapBankTransaction(t) {
  return {
    transactionId: clean(t.transaction_id),
    date: clean(t.date),
    amount: num(t.amount),
    transactionType: clean(t.transaction_type),
    debitOrCredit: clean(t.debit_or_credit),
    status: clean(t.status),
    referenceNumber: clean(t.reference_number),
    offsetAccountName: clean(t.offset_account_name),
    offsetAccountId: clean(t.offset_account_id),
    description: clean(t.description),
  }
}

const BANK_MAX_PAGES = 25

/**
 * Every transaction on one bank/cash account dated start..end; incomplete lists fail.
 * Zoho ignores date_start/date_end on /banktransactions but honours the date sort, so pages are read
 * newest-first until they pass dateStart and the window is filtered here.
 */
async function listBankTransactionsWith(get, accountId, dateStart, dateEnd) {
  const out = []
  let previousDate = null
  for (let page = 1; page <= BANK_MAX_PAGES; page++) {
    const json = await get('/banktransactions', { account_id: accountId, date_start: dateStart, date_end: dateEnd, filter_by: 'Status.All', per_page: '200', page: String(page), sort_column: 'date', sort_order: 'D' })
    if (!json || !Array.isArray(json.banktransactions)) throw lookupError('ZOHO_LOOKUP_MALFORMED', 'Zoho bank transactions answered without a "banktransactions" list.')
    const rows = json.banktransactions.map(mapBankTransaction)
    for (const t of rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw lookupError('ZOHO_LOOKUP_MALFORMED', `Zoho bank transaction ${t.transactionId || '?'} has no usable date.`)
      if (previousDate && t.date > previousDate) throw lookupError('ZOHO_SORT_IGNORED', 'Zoho did not return bank transactions newest-first; the date window cannot be read reliably.')
      previousDate = t.date
      if (t.date >= dateStart && t.date <= dateEnd) out.push(t)
    }
    const reachedStart = previousDate !== null && previousDate < dateStart
    if (reachedStart || !(json.page_context && json.page_context.has_more_page)) return out
  }
  throw lookupError('ZOHO_LOOKUP_INCOMPLETE', `Read ${BANK_MAX_PAGES * 200} bank transactions without reaching ${dateStart}; lookup is incomplete.`)
}

function listBankTransactions(accountId, dateStart, dateEnd, opts = {}) {
  return listBankTransactionsWith((p, params) => zohoGet(p, params, opts), accountId, dateStart, dateEnd)
}

async function getBankTransaction(transactionId, opts = {}) {
  const id = clean(transactionId)
  if (!id) return null
  try {
    const json = await zohoGet(`/banktransactions/${encodeURIComponent(id)}`, {}, opts)
    const t = json && (json.banktransaction || json.bank_transaction)
    if (!t) return null
    return {
      ...mapBankTransaction(t),
      fromAccountId: clean(t.from_account_id),
      toAccountId: clean(t.to_account_id),
      fromAccountName: clean(t.from_account_name),
      toAccountName: clean(t.to_account_name),
    }
  } catch (err) {
    if (Number(err && err.httpStatus) === 404) return null
    throw err
  }
}

function createTabbySources() {
  return {
    loadWebsiteOrdersByIds,
    loadWebsiteOrdersByInvoiceNumbers,
    findInvoicesByReference: (ref) => stripeSources.findZohoInvoicesByReference(ref, { source: SOURCE }),
    listInvoicePayments: (invoiceId, opts) => stripeSources.listZohoInvoicePayments(invoiceId, { source: SOURCE, ...opts }),
    findPaymentsByReference: (ref, opts) => stripeSources.findZohoPaymentsByReference(ref, { source: SOURCE, ...opts }),
    getCustomerPayment: (id) => zohoPayments.getZohoCustomerPayment(id, { source: SOURCE }),
    findJournalsByReference: (ref, opts) => stripeSources.findZohoJournalsByReference(ref, { source: SOURCE, ...opts }),
    listJournalsInRange: (start, end, opts) => stripeSources.listZohoJournalsInRange(start, end, { source: SOURCE, ...opts }),
    getJournal: (id, opts) => stripeSources.getZohoJournal(id, { source: SOURCE, ...opts }),
    findCreditNotesForOrder: (orderNumber, customerId, opts) => stripeSources.findZohoCreditNotesForOrder(orderNumber, customerId, { source: SOURCE, ...opts }),
    getCreditNote: (id, opts) => stripeSources.getZohoCreditNote(id, { source: SOURCE, ...opts }),
    listCreditNoteRefunds: (id, opts) => stripeSources.listZohoCreditNoteRefunds(id, { source: SOURCE, ...opts }),
    getCreditNoteRefund: (id, rid, opts) => stripeSources.getZohoCreditNoteRefund(id, rid, { source: SOURCE, ...opts }),
    listBankTransactions,
    getBankTransaction,
    listChartAccounts: () => zohoPayments.listZohoChartAccounts(),
  }
}

module.exports = { createTabbySources, mapOrder, mapBankTransaction, listBankTransactionsWith }
