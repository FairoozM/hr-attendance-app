/**
 * Unit + integration tests for backend/src/services/zohoService.js
 * Zoho is mocked at weeklyReportZohoData (no real OAuth or HTTP to Zoho).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire } = require('./_helpers')

const sampleRows = [
  {
    sku: 'A',
    item_name: 'Item A',
    item_id: '100',
    family: 'F1',
    opening_stock: 10,
    purchases: 1,
    returned_to_wholesale: 0,
    closing_stock: 9,
    sold: 2,
  },
  {
    sku: 'B',
    item_name: 'Item B',
    item_id: '101',
    family: '',
    opening_stock: null,
    purchases: null,
    returned_to_wholesale: null,
    closing_stock: 3,
    sold: null,
  },
]

let fetchPayload = sampleRows
let fetchError = null

function clearZohoEnv() {
  delete process.env.ZOHO_CLIENT_ID
  delete process.env.ZOHO_CLIENT_SECRET
  delete process.env.ZOHO_REFRESH_TOKEN
  delete process.env.ZOHO_INVENTORY_ORGANIZATION_ID
  delete process.env.ZOHO_FAMILY_CUSTOMFIELD_ID
  delete process.env.ZOHO_API_TIMEOUT_MS
}

/**
 * @param {object} [opts]
 * @param {object[]=} opts.fetchRows
 * @param {string=} opts.orgId
 */
function loadZoho(members = [], opts = {}) {
  fetchError = null
  fetchPayload = opts.fetchRows ?? sampleRows
  if (opts.orgId) process.env.ZOHO_INVENTORY_ORGANIZATION_ID = opts.orgId
  else process.env.ZOHO_INVENTORY_ORGANIZATION_ID = '10234695'
  if (!process.env.ZOHO_CLIENT_ID) {
    process.env.ZOHO_CLIENT_ID = 'test-client'
    process.env.ZOHO_CLIENT_SECRET = 'test-secret'
    process.env.ZOHO_REFRESH_TOKEN = 'test-refresh'
  }
  if (opts.fetchError) {
    mockModule('../src/services/weeklyReportZohoData', {
      fetchZohoItemRowsUnfiltered: async () => { throw Object.assign(new Error(opts.fetchError.message), { code: opts.fetchError.code }) },
    })
  } else {
    mockModule('../src/services/weeklyReportZohoData', {
      fetchZohoItemRowsUnfiltered: async (from, to) => {
        if (from === 'throw' && to === 'throw') throw new Error('bad')
        return fetchPayload
      },
    })
  }
  mockModule('../src/services/itemReportGroupsService', {
    listMembersOfGroup: async () => members,
    listGroupKeys:      async () => ['slow_moving', 'other_family'],
  })
  return freshRequire('../src/services/zohoService')
}

test.beforeEach(() => {
  fetchPayload = sampleRows
  fetchError = null
})

// ---------------------------------------------------------------------------
// validateAndNormaliseItem
// ---------------------------------------------------------------------------

test('zohoService._internals.validateAndNormaliseItem accepts a complete row', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem(
    {
      sku: 'FL-001', item_name: 'FL Shine', family: 'ZDS',
      opening_stock: 100, purchases: 5, returned_to_wholesale: 0,
      closing_stock: 95, sold: 10,
    },
    0
  )
  assert.equal(errors.length, 0)
  assert.equal(item.sku, 'FL-001')
  assert.equal(item.family, 'ZDS')
  assert.equal(item.opening_stock, 100)
  assert.equal(item.sold, 10)
})

test('zohoService._internals.validateAndNormaliseItem: explicit null = N/A (null) for a numeric', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem(
    { sku: 'X', family: '', opening_stock: null, closing_stock: 0, purchases: 0, returned_to_wholesale: 0, sold: 0 },
    0
  )
  assert.equal(errors.length, 0)
  assert.equal(item.opening_stock, null)
})

test('zohoService._internals.validateAndNormaliseItem: absent numerics default to 0', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem(
    { sku: 'X', family: '' },
    0
  )
  assert.equal(errors.length, 0)
  assert.equal(item.opening_stock, 0)
  assert.equal(item.purchases, 0)
  assert.equal(item.sold, 0)
})

test('zohoService._internals.validateAndNormaliseItem rejects missing family key', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem({
    sku: 'X', opening_stock: 0, purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0,
  }, 0)
  assert.equal(item, null)
  assert.ok(errors.some((e) => /"family" is required/.test(e)))
})

test('zohoService._internals.validateAndNormaliseItem accepts family as empty string', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem(
    { sku: 'X', family: '', opening_stock: 0, purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0 },
    0
  )
  assert.equal(errors.length, 0)
  assert.equal(item.family, '')
})

test('zohoService._internals.validateAndNormaliseItem rejects non-string family', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem(
    { sku: 'X', family: 99, opening_stock: 0, purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0 },
    0
  )
  assert.equal(item, null)
  assert.ok(errors.some((e) => /"family" must be a string/.test(e)))
})

test('zohoService._internals.validateAndNormaliseItem rejects null family', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem(
    { sku: 'X', family: null, opening_stock: 0, purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0 },
    0
  )
  assert.equal(item, null)
  assert.ok(errors.some((e) => /"family" must be a JSON string, not null/.test(e)))
})

test('zohoService._internals.validateAndNormaliseItem rejects a missing sku', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem({ item_name: 'X' }, 3)
  assert.equal(item, null)
  assert.ok(errors.some((e) => /"sku" is required/.test(e)))
  assert.ok(errors[0].startsWith('items[3]'))
})

