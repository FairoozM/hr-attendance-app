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
    fetchCompositeItemsList: async () => ({ composite_items: [] }),
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
  const { svc, responder, restoreAll } = loadServiceWithDb()
  const { waitForLowStockEnrichment } = svc._internals

  responder.nextResponse = (text) =>
    /status IN \('queued', 'running'\) LIMIT 1/.test(text) ? { rows: [{ '?column?': 1 }] } : null
  await assert.rejects(
    () => waitForLowStockEnrichment(20, 5),
    (err) => err.code === 'ENRICHMENT_RUNNING'
  )
  responder.nextResponse = null
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

test('purchasePlanningService: isZohoItemActive treats inactive and deleted as inactive', () => {
  const { svc, restoreAll } = loadServiceWithDb()
  const { isZohoItemActive } = svc._internals
  assert.equal(isZohoItemActive({ status: 'active' }), true)
  assert.equal(isZohoItemActive({ status: 'inactive' }), false)
  assert.equal(isZohoItemActive({ item_status: 'deleted' }), false)
  assert.equal(isZohoItemActive({}), true)
  restoreAll()
})

test('purchasePlanningService: buildZohoItemIndex prefers active over inactive for same SKU', () => {
  const { svc, restoreAll } = loadServiceWithDb()
  const { buildZohoItemIndex } = svc._internals
  const bySku = buildZohoItemIndex([
    { sku: 'ABC', item_id: 'inactive-1', name: 'Old', status: 'inactive', stock_on_hand: 1 },
    { sku: 'ABC', item_id: 'active-1', name: 'New', status: 'active', stock_on_hand: 9 },
  ])
  const hit = bySku.get('ABC')
  assert.equal(hit.zohoItemId, 'active-1')
  assert.equal(hit.zohoItemActive, true)

  const inactiveOnly = buildZohoItemIndex([
    { sku: 'XYZ', item_id: 'x-inactive', name: 'Gone', status: 'inactive', stock_on_hand: 0 },
  ])
  assert.equal(inactiveOnly.get('XYZ').zohoItemActive, false)
  restoreAll()
})

test('purchasePlanningService: planItemNotes flags inactive Zoho items', () => {
  const { svc, restoreAll } = loadServiceWithDb()
  const { planItemNotes, isSystemGeneratedNote } = svc._internals
  const note = planItemNotes({ matched: true }, 10, false, false)
  assert.equal(note, 'Inactive/deleted in Zoho — cannot raise PO')
  assert.equal(isSystemGeneratedNote(note), true)
  restoreAll()
})

