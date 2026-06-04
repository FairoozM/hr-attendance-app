/**
 * Unit tests for purchasePlanningService business rules.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire } = require('./_helpers')

function setupDbMock() {
  const calls = []
  const txCalls = []
  const responder = { rows: [], rowCount: 0 }
  const pool = {
    connect: async () => ({
      query: async (text, params) => {
        txCalls.push({ text, params })
        const next = responder.nextTxResponse?.(text, params)
        if (next) return next
        return { rows: responder.rows, rowCount: responder.rowCount }
      },
      release: () => {},
    }),
  }
  const restore = mockModule('../src/db', {
    query: async (text, params) => {
      calls.push({ text, params })
      const next = responder.nextResponse?.(text, params)
      if (next) return next
      return { rows: responder.rows, rowCount: responder.rowCount }
    },
    pool,
    testConnection: async () => {},
  })
  return { calls, txCalls, responder, restore }
}

function loadServiceWithDb(responderOverrides = {}) {
  const ctx = setupDbMock()
  Object.assign(ctx.responder, responderOverrides)
  const restoreZoho = mockModule('../integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok' }),
    INVENTORY_V1: '/inventory/v1',
  })
  const restoreZohoApi = mockModule('../integrations/zoho/zohoInventoryClient', {
    zohoApiRequest: async () => ({ purchaseorder: { purchaseorder_id: 'PO-1' } }),
    fetchCompositeItemDetail: async () => ({ mapped_items: [] }),
  })
  const restoreVendor = mockModule('../services/weeklyReportReportVendor', {
    getResolvedReportVendor: () => ({ vendorId: 'vendor-1', source: 'test' }),
  })
  const svc = freshRequire('../src/services/purchasePlanningService')
  return {
    svc,
    ...ctx,
    restoreAll() {
      ctx.restore()
      restoreZoho()
      restoreZohoApi()
      restoreVendor()
    },
  }
}

test('purchasePlanningService: planUsageFromEnrichedPendingItem uses stored 3M fields', () => {
  const { svc, restoreAll } = loadServiceWithDb()
  try {
    const { planUsageFromEnrichedPendingItem } = svc._internals
    const usage = planUsageFromEnrichedPendingItem({
      totalSalesLast3Months: 12,
      totalBundleUsageLast3Months: 3,
    })
    assert.equal(usage.totalSales, 12)
    assert.equal(usage.totalBundle, 3)
  } finally {
    restoreAll()
  }
})

test('purchasePlanningService: resolveRefreshUserFields preserves manual edits', () => {
  const { svc, restoreAll } = loadServiceWithDb()
  const { resolveRefreshUserFields, isSystemGeneratedNote } = svc._internals

  const preserved = resolveRefreshUserFields(
    { finalQty: 7, suggestedQty: 5, included: false, notes: 'Hold for review', purchasePrice: 12.5 },
    5,
    true,
    'Unavailable in wholesale stock'
  )
  assert.equal(preserved.finalQty, 7)
  assert.equal(preserved.included, false)
  assert.equal(preserved.notes, 'Hold for review')
  assert.equal(preserved.purchasePrice, 12.5)

  const auto = resolveRefreshUserFields(
    { finalQty: 5, suggestedQty: 5, included: true, notes: 'Unavailable in wholesale stock', purchasePrice: null },
    3,
    false,
    'No matching Vigil stock row'
  )
  assert.equal(auto.finalQty, 3)
  assert.equal(auto.included, true)
  assert.equal(auto.notes, 'No matching Vigil stock row')

  assert.equal(isSystemGeneratedNote('No matching Vigil stock row'), true)
  assert.equal(isSystemGeneratedNote('Hold for review'), false)
  restoreAll()
})

test('purchasePlanningService: assertPendingSkusZohoReady throws when unmatched', () => {
  const { svc, restoreAll } = loadServiceWithDb()
  const { assertPendingSkusZohoReady } = svc._internals

  assert.doesNotThrow(() => assertPendingSkusZohoReady([{ sku: 'A', zohoItemId: 'z1' }]))
  assert.throws(
    () => assertPendingSkusZohoReady([{ sku: 'A', zohoItemId: '' }, { sku: 'B', zohoItemId: 'z2' }]),
    (err) => err.code === 'LOW_STOCK_ZOHO_MATCH_INCOMPLETE' && err.details.unmatchedCount === 1
  )
  restoreAll()
})

test('purchasePlanningService: waitForLowStockEnrichment throws ENRICHMENT_RUNNING', async () => {
  const { svc, restoreAll } = loadServiceWithDb()
  const { waitForLowStockEnrichment, lowStockEnrichmentJob } = svc._internals

  lowStockEnrichmentJob.running = true
  await assert.rejects(
    () => waitForLowStockEnrichment(20, 5),
    (err) => err.code === 'ENRICHMENT_RUNNING'
  )
  lowStockEnrichmentJob.running = false
  restoreAll()
})

test('purchasePlanningService: deleteDraftPlan restores planned SKUs', async () => {
  const ctx = loadServiceWithDb()
  ctx.responder.nextTxResponse = (text) => {
    if (/FROM purchase_plans WHERE id = \$1 FOR UPDATE/i.test(text)) {
      return { rows: [{ id: 7, status: 'draft' }] }
    }
    if (/SELECT sku FROM purchase_plan_items/i.test(text)) {
      return { rows: [{ sku: 'SKU-A' }, { sku: 'SKU-B' }] }
    }
    if (/DELETE FROM purchase_plans/i.test(text)) {
      return { rows: [], rowCount: 1 }
    }
    if (/UPDATE purchase_low_stock_items/i.test(text)) {
      return { rows: [], rowCount: 2 }
    }
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rows: [] }
    }
    return { rows: [], rowCount: 0 }
  }

  const result = await ctx.svc.deleteDraftPlan(7)
  assert.deepEqual(result, { deleted: true, id: 7, restoredSkuCount: 2 })
  assert.ok(ctx.txCalls.some((call) => /UPDATE purchase_low_stock_items[\s\S]*status = 'pending'/i.test(call.text)))
  ctx.restoreAll()
})

test('purchasePlanningService: updatePlanItem rejects non-draft plan', async () => {
  const ctx = loadServiceWithDb()
  ctx.responder.nextResponse = () => ({ rows: [{ status: 'sent_to_zoho' }] })

  await assert.rejects(
    () => ctx.svc.updatePlanItem(1, 2, { finalQty: 3 }),
    (err) => err.code === 'PLAN_NOT_EDITABLE'
  )
  ctx.restoreAll()
})

test('purchasePlanningService: assertPlanEligibleForPo rejects sent_to_zoho plan', () => {
  const { svc, restoreAll } = loadServiceWithDb()
  const { assertPlanEligibleForPo } = svc._internals

  assert.throws(
    () => assertPlanEligibleForPo({ status: 'sent_to_zoho', zoho_purchase_order_id: 'PO-99' }),
    (err) => err.code === 'DUPLICATE_PO'
  )
  restoreAll()
})

test('purchasePlanningService: assertPlanEligibleForPo rejects existing zoho_purchase_order_id on draft', () => {
  const { svc, restoreAll } = loadServiceWithDb()
  const { assertPlanEligibleForPo } = svc._internals

  assert.throws(
    () => assertPlanEligibleForPo({ status: 'draft', zoho_purchase_order_id: 'PO-EXISTING' }),
    (err) => err.code === 'DUPLICATE_PO'
  )
  restoreAll()
})
