'use strict'

/**
 * READ-ONLY dry run: Stripe payment → website order → Zoho invoice.
 * Never creates or updates anything in Zoho, Stripe or the website database.
 */

const { getStripeClearingConfig } = require('../../config/stripeClearing')
const defaultSources = require('./stripeClearingSources')
const { MATCH_STATUS, classifyStripePayment, pickMatchedInvoice } = require('./stripeClearingMatcher')
const { postingGate } = require('./stripeClearingGate')

const YMD = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

function parseRange({ from, to }, config) {
  if (!YMD.test(String(from || '')) || !YMD.test(String(to || ''))) {
    throw badRequest('from and to must be YYYY-MM-DD dates.')
  }
  const start = new Date(`${from}T00:00:00${config.timezoneOffset}`)
  const end = new Date(new Date(`${to}T00:00:00${config.timezoneOffset}`).getTime() + DAY_MS)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw badRequest('to must be on or after from.')
  }
  const days = Math.round((end - start) / DAY_MS)
  if (days > config.maxRangeDays) {
    throw badRequest(`Date range is limited to ${config.maxRangeDays} days.`)
  }
  return { start, end, days }
}

function parseLimit(limit, config) {
  if (limit == null || limit === '') return config.defaultRows
  const n = Math.trunc(Number(limit))
  if (!Number.isFinite(n) || n < 1) throw badRequest('limit must be a positive number.')
  return Math.min(n, config.maxRows)
}

function hasOpenBalance(invoice, config) {
  return invoice.status !== 'void' && invoice.status !== 'paid' && invoice.balance > config.amountTolerance
}

function publicStripe(stripe) {
  if (!stripe) return null
  return {
    paymentIntentId: stripe.paymentIntentId,
    chargeId: stripe.chargeId,
    amount: stripe.amountReceived,
    amountRefunded: stripe.amountRefunded,
    currency: stripe.currency,
    date: stripe.date,
    succeededAt: stripe.succeededAt || null,
    status: stripe.status,
    livemode: stripe.livemode === true,
    disputed: stripe.disputed === true,
  }
}

function publicWebsite(order) {
  if (!order) return null
  return {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    finalAmount: order.finalAmount,
    currency: order.currency,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    shopOrder: order.shopOrder,
    refundAmount: order.refundAmount,
    walletRedeemed: order.walletRedeemed,
    createdAt: order.createdAt,
  }
}

function publicZoho(invoice, order, config) {
  if (!invoice) return null
  const expectedCustomerId = order && order.shopOrder ? config.shopZohoCustomerId : config.websiteZohoCustomerId
  return {
    invoiceId: invoice.invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    reference: invoice.referenceNumber,
    total: invoice.total,
    balance: invoice.balance,
    status: invoice.status,
    currency: invoice.currencyCode,
    date: invoice.date,
    expectedCustomer: invoice.customerId === expectedCustomerId,
  }
}

function publicZohoPayment(p) {
  return {
    paymentId: p.paymentId,
    mode: p.paymentMode,
    reference: p.referenceNumber,
    amount: p.amount,
    date: p.date,
    account: p.accountName,
    invoiceNumbers: p.invoiceNumbers,
  }
}

function publicLocalClearing(record) {
  if (!record) return null
  return {
    status: record.status,
    zohoPaymentId: record.zohoPaymentId,
    attemptCount: record.attemptCount,
    lastError: record.lastError,
    postedAt: record.postedAt,
  }
}

async function defaultLocalClearings(paymentIntentIds) {
  const { query } = require('../../db')
  const store = require('./stripeClearingStore')
  return store.getByIntents({ query }, paymentIntentIds)
}

function stageError(stage, err) {
  if (err && !err.stage) err.stage = stage
  return err
}

/**
 * Classify one Stripe payment live. Zoho is only read for a single order whose
 * Stripe payment has not failed.
 * @param {{ stripe: object|null, websiteOrders: object[] }} item
 * @param {{ sources: object, config: object, localClearing?: object|null, zohoOpts?: object }} ctx
 */
async function evaluateItem(item, ctx) {
  const { sources, config, localClearing = null, zohoOpts = {} } = ctx
  const order = item.websiteOrders.length === 1 ? item.websiteOrders[0] : null
  const stripeFailed = item.stripe && item.stripe.status !== 'succeeded'
  const intentId = item.stripe ? item.stripe.paymentIntentId : order && order.stripePaymentIntentId
  let zohoInvoices = null
  let zohoIntentPayments = []
  let zohoCalls = 0

  if (order && order.orderNumber && !stripeFailed) {
    try {
      zohoInvoices = await sources.findZohoInvoicesByReference(order.orderNumber, zohoOpts)
      zohoCalls += 1
      const matched = pickMatchedInvoice(zohoInvoices, order.orderNumber)
      if (intentId && matched && hasOpenBalance(matched, config)) {
        zohoIntentPayments = await sources.findZohoPaymentsByReference(intentId, zohoOpts)
        zohoCalls += 1
      }
    } catch (err) {
      throw stageError('zoho', err)
    }
  }

  const match = classifyStripePayment({
    stripe: item.stripe,
    websiteOrders: item.websiteOrders,
    zohoInvoices,
    zohoIntentPayments,
    localClearingStatus: localClearing ? localClearing.status : null,
    config,
  })
  const invoice = order ? pickMatchedInvoice(zohoInvoices, order.orderNumber) : null
  return { stripe: item.stripe, order, invoice, intentId, zohoInvoices, zohoIntentPayments, match, zohoCalls }
}