test('purchasePlanningService: createZohoPurchaseOrder rejects inactive Zoho items', async () => {
  const prevWarehouse = process.env.PURCHASE_PLANNING_WAREHOUSE_ID
  process.env.PURCHASE_PLANNING_WAREHOUSE_ID = 'wh-1'

  const ctx = setupDbMock()
  const restoreZoho = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', organizationId: 'org-1' }),
    INVENTORY_V1: '/inventory/v1',
  })
  let poPosted = false
  const restoreZohoApi = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    zohoApiRequest: async () => {
      poPosted = true
      return { purchaseorder: { purchaseorder_id: 'PO-1' } }
    },
    fetchCompositeItemDetail: async () => ({ mapped_items: [] }),
    fetchCompositeItemsList: async () => ({ composite_items: [] }),
  })
  const restoreAdapter = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchItemsRawForWarehouse: async () => [
      { item_id: 'z-active', sku: 'SKU-A', status: 'active' },
      { item_id: 'z-inactive', sku: 'SKU-B', status: 'inactive' },
    ],
  })
  const restoreVendor = mockModule('../src/services/weeklyReportReportVendor', {
    getResolvedReportVendor: () => ({ vendorId: 'vendor-1', source: 'test' }),
  })
  const svc = freshRequire('../src/services/purchasePlanningService')

  ctx.responder.nextTxResponse = (text) => {
    if (/FROM purchase_plans WHERE id = \$1/i.test(text)) {
      return {
        rows: [{
          id: 11,
          plan_number: 'PP-1',
          status: 'draft',
          zoho_purchase_order_id: null,
          purchase_order_number: null,
        }],
      }
    }
    if (/FROM purchase_plan_items/i.test(text)) {
      return {
        rows: [
          {
            id: 1,
            purchase_plan_id: 11,
            sku: 'SKU-A',
            item_name: 'Active item',
            zoho_item_id: 'z-active',
            zoho_item_active: true,
            current_zoho_stock: 1,
            wholesale_available_qty: 5,
            match_type: 'exact',
            total_sales_last_3_months: 1,
            total_bundle_usage_last_3_months: 0,
            total_usage_last_3_months: 1,
            average_monthly_usage: 0.3,
            suggested_qty: 1,
            final_qty: 1,
            purchase_price: 10,
            included: true,
            notes: '',
          },
          {
            id: 2,
            purchase_plan_id: 11,
            sku: 'SKU-B',
            item_name: 'Inactive item',
            zoho_item_id: 'z-inactive',
            zoho_item_active: true,
            current_zoho_stock: 0,
            wholesale_available_qty: 5,
            match_type: 'exact',
            total_sales_last_3_months: 2,
            total_bundle_usage_last_3_months: 0,
            total_usage_last_3_months: 2,
            average_monthly_usage: 0.6,
            suggested_qty: 2,
            final_qty: 2,
            purchase_price: 12,
            included: true,
            notes: '',
          },
        ],
      }
    }
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rows: [] }
    }
    return { rows: [], rowCount: 0 }
  }

  try {
    await assert.rejects(
      () =>
        svc.createZohoPurchaseOrder(11, {
          purchaseOrderNumber: 'PO-TEST-1',
          purchasePrices: [
            { planItemId: 1, sku: 'SKU-A', purchasePrice: 10 },
            { planItemId: 2, sku: 'SKU-B', purchasePrice: 12 },
          ],
        }),
      (err) =>
        err.code === 'ZOHO_ITEMS_INACTIVE' &&
        /SKU-B/.test(err.message) &&
        Array.isArray(err.details?.skus) &&
        err.details.skus.includes('SKU-B')
    )
    assert.equal(poPosted, false)
  } finally {
    if (prevWarehouse == null) delete process.env.PURCHASE_PLANNING_WAREHOUSE_ID
    else process.env.PURCHASE_PLANNING_WAREHOUSE_ID = prevWarehouse
    ctx.restore()
    restoreZoho()
    restoreZohoApi()
    restoreAdapter()
    restoreVendor()
  }
})

test('purchasePlanningService: assertPlanEligibleForPo blocks a fresh send and allows a stale one', () => {
  const { svc, restoreAll } = loadServiceWithDb()
  const { assertPlanEligibleForPo, PO_SEND_STALE_MS } = svc._internals
  const now = Date.now()
  assert.throws(
    () => assertPlanEligibleForPo({ status: 'sending', send_started_at: new Date(now - 1000) }, now),
    (err) => err.code === 'PO_SEND_IN_PROGRESS'
  )
  assert.doesNotThrow(() =>
    assertPlanEligibleForPo({ status: 'sending', send_started_at: new Date(now - PO_SEND_STALE_MS - 1) }, now)
  )
  restoreAll()
})

function planItemRow(overrides) {
  return {
    purchase_plan_id: 11,
    item_name: 'Item',
    zoho_item_active: true,
    current_zoho_stock: 0,
    wholesale_available_qty: 5,
    match_type: 'exact',
    total_sales_last_3_months: 1,
    total_bundle_usage_last_3_months: 0,
    total_usage_last_3_months: 1,
    average_monthly_usage: 0.3,
    suggested_qty: 2,
    final_qty: 2,
    purchase_price: 10,
    included: true,
    notes: '',
    ...overrides,
  }
}

