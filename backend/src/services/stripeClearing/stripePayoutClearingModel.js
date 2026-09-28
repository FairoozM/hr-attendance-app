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

const PAYOUT_STATUS = Object.freeze({
  READY: 'READY',
  PARTIALLY_CLEARED: 'PARTIALLY_CLEARED',
  FULLY_CLEARED: 'FULLY_CLEARED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
})

const COMPONENT = Object.freeze({
  NET: 'NET',
  FEE: 'FEE',
  CUSTOMER_ADVANCE: 'CUSTOMER_ADVANCE',
  CUSTOMER_ADVANCE_REFUND: 'CUSTOMER_ADVANCE_REFUND',
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

/** Groups never block each other; the payout is only fully cleared when every group is complete. */
function derivePayoutStatus(groups, payoutBlockers) {
  if (payoutBlockers.length > 0 || groups.length === 0) return PAYOUT_STATUS.NEEDS_REVIEW
  if (groups.every((g) => COMPLETE_GROUP.has(g.status))) return PAYOUT_STATUS.FULLY_CLEARED
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
  COMPLETE_GROUP,
  POSTABLE_GROUP,
  netReference,
  feeReference,
  advanceReference,
  advanceRefundReference,
  customerPaymentPayload,
  advanceJournalPayload,
  compareCustomerPayment,
  compareAdvanceJournal,
  journalCustomer,
  planRecovery,
  deriveGroupStatus,
  derivePayoutStatus,
}
