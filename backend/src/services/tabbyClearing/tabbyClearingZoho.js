'use strict'

/**
 * Zoho-facing checks for Tabby clearing, all read-only: account resolution, the Zoho state of
 * each planned component (found by its deterministic reference), the credit note a refund is
 * paid from, and the existing Tabby → bank transfer for a statement.
 *
 * Zoho states: MISSING (safe to post), VERIFIED (one matching record), CONFLICT (a record with
 * our reference that differs), AMBIGUOUS (more than one record with our reference),
 * LOOKUP_FAILED (Zoho could not be searched completely; never read as "missing").
 */

const { ACCOUNT_ROLE } = require('../../config/tabbyClearing')
const { BANK_STATUS, money } = require('./tabbyClearingModel')

const ZOHO_STATE = Object.freeze({
  MISSING: 'MISSING',
  VERIFIED: 'VERIFIED',
  CONFLICT: 'CONFLICT',
  AMBIGUOUS: 'AMBIGUOUS',
  LOOKUP_FAILED: 'LOOKUP_FAILED',
})

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function minor(major) {
  return Math.round((Number(major) || 0) * 100)
}

function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function lower(s) {
  return clean(s).toLowerCase()
}

// ── Accounts ────────────────────────────────────────────────────────────────

/**
 * Resolve every role: admin mapping first, then exact name, then a known equivalent name. The
 * account must exist, be active and have an allowed type; two roles may not share an account.
 * @returns {{ accounts: Record<string, object>, problems: object[] }}
 */
function resolveAccounts(chart, mappings, roles) {
  const accounts = {}
  const problems = []
  const active = chart.filter((a) => a.isActive !== false)
  const byName = (names) => active.filter((a) => names.some((n) => lower(a.accountName) === lower(n)))
  for (const role of roles) {
    const mapping = mappings.find((m) => m.role === role.role)
    const typeOk = (a) => role.types.includes(lower(a.accountType))
    const suggestions = byName([...(role.aliases || []), ...(role.suggestions || [])]).filter(typeOk).map((a) => ({ accountId: a.accountId, accountName: a.accountName, accountCode: a.accountCode, accountType: a.accountType }))
    const take = (a, source) => {
      accounts[role.role] = { role: role.role, label: role.label, accountId: a.accountId, accountName: a.accountName, accountCode: a.accountCode || null, accountType: a.accountType, source }
    }
    if (mapping) {
      const a = chart.find((x) => x.accountId === mapping.accountId)
      if (!a) problems.push({ role: role.role, code: 'MAPPED_ACCOUNT_MISSING', message: `${role.label}: mapped account ${mapping.accountName} no longer exists in Zoho.`, suggestions })
      else if (a.isActive === false) problems.push({ role: role.role, code: 'MAPPED_ACCOUNT_INACTIVE', message: `${role.label}: mapped account ${a.accountName} is inactive.`, suggestions })
      else if (!typeOk(a)) problems.push({ role: role.role, code: 'ACCOUNT_TYPE_INVALID', message: `${role.label}: ${a.accountName} is a ${a.accountType} account; expected ${role.types.join(' / ')}.`, suggestions })
      else take(a, 'MAPPING')
      continue
    }
    let resolved = false
    for (const [names, source] of [[role.names, 'EXACT_NAME'], [role.aliases || [], 'KNOWN_EQUIVALENT']]) {
      const found = byName(names)
      if (found.length === 0) continue
      if (found.length > 1) {
        problems.push({ role: role.role, code: 'ACCOUNT_AMBIGUOUS', message: `${role.label}: ${found.length} active accounts are named ${found[0].accountName}.`, suggestions })
      } else if (!typeOk(found[0])) {
        problems.push({ role: role.role, code: 'ACCOUNT_TYPE_INVALID', message: `${role.label}: ${found[0].accountName} is a ${found[0].accountType} account; expected ${role.types.join(' / ')}.`, suggestions })
      } else take(found[0], source)
      resolved = true
      break
    }
    if (!resolved) {
      problems.push({ role: role.role, code: 'ACCOUNT_UNMAPPED', message: `${role.label}: no Zoho account named "${role.names[0]}"${suggestions.length ? `; choose one (e.g. ${suggestions.map((s) => s.accountName).join(', ')})` : ''} in the account mapping.`, suggestions })
    }
  }
  const seen = new Map()
  for (const a of Object.values(accounts)) {
    if (seen.has(a.accountId)) problems.push({ role: a.role, code: 'ACCOUNT_REUSED', message: `${a.label} and ${seen.get(a.accountId)} resolve to the same account ${a.accountName}.`, suggestions: [] })
    else seen.set(a.accountId, a.label)
  }
  return { accounts, problems }
}

