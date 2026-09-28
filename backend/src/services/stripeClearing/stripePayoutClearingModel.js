'use strict'

/**
 * Pure payout-clearing rules: references, Zoho payloads, duplicate verification,
 * partial-failure recovery and group / payout statuses. No I/O.
 *
 * Per payout + Zoho customer there are up to three components:
 * - NET              customer payment → Stripe Undeposited Funds (1019), allocated per invoice
 * - FEE              customer payment → Stripe Processing Chg Un-Cleared (1013), allocated per invoice
 * - CUSTOMER_ADVANCE journal Dr 1019 / Cr Customer Advance Funds (1123, tagged to the customer)
 * Identity is payout + customer + component; references alone never prove a record.
 *
 * Per payout (no customer) there is one more, posted last:
 * - PAYOUT_FEE_JOURNAL journal Dr Stripe Fees (2270) / Cr 1013 for the payout's total Stripe fees,
 *   once every customer group is posted and its FEE payments verified.
 *
 * Per normal (invoice) Stripe refund in the payout, identified by the Stripe refund ID:
 * - REFUND_CREDIT_NOTE_REFUND refund of the existing Zoho credit note for the invoice, paid from 1019
 * - REFUND_FEE_ADJUSTMENT     journal between 1019 and 1013 for Stripe's fee on the refund, only when
 *   that fee is not zero, so 1019 moves by exactly the refund's net and 1013 by exactly its fee
 */

const { buildCustomerPaymentPayload, buildManualJournalPayload } = require('../amazonPaymentClearingZohoPaymentService')

const GROUP_STATUS = Object.freeze({
  READY: 'READY',
  READY_WITH_CUSTOMER_ADVANCE: 'READY_WITH_CUSTOMER_ADVANCE',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  PARTIALLY_POSTED: 'PARTIALLY_POSTED',
  POSTED: 'POSTED',
  ALREADY_POSTED: 'ALREADY_POSTED',
  POSTING_UNCERTAIN: 'POSTING_UNCERTAIN',
})

// FEE_JOURNAL_PENDING: every customer group is posted; the payout fee journal is not verified yet.
const PAYOUT_STATUS = Object.freeze({
  READY: 'READY',
  PARTIALLY_CLEARED: 'PARTIALLY_CLEARED',
  FEE_JOURNAL_PENDING: 'FEE_JOURNAL_PENDING',
  FULLY_CLEARED: 'FULLY_CLEARED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  POSTING_UNCERTAIN: 'POSTING_UNCERTAIN',
})

const COMPONENT = Object.freeze({
  NET: 'NET',
  FEE: 'FEE',
  CUSTOMER_ADVANCE: 'CUSTOMER_ADVANCE',
  CUSTOMER_ADVANCE_REFUND: 'CUSTOMER_ADVANCE_REFUND',
  PAYOUT_FEE_JOURNAL: 'PAYOUT_FEE_JOURNAL',
  REFUND_CREDIT_NOTE_REFUND: 'REFUND_CREDIT_NOTE_REFUND',
  REFUND_FEE_ADJUSTMENT: 'REFUND_FEE_ADJUSTMENT',
})

// Normal invoice refund (not a customer advance). LEGACY_VERIFIED: a manual credit note refund
// from before this workflow provably covers the Stripe refund; nothing is posted.
const NORMAL_REFUND_STATUS = Object.freeze({
  DETECTED: 'DETECTED',
  MATCHED: 'MATCHED',
  READY: 'READY',
  POSTED: 'POSTED',
  VERIFIED: 'VERIFIED',
  LEGACY_VERIFIED: 'LEGACY_VERIFIED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  MISMATCH: 'MISMATCH',
  FAILED: 'FAILED',
  POSTING_UNCERTAIN: 'POSTING_UNCERTAIN',
})

const REFUND_KIND = Object.freeze({
  PARTIAL_REFUND: 'PARTIAL_REFUND',
  FULL_REFUND: 'FULL_REFUND',
})

const NORMAL_REFUND_DONE = new Set([NORMAL_REFUND_STATUS.VERIFIED, NORMAL_REFUND_STATUS.LEGACY_VERIFIED])
const NORMAL_REFUND_REVIEW = new Set([NORMAL_REFUND_STATUS.NEEDS_REVIEW, NORMAL_REFUND_STATUS.MISMATCH])

// WAITING: customer clearing is not complete. LEGACY_VERIFIED: a manual (pre-automation)
// journal provably covers these fees. NOT_REQUIRED: the payout carries no Stripe fees.
const FEE_JOURNAL_STATUS = Object.freeze({
  WAITING: 'WAITING',
  READY: 'READY',
  VERIFIED: 'VERIFIED',
  LEGACY_VERIFIED: 'LEGACY_VERIFIED',
  NOT_REQUIRED: 'NOT_REQUIRED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  POSTING_UNCERTAIN: 'POSTING_UNCERTAIN',
})

const LEGACY_STATE = Object.freeze({
  MATCHED: 'MATCHED',
  NONE: 'NONE',
  AMBIGUOUS: 'AMBIGUOUS',
  ERROR: 'ERROR',
})

const ZOHO_STATE = Object.freeze({
  MISSING: 'MISSING',
  VERIFIED: 'VERIFIED',
  CONFLICT: 'CONFLICT',
})

const RECOVERY_ACTION = Object.freeze({
  SKIP_VERIFIED: 'SKIP_VERIFIED',
  POST_ELIGIBLE: 'POST_ELIGIBLE',
  RETRY_ELIGIBLE: 'RETRY_ELIGIBLE',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  // Zoho may hold the record: nothing is sent until an admin confirms it was not created.
  POSTING_UNCERTAIN: 'POSTING_UNCERTAIN',
})

const UNCERTAIN_REASON = 'Zoho response uncertain — do not repost. Recheck Zoho; only an admin who has confirmed the record was not created can allow a retry.'

const COMPLETE_GROUP = new Set([GROUP_STATUS.POSTED, GROUP_STATUS.ALREADY_POSTED])
const POSTABLE_GROUP = new Set([GROUP_STATUS.READY, GROUP_STATUS.READY_WITH_CUSTOMER_ADVANCE, GROUP_STATUS.PARTIALLY_POSTED])

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function toMinor(major) {
  return Math.round((Number(major) || 0) * 100)
}

function toMajor(minor) {
  return Math.round(Number(minor) || 0) / 100
}

const netReference = (payoutId) => `Stripe funds received ${payoutId}`
const feeReference = (payoutId) => `Stripe processing fee ${payoutId}`
const advanceReference = (payoutId) => `Stripe customer advance ${payoutId}`
const advanceRefundReference = (payoutId) => `Stripe customer advance refund ${payoutId}`
const payoutFeeReference = (payoutId) => `Stripe processing fees ${payoutId}`
const normalRefundReference = (refundId) => `Stripe refund ${refundId}`
const refundFeeReference = (refundId) => `Stripe refund fee ${refundId}`

