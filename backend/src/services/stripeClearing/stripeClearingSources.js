'use strict'

/**
 * Read-only data sources for Stripe clearing. Nothing here writes to Stripe,
 * the website database or Zoho.
 */

const stripeConfig = require('../../config/stripe')
const lifesmileWebsiteDb = require('../../db/lifesmileWebsiteDb')
const { zohoBooksJsonRequest } = require('../zohoApiClient')

const BOOKS_V3 = '/books/v3'
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'])

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function fromMinor(amount, currency) {
  const code = clean(currency).toUpperCase()
  return ZERO_DECIMAL.has(code) ? num(amount) : Math.round(num(amount)) / 100
}

// ── Stripe ──────────────────────────────────────────────────────────────────

function mapPaymentIntent(pi) {
  const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
  const currency = clean(pi.currency).toUpperCase()
  return {
    paymentIntentId: pi.id,
    chargeId: charge ? charge.id : clean(pi.latest_charge) || null,
    status: pi.status,
    amount: fromMinor(pi.amount, currency),
    amountReceived: fromMinor(pi.amount_received, currency),
    amountRefunded: charge ? fromMinor(charge.amount_refunded, currency) : 0,
    disputed: Boolean(charge && charge.disputed),
    currency,
    date: pi.created ? new Date(pi.created * 1000).toISOString() : null,
    // The successful charge's timestamp is the payment date; the PaymentIntent may be older.
    succeededAt: charge && charge.created ? new Date(charge.created * 1000).toISOString() : null,
    livemode: pi.livemode === true,
  }
}

function stripeAvailable() {
  return Boolean(stripeConfig.getStripeClient())
}

async function listStripePaymentIntents({ start, end, limit }) {
  const client = stripeConfig.getStripeClient()
  if (!client) {
    const err = new Error('Stripe secret key is not configured on this server.')
    err.code = 'STRIPE_NOT_CONFIGURED'
    err.status = 503
    throw err
  }
  const out = []
  const params = {
    created: { gte: Math.floor(start.getTime() / 1000), lt: Math.floor(end.getTime() / 1000) },
    limit: 100,
    expand: ['data.latest_charge'],
  }
  for await (const pi of client.paymentIntents.list(params)) {
    out.push(mapPaymentIntent(pi))
    if (out.length >= limit) break
  }
  return out
}

async function retrieveStripePaymentIntent(paymentIntentId) {
  const client = stripeConfig.getStripeClient()
  if (!client) return null
  try {
    const pi = await client.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
    return mapPaymentIntent(pi)
  } catch (err) {
    if (err && err.statusCode === 404) return null
    throw err
  }
}

function requireStripeClient() {
  const client = stripeConfig.getStripeClient()
  if (!client) {
    const err = new Error('Stripe secret key is not configured on this server.')
    err.code = 'STRIPE_NOT_CONFIGURED'
    err.status = 503
    throw err
  }
  return client
}

function unixToIso(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString() : null
}

function mapPayout(po) {
  return {
    payoutId: po.id,
    status: po.status,
    amountMinor: po.amount,
    currency: clean(po.currency).toUpperCase(),
    arrivalDate: unixToIso(po.arrival_date),
    createdAt: unixToIso(po.created),
    automatic: po.automatic === true,
    livemode: po.livemode === true,
  }
}

