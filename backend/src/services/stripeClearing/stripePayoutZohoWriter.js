'use strict'

/**
 * The only Zoho writes of payout clearing: one customer payment or one manual journal,
 * sent exactly as previewed. Accounts are never re-resolved here, and a timed-out or
 * 5xx request is never retried at transport level (the caller reconciles by reference).
 */

const { zohoBooksJsonRequest } = require('../zohoApiClient')

const BOOKS_V3 = '/books/v3'

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function jsonStringBody(payload) {
  const form = new URLSearchParams()
  form.set('JSONString', JSON.stringify(payload))
  return form.toString()
}

async function send(path, payload, source) {
  return zohoBooksJsonRequest(`${BOOKS_V3}/${path}`, new URLSearchParams(), 'POST', jsonStringBody(payload), {
    source,
    skipCache: true,
    critical: true,
    retryTransport: false,
  })
}

/** @returns {Promise<{ recordId: string }>} empty recordId when Zoho answered without one */
async function createCustomerPayment(payload) {
  const json = await send('customerpayments', payload, 'stripe_payout_post_payment')
  const body = (json && (json.payment || json.customerpayment)) || {}
  return { recordId: clean(body.payment_id || body.customerpayment_id) }
}

/** @returns {Promise<{ recordId: string }>} empty recordId when Zoho answered without one */
async function createJournal(payload) {
  const json = await send('journals', payload, 'stripe_payout_post_journal')
  const body = (json && json.journal) || {}
  return { recordId: clean(body.journal_id) }
}

/** Refund of an existing credit note. @returns {Promise<{ recordId: string }>} */
async function createCreditNoteRefund(creditNoteId, payload) {
  const id = clean(creditNoteId)
  if (!id) throw new Error('A Zoho credit note ID is required.')
  const json = await send(`creditnotes/${encodeURIComponent(id)}/refunds`, payload, 'stripe_payout_post_creditnote_refund')
  const body = (json && json.creditnote_refund) || {}
  return { recordId: clean(body.creditnote_refund_id) }
}

module.exports = { createCustomerPayment, createJournal, createCreditNoteRefund }
