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
    chargeRefundedMinor: sourceObject === 'charge' ? Number(source.amount_refunded) || 0 : 0,
    chargeDisputed: sourceObject === 'charge' ? source.disputed === true : false,
    createdAt: unixToIso(bt.created),
  }
}

async function listStripePayouts({ limit }) {
  const client = requireStripeClient()
  const page = await client.payouts.list({ limit })
  return page.data.map(mapPayout)
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

/**
 * Exact `reference_number` lookup on customer payments. Invoice detail does not list
 * payments in this org and `invoice_id` is ignored by the list, so the PaymentIntent
 * reference is the only reliable duplicate check.
 */
async function findZohoPaymentsByReference(reference, opts = {}) {
  const ref = clean(reference)
  if (!ref) return []
  const json = await zohoBooksJsonRequest(
    `${BOOKS_V3}/customerpayments`,
    new URLSearchParams({ reference_number: ref, per_page: '25' }),
    'GET',
    undefined,
    { source: opts.source || 'stripe_clearing_dry_run', skipCache: true, critical: opts.critical === true },
  )
  const payments = (Array.isArray(json && json.customerpayments) ? json.customerpayments : []).map((p) => ({
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
    const err = new Error(`Zoho ignored the payment reference filter for ${ref}; lookup is not exact.`)
    err.code = 'ZOHO_REFERENCE_FILTER_IGNORED'
    err.status = 502
    throw err
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
  const json = await zohoBooksJsonRequest(
    `${BOOKS_V3}/journals`,
    new URLSearchParams({ reference_number_contains: ref, per_page: '50', sort_column: 'journal_date' }),
    'GET',
    undefined,
    { source: opts.source || 'stripe_payout_preview', skipCache: true, critical: opts.critical === true },
  )
  const journals = (Array.isArray(json && json.journals) ? json.journals : []).map((j) => ({
    journalId: clean(j.journal_id),
    entryNumber: clean(j.entry_number),
    referenceNumber: clean(j.reference_number),
    journalDate: clean(j.journal_date),
    total: num(j.total),
    status: clean(j.status),
  }))
  if (journals.some((j) => !j.referenceNumber.includes(ref))) {
    const err = new Error(`Zoho ignored the journal reference filter for ${ref}; lookup is not exact.`)
    err.code = 'ZOHO_REFERENCE_FILTER_IGNORED'
    err.status = 502
    throw err
  }
  return journals.filter((j) => j.referenceNumber === ref)
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
  loadWebsiteOrdersByIntents,
  loadWebsiteStripeOrders,
  findZohoInvoicesByReference,
  findZohoPaymentsByReference,
  findZohoJournalsByReference,
  getZohoJournal,
  fetchZohoInvoiceById,
  ORDERS_BY_INTENT_SQL,
  STRIPE_ORDERS_IN_RANGE_SQL,
}
