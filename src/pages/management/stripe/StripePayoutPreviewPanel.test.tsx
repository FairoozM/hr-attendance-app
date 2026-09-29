import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  StripeFeeJournalStatus,
  StripeNormalRefund,
  StripePayoutComponent,
  StripePayoutFeeJournal,
  StripePayoutGroup,
  StripePayoutLine,
  StripePayoutPreview,
  StripePayoutSummary,
  StripeDirectInvoice,
  StripeDirectMapping,
  StripeDirectValidation,
  StripeUncertainComponent,
  StripeUnassignedLine,
} from '../../../api/stripe'
import {
  aed,
  confirmableAdvanceLines,
  feeAdjustmentLabel,
  feeJournalLabel,
  feeJournalTone,
  groupTone,
  normalRefundTone,
  pageOf,
  payoutTone,
  postingSteps,
  recoveryLabel,
  refundKindLabel,
} from './stripePayoutFormat'

const api = vi.hoisted(() => ({
  getStripePayouts: vi.fn(),
  refreshStripePayouts: vi.fn(),
  getStripePayoutPreview: vi.fn(),
  confirmStripeCustomerAdvance: vi.fn(),
  postStripePayoutGroup: vi.fn(),
  postStripePayoutFeeJournal: vi.fn(),
  postStripePayoutRefund: vi.fn(),
  recheckStripeUncertainComponent: vi.fn(),
  confirmStripeUncertainNotCreated: vi.fn(),
  searchStripeDirectInvoices: vi.fn(),
  validateStripeDirectPayment: vi.fn(),
  confirmStripeDirectPayment: vi.fn(),
  releaseStripeDirectPayment: vi.fn(),
}))
vi.mock('../../../api/stripe', () => api)

import { StripePayoutPreviewPanel } from './StripePayoutPreviewPanel'

const PAYOUT = 'po_1UJNObDJogiiRoKPHtPAr3KE'

function advanceLine(confirmed: boolean): StripePayoutLine {
  return {
    balanceTransactionId: 'txn_1',
    chargeId: 'ch_3UIA7CDJogiiRoKP07RCqZKw',
    paymentIntentId: 'pi_3UIA7CDJogiiRoKP0Qy1oodM',
    gross: 1101,
    net: 1068.07,
    fee: 32.93,
    invoiceTotal: 1066,
    netAllocation: 1033.07,
    feeAllocation: 32.93,
    customerAdvance: 35,
    website: { orderId: '1', orderNumber: '21111', finalAmount: 1066, shopOrder: false, orderStatus: 'delivered', paymentStatus: 'completed' },
    invoice: { invoiceId: 'I1', invoiceNumber: 'INV-044122', total: 1066, balance: 1066, status: 'sent', customerId: 'WEB' },
    advance: {
      overpaymentAmount: 35,
      invoiceTotal: 1066,
      stripeGross: 1101,
      netAllocation: 1033.07,
      caseStatus: confirmed ? 'CONFIRMED' : 'CUSTOMER_ADVANCE_REVIEW_REQUIRED',
      confirmed,
      caseId: confirmed ? '1' : null,
      confirmedBy: confirmed ? 'user:1' : null,
      confirmedAt: confirmed ? '2026-09-27T10:00:00.000Z' : null,
      reason: null,
    },
    state: 'OPEN',
    matchStatus: 'MATCHED_READY_TO_CLEAR',
    reason: 'overpayment',
  }
}

const account = (code: string, name: string) => ({ accountId: code, accountCode: code, accountName: name })

function payment(kind: 'NET' | 'FEE', amount: number, allocations: Array<[string, string, number]>): StripePayoutComponent {
  const reference = kind === 'NET' ? `Stripe funds received ${PAYOUT}` : `Stripe processing fee ${PAYOUT}`
  return {
    component: kind,
    zohoRecordType: 'customer_payment',
    amount,
    reference,
    account: kind === 'NET' ? account('1019', 'Stripe Undeposited Funds') : account('1013', 'Stripe Processing Chg Un-Cleared'),
    allocations: allocations.map(([invoiceNumber, orderNumber, value]) => ({ invoiceId: invoiceNumber, invoiceNumber, orderNumber, paymentIntentId: null, amount: value })),
    advanceCaseIds: [],
    payload: { reference_number: reference },
    zoho: { state: 'MISSING', recordId: null, records: [], differences: [] },
    local: null,
    recovery: { action: 'POST_ELIGIBLE', reason: 'Not in Zoho yet.' },
  }
}

function burjmanGroup(): StripePayoutGroup {
  const invoices: Array<[string, string, number, number]> = [
    ['INV-044103', '21101', 112.9, 4.4],
    ['INV-044120', '21108', 764.1, 23.85],
    ['INV-044093', '21097', 93.09, 3.81],
    ['INV-044038', '21060', 233.4, 8],
  ]
  return {
    groupKey: `${PAYOUT}|BURJ`,
    customerId: 'BURJ',
    customerName: 'Burjman Shop - Web & App',
    status: 'READY',
    reasons: [],
    postable: true,
    advanceReviewRequired: false,
    invoiceCount: 4,
    chargeCount: 4,
    totals: { invoiceGross: 1243.55, netTo1019: 1203.49, customerAdvance: 0, total1019: 1203.49, feeTo1013: 40.06, stripeGross: 1243.55 },
    checks: { total1019PlusFeeEqualsGross: true, netPlusFeeEqualsInvoices: true, everyLineBalances: true },
    components: [
      payment('NET', 1203.49, invoices.map(([i, o, n]) => [i, o, n])),
      payment('FEE', 40.06, invoices.map(([i, o, , f]) => [i, o, f])),
    ],
    postingFingerprint: 'fp-burjman',
    lines: [],
  }
}

function websiteGroup(confirmed: boolean): StripePayoutGroup {
  return {
    groupKey: `${PAYOUT}|WEB`,
    customerId: 'WEB',
    customerName: 'Website',
    status: confirmed ? 'READY_WITH_CUSTOMER_ADVANCE' : 'NEEDS_REVIEW',
    reasons: confirmed ? [] : ['Customer overpayment of 35 on INV-044122 needs admin confirmation (Confirm Customer Advance).'],
    postable: confirmed,
    advanceReviewRequired: !confirmed,
    invoiceCount: 7,
    chargeCount: 7,
    totals: { invoiceGross: 3420.7, netTo1019: 3313.48, customerAdvance: 35, total1019: 3348.48, feeTo1013: 107.22, stripeGross: 3455.7 },
    checks: { total1019PlusFeeEqualsGross: true, netPlusFeeEqualsInvoices: true, everyLineBalances: true },
    components: [
      payment('NET', 3313.48, [['INV-044122', '21111', 1033.07]]),
      payment('FEE', 107.22, [['INV-044122', '21111', 32.93]]),
      {
        component: 'CUSTOMER_ADVANCE',
        zohoRecordType: 'journal',
        amount: 35,
        reference: `Stripe customer advance ${PAYOUT}`,
        debitAccount: account('1019', 'Stripe Undeposited Funds'),
        creditAccount: account('1123', 'Customer Advance Funds'),
        allocations: [],
        advanceCaseIds: [],
        payload: { reference_number: `Stripe customer advance ${PAYOUT}` },
        zoho: { state: 'MISSING', recordId: null, records: [], differences: [] },
        local: null,
        recovery: { action: 'POST_ELIGIBLE', reason: 'Not in Zoho yet.' },
      },
    ],
    postingFingerprint: 'fp-website',
    lines: [advanceLine(confirmed)],
  }
}

function preview(confirmed: boolean): StripePayoutPreview {
  return {
    preview: true,
    postingEnabled: false,
    payout: { payoutId: PAYOUT, status: 'paid', amount: 4551.97, currency: 'AED', arrivalDate: '2026-09-28T00:00:00.000Z', createdAt: null },
    status: confirmed ? 'READY' : 'NEEDS_REVIEW',
    blockers: [],
    proposedPaymentDate: '2026-09-28',
    accounts: { net: null, fee: null, advance: null, problems: [] },
    composition: { chargeCount: 11, chargeGross: 4699.25, chargeFee: 147.28, chargeNet: 4551.97, otherCount: 2, otherNet: 0, contentNet: 4551.97, payoutAmount: 4551.97, reconciles: true },
    reconciliation: { netTo1019: 4516.97, customerAdvances: 35, total1019: 4551.97, advanceRefundsOutOf1019: 0, fees: 147.28, payoutAmount: 4551.97, stripeGross: 4699.25, total1019PlusFees: 4699.25, payoutMatches: true, grossMatches: true },
    customersPresent: ['Website'],
    groups: [websiteGroup(confirmed)],
    unassigned: [],
    advanceCaseEvents: [],
    advanceRefunds: [],
    otherTransactions: [],
    warnings: [],
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('stripePayoutFormat', () => {
  it('formats money and statuses', () => {
    expect(aed(3313.48)).toBe('AED 3,313.48')
    expect(aed(null)).toBe('—')
    expect(groupTone('READY_WITH_CUSTOMER_ADVANCE')).toBe('ok')
    expect(groupTone('NEEDS_REVIEW')).toBe('bad')
    expect(recoveryLabel('SKIP_VERIFIED')).toMatch(/keep/)
  })

  it('only open, unconfirmed overpayments can be confirmed', () => {
    expect(confirmableAdvanceLines(websiteGroup(false))).toHaveLength(1)
    expect(confirmableAdvanceLines(websiteGroup(true))).toHaveLength(0)
    const partly = websiteGroup(false)
    partly.lines = [{ ...advanceLine(false), state: 'PARTIALLY_CLEARED' }]
    expect(confirmableAdvanceLines(partly)).toHaveLength(0)
  })

  it('posts NET, then FEE, then the advance journal and keeps verified records', () => {
    const group = websiteGroup(true)
    group.components = [group.components[2], group.components[1], group.components[0]]
    group.components[1] = { ...group.components[1], recovery: { action: 'SKIP_VERIFIED', reason: 'Already in Zoho.' } }
    expect(postingSteps(group).map((s) => [s.component.component, s.willCreate])).toEqual([
      ['NET', true],
      ['FEE', false],
      ['CUSTOMER_ADVANCE', true],
    ])
  })
})

async function openPreview(p: StripePayoutPreview) {
  api.getStripePayouts.mockResolvedValue({
    rows: [{ payoutId: PAYOUT, status: 'paid', amount: 4551.97, currency: 'AED', arrivalDate: '2026-09-28T00:00:00.000Z', createdAt: null, composition: p.composition }],
  })
  api.getStripePayoutPreview.mockResolvedValue(p)
  render(<StripePayoutPreviewPanel />)
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))
  await screen.findByText('Burjman Shop - Web & App')
}