/** References this workflow writes itself; such a journal is never a legacy fee journal. */
function isAutomatedReference(reference) {
  return /^Stripe (?:(?:processing fees?|funds received|customer advance(?: refund)?) po_|refund (?:fee )?re_)/.test(clean(reference))
}

/** Drop undefined keys so previews show exactly what JSON would send. */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function customerPaymentPayload(component, customerId, date, paymentMode) {
  return plain(buildCustomerPaymentPayload({
    customerId,
    paymentMode,
    amount: component.amount,
    paymentDate: date,
    referenceNumber: component.reference,
    depositToAccountId: component.depositAccountId,
    invoices: component.allocations.map((a) => ({ invoiceId: a.invoiceId, amountApplied: a.amount })),
  }))
}

/** Customer tag goes on the liability (credit for an advance, debit for its refund) line only. */
function advanceJournalPayload(component, customerId, date) {
  const debitTagged = component.component === COMPONENT.CUSTOMER_ADVANCE_REFUND
  return plain(buildManualJournalPayload({
    date,
    referenceNumber: component.reference,
    lineItems: [
      { accountId: component.debitAccountId, customerId: debitTagged ? customerId : undefined, debitOrCredit: 'debit', amount: component.amount },
      { accountId: component.creditAccountId, customerId: debitTagged ? undefined : customerId, debitOrCredit: 'credit', amount: component.amount },
    ],
  }))
}

/** One debit line (Stripe Fees) and one credit line (1013) for the payout total; never tagged. */
function payoutFeeJournalPayload(component, date) {
  return plain(buildManualJournalPayload({
    date,
    referenceNumber: component.reference,
    lineItems: [
      { accountId: component.debitAccountId, debitOrCredit: 'debit', amount: component.amount },
      { accountId: component.creditAccountId, debitOrCredit: 'credit', amount: component.amount },
    ],
  }))
}

const FEE_JOURNAL_DIRECTION = Object.freeze({
  FEE_EXPENSE: 'FEE_EXPENSE',
  FEE_REVERSAL: 'FEE_REVERSAL',
})

/**
 * Accounts of the payout fee journal from the payout's signed Stripe fee total (the 1013 balance
 * left by the FEE payments and refund fee adjustments). > 0: Dr Stripe Fees / Cr 1013;
 * < 0: Dr 1013 / Cr Stripe Fees for the absolute amount; 0: no journal.
 */
function payoutFeeJournalAccounts(signedFeeMinor, feeExpenseAccountId, feeAccountId) {
  if (!signedFeeMinor) return null
  return signedFeeMinor > 0
    ? { direction: FEE_JOURNAL_DIRECTION.FEE_EXPENSE, debitAccountId: feeExpenseAccountId, creditAccountId: feeAccountId }
    : { direction: FEE_JOURNAL_DIRECTION.FEE_REVERSAL, debitAccountId: feeAccountId, creditAccountId: feeExpenseAccountId }
}

const FEE_JOURNAL_LABELS = { debit: 'Stripe Fees', credit: 'Stripe Processing Chg Un-Cleared', name: 'the payout fee journal' }
const FEE_REVERSAL_LABELS = { debit: 'Stripe Processing Chg Un-Cleared', credit: 'Stripe Fees', name: 'the payout fee journal' }

function payoutFeeJournalLabels(direction) {
  return direction === FEE_JOURNAL_DIRECTION.FEE_REVERSAL ? FEE_REVERSAL_LABELS : FEE_JOURNAL_LABELS
}

/** Differences between an existing Zoho journal and a proposed untagged two-line journal. */
function compareFeeJournal(journal, component, date, labels = FEE_JOURNAL_LABELS) {
  if (!journal) return ['The Zoho journal could not be read.']
  const differences = []
  if (journal.referenceNumber !== component.reference) differences.push(`Reference is "${journal.referenceNumber}".`)
  if (journal.journalDate !== date) differences.push(`Journal date is ${journal.journalDate}, expected ${date}.`)
  const lines = journal.lineItems || []
  const debits = lines.filter((l) => l.debitOrCredit === 'debit')
  const credits = lines.filter((l) => l.debitOrCredit === 'credit')
  if (debits.length !== 1 || credits.length !== 1 || lines.length !== 2) {
    differences.push(`Journal has ${debits.length} debit and ${credits.length} credit line(s); expected one of each.`)
    return differences
  }
  const [dr] = debits
  const [cr] = credits
  if (dr.accountId !== component.debitAccountId) differences.push(`Debit account is ${dr.accountName || dr.accountId}, not ${labels.debit}.`)
  if (cr.accountId !== component.creditAccountId) differences.push(`Credit account is ${cr.accountName || cr.accountId}, not ${labels.credit}.`)
  if (toMinor(dr.amount) !== toMinor(component.amount)) differences.push(`Debit ${dr.amount}, expected ${component.amount}.`)
  if (toMinor(cr.amount) !== toMinor(component.amount)) differences.push(`Credit ${cr.amount}, expected ${component.amount}.`)
  if (lines.some((l) => l.customerId)) differences.push(`A line is tagged to a customer; ${labels.name} is untagged.`)
  return differences
}

/**
 * Whether a manual (pre-automation) journal provably carries this payout's fees: published,
 * credits 1013 by at least the total, and debits Stripe Fees either with one line equal to
 * the payout total or with a separate line equal to each customer's verified FEE payment.
 * A reversal (negative payout fee) must mirror it: debit 1013 by at least the total and credit
 * Stripe Fees with one line equal to the total.
 * @param {null|{ status?: string, lineItems: Array<{ accountId: string, debitOrCredit: string, amount: number }> }} journal
 * @param {{ feeExpenseAccountId: string, clearingAccountId: string, totalMinor: number, feeMinors: number[], direction?: string }} expected
 */
function matchLegacyFeeJournal(journal, expected) {
  if (!journal || (journal.status && journal.status !== 'published')) return { matched: false }
  const reversal = expected.direction === FEE_JOURNAL_DIRECTION.FEE_REVERSAL
  const clearingSide = reversal ? 'debit' : 'credit'
  const expenseSide = reversal ? 'credit' : 'debit'
  const lines = journal.lineItems || []
  const cleared = lines.filter((l) => l.debitOrCredit === clearingSide && l.accountId === expected.clearingAccountId).reduce((s, l) => s + toMinor(l.amount), 0)
  if (cleared < expected.totalMinor) return { matched: false }
  const debits = lines.filter((l) => l.debitOrCredit === expenseSide && l.accountId === expected.feeExpenseAccountId).map((l) => toMinor(l.amount))
  if (debits.includes(expected.totalMinor)) return { matched: true, how: 'TOTAL_LINE', lines: [toMajor(expected.totalMinor)] }
  if (reversal) return { matched: false }
  const pool = [...debits]
  for (const minor of expected.feeMinors) {
    const at = pool.indexOf(minor)
    if (at < 0) return { matched: false }
    pool.splice(at, 1)
  }
  return expected.feeMinors.length > 0 ? { matched: true, how: 'CUSTOMER_FEE_LINES', lines: expected.feeMinors.map(toMajor) } : { matched: false }
}

