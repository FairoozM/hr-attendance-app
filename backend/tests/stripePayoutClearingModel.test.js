'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const m = require('../src/services/stripeClearing/stripePayoutClearingModel')

const { RECOVERY_ACTION: A, ZOHO_STATE: Z, GROUP_STATUS: G, PAYOUT_STATUS: P } = m

test('recovery planner: verified is never recreated, missing is eligible, unknown needs review', () => {
  const cases = [
    [{ state: Z.VERIFIED, recordId: 'Z1' }, null, A.SKIP_VERIFIED],
    [{ state: Z.VERIFIED, recordId: 'Z1' }, { status: 'FAILED', zohoRecordId: null, attemptCount: 1 }, A.SKIP_VERIFIED],
    [{ state: Z.VERIFIED, recordId: 'Z1' }, { status: 'VERIFIED', zohoRecordId: 'Z2', attemptCount: 1 }, A.NEEDS_REVIEW],
    [{ state: Z.MISSING }, null, A.POST_ELIGIBLE],
    [{ state: Z.MISSING }, { status: 'PLANNED', zohoRecordId: null, attemptCount: 0 }, A.POST_ELIGIBLE],
    [{ state: Z.MISSING }, { status: 'FAILED', zohoRecordId: null, attemptCount: 2 }, A.RETRY_ELIGIBLE],
    [{ state: Z.MISSING }, { status: 'POSTING', zohoRecordId: null, attemptCount: 1 }, A.NEEDS_REVIEW],
    [{ state: Z.MISSING }, { status: 'POSTED', zohoRecordId: 'Z1', attemptCount: 1 }, A.NEEDS_REVIEW],
    [{ state: Z.MISSING }, { status: 'NEEDS_REVIEW', zohoRecordId: null, attemptCount: 1 }, A.NEEDS_REVIEW],
    [{ state: Z.CONFLICT, reason: 'two' }, null, A.NEEDS_REVIEW],
  ]
  for (const [zoho, local, expected] of cases) assert.equal(m.planRecovery(zoho, local).action, expected, JSON.stringify([zoho, local]))
})

test('group status follows component recovery', () => {
  const c = (component, action, localStatus = null) => ({ component, recovery: { action, reason: action }, localStatus })
  assert.equal(m.deriveGroupStatus({ blockers: [], components: [c('NET', A.POST_ELIGIBLE), c('FEE', A.POST_ELIGIBLE)], hasAdvance: false }).status, G.READY)
  assert.equal(m.deriveGroupStatus({ blockers: [], components: [c('NET', A.POST_ELIGIBLE), c('FEE', A.POST_ELIGIBLE), c('CUSTOMER_ADVANCE', A.POST_ELIGIBLE)], hasAdvance: true }).status, G.READY_WITH_CUSTOMER_ADVANCE)
  assert.equal(m.deriveGroupStatus({ blockers: [], components: [c('NET', A.SKIP_VERIFIED), c('FEE', A.RETRY_ELIGIBLE)], hasAdvance: false }).status, G.PARTIALLY_POSTED)
  assert.equal(m.deriveGroupStatus({ blockers: [], components: [c('NET', A.SKIP_VERIFIED, 'VERIFIED'), c('FEE', A.SKIP_VERIFIED, 'VERIFIED')], hasAdvance: false }).status, G.POSTED)
  assert.equal(m.deriveGroupStatus({ blockers: [], components: [c('NET', A.SKIP_VERIFIED), c('FEE', A.SKIP_VERIFIED)], hasAdvance: false }).status, G.ALREADY_POSTED)
  assert.equal(m.deriveGroupStatus({ blockers: [], components: [c('NET', A.SKIP_VERIFIED), c('FEE', A.NEEDS_REVIEW)], hasAdvance: false }).status, G.NEEDS_REVIEW)
  assert.equal(m.deriveGroupStatus({ blockers: ['x'], components: [c('NET', A.POST_ELIGIBLE)], hasAdvance: false }).status, G.NEEDS_REVIEW)
})

test('payout status: customers are independent, fully cleared only when every group is complete', () => {
  const g = (status) => ({ status })
  assert.equal(m.derivePayoutStatus([g(G.READY), g(G.READY_WITH_CUSTOMER_ADVANCE)], []), P.READY)
  assert.equal(m.derivePayoutStatus([g(G.POSTED), g(G.READY)], []), P.PARTIALLY_CLEARED)
  assert.equal(m.derivePayoutStatus([g(G.POSTED), g(G.ALREADY_POSTED)], []), P.FULLY_CLEARED)
  assert.equal(m.derivePayoutStatus([g(G.POSTED), g(G.POSTED)], ['does not reconcile']), P.NEEDS_REVIEW)
  assert.equal(m.derivePayoutStatus([g(G.POSTED), g(G.NEEDS_REVIEW)], []), P.NEEDS_REVIEW)
})

