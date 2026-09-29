'use strict'

/**
 * Pure classification of one Stripe payment against its website order and Zoho invoice.
 * No I/O. Only MATCHED_READY_TO_CLEAR is eligible for automatic clearing.
 */

const MATCH_STATUS = Object.freeze({
  MATCHED_READY_TO_CLEAR: 'MATCHED_READY_TO_CLEAR',
  ALREADY_CLEARED: 'ALREADY_CLEARED',
  NO_WEBSITE_ORDER: 'NO_WEBSITE_ORDER',
  NO_ZOHO_INVOICE: 'NO_ZOHO_INVOICE',
  MULTIPLE_ZOHO_INVOICES: 'MULTIPLE_ZOHO_INVOICES',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  STRIPE_NOT_SUCCEEDED: 'STRIPE_NOT_SUCCEEDED',
  ZOHO_BALANCE_MISMATCH: 'ZOHO_BALANCE_MISMATCH',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  // Website and Zoho agree, but the Stripe side could not be read (no API key).
  STRIPE_NOT_VERIFIED: 'STRIPE_NOT_VERIFIED',
})

const WEBSITE_CANCELLED = new Set(['cancelled'])
// Operational return statuses: goods came back; they say nothing about money going back.
const WEBSITE_RETURN_STATUSES = new Set(['returned', 'partiallyReturned'])
const WEBSITE_REVIEW = new Set(['returnRequested'])
// Zoho may already hold a payment for these; only reference-based recovery may resolve them.
const UNRESOLVED_LOCAL_STATUSES = new Set(['POSTING', 'FAILED_NEEDS_REVIEW'])

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function differs(a, b, tolerance) {
  return Math.abs(round2(a) - round2(b)) > tolerance
}

function result(status, reason, amountDifference = {}) {
  return {
    status,
    reason,
    amountDifference,
    eligibleForClearing: status === MATCH_STATUS.MATCHED_READY_TO_CLEAR,
  }
}

function expectedZohoCustomerId(order, config) {
  return order.shopOrder ? config.shopZohoCustomerId : config.websiteZohoCustomerId
}

/**
 * Why the order's Zoho credit notes show a financial reversal of this invoice, or null when
 * every live credit note is still fully open (not applied, not refunded, not used elsewhere).
 */
function returnCreditNoteProblem(creditNotes, invoice, tolerance) {
  const live = creditNotes.filter((n) => n.status !== 'void')
  for (const n of live) {
    const label = `Zoho credit note ${n.creditNoteNumber}`
    if (clean(n.invoiceId) && clean(n.invoiceId) !== invoice.invoiceId) return `${label} is linked to invoice ${n.invoiceNumber || n.invoiceId}, not ${invoice.invoiceNumber}.`
    if ((Number(n.totalCreditsUsed) || 0) > tolerance) return `${label} has ${round2(n.totalCreditsUsed)} applied as credit.`
    if ((Number(n.totalRefunded) || 0) > tolerance) return `${label} has ${round2(n.totalRefunded)} refunded.`
    if (n.status === 'closed' || differs(n.balance, n.total, tolerance)) return `${label} has ${round2(n.balance)} of ${round2(n.total)} left; part of it was used or refunded.`
  }
  const creditedTotal = live.reduce((s, n) => s + (Number(n.total) || 0), 0)
  if (creditedTotal > invoice.total + tolerance) return `Zoho credit notes total ${round2(creditedTotal)}, more than invoice ${invoice.invoiceNumber} ${round2(invoice.total)}.`
  return null
}