/** The date the component posts on: its own date, else its Zoho payload's. */
function proposedDate(component) {
  const p = component.payload || {}
  return clean(component.date || p.journal_date || p.date)
}

/** Differences between an existing Zoho customer payment and the proposed NET/FEE component. */
function compareCustomerPayment(detail, component, customerId) {
  if (!detail) return ['The Zoho payment could not be read.']
  const differences = []
  const date = proposedDate(component)
  if (clean(detail.reference_number) !== component.reference) differences.push(`Reference is "${clean(detail.reference_number)}".`)
  if (clean(detail.customer_id) !== customerId) differences.push(`Customer is ${detail.customer_name || detail.customer_id}.`)
  if (clean(detail.date) !== date) differences.push(`Payment date is ${clean(detail.date) || 'missing'}, proposed ${date || 'missing'}.`)
  if (toMinor(detail.amount) !== toMinor(component.amount)) differences.push(`Amount ${detail.amount}, proposed ${component.amount}.`)
  if (clean(detail.account_id) !== component.depositAccountId) differences.push(`Deposited to ${detail.account_name || detail.account_id}.`)
  const existing = new Map()
  for (const inv of detail.invoices || []) existing.set(clean(inv.invoice_id), (existing.get(clean(inv.invoice_id)) || 0) + toMinor(inv.amount_applied))
  const proposed = new Map(component.allocations.map((a) => [a.invoiceId, toMinor(a.amount)]))
  for (const [id, minor] of proposed) {
    if (!existing.has(id)) differences.push(`Invoice ${id} is not allocated in Zoho.`)
    else if (existing.get(id) !== minor) differences.push(`Invoice ${id}: Zoho ${toMajor(existing.get(id))}, proposed ${toMajor(minor)}.`)
  }
  for (const id of existing.keys()) if (!proposed.has(id)) differences.push(`Zoho also allocates invoice ${id}.`)
  return differences
}

/** Customer the journal is tagged to on its liability line, or '' when untagged. */
function journalCustomer(journal, liabilityAccountId) {
  const tagged = (journal.lineItems || []).filter((l) => l.accountId === liabilityAccountId && l.customerId)
  return tagged.length > 0 ? tagged[0].customerId : ''
}

/** Differences between an existing advance (or advance refund) journal and the proposal. */
function compareAdvanceJournal(journal, component, customerId) {
  if (!journal) return ['The Zoho journal could not be read.']
  const differences = []
  const date = proposedDate(component)
  if (journal.referenceNumber !== component.reference) differences.push(`Reference is "${journal.referenceNumber}".`)
  // Only the gate check of an earlier payout's advance journal has no date; every posted component has one.
  if (date && clean(journal.journalDate) !== date) differences.push(`Journal date is ${clean(journal.journalDate) || 'missing'}, proposed ${date}.`)
  const lines = journal.lineItems || []
  const debits = lines.filter((l) => l.debitOrCredit === 'debit')
  const credits = lines.filter((l) => l.debitOrCredit === 'credit')
  if (debits.length !== 1 || credits.length !== 1) {
    differences.push(`Journal has ${debits.length} debit and ${credits.length} credit line(s); expected one of each.`)
    return differences
  }
  const [dr] = debits
  const [cr] = credits
  if (dr.accountId !== component.debitAccountId) differences.push(`Debit account is ${dr.accountName || dr.accountId}.`)
  if (cr.accountId !== component.creditAccountId) differences.push(`Credit account is ${cr.accountName || cr.accountId}.`)
  if (toMinor(dr.amount) !== toMinor(component.amount)) differences.push(`Debit ${dr.amount}, proposed ${component.amount}.`)
  if (toMinor(cr.amount) !== toMinor(component.amount)) differences.push(`Credit ${cr.amount}, proposed ${component.amount}.`)
  const liability = component.component === COMPONENT.CUSTOMER_ADVANCE_REFUND ? dr : cr
  if (liability.customerId !== customerId) {
    differences.push(liability.customerId ? `Customer Advance line is tagged to ${liability.customerId}.` : 'Customer Advance line has no customer tag.')
  }
  return differences
}

/**
 * Decide what may happen to one component given what Zoho holds and the local record.
 * @param {{ state: string, recordId?: string|null, reason?: string }} zoho
 * @param {null|{ status: string, zohoRecordId: string|null, attemptCount: number }} local
 */
function planRecovery(zoho, local) {
  const status = local ? local.status : null
  if (zoho.state === ZOHO_STATE.CONFLICT) return { action: RECOVERY_ACTION.NEEDS_REVIEW, reason: zoho.reason || 'Zoho holds a conflicting record.' }
  if (zoho.state === ZOHO_STATE.VERIFIED) {
    if (local && local.zohoRecordId && local.zohoRecordId !== zoho.recordId) {
      return { action: RECOVERY_ACTION.NEEDS_REVIEW, reason: `Local record points to Zoho ${local.zohoRecordId}, but Zoho has ${zoho.recordId}.` }
    }
    return { action: RECOVERY_ACTION.SKIP_VERIFIED, reason: `Verified in Zoho (${zoho.recordId}); will not be recreated.` }
  }
  // An unresolved attempt (uncertain, or interrupted mid-POST) is never re-sent on its own,
  // however many later searches still find nothing.
  if (status === 'POSTING_UNCERTAIN' || status === 'POSTING') return { action: RECOVERY_ACTION.POSTING_UNCERTAIN, reason: UNCERTAIN_REASON }
  if (status === 'POSTED' || status === 'VERIFIED') {
    return { action: RECOVERY_ACTION.NEEDS_REVIEW, reason: `Recorded as ${status} (${local.zohoRecordId || 'no ID'}) but Zoho no longer has it.` }
  }
  if (status === 'NEEDS_REVIEW') return { action: RECOVERY_ACTION.NEEDS_REVIEW, reason: 'Component is flagged for review locally.' }
  if (status === 'FAILED' && local.retryAuthorizedAt) {
    return { action: RECOVERY_ACTION.RETRY_ELIGIBLE, reason: `Retry allowed by ${local.retryAuthorizedBy} after confirming in Zoho that the uncertain attempt created nothing.` }
  }
  if (status === 'FAILED' || (local && local.attemptCount > 0)) {
    return { action: RECOVERY_ACTION.RETRY_ELIGIBLE, reason: 'Zoho rejected the earlier attempt and holds no record; eligible for retry.' }
  }
  return { action: RECOVERY_ACTION.POST_ELIGIBLE, reason: 'Not in Zoho yet.' }
}

/**
 * @param {{ blockers: string[], components: Array<{ component: string, recovery: { action: string }, localStatus: string|null }>, hasAdvance: boolean }} input
 */