/** Amounts stay in minor units so payout totals add up exactly. */
function mapBalanceTransaction(bt) {
  const source = bt.source && typeof bt.source === 'object' ? bt.source : null
  const sourceObject = source ? source.object : null
  let chargeId = null
  let paymentIntentId = null
  if (sourceObject === 'charge') {
    chargeId = source.id
    paymentIntentId = clean(source.payment_intent) || null
  } else if (source && (sourceObject === 'refund' || sourceObject === 'dispute')) {
    chargeId = clean(source.charge) || null
    paymentIntentId = clean(source.payment_intent) || null
  }
  return {
    balanceTransactionId: bt.id,
    type: bt.type,
    reportingCategory: bt.reporting_category || null,
    status: bt.status,
    currency: clean(bt.currency).toUpperCase(),
    exchangeRate: bt.exchange_rate == null ? null : bt.exchange_rate,
    amountMinor: bt.amount,
    feeMinor: bt.fee,
    netMinor: bt.net,
    description: bt.description || null,
    sourceId: source ? source.id : clean(bt.source) || null,
    sourceObject,
    chargeId,
    paymentIntentId,
    // Current charge state, not the state when the payout was made.
    chargeRefundedMinor: sourceObject === 'charge' ? Number(source.amount_refunded) || 0 : 0,
    chargeDisputed: sourceObject === 'charge' ? source.disputed === true : false,
    chargeStatus: sourceObject === 'charge' ? clean(source.status) || null : null,
    chargeFullyRefunded: sourceObject === 'charge' ? source.refunded === true : false,
    refundStatus: sourceObject === 'refund' ? clean(source.status) || null : null,
    createdAt: unixToIso(bt.created),
  }
}

function balanceTransactionId(value) {
  if (!value) return null
  return typeof value === 'string' ? value : clean(value.id) || null
}

/** Every refund on one charge with its own balance transaction (read-only). */
async function listChargeRefunds(chargeId) {
  const client = requireStripeClient()
  const out = []
  for await (const r of client.refunds.list({ charge: chargeId, limit: 100 })) {
    const btId = balanceTransactionId(r.balance_transaction)
    let balanceTransaction = null
    if (btId) {
      const bt = await client.balanceTransactions.retrieve(btId)
      balanceTransaction = {
        balanceTransactionId: bt.id,
        type: bt.type,
        currency: clean(bt.currency).toUpperCase(),
        amountMinor: bt.amount,
        feeMinor: bt.fee,
        netMinor: bt.net,
      }
    }
    out.push({
      refundId: r.id,
      chargeId: typeof r.charge === 'string' ? r.charge : clean(r.charge && r.charge.id) || null,
      paymentIntentId: typeof r.payment_intent === 'string' ? r.payment_intent : clean(r.payment_intent && r.payment_intent.id) || null,
      amountMinor: r.amount,
      currency: clean(r.currency).toUpperCase(),
      status: clean(r.status),
      createdAt: unixToIso(r.created),
      balanceTransaction,
    })
  }
  return out
}

/** The latest `limit` payouts of every status, newest first (auto-paginates past 100). */
async function listStripePayouts({ limit }) {
  const client = requireStripeClient()
  const out = []
  for await (const po of client.payouts.list({ limit: Math.min(limit, 100) })) {
    out.push(mapPayout(po))
    if (out.length >= limit) break
  }
  return out
}

async function retrieveStripePayout(payoutId) {
  const client = requireStripeClient()
  try {
    return mapPayout(await client.payouts.retrieve(payoutId))
  } catch (err) {
    if (err && err.statusCode === 404) return null
    throw err
  }
}

async function listPayoutBalanceTransactions(payoutId) {
  const client = requireStripeClient()
  const out = []
  for await (const bt of client.balanceTransactions.list({ payout: payoutId, limit: 100, expand: ['data.source'] })) {
    out.push(mapBalanceTransaction(bt))
  }
  return out
}

// ── Website orders (read-only DB) ───────────────────────────────────────────

const ORDER_COLUMNS = `
  o.id,
  o.invoice_number,
  o.order_status,
  o.payment_status,
  o.payment_method,
  o.stripe_payment_intent_id,
  o.shop_order,
  ROUND(o.total_amount::numeric, 2) AS total_amount,
  ROUND(COALESCE(o.refund_amount, 0)::numeric, 2) AS refund_amount,
  ROUND(COALESCE(o.wallet_redeemed, 0)::numeric, 2) AS wallet_redeemed,
  o.created_at,
  (o.deleted_at IS NOT NULL) AS deleted,
  (
    SELECT COUNT(*)::int FROM orders d
    WHERE d.invoice_number = o.invoice_number AND d.deleted_at IS NULL AND d.id <> o.id
  ) AS same_number_count
`