// ── Record comparison ───────────────────────────────────────────────────────

function compareCustomerPayment(detail, c) {
  if (!detail) return ['The Zoho payment could not be read.']
  const d = []
  if (clean(detail.reference_number) !== c.reference) d.push(`Reference is "${clean(detail.reference_number)}".`)
  if (clean(detail.customer_id) !== c.customerId) d.push(`Customer is ${detail.customer_name || detail.customer_id}.`)
  if (minor(detail.amount) !== c.amountMinor) d.push(`Amount ${detail.amount}, expected ${money(c.amountMinor)}.`)
  if (clean(detail.account_id) !== c.depositAccountId) d.push(`Deposited to ${detail.account_name || detail.account_id}.`)
  const applied = new Map()
  for (const inv of detail.invoices || []) applied.set(clean(inv.invoice_id), (applied.get(clean(inv.invoice_id)) || 0) + minor(inv.amount_applied))
  for (const a of c.allocations) {
    if (!applied.has(a.invoiceId)) d.push(`Invoice ${a.invoiceNumber || a.invoiceId} is not allocated.`)
    else if (applied.get(a.invoiceId) !== minor(a.amount)) d.push(`Invoice ${a.invoiceNumber || a.invoiceId}: ${money(applied.get(a.invoiceId))} applied, expected ${money(minor(a.amount))}.`)
  }
  for (const id of applied.keys()) if (!c.allocations.some((a) => a.invoiceId === id)) d.push(`Also applied to invoice ${id}.`)
  return d
}

function lineKey(accountId, side, amountMinor) {
  return `${accountId}|${side}|${amountMinor}`
}

function compareJournal(journal, c) {
  if (!journal) return ['The Zoho journal could not be read.']
  const d = []
  if (journal.referenceNumber !== c.reference) d.push(`Reference is "${journal.referenceNumber}".`)
  const have = (journal.lineItems || []).map((l) => lineKey(l.accountId, l.debitOrCredit, minor(l.amount))).sort()
  const want = c.lines.map((l) => lineKey(l.accountId, l.side, l.amountMinor)).sort()
  if (have.join(',') !== want.join(',')) d.push(`Lines differ: Zoho ${(journal.lineItems || []).map((l) => `${l.debitOrCredit} ${l.accountName || l.accountId} ${l.amount}`).join('; ')}.`)
  return d
}

function compareCreditNoteRefund(detail, c) {
  if (!detail) return ['The Zoho credit note refund could not be read.']
  const d = []
  if (clean(detail.referenceNumber) !== c.reference) d.push(`Reference is "${clean(detail.referenceNumber)}".`)
  if (clean(detail.creditNoteId) && clean(detail.creditNoteId) !== c.creditNoteId) d.push(`It refunds credit note ${detail.creditNoteId}.`)
  if (minor(detail.amount) !== c.amountMinor) d.push(`Amount ${detail.amount}, expected ${money(c.amountMinor)}.`)
  if (clean(detail.fromAccountId) !== c.depositAccountId) d.push(`Paid from ${detail.fromAccountName || detail.fromAccountId}.`)
  return d
}

function compareBankTransfer(txn, c) {
  if (!txn) return ['The Zoho bank transaction could not be read.']
  const d = []
  if (txn.referenceNumber !== c.reference) d.push(`Reference is "${txn.referenceNumber}".`)
  if (txn.transactionType && txn.transactionType !== 'transfer_fund') d.push(`Type is ${txn.transactionType}.`)
  if (minor(txn.amount) !== c.amountMinor) d.push(`Amount ${txn.amount}, expected ${money(c.amountMinor)}.`)
  if (txn.fromAccountId && txn.fromAccountId !== c.fromAccountId) d.push(`From ${txn.fromAccountName || txn.fromAccountId}.`)
  if (txn.toAccountId && txn.toAccountId !== c.toAccountId) d.push(`To ${txn.toAccountName || txn.toAccountId}.`)
  return d
}