function loadSendHarness({ planRow, zohoPurchaseOrders = {}, postResult, postError }) {
  const prevWarehouse = process.env.PURCHASE_PLANNING_WAREHOUSE_ID
  process.env.PURCHASE_PLANNING_WAREHOUSE_ID = 'wh-1'
  const ctx = setupDbMock()
  const zohoCalls = []
  const restoreZoho = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', organizationId: 'org-1' }),
    INVENTORY_V1: '/inventory/v1',
  })
  const restoreZohoApi = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    zohoApiRequest: async (path, searchParams, method, body, meta) => {
      zohoCalls.push({ path, searchParams, method, body, meta })
      if (method === 'GET') {
        const number = searchParams.get('purchaseorder_number')
        return { purchaseorders: zohoPurchaseOrders[number] || [] }
      }
      if (postError) throw postError
      return postResult || { purchaseorder: { purchaseorder_id: 'Z-NEW', purchaseorder_number: 'PO-NEW' } }
    },
    fetchCompositeItemDetail: async () => ({ mapped_items: [] }),
    fetchCompositeItemsList: async () => ({ composite_items: [] }),
  })
  const restoreAdapter = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchItemsRawForWarehouse: async () => [
      { item_id: 'z-a', sku: 'SKU-A', status: 'active' },
      { item_id: 'z-b', sku: 'SKU-B', status: 'active' },
    ],
  })
  const restoreVendor = mockModule('../src/services/weeklyReportReportVendor', {
    getResolvedReportVendor: () => ({ vendorId: 'vendor-1', source: 'test' }),
  })
  const svc = freshRequire('../src/services/purchasePlanningService')

  ctx.responder.nextTxResponse = (text) => {
    if (/FROM purchase_plans WHERE id = \$1/i.test(text)) return { rows: [planRow] }
    if (/FROM purchase_plan_items/i.test(text)) {
      return {
        rows: [
          planItemRow({ id: 1, sku: 'SKU-B', zoho_item_id: 'z-b' }),
          planItemRow({ id: 2, sku: 'SKU-A', zoho_item_id: 'z-a', final_qty: 3 }),
        ],
      }
    }
    return { rows: [], rowCount: 1 }
  }

  return {
    svc,
    ctx,
    zohoCalls,
    posts: () => zohoCalls.filter((call) => call.method === 'POST'),
    restoreAll() {
      if (prevWarehouse == null) delete process.env.PURCHASE_PLANNING_WAREHOUSE_ID
      else process.env.PURCHASE_PLANNING_WAREHOUSE_ID = prevWarehouse
      ctx.restore()
      restoreZoho()
      restoreZohoApi()
      restoreAdapter()
      restoreVendor()
    },
  }
}

const basePlanRow = {
  id: 11,
  plan_number: 'PP-1',
  status: 'draft',
  zoho_purchase_order_id: null,
  purchase_order_number: null,
  zoho_reference_number: null,
}

test('purchasePlanningService: createZohoPurchaseOrder creates once with a stable reference and no notes', async () => {
  const h = loadSendHarness({ planRow: { ...basePlanRow } })
  try {
    const result = await h.svc.createZohoPurchaseOrder(11, { purchaseOrderNumber: 'PO-NEW' })
    assert.equal(result.reconciled, false)
    assert.equal(result.zohoPurchaseOrderId, 'Z-NEW')
    assert.equal(h.posts().length, 1)
    const post = h.posts()[0]
    assert.equal(post.meta.noTransportRetry, true)
    const payload = JSON.parse(new URLSearchParams(post.body).get('JSONString'))
    assert.equal(payload.notes, undefined)
    assert.deepEqual(payload.line_items.map((line) => line.item_id), ['z-a', 'z-b'])

    const reserve = h.ctx.txCalls.find((call) => /SET status = 'sending'/.test(call.text))
    assert.ok(reserve, 'plan is marked sending before calling Zoho')
    assert.equal(payload.reference_number, reserve.params[2])
    const lookupIndex = h.zohoCalls.findIndex((call) => call.method === 'GET')
    const postIndex = h.zohoCalls.findIndex((call) => call.method === 'POST')
    assert.ok(lookupIndex >= 0 && lookupIndex < postIndex, 'Zoho is checked before creating')
    assert.ok(h.ctx.txCalls.some((call) => /SET status = 'sent_to_zoho'/.test(call.text)))
  } finally {
    h.restoreAll()
  }
})