const ORDERS_BY_INTENT_SQL = `
SELECT ${ORDER_COLUMNS}
FROM orders o
WHERE o.stripe_payment_intent_id = ANY($1::text[])
`

const STRIPE_ORDERS_IN_RANGE_SQL = `
SELECT ${ORDER_COLUMNS}
FROM orders o
WHERE o.stripe_payment_intent_id IS NOT NULL
  AND o.deleted_at IS NULL
  AND o.created_at >= $1
  AND o.created_at < $2
ORDER BY o.created_at ASC, o.id ASC
LIMIT $3
`

function mapWebsiteOrder(row, currency) {
  return {
    orderId: String(row.id),
    orderNumber: clean(row.invoice_number),
    orderStatus: clean(row.order_status),
    paymentStatus: clean(row.payment_status),
    paymentMethod: clean(row.payment_method),
    stripePaymentIntentId: clean(row.stripe_payment_intent_id),
    shopOrder: row.shop_order === true,
    finalAmount: num(row.total_amount),
    refundAmount: num(row.refund_amount),
    walletRedeemed: num(row.wallet_redeemed),
    currency,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    deleted: row.deleted === true,
    sameNumberCount: Number(row.same_number_count) || 0,
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

async function loadWebsiteOrdersByIntents(paymentIntentIds, currency) {
  if (paymentIntentIds.length === 0) return []
  assertWebsiteDb()
  const { rows } = await lifesmileWebsiteDb.readQuery(ORDERS_BY_INTENT_SQL, [paymentIntentIds])
  return rows.map((row) => mapWebsiteOrder(row, currency))
}

async function loadWebsiteStripeOrders({ start, end, limit }, currency) {
  assertWebsiteDb()
  const { rows } = await lifesmileWebsiteDb.readQuery(STRIPE_ORDERS_IN_RANGE_SQL, [start, end, limit])
  return rows.map((row) => mapWebsiteOrder(row, currency))
}

// ── Zoho Books (existing client, GET only) ──────────────────────────────────

function mapZohoInvoice(inv) {
  return {
    invoiceId: clean(inv.invoice_id),
    invoiceNumber: clean(inv.invoice_number),
    referenceNumber: clean(inv.reference_number),
    customerId: clean(inv.customer_id),
    status: clean(inv.status),
    total: num(inv.total),
    balance: num(inv.balance),
    currencyCode: clean(inv.currency_code).toUpperCase(),
    date: clean(inv.date),
  }
}

/**
 * Exact `reference_number` lookup. Zoho silently drops the reference filter when
 * `filter_by` is also sent and returns every invoice, so `filter_by` must stay off
 * and any row with a different reference fails the lookup instead of being ignored.
 */
async function findZohoInvoicesByReference(reference, opts = {}) {
  const ref = clean(reference)
  if (!ref) return []
  const json = await zohoBooksJsonRequest(
    `${BOOKS_V3}/invoices`,
    new URLSearchParams({ reference_number: ref, per_page: '25' }),
    'GET',
    undefined,
    { source: opts.source || 'stripe_clearing_dry_run', skipCache: true, critical: opts.critical === true },
  )
  const invoices = (Array.isArray(json && json.invoices) ? json.invoices : []).map(mapZohoInvoice)
  if (invoices.some((inv) => inv.referenceNumber !== ref)) {
    const err = new Error(`Zoho ignored the reference filter for ${ref}; lookup is not exact.`)
    err.code = 'ZOHO_REFERENCE_FILTER_IGNORED'
    err.status = 502
    throw err
  }
  return invoices
}

/** Live invoice by ID, or null when Zoho no longer has it. */
async function fetchZohoInvoiceById(invoiceId) {
  const id = clean(invoiceId)
  if (!id) return null
  try {
    const json = await zohoBooksJsonRequest(
      `${BOOKS_V3}/invoices/${encodeURIComponent(id)}`,
      new URLSearchParams(),
      'GET',
      undefined,
      { source: 'stripe_clearing_post_check', skipCache: true, critical: true },
    )
    return json && json.invoice ? mapZohoInvoice(json.invoice) : null
  } catch (err) {
    if (Number(err && err.httpStatus) === 404) return null
    throw err
  }
}

const LIST_PAGE_SIZE = 200
const LIST_MAX_PAGES = 5

function lookupError(code, message) {
  const err = new Error(message)
  err.code = code
  err.status = 502
  return err
}

/**
 * Every row of one Zoho list, or an error: a response without the expected array is malformed
 * and more pages than the cap is incomplete. A partial list would read as "not in Zoho", which
 * recovery must never conclude from. Responses without `page_context` are single-page lists.
 * `opts.perPage` / `opts.maxPages` exist for tests and read-only probes.
 */
async function zohoListAll(path, params, key, opts = {}) {
  const perPage = String(opts.perPage || LIST_PAGE_SIZE)
  const maxPages = opts.maxPages || LIST_MAX_PAGES
  const out = []
  for (let page = 1; page <= maxPages; page++) {
    const json = await zohoBooksJsonRequest(
      `${BOOKS_V3}${path}`,
      new URLSearchParams({ ...params, per_page: perPage, page: String(page) }),
      'GET',
      undefined,
      { source: opts.source || 'stripe_payout_preview', skipCache: true, critical: opts.critical === true },
    )
    if (!json || !Array.isArray(json[key])) throw lookupError('ZOHO_LOOKUP_MALFORMED', `Zoho ${path} answered without a "${key}" list; lookup is not reliable.`)
    out.push(...json[key])
    if (!(json.page_context && json.page_context.has_more_page)) return out
  }
  throw lookupError('ZOHO_LOOKUP_INCOMPLETE', `Zoho ${path} has more than ${maxPages} page(s) of results; lookup is incomplete.`)
}

/**
 * Exact `reference_number` lookup on customer payments. Invoice detail does not list
 * payments in this org and `invoice_id` is ignored by the list, so the PaymentIntent
 * reference is the only reliable duplicate check.
 */
async function findZohoPaymentsByReference(reference, opts = {}) {
  const ref = clean(reference)
  if (!ref) return []
  const rows = await zohoListAll('/customerpayments', { reference_number: ref }, 'customerpayments', { ...opts, source: opts.source || 'stripe_clearing_dry_run' })
  const payments = rows.map((p) => ({
    paymentId: clean(p.payment_id),
    paymentMode: clean(p.payment_mode),
    referenceNumber: clean(p.reference_number),
    amount: num(p.amount),
    date: clean(p.date),
    customerId: clean(p.customer_id),
    accountId: clean(p.account_id),
    accountName: clean(p.account_name),
    invoiceNumbers: clean(p.invoice_numbers),
  }))
  if (payments.some((p) => p.referenceNumber !== ref)) {
    throw lookupError('ZOHO_REFERENCE_FILTER_IGNORED', `Zoho ignored the payment reference filter for ${ref}; lookup is not exact.`)
  }
  return payments
}

/**
 * Manual journals whose reference equals `reference`. Zoho only offers a "contains"
 * filter for journals, so the exact match is applied here; a row that does not even
 * contain the reference means the filter was ignored and the lookup fails.
 */
async function findZohoJournalsByReference(reference, opts = {}) {
  const ref = clean(reference)
  if (!ref) return []
  const rows = await zohoListAll('/journals', { reference_number_contains: ref, sort_column: 'journal_date' }, 'journals', opts)
  const journals = rows.map((j) => ({
    journalId: clean(j.journal_id),
    entryNumber: clean(j.entry_number),
    referenceNumber: clean(j.reference_number),
    journalDate: clean(j.journal_date),
    total: num(j.total),
    status: clean(j.status),
  }))
  if (journals.some((j) => !j.referenceNumber.includes(ref))) {
    throw lookupError('ZOHO_REFERENCE_FILTER_IGNORED', `Zoho ignored the journal reference filter for ${ref}; lookup is not exact.`)
  }
  return journals.filter((j) => j.referenceNumber === ref)
}

const JOURNAL_RANGE_MAX_PAGES = 10

/**
 * Every journal dated dateStart..dateEnd (YYYY-MM-DD), without line items. A row outside the
 * range means Zoho ignored the filter, and a list longer than the page cap is incomplete;
 * both fail the lookup instead of returning a partial answer.
 */
async function listZohoJournalsInRange(dateStart, dateEnd, opts = {}) {
  const out = []
  const maxPages = opts.maxPages || JOURNAL_RANGE_MAX_PAGES
  const perPage = opts.perPage || 200
  for (let page = 1; page <= maxPages; page++) {
    const json = await zohoBooksJsonRequest(
      `${BOOKS_V3}/journals`,
      new URLSearchParams({ date_start: dateStart, date_end: dateEnd, per_page: String(perPage), page: String(page), sort_column: 'journal_date', sort_order: 'A' }),
      'GET',
      undefined,
      { source: opts.source || 'stripe_payout_preview', skipCache: true, critical: opts.critical === true },
    )
    if (!json || !Array.isArray(json.journals)) throw lookupError('ZOHO_LOOKUP_MALFORMED', `Zoho journals ${dateStart}..${dateEnd} answered without a "journals" list; lookup is not reliable.`)
    const rows = json.journals.map((j) => ({
      journalId: clean(j.journal_id),
      entryNumber: clean(j.entry_number),
      referenceNumber: clean(j.reference_number),
      notes: clean(j.notes),
      journalDate: clean(j.journal_date),
      total: num(j.total),
      status: clean(j.status),
    }))
    if (rows.some((j) => j.journalDate < dateStart || j.journalDate > dateEnd)) {
      const err = new Error(`Zoho ignored the journal date filter ${dateStart}..${dateEnd}; lookup is not exact.`)
      err.code = 'ZOHO_DATE_FILTER_IGNORED'
      err.status = 502
      throw err
    }
    out.push(...rows)
    if (!(json && json.page_context && json.page_context.has_more_page)) return out
  }
  const err = new Error(`More than ${maxPages * perPage} Zoho journals are dated ${dateStart}..${dateEnd}; lookup is incomplete.`)
  err.code = 'ZOHO_JOURNAL_RANGE_TOO_LARGE'
  err.status = 502
  throw err
}

/** Journal with its line items, or null when Zoho no longer has it. */
async function getZohoJournal(journalId, opts = {}) {
  const id = clean(journalId)
  if (!id) return null
  try {
    const json = await zohoBooksJsonRequest(
      `${BOOKS_V3}/journals/${encodeURIComponent(id)}`,
      new URLSearchParams(),
      'GET',
      undefined,
      { source: opts.source || 'stripe_payout_preview', skipCache: true, critical: opts.critical === true },
    )
    const j = json && json.journal
    if (!j) return null
    return {
      journalId: clean(j.journal_id),
      referenceNumber: clean(j.reference_number),
      journalDate: clean(j.journal_date),
      status: clean(j.status),
      lineItems: (Array.isArray(j.line_items) ? j.line_items : []).map((l) => ({
        accountId: clean(l.account_id),
        accountCode: clean(l.account_code),
        accountName: clean(l.account_name),
        debitOrCredit: clean(l.debit_or_credit),
        amount: num(l.amount),
        customerId: clean(l.customer_id),
      })),
    }
  } catch (err) {
    if (Number(err && err.httpStatus) === 404) return null
    throw err
  }
}

function zohoGet(path, params, opts) {
  return zohoBooksJsonRequest(
    `${BOOKS_V3}${path}`,
    new URLSearchParams(params),
    'GET',
    undefined,
    { source: opts.source || 'stripe_payout_preview', skipCache: true, critical: opts.critical === true },
  )
}

async function orNullOn404(load) {
  try {
    return await load()
  } catch (err) {
    if (Number(err && err.httpStatus) === 404) return null
    throw err
  }
}

function mapZohoLine(l) {
  return {
    lineItemId: clean(l.line_item_id),
    itemId: clean(l.item_id),
    invoiceItemId: clean(l.invoice_item_id),
    name: clean(l.name),
    sku: clean(l.sku),
    quantity: num(l.quantity),
    rate: num(l.rate),
    itemTotal: num(l.item_total),
  }
}

function mapZohoCreditNote(n) {
  return {
    creditNoteId: clean(n.creditnote_id),
    creditNoteNumber: clean(n.creditnote_number),
    referenceNumber: clean(n.reference_number),
    customerId: clean(n.customer_id),
    status: clean(n.status),
    date: clean(n.date),
    total: num(n.total),
    balance: num(n.balance),
    currencyCode: clean(n.currency_code).toUpperCase(),
  }
}

/**
 * Credit notes numbered after a website order ("20717", "20717-2", never "207171") for one
 * customer. `creditnote_number_startswith` is exact in this org; a returned row that does
 * not start with the order number or belongs to another customer means the filter was ignored.
 */
async function findZohoCreditNotesForOrder(orderNumber, customerId, opts = {}) {
  const order = clean(orderNumber)
  const customer = clean(customerId)
  if (!order || !customer) return []
  const notes = (await zohoListAll('/creditnotes', { creditnote_number_startswith: order, customer_id: customer }, 'creditnotes', opts)).map(mapZohoCreditNote)
  if (notes.some((n) => !n.creditNoteNumber.startsWith(order) || n.customerId !== customer)) {
    const err = new Error(`Zoho ignored the credit note filter for order ${order}; lookup is not exact.`)
    err.code = 'ZOHO_REFERENCE_FILTER_IGNORED'
    err.status = 502
    throw err
  }
  return notes.filter((n) => n.creditNoteNumber === order || /^\D/.test(n.creditNoteNumber.slice(order.length)))
}

/** Credit note with its invoice link and lines, or null when Zoho no longer has it. */
async function getZohoCreditNote(creditNoteId, opts = {}) {
  const id = clean(creditNoteId)
  if (!id) return null
  return orNullOn404(async () => {
    const json = await zohoGet(`/creditnotes/${encodeURIComponent(id)}`, {}, opts)
    const n = json && json.creditnote
    if (!n) return null
    return {
      ...mapZohoCreditNote(n),
      invoiceId: clean(n.invoice_id),
      invoiceNumber: clean(n.invoice_number),
      salesReturnNumber: clean(n.salesreturn_number),
      totalRefunded: num(n.total_refunded_amount),
      totalCreditsUsed: num(n.total_credits_used),
      lineItems: (Array.isArray(n.line_items) ? n.line_items : []).map(mapZohoLine),
    }
  })
}

/** Refunds already recorded against one credit note (list shape; no account). */
async function listZohoCreditNoteRefunds(creditNoteId, opts = {}) {
  const id = clean(creditNoteId)
  if (!id) return []
  const rows = await zohoListAll(`/creditnotes/${encodeURIComponent(id)}/refunds`, {}, 'creditnote_refunds', opts)
  return rows.map((r) => ({
    creditNoteRefundId: clean(r.creditnote_refund_id),
    creditNoteId: clean(r.creditnote_id) || id,
    date: clean(r.date),
    referenceNumber: clean(r.reference_number),
    amount: num(r.amount_bcy != null ? r.amount_bcy : r.amount),
    refundMode: clean(r.refund_mode),
  }))
}

/** One credit note refund with the account it was paid from, or null when missing. */
async function getZohoCreditNoteRefund(creditNoteId, creditNoteRefundId, opts = {}) {
  const id = clean(creditNoteId)
  const rid = clean(creditNoteRefundId)
  if (!id || !rid) return null
  return orNullOn404(async () => {
    const json = await zohoGet(`/creditnotes/${encodeURIComponent(id)}/refunds/${encodeURIComponent(rid)}`, {}, opts)
    const r = json && json.creditnote_refund
    if (!r) return null
    return {
      creditNoteRefundId: clean(r.creditnote_refund_id),
      creditNoteId: clean(r.creditnote_id),
      date: clean(r.date),
      referenceNumber: clean(r.reference_number),
      amount: num(r.amount),
      refundMode: clean(r.refund_mode),
      fromAccountId: clean(r.from_account_id),
      fromAccountName: clean(r.from_account_name),
      customerId: clean(r.customer_id),
    }
  })
}

/**
 * Payments applied to one invoice, read from the invoice itself (not the payment search index).
 * Zoho returns the whole list without `page_context`. A missing invoice or a malformed answer is
 * an error, never "no payments": recovery cannot prove a payment absent from an unreadable invoice.
 */
async function listZohoInvoicePayments(invoiceId, opts = {}) {
  const id = clean(invoiceId)
  if (!id) throw lookupError('ZOHO_LOOKUP_INCOMPLETE', 'An allocated invoice has no Zoho invoice ID; its payments cannot be read.')
  const json = await orNullOn404(() => zohoGet(`/invoices/${encodeURIComponent(id)}/payments`, {}, opts))
  if (json === null) throw lookupError('ZOHO_INVOICE_NOT_FOUND', `Zoho invoice ${id} was not found; its payments cannot be read.`)
  if (!json || !Array.isArray(json.payments)) throw lookupError('ZOHO_LOOKUP_MALFORMED', `Zoho invoice ${id} payments answered without a "payments" list; lookup is not reliable.`)
  if (json.page_context && json.page_context.has_more_page) throw lookupError('ZOHO_LOOKUP_INCOMPLETE', `Zoho invoice ${id} has more payments than one page; lookup is incomplete.`)
  return json.payments.map((p) => ({
    paymentId: clean(p.payment_id),
    invoiceId: clean(p.invoice_id) || id,
    referenceNumber: clean(p.reference_number),
    amount: num(p.amount),
    date: clean(p.date),
  }))
}

/** Invoice with its lines, or null when Zoho no longer has it. */
async function getZohoInvoiceDetail(invoiceId, opts = {}) {
  const id = clean(invoiceId)
  if (!id) return null
  return orNullOn404(async () => {
    const json = await zohoGet(`/invoices/${encodeURIComponent(id)}`, {}, opts)
    const inv = json && json.invoice
    if (!inv) return null
    return { ...mapZohoInvoice(inv), lineItems: (Array.isArray(inv.line_items) ? inv.line_items : []).map(mapZohoLine) }
  })
}

module.exports = {
  mapPaymentIntent,
  mapWebsiteOrder,
  stripeAvailable,
  listStripePaymentIntents,
  retrieveStripePaymentIntent,
  mapPayout,
  mapBalanceTransaction,
  listStripePayouts,
  retrieveStripePayout,
  listPayoutBalanceTransactions,
  listChargeRefunds,
  loadWebsiteOrdersByIntents,
  loadWebsiteStripeOrders,
  findZohoInvoicesByReference,
  findZohoPaymentsByReference,
  findZohoJournalsByReference,
  listZohoJournalsInRange,
  getZohoJournal,
  fetchZohoInvoiceById,
  findZohoCreditNotesForOrder,
  getZohoCreditNote,
  listZohoCreditNoteRefunds,
  getZohoCreditNoteRefund,
  getZohoInvoiceDetail,
  listZohoInvoicePayments,
  ORDERS_BY_INTENT_SQL,
  STRIPE_ORDERS_IN_RANGE_SQL,
}
