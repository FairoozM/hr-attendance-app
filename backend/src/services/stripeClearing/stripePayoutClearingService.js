'use strict'

/**
 * Local-only admin actions for payout clearing. Nothing here creates, changes or
 * deletes anything in Zoho or Stripe; Zoho and Stripe are only read to re-verify.
 */

const payoutStore = require('./stripePayoutClearingStore')
const clearingStore = require('./stripeClearingStore')
const preview = require('./stripePayoutPreviewService')

const CHARGE_PATTERN = /^ch_[A-Za-z0-9]{8,64}$/
const INTENT_PATTERN = /^pi_[A-Za-z0-9]{8,64}$/
const MIN_REASON_LENGTH = 10

function fail(status, code, message) {
  const err = new Error(message)
  err.status = status
  err.code = code
  return err
}

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function defaultDeps() {
  return {
    payoutStore,
    clearingStore,
    zohoPayments: require('../amazonPaymentClearingZohoPaymentService'),
    reader: { query: (sql, params) => require('../../db').query(sql, params) },
    withClient: async (fn) => {
      const client = await require('../../db').pool.connect()
      try {
        return await fn(client)
      } finally {
        client.release()
      }
    },
    previewPayout: preview.previewPayout,
  }
}

function findAdvanceLine(result, chargeId) {
  for (const group of result.groups) {
    const line = group.lines.find((l) => l.chargeId === chargeId)
    if (line) return { group, line }
  }
  return null
}

/**
 * Admin confirms that a detected overpayment is a customer advance (Cr 1123).
 * Re-runs the live preview and only accepts a current, open candidate. Idempotent.
 */
async function confirmCustomerAdvance(payoutId, chargeId, opts = {}, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const charge = clean(chargeId)
  const reason = clean(opts.reason)
  if (!CHARGE_PATTERN.test(charge)) throw fail(400, 'INVALID_CHARGE_ID', 'A Stripe charge ID (ch_…) is required.')
  if (reason.length < MIN_REASON_LENGTH) throw fail(400, 'REASON_REQUIRED', `Explain why this overpayment is a customer advance (at least ${MIN_REASON_LENGTH} characters).`)
  if (!opts.actor) throw fail(401, 'ACTOR_REQUIRED', 'The confirming admin could not be identified.')

  const result = await deps.previewPayout(payoutId)
  const found = findAdvanceLine(result, charge)
  if (!found || !found.line.advance) {
    throw fail(409, 'NOT_AN_ADVANCE_CANDIDATE', `Charge ${charge} is not a customer overpayment candidate in payout ${result.payout.payoutId}.`)
  }
  const { line, group } = found
  if (line.advance.confirmed) {
    return { alreadyConfirmed: true, caseId: line.advance.caseId, caseStatus: line.advance.caseStatus, zohoWrites: 0 }
  }
  if (line.state !== preview.LINE_STATE.OPEN) {
    throw fail(409, 'ADVANCE_CANDIDATE_NOT_OPEN', `Charge ${charge} cannot be confirmed: ${line.reason}`)
  }
  const candidate = {
    payoutId: result.payout.payoutId,
    zohoCustomerId: group.customerId,
    customerName: group.customerName,
    orderNumber: line.website.orderNumber,
    invoiceId: line.invoice.invoiceId,
    invoiceNumber: line.invoice.invoiceNumber,
    paymentIntentId: line.paymentIntentId,
    chargeId: line.chargeId,
    balanceTransactionId: line.balanceTransactionId,
    currency: result.payout.currency,
    stripeGross: line.gross,
    stripeNet: line.net,
    stripeFee: line.fee,
    invoiceTotal: line.invoiceTotal,
    overpaymentAmount: line.customerAdvance,
    netAllocation: line.netAllocation,
    customerAdvanceAccountId: result.accounts.advance ? result.accounts.advance.accountId : null,
    customerAdvanceAccountCode: result.accounts.advance ? result.accounts.advance.accountCode : null,
    advanceReference: group.components.find((c) => c.component === 'CUSTOMER_ADVANCE').reference,
  }
  if (!candidate.customerAdvanceAccountId) {
    throw fail(409, 'ADVANCE_ACCOUNT_UNRESOLVED', 'The Customer Advance Funds account could not be verified in Zoho.')
  }
  const out = await deps.withClient((client) => deps.payoutStore.confirmCase(client, candidate, { actor: opts.actor, reason }))
  const events = await deps.payoutStore.listEvents(deps.reader, payoutStore.ENTITY.ADVANCE_CASE, [out.case.id])
  return { alreadyConfirmed: out.alreadyConfirmed, case: out.case, events, zohoWrites: 0 }
}

/**
 * Mark a gross-only (GROSS_V1) POSTED record whose Zoho payment was deleted in Zoho
 * as REVERSED_EXTERNALLY. Requires the caller to name the Zoho payment ID and Zoho to
 * return 404 for it. The invoice is never re-cleared here.
 */
async function markGrossClearingReversedExternally(paymentIntentId, opts = {}, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const pi = clean(paymentIntentId)
  const zohoPaymentId = clean(opts.zohoPaymentId)
  if (!INTENT_PATTERN.test(pi)) throw fail(400, 'INVALID_PAYMENT_INTENT', 'A Stripe PaymentIntent ID (pi_…) is required.')
  if (!zohoPaymentId) throw fail(400, 'ZOHO_PAYMENT_ID_REQUIRED', 'Name the deleted Zoho payment ID to confirm.')
  if (!opts.actor) throw fail(401, 'ACTOR_REQUIRED', 'The admin could not be identified.')

  const record = await deps.clearingStore.getByIntent(deps.reader, pi)
  if (!record) throw fail(404, 'CLEARING_NOT_FOUND', `No local clearing record for ${pi}.`)
  if (record.status === clearingStore.CLEARING_STATUS.REVERSED_EXTERNALLY) {
    return { alreadyReversed: true, clearing: record, zohoWrites: 0 }
  }
  const stillThere = await deps.zohoPayments.getZohoCustomerPayment(zohoPaymentId, { source: 'stripe_clearing_reversal_check' })
  if (stillThere) {
    throw fail(409, 'ZOHO_PAYMENT_STILL_EXISTS', `Zoho still has customer payment ${zohoPaymentId}; it was not deleted.`)
  }
  const detail = `Zoho customer payment ${zohoPaymentId} for ${record.zohoInvoiceNumber} was deleted manually in Zoho (Zoho returns not found). `
    + 'Gross-only clearing superseded by payout clearing; the invoice is not re-cleared from this record.'
  const clearing = await deps.withClient((client) => deps.clearingStore.markReversedExternally(client, record.id, zohoPaymentId, detail, opts.actor))
  const events = await deps.clearingStore.listEvents(deps.reader, record.id)
  return { alreadyReversed: false, clearing, events, zohoWrites: 0 }
}

module.exports = {
  confirmCustomerAdvance,
  markGrossClearingReversedExternally,
}
