import { describe, expect, it } from 'vitest'
import { normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'
import {
  TIMELINE_PAGE_SIZE,
  buildInfluencerModuleTimelineEvents,
  deriveEventStatus,
  filterTimelineEvents,
  groupTimelineEvents,
  paginateTimelineEvents,
} from './influencerModuleTimelineUtils'

describe('influencerModuleTimelineUtils', () => {
  const roster = [{
    id: 'inf-1',
    name: 'Arjun Ganesh',
    instagram: { handle: '@arjun' },
    workflowStatus: 'Approved',
    approvalStatus: 'Approved',
    paymentStatus: 'Not Requested',
    timeline: [{ event: 'Approved', date: '2026-04-01', note: 'Ready for campaign' }],
    shootDate: '2026-04-04',
  }]

  const records = [
    normalizePerformanceRecord({
      id: 'd1',
      contractId: 'ip-contract::c1::2026-04-04',
      influencerId: 'inf-1',
      date: '2026-04-04',
      contractStartDate: '2026-04-04',
      monitoringDays: 3,
      cost: 3500,
      salesAed: 9000,
      netProfitAed: 5500,
      views: 12000,
      likes: 800,
      notes: 'Strong launch day',
      storyViews: 1,
      postUrl: 'https://instagram.com/reel/example/',
    }),
    normalizePerformanceRecord({
      id: 'd2',
      contractId: 'ip-contract::c1::2026-04-04',
      influencerId: 'inf-1',
      date: '2026-04-05',
      contractStartDate: '2026-04-04',
      monitoringDays: 3,
      cost: 3500,
      salesAed: 11000,
      netProfitAed: 7500,
      views: 15000,
      likes: 900,
    }),
  ]

  const payments = [{
    contractId: 'ip-contract::c1::2026-04-04',
    influencerId: 'inf-1',
    amountPaid: 0,
    paymentStatus: 'Pending',
    dueDate: '2026-04-15',
    paymentDate: null,
    invoiceReference: '',
    updatedAt: '2026-04-06T10:00:00.000Z',
  }]

  it('builds chronological events without duplicates', () => {
    const events = buildInfluencerModuleTimelineEvents({
      records,
      roster,
      payments,
      today: '2026-04-10',
    })

    const ids = events.map((event) => event.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(events[0].date >= events[events.length - 1].date).toBe(true)
    expect(events.some((event) => event.type === 'check_in')).toBe(true)
    expect(events.some((event) => event.type === 'payment_due')).toBe(true)
    expect(events.some((event) => event.type === 'workflow')).toBe(true)
    expect(events.some((event) => event.type === 'shoot_scheduled')).toBe(true)
  })

  it('derives overdue payment state from due date and outstanding amount', () => {
    const status = deriveEventStatus({
      type: 'payment_due',
      date: '2026-04-15',
      paymentStatus: 'Overdue',
      storedPaymentStatus: 'Pending',
      amountAed: 3500,
      contractCost: 3500,
      amountPaid: 0,
      hasPersistedPayment: true,
      today: '2026-04-20',
    })
    expect(status).toBe('overdue')
  })

  it('filters by influencer, contract, and date range', () => {
    const events = buildInfluencerModuleTimelineEvents({
      records,
      roster,
      payments,
      today: '2026-04-10',
    })

    const filtered = filterTimelineEvents(events, {
      range: { from: '2026-04-04', to: '2026-04-05' },
      influencerId: 'inf-1',
      contractId: 'ip-contract::c1::2026-04-04',
      eventType: 'check_in',
      status: 'all',
      needsAttentionOnly: false,
    })

    expect(filtered.every((event) => event.type === 'check_in')).toBe(true)
    expect(filtered).toHaveLength(2)
  })

  it('groups by date without duplicating events', () => {
    const events = buildInfluencerModuleTimelineEvents({
      records,
      roster,
      payments,
      today: '2026-04-10',
    })
    const grouped = groupTimelineEvents(events, 'date', '2026-04-10')
    const flattened = grouped.flatMap((group) => group.events)
    expect(flattened).toHaveLength(events.length)
  })

  it('paginates with load-more semantics', () => {
    const events = buildInfluencerModuleTimelineEvents({
      records,
      roster,
      payments,
      today: '2026-04-10',
    })
    const page = paginateTimelineEvents(events, 2)
    expect(page.visible).toHaveLength(2)
    expect(page.hasMore).toBe(true)
    expect(page.total).toBe(events.length)
  })

  it('includes completed payment events when payment date exists', () => {
    const events = buildInfluencerModuleTimelineEvents({
      records,
      roster,
      payments: [{
        ...payments[0],
        amountPaid: 3500,
        paymentStatus: 'Paid',
        paymentDate: '2026-04-16',
      }],
      today: '2026-04-20',
    })

    expect(events.some((event) => event.type === 'payment_completed')).toBe(true)
  })

  it('skips events with missing dates', () => {
    const events = buildInfluencerModuleTimelineEvents({
      records: [
        normalizePerformanceRecord({
          id: 'bad',
          contractId: 'ip-contract::bad::2026-04-04',
          influencerId: 'inf-1',
          date: '',
          contractStartDate: '2026-04-04',
        }),
      ],
      roster,
      payments: [],
      today: '2026-04-10',
    })

    expect(events.some((event) => event.id === 'check_in:bad')).toBe(false)
  })
})