// ── Component state in Zoho ─────────────────────────────────────────────────

function datesOf(c) {
  const dates = [c.date, c.requestSnapshot && c.requestSnapshot.date].filter(Boolean).sort()
  return { start: addDays(dates[0], -2), end: addDays(dates[dates.length - 1], 2) }
}

async function settle(ids, load, compare, c) {
  if (ids.length > 1) return { state: ZOHO_STATE.AMBIGUOUS, recordIds: ids, reason: `${ids.length} Zoho records carry "${c.reference}": ${ids.join(', ')}.` }
  if (ids.length === 0) return { state: ZOHO_STATE.MISSING, reason: `No Zoho record carries "${c.reference}".` }
  const detail = await load(ids[0])
  const diffs = compare(detail, c)
  if (diffs.length) return { state: ZOHO_STATE.CONFLICT, recordId: ids[0], reason: `Zoho ${ids[0]} carries "${c.reference}" but differs: ${diffs.join(' ')}`, differences: diffs }
  return { state: ZOHO_STATE.VERIFIED, recordId: ids[0], reason: `Matches Zoho ${ids[0]}.` }
}

/**
 * @param {object} c planned component (with accounts), optionally `requestSnapshot`
 * @param {object} sources tabby sources
 * @param {{ deep?: boolean }} opts deep: also read the records directly (invoice payments, journals
 *   by date) so a record the search index has not caught up with is still found.
 */
async function componentZohoState(c, sources, { deep = false } = {}) {
  try {
    if (c.zohoRecordType === 'customer_payment') {
      const found = await sources.findPaymentsByReference(c.reference, { critical: deep })
      let ids = [...new Set(found.map((p) => p.paymentId))]
      if (deep) {
        const direct = (await sources.listInvoicePayments(c.invoiceId, { critical: true })).filter((p) => p.referenceNumber === c.reference).map((p) => p.paymentId)
        ids = [...new Set([...ids, ...direct])]
      }
      return settle(ids, (id) => sources.getCustomerPayment(id), compareCustomerPayment, c)
    }
    if (c.zohoRecordType === 'journal') {
      const found = await sources.findJournalsByReference(c.reference, { critical: deep })
      let ids = [...new Set(found.map((j) => j.journalId))]
      if (deep) {
        const { start, end } = datesOf(c)
        const direct = (await sources.listJournalsInRange(start, end, { critical: true })).filter((j) => j.referenceNumber === c.reference).map((j) => j.journalId)
        ids = [...new Set([...ids, ...direct])]
      }
      return settle(ids, (id) => sources.getJournal(id, { critical: deep }), compareJournal, c)
    }
    if (c.zohoRecordType === 'creditnote_refund') {
      const refunds = await sources.listCreditNoteRefunds(c.creditNoteId, { critical: deep })
      const ids = [...new Set(refunds.filter((r) => r.referenceNumber === c.reference).map((r) => r.creditNoteRefundId))]
      return settle(ids, (id) => sources.getCreditNoteRefund(c.creditNoteId, id, { critical: deep }), compareCreditNoteRefund, c)
    }
    if (c.zohoRecordType === 'creditnote_link') {
      const cn = await sources.getCreditNote(c.creditNoteId, { critical: deep })
      if (!cn) return { state: ZOHO_STATE.CONFLICT, reason: `Credit note ${c.creditNoteNumber || c.creditNoteId} no longer exists in Zoho.` }
      if (cn.status === 'void' || cn.status === 'draft') return { state: ZOHO_STATE.CONFLICT, reason: `Credit note ${cn.creditNoteNumber} is ${cn.status}.` }
      if (cn.customerId !== c.customerId) return { state: ZOHO_STATE.CONFLICT, reason: `Credit note ${cn.creditNoteNumber} belongs to another customer.` }
      return { state: ZOHO_STATE.VERIFIED, recordId: cn.creditNoteId, reason: `Credit note ${cn.creditNoteNumber} (balance ${cn.balance.toFixed(2)}).` }
    }
    if (c.zohoRecordType === 'bank_transfer') {
      const { start, end } = datesOf(c)
      const txns = await sources.listBankTransactions(c.fromRole === ACCOUNT_ROLE.UNDEPOSITED ? c.fromAccountId : c.toAccountId, start, end, { critical: deep })
      const ids = [...new Set(txns.filter((t) => t.referenceNumber === c.reference).map((t) => t.transactionId))]
      return settle(ids, (id) => sources.getBankTransaction(id, { critical: deep }), compareBankTransfer, c)
    }
    return { state: ZOHO_STATE.LOOKUP_FAILED, reason: `Unknown record type ${c.zohoRecordType}.` }
  } catch (err) {
    return { state: ZOHO_STATE.LOOKUP_FAILED, reason: `Zoho could not be searched: ${err && err.message ? err.message : err}`, code: err && err.code }
  }
}