/**
 * @param {object} input
 * @param {null|{ paymentIntentId: string, status: string, amountReceived: number, amountRefunded: number, currency: string }} input.stripe
 * @param {Array<{ orderId: string, orderNumber: string, orderStatus: string, paymentStatus: string, finalAmount: number, refundAmount: number, stripePaymentIntentId: string, shopOrder: boolean, deleted: boolean, sameNumberCount: number }>} input.websiteOrders
 * @param {null|Array<{ invoiceId: string, invoiceNumber: string, referenceNumber: string, customerId: string, status: string, total: number, balance: number, currencyCode: string }>} input.zohoInvoices null when Zoho was not queried
 * @param {Array<{ referenceNumber: string, amount: number, invoiceNumbers: string }>} [input.zohoIntentPayments] Zoho customer payments whose reference_number equals the PaymentIntent ID
 * @param {boolean} [input.locallyCleared] a local clearing record already exists for this PaymentIntent
 * @param {string|null} [input.localClearingStatus] status of the local stripe_payment_clearings row, if any
 * @param {boolean} [input.refundsClearedSeparately] every Stripe refund on the charge is accounted for as its own
 *   normal refund (credit note refund) in the payout that carries it, so the sale itself clears at full value
 * @param {Array<{ creditNoteId: string, creditNoteNumber: string, status: string, total: number, balance: number, invoiceId: string, invoiceNumber: string, salesReturnNumber?: string, totalRefunded: number, totalCreditsUsed: number }>} [input.returnCreditNotes]
 *   Zoho credit notes of the order, read when the website shows a return status. Without them a
 *   return status still blocks; with them a return that moved no money clears with `returnPending`.
 * @param {{ websiteZohoCustomerId: string, shopZohoCustomerId: string, websiteCurrency: string, amountTolerance: number }} input.config
 */