function deriveGroupStatus({ blockers, components, hasAdvance }) {
  const actions = components.map((c) => c.recovery.action)
  const uncertain = components.filter((c) => c.recovery.action === RECOVERY_ACTION.POSTING_UNCERTAIN)
  if (uncertain.length > 0) return { status: GROUP_STATUS.POSTING_UNCERTAIN, reasons: uncertain.map((c) => `${c.component}: ${c.recovery.reason}`) }
  const review = components.filter((c) => c.recovery.action === RECOVERY_ACTION.NEEDS_REVIEW)
  const reasons = [...blockers, ...review.map((c) => `${c.component}: ${c.recovery.reason}`)]
  const verified = actions.filter((a) => a === RECOVERY_ACTION.SKIP_VERIFIED).length
  const allVerified = components.length > 0 && verified === components.length
  if (allVerified && review.length === 0 && blockers.length === 0) {
    const tracked = components.every((c) => c.localStatus === 'VERIFIED')
    return tracked
      ? { status: GROUP_STATUS.POSTED, reasons: ['Every component is posted and verified in Zoho.'] }
      : { status: GROUP_STATUS.ALREADY_POSTED, reasons: ['Every component already exists in Zoho and matches this payout.'] }
  }
  if (reasons.length > 0) return { status: GROUP_STATUS.NEEDS_REVIEW, reasons }
  if (verified > 0) {
    const pending = components.filter((c) => c.recovery.action !== RECOVERY_ACTION.SKIP_VERIFIED).map((c) => c.component)
    return { status: GROUP_STATUS.PARTIALLY_POSTED, reasons: [`Verified components are kept; still to post: ${pending.join(', ')}.`] }
  }
  return hasAdvance
    ? { status: GROUP_STATUS.READY_WITH_CUSTOMER_ADVANCE, reasons: ['Includes an admin-confirmed customer advance.'] }
    : { status: GROUP_STATUS.READY, reasons: [] }
}

/**
 * Whether a refund already on an overpaid charge is exactly the customer advance, returned
 * after the original payout. A later refund never changes the original payout's figures;
 * anything that is not provably that one refund is a mismatch.
 * @param {{
 *   chargeId: string, paymentIntentId: string, chargeStatus: string|null, chargeFullyRefunded: boolean,
 *   chargeRefundedMinor: number, overpaymentMinor: number, currency: string,
 *   payoutCreatedAt: string|null, payoutBalanceTransactionIds: Set<string>,
 *   refunds: Array<{ refundId: string, chargeId: string|null, paymentIntentId: string|null, amountMinor: number, currency: string, status: string, createdAt: string|null,
 *     balanceTransaction: null|{ balanceTransactionId: string, currency: string, amountMinor: number, feeMinor: number, netMinor: number } }>,
 *   storedCase: null|{ refundId: string|null, refundBalanceTransactionId: string|null, refundStatus: string, refundPayoutId: string|null },
 * }} input
 */
function assessAdvanceRefund(input) {
  const { refunds, overpaymentMinor, currency } = input
  const summary = refunds.map((r) => ({
    refundId: r.refundId,
    amount: toMajor(r.amountMinor),
    status: r.status,
    createdAt: r.createdAt,
    balanceTransactionId: r.balanceTransaction ? r.balanceTransaction.balanceTransactionId : null,
  }))
  const mismatch = (reason) => ({ ok: false, status: 'REFUND_MISMATCH', reason, refund: null, refunds: summary, refundedAmount: toMajor(input.chargeRefundedMinor) })
  const over = toMajor(overpaymentMinor)

  if (input.chargeStatus !== 'succeeded') return mismatch(`Stripe charge status is ${input.chargeStatus || 'unknown'}.`)
  if (input.chargeFullyRefunded) return mismatch('Stripe charge is fully refunded.')
  if (refunds.length === 0) return mismatch(`Stripe reports ${toMajor(input.chargeRefundedMinor)} refunded but lists no refund.`)
  if (refunds.length > 1) return mismatch(`${refunds.length} refunds exist on this charge; only one refund of exactly the overpayment ${over} can be linked.`)
  const [r] = refunds
  if (r.chargeId !== input.chargeId || r.paymentIntentId !== input.paymentIntentId) return mismatch(`Refund ${r.refundId} is not on charge ${input.chargeId} / ${input.paymentIntentId}.`)
  if (r.status !== 'succeeded') return mismatch(`Refund ${r.refundId} status is ${r.status}.`)
  if (r.currency !== currency) return mismatch(`Refund ${r.refundId} is in ${r.currency}, not ${currency}.`)
  if (r.amountMinor !== overpaymentMinor) {
    return mismatch(`Refund ${toMajor(r.amountMinor)} is ${r.amountMinor < overpaymentMinor ? 'less' : 'more'} than the overpayment ${over}.`)
  }
  if (input.chargeRefundedMinor !== overpaymentMinor) return mismatch(`Stripe charge shows ${toMajor(input.chargeRefundedMinor)} refunded, not ${over}.`)
  const bt = r.balanceTransaction
  if (!bt) return mismatch(`Refund ${r.refundId} has no balance transaction yet.`)
  if (bt.feeMinor !== 0) return mismatch(`Refund balance transaction ${bt.balanceTransactionId} has a fee of ${toMajor(bt.feeMinor)}.`)
  if (bt.amountMinor !== -overpaymentMinor || bt.netMinor !== -overpaymentMinor || bt.currency !== currency) {
    return mismatch(`Refund balance transaction ${bt.balanceTransactionId} is ${toMajor(bt.netMinor)} ${bt.currency}, not -${over} ${currency}.`)
  }
  if (input.payoutBalanceTransactionIds.has(bt.balanceTransactionId)) {
    return mismatch(`Refund ${r.refundId} is inside the original payout; it is not a later refund.`)
  }
  const refundAt = Date.parse(r.createdAt)
  const payoutAt = Date.parse(input.payoutCreatedAt)
  if (!Number.isFinite(refundAt) || !Number.isFinite(payoutAt) || refundAt <= payoutAt) {
    return mismatch(`Refund ${r.refundId} was not created after the original payout (${r.createdAt} vs ${input.payoutCreatedAt}).`)
  }
  const stored = input.storedCase
  if (stored && stored.refundId && stored.refundId !== r.refundId) return mismatch(`Case records refund ${stored.refundId}, but Stripe shows ${r.refundId}.`)
  if (stored && stored.refundBalanceTransactionId && stored.refundBalanceTransactionId !== bt.balanceTransactionId) {
    return mismatch(`Case records refund balance transaction ${stored.refundBalanceTransactionId}, but Stripe shows ${bt.balanceTransactionId}.`)
  }
  const later = stored && ['REFUND_MATCHED', 'REFUNDED'].includes(stored.refundStatus)
  return {
    ok: true,
    status: later ? stored.refundStatus : 'REFUND_DETECTED',
    reason: `Refund ${r.refundId} of ${over} equals the overpayment and belongs to a later payout.`,
    refunds: summary,
    refundedAmount: over,
    refund: {
      refundId: r.refundId,
      balanceTransactionId: bt.balanceTransactionId,
      amount: over,
      fee: 0,
      net: toMajor(bt.netMinor),
      currency: r.currency,
      status: r.status,
      createdAt: r.createdAt,
      refundPayoutId: later ? stored.refundPayoutId : null,
    },
  }
}

