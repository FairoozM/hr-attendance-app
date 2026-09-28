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

test('payout status: customers are independent, fully cleared only when every group and the fee journal are done', () => {
  const g = (status) => ({ status })
  const F = m.FEE_JOURNAL_STATUS
  const fee = (status) => ({ status })
  assert.equal(m.derivePayoutStatus([g(G.READY), g(G.READY_WITH_CUSTOMER_ADVANCE)], [], fee(F.WAITING)), P.READY)
  assert.equal(m.derivePayoutStatus([g(G.POSTED), g(G.READY)], [], fee(F.WAITING)), P.PARTIALLY_CLEARED)
  assert.equal(m.derivePayoutStatus([g(G.POSTED), g(G.ALREADY_POSTED)], [], fee(F.READY)), P.FEE_JOURNAL_PENDING)
  assert.equal(m.derivePayoutStatus([g(G.POSTED), g(G.POSTED)], [], undefined), P.FEE_JOURNAL_PENDING)
  assert.equal(m.derivePayoutStatus([g(G.POSTED), g(G.ALREADY_POSTED)], [], fee(F.VERIFIED)), P.FULLY_CLEARED)
  assert.equal(m.derivePayoutStatus([g(G.ALREADY_POSTED)], [], fee(F.LEGACY_VERIFIED)), P.FULLY_CLEARED)
  assert.equal(m.derivePayoutStatus([g(G.POSTED)], [], fee(F.NOT_REQUIRED)), P.FULLY_CLEARED)
  assert.equal(m.derivePayoutStatus([g(G.POSTED), g(G.POSTED)], [], fee(F.NEEDS_REVIEW)), P.NEEDS_REVIEW)
  assert.equal(m.derivePayoutStatus([g(G.POSTED), g(G.READY)], [], fee(F.VERIFIED)), P.PARTIALLY_CLEARED)
  assert.equal(m.derivePayoutStatus([g(G.POSTED), g(G.POSTED)], ['does not reconcile'], fee(F.VERIFIED)), P.NEEDS_REVIEW)
  assert.equal(m.derivePayoutStatus([g(G.POSTED), g(G.NEEDS_REVIEW)], [], fee(F.WAITING)), P.NEEDS_REVIEW)
})

test('fee journal payload: one Stripe Fees debit and one 1013 credit for the total, untagged, no notes', () => {
  const component = { reference: m.payoutFeeReference('po_1UJNObDJogiiRoKPHtPAr3KE'), amount: 147.28, debitAccountId: '4265011000000648121', creditAccountId: '4265011000000699653' }
  const payload = m.payoutFeeJournalPayload(component, '2026-09-28')
  assert.equal(payload.reference_number, 'Stripe processing fees po_1UJNObDJogiiRoKPHtPAr3KE')
  assert.equal(payload.journal_date, '2026-09-28')
  assert.equal(payload.notes, undefined)
  assert.deepEqual(payload.line_items.map((l) => [l.account_id, l.debit_or_credit, l.amount, l.customer_id]), [
    ['4265011000000648121', 'debit', 147.28, undefined],
    ['4265011000000699653', 'credit', 147.28, undefined],
  ])
  assert.ok(!/HR|hr-attendance|Purchase Planning/i.test(JSON.stringify(payload)))
})

test('automated references are never treated as legacy fee journals', () => {
  assert.equal(m.isAutomatedReference('Stripe processing fees po_1UJNObDJogiiRoKPHtPAr3KE'), true)
  assert.equal(m.isAutomatedReference('Stripe processing fee po_1UJNObDJogiiRoKPHtPAr3KE'), true)
  assert.equal(m.isAutomatedReference('Stripe customer advance refund po_X1234567'), true)
  assert.equal(m.isAutomatedReference('Website&Burjuman stripe transaction fee - 50 Invoices'), false)
})

test('legacy matcher: published, credits 1013, debits Stripe Fees by the total or by each customer FEE', () => {
  const FEES = '4265011000000648121'
  const CLR = '4265011000000699653'
  const j = (lines, status = 'published') => ({ status, lineItems: lines.map(([accountId, debitOrCredit, amount]) => ({ accountId, debitOrCredit, amount })) })
  const expected = { feeExpenseAccountId: FEES, clearingAccountId: CLR, totalMinor: 31577, feeMinors: [30678, 899] }
  assert.equal(m.matchLegacyFeeJournal(j([[FEES, 'debit', 306.78], [FEES, 'debit', 8.99], [FEES, 'debit', 100], [CLR, 'credit', 415.77]]), expected).how, 'CUSTOMER_FEE_LINES')
  assert.equal(m.matchLegacyFeeJournal(j([[FEES, 'debit', 315.77], [CLR, 'credit', 315.77]]), expected).how, 'TOTAL_LINE')
  assert.equal(m.matchLegacyFeeJournal(j([[FEES, 'debit', 306.78], [CLR, 'credit', 306.78]]), expected).matched, false, 'one customer only')
  assert.equal(m.matchLegacyFeeJournal(j([[FEES, 'debit', 315.77], [CLR, 'credit', 315.77]], 'draft'), expected).matched, false, 'draft')
  assert.equal(m.matchLegacyFeeJournal(j([[FEES, 'debit', 315.77], ['OTHER', 'credit', 315.77]]), expected).matched, false, 'wrong credit account')
  assert.equal(m.matchLegacyFeeJournal(j([['OTHER', 'debit', 315.77], [CLR, 'credit', 315.77]]), expected).matched, false, 'wrong debit account')
  assert.equal(m.matchLegacyFeeJournal(j([[FEES, 'debit', 306.78], [FEES, 'debit', 8.99], [CLR, 'credit', 100]]), expected).matched, false, 'credit short')
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
