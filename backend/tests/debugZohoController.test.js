/**
 * Debug Zoho items endpoint — mocked adapter, no Zoho network.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire, makeReqRes } = require('./_helpers')

test('getZohoDebugItems: 503 when Zoho not configured', async () => {
  mockModule('../src/integrations/zoho/zohoAdapter', {
    getItems: async () => [],
    fetchAllItemsRaw: async () => [],
    readZohoConfig: () => ({ code: 'ZOHO_NOT_CONFIGURED' }),
    orgEnvHint: () => 'ZOHO_ORGANIZATION_ID',
  })
  const { getZohoDebugItems } = freshRequire('../src/controllers/debugZohoController')
  const { req, res } = makeReqRes()
  await getZohoDebugItems(req, res)
  assert.equal(res.statusCode, 503)
  assert.equal(res.body.code, 'ZOHO_NOT_CONFIGURED')
})

test('getZohoDebugItems: empty arrays → empty items', async () => {
  mockModule('../src/integrations/zoho/zohoAdapter', {
    getItems: async () => [],
    fetchAllItemsRaw: async () => [],
    readZohoConfig: () => ({
      code: 'ok',
      familyCustomFieldId: 'cf1',
    }),
  })
  const { getZohoDebugItems } = freshRequire('../src/controllers/debugZohoController')
  const { req, res } = makeReqRes()
  await getZohoDebugItems(req, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.items, [])
})

test('getZohoDebugItems: merges getItems with raw (first 20 cap)', async () => {
  const norm = [
    { name: 'N1', sku: 'S1', item_id: '1', family: 'F' },
  ]
  const raw = [
    { name: 'N1', sku: 'S1', custom_fields: [{ customfield_id: 'cf1', value: 'F' }], stock_on_hand: 3 },
  ]
  mockModule('../src/integrations/zoho/zohoAdapter', {
    getItems: async () => norm,
    fetchAllItemsRaw: async () => raw,
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: 'cf1' }),
  })
  const { getZohoDebugItems } = freshRequire('../src/controllers/debugZohoController')
  const { req, res } = makeReqRes()
  await getZohoDebugItems(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.items[0].name, 'N1')
  assert.equal(res.body.items[0].sku, 'S1')
  assert.equal(res.body.items[0].stock_on_hand, 3)
  assert.equal(res.body.items[0].family, 'F')
  assert.ok(Array.isArray(res.body.items[0].custom_fields))
})

test('getZohoDebugItems: ZOHO_OAUTH_ERROR message', async () => {
  const err = new Error('token bad')
  err.code = 'ZOHO_OAUTH_ERROR'
  err.oauth = { error: 'invalid_client' }
  mockModule('../src/integrations/zoho/zohoAdapter', {
    getItems: async () => { throw err },
    fetchAllItemsRaw: async () => [],
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: null }),
  })
  const { getZohoDebugItems } = freshRequire('../src/controllers/debugZohoController')
  const { req, res } = makeReqRes()
  await getZohoDebugItems(req, res)
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.code, 'ZOHO_OAUTH_ERROR')
  assert.match(res.body.error, /authentication failed/i)
})

test('getZohoDebugItems: ZOHO_API_ERROR includes zoho block', async () => {
  const err = new Error('app err')
  err.code = 'ZOHO_API_ERROR'
  err.httpStatus = 500
  err.zohoPath = '/inventory/v1/items'
  err.zohoResponse = { code: 2, message: 'oops' }
  mockModule('../src/integrations/zoho/zohoAdapter', {
    getItems: async () => { throw err },
    fetchAllItemsRaw: async () => [],
    readZohoConfig: () => ({ code: 'ok' }),
  })
  const { getZohoDebugItems } = freshRequire('../src/controllers/debugZohoController')
  const { req, res } = makeReqRes()
  await getZohoDebugItems(req, res)
  assert.equal(res.statusCode, 502)
  assert.deepEqual(res.body.zoho.response, { code: 2, message: 'oops' })
})

test('stockOnHandField: prefers stock_on_hand', async () => {
  const { stockOnHandField } = require('../src/controllers/debugZohoController')
  assert.equal(stockOnHandField({ stock_on_hand: 5, available_stock: 9 }), 5)
  assert.equal(stockOnHandField({ available_stock: 2 }), 2)
})