const REFUND_POSTABLE_CASE = new Set(['CONFIRMED', 'ADVANCE_POSTED'])

/**
 * The refund journal (Dr 1123 / Cr 1019) may only follow a verified advance journal,
 * so Customer Advance Funds can never go negative for the customer.
 */
function refundPostingGate({ caseStatus, originalAdvanceJournalState, refundStatus, refundMinor, overpaymentMinor, postingEnabled }) {
  const blockers = []
  if (!REFUND_POSTABLE_CASE.has(caseStatus)) blockers.push(`Customer advance case is ${caseStatus}, not confirmed.`)
  if (originalAdvanceJournalState !== ZOHO_STATE.VERIFIED) blockers.push('The original Customer Advance journal is not verified in Zoho yet.')
  if (refundStatus !== 'REFUND_MATCHED') blockers.push(`Refund status is ${refundStatus}, not REFUND_MATCHED.`)
  if (refundMinor !== overpaymentMinor) blockers.push(`Refund ${toMajor(refundMinor)} does not equal the advance ${toMajor(overpaymentMinor)}.`)
  if (!postingEnabled) blockers.push('Posting is disabled.')
  return { allowed: blockers.length === 0, blockers }
}

// ── Normal invoice refunds ──────────────────────────────────────────────────

const LIVE_REFUND = new Set(['succeeded', 'pending'])

function refundSummary(r) {
  return { refundId: r.refundId, amount: toMajor(r.amountMinor), status: r.status, createdAt: r.createdAt || null }
}

/**
 * Partial vs full from the cumulative Stripe refunds on the charge, in Stripe creation order:
 * FULL once refunds up to and including this one reach the invoice total. Going past the
 * invoice total is never allocated away.
 * @param {{ refundId: string, refundMinor: number, invoiceTotalMinor: number,
 *   chargeRefunds: Array<{ refundId: string, amountMinor: number, status: string, createdAt: string|null }> }} input
 */
function classifyNormalRefund({ refundId, refundMinor, invoiceTotalMinor, chargeRefunds }) {
  const live = chargeRefunds.filter((r) => LIVE_REFUND.has(r.status))
  const ordered = [...live].sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || String(a.refundId).localeCompare(String(b.refundId)))
  const at = ordered.findIndex((r) => r.refundId === refundId)
  if (at < 0) return { code: 'REFUND_NOT_ON_CHARGE', problem: `Stripe does not list refund ${refundId} as succeeded on its charge.` }
  if (ordered[at].amountMinor !== refundMinor) {
    return { code: 'REFUND_AMOUNT_MISMATCH', problem: `Stripe lists refund ${refundId} as ${money(ordered[at].amountMinor)}, but its balance transaction is ${money(refundMinor)}.` }
  }
  const priorMinor = ordered.slice(0, at).reduce((s, r) => s + r.amountMinor, 0)
  const cumulativeMinor = priorMinor + refundMinor
  const base = {
    priorRefunds: ordered.slice(0, at).map(refundSummary),
    laterRefunds: ordered.slice(at + 1).map(refundSummary),
    sequence: at + 1,
    refundCount: ordered.length,
    priorRefundedMinor: priorMinor,
    cumulativeMinor,
    totalRefundedMinor: ordered.reduce((s, r) => s + r.amountMinor, 0),
    remainingMinor: invoiceTotalMinor - cumulativeMinor,
  }
  if (refundMinor <= 0) return { ...base, code: 'REFUND_NOT_POSITIVE', problem: `Refund ${refundId} amount is ${money(refundMinor)}.` }
  if (invoiceTotalMinor <= 0) return { ...base, code: 'INVOICE_TOTAL_INVALID', problem: `Invoice total is ${money(invoiceTotalMinor)}.` }
  if (cumulativeMinor > invoiceTotalMinor) {
    return {
      ...base,
      code: 'REFUND_EXCEEDS_INVOICE',
      problem: `Refunds up to and including ${refundId} total ${money(cumulativeMinor)}, more than the invoice total ${money(invoiceTotalMinor)}.`,
    }
  }
  return { ...base, code: null, problem: null, kind: cumulativeMinor === invoiceTotalMinor ? REFUND_KIND.FULL_REFUND : REFUND_KIND.PARTIAL_REFUND }
}

/**
 * Which existing Zoho credit note this Stripe refund is paid from. Credit notes are never
 * created here (they come from warehouse returns); equally plausible candidates are never
 * chosen between.
 * Order: a credit note refund already carrying this refund's reference; a single manual
 * (pre-workflow) refund from the Stripe clearing account of exactly this amount; a single
 * credit note whose total is this refund; a single credit note whose total is every refund on
 * the charge.
 * @param {{ reference: string, grossMinor: number, depositAccountId: string,
 *   siblingRefunds: Array<{ refundId: string, amountMinor: number }>,
 *   creditNotes: Array<{ creditNoteId: string, creditNoteNumber: string, status: string, totalMinor: number, balanceMinor: number,
 *     refunds: Array<{ creditNoteRefundId: string, referenceNumber: string, amountMinor: number, fromAccountId: string|null, date: string|null }> }> }} input
 */
