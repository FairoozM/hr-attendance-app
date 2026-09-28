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
 */

const { buildCustomerPaymentPayload, buildManualJournalPayload } = require('../amazonPaymentClearingZohoPaymentService')

const GROUP_STATUS = Object.freeze({
  READY: 'READY',
  READY_WITH_CUSTOMER_ADVANCE: 'READY_WITH_CUSTOMER_ADVANCE',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  PARTIALLY_POSTED: 'PARTIALLY_POSTED',
  POSTED: 'POSTED',
  ALREADY_POSTED: 'ALREADY_POSTED',
})

// FEE_JOURNAL_PENDING: every customer group is posted; the payout fee journal is not verified yet.
const PAYOUT_STATUS = Object.freeze({
  READY: 'READY',
  PARTIALLY_CLEARED: 'PARTIALLY_CLEARED',
  FEE_JOURNAL_PENDING: 'FEE_JOURNAL_PENDING',
  FULLY_CLEARED: 'FULLY_CLEARED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
})

const COMPONENT = Object.freeze({
  NET: 'NET',
  FEE: 'FEE',
  CUSTOMER_ADVANCE: 'CUSTOMER_ADVANCE',
  CUSTOMER_ADVANCE_REFUND: 'CUSTOMER_ADVANCE_REFUND',
  PAYOUT_FEE_JOURNAL: 'PAYOUT_FEE_JOURNAL',
})

// WAITING: customer clearing is not complete. LEGACY_VERIFIED: a manual (pre-automation)
// journal provably covers these fees. NOT_REQUIRED: the payout carries no Stripe fees.
const FEE_JOURNAL_STATUS = Object.freeze({
  WAITING: 'WAITING',
  READY: 'READY',
  VERIFIED: 'VERIFIED',
  LEGACY_VERIFIED: 'LEGACY_VERIFIED',
  NOT_REQUIRED: 'NOT_REQUIRED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
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
})

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

/** References this workflow writes itself; such a journal is never a legacy fee journal. */
function isAutomatedReference(reference) {
  return /^Stripe (processing fees?|funds received|customer advance(?: refund)?) po_/.test(clean(reference))
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

/** Differences between an existing Zoho journal and the proposed payout fee journal. */
function compareFeeJournal(journal, component, date) {
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
  if (dr.accountId !== component.debitAccountId) differences.push(`Debit account is ${dr.accountName || dr.accountId}, not Stripe Fees.`)
  if (cr.accountId !== component.creditAccountId) differences.push(`Credit account is ${cr.accountName || cr.accountId}, not Stripe Processing Chg Un-Cleared.`)
  if (toMinor(dr.amount) !== toMinor(component.amount)) differences.push(`Debit ${dr.amount}, expected ${component.amount}.`)
  if (toMinor(cr.amount) !== toMinor(component.amount)) differences.push(`Credit ${cr.amount}, expected ${component.amount}.`)
  if (lines.some((l) => l.customerId)) differences.push('A line is tagged to a customer; the payout fee journal is untagged.')
  return differences
}

/**
 * Whether a manual (pre-automation) journal provably carries this payout's fees: published,
 * credits 1013 by at least the total, and debits Stripe Fees either with one line equal to
 * the payout total or with a separate line equal to each customer's verified FEE payment.
 * @param {null|{ status?: string, lineItems: Array<{ accountId: string, debitOrCredit: string, amount: number }> }} journal
 * @param {{ feeExpenseAccountId: string, clearingAccountId: string, totalMinor: number, feeMinors: number[] }} expected
 */
function matchLegacyFeeJournal(journal, expected) {
  if (!journal || (journal.status && journal.status !== 'published')) return { matched: false }
  const lines = journal.lineItems || []
  const credited = lines.filter((l) => l.debitOrCredit === 'credit' && l.accountId === expected.clearingAccountId).reduce((s, l) => s + toMinor(l.amount), 0)
  if (credited < expected.totalMinor) return { matched: false }
  const debits = lines.filter((l) => l.debitOrCredit === 'debit' && l.accountId === expected.feeExpenseAccountId).map((l) => toMinor(l.amount))
  if (debits.includes(expected.totalMinor)) return { matched: true, how: 'TOTAL_LINE', lines: [toMajor(expected.totalMinor)] }
  const pool = [...debits]
  for (const minor of expected.feeMinors) {
    const at = pool.indexOf(minor)
    if (at < 0) return { matched: false }
    pool.splice(at, 1)
  }
  return expected.feeMinors.length > 0 ? { matched: true, how: 'CUSTOMER_FEE_LINES', lines: expected.feeMinors.map(toMajor) } : { matched: false }
}

/** Differences between an existing Zoho customer payment and the proposed NET/FEE component. */
function compareCustomerPayment(detail, component, customerId) {
  if (!detail) return ['The Zoho payment could not be read.']
  const differences = []
  if (clean(detail.reference_number) !== component.reference) differences.push(`Reference is "${clean(detail.reference_number)}".`)
  if (clean(detail.customer_id) !== customerId) differences.push(`Customer is ${detail.customer_name || detail.customer_id}.`)
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
  if (journal.referenceNumber !== component.reference) differences.push(`Reference is "${journal.referenceNumber}".`)
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
  if (status === 'POSTING') return { action: RECOVERY_ACTION.NEEDS_REVIEW, reason: 'A posting attempt is unresolved and Zoho shows no record; confirm in Zoho before retrying.' }
  if (status === 'POSTED' || status === 'VERIFIED') {
    return { action: RECOVERY_ACTION.NEEDS_REVIEW, reason: `Recorded as ${status} (${local.zohoRecordId || 'no ID'}) but Zoho no longer has it.` }
  }
  if (status === 'NEEDS_REVIEW') return { action: RECOVERY_ACTION.NEEDS_REVIEW, reason: 'Component is flagged for review locally.' }
  if (status === 'FAILED' || (local && local.attemptCount > 0)) {
    return { action: RECOVERY_ACTION.RETRY_ELIGIBLE, reason: 'Missing in Zoho after an earlier failed attempt; eligible for retry.' }
  }
  return { action: RECOVERY_ACTION.POST_ELIGIBLE, reason: 'Not in Zoho yet.' }
}

/**
 * @param {{ blockers: string[], components: Array<{ component: string, recovery: { action: string }, localStatus: string|null }>, hasAdvance: boolean }} input
 */
function deriveGroupStatus({ blockers, components, hasAdvance }) {
  const actions = components.map((c) => c.recovery.action)
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
 * }} input
 */