// ── Refund credit note ──────────────────────────────────────────────────────

/**
 * The existing Zoho credit note a Tabby refund is paid from. Never creates one.
 * @param {{ sources: object, order: object, invoice: object, amountMinor: number, reference: string,
 *   statementNumber: string, claimedMinor: Map<string, number> }} input claimedMinor: credit note
 *   balance already assigned to earlier refunds of this statement.
 */
async function selectRefundCreditNote({ sources, order, invoice, amountMinor, reference, statementNumber, claimedMinor }) {
  const problem = (code, message) => ({ ok: false, code, message })
  const notes = await sources.findCreditNotesForOrder(order.orderNumber, invoice.customerId)
  const live = notes.filter((n) => n.status !== 'void')
  const detailed = []
  for (const n of live) {
    const detail = (await sources.getCreditNote(n.creditNoteId)) || n
    const refunds = await sources.listCreditNoteRefunds(n.creditNoteId)
    detailed.push({ ...n, ...detail, refunds })
  }
  const ours = detailed.flatMap((n) => n.refunds.filter((r) => r.referenceNumber === reference).map((r) => ({ note: n, refund: r })))
  if (ours.length > 1) return problem('ZOHO_DUPLICATE_REFUND', `${ours.length} Zoho credit note refunds carry "${reference}".`)
  if (ours.length === 1) return { ok: true, how: 'ALREADY_REFUNDED_BY_WORKFLOW', creditNote: ours[0].note, candidateCreditNoteIds: detailed.map((n) => n.creditNoteId) }
  const manual = detailed.flatMap((n) => n.refunds.filter((r) => r.referenceNumber.includes(statementNumber) && minor(r.amount) === amountMinor).map((r) => ({ note: n, refund: r })))
  if (manual.length > 0) {
    return problem('REFUND_ALREADY_BOOKED_MANUALLY', `Credit note ${manual[0].note.creditNoteNumber} already has a manual refund of ${money(amountMinor)} ("${manual[0].refund.referenceNumber}") for this statement.`)
  }
  const usable = detailed.filter((n) => n.status !== 'draft' && (!n.invoiceId || n.invoiceId === invoice.invoiceId))
  const available = (n) => minor(n.balance) - (claimedMinor.get(n.creditNoteId) || 0)
  const funded = usable.filter((n) => available(n) >= amountMinor)
  const exact = funded.filter((n) => minor(n.total) === amountMinor)
  const pick = exact.length === 1 ? exact[0] : funded.length === 1 ? funded[0] : null
  if (pick) return { ok: true, how: exact.length === 1 ? 'CREDIT_NOTE_TOTAL' : 'CREDIT_NOTE_BALANCE', creditNote: pick, candidateCreditNoteIds: detailed.map((n) => n.creditNoteId) }
  if (funded.length > 1) return problem('CREDIT_NOTE_AMBIGUOUS', `More than one credit note can fund ${money(amountMinor)}: ${funded.map((n) => n.creditNoteNumber).join(', ')}.`)
  if (live.length === 0) return problem('CREDIT_NOTE_MISSING', `No Zoho credit note exists for order ${order.orderNumber} yet (book the return first).`)
  if (usable.length === 0) return problem('CREDIT_NOTE_DRAFT', `Credit note ${live.map((n) => n.creditNoteNumber).join(', ')} is a draft or belongs to another invoice.`)
  return problem('CREDIT_NOTE_BALANCE_INSUFFICIENT', `Credit note balance ${usable.map((n) => `${n.creditNoteNumber} ${money(available(n))}`).join(', ')} cannot fund the ${money(amountMinor)} refund.`)
}

