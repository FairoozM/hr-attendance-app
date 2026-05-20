/**
 * Unit tests for backend/src/controllers/purchasePlanningController.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire, makeReqRes, captureConsole } = require('./_helpers')

function makeServiceMock(overrides = {}) {
  const calls = []
  const stub = {
    listLowStock: async () => [],
    previewLowStockUpload: async () => ({
      rows: [{ valid: true, sku: 'SKU1' }],
      summary: { invalidRows: 0, validRows: 1 },
    }),
    saveLowStockUpload: async () => ({
      uploaded: 2,
      matched: 1,
      unmatched: 1,
      items: [{ id: 1, sku: 'A', status: 'pending' }],
    }),
    previewVigilUpload: async () => ({
      rows: [{ valid: true }],
      summary: { invalidRows: 0 },
    }),
    saveVigilUpload: async (payload) => {
      calls.push(['saveVigilUpload', payload])
      return { id: 1, fileName: payload.fileName }
    },
    generatePlan: async (payload) => {
      calls.push(['generatePlan', payload])
      return { id: 10, planNumber: 'PP-1' }
    },
    getPlan: async (id) => {
      calls.push(['getPlan', id])
      if (id === 99) return null
      return { id, planNumber: 'PP-1', items: [] }
    },
    updatePlanItem: async (planId, itemId, patch) => {
      calls.push(['updatePlanItem', planId, itemId, patch])
      if (itemId === 99) return null
      return { id: itemId, planId, ...patch }
    },
    createZohoPurchaseOrder: async (planId, options) => {
      calls.push(['createZohoPurchaseOrder', planId, options])
      return { success: true }
    },
    deleteDraftPlan: async (id) => {
      calls.push(['deleteDraftPlan', id])
      if (id === 99) {
        const err = new Error('Purchase plan not found')
        err.code = 'PLAN_NOT_FOUND'
        throw err
      }
      if (id === 88) {
        const err = new Error('Only draft plans can be deleted')
        err.code = 'PLAN_NOT_DRAFT'
        throw err
      }
      return { deleted: true, id }
    },
    ...overrides,
    _calls: calls,
  }
  return stub
}

function loadController(serviceStub) {
  mockModule('../src/services/purchasePlanningService', serviceStub)
  return freshRequire('../src/controllers/purchasePlanningController')
}

const ADMIN = { userId: 42, role: 'admin' }

test('controller: getPlan returns 400 for invalid plan id', async () => {
  const ctrl = loadController(makeServiceMock())
  const { req, res } = makeReqRes({ params: { id: 'abc' }, user: ADMIN })
  await ctrl.getPlan(req, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.code, 'INVALID_PLAN_ID')
})

test('controller: getPlan returns 404 when service has no plan', async () => {
  const ctrl = loadController(makeServiceMock())
  const { req, res } = makeReqRes({ params: { id: '99' }, user: ADMIN })
  await ctrl.getPlan(req, res)
  assert.equal(res.statusCode, 404)
  assert.equal(res.body.code, 'PLAN_NOT_FOUND')
})

test('controller: generatePlan returns 401 when auth user id is missing', async () => {
  const stub = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: { role: 'admin' } })
  await ctrl.generatePlan(req, res)
  assert.equal(res.statusCode, 401)
  assert.equal(res.body.code, 'AUTH_REQUIRED')
  assert.equal(stub._calls.length, 0)
})

test('controller: uploadVigilCsv save requires auth user id', async () => {
  const stub = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({
    body: { save: 'true' },
    user: { role: 'admin', userId: 'not-a-number' },
  })
  req.file = { buffer: Buffer.from('sku\nA'), originalname: 'v.csv' }
  await ctrl.uploadVigilCsv(req, res)
  assert.equal(res.statusCode, 401)
  assert.equal(res.body.code, 'AUTH_REQUIRED')
  assert.equal(stub._calls.length, 0)
})

test('controller: updatePlanItem rejects unknown body fields', async () => {
  const stub = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({
    params: { id: '1', itemId: '2' },
    body: { finalQty: 3, hacker: true },
    user: ADMIN,
  })
  await ctrl.updatePlanItem(req, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.code, 'INVALID_PLAN_ITEM_BODY')
  assert.equal(stub._calls.length, 0)
})

test('controller: updatePlanItem whitelists patch passed to service', async () => {
  const stub = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({
    params: { id: '1', itemId: '2' },
    body: { finalQty: 5, included: false, notes: 'hold' },
    user: ADMIN,
  })
  await ctrl.updatePlanItem(req, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(stub._calls[0], ['updatePlanItem', 1, 2, { finalQty: 5, included: false, notes: 'hold' }])
})

test('controller: updatePlanItem returns 404 when item missing', async () => {
  const ctrl = loadController(makeServiceMock())
  const { req, res } = makeReqRes({
    params: { id: '1', itemId: '99' },
    body: { finalQty: 1 },
    user: ADMIN,
  })
  await ctrl.updatePlanItem(req, res)
  assert.equal(res.statusCode, 404)
  assert.equal(res.body.code, 'PLAN_ITEM_NOT_FOUND')
})

test('controller: createZohoPo validates purchase order number and prices', async () => {
  const stub = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({
    params: { id: '1' },
    body: { purchaseOrderNumber: '  ', purchasePrices: [] },
    user: ADMIN,
  })
  await ctrl.createZohoPo(req, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.code, 'INVALID_ZOHO_PO_PAYLOAD')
  assert.ok(Array.isArray(res.body.details))
  assert.equal(stub._calls.length, 0)
})

test('controller: createZohoPo passes validated payload to service', async () => {
  const stub = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({
    params: { id: '3' },
    body: {
      purchaseOrderNumber: ' PO-100 ',
      purchasePrices: [{ planItemId: 7, sku: 'X', purchasePrice: 12.5 }],
    },
    user: ADMIN,
  })
  await ctrl.createZohoPo(req, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(stub._calls[0][2], {
    purchaseOrderNumber: 'PO-100',
    purchasePrices: [{ planItemId: 7, sku: 'X', purchasePrice: 12.5 }],
  })
})

test('controller: uploadVigilCsv maps service errors via errorStatus', async () => {
  const stub = makeServiceMock({
    previewVigilUpload: async () => {
      const err = new Error('Upload a Vigil stock file before generating a purchase plan')
      err.code = 'NO_VIGIL_UPLOAD'
      throw err
    },
  })
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN })
  req.file = { buffer: Buffer.from('x'), originalname: 'bad.csv' }
  const logs = await captureConsole(async () => {
    await ctrl.uploadVigilCsv(req, res)
  })
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.code, 'NO_VIGIL_UPLOAD')
  assert.ok(
    logs.error.some((args) =>
      JSON.stringify(args).includes('uploadVigilCsv') || String(args[0]).includes('uploadVigilCsv')
    )
  )
})

test('controller: uploadLowStockSkus awaits previewLowStockUpload', async () => {
  let previewCalled = false
  const stub = makeServiceMock({
    previewLowStockUpload: async () => {
      previewCalled = true
      return {
        rows: [{ valid: true, sku: 'A' }],
        summary: { invalidRows: 0 },
      }
    },
  })
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ user: ADMIN })
  req.file = { buffer: Buffer.from('sku\nA'), originalname: 'low.csv' }
  await ctrl.uploadLowStockSkus(req, res)
  assert.equal(previewCalled, true)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.saved, false)
})

test('controller: deletePlan returns 400 for invalid plan id', async () => {
  const ctrl = loadController(makeServiceMock())
  const { req, res } = makeReqRes({ params: { id: 'abc' }, user: ADMIN })
  await ctrl.deletePlan(req, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.code, 'INVALID_PLAN_ID')
})

test('controller: deletePlan returns 404 when plan missing', async () => {
  const ctrl = loadController(makeServiceMock())
  const { req, res } = makeReqRes({ params: { id: '99' }, user: ADMIN })
  await ctrl.deletePlan(req, res)
  assert.equal(res.statusCode, 404)
  assert.equal(res.body.code, 'PLAN_NOT_FOUND')
})

test('controller: deletePlan returns 400 when plan is not draft', async () => {
  const ctrl = loadController(makeServiceMock())
  const { req, res } = makeReqRes({ params: { id: '88' }, user: ADMIN })
  await ctrl.deletePlan(req, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.code, 'PLAN_NOT_DRAFT')
})

test('controller: deletePlan succeeds for draft plan', async () => {
  const stub = makeServiceMock()
  const ctrl = loadController(stub)
  const { req, res } = makeReqRes({ params: { id: '7' }, user: ADMIN })
  await ctrl.deletePlan(req, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { deleted: true, id: 7 })
  assert.deepEqual(stub._calls[0], ['deleteDraftPlan', 7])
})

test('controller: _internals pickPlanItemPatch and validateCreateZohoPoBody', () => {
  const ctrl = loadController(makeServiceMock())
  const bad = ctrl._internals.pickPlanItemPatch({ extra: 1 })
  assert.ok(bad.error)
  const good = ctrl._internals.pickPlanItemPatch({ finalQty: 2 })
  assert.deepEqual(good.patch, { finalQty: 2 })

  const zohoBad = ctrl._internals.validateCreateZohoPoBody({ purchaseOrderNumber: '', purchasePrices: null })
  assert.equal(zohoBad.ok, false)
  assert.ok(zohoBad.errors.length >= 2)
})