test('purchasePlanningService: retry links the PO from an earlier attempt instead of creating another', async () => {
  const h = loadSendHarness({
    planRow: { ...basePlanRow, status: 'failed', purchase_order_number: 'PO-OLD', zoho_reference_number: 'REF-1' },
    zohoPurchaseOrders: {
      'PO-OLD': [{ purchaseorder_id: 'Z-OLD', purchaseorder_number: 'PO-OLD', reference_number: 'REF-1' }],
    },
  })
  try {
    const result = await h.svc.createZohoPurchaseOrder(11, { purchaseOrderNumber: 'PO-NEW' })
    assert.equal(result.reconciled, true)
    assert.equal(result.zohoPurchaseOrderId, 'Z-OLD')
    assert.equal(result.purchaseOrderNumber, 'PO-OLD')
    assert.equal(h.posts().length, 0)
    const finalize = h.ctx.txCalls.find((call) => /SET status = 'sent_to_zoho'/.test(call.text))
    assert.deepEqual(finalize.params, [11, 'Z-OLD', 'PO-OLD'])
  } finally {
    h.restoreAll()
  }
})

test('purchasePlanningService: refuses a PO number that already belongs to another Zoho PO', async () => {
  const h = loadSendHarness({
    planRow: { ...basePlanRow },
    zohoPurchaseOrders: {
      'PO-NEW': [{ purchaseorder_id: 'Z-X', purchaseorder_number: 'po-new', reference_number: 'SOMEONE-ELSE' }],
    },
  })
  try {
    await assert.rejects(
      () => h.svc.createZohoPurchaseOrder(11, { purchaseOrderNumber: 'PO-NEW' }),
      (err) => err.code === 'ZOHO_PO_NUMBER_TAKEN'
    )
    assert.equal(h.posts().length, 0)
    assert.ok(h.ctx.calls.some((call) => /SET status = 'failed'/.test(call.text) && /status = 'sending'/.test(call.text)))
  } finally {
    h.restoreAll()
  }
})

test('purchasePlanningService: a Zoho timeout marks the plan failed with a safe-retry hint', async () => {
  const timeout = Object.assign(new Error('Zoho request timed out'), { code: 'ZOHO_API_TIMEOUT' })
  const h = loadSendHarness({ planRow: { ...basePlanRow }, postError: timeout })
  try {
    await assert.rejects(
      () => h.svc.createZohoPurchaseOrder(11, { purchaseOrderNumber: 'PO-NEW' }),
      (err) => err.code === 'ZOHO_API_TIMEOUT'
    )
    const failed = h.ctx.calls.find((call) => /SET status = 'failed'/.test(call.text))
    assert.ok(failed)
    assert.match(failed.params[1], /will not duplicate/)
    assert.ok(!h.ctx.txCalls.some((call) => /SET status = 'sent_to_zoho'/.test(call.text)))
  } finally {
    h.restoreAll()
  }
})

test('purchasePlanningService: a send already in progress is rejected without calling Zoho', async () => {
  const h = loadSendHarness({
    planRow: { ...basePlanRow, status: 'sending', send_started_at: new Date() },
  })
  try {
    await assert.rejects(
      () => h.svc.createZohoPurchaseOrder(11, { purchaseOrderNumber: 'PO-NEW' }),
      (err) => err.code === 'PO_SEND_IN_PROGRESS'
    )
    assert.equal(h.zohoCalls.length, 0)
  } finally {
    h.restoreAll()
  }
})
