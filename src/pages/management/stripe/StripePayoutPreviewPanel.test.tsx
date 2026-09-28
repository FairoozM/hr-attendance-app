import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  StripeFeeJournalStatus,
  StripePayoutComponent,
  StripePayoutFeeJournal,
  StripePayoutGroup,
  StripePayoutLine,
  StripePayoutPreview,
} from '../../../api/stripe'
import { aed, confirmableAdvanceLines, feeJournalLabel, feeJournalTone, groupTone, payoutTone, postingSteps, recoveryLabel } from './stripePayoutFormat'

const api = vi.hoisted(() => ({
  getStripePayouts: vi.fn(),
  getStripePayoutPreview: vi.fn(),
  confirmStripeCustomerAdvance: vi.fn(),
  postStripePayoutGroup: vi.fn(),
  postStripePayoutFeeJournal: vi.fn(),
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
  fireEvent.click(screen.getByRole('button', { name: 'Load recent payouts' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Load recent payouts' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Load recent payouts' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Load recent payouts' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))

    expect(await screen.findByText(/Original advance journal .*MISSING/)).toBeTruthy()
    expect(screen.getByText(/Refund journal cannot be posted yet: The original Customer Advance journal is not verified/)).toBeTruthy()
  })
})
