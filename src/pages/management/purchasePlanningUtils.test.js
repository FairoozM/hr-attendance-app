import { describe, expect, it } from 'vitest'
import {
  computePoReadiness,
  computeWorkflow,
  getDefaultPurchasePlanningView,
  isPlanSendStale,
  PO_SEND_STALE_MS,
} from './purchasePlanningUtils'

const vigil = [{ id: 1, rowsCount: 674, fileName: 'vigil.xlsx' }]

function line(overrides = {}) {
  return {
    id: 1,
    sku: 'A',
    included: true,
    finalQty: 12,
    zohoItemId: 'z1',
    purchasePrice: 10,
    zohoItemActive: true,
    wholesaleAvailableQty: 20,
    suggestedQty: 12,
    ...overrides,
  }
}

describe('computeWorkflow', () => {
  it('keeps finished steps complete after the batch is consumed into a draft', () => {
    const plan = { id: 9, status: 'draft', planNumber: 'PP-1', items: [line()] }
    const result = computeWorkflow({
      uploads: vigil,
      lowStock: [],
      enrichmentRunning: false,
      activePlan: plan,
      activePlanWithPrices: plan,
      plans: [{ id: 9, status: 'draft' }],
      currentStep: 5,
    })

    expect(result.stepStatuses).toEqual({
      1: 'completed',
      2: 'completed',
      3: 'completed',
      4: 'completed',
      5: 'in_progress',
      6: 'ready',
    })
    expect(result.blockers[3]).toBeUndefined()
    expect(result.blockers[4]).toBeUndefined()
    expect(result.suggestedStep).toBe(5)
  })

  it('keeps Zoho enrichment in progress after the first SKU matches', () => {
    const result = computeWorkflow({
      uploads: vigil,
      lowStock: [
        { status: 'pending', sku: 'A', zohoItemId: 'z1' },
        { status: 'pending', sku: 'B', zohoItemId: '' },
      ],
      enrichmentRunning: true,
      currentStep: 3,
    })

    expect(result.stepStatuses[3]).toBe('in_progress')
    expect(result.stepStatuses[4]).toBe('blocked')
    expect(result.suggestedStep).toBe(3)
  })

  it('blocks plan generation while unmatched SKUs remain', () => {
    const result = computeWorkflow({
      uploads: vigil,
      lowStock: [{ status: 'pending', sku: 'A', zohoItemId: '' }],
      enrichmentRunning: false,
      enrichmentError: 'Zoho timeout',
      currentStep: 3,
    })

    expect(result.stepStatuses[3]).toBe('error')
    expect(result.stepStatuses[4]).toBe('blocked')
    expect(result.blockers[4]).toMatch(/Zoho match/)
  })

  it('asks for a low-stock upload when Vigil exists and nothing is open', () => {
    const result = computeWorkflow({
      uploads: vigil,
      lowStock: [],
      plans: [],
      currentStep: 2,
    })

    expect(result.stepStatuses[1]).toBe('completed')
    expect(result.stepStatuses[2]).toBe('in_progress')
    expect(result.stepStatuses[3]).toBe('blocked')
    expect(result.stepStatuses[4]).toBe('blocked')
    expect(result.suggestedStep).toBe(2)
  })
})

describe('getDefaultPurchasePlanningView', () => {
  it('reopens a failed send on the review step', () => {
    const view = getDefaultPurchasePlanningView({
      uploads: vigil,
      lowStock: [],
      plans: [{ id: 3, status: 'failed', planNumber: 'PP-FAILED' }],
    })

    expect(view).toMatchObject({
      activeStep: 5,
      mode: 'draft_review',
      selectedPlanId: 3,
    })
  })

  it('stays on enrichment while a new batch is still running', () => {
    const view = getDefaultPurchasePlanningView({
      uploads: vigil,
      lowStock: [{ status: 'pending', sku: 'A', zohoItemId: 'z1' }],
      enrichmentRunning: true,
      plans: [{ id: 8, status: 'draft' }],
    })

    expect(view.activeStep).toBe(3)
    expect(view.selectedPlanId).toBe(8)
  })
})

describe('computePoReadiness', () => {
  it('waits for prices instead of calling every line missing', () => {
    const result = computePoReadiness(
      { status: 'draft', items: [line({ purchasePrice: null })] },
      { pricesReady: false }
    )
    expect(result.ready).toBe(false)
    expect(result.reasons).toEqual(['Purchase prices are still loading.'])
  })

  it('allows a failed plan to be sent again when the lines are valid', () => {
    const result = computePoReadiness({ status: 'failed', items: [line()] })
    expect(result.ready).toBe(true)
  })

  it('blocks a normal send while the plan is already sending', () => {
    const result = computePoReadiness({ status: 'sending', items: [line()] })
    expect(result.ready).toBe(false)
    expect(result.reasons).toEqual(['This plan is being sent to Zoho.'])
  })
})

describe('sending plans', () => {
  const sendingPlan = (startedAgoMs) => ({
    id: 4,
    status: 'sending',
    planNumber: 'PP-4',
    purchaseOrderNumber: 'PO-4',
    sendStartedAt: new Date(Date.now() - startedAgoMs).toISOString(),
    items: [line()],
  })

  it('shows the PO step as in progress and opens it by default', () => {
    const plan = sendingPlan(1000)
    const result = computeWorkflow({
      uploads: vigil,
      lowStock: [],
      activePlan: plan,
      activePlanWithPrices: plan,
      plans: [plan],
      currentStep: 6,
    })
    expect(result.stepStatuses[6]).toBe('in_progress')
    expect(result.blockers[6]).toMatch(/Sending/)
    expect(result.suggestedStep).toBe(6)

    const view = getDefaultPurchasePlanningView({ uploads: vigil, lowStock: [], plans: [plan] })
    expect(view.activeStep).toBe(6)
    expect(view.selectedPlanId).toBe(4)
  })

  it('treats an old send as interrupted', () => {
    expect(isPlanSendStale(sendingPlan(1000))).toBe(false)
    expect(isPlanSendStale(sendingPlan(PO_SEND_STALE_MS + 1000))).toBe(true)
    expect(isPlanSendStale({ status: 'failed' })).toBe(false)
  })
})