function currentPayout(postingEnabled: boolean): StripePayoutPreview {
  const p = preview(true)
  p.postingEnabled = postingEnabled
  p.postingBlockedReasons = postingEnabled
    ? []
    : [{ code: 'STRIPE_CLEARING_POSTING_DISABLED', message: 'Stripe clearing posting is disabled (STRIPE_CLEARING_POSTING_ENABLED=false).' }]
  p.groups = [burjmanGroup(), websiteGroup(true)]
  return p
}

describe('StripePayoutPreviewPanel posting', () => {
  it('shows posting disabled while the server flag is off', async () => {
    await openPreview(currentPayout(false))
    const buttons = screen.getAllByRole('button', { name: 'Post Customer Group to Zoho' }) as HTMLButtonElement[]
    expect(buttons).toHaveLength(2)
    expect(buttons.every((b) => b.disabled)).toBe(true)
    expect(screen.getAllByText('Posting disabled')).toHaveLength(2)
    expect(screen.getByText(/STRIPE_CLEARING_POSTING_ENABLED=false/)).toBeTruthy()
    expect(api.postStripePayoutGroup).not.toHaveBeenCalled()
  })

  it('never offers posting for a group that needs review', async () => {
    const p = currentPayout(true)
    p.groups = [burjmanGroup(), websiteGroup(false)]
    await openPreview(p)
    expect(screen.getAllByRole('button', { name: 'Post Customer Group to Zoho' })).toHaveLength(1)
  })

  it('confirms and posts Burjman only, with its fingerprint', async () => {
    await openPreview(currentPayout(true))
    api.postStripePayoutGroup.mockResolvedValue({
      outcome: 'POSTED',
      alreadyPosted: false,
      payoutId: PAYOUT,
      customerId: 'BURJ',
      customerName: 'Burjman Shop - Web & App',
      components: [
        { component: 'NET', amount: 1203.49, reference: `Stripe funds received ${PAYOUT}`, status: 'VERIFIED', zohoRecordId: 'PAY-NET', requestSent: true },
        { component: 'FEE', amount: 40.06, reference: `Stripe processing fee ${PAYOUT}`, status: 'VERIFIED', zohoRecordId: 'PAY-FEE', requestSent: true },
      ],
      notAttempted: [],
      zohoRequests: 2,
      advanceCasesPosted: [],
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Post Customer Group to Zoho' })[0])
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('NET payment · AED 1,203.49')
    expect(dialog.textContent).toContain('Deposit to [1019] Stripe Undeposited Funds')
    expect(dialog.textContent).toContain('FEE payment · AED 40.06')
    expect(dialog.textContent).toContain('Deposit to [1013] Stripe Processing Chg Un-Cleared')
    for (const inv of ['INV-044103', 'INV-044120', 'INV-044093', 'INV-044038']) expect(dialog.textContent).toContain(inv)
    expect(dialog.textContent).not.toContain('INV-044122')
    expect(dialog.textContent).not.toContain('Customer Advance journal ·')
    expect(dialog.textContent).toContain('refund journal (Dr [1123] / Cr [1019]) is NOT part of this posting')

    const submit = screen.getByRole('button', { name: 'Post to Zoho' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)

    await waitFor(() => expect(api.postStripePayoutGroup).toHaveBeenCalledWith(PAYOUT, 'BURJ', 'fp-burjman'))
    expect(api.postStripePayoutGroup).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Result: POSTED/)).toBeTruthy()
    expect(screen.getByText(/Zoho PAY-FEE/)).toBeTruthy()
    await waitFor(() => expect(api.getStripePayoutPreview).toHaveBeenCalledTimes(2))
  })

  it('shows the Stripe arrival date separately from the Zoho posting date', async () => {
    const p = currentPayout(true)
    p.payout.arrivalDay = '2026-09-28'
    p.zohoPostingDate = '2026-10-03'
    p.proposedPaymentDate = '2026-10-03'
    await openPreview(p)
    const dates = screen.getByTestId('payout-dates').textContent || ''
    expect(dates).toContain('Arrival date 2026-09-28')
    expect(dates).toContain('Zoho posting date 2026-10-03')
    expect(screen.getByText(/dated on the day they are posted \(Asia\/Dubai\), not the arrival date/)).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Post Customer Group to Zoho' })[0])
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Zoho posting date 2026-10-03 (today, Asia/Dubai)')
    expect(dialog.textContent).toContain('Arrival date 2026-09-28')
    expect(dialog.textContent).not.toMatch(/Zoho posting date 2026-09-28/)
  })

  it('lists all three Website records and the INV-044122 split in the confirmation', async () => {
    await openPreview(currentPayout(true))
    fireEvent.click(screen.getAllByRole('button', { name: 'Post Customer Group to Zoho' })[1])
    const dialog = await screen.findByRole('dialog')
    const text = dialog.textContent || ''
    expect(text.indexOf('NET payment · AED 3,313.48')).toBeGreaterThan(-1)
    expect(text.indexOf('FEE payment · AED 107.22')).toBeGreaterThan(text.indexOf('NET payment'))
    expect(text.indexOf('Customer Advance journal · AED 35.00')).toBeGreaterThan(text.indexOf('FEE payment'))
    expect(text).toContain('Dr [1019] Stripe Undeposited Funds 35.00 / Cr [1123] Customer Advance Funds 35.00 · tagged Website')
    expect(text).toContain('1,033.07')
    expect(text).toContain('32.93')
    expect(text).toContain(`Stripe customer advance ${PAYOUT}`)
    expect(text).toContain('NOT part of this posting')
  })
})

function feeJournal(status: StripeFeeJournalStatus, postable: boolean): StripePayoutFeeJournal {
  return {
    component: 'PAYOUT_FEE_JOURNAL',
    status,
    reasons: status === 'WAITING' ? ['Customer group(s) not posted yet: Website (READY WITH CUSTOMER ADVANCE).'] : [],
    postable,
    tracked: false,
    amount: 147.28,
    stripeFeeTotal: 147.28,
    verifiedFeeTotal: status === 'WAITING' ? 40.06 : 147.28,
    feeComponents: [
      { customerId: 'WEB', customerName: 'Website', amount: 107.22, zohoState: status === 'WAITING' ? 'MISSING' : 'VERIFIED', zohoRecordId: null },
      { customerId: 'BURJ', customerName: 'Burjman Shop - Web & App', amount: 40.06, zohoState: 'VERIFIED', zohoRecordId: 'PAY-FEE' },
    ],
    reference: `Stripe processing fees ${PAYOUT}`,
    date: '2026-09-28',
    debitAccountId: '4265011000000648121',
    creditAccountId: '4265011000000699653',
    debitAccount: account('2270', 'Stripe Fees'),
    creditAccount: account('1013', 'Stripe Processing Chg Un-Cleared'),
    accountProblems: [],
    payload: {},
    zoho: { state: 'MISSING', recordId: null, records: [], differences: [] },
    legacy: null,
    local: null,
    recovery: { action: 'POST_ELIGIBLE', reason: 'Not in Zoho yet.' },
    postingFingerprint: 'fp-fee',
  }
}

function feePayout(postingEnabled: boolean, fj: StripePayoutFeeJournal): StripePayoutPreview {
  const p = currentPayout(postingEnabled)
  p.status = fj.status === 'READY' ? 'FEE_JOURNAL_PENDING' : 'PARTIALLY_CLEARED'
  p.feeJournal = fj
  return p
}

describe('StripePayoutPreviewPanel payout fee journal', () => {
  it('labels the new statuses', () => {
    expect(payoutTone('FEE_JOURNAL_PENDING')).toBe('warn')
    expect(feeJournalLabel('READY')).toMatch(/MISSING/)
    expect(feeJournalLabel('LEGACY_VERIFIED')).toBe('LEGACY VERIFIED')
    expect(feeJournalTone('NEEDS_REVIEW')).toBe('bad')
  })

  it('shows the section after the groups; no button while waiting for customer groups', async () => {
    await openPreview(feePayout(true, feeJournal('WAITING', false)))
    const section = screen.getByRole('region', { name: 'Payout fee journal' })
    expect(section.textContent).toContain('Payout Fee Journal')
    expect(section.textContent).toContain('WAITING')
    expect(section.textContent).toContain('[2270] Stripe Fees')
    expect(section.textContent).toContain('[1013] Stripe Processing Chg Un-Cleared')
    expect(section.textContent).toContain('Customer group(s) not posted yet')
    expect(screen.queryByRole('button', { name: 'Post Stripe Fee Journal to Zoho' })).toBeNull()
  })

  it('shows Posting disabled and a disabled button while the server flag is off', async () => {
    await openPreview(feePayout(false, feeJournal('READY', true)))
    const button = screen.getByRole('button', { name: 'Post Stripe Fee Journal to Zoho' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getAllByText('Posting disabled').length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText('FEE JOURNAL PENDING')).toBeTruthy()
    expect(api.postStripePayoutFeeJournal).not.toHaveBeenCalled()
  })

  it('confirms the total Dr 2270 / Cr 1013 journal with an acknowledgement and posts its fingerprint', async () => {
    await openPreview(feePayout(true, feeJournal('READY', true)))
    api.postStripePayoutFeeJournal.mockResolvedValue({
      outcome: 'VERIFIED',
      alreadyPosted: false,
      payoutId: PAYOUT,
      amount: 147.28,
      reference: `Stripe processing fees ${PAYOUT}`,
      component: { component: 'PAYOUT_FEE_JOURNAL', amount: 147.28, reference: `Stripe processing fees ${PAYOUT}`, status: 'VERIFIED', zohoRecordId: 'ZJ-FEE', requestSent: true },
      zohoRequests: 1,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post Stripe Fee Journal to Zoho' }))
    const dialog = await screen.findByRole('dialog')
    const text = dialog.textContent || ''
    expect(text).toContain(PAYOUT)
    expect(text).toContain('AED 147.28')
    expect(text).toContain('Website 107.22 + Burjman Shop - Web & App 40.06')
    expect(text).toContain('[2270] Stripe Fees')
    expect(text).toContain('[1013] Stripe Processing Chg Un-Cleared')
    expect(text).toContain('2026-09-28')
    expect(text).toContain(`Stripe processing fees ${PAYOUT}`)
    expect(text).toContain('not tagged to any customer')
    expect(text).not.toContain('INV-')

    const submit = screen.getByRole('button', { name: 'Post Fee Journal to Zoho' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(api.postStripePayoutFeeJournal).toHaveBeenCalledWith(PAYOUT, 'fp-fee'))
    expect(api.postStripePayoutFeeJournal).toHaveBeenCalledTimes(1)
    expect(api.postStripePayoutGroup).not.toHaveBeenCalled()
    expect(await screen.findByText(/Result: VERIFIED/)).toBeTruthy()
    expect(screen.getByText(/Zoho ZJ-FEE/)).toBeTruthy()
  })

  it('shows a legacy journal as verified with no posting offered', async () => {
    const fj = feeJournal('LEGACY_VERIFIED', false)
    fj.reasons = ['Legacy journal #3943 carries these fees; no new fee journal is needed.']
    fj.legacy = {
      state: 'MATCHED',
      reason: fj.reasons[0],
      window: { start: '2026-08-28', end: '2026-11-06' },
      candidatesChecked: 1,
      journals: [{ journalId: '4265011000042060622', entryNumber: '3943', journalDate: '2026-09-04', referenceNumber: 'Website&Burjuman stripe transaction fee - 50 Invoices', total: 863.85, how: 'CUSTOMER_FEE_LINES', matchedLines: [306.78, 8.99] }],
    }
    await openPreview(feePayout(true, fj))
    const section = screen.getByRole('region', { name: 'Payout fee journal' })
    expect(section.textContent).toContain('LEGACY VERIFIED')
    expect(section.textContent).toContain('Legacy journal #3943')
    expect(section.textContent).toContain('306.78 + 8.99')
    expect(screen.queryByRole('button', { name: 'Post Stripe Fee Journal to Zoho' })).toBeNull()
  })
})

describe('StripePayoutPreviewPanel', () => {
  it('shows the overpayment and confirms it locally with a reason and acknowledgement', async () => {
    api.getStripePayouts.mockResolvedValue({
      rows: [{ payoutId: PAYOUT, status: 'paid', amount: 4551.97, currency: 'AED', arrivalDate: '2026-09-28T00:00:00.000Z', createdAt: null, composition: preview(false).composition }],
    })
    api.getStripePayoutPreview.mockResolvedValueOnce(preview(false)).mockResolvedValueOnce(preview(true))
    api.confirmStripeCustomerAdvance.mockResolvedValue({ alreadyConfirmed: false, zohoWrites: 0 })

    render(<StripePayoutPreviewPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))

    expect(await screen.findByText('CUSTOMER OVERPAYMENT')).toBeTruthy()
    expect(screen.getAllByText('AED 1,101.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('AED 35.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('[1123] Customer Advance Funds · Website').length).toBe(1)
    expect(screen.queryByRole('button', { name: /Clear in Zoho|Post/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Customer Advance' }))
    const buttons = await screen.findAllByRole('button', { name: 'Confirm Customer Advance' })
    const submit = buttons[buttons.length - 1] as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Paid product removed after payment before invoicing. No refund was issued.' } })
    expect(submit.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)

    await waitFor(() => expect(api.confirmStripeCustomerAdvance).toHaveBeenCalledWith(
      PAYOUT,
      'ch_3UIA7CDJogiiRoKP07RCqZKw',
      'Paid product removed after payment before invoicing. No refund was issued.',
    ))
    expect(await screen.findByText('READY WITH CUSTOMER ADVANCE')).toBeTruthy()
    expect(screen.getByText(/Confirmed by user:1/)).toBeTruthy()
  })

  it('shows a refund detected after the payout and keeps Confirm Customer Advance available', async () => {
    const refunded = preview(false)
    const line = refunded.groups[0].lines[0]
    line.advance = {
      ...line.advance!,
      refundStatus: 'REFUND_DETECTED',
      refund: {
        refundId: 're_3UIA7CDJogiiRoKP0noUu0UZ',
        balanceTransactionId: 'txn_refund',
        amount: 35,
        fee: 0,
        net: -35,
        currency: 'AED',
        status: 'succeeded',
        createdAt: '2026-09-27T12:00:00.000Z',
        refundPayoutId: null,
      },
    }
    api.getStripePayouts.mockResolvedValue({
      rows: [{ payoutId: PAYOUT, status: 'paid', amount: 4551.97, currency: 'AED', arrivalDate: '2026-09-28T00:00:00.000Z', createdAt: null, composition: refunded.composition }],
    })
    api.getStripePayoutPreview.mockResolvedValueOnce(refunded)

    render(<StripePayoutPreviewPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))

    expect(await screen.findByText('CUSTOMER OVERPAYMENT')).toBeTruthy()
    expect(screen.getByText('Refund detected')).toBeTruthy()
    expect(screen.getByText('re_3UIA7CDJogiiRoKP0noUu0UZ')).toBeTruthy()
    expect(screen.getByText('Waiting for Stripe payout')).toBeTruthy()
    expect(screen.getByText('REFUND DETECTED')).toBeTruthy()
    expect(screen.getByText('Admin confirmation required')).toBeTruthy()
    expect(screen.getByText('AED 1,066.00')).toBeTruthy()
    expect(screen.getByText('NEEDS REVIEW', { selector: '.stripe-payout__group-head *' })).toBeTruthy()

    const confirmButton = screen.getByRole('button', { name: 'Confirm Customer Advance' }) as HTMLButtonElement
    expect(confirmButton.disabled).toBe(false)
    fireEvent.click(confirmButton)
    expect(await screen.findByText('Refund already detected')).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).placeholder).toMatch(/refunded in Stripe after this payout/)
  })

  it('lists a matched refund in a later payout with its posting blockers', async () => {
    const later = preview(true)
    later.groups = []
    later.advanceRefunds = [
      {
        balanceTransactionId: 'txn_refund',
        chargeId: 'ch_3UIA7CDJogiiRoKP07RCqZKw',
        refundId: 're_3UIA7CDJogiiRoKP0noUu0UZ',
        amount: 35,
        caseId: '1',
        caseStatus: 'CONFIRMED',
        originalPayoutId: PAYOUT,
        status: 'REFUND_MATCHED',
        matched: true,
        reason: 'Refund matches the confirmed customer advance.',
        originalAdvanceJournal: { reference: `Stripe customer advance ${PAYOUT}`, state: 'MISSING', recordId: null, reason: null },
        posting: { allowed: false, blockers: ['The original Customer Advance journal is not verified in Zoho yet.', 'Posting is disabled.'] },
        proposedJournal: null,
      },
    ]
    api.getStripePayouts.mockResolvedValue({
      rows: [{ payoutId: PAYOUT, status: 'paid', amount: 4551.97, currency: 'AED', arrivalDate: '2026-09-28T00:00:00.000Z', createdAt: null, composition: later.composition }],
    })
    api.getStripePayoutPreview.mockResolvedValueOnce(later)

    render(<StripePayoutPreviewPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))

    expect(await screen.findByText(/Original advance journal .*MISSING/)).toBeTruthy()
    expect(screen.getByText(/Refund journal cannot be posted yet: The original Customer Advance journal is not verified/)).toBeTruthy()
  })
})

const RPO = 'po_1U8V40RefundTest0001'

function normalRefund(overrides: Partial<StripeNormalRefund> = {}): StripeNormalRefund {
  const reference = 'Stripe refund re_3U6IwD20717a'
  return {
    refundId: 're_3U6IwD20717a',
    balanceTransactionId: 'txn_refund_20717',
    chargeId: 'ch_3U6IwD20717',
    paymentIntentId: 'pi_3U6IwD20717',
    currency: 'AED',
    stripeRefundStatus: 'succeeded',
    gross: 76.7,
    stripeFee: 0,
    feeAdjustment: 0,
    net: -76.7,
    reference,
    kind: 'PARTIAL_REFUND',
    sequence: 1,
    refundCount: 1,
    chargeGross: 382.59,
    priorRefunded: 0,
    cumulativeRefunded: 76.7,
    remainingRefundable: 305.89,
    website: { orderId: '9', orderNumber: '20717', finalAmount: 382.59, shopOrder: false, orderStatus: 'delivered', paymentStatus: 'partially_refunded' },
    invoice: { invoiceId: 'INV1', invoiceNumber: 'INV-043700', total: 382.59, balance: 0, status: 'paid', customerId: 'WEB' },
    customerId: 'WEB',
    customerName: 'Website',
    creditNote: {
      creditNoteId: 'CN1',
      creditNoteNumber: '20717',
      status: 'open',
      date: '2026-09-02',
      total: 76.7,
      balance: 76.7,
      invoiceId: 'INV1',
      invoiceNumber: 'INV-043700',
      salesReturnNumber: 'RMA-00412',
      customerId: 'WEB',
      refunds: [],
      matchedBy: 'EXACT_TOTAL',
    },
    creditNoteCandidates: [],
    returnedItems: [
      { name: 'Frying Pan 28cm', sku: 'LIFEFP28', itemId: 'IT1', quantity: 1, rate: 76.7, total: 76.7, invoiceLineItemId: 'L1', linkedBy: 'INVOICE_LINE' },
    ],
    itemsProven: true,
    itemsReason: null,
    legacyRefund: null,
    clearingImpact: { stripeUndepositedFunds: -76.7, processingChargesUncleared: 0 },
    components: [
      {
        component: 'REFUND_CREDIT_NOTE_REFUND',
        zohoRecordType: 'creditnote_refund',
        amount: 76.7,
        currency: 'AED',
        reference,
        date: '2026-09-03',
        creditNoteId: 'CN1',
        creditNoteNumber: '20717',
        depositAccountId: '1019',
        debitAccountId: null,
        creditAccountId: null,
        payload: { reference_number: reference, amount: 76.7, from_account_id: '1019' },
        zoho: { state: 'MISSING', recordId: null, records: [], differences: [] },
        local: null,
        recovery: { action: 'POST_ELIGIBLE', reason: 'Not in Zoho yet.' },
      },
    ],
    status: 'READY',
    reasonCode: null,
    reason: 'Partial refund 76.70 of INV-043700 (76.70 of 382.59 refunded so far): refund credit note 20717 from Stripe Undeposited Funds.',
    reasons: ['Partial refund 76.70 of INV-043700 (76.70 of 382.59 refunded so far): refund credit note 20717 from Stripe Undeposited Funds.'],
    tracked: false,
    postable: true,
    postingFingerprint: 'fp-refund-20717',
    ...overrides,
  }
}

function refundPayout(postingEnabled: boolean, refunds: StripeNormalRefund[]): StripePayoutPreview {
  const p = preview(true)
  return {
    ...p,
    postingEnabled,
    payout: { ...p.payout, payoutId: RPO },
    groups: [],
    normalRefunds: refunds,
    refundBlockers: refunds.filter((x) => x.status === 'NEEDS_REVIEW').map((x) => `Refund ${x.refundId} (${x.gross}): ${x.reason}`),
    reconciliation: { ...p.reconciliation, normalRefundsGross: 76.7, normalRefundFeeAdjustments: 0, normalRefundsNetOutOf1019: 76.7 },
    advanceRefunds: [
      {
        balanceTransactionId: 'txn_adv_refund',
        chargeId: 'ch_3UIA7CDJogiiRoKP07RCqZKw',
        refundId: 're_3UIA7CDJogiiRoKP0noUu0UZ',
        amount: 35,
        caseId: '1',
        caseStatus: 'CONFIRMED',
        originalPayoutId: PAYOUT,
        status: 'REFUND_MATCHED',
        matched: true,
        reason: 'Refund matches the confirmed customer advance.',
        originalAdvanceJournal: { reference: `Stripe customer advance ${PAYOUT}`, state: 'VERIFIED', recordId: 'J1', reason: null },
        refundJournal: { reference: `Stripe customer advance refund ${RPO}`, state: 'MISSING', recordId: null, reason: null },
        posting: { allowed: false, blockers: ['Posting is disabled.'] },
        proposedJournal: null,
      },
    ],
  }
}

async function openRefundPreview(p: StripePayoutPreview) {
  api.getStripePayouts.mockResolvedValue({
    rows: [{ payoutId: RPO, status: 'paid', amount: 1, currency: 'AED', arrivalDate: '2026-09-28T00:00:00.000Z', createdAt: null, composition: p.composition }],
  })
  api.getStripePayoutPreview.mockResolvedValue(p)
  render(<StripePayoutPreviewPanel />)
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))
  return screen.findByRole('region', { name: 'Refunds' })
}

describe('StripePayoutPreviewPanel normal invoice refunds', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('labels refund kind, fee direction and status tone', () => {
    expect(refundKindLabel(normalRefund())).toBe('Partial refund')
    expect(refundKindLabel(normalRefund({ kind: 'FULL_REFUND', sequence: 3, refundCount: 3 }))).toBe('Full refund 3 of 3')
    expect(refundKindLabel(normalRefund({ kind: null }))).toBe('—')
    expect(feeAdjustmentLabel(normalRefund())).toBe('None')
    expect(feeAdjustmentLabel(normalRefund({ feeAdjustment: 2.1 }))).toBe('2.10 fee returned · Dr 1019 / Cr 1013')
    expect(feeAdjustmentLabel(normalRefund({ feeAdjustment: -1.5 }))).toBe('1.50 fee charged · Dr 1013 / Cr 1019')
    expect(normalRefundTone('READY')).toBe('ok')
    expect(normalRefundTone('NEEDS_REVIEW')).toBe('bad')
    expect(normalRefundTone('VERIFIED')).toBe('muted')
  })

  it('keeps normal invoice refunds and customer advance refunds in separate sections, with every refund field', async () => {
    const section = await openRefundPreview(refundPayout(false, [normalRefund()]))
    expect(screen.getByText('Normal invoice refunds (1)')).toBeTruthy()
    expect(screen.getByText('Customer advance refunds (1)')).toBeTruthy()
    const card = screen.getByLabelText('Refund re_3U6IwD20717a')
    expect(section.contains(card)).toBe(true)
    for (const text of ['re_3U6IwD20717a', 'txn_refund_20717', 'ch_3U6IwD20717 / pi_3U6IwD20717', '20717', 'Website', 'Frying Pan 28cm', 'READY']) {
      expect(card.textContent).toContain(text)
    }
    expect(card.textContent).toContain('INV-043700 · AED 382.59 · balance 0.00')
    expect(card.textContent).toContain('76.70 of 382.59 · 305.89 left')
    expect(card.textContent).toContain('76.70 / None / -76.70')
    expect(card.textContent).toContain('1019 -76.70')
    expect(card.textContent).toContain('Credit note 20717 · AED 76.70 · balance 76.70 · open · sales return RMA-00412')
    expect(card.textContent).toMatch(/Credit note refund AED 76.70 · Stripe refund re_3U6IwD20717a · Zoho MISSING · Not in Zoho yet/)
    expect(screen.queryByLabelText('Refund re_3UIA7CDJogiiRoKP0noUu0UZ')).toBeNull()
    expect(screen.getByText(/Refund journal Dr \[1123\] \/ Cr \[1019\] .*MISSING/)).toBeTruthy()
    expect(screen.getByText(/− invoice refunds 76.70 = payout/)).toBeTruthy()
  })

  it('shows Posting disabled and a disabled button while the server flag is off', async () => {
    await openRefundPreview(refundPayout(false, [normalRefund()]))
    const button = screen.getByRole('button', { name: 'Post refund to Zoho' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(api.postStripePayoutRefund).not.toHaveBeenCalled()
  })

  it('never offers posting for a refund that needs review and explains why', async () => {
    const review = normalRefund({
      status: 'NEEDS_REVIEW',
      postable: false,
      postingFingerprint: null,
      creditNote: null,
      returnedItems: [],
      itemsProven: false,
      itemsReason: null,
      components: [],
      reasonCode: 'CUSTOMER_MISMATCH',
      reason: 'Zoho invoice INV-043700 is not under the Website customer that owns website order 20717.',
      reasons: ['Zoho invoice INV-043700 is not under the Website customer that owns website order 20717.'],
    })
    await openRefundPreview(refundPayout(true, [review]))
    const card = screen.getByLabelText('Refund re_3U6IwD20717a')
    expect(card.textContent).toContain('NEEDS REVIEW')
    expect(card.textContent).toContain('is not under the Website customer')
    expect(card.textContent).toContain('No Zoho credit note found for this order.')
    expect(screen.queryByRole('button', { name: 'Post refund to Zoho' })).toBeNull()
    expect(screen.getByText(/Refunds needing review keep this payout from being fully cleared/)).toBeTruthy()
  })

  it('confirms the credit note refund and fee adjustment, then posts with the refund fingerprint', async () => {
    const withFee = normalRefund({
      stripeFee: -2.1,
      feeAdjustment: 2.1,
      net: -74.6,
      clearingImpact: { stripeUndepositedFunds: -74.6, processingChargesUncleared: -2.1 },
    })
    withFee.components.push({
      ...withFee.components[0],
      component: 'REFUND_FEE_ADJUSTMENT',
      zohoRecordType: 'journal',
      amount: 2.1,
      reference: 'Stripe refund fee re_3U6IwD20717a',
      direction: 'FEE_RETURNED',
      depositAccountId: null,
      debitAccountId: '1019',
      creditAccountId: '1013',
    })
    api.postStripePayoutRefund.mockResolvedValue({
      outcome: 'VERIFIED',
      alreadyPosted: false,
      payoutId: RPO,
      refundId: 're_3U6IwD20717a',
      amount: 76.7,
      creditNoteNumber: '20717',
      components: [
        { component: 'REFUND_CREDIT_NOTE_REFUND', amount: 76.7, reference: 'Stripe refund re_3U6IwD20717a', status: 'VERIFIED', zohoRecordId: 'ZCR1', requestSent: true },
        { component: 'REFUND_FEE_ADJUSTMENT', amount: 2.1, reference: 'Stripe refund fee re_3U6IwD20717a', status: 'VERIFIED', zohoRecordId: 'ZJ1', requestSent: true },
      ],
      notAttempted: [],
      zohoRequests: 2,
    })
    await openRefundPreview(refundPayout(true, [withFee]))
    const card = screen.getByLabelText('Refund re_3U6IwD20717a')
    expect(card.textContent).toContain('2.10 fee returned · Dr 1019 / Cr 1013')
    expect(card.textContent).toContain('1019 -74.60 · 1013 -2.10')

    fireEvent.click(screen.getByRole('button', { name: 'Post refund to Zoho' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Credit note 20717 refunded from [1019] Stripe Undeposited Funds')
    expect(dialog.textContent).toContain('Dr [1019] Stripe Undeposited Funds / Cr [1013] Stripe Processing Chg Un-Cleared')
    const post = screen.getByRole('button', { name: 'Post Refund to Zoho' }) as HTMLButtonElement
    expect(post.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(post.disabled).toBe(false)
    fireEvent.click(post)
    await waitFor(() => expect(api.postStripePayoutRefund).toHaveBeenCalledWith(RPO, 're_3U6IwD20717a', 'fp-refund-20717'))
    expect(await screen.findByText(/Result: VERIFIED/)).toBeTruthy()
    expect(screen.getByText(/Zoho requests sent: 2/)).toBeTruthy()
  })
})

describe('StripePayoutPreviewPanel signed payout fee journal', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows a negative net fee as a Dr 1013 / Cr 2270 reversal and confirms it with reversal wording', async () => {
    const reversal: StripePayoutFeeJournal = {
      ...feeJournal('READY', true),
      amount: 3,
      signedAmount: -3,
      direction: 'FEE_REVERSAL',
      stripeFeeTotal: -3,
      verifiedFeeTotal: -3,
      feeComponents: [],
      refundFeeAdjustments: [{ refundId: 're_3U6IwD20717a', fee: -3, zohoState: 'VERIFIED', zohoRecordId: 'ZJ-ADJ' }],
      debitAccountId: '4265011000000699653',
      creditAccountId: '4265011000000648121',
      debitAccount: account('1013', 'Stripe Processing Chg Un-Cleared'),
      creditAccount: account('2270', 'Stripe Fees'),
      reasons: ['Every FEE payment and refund fee adjustment is verified; Stripe returned 3.00 more fees than it charged.'],
    }
    const p = feePayout(true, reversal)
    api.getStripePayouts.mockResolvedValue({
      rows: [{ payoutId: PAYOUT, status: 'paid', amount: 1, currency: 'AED', arrivalDate: '2026-09-28T00:00:00.000Z', createdAt: null, composition: p.composition }],
    })
    api.getStripePayoutPreview.mockResolvedValue(p)
    render(<StripePayoutPreviewPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))

    const card = await screen.findByRole('region', { name: 'Payout fee journal' })
    expect(card.textContent).toContain('fee expense reversal of 3.00 (Dr 1013 / Cr 2270)')
    expect(card.textContent).toContain('Refund re_3U6IwD20717a fee adjustment -3.00')
    const rows = Array.from(card.querySelectorAll('tbody tr')).map((r) => r.textContent)
    expect(rows[0]).toMatch(/^Dr.*1013.*3\.00$/)
    expect(rows[1]).toMatch(/^Cr.*2270.*3\.00$/)

    fireEvent.click(screen.getByRole('button', { name: 'Post Stripe Fee Journal to Zoho' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('from Stripe Fees back to Stripe Processing Chg Un-Cleared (fee expense reversal)')
  })
})

function uncertainItem(overrides: Partial<StripeUncertainComponent> = {}): StripeUncertainComponent {
  return {
    scope: 'component',
    componentId: 'comp-fee-journal',
    component: 'PAYOUT_FEE_JOURNAL',
    zohoRecordType: 'JOURNAL',
    customerId: null,
    refundId: null,
    creditNoteId: null,
    reference: `Stripe processing fees ${PAYOUT}`,
    amount: 147.28,
    status: 'POSTING_UNCERTAIN',
    attemptCount: 1,
    lastError: 'Zoho request timed out.',
    firstUncertainAt: '2026-09-28T14:00:00.000Z',
    uncertainSince: '2026-09-28T14:00:00.000Z',
    lastRecoveryCheckAt: '2026-09-28T14:00:01.000Z',
    recoveryCheckCount: 1,
    confirmAvailableAt: '2026-09-28T14:15:00.000Z',
    canConfirm: false,
    confirmBlockedReason: 'Wait until 2026-09-28 14:15 so Zoho search can catch up before confirming.',
    ...overrides,
  }
}

function uncertainPayout(item: StripeUncertainComponent): StripePayoutPreview {
  const fj = feeJournal('POSTING_UNCERTAIN', false)
  fj.recovery = { action: 'POSTING_UNCERTAIN', reason: 'Zoho response uncertain — do not repost.' }
  const p = feePayout(true, fj)
  p.status = 'POSTING_UNCERTAIN'
  p.uncertainComponents = [item]
  return p
}

function resolution(outcome: 'VERIFIED' | 'NEEDS_REVIEW' | 'POSTING_UNCERTAIN' | 'FAILED', retryAllowed = false) {
  return {
    payoutId: PAYOUT,
    scope: 'component' as const,
    componentId: 'comp-fee-journal',
    outcome,
    component: { component: 'PAYOUT_FEE_JOURNAL' as const, amount: 147.28, reference: `Stripe processing fees ${PAYOUT}`, status: outcome, zohoRecordId: null, requestSent: false, retryAllowed },
    zohoWrites: 0 as const,
  }
}

describe('StripePayoutPreviewPanel uncertain Zoho writes', () => {
  it('labels the uncertain state as do-not-repost, never as failed', () => {
    expect(recoveryLabel('POSTING_UNCERTAIN')).toBe('Zoho response uncertain — do not repost')
    expect(payoutTone('POSTING_UNCERTAIN')).toBe('bad')
    expect(feeJournalLabel('POSTING_UNCERTAIN')).toBe('ZOHO RESPONSE UNCERTAIN')
    expect(feeJournalLabel('POSTING_UNCERTAIN')).not.toMatch(/FAIL/)
  })

  it('shows the warning and hides every Post button while a write is uncertain', async () => {
    const p = uncertainPayout(uncertainItem())
    p.groups = []
    await openPreviewNoGroups(p)
    const section = screen.getByRole('region', { name: 'Uncertain Zoho writes' })
    expect(section.textContent).toContain('Zoho response uncertain — do not repost')
    expect(section.textContent).toContain(`Stripe processing fees ${PAYOUT}`)
    expect(section.textContent).toContain('Zoho request timed out.')
    expect(screen.queryByRole('button', { name: 'Post Stripe Fee Journal to Zoho' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Recheck Zoho' })).toBeTruthy()
  })

  it('keeps Post hidden even if a stale preview marks the uncertain fee journal postable', async () => {
    const p = uncertainPayout(uncertainItem())
    p.groups = []
    if (p.feeJournal) p.feeJournal.postable = true
    await openPreviewNoGroups(p)
    expect(screen.queryByRole('button', { name: 'Post Stripe Fee Journal to Zoho' })).toBeNull()
  })

  it('Recheck Zoho is read-only: it calls the recheck endpoint only and reloads', async () => {
    const p = uncertainPayout(uncertainItem())
    p.groups = []
    await openPreviewNoGroups(p)
    api.recheckStripeUncertainComponent.mockResolvedValue(resolution('POSTING_UNCERTAIN'))
    fireEvent.click(screen.getByRole('button', { name: 'Recheck Zoho' }))
    await waitFor(() => expect(api.recheckStripeUncertainComponent).toHaveBeenCalledWith(PAYOUT, 'component', 'comp-fee-journal'))
    expect(await screen.findByText(/Still not found in Zoho/)).toBeTruthy()
    expect(api.confirmStripeUncertainNotCreated).not.toHaveBeenCalled()
    expect(api.postStripePayoutFeeJournal).not.toHaveBeenCalled()
    expect(api.postStripePayoutGroup).not.toHaveBeenCalled()
    expect(api.postStripePayoutRefund).not.toHaveBeenCalled()
    expect(api.getStripePayoutPreview).toHaveBeenCalledTimes(2)
  })

  it('disables Confirm Not Created until the safeguards are met and says why', async () => {
    const p = uncertainPayout(uncertainItem())
    p.groups = []
    await openPreviewNoGroups(p)
    const confirm = screen.getByRole('button', { name: 'Confirm Not Created…' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(screen.getByText(/Wait until 2026-09-28 14:15/)).toBeTruthy()
  })

  it('confirms not created only with the admin\'s own recorded Zoho check, a reason and acknowledgement, and never posts', async () => {
    const p = uncertainPayout(uncertainItem({ canConfirm: true, confirmBlockedReason: null }))
    p.groups = []
    await openPreviewNoGroups(p)
    api.confirmStripeUncertainNotCreated.mockResolvedValue(resolution('FAILED', true))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Not Created…' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Zoho response uncertain — do not repost')
    expect(dialog.textContent).toContain('Zoho will hold it twice')

    const submit = screen.getByRole('button', { name: 'Confirm Not Created and Allow Retry' }) as HTMLButtonElement
    const REF = `Stripe processing fees ${PAYOUT}`
    expect(submit.disabled).toBe(true)
    fireEvent.change(dialog.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'Searched Zoho journals for this reference on 2026-09-28: none.' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /does not exist there/ }))
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('When you checked'), { target: { value: '2026-09-28T18:30' } })
    fireEvent.change(screen.getByLabelText('Where in Zoho you searched'), { target: { value: 'Manual Journals' } })
    fireEvent.change(screen.getByLabelText(/What you searched for/), { target: { value: 'Stripe fees on the payout date' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'My search found no matching record.' }))
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/What you searched for/), { target: { value: `${REF} and date 2026-09-28` } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() =>
      expect(api.confirmStripeUncertainNotCreated).toHaveBeenCalledWith(
        PAYOUT,
        'component',
        'comp-fee-journal',
        'Searched Zoho journals for this reference on 2026-09-28: none.',
        {
          checkedAt: new Date('2026-09-28T18:30').toISOString(),
          zohoLocation: 'Manual Journals',
          searchedFor: `${REF} and date 2026-09-28`,
          recordsFound: 0,
        },
      ),
    )
    expect(await screen.findByText(/Retry allowed. Nothing was posted/)).toBeTruthy()
    expect(api.postStripePayoutFeeJournal).not.toHaveBeenCalled()
    expect(api.recheckStripeUncertainComponent).not.toHaveBeenCalled()
  })

  it('reports a record found during confirmation instead of allowing a retry', async () => {
    const p = uncertainPayout(uncertainItem({ canConfirm: true, confirmBlockedReason: null }))
    p.groups = []
    await openPreviewNoGroups(p)
    api.confirmStripeUncertainNotCreated.mockResolvedValue(resolution('VERIFIED'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Not Created…' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(dialog.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'Searched Zoho, nothing found.' } })
    fireEvent.change(screen.getByLabelText('When you checked'), { target: { value: '2026-09-28T18:30' } })
    fireEvent.change(screen.getByLabelText('Where in Zoho you searched'), { target: { value: 'Manual Journals' } })
    fireEvent.change(screen.getByLabelText(/What you searched for/), { target: { value: `Stripe processing fees ${PAYOUT}` } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'My search found no matching record.' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /does not exist there/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Not Created and Allow Retry' }))
    expect(await screen.findByText(/Found in Zoho and it matches exactly/)).toBeTruthy()
    expect(screen.queryByText(/Retry allowed/)).toBeNull()
  })
})

async function openPreviewNoGroups(p: StripePayoutPreview) {
  api.getStripePayouts.mockResolvedValue({
    rows: [{ payoutId: PAYOUT, status: 'paid', amount: 4551.97, currency: 'AED', arrivalDate: '2026-09-28T00:00:00.000Z', createdAt: null, composition: p.composition }],
  })
  api.getStripePayoutPreview.mockResolvedValue(p)
  render(<StripePayoutPreviewPanel />)
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))
  await screen.findByRole('region', { name: 'Uncertain Zoho writes' })
}

/** `count` payouts newest first: po_list_001 is the newest. The first one is in transit. */
function payoutRows(count: number, prefix = 'po_list_'): StripePayoutSummary[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(3, '0')
    const day = new Date(Date.UTC(2026, 8, 29 - i)).toISOString()
    return {
      payoutId: `${prefix}${n}`,
      status: i === 0 ? 'in_transit' : 'paid',
      amount: 1000 + i,
      currency: 'AED',
      arrivalDate: day,
      createdAt: day,
      composition: { chargeCount: 3, chargeGross: 1030 + i, chargeFee: 30, chargeNet: 1000 + i, otherCount: 0, otherNet: 0, contentNet: 1000 + i, payoutAmount: 1000 + i, reconciles: true },
    }
  })
}

function cachedList(rows: StripePayoutSummary[], refreshedAt: string | null = '2026-09-29T07:00:00.000Z') {
  return { rows, refreshedAt, count: rows.length, maxRows: 30, source: 'cache' as const }
}

function visiblePayoutIds() {
  return screen.getAllByText(/^po_(list|new)_\d{3}$/).map((el) => el.textContent)
}

function expectNoPostingCalls() {
  expect(api.postStripePayoutGroup).not.toHaveBeenCalled()
  expect(api.postStripePayoutFeeJournal).not.toHaveBeenCalled()
  expect(api.postStripePayoutRefund).not.toHaveBeenCalled()
  expect(api.recheckStripeUncertainComponent).not.toHaveBeenCalled()
  expect(api.confirmStripeUncertainNotCreated).not.toHaveBeenCalled()
  expect(api.confirmStripeCustomerAdvance).not.toHaveBeenCalled()
  expect(api.releaseStripeDirectPayment).not.toHaveBeenCalled()
}

describe('pageOf', () => {
  it('splits 30 rows into three pages of 10, newest first', () => {
    const rows = payoutRows(30)
    expect(pageOf(rows, 1).rows.map((r) => r.payoutId)).toEqual(rows.slice(0, 10).map((r) => r.payoutId))
    expect(pageOf(rows, 2)).toMatchObject({ page: 2, pageCount: 3, from: 11, to: 20, total: 30 })
    expect(pageOf(rows, 3).rows[9].payoutId).toBe('po_list_030')
    expect(pageOf(rows, 9).page).toBe(3)
    expect(pageOf(rows, 0).page).toBe(1)
  })

  it('handles fewer than 30 rows and an empty list', () => {
    expect(pageOf(payoutRows(7), 1)).toMatchObject({ page: 1, pageCount: 1, from: 1, to: 7, total: 7 })
    expect(pageOf([], 1)).toMatchObject({ page: 1, pageCount: 1, from: 0, to: 0, total: 0 })
  })
})

describe('StripePayoutPreviewPanel payout list', () => {
  it('shows the cached list on open without asking Stripe, 10 per page', async () => {
    api.getStripePayouts.mockResolvedValue(cachedList(payoutRows(30)))
    render(<StripePayoutPreviewPanel />)

    expect(await screen.findByText('po_list_001')).toBeTruthy()
    expect(visiblePayoutIds()).toEqual(payoutRows(10).map((r) => r.payoutId))
    expect(screen.getByText('Showing 1–10 of 30')).toBeTruthy()
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
    expect(screen.getByText('in_transit')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.getStripePayouts).toHaveBeenCalledTimes(1)
    expect(api.refreshStripePayouts).not.toHaveBeenCalled()
    expect(api.getStripePayoutPreview).not.toHaveBeenCalled()
    expectNoPostingCalls()
  })

  it('pages through the cached rows without any server call', async () => {
    const rows = payoutRows(30)
    api.getStripePayouts.mockResolvedValue(cachedList(rows))
    render(<StripePayoutPreviewPanel />)
    await screen.findByText('po_list_001')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Page 2 of 3')).toBeTruthy()
    expect(screen.getByText('Showing 11–20 of 30')).toBeTruthy()
    expect(visiblePayoutIds()).toEqual(rows.slice(10, 20).map((r) => r.payoutId))

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Page 3 of 3')).toBeTruthy()
    expect(visiblePayoutIds()).toEqual(rows.slice(20, 30).map((r) => r.payoutId))
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getByText('Page 2 of 3')).toBeTruthy()

    expect(api.getStripePayouts).toHaveBeenCalledTimes(1)
    expect(api.refreshStripePayouts).not.toHaveBeenCalled()
    expect(api.getStripePayoutPreview).not.toHaveBeenCalled()
  })

  it('reopening the page reads the saved list again and never refreshes from Stripe', async () => {
    api.getStripePayouts.mockResolvedValue(cachedList(payoutRows(30)))
    const first = render(<StripePayoutPreviewPanel />)
    await screen.findByText('po_list_001')
    first.unmount()

    render(<StripePayoutPreviewPanel />)
    expect(await screen.findByText('po_list_001')).toBeTruthy()
    expect(api.getStripePayouts).toHaveBeenCalledTimes(2)
    expect(api.refreshStripePayouts).not.toHaveBeenCalled()
  })

  it('Reload payouts refreshes from Stripe, keeps the old list visible meanwhile and returns to page 1', async () => {
    api.getStripePayouts.mockResolvedValue(cachedList(payoutRows(30)))
    let resolveRefresh: (value: ReturnType<typeof cachedList>) => void = () => {}
    api.refreshStripePayouts.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve }))
    render(<StripePayoutPreviewPanel />)
    await screen.findByText('po_list_001')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Page 3 of 3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Reload payouts' }))
    const busy = screen.getByRole('button', { name: 'Reloading from Stripe…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    expect(screen.getByText('po_list_030')).toBeTruthy()

    resolveRefresh({ ...cachedList(payoutRows(30, 'po_new_'), '2026-09-29T08:00:00.000Z'), source: 'stripe' as never })
    expect(await screen.findByText('po_new_001')).toBeTruthy()
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
    expect(screen.queryByText('po_list_001')).toBeNull()
    expect(api.refreshStripePayouts).toHaveBeenCalledTimes(1)
    expect(api.getStripePayouts).toHaveBeenCalledTimes(1)
    expectNoPostingCalls()
  })

  it('keeps the cached list and shows the error when the refresh fails', async () => {
    api.getStripePayouts.mockResolvedValue(cachedList(payoutRows(30)))
    api.refreshStripePayouts.mockRejectedValue(new Error('Stripe is unavailable.'))
    render(<StripePayoutPreviewPanel />)
    await screen.findByText('po_list_001')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    fireEvent.click(screen.getByRole('button', { name: 'Reload payouts' }))
    expect(await screen.findByText('Stripe is unavailable.')).toBeTruthy()
    expect(screen.getByText('po_list_011')).toBeTruthy()
    expect(screen.getByText('Page 2 of 3')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Reload payouts' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows fewer than 30 payouts on a single page', async () => {
    api.getStripePayouts.mockResolvedValue(cachedList(payoutRows(7)))
    render(<StripePayoutPreviewPanel />)
    await screen.findByText('po_list_001')
    expect(visiblePayoutIds()).toHaveLength(7)
    expect(screen.getByText('Showing 1–7 of 7')).toBeTruthy()
    expect(screen.getByText('Page 1 of 1')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows an empty state until Reload payouts fills the cache', async () => {
    api.getStripePayouts.mockResolvedValue(cachedList([], null))
    api.refreshStripePayouts.mockResolvedValue(cachedList(payoutRows(12)))
    render(<StripePayoutPreviewPanel />)
    expect(await screen.findByText(/No payouts saved yet/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reload payouts' }))
    expect(await screen.findByText('po_list_001')).toBeTruthy()
    expect(screen.getByText('Page 1 of 2')).toBeTruthy()
  })

  it('Preview still loads the detailed preview for one payout only', async () => {
    api.getStripePayouts.mockResolvedValue(cachedList(payoutRows(30)))
    api.getStripePayoutPreview.mockResolvedValue(currentPayout(false))
    render(<StripePayoutPreviewPanel />)
    await screen.findByText('po_list_001')
    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' })[2])
    await screen.findByText('Burjman Shop - Web & App')
    expect(api.getStripePayoutPreview).toHaveBeenCalledTimes(1)
    expect(api.getStripePayoutPreview).toHaveBeenCalledWith('po_list_003')
    expect(api.refreshStripePayouts).not.toHaveBeenCalled()
    expectNoPostingCalls()
  })
})

const DIRECT_PAYOUT = 'po_1UDDZ3DJogiiRoKPj4uB4mEL'
const DIRECT_PI = 'pi_3UB7cxDJogiiRoKP2ddNSqC5'
const DIRECT_CH = 'ch_3UB7cxDJogiiRoKP2kd1Ng0X'

const INV_043544 = {
  invoiceId: 'ZID-INV-043544',
  invoiceNumber: 'INV-043544',
  referenceNumber: '20901',
  customerId: 'WEB',
  customerName: 'Website',
  customerKey: 'WEBSITE' as const,
  date: '2026-09-02',
  total: 1261,
  balance: 1261,
  status: 'sent',
  currencyCode: 'AED',
}

function unresolvedLine(patch: Partial<StripeUnassignedLine> = {}): StripeUnassignedLine {
  return {
    balanceTransactionId: 'txn_direct',
    chargeId: DIRECT_CH,
    paymentIntentId: DIRECT_PI,
    gross: 1261,
    fee: 50.18,
    net: 1210.82,
    invoiceTotal: 1261,
    netAllocation: 1210.82,
    feeAllocation: 50.18,
    customerAdvance: 0,
    source: null,
    website: null,
    direct: null,
    chargeCreatedAt: '2026-09-02T09:15:00.000Z',
    description: null,
    invoice: null,
    advance: null,
    state: 'NEEDS_REVIEW',
    matchStatus: null,
    reason: 'No website order carries this PaymentIntent.',
    directEligible: true,
    directIneligibleReason: null,
    stripeEvidence: {
      paymentIntentId: DIRECT_PI,
      chargeId: DIRECT_CH,
      description: null,
      chargeDescription: null,
      metadata: {},
      createdAt: '2026-09-02T09:15:00.000Z',
      sessions: [{
        checkoutSessionId: 'cs_live_x',
        paymentLinkId: 'plink_1',
        clientReferenceId: null,
        metadata: {},
        products: [{ productName: 'Matjar meem #20901', productDescription: 'invoice #20901', lineDescription: 'Matjar meem #20901', amountMinor: 126100, quantity: 1 }],
      }],
    },
    references: [{ kind: 'reference', value: '20901', sources: [{ source: 'Payment Link product', text: 'Matjar meem #20901' }] }],
    suggestion: {
      status: 'SUGGESTED',
      reason: 'Stripe reference matches INV-043544 (P.O.# 20901), same amount, open, supported customer.',
      invoiceId: INV_043544.invoiceId,
      candidates: [{ ...INV_043544, fits: true }],
    },
    evidenceError: null,
    ...patch,
  }
}

function mapping(patch: Partial<StripeDirectMapping> = {}): StripeDirectMapping {
  return {
    mappingId: 1,
    mappingType: 'DIRECT_PAYMENT',
    status: 'ACTIVE',
    paymentIntentId: DIRECT_PI,
    chargeId: DIRECT_CH,
    zohoInvoiceId: INV_043544.invoiceId,
    invoiceNumber: 'INV-043544',
    zohoCustomerId: 'WEB',
    customerKey: 'WEBSITE',
    invoiceReference: '20901',
    stripeGross: 1261,
    evidence: 'Payment Link product "Matjar meem #20901" ↔ INV-043544 P.O.# 20901',
    reason: 'Payment Link Matjar meem #20901 paid INV-043544',
    firstPayoutId: DIRECT_PAYOUT,
    mappedBy: 'user:7',
    mappedAt: '2026-09-29T10:00:00.000Z',
    removable: true,
    lockedReason: null,
    ...patch,
  }
}

function websiteLine(id: string, invoiceNumber: string, order: string, gross: number, fee: number): StripePayoutLine {
  return {
    balanceTransactionId: id,
    chargeId: `ch_${id}`,
    paymentIntentId: `pi_${id}`,
    gross,
    fee,
    net: Math.round((gross - fee) * 100) / 100,
    invoiceTotal: gross,
    netAllocation: Math.round((gross - fee) * 100) / 100,
    feeAllocation: fee,
    customerAdvance: 0,
    source: 'WEBSITE_ORDER',
    website: { orderId: id, orderNumber: order, finalAmount: gross, shopOrder: false, orderStatus: 'delivered', paymentStatus: 'completed' },
    invoice: { invoiceId: invoiceNumber, invoiceNumber, total: gross, balance: gross, status: 'sent', customerId: 'WEB' },
    advance: null,
    state: 'OPEN',
    matchStatus: 'MATCHED_READY_TO_CLEAR',
    reason: 'Invoice open for the Stripe gross.',
  }
}

function directPreview(mapped: StripeDirectMapping | null): StripePayoutPreview {
  const web = [websiteLine('w1', 'INV-043551', '20905', 600, 18.9), websiteLine('w2', 'INV-043556', '20908', 370.7, 11.25)]
  const lines: StripePayoutLine[] = mapped
    ? [...web, {
        ...unresolvedLine(),
        source: 'DIRECT_STRIPE_PAYMENT',
        direct: mapped,
        invoice: { invoiceId: INV_043544.invoiceId, invoiceNumber: 'INV-043544', total: 1261, balance: 1261, status: 'sent', customerId: 'WEB', referenceNumber: '20901' },
        state: 'OPEN',
        matchStatus: 'DIRECT_PAYMENT_MAPPED',
        reason: 'Direct Stripe payment mapped to INV-043544.',
      }]
    : web
  const net = mapped ? 2151.37 : 940.55
  const fee = mapped ? 80.33 : 30.15
  const gross = mapped ? 2231.7 : 970.7
  const allocations = (kind: 'NET' | 'FEE') => lines.map((l): [string, string, number] => [l.invoice?.invoiceNumber || '', l.website?.orderNumber || '', kind === 'NET' ? l.netAllocation : l.feeAllocation])
  const netPayment = payment('NET', net, allocations('NET'))
  const feePayment = payment('FEE', fee, allocations('FEE'))
  if (mapped) {
    netPayment.allocations[2] = { ...netPayment.allocations[2], orderNumber: null, source: 'DIRECT_STRIPE_PAYMENT' }
    feePayment.allocations[2] = { ...feePayment.allocations[2], orderNumber: null, source: 'DIRECT_STRIPE_PAYMENT' }
  }
  const group: StripePayoutGroup = {
    groupKey: `${DIRECT_PAYOUT}|WEB`,
    customerId: 'WEB',
    customerName: 'Website',
    status: 'READY',
    reasons: [],
    postable: true,
    advanceReviewRequired: false,
    invoiceCount: lines.length,
    chargeCount: lines.length,
    totals: { invoiceGross: gross, netTo1019: net, customerAdvance: 0, total1019: net, feeTo1013: fee, stripeGross: gross },
    checks: { total1019PlusFeeEqualsGross: true, netPlusFeeEqualsInvoices: true, everyLineBalances: true },
    components: [netPayment, feePayment],
    postingFingerprint: mapped ? 'fp-mapped' : 'fp-before',
    lines,
  }
  return {
    preview: true,
    postingEnabled: false,
    payout: { payoutId: DIRECT_PAYOUT, status: 'paid', amount: 2151.37, currency: 'AED', arrivalDate: '2026-09-04T00:00:00.000Z', createdAt: null },
    status: mapped ? 'READY' : 'NEEDS_REVIEW',
    blockers: mapped ? [] : ['1 charge has no customer group. Map a direct Stripe payment with "Assign to Zoho Invoice".'],
    proposedPaymentDate: '2026-09-04',
    accounts: { net: null, fee: null, advance: null, problems: [] },
    composition: { chargeCount: 3, chargeGross: 2231.7, chargeFee: 80.33, chargeNet: 2151.37, otherCount: 0, otherNet: 0, contentNet: 2151.37, payoutAmount: 2151.37, reconciles: true },
    reconciliation: { netTo1019: net, customerAdvances: 0, total1019: net, advanceRefundsOutOf1019: 0, fees: fee, payoutAmount: 2151.37, stripeGross: gross, total1019PlusFees: gross, payoutMatches: Boolean(mapped), grossMatches: Boolean(mapped) },
    customersPresent: ['Website'],
    groups: [group],
    unassigned: mapped ? [] : [unresolvedLine()],
    directMappings: mapped ? [mapped] : [],
    advanceCaseEvents: [],
    advanceRefunds: [],
    otherTransactions: [],
    warnings: [],
  }
}

function searchRow(patch: Partial<StripeDirectInvoice> = {}): StripeDirectInvoice {
  return { ...INV_043544, selectable: true, notSelectableReasons: [], ...patch }
}

function validation(patch: Partial<StripeDirectValidation> = {}): StripeDirectValidation {
  return {
    payoutId: DIRECT_PAYOUT,
    paymentIntentId: DIRECT_PI,
    chargeId: DIRECT_CH,
    stripe: { gross: 1261, fee: 50.18, net: 1210.82, currency: 'AED', createdAt: '2026-09-02T09:15:00.000Z', description: null },
    stripeEvidence: unresolvedLine().stripeEvidence ?? null,
    references: unresolvedLine().references ?? [],
    invoice: INV_043544,
    websiteOrdersWithReference: [],
    checks: [
      { key: 'currency', label: 'Currency matches', ok: true, blocking: false, detail: 'AED = AED' },
      { key: 'amount', label: 'Stripe gross equals invoice total', ok: true, blocking: false, detail: '1261.00 = 1261.00' },
      { key: 'no_intent_mapping', label: 'PaymentIntent not mapped elsewhere', ok: true, blocking: false, detail: '' },
    ],
    blocking: false,
    evidenceStatus: 'MATCH',
    evidenceSummary: 'Payment Link product "Matjar meem #20901" ↔ INV-043544 P.O.# 20901',
    requiresTypedInvoiceNumber: false,
    zohoWrites: 0,
    ...patch,
  }
}

async function openDirectPreview(first: StripePayoutPreview) {
  api.getStripePayouts.mockResolvedValue(cachedList([{ payoutId: DIRECT_PAYOUT, status: 'paid', amount: 2151.37, currency: 'AED', arrivalDate: '2026-09-04T00:00:00.000Z', createdAt: null, composition: first.composition } as StripePayoutSummary]))
  api.getStripePayoutPreview.mockResolvedValue(first)
  render(<StripePayoutPreviewPanel />)
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))
  await screen.findAllByText('Website')
}

async function chooseInvoice(v: StripeDirectValidation) {
  api.searchStripeDirectInvoices.mockResolvedValue({ mode: 'invoice', query: 'INV-043544', invoices: [searchRow()], zohoWrites: 0 })
  api.validateStripeDirectPayment.mockResolvedValue(v)
  fireEvent.click(screen.getByRole('button', { name: 'Assign to Zoho Invoice' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Search Zoho' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Select INV-043544' }))
  await screen.findByLabelText('Mapping checks')
}

const confirmButton = () => screen.getByRole('button', { name: 'Confirm Mapping' }) as HTMLButtonElement

describe('StripePayoutPreviewPanel direct Stripe payments', () => {
  it('shows an unresolved-charge card with the Stripe evidence and a suggestion that is never auto-mapped', async () => {
    await openDirectPreview(directPreview(null))
    const card = screen.getByTestId('unresolved-charge')
    expect(card.textContent).toContain(DIRECT_PI)
    expect(card.textContent).toContain(DIRECT_CH)
    expect(card.textContent).toContain('AED 1,261.00')
    expect(card.textContent).toContain('AED 50.18')
    expect(card.textContent).toContain('AED 1,210.82')
    expect(card.textContent).toContain('Matjar meem #20901 · invoice #20901')
    expect(card.textContent).toContain('Suggested match: INV-043544')
    expect(screen.queryByText('Charges without a customer')).toBeNull()
    expect(screen.queryByTestId('direct-payment')).toBeNull()
    expect(api.validateStripeDirectPayment).not.toHaveBeenCalled()
    expect(api.confirmStripeDirectPayment).not.toHaveBeenCalled()
    expectNoPostingCalls()
  })

  it('assigns INV-043544 after search, validation, reason and acknowledgement, then shows DIRECT STRIPE PAYMENT', async () => {
    await openDirectPreview(directPreview(null))
    await chooseInvoice(validation())
    expect(api.searchStripeDirectInvoices).toHaveBeenCalledWith('INV-043544', 'auto', 'all')
    expect(api.validateStripeDirectPayment).toHaveBeenCalledWith(DIRECT_PAYOUT, DIRECT_PI, 'ZID-INV-043544')
    const checks = screen.getByLabelText('Mapping checks')
    expect(checks.textContent).toContain('2026-09-02')
    expect(checks.textContent).toContain('20901')
    expect(checks.textContent).toContain('AED 1,261.00')
    expect(checks.textContent).toContain('corresponds to Zoho INV-043544 P.O.# 20901')
    expect(screen.queryByLabelText('Re-type invoice number')).toBeNull()

    expect(confirmButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Payment Link Matjar meem #20901 paid INV-043544' } })
    expect(confirmButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'I verified this Stripe payment belongs to the selected Zoho invoice.' }))
    expect(confirmButton().disabled).toBe(false)

    api.confirmStripeDirectPayment.mockResolvedValue({ mapping: { id: 1, zohoInvoiceNumber: 'INV-043544', status: 'ACTIVE' }, zohoWrites: 0, stripeWrites: 0 })
    api.getStripePayoutPreview.mockResolvedValue(directPreview(mapping({ removable: false, lockedReason: null })))
    fireEvent.click(confirmButton())

    const mapped = await screen.findByTestId('direct-payment')
    expect(api.confirmStripeDirectPayment).toHaveBeenCalledWith(DIRECT_PAYOUT, DIRECT_PI, { invoiceId: 'ZID-INV-043544', reason: 'Payment Link Matjar meem #20901 paid INV-043544' })
    expect(api.getStripePayoutPreview).toHaveBeenCalledTimes(2)
    expect(mapped.textContent).toContain('DIRECT STRIPE PAYMENT')
    expect(mapped.textContent).toContain('MANUALLY VERIFIED')
    expect(mapped.textContent).toContain('INV-043544 · Website · PO 20901 · AED 1,261.00')
    expect(screen.queryByTestId('unresolved-charge')).toBeNull()
    expect(screen.getAllByText('DIRECT STRIPE PAYMENT').length).toBeGreaterThan(1)
    const totals = screen.getAllByText(/^AED /, { selector: '.stripe-payout__totals dd' }).map((el) => el.textContent)
    expect(totals).toEqual(expect.arrayContaining(['AED 2,231.70', 'AED 2,151.37', 'AED 80.33']))
    expectNoPostingCalls()
  })

  it('without a Stripe reference the admin must re-type the invoice number', async () => {
    await openDirectPreview(directPreview(null))
    await chooseInvoice(validation({ evidenceStatus: 'NONE', requiresTypedInvoiceNumber: true, references: [], evidenceSummary: 'No Stripe reference; invoice number re-typed by the admin.' }))
    expect(screen.getByText(/An amount match alone is not enough/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Customer confirmed by phone it paid INV-043544' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'I verified this Stripe payment belongs to the selected Zoho invoice.' }))
    expect(confirmButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Re-type invoice number'), { target: { value: 'inv-043545' } })
    expect(confirmButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Re-type invoice number'), { target: { value: 'inv-043544' } })
    expect(confirmButton().disabled).toBe(false)
    api.confirmStripeDirectPayment.mockResolvedValue({ mapping: { id: 1, zohoInvoiceNumber: 'INV-043544', status: 'ACTIVE' }, zohoWrites: 0, stripeWrites: 0 })
    fireEvent.click(confirmButton())
    await waitFor(() => expect(api.confirmStripeDirectPayment).toHaveBeenCalledWith(DIRECT_PAYOUT, DIRECT_PI, {
      invoiceId: 'ZID-INV-043544',
      reason: 'Customer confirmed by phone it paid INV-043544',
      confirmInvoiceNumber: 'inv-043544',
    }))
  })

  it('Checkout Session permission denied is a small warning; INV-043544 stays selectable and Confirm enables after manual verification', async () => {
    const noCheckout = unresolvedLine({
      stripeEvidence: { ...unresolvedLine().stripeEvidence!, checkoutEvidence: 'UNAVAILABLE_PERMISSION', sessions: [] },
      references: [],
      suggestion: { status: 'NONE', reason: 'Stripe carries no invoice or P.O. reference.', candidates: [] },
    })
    const p = directPreview(null)
    p.unassigned = [noCheckout]
    await openDirectPreview(p)
    const warning = 'Payment Link evidence unavailable because the Stripe key cannot read Checkout Sessions. Manual verification is required.'
    const card = screen.getByTestId('unresolved-charge')
    expect(card.textContent).toContain(warning)
    expect(card.textContent).not.toMatch(/rk_live|dashboard\.stripe\.com|StripePermissionError/)
    expect((screen.getByRole('button', { name: 'Assign to Zoho Invoice' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Assign to Zoho Invoice' }))
    expect((screen.getByLabelText('Invoice number, P.O.# or amount') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('Invoice number, P.O.# or amount'), { target: { value: 'INV-043544' } })
    api.searchStripeDirectInvoices.mockResolvedValue({ mode: 'invoice', query: 'INV-043544', invoices: [searchRow()], zohoWrites: 0 })
    api.validateStripeDirectPayment.mockResolvedValue(validation({
      checkoutEvidence: 'UNAVAILABLE_PERMISSION',
      stripeEvidence: noCheckout.stripeEvidence ?? null,
      references: [],
      evidenceStatus: 'NONE',
      requiresTypedInvoiceNumber: true,
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Search Zoho' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Select INV-043544' }))
    const checks = await screen.findByLabelText('Mapping checks')
    expect(checks.textContent).toContain(warning)
    const dialog = checks.closest('.stripe-clearing__confirm') as HTMLElement
    expect(dialog.querySelector('[role="alert"], .stripe-page__banner--error')).toBeNull()
    expect(dialog.textContent).not.toMatch(/rk_live|dashboard\.stripe\.com|StripePermissionError/)
    expect(screen.getByText('Manual verification required')).toBeTruthy()

    expect(confirmButton().disabled).toBe(true)
    const retype = screen.getByLabelText('Re-type invoice number') as HTMLInputElement
    expect(retype.value).toBe('')
    expect(retype.placeholder).toBe('')
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Payment Link #20901 for INV-043544, verified in Stripe' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'I verified this Stripe payment belongs to the selected Zoho invoice.' }))
    expect(confirmButton().disabled).toBe(true)
    expect(screen.getByTestId('confirm-missing').textContent).toBe('To enable Confirm Mapping: type INV-043544 in "Re-type invoice number".')
    fireEvent.change(retype, { target: { value: 'INV-043544' } })
    expect(confirmButton().disabled).toBe(false)
    expect(screen.queryByTestId('confirm-missing')).toBeNull()
    fireEvent.change(screen.getByLabelText('Re-type invoice number'), { target: { value: 'INV-04354' } })
    expect(confirmButton().disabled).toBe(true)
    expect(api.confirmStripeDirectPayment).not.toHaveBeenCalled()
    expectNoPostingCalls()
  })

  it('a blocking check leaves nothing to confirm', async () => {
    await openDirectPreview(directPreview(null))
    await chooseInvoice(validation({
      blocking: true,
      checks: [{ key: 'no_intent_mapping', label: 'PaymentIntent not mapped elsewhere', ok: false, blocking: true, detail: 'Already mapped to INV-043000.' }],
    }))
    expect(screen.getByText(/Already mapped to INV-043000/)).toBeTruthy()
    expect(screen.queryByLabelText('Reason')).toBeNull()
    expect(confirmButton().disabled).toBe(true)
    expect(api.confirmStripeDirectPayment).not.toHaveBeenCalled()
  })

  it('shows why an invoice cannot be selected', async () => {
    await openDirectPreview(directPreview(null))
    api.searchStripeDirectInvoices.mockResolvedValue({
      mode: 'reference',
      query: '20901',
      invoices: [searchRow({ customerName: 'Other Co', customerKey: null, selectable: false, notSelectableReasons: ['Customer is not a Stripe-clearing customer.'] })],
      zohoWrites: 0,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Assign to Zoho Invoice' }))
    fireEvent.change(screen.getByLabelText('Invoice number, P.O.# or amount'), { target: { value: '20901' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search Zoho' }))
    expect(await screen.findByText('Customer is not a Stripe-clearing customer.')).toBeTruthy()
    expect(api.searchStripeDirectInvoices).toHaveBeenCalledWith('20901', 'auto', 'all')
    expect(screen.queryByRole('button', { name: 'Select INV-043544' })).toBeNull()
    expect(api.validateStripeDirectPayment).not.toHaveBeenCalled()
  })

  it('several fitting invoices show NEEDS REVIEW with the candidates and no suggestion', async () => {
    const p = directPreview(null)
    p.unassigned = [unresolvedLine({
      suggestion: {
        status: 'NEEDS_REVIEW',
        reason: '2 open invoices fit the Stripe reference and amount; choose by hand.',
        candidates: [{ ...INV_043544, fits: true }, { ...INV_043544, invoiceId: 'Z2', invoiceNumber: 'INV-043990', customerName: 'Burjman Shop - Web & App', fits: true }],
      },
    })]
    await openDirectPreview(p)
    const card = screen.getByTestId('unresolved-charge')
    expect(card.textContent).toContain('NEEDS REVIEW')
    expect(card.textContent).toContain('INV-043544')
    expect(card.textContent).toContain('INV-043990')
    expect(card.textContent).not.toContain('Suggested match')
  })

  it('a mapping with accounting shows why it is locked and offers no release', async () => {
    await openDirectPreview(directPreview(mapping({ removable: false, lockedReason: 'Accounting exists for this payout customer (NET VERIFIED); the mapping can only change through a separate correction.' })))
    const mapped = screen.getByTestId('direct-payment')
    expect(mapped.textContent).toContain('Payment Link Matjar meem #20901 paid INV-043544')
    expect(mapped.textContent).toContain('user:7')
    expect(mapped.textContent).toContain('separate correction')
    expect(screen.queryByRole('button', { name: /Release mapping/ })).toBeNull()
  })

  it('a mapping without accounting can be released with a reason, then the preview reloads', async () => {
    await openDirectPreview(directPreview(mapping()))
    fireEvent.click(screen.getByRole('button', { name: 'Release mapping…' }))
    const release = screen.getByRole('button', { name: 'Release Mapping' }) as HTMLButtonElement
    expect(release.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Why release this mapping?'), { target: { value: 'Mapped to the wrong invoice' } })
    api.releaseStripeDirectPayment.mockResolvedValue({ mapping: { id: 1, zohoInvoiceNumber: 'INV-043544', status: 'RELEASED' }, zohoWrites: 0, stripeWrites: 0 })
    api.getStripePayoutPreview.mockResolvedValue(directPreview(null))
    fireEvent.click(release)
    await screen.findByTestId('unresolved-charge')
    expect(api.releaseStripeDirectPayment).toHaveBeenCalledWith(DIRECT_PAYOUT, DIRECT_PI, 'Mapped to the wrong invoice')
    expect(api.postStripePayoutGroup).not.toHaveBeenCalled()
  })
})
