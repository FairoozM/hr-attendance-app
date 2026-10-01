'use strict'

/**
 * The only Zoho writes of POS settlement clearing, each sent exactly as previewed and approved:
 * a customer payment, a manual journal or a POS Undeposited → RAK transfer. Refused unless
 * POS_SETTLEMENT_POSTING_ENABLED=true on this server (checked here as well as in the posting
 * service). A timed-out / 5xx request is never retried at transport level; the posting engine
 * searches Zoho by reference before anything is sent again. Payloads carry no notes or app names.
 */

const BOOKS_V3 = '/books/v3'

function clean(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function assertEnabled() {
  if (String(process.env.POS_SETTLEMENT_POSTING_ENABLED || '').trim().toLowerCase() !== 'true') {
    const err: any = new Error('POS settlement posting is disabled on this server (POS_SETTLEMENT_POSTING_ENABLED is not true).')
    err.status = 403
    err.code = 'POSTING_DISABLED'
    throw err
  }
}

async function send(path: string, payload: unknown, source: string) {
  assertEnabled()
  const { zohoBooksJsonRequest } = require('../zohoApiClient')
  const form = new URLSearchParams()
  form.set('JSONString', JSON.stringify(payload))
  return zohoBooksJsonRequest(`${BOOKS_V3}/${path}`, new URLSearchParams(), 'POST', form.toString(), { source, skipCache: true, critical: true, retryTransport: false })
}

async function createCustomerPayment(payload: unknown) {
  const json = await send('customerpayments', payload, 'pos_settlement_post_payment')
  const body = (json && (json.payment || json.customerpayment)) || {}
  return { recordId: clean(body.payment_id || body.customerpayment_id) }
}

async function createJournal(payload: unknown) {
  const json = await send('journals', payload, 'pos_settlement_post_journal')
  const body = (json && json.journal) || {}
  return { recordId: clean(body.journal_id) }
}

async function createBankTransfer(payload: unknown) {
  const json = await send('banktransactions', payload, 'pos_settlement_post_bank_transfer')
  const body = (json && (json.banktransaction || json.bank_transaction)) || {}
  return { recordId: clean(body.transaction_id) }
}

async function createCreditNoteRefund() {
  throw new Error('POS settlement clearing never refunds credit notes.')
}

module.exports = { createCustomerPayment, createJournal, createBankTransfer, createCreditNoteRefund, assertEnabled }