function deriveFeeJournalStatus(input) {
  const { payoutBlockers, groups, stripeFeeMinor, verifiedFeeMinor, accountProblems, zoho, local, legacy } = input
  const S = FEE_JOURNAL_STATUS
  const recovery = planRecovery(zoho, local)
  if (recovery.action === RECOVERY_ACTION.SKIP_VERIFIED) {
    const tracked = local && local.status === 'VERIFIED'
    return { status: S.VERIFIED, reasons: [tracked ? 'Posted and verified in Zoho.' : 'Already in Zoho and matches exactly; posting records it locally without sending anything.'], recovery }
  }
  if (recovery.action === RECOVERY_ACTION.NEEDS_REVIEW) return { status: S.NEEDS_REVIEW, reasons: [recovery.reason], recovery }
  if (stripeFeeMinor === 0 && !local) return { status: S.NOT_REQUIRED, reasons: ['The payout carries no Stripe fees.'], recovery }

  const waiting = []
  if (payoutBlockers.length > 0) waiting.push('The payout does not reconcile.')
  if (groups.length === 0) waiting.push('The payout has no customer groups.')
  const open = groups.filter((g) => !COMPLETE_GROUP.has(g.status))
  if (open.length > 0) waiting.push(`Customer group(s) not posted yet: ${open.map((g) => `${g.customerName} (${g.status.replace(/_/g, ' ')})`).join(', ')}.`)
  const unverified = groups.flatMap((g) => g.components.filter((c) => c.zoho.state !== ZOHO_STATE.VERIFIED).map((c) => `${g.customerName} ${c.component}`))
  if (open.length === 0 && unverified.length > 0) waiting.push(`Not verified in Zoho yet: ${unverified.join(', ')}.`)
  if (waiting.length > 0) return { status: S.WAITING, reasons: waiting, recovery }

  if (verifiedFeeMinor !== stripeFeeMinor) {
    return { status: S.NEEDS_REVIEW, reasons: [`Verified FEE payments total ${money(verifiedFeeMinor)}, but Stripe fees for this payout are ${money(stripeFeeMinor)}.`], recovery }
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
  return { status: S.READY, reasons: [`Every customer group is posted and its FEE payment verified; ${money(stripeFeeMinor)} is ready to move from 1013 to Stripe Fees.`], recovery }
}

const FEE_JOURNAL_DONE = new Set([FEE_JOURNAL_STATUS.VERIFIED, FEE_JOURNAL_STATUS.LEGACY_VERIFIED, FEE_JOURNAL_STATUS.NOT_REQUIRED])

/**
 * @param {Array<{ status: string }>} groups
 * @param {string[]} payoutBlockers
 * @param {{ status: string }} feeJournal
 */
function derivePayoutStatus(groups, payoutBlockers, feeJournal) {
  if (payoutBlockers.length > 0 || groups.length === 0) return PAYOUT_STATUS.NEEDS_REVIEW
  if (groups.every((g) => COMPLETE_GROUP.has(g.status))) {
    if (feeJournal && FEE_JOURNAL_DONE.has(feeJournal.status)) return PAYOUT_STATUS.FULLY_CLEARED
    if (feeJournal && feeJournal.status === FEE_JOURNAL_STATUS.NEEDS_REVIEW) return PAYOUT_STATUS.NEEDS_REVIEW
    return PAYOUT_STATUS.FEE_JOURNAL_PENDING
  }
  if (groups.some((g) => g.status === GROUP_STATUS.NEEDS_REVIEW)) return PAYOUT_STATUS.NEEDS_REVIEW
  if (groups.some((g) => COMPLETE_GROUP.has(g.status) || g.status === GROUP_STATUS.PARTIALLY_POSTED)) return PAYOUT_STATUS.PARTIALLY_CLEARED
  return PAYOUT_STATUS.READY
}

module.exports = {
  GROUP_STATUS,
  PAYOUT_STATUS,
  COMPONENT,
  ZOHO_STATE,
  RECOVERY_ACTION,
  FEE_JOURNAL_STATUS,
  LEGACY_STATE,
  COMPLETE_GROUP,
  POSTABLE_GROUP,
  netReference,
  feeReference,
  advanceReference,
  advanceRefundReference,
  payoutFeeReference,
  isAutomatedReference,
  customerPaymentPayload,
  advanceJournalPayload,
  payoutFeeJournalPayload,
  compareCustomerPayment,
  compareAdvanceJournal,
  compareFeeJournal,
  matchLegacyFeeJournal,
  journalCustomer,
  planRecovery,
  deriveGroupStatus,
  deriveFeeJournalStatus,
  derivePayoutStatus,
  assessAdvanceRefund,
  refundPostingGate,
}