function selectCreditNote({ reference, grossMinor, depositAccountId, siblingRefunds, creditNotes }) {
  const problem = (code, reason, status = NORMAL_REFUND_STATUS.NEEDS_REVIEW) => ({ outcome: 'PROBLEM', code, status, reason })
  const live = creditNotes.filter((c) => c.status !== 'void')
  const ours = live.flatMap((c) => c.refunds.filter((r) => clean(r.referenceNumber) === reference).map((r) => ({ creditNote: c, refund: r })))
  if (ours.length > 1) {
    return problem('ZOHO_DUPLICATE_REFUND', `${ours.length} Zoho credit note refunds carry "${reference}": ${ours.map((o) => `${o.creditNote.creditNoteNumber}/${o.refund.creditNoteRefundId}`).join(', ')}.`)
  }
  if (ours.length === 1) return { outcome: 'OURS', creditNote: ours[0].creditNote, how: 'REFERENCE' }

  const siblingAmounts = siblingRefunds.map((s) => s.amountMinor)
  const manual = live.flatMap((c) => c.refunds.filter((r) => clean(r.fromAccountId) === depositAccountId).map((r) => ({ creditNote: c, refund: r })))
  const legacy = manual.filter((m) => m.refund.amountMinor === grossMinor)
  if (legacy.length > 0) {
    if (legacy.length > 1 || siblingAmounts.includes(grossMinor)) {
      return problem('LEGACY_REFUND_AMBIGUOUS', `Manual Stripe credit note refund(s) of ${money(grossMinor)} cannot be tied to one Stripe refund: ${legacy.map((m) => `${m.creditNote.creditNoteNumber} "${m.refund.referenceNumber}"`).join(', ')}.`)
    }
    return { outcome: 'LEGACY', creditNote: legacy[0].creditNote, legacyRefund: legacy[0].refund, how: 'LEGACY_MANUAL_REFUND' }
  }
  // Manual Stripe refunds that are not this one must each be one of the charge's other refunds.
  const pool = [...siblingAmounts]
  for (const m of manual) {
    const i = pool.indexOf(m.refund.amountMinor)
    if (i < 0) {
      return problem('MANUAL_STRIPE_REFUND_UNEXPLAINED', `Credit note ${m.creditNote.creditNoteNumber} already has a manual Stripe refund of ${money(m.refund.amountMinor)} ("${m.refund.referenceNumber}") that no Stripe refund on this charge explains.`)
    }
    pool.splice(i, 1)
  }

  const usable = live.filter((c) => c.status !== 'draft')
  if (usable.length === 0) {
    return live.length > 0
      ? problem('CREDIT_NOTE_DRAFT', `Credit note ${live.map((c) => c.creditNoteNumber).join(', ')} is still a draft in Zoho.`)
      : problem('CREDIT_NOTE_MISSING', 'No Zoho credit note exists for this order and invoice yet (the warehouse return has not been booked).')
  }
  const exact = usable.filter((c) => c.totalMinor === grossMinor)
  if (exact.length === 1 && !siblingAmounts.includes(grossMinor)) return withBalance(exact[0], 'CREDIT_NOTE_TOTAL', grossMinor)
  if (exact.length > 1 || (exact.length === 1 && siblingAmounts.includes(grossMinor))) {
    return problem('CREDIT_NOTE_AMBIGUOUS', `More than one credit note or Stripe refund of ${money(grossMinor)} on this order; cannot tell which pair belongs together (${usable.map((c) => c.creditNoteNumber).join(', ')}).`)
  }
  const allRefundsMinor = grossMinor + siblingAmounts.reduce((s, m) => s + m, 0)
  if (usable.length === 1 && usable[0].totalMinor === allRefundsMinor) return withBalance(usable[0], 'SHARED_CREDIT_NOTE', grossMinor)
  return problem(
    'CREDIT_NOTE_AMOUNT_MISMATCH',
    `Stripe refunded ${money(grossMinor)}${siblingAmounts.length ? ` (${money(allRefundsMinor)} across ${siblingAmounts.length + 1} refunds)` : ''}, but the credit note total${usable.length > 1 ? 's are' : ' is'} ${usable.map((c) => `${c.creditNoteNumber} ${money(c.totalMinor)}`).join(', ')}.`,
    NORMAL_REFUND_STATUS.MISMATCH,
  )

  function withBalance(creditNote, how) {
    if (creditNote.balanceMinor < grossMinor) {
      return problem('CREDIT_NOTE_BALANCE_INSUFFICIENT', `Credit note ${creditNote.creditNoteNumber} has ${money(creditNote.balanceMinor)} left to refund, less than the Stripe refund ${money(grossMinor)}.`, NORMAL_REFUND_STATUS.MISMATCH)
    }
    return { outcome: 'MATCHED', creditNote, how }
  }
}

/**
 * Items the credit note returns, proven against the original invoice lines: every credit
 * note line must point to an invoice line (or to the invoice's only line with that item) and
 * never return more than was invoiced. At least one line must be linked to an invoice line by
 * Zoho itself; otherwise the refund is money-only and items are not guessed.
 */
function proveReturnedItems(creditNote, invoice) {
  const fail = (reason) => ({ proven: false, reason, items: [] })
  const cnLines = creditNote.lineItems || []
  const invLines = invoice.lineItems || []
  if (cnLines.length === 0) return fail(`Credit note ${creditNote.creditNoteNumber} has no lines.`)
  const byLineId = new Map(invLines.map((l) => [clean(l.lineItemId), l]))
  const used = new Map()
  const items = []
  for (const l of cnLines) {
    const label = l.name || l.sku || l.itemId || 'line'
    let inv = null
    if (clean(l.invoiceItemId)) {
      inv = byLineId.get(clean(l.invoiceItemId)) || null
      if (!inv) return fail(`Credit note line "${label}" points to invoice line ${l.invoiceItemId}, which is not on ${invoice.invoiceNumber}.`)
    } else {
      const same = invLines.filter((x) => clean(x.itemId) && clean(x.itemId) === clean(l.itemId))
      if (same.length !== 1) return fail(`Credit note line "${label}" is not linked to exactly one line of ${invoice.invoiceNumber}.`)
      inv = same[0]
    }
    const key = clean(inv.lineItemId)
    const qty = (used.get(key) || 0) + (Number(l.quantity) || 0)
    if (qty > (Number(inv.quantity) || 0) + 1e-9) return fail(`Credit note returns ${qty} × "${label}", but ${invoice.invoiceNumber} has ${inv.quantity}.`)
    used.set(key, qty)
    items.push({
      name: l.name || null,
      sku: l.sku || null,
      itemId: l.itemId || null,
      quantity: Number(l.quantity) || 0,
      rate: Number(l.rate) || 0,
      total: Number(l.itemTotal) || 0,
      invoiceLineItemId: inv.lineItemId,
      linkedBy: clean(l.invoiceItemId) ? 'INVOICE_LINE' : 'INVOICE_ITEM',
    })
  }
  if (!items.some((i) => i.linkedBy === 'INVOICE_LINE')) {
    return fail(`No line of credit note ${creditNote.creditNoteNumber} is linked to an invoice line; the returned items cannot be proven.`)
  }
  return { proven: true, reason: null, items }
}

/** Zoho credit note refund body; no notes or description. */
function creditNoteRefundPayload(component, date, refundMode) {
  return plain({
    date,
    refund_mode: refundMode,
    reference_number: component.reference,
    amount: component.amount,
    from_account_id: component.depositAccountId,
  })
}

/** Differences between an existing Zoho credit note refund and the proposal. */
function compareCreditNoteRefund(detail, component) {
  if (!detail) return ['The Zoho credit note refund could not be read.']
  const differences = []
  if (clean(detail.referenceNumber) !== component.reference) differences.push(`Reference is "${clean(detail.referenceNumber)}".`)
  if (clean(detail.creditNoteId) !== component.creditNoteId) differences.push(`It refunds credit note ${detail.creditNoteId}, not ${component.creditNoteId}.`)
  if (toMinor(detail.amount) !== toMinor(component.amount)) differences.push(`Amount ${detail.amount}, proposed ${component.amount}.`)
  if (clean(detail.fromAccountId) !== component.depositAccountId) differences.push(`Paid from ${detail.fromAccountName || detail.fromAccountId}, not Stripe Undeposited Funds.`)
  if (clean(detail.date) !== component.date) differences.push(`Refund date is ${detail.date}, expected ${component.date}.`)
  return differences
}

/**
 * Stripe's fee on a refund balance transaction, booked between 1019 and 1013 so the clearing
 * accounts follow the refund's real net. fee < 0: Stripe returned fees (Dr 1019 / Cr 1013);
 * fee > 0: Stripe charged more (Dr 1013 / Cr 1019). Zero needs no journal.
 */