// ── Bank ────────────────────────────────────────────────────────────────────

/**
 * Existing Zoho transfer that moved this statement's payout between Tabby Undeposited Funds and
 * the bank account: same amount, transfer_fund, right direction, the bank as the other side,
 * dated from a few days before the transfer date. Records settling other statements are skipped.
 */
async function findBankMatch({ sources, accounts, amountMinor, transferDate, statementNumber, ownReference, claims, batchId, currentTransactionId, config }) {
  if (amountMinor === 0) return { status: BANK_STATUS.BANK_NOT_REQUIRED, amountMinor, candidates: [], reason: 'Nothing is paid out.' }
  const undeposited = accounts[ACCOUNT_ROLE.UNDEPOSITED]
  const bank = accounts[ACCOUNT_ROLE.BANK]
  if (!undeposited || !bank) return { status: BANK_STATUS.BANK_LOOKUP_FAILED, amountMinor, candidates: [], reason: 'Tabby Undeposited Funds and the bank account must be resolved before the bank payout can be matched.' }
  const start = addDays(transferDate, -config.bankSearchDaysBefore)
  const end = addDays(transferDate, config.bankSearchDaysAfter)
  let txns
  try {
    txns = await sources.listBankTransactions(undeposited.accountId, start, end)
  } catch (err) {
    return { status: BANK_STATUS.BANK_LOOKUP_FAILED, amountMinor, candidates: [], reason: `Zoho bank transactions could not be read: ${err.message}` }
  }
  const direction = amountMinor > 0 ? 'credit' : 'debit'
  const claimedElsewhere = new Map(claims.filter((c) => String(c.batchId) !== String(batchId)).map((c) => [c.transactionId, c.statementNumber]))
  const all = txns.filter((t) => t.transactionType === 'transfer_fund' && minor(t.amount) === Math.abs(amountMinor) && t.debitOrCredit === direction
    && (t.offsetAccountId ? t.offsetAccountId === bank.accountId : lower(t.offsetAccountName) === lower(bank.accountName))
    && t.referenceNumber !== ownReference)
  const candidates = all.filter((t) => !claimedElsewhere.has(t.transactionId))
  const skipped = all.filter((t) => claimedElsewhere.has(t.transactionId)).map((t) => ({ ...t, claimedBy: claimedElsewhere.get(t.transactionId) }))
  const out = (status, matched, reason) => ({ status, amountMinor, matched: matched || null, candidates, skipped, window: { start, end }, reason })
  const current = candidates.find((t) => t.transactionId === currentTransactionId)
  if (current) return out(BANK_STATUS.BANK_MATCHED, current, `Linked Zoho transfer ${current.referenceNumber || current.transactionId} on ${current.date}.`)
  if (candidates.length === 1) return out(BANK_STATUS.BANK_MATCHED, candidates[0], `Existing Zoho transfer ${candidates[0].referenceNumber || candidates[0].transactionId} on ${candidates[0].date} (${money(Math.abs(amountMinor))}).`)
  if (candidates.length === 0) return out(BANK_STATUS.BANK_MATCH_PENDING, null, `No existing Tabby → ${bank.accountName} transfer of ${money(Math.abs(amountMinor))} between ${start} and ${end}; posting will record it.`)
  const named = candidates.filter((t) => t.referenceNumber.includes(statementNumber))
  if (named.length === 1) return out(BANK_STATUS.BANK_MATCHED, named[0], `Existing Zoho transfer ${named[0].referenceNumber} names ${statementNumber}.`)
  return out(BANK_STATUS.BANK_MATCH_AMBIGUOUS, null, `${candidates.length} Zoho transfers of ${money(Math.abs(amountMinor))} could be this payout: ${candidates.map((t) => `${t.date} ${t.referenceNumber || t.transactionId}`).join('; ')}.`)
}

module.exports = {
  ZOHO_STATE,
  resolveAccounts,
  compareCustomerPayment,
  compareJournal,
  compareCreditNoteRefund,
  compareBankTransfer,
  componentZohoState,
  selectRefundCreditNote,
  findBankMatch,
  addDays,
}
