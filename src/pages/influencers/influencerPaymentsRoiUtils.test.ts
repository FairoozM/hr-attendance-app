import { describe, expect, it } from 'vitest'
import {
  buildInfluencerPaymentRows,
  computeEffectivePaymentStatus,
  computeOutstanding,
  filterPaymentRows,
  readPaymentsInfluencerFilter,
  resolveEffectivePaymentStatus,
  summarizePaymentsRoi,
  writePaymentsInfluencerFilter,
} from './influencerPaymentsRoiUtils'
import { normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'

describe('influencerPaymentsRoiUtils', () => {
  it('computes outstanding without negative values', () => {
    expect(computeOutstanding(100, 40)).toBe(60)
    expect(computeOutstanding(100, 120)).toBe(0)
  })

  it('derives overdue from due date without changing stored status', () => {
    expect(computeEffectivePaymentStatus('Pending', '2026-01-01', 50, '2026-05-01')).toBe('Overdue')
    expect(computeEffectivePaymentStatus('Paid', '2026-01-01', 0, '2026-05-01')).toBe('Paid')
  })

  it('builds contract rows once per contract and summarizes totals', () => {
    const records = [
      normalizePerformanceRecord({
        id: 'd1',
        contractId: 'ip-contract::c1::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        monitoringDays: 3,
        cost: 100,
        salesAed: 500,
        netProfitAed: 400,
      }),
      normalizePerformanceRecord({
        id: 'd2',
        contractId: 'ip-contract::c1::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-02',
        contractStartDate: '2026-05-01',
        monitoringDays: 3,
        cost: 50,
        salesAed: 900,
        netProfitAed: 850,
      }),
    ]

    const rows = buildInfluencerPaymentRows({
      records,
      roster: [{ id: 'inf-1', name: 'Creator One', workflowStatus: 'Approved', approvalStatus: 'Approved', paymentStatus: 'Not Requested' }],
      payments: [{
        contractId: 'ip-contract::c1::2026-05-01',
        influencerId: 'inf-1',
        amountPaid: 20,
        paymentStatus: 'Partially Paid',
        dueDate: '2026-05-10',
        paymentDate: null,
        invoiceReference: 'INV-001',
      }],
      range: null,
      today: '2026-05-05',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].contractCost).toBe(50)
    expect(rows[0].amountOutstanding).toBe(30)
    expect(rows[0].effectiveStatus).toBe('Partially Paid')

    const summary = summarizePaymentsRoi(rows)
    expect(summary.totalContractedCost).toBe(50)
    expect(summary.totalPaid).toBe(20)
    expect(summary.outstandingPayments).toBe(30)
    expect(summary.totalSales).toBe(900)
    expect(summary.totalNetProfit).toBe(850)
  })

  it('shows Untracked when no payment row exists and excludes from outstanding summary', () => {
    const records = [
      normalizePerformanceRecord({
        id: 'd1',
        contractId: 'ip-contract::c1::2026-05-01',
        influencerId: 'inf-1',
        date: '2026-05-01',
        contractStartDate: '2026-05-01',
        cost: 500,
        salesAed: 1000,
      }),
    ]
    const rows = buildInfluencerPaymentRows({
      records,
      roster: [{ id: 'inf-1', name: 'Creator', workflowStatus: 'Approved', approvalStatus: 'Approved', paymentStatus: 'Not Requested' }],
      payments: [],
      range: null,
    })
    expect(rows[0].paymentStatus).toBe('Untracked')
    expect(rows[0].effectiveStatus).toBe('Untracked')
    expect(rows[0].storedPaymentStatus).toBeNull()
    expect(rows[0].amountOutstanding).toBe(0)
    expect(summarizePaymentsRoi(rows).outstandingPayments).toBe(0)
    expect(resolveEffectivePaymentStatus(false, 'Not Due', null, 500)).toBe('Untracked')
  })

  it('filters outstanding and loss-making rows', () => {
    const rows = [
      {
        contractId: 'a',
        influencerId: 'inf-1',
        influencerName: 'A',
        influencerHandle: '',
        influencerImage: '',
        contractLabel: 'Campaign A',
        contractStartDate: '2026-05-01',
        contractEndDate: '2026-05-05',
        contractCost: 100,
        amountPaid: 0,
        amountOutstanding: 100,
        paymentStatus: 'Pending' as const,
        effectiveStatus: 'Pending' as const,
        storedPaymentStatus: 'Pending' as const,
        dueDate: null,
        paymentDate: null,
        invoiceReference: '',
        salesAed: 50,
        netProfitAed: -50,
        roi: -50,
        hasPersistedPayment: true,
        notes: '',
      },
      {
        contractId: 'b',
        influencerId: 'inf-2',
        influencerName: 'B',
        influencerHandle: '',
        influencerImage: '',
        contractLabel: 'Campaign B',
        contractStartDate: '2026-05-01',
        contractEndDate: '2026-05-05',
        contractCost: 100,
        amountPaid: 100,
        amountOutstanding: 0,
        paymentStatus: 'Paid' as const,
        effectiveStatus: 'Paid' as const,
        storedPaymentStatus: 'Paid' as const,
        dueDate: null,
        paymentDate: '2026-05-03',
        invoiceReference: '',
        salesAed: 300,
        netProfitAed: 200,
        roi: 200,
        hasPersistedPayment: true,
        notes: '',
      },
    ]

    expect(filterPaymentRows(rows, {
      influencerId: 'All',
      paymentStatus: 'All',
      profitFilter: 'loss_making',
      outstandingOnly: false,
    })).toHaveLength(1)

    expect(filterPaymentRows(rows, {
      influencerId: 'All',
      paymentStatus: 'All',
      profitFilter: 'all',
      outstandingOnly: true,
    })).toHaveLength(1)
  })

  it('syncs Payments influencer filter with URL query params', () => {
    const base = new URLSearchParams('contract=c-1&influencer=inf-1')
    expect(readPaymentsInfluencerFilter(base)).toBe('inf-1')

    const updated = writePaymentsInfluencerFilter(base, 'inf-2')
    expect(updated.get('influencer')).toBe('inf-2')
    expect(updated.get('contract')).toBe('c-1')

    const cleared = writePaymentsInfluencerFilter(updated, 'All')
    expect(cleared.get('influencer')).toBeNull()
    expect(cleared.get('contract')).toBe('c-1')

    expect(readPaymentsInfluencerFilter(new URLSearchParams())).toBe('All')
  })
})