test('the per-PaymentIntent posting route is retired (410) and never reaches Zoho', () => {
  const ctrl = require('../src/controllers/stripeController')
  const res = { code: 0, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  ctrl.clearingPostRetired({ params: { paymentIntentId: 'pi_3UJALVDJogiiRoKP2ugPotQ9' } }, res)
  assert.equal(res.code, 410)
  assert.equal(res.body.code, 'GROSS_CLEARING_RETIRED')
})

test('refund posting gate: requires a confirmed case, a verified advance journal, REFUND_MATCHED, the exact amount and posting enabled', () => {
  const ok = { caseStatus: 'ADVANCE_POSTED', originalAdvanceJournalState: Z.VERIFIED, refundStatus: 'REFUND_MATCHED', refundMinor: 3500, overpaymentMinor: 3500, postingEnabled: true }
  assert.deepEqual(m.refundPostingGate(ok), { allowed: true, blockers: [] })
  assert.equal(m.refundPostingGate({ ...ok, caseStatus: 'CONFIRMED' }).allowed, true)
  const blocked = [
    ['advance journal missing (1123 would go negative)', { originalAdvanceJournalState: Z.MISSING }],
    ['advance journal conflicting', { originalAdvanceJournalState: Z.CONFLICT }],
    ['case not confirmed', { caseStatus: 'CUSTOMER_ADVANCE_REVIEW_REQUIRED' }],
    ['case rejected', { caseStatus: 'REJECTED' }],
    ['refund only detected, not in a payout', { refundStatus: 'REFUND_DETECTED' }],
    ['refund amount differs', { refundMinor: 3000 }],
    ['posting disabled', { postingEnabled: false }],
  ]
  for (const [label, patch] of blocked) {
    const gate = m.refundPostingGate({ ...ok, ...patch })
    assert.equal(gate.allowed, false, label)
    assert.equal(gate.blockers.length, 1, label)
  }
})

test('refund assessment: only one succeeded refund of exactly the overpayment, after and outside the payout', () => {
  const refund = {
    refundId: 're_1', chargeId: 'ch_1', paymentIntentId: 'pi_1', amountMinor: 3500, currency: 'AED', status: 'succeeded', createdAt: '2026-09-28T07:09:27.000Z',
    balanceTransaction: { balanceTransactionId: 'txn_r1', currency: 'AED', amountMinor: -3500, feeMinor: 0, netMinor: -3500 },
  }
  const input = {
    chargeId: 'ch_1', paymentIntentId: 'pi_1', chargeStatus: 'succeeded', chargeFullyRefunded: false, chargeRefundedMinor: 3500, overpaymentMinor: 3500,
    currency: 'AED', payoutCreatedAt: '2026-09-25T00:53:49.000Z', payoutBalanceTransactionIds: new Set(['txn_c1']), refunds: [refund], storedCase: null,
  }
  const ok = m.assessAdvanceRefund(input)
  assert.equal(ok.ok, true)
  assert.equal(ok.status, 'REFUND_DETECTED')
  assert.equal(ok.refund.refundPayoutId, null)
  const matched = m.assessAdvanceRefund({ ...input, storedCase: { refundId: 're_1', refundBalanceTransactionId: 'txn_r1', refundStatus: 'REFUND_MATCHED', refundPayoutId: 'po_later' } })
  assert.equal(matched.status, 'REFUND_MATCHED')
  assert.equal(matched.refund.refundPayoutId, 'po_later')
  assert.equal(m.assessAdvanceRefund({ ...input, payoutBalanceTransactionIds: new Set(['txn_r1']) }).status, 'REFUND_MISMATCH')
  assert.equal(m.assessAdvanceRefund({ ...input, chargeRefundedMinor: 4000 }).status, 'REFUND_MISMATCH')
  assert.equal(m.assessAdvanceRefund({ ...input, refunds: [] }).status, 'REFUND_MISMATCH')
  assert.equal(m.assessAdvanceRefund({ ...input, storedCase: { refundId: 're_2', refundBalanceTransactionId: null, refundStatus: 'REFUND_DETECTED', refundPayoutId: null } }).status, 'REFUND_MISMATCH')
})

test('references are payout-scoped and neutral', () => {
  assert.equal(m.netReference('po_X'), 'Stripe funds received po_X')
  assert.equal(m.feeReference('po_X'), 'Stripe processing fee po_X')
  assert.equal(m.advanceReference('po_X'), 'Stripe customer advance po_X')
  assert.equal(m.advanceRefundReference('po_X'), 'Stripe customer advance refund po_X')
})