function refundFeeAdjustmentAccounts(feeMinor, depositAccountId, feeAccountId) {
  if (feeMinor === 0) return null
  return feeMinor < 0
    ? { debitAccountId: depositAccountId, creditAccountId: feeAccountId, direction: 'FEE_RETURNED' }
    : { debitAccountId: feeAccountId, creditAccountId: depositAccountId, direction: 'FEE_CHARGED' }
}

const REFUND_FEE_LABELS = { debit: 'the expected debit account', credit: 'the expected credit account', name: 'a refund fee journal' }

function compareRefundFeeJournal(journal, component) {
  return compareFeeJournal(journal, component, component.date, REFUND_FEE_LABELS)
}

/**
 * Status of one normal refund from its components' recovery (after matching succeeded).
 * @param {Array<{ component: string, recovery: { action: string, reason: string }, localStatus: string|null }>} components
 */
function deriveNormalRefundStatus(components) {
  const S = NORMAL_REFUND_STATUS
  const uncertain = components.filter((c) => c.recovery.action === RECOVERY_ACTION.POSTING_UNCERTAIN)
  if (uncertain.length > 0) {
    return { status: S.POSTING_UNCERTAIN, reasonCode: 'ZOHO_RESPONSE_UNCERTAIN', reasons: uncertain.map((c) => `${c.component}: ${c.recovery.reason}`), tracked: false }
  }
  const review = components.filter((c) => c.recovery.action === RECOVERY_ACTION.NEEDS_REVIEW)
  if (review.length > 0) {
    return { status: S.NEEDS_REVIEW, reasonCode: 'ZOHO_RECORD_CONFLICT', reasons: review.map((c) => `${c.component}: ${c.recovery.reason}`), tracked: false }
  }
  const verified = components.filter((c) => c.recovery.action === RECOVERY_ACTION.SKIP_VERIFIED)
  if (components.length > 0 && verified.length === components.length) {
    const tracked = components.every((c) => c.localStatus === 'VERIFIED')
    return {
      status: S.VERIFIED,
      reasonCode: tracked ? 'POSTED_AND_VERIFIED' : 'ALREADY_IN_ZOHO',
      reasons: [tracked ? 'Posted and verified in Zoho.' : 'Already in Zoho and matches exactly; posting records it locally without sending anything.'],
      tracked,
    }
  }
  if (verified.length > 0) {
    const pending = components.filter((c) => c.recovery.action !== RECOVERY_ACTION.SKIP_VERIFIED).map((c) => c.component)
    return { status: S.POSTED, reasonCode: 'PARTIALLY_POSTED', reasons: [`Verified components are kept; still to post: ${pending.join(', ')}.`], tracked: false }
  }
  if (components.some((c) => c.recovery.action === RECOVERY_ACTION.RETRY_ELIGIBLE)) {
    return { status: S.FAILED, reasonCode: 'RETRY_ELIGIBLE', reasons: components.map((c) => `${c.component}: ${c.recovery.reason}`), tracked: false }
  }
  return { status: S.READY, reasonCode: 'READY_TO_POST', reasons: [], tracked: false }
}

/** Groups never block each other; the payout is only fully cleared when every group is complete. */
const money = (minor) => toMajor(minor).toFixed(2)

/**
 * Status of the payout fee journal. Order matters: whatever Zoho already holds under the
 * deterministic reference wins; then customer clearing must be complete and verified; then
 * the verified FEE payments must equal Stripe's fee total; only then is a legacy journal
 * considered. Pass `legacy: undefined` to learn whether a legacy lookup is needed
 * (`needsLegacyCheck`), then call again with its result.
 * @param {{
 *   payoutBlockers: string[],
 *   groups: Array<{ customerName: string, status: string, components: Array<{ component: string, zoho: { state: string } }> }>,
 *   stripeFeeMinor: number,
 *   verifiedFeeMinor: number,
 *   accountProblems: string[],
 *   zoho: { state: string, recordId?: string|null, reason?: string },
 *   local: null|{ status: string, zohoRecordId: string|null, attemptCount: number },
 *   legacy?: { state: string, reason?: string },
 *   refundAdjustments?: Array<{ refundId: string, feeMinor: number, zohoState: string }>,
 *   normalRefundCount?: number,
 * }} input
 */
function deriveFeeJournalStatus(input) {
  const { payoutBlockers, groups, stripeFeeMinor, verifiedFeeMinor, accountProblems, zoho, local, legacy } = input
  const refundAdjustments = input.refundAdjustments || []
  const normalRefundCount = input.normalRefundCount || 0
  const S = FEE_JOURNAL_STATUS
  const recovery = planRecovery(zoho, local)
  if (recovery.action === RECOVERY_ACTION.SKIP_VERIFIED) {
    const tracked = local && local.status === 'VERIFIED'
    return { status: S.VERIFIED, reasons: [tracked ? 'Posted and verified in Zoho.' : 'Already in Zoho and matches exactly; posting records it locally without sending anything.'], recovery }
  }
  if (recovery.action === RECOVERY_ACTION.NEEDS_REVIEW) return { status: S.NEEDS_REVIEW, reasons: [recovery.reason], recovery }
  if (recovery.action === RECOVERY_ACTION.POSTING_UNCERTAIN) return { status: S.POSTING_UNCERTAIN, reasons: [recovery.reason], recovery }
  const feeActivity = refundAdjustments.length > 0
    || groups.some((g) => g.components.some((c) => c.component === COMPONENT.FEE && toMinor(c.amount) !== 0))
  if (stripeFeeMinor === 0 && !local && !feeActivity) return { status: S.NOT_REQUIRED, reasons: ['The payout carries no Stripe fees.'], recovery }

  const waiting = []
  if (payoutBlockers.length > 0) waiting.push('The payout does not reconcile.')
  if (groups.length === 0 && normalRefundCount === 0) waiting.push('The payout has no customer groups.')
  const open = groups.filter((g) => !COMPLETE_GROUP.has(g.status))
  if (open.length > 0) waiting.push(`Customer group(s) not posted yet: ${open.map((g) => `${g.customerName} (${g.status.replace(/_/g, ' ')})`).join(', ')}.`)
  const unverified = groups.flatMap((g) => g.components.filter((c) => c.zoho.state !== ZOHO_STATE.VERIFIED).map((c) => `${g.customerName} ${c.component}`))
  if (open.length === 0 && unverified.length > 0) waiting.push(`Not verified in Zoho yet: ${unverified.join(', ')}.`)
  const pendingAdjustments = refundAdjustments.filter((a) => a.zohoState !== ZOHO_STATE.VERIFIED)
  if (pendingAdjustments.length > 0) {
    waiting.push(`Refund fee adjustment(s) not verified yet: ${pendingAdjustments.map((a) => `${a.refundId} (${money(a.feeMinor)})`).join(', ')}.`)
  }
  if (waiting.length > 0) return { status: S.WAITING, reasons: waiting, recovery }

  if (verifiedFeeMinor !== stripeFeeMinor) {
    const what = refundAdjustments.length > 0 ? 'Verified FEE payments and refund fee adjustments total' : 'Verified FEE payments total'
    return { status: S.NEEDS_REVIEW, reasons: [`${what} ${money(verifiedFeeMinor)}, but Stripe fees for this payout are ${money(stripeFeeMinor)}.`], recovery }
  }
  if (stripeFeeMinor === 0) {
    return { status: S.NOT_REQUIRED, reasons: ['The verified FEE payments and refund fee adjustments net to 0.00; 1013 is already cleared and no fee journal is needed.'], recovery }
  }
  if (accountProblems.length > 0) return { status: S.NEEDS_REVIEW, reasons: accountProblems, recovery }

  if (legacy === undefined) return { status: null, needsLegacyCheck: true, reasons: [], recovery }
  const legacyRecovery = { action: RECOVERY_ACTION.SKIP_VERIFIED, reason: 'Covered by a legacy Zoho journal; nothing will be posted.' }
  if (legacy.state === LEGACY_STATE.MATCHED) return { status: S.LEGACY_VERIFIED, reasons: [legacy.reason], recovery: legacyRecovery }
  if (legacy.state !== LEGACY_STATE.NONE) return { status: S.NEEDS_REVIEW, reasons: [legacy.reason || 'Legacy fee journals could not be checked.'], recovery }

  const untracked = groups.filter((g) => g.status === GROUP_STATUS.ALREADY_POSTED)
  if (untracked.length > 0) {
    return {
      status: S.NEEDS_REVIEW,
      reasons: [`${untracked.map((g) => g.customerName).join(' and ')} ${untracked.length === 1 ? 'was' : 'were'} posted outside this workflow and no journal covering these fees could be proven in Zoho. Confirm manually; it is not offered for posting, to avoid a duplicate.`],
      recovery,
    }
  }
  const move = stripeFeeMinor > 0
    ? `${money(stripeFeeMinor)} is ready to move from 1013 to Stripe Fees`
    : `Stripe returned ${money(-stripeFeeMinor)} more fees than it charged; it is ready to move from Stripe Fees back to 1013 (fee expense reversal)`
  return { status: S.READY, reasons: [`Every FEE payment and refund fee adjustment is verified; ${move}.`], recovery }
}

