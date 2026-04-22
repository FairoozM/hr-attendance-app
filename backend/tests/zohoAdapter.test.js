/**
 * Zoho adapter + deprecated Deluge surface (no real Zoho API calls).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire } = require('./_helpers')

const ZOHO_ENV_KEYS = [
  'ZOHO_CLIENT_ID',
  'ZOHO_CLIENT_SECRET',
  'ZOHO_REFRESH_TOKEN',
  'ZOHO_ORGANIZATION_ID',
  'ZOHO_INVENTORY_ORGANIZATION_ID',
  'ZOHO_FAMILY_CUSTOMFIELD_ID',
  'ZOHO_API_BASE_URL',
  'ZOHO_INVENTORY_API_BASE',
]

async function withZohoEnv(overrides, fn) {
  const prev = {}
  for (const k of ZOHO_ENV_KEYS) prev[k] = process.env[k]
  for (const k of ZOHO_ENV_KEYS) delete process.env[k]
  Object.assign(process.env, overrides)
  try {
    await fn()
  } finally {
    for (const k of ZOHO_ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  }
}

test('zohoDelugeWebhookAdapter.deprecated: never used in report path, throws if invoked', () => {
  const { assertDelugeReportEngineRemoved } = require('../src/integrations/zoho/zohoDelugeWebhookAdapter.deprecated')
  assert.throws(
    () => assertDelugeReportEngineRemoved(),
    (e) => e.code === 'ZohoDelugeReportDeprecated',
  )
})

test('zohoAdapter.fetchAllItemsRaw delegates to inventory listAllItems (mocked)', async (t) => {
  const fake = [{ sku: 'S1', name: 'N', item_id: 1, locations: [], custom_fields: [] }]
  const restore = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    listAllItems: async () => fake,
    zohoApiRequest: async () => ({}),
  })
  t.after(restore)
  const adapter = freshRequire('../src/integrations/zoho/zohoAdapter')
  const out = await adapter.fetchAllItemsRaw()
  assert.deepEqual(out, fake)
})

test('zohoAdapter.getItems: normalized shape + Family from custom_fields (mocked listAllItems)', async (t) => {
  await withZohoEnv(
    {
      ZOHO_CLIENT_ID: 'id',
      ZOHO_CLIENT_SECRET: 'sec',
      ZOHO_REFRESH_TOKEN: 'ref',
      ZOHO_ORGANIZATION_ID: 'org',
      ZOHO_FAMILY_CUSTOMFIELD_ID: 'cf-fam',
    },
    async () => {
      const raw = [
        {
          item_id: 7,
          sku: 'K1',
          name: 'One',
          custom_fields: [{ customfield_id: 'cf-fam', value: 'Alpha' }],
        },
        {
          item_id: 8,
          sku: 'K2',
          name: 'Two',
          custom_fields: [{ customfield_id: 'other', value: 'ignore' }],
        },
      ]
      const restore = mockModule('../src/integrations/zoho/zohoInventoryClient', {
        listAllItems: async () => raw,
        zohoApiRequest: async () => ({}),
      })
      t.after(restore)
      const adapter = freshRequire('../src/integrations/zoho/zohoAdapter')
      const out = await adapter.getItems()
      assert.equal(out.length, 2)
      assert.deepEqual(out[0], {
        item_id: '7',
        sku: 'K1',
        name: 'One',
        family: 'Alpha',
      })
      assert.deepEqual(out[1], {
        item_id: '8',
        sku: 'K2',
        name: 'Two',
        family: '',
      })
    },
  )
})