function classifyStripePayment(input) {
  const { stripe, websiteOrders = [], zohoInvoices, zohoIntentPayments = [], locallyCleared = false, localClearingStatus = null, config } = input
  const separate = input.refundsClearedSeparately === true
  const tolerance = config.amountTolerance
  const intentId = stripe ? stripe.paymentIntentId : clean(websiteOrders[0] && websiteOrders[0].stripePaymentIntentId)

  if (locallyCleared || localClearingStatus === 'POSTED') {
    return result(MATCH_STATUS.ALREADY_CLEARED, 'A clearing record for this PaymentIntent already exists.')
  }
  if (UNRESOLVED_LOCAL_STATUSES.has(localClearingStatus)) {
    return result(MATCH_STATUS.NEEDS_REVIEW, `A previous posting attempt is unresolved (${localClearingStatus}).`)
  }
  if (localClearingStatus === 'REVERSED_EXTERNALLY') {
    return result(MATCH_STATUS.NEEDS_REVIEW, 'An earlier gross-only clearing was reversed in Zoho; clear this payment through its payout.')
  }

  if (stripe) {
    if (stripe.status !== 'succeeded') {
      return result(MATCH_STATUS.STRIPE_NOT_SUCCEEDED, `Stripe PaymentIntent status is ${stripe.status}.`)
    }
    if (stripe.disputed) {
      return result(MATCH_STATUS.NEEDS_REVIEW, 'Stripe charge is disputed.')
    }
    if (!separate && stripe.amountRefunded > 0 && stripe.amountRefunded >= stripe.amountReceived - tolerance) {
      return result(MATCH_STATUS.REFUNDED, 'Stripe payment was fully refunded.')
    }
    if (!separate && stripe.amountRefunded > 0) {
      return result(MATCH_STATUS.PARTIALLY_REFUNDED, `Stripe refunded ${round2(stripe.amountRefunded)} of ${round2(stripe.amountReceived)}.`)
    }
    if (clean(stripe.currency).toUpperCase() !== config.websiteCurrency) {
      return result(MATCH_STATUS.CURRENCY_MISMATCH, `Stripe currency ${stripe.currency} is not ${config.websiteCurrency}.`)
    }
  }

  if (websiteOrders.length === 0) {
    return result(MATCH_STATUS.NO_WEBSITE_ORDER, 'No website order has this Stripe PaymentIntent ID.')
  }
  if (websiteOrders.length > 1) {
    return result(MATCH_STATUS.NEEDS_REVIEW, `${websiteOrders.length} website orders share this PaymentIntent ID.`)
  }

  const order = websiteOrders[0]
  if (stripe && clean(order.stripePaymentIntentId) !== stripe.paymentIntentId) {
    return result(MATCH_STATUS.NEEDS_REVIEW, 'Website order PaymentIntent ID does not equal the Stripe PaymentIntent ID.')
  }
  if (order.deleted) {
    return result(MATCH_STATUS.NEEDS_REVIEW, 'Website order is deleted.')
  }
  if (!clean(order.orderNumber)) {
    return result(MATCH_STATUS.NEEDS_REVIEW, 'Website order has no order number to look up in Zoho.')
  }
  if (order.sameNumberCount > 0) {
    return result(MATCH_STATUS.NEEDS_REVIEW, `Order number ${order.orderNumber} is used by another website order.`)
  }
  if (!separate && order.paymentStatus === 'refunded') {
    return result(MATCH_STATUS.REFUNDED, `Website order is ${order.orderStatus} / payment ${order.paymentStatus}.`)
  }
  if (!separate && order.refundAmount > 0) {
    return result(MATCH_STATUS.PARTIALLY_REFUNDED, `Website order has a refund of ${round2(order.refundAmount)}.`)
  }
  const returnStatus = !separate && WEBSITE_RETURN_STATUSES.has(order.orderStatus)
  if (returnStatus && (!stripe || !Array.isArray(input.returnCreditNotes))) {
    return result(
      order.orderStatus === 'returned' ? MATCH_STATUS.REFUNDED : MATCH_STATUS.PARTIALLY_REFUNDED,
      `Website order status is ${order.orderStatus}; without the Stripe charge and the Zoho credit notes it cannot be shown that no money was refunded.`,
    )
  }
  // A cancelled order only clears when Stripe refunded all of it; the refund is booked on its own.
  const refundedInFull = Boolean(stripe && stripe.amountRefunded > 0 && stripe.amountRefunded >= stripe.amountReceived - tolerance)
  if ((WEBSITE_CANCELLED.has(order.orderStatus) && !(separate && refundedInFull)) || WEBSITE_REVIEW.has(order.orderStatus)) {
    return result(MATCH_STATUS.NEEDS_REVIEW, `Website order status is ${order.orderStatus}.`)
  }
  if (order.paymentStatus !== 'completed' && !(separate && order.paymentStatus === 'refunded')) {
    return result(MATCH_STATUS.NEEDS_REVIEW, `Website payment status is ${order.paymentStatus}.`)
  }

  const amountDifference = {}
  if (stripe) {
    amountDifference.stripeMinusWebsite = round2(stripe.amountReceived - order.finalAmount)
    if (differs(stripe.amountReceived, order.finalAmount, tolerance)) {
      return result(
        MATCH_STATUS.AMOUNT_MISMATCH,
        `Stripe received ${round2(stripe.amountReceived)} but the website order total is ${round2(order.finalAmount)}.`,
        amountDifference,
      )
    }
  }

  if (zohoInvoices == null) {
    return result(MATCH_STATUS.NEEDS_REVIEW, 'Zoho was not queried for this order.', amountDifference)
  }

  const exact = zohoInvoices.filter((inv) => clean(inv.referenceNumber) === clean(order.orderNumber))
  const live = exact.filter((inv) => inv.status !== 'void')
  if (live.length === 0) {
    const reason = exact.length > 0
      ? `Only void Zoho invoices reference order ${order.orderNumber}.`
      : `No Zoho invoice has reference ${order.orderNumber}.`
    return result(MATCH_STATUS.NO_ZOHO_INVOICE, reason, amountDifference)
  }
  if (live.length > 1) {
    return result(
      MATCH_STATUS.MULTIPLE_ZOHO_INVOICES,
      `${live.length} Zoho invoices reference order ${order.orderNumber}: ${live.map((i) => i.invoiceNumber).join(', ')}.`,
      amountDifference,
    )
  }

  const invoice = live[0]
  const expectedCustomerId = expectedZohoCustomerId(order, config)
  if (invoice.customerId !== expectedCustomerId) {
    const expectedLabel = order.shopOrder ? 'Burjman Shop - Web & App' : 'Website'
    return result(MATCH_STATUS.NEEDS_REVIEW, `Zoho invoice ${invoice.invoiceNumber} is not under the ${expectedLabel} customer.`, amountDifference)
  }
  if (clean(invoice.currencyCode).toUpperCase() !== config.websiteCurrency) {
    return result(MATCH_STATUS.CURRENCY_MISMATCH, `Zoho invoice currency ${invoice.currencyCode} is not ${config.websiteCurrency}.`, amountDifference)
  }
  if (invoice.status === 'draft') {
    return result(MATCH_STATUS.NEEDS_REVIEW, `Zoho invoice ${invoice.invoiceNumber} is still a draft.`, amountDifference)
  }

  let returnPending = null
  if (returnStatus) {
    const problem = returnCreditNoteProblem(input.returnCreditNotes, invoice, tolerance)
    if (problem) return result(MATCH_STATUS.NEEDS_REVIEW, `Website order is ${order.orderStatus}. ${problem}`, amountDifference)
    returnPending = {
      orderNumber: order.orderNumber,
      orderStatus: order.orderStatus,
      stripeRefunded: round2(stripe.amountRefunded),
      creditNotes: input.returnCreditNotes.filter((n) => n.status !== 'void'),
    }
  }
  // The sale still clears on its own terms; the return only adds the warning.
  const done = (r) => (returnPending ? { ...r, returnPending } : r)

  const expected = stripe ? stripe.amountReceived : order.finalAmount
  const label = stripe ? 'Stripe amount' : 'website total'
  amountDifference.expectedMinusZohoTotal = round2(expected - invoice.total)
  amountDifference.expectedMinusZohoBalance = round2(expected - invoice.balance)

  const intentPayments = intentId ? zohoIntentPayments.filter((p) => clean(p.referenceNumber) === intentId) : []
  if (intentPayments.length > 0) {
    const appliedTo = intentPayments.map((p) => p.invoiceNumbers || '(unapplied)').join(' | ')
    return done(result(MATCH_STATUS.ALREADY_CLEARED, `A Zoho customer payment with reference ${intentId} already exists (applied to ${appliedTo}).`, amountDifference))
  }
  if (invoice.status === 'paid' || invoice.balance <= tolerance) {
    return done(result(MATCH_STATUS.ALREADY_CLEARED, `Zoho invoice ${invoice.invoiceNumber} has no balance left.`, amountDifference))
  }

  if (differs(expected, invoice.total, tolerance)) {
    return done(result(
      MATCH_STATUS.AMOUNT_MISMATCH,
      `${label} ${round2(expected)} does not equal Zoho invoice total ${round2(invoice.total)}.`,
      amountDifference,
    ))
  }
  if (differs(invoice.balance, invoice.total, tolerance)) {
    return done(result(
      MATCH_STATUS.ZOHO_BALANCE_MISMATCH,
      `Zoho invoice ${invoice.invoiceNumber} is partly paid: balance ${round2(invoice.balance)} of ${round2(invoice.total)}.`,
      amountDifference,
    ))
  }

  if (!stripe) {
    return done(result(
      MATCH_STATUS.STRIPE_NOT_VERIFIED,
      'Website order and Zoho invoice agree; the Stripe payment was not read.',
      amountDifference,
    ))
  }

  return done(result(MATCH_STATUS.MATCHED_READY_TO_CLEAR, `Stripe, website order ${order.orderNumber} and Zoho ${invoice.invoiceNumber} agree.`, amountDifference))
}

/** The single live Zoho invoice that matched exactly, if any. */
function pickMatchedInvoice(zohoInvoices, orderNumber) {
  if (!Array.isArray(zohoInvoices)) return null
  const live = zohoInvoices.filter((inv) => clean(inv.referenceNumber) === clean(orderNumber) && inv.status !== 'void')
  return live.length === 1 ? live[0] : null
}

module.exports = {
  MATCH_STATUS,
  WEBSITE_CANCELLED,
  WEBSITE_RETURN_STATUSES,
  classifyStripePayment,
  expectedZohoCustomerId,
  pickMatchedInvoice,
}
