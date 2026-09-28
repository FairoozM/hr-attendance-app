import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { StripePayoutGroup, StripePayoutLine, StripePayoutPreview } from '../../../api/stripe'
import { aed, confirmableAdvanceLines, groupTone, recoveryLabel } from './stripePayoutFormat'

const api = vi.hoisted(() => ({
  getStripePayouts: vi.fn(),
  getStripePayoutPreview: vi.fn(),
  confirmStripeCustomerAdvance: vi.fn(),
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

function websiteGroup(confirmed: boolean): StripePayoutGroup {
  const account = (code: string, name: string) => ({ accountId: code, accountCode: code, accountName: name })
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
})
