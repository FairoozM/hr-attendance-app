'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const m = require('../src/services/stripeClearing/stripePayoutClearingModel')

const { RECOVERY_ACTION: A, ZOHO_STATE: Z, GROUP_STATUS: G, PAYOUT_STATUS: P } = m

test('recovery planner: verified is never recreated, missing is eligible, uncertain is never re-sent, conflicts need review', () => {
  const cases = [
    [{ state: Z.VERIFIED, recordId: 'Z1' }, null, A.SKIP_VERIFIED],
    [{ state: Z.VERIFIED, recordId: 'Z1' }, { status: 'FAILED', zohoRecordId: null, attemptCount: 1 }, A.SKIP_VERIFIED],
    [{ state: Z.VERIFIED, recordId: 'Z1' }, { status: 'VERIFIED', zohoRecordId: 'Z2', attemptCount: 1 }, A.NEEDS_REVIEW],
    [{ state: Z.MISSING }, null, A.POST_ELIGIBLE],
    [{ state: Z.MISSING }, { status: 'PLANNED', zohoRecordId: null, attemptCount: 0 }, A.POST_ELIGIBLE],
    [{ state: Z.MISSING }, { status: 'FAILED', zohoRecordId: null, attemptCount: 2 }, A.RETRY_ELIGIBLE],
    // An interrupted or uncertain POST may have reached Zoho: never re-sent on its own.
    [{ state: Z.MISSING }, { status: 'POSTING', zohoRecordId: null, attemptCount: 1 }, A.POSTING_UNCERTAIN],
    [{ state: Z.MISSING }, { status: 'POSTING_UNCERTAIN', zohoRecordId: null, attemptCount: 1 }, A.POSTING_UNCERTAIN],
    [{ state: Z.MISSING }, { status: 'POSTING_UNCERTAIN', zohoRecordId: null, attemptCount: 7, recoveryCheckCount: 9 }, A.POSTING_UNCERTAIN],
    [{ state: Z.VERIFIED, recordId: 'Z1' }, { status: 'POSTING_UNCERTAIN', zohoRecordId: null, attemptCount: 1 }, A.SKIP_VERIFIED],
    [{ state: Z.CONFLICT, reason: 'two' }, { status: 'POSTING_UNCERTAIN', zohoRecordId: null, attemptCount: 1 }, A.NEEDS_REVIEW],
    [{ state: Z.MISSING }, { status: 'FAILED', zohoRecordId: null, attemptCount: 1, retryAuthorizedAt: '2026-09-28T14:20:00.000Z', retryAuthorizedBy: 'user:1' }, A.RETRY_ELIGIBLE],
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

// ── Normal invoice refunds ──────────────────────────────────────────────────

const NR = m.NORMAL_REFUND_STATUS
const K = m.REFUND_KIND

test('normal refund references are refund-scoped, neutral and recognised as automated', () => {
  assert.equal(m.normalRefundReference('re_1'), 'Stripe refund re_1')
  assert.equal(m.refundFeeReference('re_1'), 'Stripe refund fee re_1')
  assert.equal(m.isAutomatedReference('Stripe refund re_1'), true)
  assert.equal(m.isAutomatedReference('Stripe refund fee re_1'), true)
  assert.equal(m.isAutomatedReference('Stripe processing fees po_1'), true)
  // Legacy manual refunds ("Stripe refund 043075 po_…") are not ours.
  assert.equal(m.isAutomatedReference('Stripe refund 043075 po_1U8V40'), false)
  assert.equal(m.isAutomatedReference('Website&Burjuman stripe transaction fee'), false)
})

test('refund classification: cumulative against the invoice, in Stripe creation order', () => {
  const refunds = [
    { refundId: 're_b', amountMinor: 5000, status: 'succeeded', createdAt: '2026-09-02T00:00:00Z' },
    { refundId: 're_a', amountMinor: 10000, status: 'succeeded', createdAt: '2026-09-01T00:00:00Z' },
    { refundId: 're_x', amountMinor: 99999, status: 'failed', createdAt: '2026-09-01T12:00:00Z' },
  ]
  const first = m.classifyNormalRefund({ refundId: 're_a', refundMinor: 10000, invoiceTotalMinor: 15000, chargeRefunds: refunds })
  assert.equal(first.kind, K.PARTIAL_REFUND)
  assert.deepEqual([first.sequence, first.refundCount, first.priorRefundedMinor, first.cumulativeMinor, first.remainingMinor], [1, 2, 0, 10000, 5000])
  const second = m.classifyNormalRefund({ refundId: 're_b', refundMinor: 5000, invoiceTotalMinor: 15000, chargeRefunds: refunds })
  assert.equal(second.kind, K.FULL_REFUND, 'the refund that reaches the invoice total is the full refund')
  assert.deepEqual([second.sequence, second.priorRefundedMinor, second.cumulativeMinor, second.remainingMinor], [2, 10000, 15000, 0])
  assert.equal(m.classifyNormalRefund({ refundId: 're_a', refundMinor: 15000, invoiceTotalMinor: 15000, chargeRefunds: [{ ...refunds[1], amountMinor: 15000 }] }).kind, K.FULL_REFUND)

  const over = m.classifyNormalRefund({ refundId: 're_b', refundMinor: 5000, invoiceTotalMinor: 12000, chargeRefunds: refunds })
  assert.equal(over.code, 'REFUND_EXCEEDS_INVOICE')
  assert.match(over.problem, /150\.00, more than the invoice total 120\.00/)
  assert.equal(m.classifyNormalRefund({ refundId: 're_x', refundMinor: 99999, invoiceTotalMinor: 150000, chargeRefunds: refunds }).code, 'REFUND_NOT_ON_CHARGE')
  assert.equal(m.classifyNormalRefund({ refundId: 're_a', refundMinor: 9000, invoiceTotalMinor: 15000, chargeRefunds: refunds }).code, 'REFUND_AMOUNT_MISMATCH')
})

test('credit note selection: ours, then one legacy Stripe refund, then exact total, then one shared note; never guesses', () => {
  const REF = 'Stripe refund re_a'
  const A1019 = 'A1019'
  const cn = (id, totalMinor, extra = {}) => ({ creditNoteId: id, creditNoteNumber: id, status: 'open', totalMinor, balanceMinor: totalMinor, refunds: [], ...extra })
  const pick = (creditNotes, siblingRefunds = [], grossMinor = 7670) => m.selectCreditNote({ reference: REF, grossMinor, depositAccountId: A1019, siblingRefunds, creditNotes })

  assert.equal(pick([cn('20717', 7670)]).how, 'CREDIT_NOTE_TOTAL')
  const ours = pick([cn('20717', 7670, { refunds: [{ creditNoteRefundId: 'R1', referenceNumber: REF, amountMinor: 7670, fromAccountId: null }] }), cn('20717-2', 7670)])
  assert.deepEqual([ours.outcome, ours.creditNote.creditNoteId], ['OURS', '20717'])
  const twoOurs = pick([
    cn('20717', 7670, { refunds: [{ creditNoteRefundId: 'R1', referenceNumber: REF, amountMinor: 7670 }] }),
    cn('20717-2', 7670, { refunds: [{ creditNoteRefundId: 'R2', referenceNumber: REF, amountMinor: 7670 }] }),
  ])
  assert.equal(twoOurs.code, 'ZOHO_DUPLICATE_REFUND')

  const legacyRow = { creditNoteRefundId: 'L1', referenceNumber: 'Stripe refund 043117 pi_x', amountMinor: 13745, fromAccountId: A1019 }
  const legacy = pick([cn('20723', 16745, { balanceMinor: 0, status: 'closed', refunds: [legacyRow] })], [], 13745)
  assert.deepEqual([legacy.outcome, legacy.legacyRefund.creditNoteRefundId], ['LEGACY', 'L1'])
  assert.equal(pick([cn('20723', 16745, { refunds: [legacyRow] })], [{ refundId: 're_z', amountMinor: 13745 }], 13745).code, 'LEGACY_REFUND_AMBIGUOUS')
  // Refunds paid from another account (e.g. cash) never count as a Stripe refund.
  assert.equal(pick([cn('20723', 13745, { balanceMinor: 0, refunds: [{ ...legacyRow, fromAccountId: 'CASH' }] })], [], 13745).code, 'CREDIT_NOTE_BALANCE_INSUFFICIENT')
  assert.equal(pick([cn('20717', 15000, { balanceMinor: 7330, refunds: [{ creditNoteRefundId: 'M', referenceNumber: 'manual', amountMinor: 7330, fromAccountId: A1019 }] })]).code, 'MANUAL_STRIPE_REFUND_UNEXPLAINED')

  assert.equal(pick([cn('20717', 7670), cn('20717-2', 7670)]).code, 'CREDIT_NOTE_AMBIGUOUS')
  assert.equal(pick([cn('20717', 7670)], [{ refundId: 're_b', amountMinor: 7670 }]).code, 'CREDIT_NOTE_AMBIGUOUS')
  assert.equal(pick([cn('20717', 15000)], [{ refundId: 're_b', amountMinor: 7330 }]).how, 'SHARED_CREDIT_NOTE')
  assert.equal(pick([cn('20717', 16000)]).code, 'CREDIT_NOTE_AMOUNT_MISMATCH')
  assert.equal(pick([cn('20717', 16000)]).status, NR.MISMATCH)
  assert.equal(pick([cn('20717', 7670, { status: 'draft' })]).code, 'CREDIT_NOTE_DRAFT')
  assert.equal(pick([cn('20717', 7670, { status: 'void' })]).code, 'CREDIT_NOTE_MISSING')
  assert.equal(pick([]).code, 'CREDIT_NOTE_MISSING')
  assert.equal(pick([cn('20717', 7670, { balanceMinor: 1000 })]).code, 'CREDIT_NOTE_BALANCE_INSUFFICIENT')
})

test('returned items are proven only through invoice lines, never guessed', () => {
  const invoice = {
    invoiceNumber: 'INV-1',
    lineItems: [
      { lineItemId: 'IL1', itemId: 'SKU-A', quantity: 2 },
      { lineItemId: 'IL2', itemId: 'COURIER', quantity: 1 },
      { lineItemId: 'IL3', itemId: 'COUPON', quantity: 1 },
    ],
  }
  const cn = (lineItems) => ({ creditNoteNumber: '20717', lineItems })
  const ok = m.proveReturnedItems(cn([
    { itemId: 'SKU-A', invoiceItemId: 'IL1', name: 'Aligner', quantity: 1, rate: 76.7, itemTotal: 73.05 },
    { itemId: 'COURIER', invoiceItemId: '', name: 'Courier Charges', quantity: 1, rate: 30, itemTotal: 28.57 },
  ]), invoice)
  assert.equal(ok.proven, true)
  assert.deepEqual(ok.items.map((i) => [i.name, i.quantity, i.invoiceLineItemId, i.linkedBy]), [['Aligner', 1, 'IL1', 'INVOICE_LINE'], ['Courier Charges', 1, 'IL2', 'INVOICE_ITEM']])
  assert.match(m.proveReturnedItems(cn([{ itemId: 'SKU-A', invoiceItemId: 'IL1', quantity: 3 }]), invoice).reason, /returns 3 .* has 2/)
  assert.match(m.proveReturnedItems(cn([{ itemId: 'SKU-A', invoiceItemId: 'IL9', quantity: 1 }]), invoice).reason, /not on INV-1/)
  assert.match(m.proveReturnedItems(cn([{ itemId: 'OTHER', quantity: 1, name: 'Refund' }]), invoice).reason, /not linked to exactly one line/)
  // Lines that only match by item (no Zoho invoice-line link at all) are money, not a proven return.
  assert.match(m.proveReturnedItems(cn([{ itemId: 'COURIER', quantity: 1 }]), invoice).reason, /cannot be proven/)
  assert.equal(m.proveReturnedItems(cn([]), invoice).proven, false)
})

test('refund fee adjustment follows the sign of Stripe fee and credit note refund payloads are neutral', () => {
  assert.equal(m.refundFeeAdjustmentAccounts(0, 'A1019', 'A1013'), null)
  assert.deepEqual(m.refundFeeAdjustmentAccounts(-230, 'A1019', 'A1013'), { debitAccountId: 'A1019', creditAccountId: 'A1013', direction: 'FEE_RETURNED' })
  assert.deepEqual(m.refundFeeAdjustmentAccounts(50, 'A1019', 'A1013'), { debitAccountId: 'A1013', creditAccountId: 'A1019', direction: 'FEE_CHARGED' })
  const payload = m.creditNoteRefundPayload({ reference: 'Stripe refund re_1', amount: 76.7, depositAccountId: 'A1019' }, '2026-09-03', 'Stripe')
  assert.deepEqual(payload, { date: '2026-09-03', refund_mode: 'Stripe', reference_number: 'Stripe refund re_1', amount: 76.7, from_account_id: 'A1019' })
  const component = { reference: 'Stripe refund re_1', amount: 76.7, depositAccountId: 'A1019', creditNoteId: 'CN1', date: '2026-09-03' }
  const detail = { referenceNumber: 'Stripe refund re_1', amount: 76.7, fromAccountId: 'A1019', creditNoteId: 'CN1', date: '2026-09-03' }
  assert.deepEqual(m.compareCreditNoteRefund(detail, component), [])
  assert.equal(m.compareCreditNoteRefund({ ...detail, amount: 76.71, fromAccountId: 'CASH', creditNoteId: 'CN2' }, component).length, 3)
})

test('normal refund status follows component recovery', () => {
  const c = (component, action, localStatus = null) => ({ component, recovery: { action, reason: action }, localStatus })
  assert.equal(m.deriveNormalRefundStatus([c('REFUND_CREDIT_NOTE_REFUND', A.POST_ELIGIBLE)]).status, NR.READY)
  assert.equal(m.deriveNormalRefundStatus([c('REFUND_CREDIT_NOTE_REFUND', A.RETRY_ELIGIBLE)]).status, NR.FAILED)
  assert.equal(m.deriveNormalRefundStatus([c('REFUND_CREDIT_NOTE_REFUND', A.SKIP_VERIFIED, 'VERIFIED'), c('REFUND_FEE_ADJUSTMENT', A.POST_ELIGIBLE)]).status, NR.POSTED)
  const verified = m.deriveNormalRefundStatus([c('REFUND_CREDIT_NOTE_REFUND', A.SKIP_VERIFIED, 'VERIFIED')])
  assert.deepEqual([verified.status, verified.tracked], [NR.VERIFIED, true])
  assert.deepEqual([m.deriveNormalRefundStatus([c('REFUND_CREDIT_NOTE_REFUND', A.SKIP_VERIFIED)]).reasonCode], ['ALREADY_IN_ZOHO'])
  assert.equal(m.deriveNormalRefundStatus([c('REFUND_CREDIT_NOTE_REFUND', A.SKIP_VERIFIED), c('REFUND_FEE_ADJUSTMENT', A.NEEDS_REVIEW)]).status, NR.NEEDS_REVIEW)
})

test('payout status: FULLY_CLEARED needs every normal refund and matched advance refund journal verified', () => {
  const F = m.FEE_JOURNAL_STATUS
  const posted = [{ status: G.POSTED }]
  const done = { status: F.VERIFIED }
  assert.equal(m.derivePayoutStatus(posted, [], done, { normal: [{ status: NR.VERIFIED }, { status: NR.LEGACY_VERIFIED }] }), P.FULLY_CLEARED)
  assert.equal(m.derivePayoutStatus(posted, [], done, { normal: [{ status: NR.READY }] }), P.PARTIALLY_CLEARED)
  assert.equal(m.derivePayoutStatus(posted, [], done, { normal: [{ status: NR.MATCHED }] }), P.PARTIALLY_CLEARED)
  assert.equal(m.derivePayoutStatus(posted, [], done, { normal: [{ status: NR.NEEDS_REVIEW }] }), P.NEEDS_REVIEW)
  assert.equal(m.derivePayoutStatus(posted, [], done, { normal: [{ status: NR.MISMATCH }] }), P.NEEDS_REVIEW)
  assert.equal(m.derivePayoutStatus([{ status: G.READY }], [], { status: F.WAITING }, { normal: [{ status: NR.READY }] }), P.READY)
  assert.equal(m.derivePayoutStatus(posted, [], { status: F.WAITING }, { normal: [{ status: NR.VERIFIED }] }), P.FEE_JOURNAL_PENDING)
  // Refund-only payout.
  assert.equal(m.derivePayoutStatus([], [], { status: F.NOT_REQUIRED }, { normal: [{ status: NR.READY }] }), P.READY)
  assert.equal(m.derivePayoutStatus([], [], { status: F.NOT_REQUIRED }, { normal: [{ status: NR.VERIFIED }] }), P.FULLY_CLEARED)
  assert.equal(m.derivePayoutStatus([], [], { status: F.NOT_REQUIRED }, {}), P.NEEDS_REVIEW)
  // A matched customer advance refund clears only with its Dr 1123 / Cr 1019 journal verified.
  assert.equal(m.derivePayoutStatus(posted, [], done, { advance: [{ matched: true, refundJournal: { state: Z.MISSING } }] }), P.PARTIALLY_CLEARED)
  assert.equal(m.derivePayoutStatus(posted, [], done, { advance: [{ matched: true, refundJournal: { state: Z.VERIFIED } }] }), P.FULLY_CLEARED)
})

test('fee journal waits for refund fee adjustments and counts each refund fee once', () => {
  const S = m.FEE_JOURNAL_STATUS
  const groups = [{ customerName: 'Website', status: G.POSTED, components: [{ component: 'FEE', zoho: { state: Z.VERIFIED } }] }]
  const base = { payoutBlockers: [], groups, accountProblems: [], zoho: { state: Z.MISSING }, local: null, legacy: { state: m.LEGACY_STATE.NONE } }
  const waiting = m.deriveFeeJournalStatus({ ...base, stripeFeeMinor: 1270, verifiedFeeMinor: 1500, refundAdjustments: [{ refundId: 're_1', feeMinor: -230, zohoState: Z.MISSING }] })
  assert.equal(waiting.status, S.WAITING)
  assert.match(waiting.reasons.join(' '), /Refund fee adjustment\(s\) not verified yet: re_1 \(-2\.30\)/)
  assert.equal(m.deriveFeeJournalStatus({ ...base, stripeFeeMinor: 1270, verifiedFeeMinor: 1270, refundAdjustments: [{ refundId: 're_1', feeMinor: -230, zohoState: Z.VERIFIED }] }).status, S.READY)
  // Counting the refund fee twice (or not at all) never balances.
  assert.equal(m.deriveFeeJournalStatus({ ...base, stripeFeeMinor: 1270, verifiedFeeMinor: 1040, refundAdjustments: [{ refundId: 're_1', feeMinor: -230, zohoState: Z.VERIFIED }] }).status, S.NEEDS_REVIEW)
  // A negative net fee is a reversal to post, not a review case.
  assert.equal(m.deriveFeeJournalStatus({ ...base, groups: [], normalRefundCount: 1, stripeFeeMinor: -230, verifiedFeeMinor: -230, refundAdjustments: [{ refundId: 're_1', feeMinor: -230, zohoState: Z.VERIFIED }] }).status, S.READY)
  // Refund-only payout with a refund fee: no customer groups is fine.
  assert.equal(m.deriveFeeJournalStatus({ ...base, groups: [], stripeFeeMinor: 50, verifiedFeeMinor: 50, normalRefundCount: 1, refundAdjustments: [{ refundId: 're_1', feeMinor: 50, zohoState: Z.VERIFIED }] }).status, S.READY)
})

test('payout fee journal direction follows the signed fee total', () => {
  const D = m.FEE_JOURNAL_DIRECTION
  assert.deepEqual(m.payoutFeeJournalAccounts(700, 'A2270', 'A1013'), { direction: D.FEE_EXPENSE, debitAccountId: 'A2270', creditAccountId: 'A1013' })
  assert.equal(m.payoutFeeJournalAccounts(0, 'A2270', 'A1013'), null)
  assert.deepEqual(m.payoutFeeJournalAccounts(-300, 'A2270', 'A1013'), { direction: D.FEE_REVERSAL, debitAccountId: 'A1013', creditAccountId: 'A2270' })
})

test('fee journal status: zero net fee waits for components, then NOT_REQUIRED; no fees at all is NOT_REQUIRED at once', () => {
  const S = m.FEE_JOURNAL_STATUS
  const groups = (state) => [{ customerName: 'Website', status: G.POSTED, components: [{ component: 'FEE', amount: 3, zoho: { state } }] }]
  const base = { payoutBlockers: [], accountProblems: [], zoho: { state: Z.MISSING }, local: null, legacy: { state: m.LEGACY_STATE.NONE }, normalRefundCount: 1 }
  const adj = (state) => [{ refundId: 're_1', feeMinor: -300, zohoState: state }]
  assert.equal(m.deriveFeeJournalStatus({ ...base, groups: groups(Z.VERIFIED), stripeFeeMinor: 0, verifiedFeeMinor: 300, refundAdjustments: adj(Z.MISSING) }).status, S.WAITING)
  assert.equal(m.deriveFeeJournalStatus({ ...base, groups: groups(Z.VERIFIED), stripeFeeMinor: 0, verifiedFeeMinor: 0, refundAdjustments: adj(Z.VERIFIED) }).status, S.NOT_REQUIRED)
  const none = [{ customerName: 'Website', status: G.READY, components: [{ component: 'FEE', amount: 0, zoho: { state: Z.MISSING } }] }]
  assert.equal(m.deriveFeeJournalStatus({ ...base, groups: none, stripeFeeMinor: 0, verifiedFeeMinor: 0 }).status, S.NOT_REQUIRED)
})

test('legacy fee journal matching is direction-aware', () => {
  const expected = { feeExpenseAccountId: 'A2270', clearingAccountId: 'A1013', totalMinor: 300, feeMinors: [] }
  const j = (dr, cr) => ({ status: 'published', lineItems: [{ accountId: dr, debitOrCredit: 'debit', amount: 3 }, { accountId: cr, debitOrCredit: 'credit', amount: 3 }] })
  const R = { ...expected, direction: m.FEE_JOURNAL_DIRECTION.FEE_REVERSAL }
  assert.equal(m.matchLegacyFeeJournal(j('A1013', 'A2270'), R).matched, true)
  assert.equal(m.matchLegacyFeeJournal(j('A2270', 'A1013'), R).matched, false)
  assert.equal(m.matchLegacyFeeJournal(j('A2270', 'A1013'), expected).matched, true)
  assert.equal(m.matchLegacyFeeJournal(j('A1013', 'A2270'), expected).matched, false)
})
