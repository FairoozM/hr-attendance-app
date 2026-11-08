import { describe, expect, it } from 'vitest'
import {
  computePoReadiness,
  computeWorkflow,
  getDefaultPurchasePlanningView,
  getLatestOpenPlan,
  isLeftoverPlan,
  isPlanSendStale,
  PO_SEND_STALE_MS,
} from './purchasePlanningUtils'
import type { LowStockItem, PlanItem, PurchasePlan, VigilUpload } from './purchasePlanningTypes'

const vigil: VigilUpload[] = [{ id: 1, rowsCount: 674, fileName: 'vigil.xlsx', uploadedAt: '2026-09-15T14:00:00.000Z' }]

function line(overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    id: 1,
    sku: 'A',
    itemName: 'Item A',
    included: true,
    finalQty: 12,
    zohoItemId: 'z1',
    purchasePrice: 10,
    zohoItemActive: true,
    currentZohoStock: 0,
    wholesaleAvailableQty: 20,
    matchType: 'exact',
    totalSalesLast3Months: 12,
    totalBundleUsageLast3Months: 0,
    totalUsageLast3Months: 12,
    suggestedQty: 12,
    notes: '',
    ...overrides,
  }
}

function plan(overrides: Partial<PurchasePlan> & Pick<PurchasePlan, 'id' | 'status'>): PurchasePlan {
  return {
    planNumber: `PP-${overrides.id}`,
    createdAt: '2026-10-01T00:00:00.000Z',
    zohoPurchaseOrderId: null,
    purchaseOrderNumber: null,
    zohoError: null,
    ...overrides,
  }
}

function pendingSku(sku: string, zohoItemId: string): LowStockItem {
  return {
    id: sku.charCodeAt(0),
    sku,
    itemName: sku,
    zohoItemId,
    zohoItemActive: zohoItemId ? true : null,
    currentZohoStock: 0,
    totalSalesLast3Months: 0,
    totalBundleUsageLast3Months: 0,
    status: 'pending',
  }
}

describe('computeWorkflow', () => {
  it('keeps finished steps complete after the batch is consumed into a draft', () => {
    const draft = plan({ id: 9, status: 'draft', planNumber: 'PP-1', items: [line()] })
    const result = computeWorkflow({
      uploads: vigil,
      lowStock: [],
      enrichmentRunning: false,
      activePlan: draft,
      activePlanWithPrices: draft,
      plans: [plan({ id: 9, status: 'draft' })],
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
        pendingSku('A', 'z1'),
        pendingSku('B', ''),
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
      lowStock: [pendingSku('A', '')],
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
      plans: [plan({ id: 3, status: 'failed', planNumber: 'PP-FAILED' })],
    })

    expect(view).toMatchObject({
      activeStep: 5,
      mode: 'draft_review',
      selectedPlanId: 3,
    })
  })

  it('ignores a draft left over from before the latest sent PO and starts clean', () => {
    const plans = [
      plan({ id: 12, status: 'sent_to_zoho', purchaseOrderNumber: '2026300', createdAt: '2026-10-26T05:46:42.000Z' }),
      plan({ id: 9, status: 'draft', createdAt: '2026-10-23T14:06:44.000Z' }),
    ]
    const view = getDefaultPurchasePlanningView({ uploads: vigil, lowStock: [], plans })

    expect(view).toMatchObject({ activeStep: 2, mode: 'workflow', selectedPlanId: null, showLatestSentPanel: true })
    expect(getLatestOpenPlan(plans)).toBeNull()
    expect(isLeftoverPlan(plans[1], plans)).toBe(true)

    const result = computeWorkflow({ uploads: vigil, lowStock: [], plans, currentStep: view.activeStep })
    expect(result.hasOpenPlan).toBe(false)
    expect(result.stepStatuses[2]).toBe('in_progress')
    expect(result.stepStatuses[5]).toBe('blocked')
  })

  it('still restores a draft created after the latest sent PO', () => {
    const plans = [
      plan({ id: 13, status: 'draft', createdAt: '2026-10-28T09:00:00.000Z' }),
      plan({ id: 12, status: 'sent_to_zoho', createdAt: '2026-10-26T05:46:42.000Z' }),
    ]
    const view = getDefaultPurchasePlanningView({ uploads: vigil, lowStock: [], plans })
    expect(view).toMatchObject({ activeStep: 5, selectedPlanId: 13 })
  })

  it('keeps an older in-flight send current so it can be finished', () => {
    const plans = [
      plan({ id: 12, status: 'sent_to_zoho', createdAt: '2026-10-26T05:46:42.000Z' }),
      plan({ id: 9, status: 'sending', createdAt: '2026-10-23T14:06:44.000Z' }),
    ]
    expect(getDefaultPurchasePlanningView({ uploads: vigil, lowStock: [], plans })).toMatchObject({
      activeStep: 6,
      selectedPlanId: 9,
    })
  })

  it('stays on enrichment while a new batch is still running', () => {
    const view = getDefaultPurchasePlanningView({
      uploads: vigil,
      lowStock: [pendingSku('A', 'z1')],
      enrichmentRunning: true,
      plans: [plan({ id: 8, status: 'draft' })],
    })

    expect(view.activeStep).toBe(3)
    expect(view.selectedPlanId).toBe(8)
  })
})

describe('computePoReadiness', () => {
  it('waits for prices instead of calling every line missing', () => {
    const result = computePoReadiness(
      plan({ id: 1, status: 'draft', items: [line({ purchasePrice: null })] }),
      { pricesReady: false }
    )
    expect(result.ready).toBe(false)
    expect(result.reasons).toEqual(['Purchase prices are still loading.'])
  })

  it('allows a failed plan to be sent again when the lines are valid', () => {
    const result = computePoReadiness(plan({ id: 1, status: 'failed', items: [line()] }))
    expect(result.ready).toBe(true)
  })

  it('blocks a normal send while the plan is already sending', () => {
    const result = computePoReadiness(plan({ id: 1, status: 'sending', items: [line()] }))
    expect(result.ready).toBe(false)
    expect(result.reasons).toEqual(['This plan is being sent to Zoho.'])
  })
})

describe('sending plans', () => {
  const sendingPlan = (startedAgoMs: number) =>
    plan({
      id: 4,
      status: 'sending',
      purchaseOrderNumber: 'PO-4',
      sendStartedAt: new Date(Date.now() - startedAgoMs).toISOString(),
      items: [line()],
    })

  it('shows the PO step as in progress and opens it by default', () => {
    const sending = sendingPlan(1000)
    const result = computeWorkflow({
      uploads: vigil,
      lowStock: [],
      activePlan: sending,
      activePlanWithPrices: sending,
      plans: [sending],
      currentStep: 6,
    })
    expect(result.stepStatuses[6]).toBe('in_progress')
    expect(result.blockers[6]).toMatch(/Sending/)
    expect(result.suggestedStep).toBe(6)

    const view = getDefaultPurchasePlanningView({ uploads: vigil, lowStock: [], plans: [sending] })
    expect(view.activeStep).toBe(6)
    expect(view.selectedPlanId).toBe(4)
  })

  it('treats an old send as interrupted', () => {
    expect(isPlanSendStale(sendingPlan(1000))).toBe(false)
    expect(isPlanSendStale(sendingPlan(PO_SEND_STALE_MS + 1000))).toBe(true)
    expect(isPlanSendStale({ status: 'failed' })).toBe(false)
  })
})