/**
 * Rebuild the match for one PaymentIntent from live Stripe, website and Zoho data.
 * @param {string} paymentIntentId
 * @param {{ sources?: object, config?: object, localClearing?: object|null }} [deps]
 */
async function evaluatePaymentIntent(paymentIntentId, deps = {}) {
  const config = deps.config || getStripeClearingConfig()
  const sources = deps.sources || defaultSources
  if (!sources.stripeAvailable()) {
    const err = new Error('Stripe is not configured on this server.')
    err.code = 'STRIPE_NOT_CONFIGURED'
    err.status = 503
    throw stageError('stripe', err)
  }
  let stripe
  try {
    stripe = await sources.retrieveStripePaymentIntent(paymentIntentId)
  } catch (err) {
    throw stageError('stripe', err)
  }
  let orders
  try {
    orders = await sources.loadWebsiteOrdersByIntents([paymentIntentId], config.websiteCurrency)
  } catch (err) {
    throw stageError('website', err)
  }
  const websiteOrders = orders.filter((o) => o.stripePaymentIntentId === paymentIntentId)
  return evaluateItem(
    { stripe, websiteOrders },
    { sources, config, localClearing: deps.localClearing || null, zohoOpts: { critical: true, source: 'stripe_clearing_post_check' } },
  )
}

/**
 * @param {{ from: string, to: string, source?: 'stripe'|'website', limit?: number|string }} params
 * @param {{ sources?: object, config?: object, localClearings?: (paymentIntentIds: string[]) => Promise<Map<string, object>>, stripeConfig?: object }} [deps]
 */
async function runStripeClearingDryRun(params, deps = {}) {
  const config = deps.config || getStripeClearingConfig()
  const sources = deps.sources || defaultSources
  const loadLocalClearings = deps.localClearings || defaultLocalClearings
  const source = params.source === 'website' ? 'website' : 'stripe'
  const range = parseRange(params, config)
  const limit = parseLimit(params.limit, config)
  const stripeVerified = sources.stripeAvailable()
  const gate = postingGate(config, deps.stripeConfig)

  let items
  if (source === 'stripe') {
    const intents = await sources.listStripePaymentIntents({ start: range.start, end: range.end, limit })
    const orders = await sources.loadWebsiteOrdersByIntents(intents.map((pi) => pi.paymentIntentId), config.websiteCurrency)
    items = intents.map((stripe) => ({
      stripe,
      websiteOrders: orders.filter((o) => o.stripePaymentIntentId === stripe.paymentIntentId),
    }))
  } else {
    const orders = await sources.loadWebsiteStripeOrders({ start: range.start, end: range.end, limit }, config.websiteCurrency)
    items = []
    for (const order of orders) {
      const stripe = stripeVerified ? await sources.retrieveStripePaymentIntent(order.stripePaymentIntentId) : null
      items.push({ stripe, websiteOrders: [order] })
    }
  }

  const intentIds = items
    .map((item) => (item.stripe ? item.stripe.paymentIntentId : item.websiteOrders[0] && item.websiteOrders[0].stripePaymentIntentId))
    .filter(Boolean)
  const localClearings = await loadLocalClearings([...new Set(intentIds)])

  let zohoCalls = 0
  const rows = []
  for (const item of items) {
    const itemIntentId = item.stripe ? item.stripe.paymentIntentId : item.websiteOrders[0] && item.websiteOrders[0].stripePaymentIntentId
    const localClearing = (itemIntentId && localClearings.get(itemIntentId)) || null
    const evaluated = await evaluateItem(item, { sources, config, localClearing })
    zohoCalls += evaluated.zohoCalls
    const { order, invoice, zohoInvoices, zohoIntentPayments, match } = evaluated

    rows.push({
      stripe: publicStripe(item.stripe),
      stripePaymentIntentId: evaluated.intentId || null,
      website: publicWebsite(order),
      websiteOrderCount: item.websiteOrders.length,
      zoho: publicZoho(invoice, order, config),
      zohoCandidateCount: Array.isArray(zohoInvoices) ? zohoInvoices.length : null,
      zohoPaymentsWithIntentReference: zohoIntentPayments.map(publicZohoPayment),
      localClearing: publicLocalClearing(localClearing),
      result: match,
      canPost: gate.allowed && match.status === MATCH_STATUS.MATCHED_READY_TO_CLEAR && Boolean(item.stripe && item.stripe.livemode),
    })
  }

  const counts = {}
  for (const status of Object.values(MATCH_STATUS)) counts[status] = 0
  for (const row of rows) counts[row.result.status] += 1

  return {
    dryRun: true,
    source,
    range: { from: params.from, to: params.to, days: range.days, timezoneOffset: config.timezoneOffset },
    stripeVerified,
    posting: { enabled: gate.allowed, reasons: gate.reasons, depositAccountName: config.depositAccountName },
    limit,
    truncated: items.length >= limit,
    zohoReadCalls: zohoCalls,
    counts,
    rows,
  }
}

module.exports = {
  runStripeClearingDryRun,
  evaluatePaymentIntent,
  parseRange,
}