test('zohoService._internals.validateAndNormaliseItem rejects empty/whitespace skus', () => {
  const zoho = loadZoho()
  for (const sku of ['', '   ']) {
    const { item, errors } = zoho._internals.validateAndNormaliseItem({ sku, family: '' }, 0)
    assert.equal(item, null)
    assert.ok(errors.length > 0)
  }
})

test('zohoService._internals.validateAndNormaliseItem rejects non-numeric stock fields (string, bool, NaN)', () => {
  const zoho = loadZoho()
  const cases = [
    { opening_stock: '100' },
    { sold: true },
    { purchases: NaN },
    { closing_stock: Infinity },
  ]
  for (const extra of cases) {
    const { item, errors } = zoho._internals.validateAndNormaliseItem(
      { sku: 'X', family: 'F', ...extra },
      0
    )
    assert.equal(item, null, `should reject ${JSON.stringify(extra)}`)
    assert.ok(errors.some((e) => /must be a JSON number/.test(e)))
  }
})

test('zohoService._internals.buildMatcher matches by SKU first, item_name as legacy fallback', () => {
  const zoho = loadZoho()
  const match = zoho._internals.buildMatcher([
    { sku: 'FL-001', item_name: 'FL Shine' },
    { sku: null,     item_name: 'Legacy Only' },
  ])
  assert.equal(match({ sku: 'fl-001', item_name: 'whatever' }), true)
  assert.equal(match({ sku: '',       item_name: 'Legacy Only' }), true)
  assert.equal(match({ sku: 'FL-002', item_name: 'no match' }), false)
})

// ---------------------------------------------------------------------------
// getInventoryByGroup
// ---------------------------------------------------------------------------

test('zohoService: ZOHO_NOT_CONFIGURED from data layer', async () => {
  clearZohoEnv()
  mockModule('../src/services/weeklyReportZohoData', {
    fetchZohoItemRowsUnfiltered: async () => {
      const e = new Error('Zoho not configured')
      e.code = 'ZOHO_NOT_CONFIGURED'
      throw e
    },
  })
  mockModule('../src/services/itemReportGroupsService', {
    listMembersOfGroup: async () => [{ sku: 'X' }],
    listGroupKeys:      async () => ['slow_moving', 'other_family'],
  })
  const zoho = freshRequire('../src/services/zohoService')
  await assert.rejects(
    () => zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07'),
    (e) => e.code === 'ZOHO_NOT_CONFIGURED'
  )
})

test('zohoService: propagates ZOHO_OAUTH_ERROR from fetch', async () => {
  const zoho = loadZoho([{ sku: 'A' }], { fetchError: { code: 'ZOHO_OAUTH_ERROR', message: 'bad token' } })
  await assert.rejects(
    () => zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07'),
    (e) => e.code === 'ZOHO_OAUTH_ERROR'
  )
})

test('zohoService: row missing sku in fetch payload → WEBHOOK_INVALID_RESPONSE', async () => {
  const zoho = loadZoho(
    [{ sku: 'A' }],
    { fetchRows: [
      { sku: 'A', item_name: 'Ok', item_id: '1', family: '', opening_stock: 0, purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0 },
      { sku: '',  item_name: 'Bad', item_id: '2', family: '', opening_stock: 0, purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0 },
    ] }
  )
  await assert.rejects(
    () => zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07'),
    (e) => e.code === 'WEBHOOK_INVALID_RESPONSE' && e.validation_errors.some((m) => /sku" is required/.test(m))
  )
})

test('zohoService: empty members short-circuits — fetchZoho is never called', async () => {
  let count = 0
  clearZohoEnv()
  if (!process.env.ZOHO_CLIENT_ID) {
    process.env.ZOHO_CLIENT_ID = 'x'
    process.env.ZOHO_CLIENT_SECRET = 'y'
    process.env.ZOHO_REFRESH_TOKEN = 'z'
    process.env.ZOHO_INVENTORY_ORGANIZATION_ID = '1'
  }
  mockModule('../src/services/weeklyReportZohoData', {
    fetchZohoItemRowsUnfiltered: async () => {
      count += 1
      return sampleRows
    },
  })
  mockModule('../src/services/itemReportGroupsService', { listMembersOfGroup: async () => [], listGroupKeys: async () => ['slow_moving', 'other_family'] })
  const zoho = freshRequire('../src/services/zohoService')
  const items = await zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07')
  assert.deepEqual(items, [])
  assert.equal(count, 0, 'Zoho data fetch should not run for empty group')
})

test('zohoService: SKU filter keeps only group members', async () => {
  const zoho = loadZoho(
    [{ sku: 'A' }],
    { fetchRows: [
      { sku: 'A', item_name: 'A', item_id: '1', family: 'F', opening_stock: 1, purchases: 0, returned_to_wholesale: 0, closing_stock: 1, sold: 0 },
      { sku: 'Z', item_name: 'Z', item_id: '2', family: 'F', opening_stock: 0, purchases: 0, returned_to_wholesale: 0, closing_stock: 0, sold: 0 },
    ] }
  )
  const items = await zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07')
  assert.equal(items.length, 1)
  assert.equal(items[0].sku, 'A')
})

test('zohoService: nulls on unfiltered API-style row round-trip for member', async () => {
  const zoho = loadZoho(
    [{ sku: 'B' }],
    { fetchRows: [
      {
        sku: 'B',
        item_name: 'Item B',
        item_id: '101',
        family: 'X',
        opening_stock: null,
        purchases: null,
        returned_to_wholesale: null,
        closing_stock: 3,
        sold: null,
      },
    ] }
  )
  const items = await zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07')
  assert.equal(items.length, 1)
  assert.equal(items[0].opening_stock, null)
  assert.equal(items[0].closing_stock, 3)
})
