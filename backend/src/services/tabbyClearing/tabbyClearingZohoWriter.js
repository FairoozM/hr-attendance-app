'use strict'

/**
 * The only Zoho writes of Tabby settlement clearing, each sent exactly as previewed: a customer
 * payment, a manual journal, a refund of an existing credit note, or a Tabby → bank transfer.
 * Accounts are never re-resolved here and a timed-out / 5xx request is never retried at transport
 * level; the posting engine searches Zoho by reference before anything is sent again.
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
  const json = await send('customerpayments', payload, 'tabby_clearing_post_payment')
  const body = (json && (json.payment || json.customerpayment)) || {}
  return { recordId: clean(body.payment_id || body.customerpayment_id) }
}

/** @returns {Promise<{ recordId: string }>} */
async function createJournal(payload) {
  const json = await send('journals', payload, 'tabby_clearing_post_journal')
  const body = (json && json.journal) || {}
  return { recordId: clean(body.journal_id) }
}

/** Refund of an existing credit note (credit notes themselves are never created). */
async function createCreditNoteRefund(creditNoteId, payload) {
  const id = clean(creditNoteId)
  if (!id) throw new Error('A Zoho credit note ID is required.')
  const json = await send(`creditnotes/${encodeURIComponent(id)}/refunds`, payload, 'tabby_clearing_post_creditnote_refund')
  const body = (json && json.creditnote_refund) || {}
  return { recordId: clean(body.creditnote_refund_id) }
}

/** Transfer between Tabby Undeposited Funds and the bank account. */
async function createBankTransfer(payload) {
  const json = await send('banktransactions', payload, 'tabby_clearing_post_bank_transfer')
  const body = (json && (json.banktransaction || json.bank_transaction)) || {}
  return { recordId: clean(body.transaction_id) }
}

module.exports = { createCustomerPayment, createJournal, createCreditNoteRefund, createBankTransfer }