const FEE_JOURNAL_DONE = new Set([FEE_JOURNAL_STATUS.VERIFIED, FEE_JOURNAL_STATUS.LEGACY_VERIFIED, FEE_JOURNAL_STATUS.NOT_REQUIRED])

/**
 * FULLY_CLEARED needs every group complete, every normal refund verified (or covered by a
 * legacy refund), every matched customer advance refund journal verified, and the fee journal done.
 * @param {Array<{ status: string }>} groups
 * @param {string[]} payoutBlockers
 * @param {{ status: string }} feeJournal
 * @param {{ normal?: Array<{ status: string }>, advance?: Array<{ matched: boolean, refundJournal?: { state: string }|null }> }} [refunds]
 */
function derivePayoutStatus(groups, payoutBlockers, feeJournal, refunds = {}) {
  const normal = refunds.normal || []
  const advance = (refunds.advance || []).filter((r) => r.matched)
  // Zoho may already hold one of this payout's records: never cleared, never postable as usual.
  if (groups.some((g) => g.status === GROUP_STATUS.POSTING_UNCERTAIN) || normal.some((r) => r.status === NORMAL_REFUND_STATUS.POSTING_UNCERTAIN)
    || (feeJournal && feeJournal.status === FEE_JOURNAL_STATUS.POSTING_UNCERTAIN)) return PAYOUT_STATUS.POSTING_UNCERTAIN
  if (payoutBlockers.length > 0 || (groups.length === 0 && normal.length === 0 && advance.length === 0)) return PAYOUT_STATUS.NEEDS_REVIEW
  if (normal.some((r) => NORMAL_REFUND_REVIEW.has(r.status))) return PAYOUT_STATUS.NEEDS_REVIEW
  const refundsPending = normal.some((r) => !NORMAL_REFUND_DONE.has(r.status))
    || advance.some((r) => !r.refundJournal || r.refundJournal.state !== ZOHO_STATE.VERIFIED)
  const refundsStarted = normal.some((r) => NORMAL_REFUND_DONE.has(r.status) || r.status === NORMAL_REFUND_STATUS.POSTED)
  if (groups.every((g) => COMPLETE_GROUP.has(g.status))) {
    if (feeJournal && feeJournal.status === FEE_JOURNAL_STATUS.NEEDS_REVIEW) return PAYOUT_STATUS.NEEDS_REVIEW
    if (refundsPending) return groups.length > 0 || refundsStarted ? PAYOUT_STATUS.PARTIALLY_CLEARED : PAYOUT_STATUS.READY
    if (feeJournal && FEE_JOURNAL_DONE.has(feeJournal.status)) return PAYOUT_STATUS.FULLY_CLEARED
    return PAYOUT_STATUS.FEE_JOURNAL_PENDING
  }
  if (groups.some((g) => g.status === GROUP_STATUS.NEEDS_REVIEW)) return PAYOUT_STATUS.NEEDS_REVIEW
  if (refundsStarted || groups.some((g) => COMPLETE_GROUP.has(g.status) || g.status === GROUP_STATUS.PARTIALLY_POSTED)) return PAYOUT_STATUS.PARTIALLY_CLEARED
  return PAYOUT_STATUS.READY
}

module.exports = {
  GROUP_STATUS,
  PAYOUT_STATUS,
  COMPONENT,
  ZOHO_STATE,
  RECOVERY_ACTION,
  UNCERTAIN_REASON,
  FEE_JOURNAL_STATUS,
  LEGACY_STATE,
  COMPLETE_GROUP,
  POSTABLE_GROUP,
  NORMAL_REFUND_STATUS,
  NORMAL_REFUND_DONE,
  REFUND_KIND,
  netReference,
  feeReference,
  advanceReference,
  advanceRefundReference,
  payoutFeeReference,
  normalRefundReference,
  refundFeeReference,
  isAutomatedReference,
  customerPaymentPayload,
  advanceJournalPayload,
  payoutFeeJournalPayload,
  FEE_JOURNAL_DIRECTION,
  payoutFeeJournalAccounts,
  payoutFeeJournalLabels,
  creditNoteRefundPayload,
  compareCustomerPayment,
  compareAdvanceJournal,
  compareFeeJournal,
  compareCreditNoteRefund,
  compareRefundFeeJournal,
  classifyNormalRefund,
  selectCreditNote,
  proveReturnedItems,
  refundFeeAdjustmentAccounts,
  deriveNormalRefundStatus,
  matchLegacyFeeJournal,
  journalCustomer,
  planRecovery,
  deriveGroupStatus,
  deriveFeeJournalStatus,
  derivePayoutStatus,
  assessAdvanceRefund,
  refundPostingGate,
}
