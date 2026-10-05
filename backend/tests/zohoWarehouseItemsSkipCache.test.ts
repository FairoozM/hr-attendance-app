'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

function stubModule(relativePath: string, exports: Record<string, unknown>): () => void {
  const resolved = require.resolve(relativePath)
  const previous = require.cache[resolved]
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as any
  return () => {
    if (previous) require.cache[resolved] = previous
    else delete require.cache[resolved]
  }
}

function freshModule(relativePath: string): any {
  delete require.cache[require.resolve(relativePath)]
  return require(relativePath)
}

test('warehouse items list: skipCache reaches the Zoho client and keeps the cache key for write-back', async () => {
  const metas: any[] = []
  const restoreApi = stubModule('../src/services/zohoApiClient', {
    zohoInventoryJsonRequest: async (_path: string, params: URLSearchParams, _method: string, _body: unknown, meta: any) => {
      metas.push({ ...meta, warehouseId: params.get('warehouse_id') })
      return { items: [{ item_id: '1', stock_on_hand: 5, available_for_sale: 4 }], page_context: { has_more_page: false } }
    },
    zohoInventoryBufferRequest: async () => null,
    zohoBooksJsonRequest: async () => null,
  })
  const restoreConfig = stubModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', organizationId: 'org1' }),
    INVENTORY_V1: '/inventory/v1',
  })
  try {
    const client = freshModule('../src/integrations/zoho/zohoInventoryClient')
    await client.listItemsForWarehouse('wh1')
    await client.listItemsForWarehouse('wh1', { skipCache: true })
    assert.equal(metas.length, 2)
    assert.equal(metas[0].skipCache, false)
    assert.equal(metas[1].skipCache, true)
    assert.equal(metas[1].warehouseId, 'wh1')
    assert.match(metas[1].cacheKey, /^zoho:items_list:p1:per200:whwh1:/)
  } finally {
    restoreConfig()
    restoreApi()
    delete require.cache[require.resolve('../src/integrations/zoho/zohoInventoryClient')]
  }
})

test('fetchItemsRawForWarehouse: in-memory cache is used by default and bypassed with skipCache', async () => {
  const calls: any[] = []
  const restoreClient = stubModule('../src/integrations/zoho/zohoInventoryClient', {
    listAllItems: async () => [],
    listItemsForWarehouse: async (warehouseId: string, options: any) => {
      calls.push({ warehouseId, ...options })
      return [{ item_id: String(calls.length) }]
    },
    zohoApiRequest: async () => ({}),
    fetchListPaginated: async () => [],
  })
  const previousTtl = process.env.ZOHO_ITEMS_CACHE_TTL_MS
  process.env.ZOHO_ITEMS_CACHE_TTL_MS = '60000'
  try {
    const adapter = freshModule('../src/integrations/zoho/zohoAdapter')
    const first = await adapter.fetchItemsRawForWarehouse('wh1')
    const cached = await adapter.fetchItemsRawForWarehouse('wh1')
    assert.equal(calls.length, 1, 'second default call is served from memory')
    assert.deepEqual(cached, first)
    const fresh = await adapter.fetchItemsRawForWarehouse('wh1', { skipCache: true })
    assert.equal(calls.length, 2)
    assert.equal(calls[1].skipCache, true)
    assert.equal(calls[0].skipCache, false)
    assert.deepEqual(fresh, [{ item_id: '2' }])
  } finally {
    if (previousTtl === undefined) delete process.env.ZOHO_ITEMS_CACHE_TTL_MS
    else process.env.ZOHO_ITEMS_CACHE_TTL_MS = previousTtl
    restoreClient()
    delete require.cache[require.resolve('../src/integrations/zoho/zohoAdapter')]
  }
})
