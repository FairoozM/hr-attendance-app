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
    purchase_amount: 0,
    returned_to_wholesale: 0,
    closing_stock: 9,
    sales_amount: 0,
  },
  {
    sku: 'B',
    item_name: 'Item B',
    item_id: '101',
    family: '',
    opening_stock: 3,
    purchase_amount: 0,
    returned_to_wholesale: 0,
    closing_stock: 3,
    sales_amount: 0,
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
      fetchZohoItemRowsForGroupMembers: async () => { throw Object.assign(new Error(opts.fetchError.message), { code: opts.fetchError.code }) },
    })
  } else {
    mockModule('../src/services/weeklyReportZohoData', {
      fetchZohoItemRowsForGroupMembers: async (_members, from, to) => {
        if (from === 'throw' && to === 'throw') throw new Error('bad')
        return { items: fetchPayload, reportMeta: { warnings: [] } }
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
      opening_stock: 100, purchase_amount: 5, returned_to_wholesale: 0,
      closing_stock: 95, sales_amount: 10,
      _zoho: { from_date: '2026-01-01', to_date: '2026-01-07' },
    },
    0
  )
  assert.equal(errors.length, 0)
  assert.equal(item.sku, 'FL-001')
  assert.equal(item.family, 'ZDS')
  assert.equal(item.opening_stock, 100)
  assert.equal(item.sales_amount, 10)
  assert.equal(item.purchase_amount, 5)
  assert.equal(item._zoho.family, 'ZDS')
  assert.equal(item._zoho.from_date, '2026-01-01')
  assert.equal(item._zoho.to_date, '2026-01-07')
})

test('zohoService._internals.validateAndNormaliseItem: family row keeps zoho_representative_item_id', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem(
    {
      family: 'Acrylic',
      zoho_representative_item_id: '4815000000123456',
      zoho_representative_sku: 'LIF-REP-1',
      zoho_representative_name: 'Representative name',
      zoho_representative_image_selection_version: 9,
      zoho_representative_score: 1200.5,
      zoho_representative_reason: 'v2:debug',
      opening_stock: 1,
      purchase_amount: 0,
      returned_to_wholesale: 0,
      closing_stock: 2,
      sales_amount: 0,
    },
    0
  )
  assert.equal(errors.length, 0)
  assert.equal(item.zoho_representative_item_id, '4815000000123456')
  assert.equal(item.zoho_representative_sku, 'LIF-REP-1')
  assert.equal(item.zoho_representative_name, 'Representative name')
  assert.equal(item.zoho_representative_image_selection_version, 9)
  assert.equal(item.zoho_representative_score, 1200.5)
  assert.equal(item.zoho_representative_reason, 'v2:debug')
  assert.ok(!item.sku)
})

test('zohoService._internals.validateAndNormaliseItem: explicit null = N/A (null) for a numeric', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem(
    { sku: 'X', family: '', opening_stock: null, closing_stock: 0, purchase_amount: 0, returned_to_wholesale: 0, sales_amount: 0 },
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
  assert.equal(item.purchase_amount, 0)
  assert.equal(item.sales_amount, 0)
})

test('zohoService._internals.validateAndNormaliseItem: item row without family key uses ""', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem({
    sku: 'X', opening_stock: 0, purchase_amount: 0, returned_to_wholesale: 0, closing_stock: 0, sales_amount: 0,
  }, 0)
  assert.equal(errors.length, 0)
  assert.equal(item.family, '')
})

test('zohoService._internals.validateAndNormaliseItem accepts family as empty string', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem(
    { sku: 'X', family: '', opening_stock: 0, purchase_amount: 0, returned_to_wholesale: 0, closing_stock: 0, sales_amount: 0 },
    0
  )
  assert.equal(errors.length, 0)
  assert.equal(item.family, '')
  assert.equal(item._zoho.family, '')
})

test('zohoService._internals.validateAndNormaliseItem rejects non-string family', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem(
    { sku: 'X', family: 99, opening_stock: 0, purchase_amount: 0, returned_to_wholesale: 0, closing_stock: 0, sales_amount: 0 },
    0
  )
  assert.equal(item, null)
  assert.ok(errors.some((e) => /"family" must be a string/.test(e)))
})

test('zohoService._internals.validateAndNormaliseItem rejects null family', () => {
  const zoho = loadZoho()
  const { item, errors } = zoho._internals.validateAndNormaliseItem(
    { sku: 'X', family: null, opening_stock: 0, purchase_amount: 0, returned_to_wholesale: 0, closing_stock: 0, sales_amount: 0 },
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
    { sales_amount: true },
    { purchase_amount: NaN },
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
    fetchZohoItemRowsForGroupMembers: async () => {
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
      { sku: 'A', item_name: 'Ok', item_id: '1', family: '', opening_stock: 0, purchase_amount: 0, returned_to_wholesale: 0, closing_stock: 0, sales_amount: 0 },
      { family: null, item_name: 'Bad', item_id: '2', sku: '', opening_stock: 0, purchase_amount: 0, returned_to_wholesale: 0, closing_stock: 0, sales_amount: 0 },
    ] }
  )
  await assert.rejects(
    () => zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07'),
    (e) => e.code === 'WEBHOOK_INVALID_RESPONSE' && e.validation_errors.some((m) => /sku" is required/.test(m))
  )
})

test('zohoService: empty members short-circuits — fetchZoho is never called (except other_family)', async () => {
  let count = 0
  clearZohoEnv()
  if (!process.env.ZOHO_CLIENT_ID) {
    process.env.ZOHO_CLIENT_ID = 'x'
    process.env.ZOHO_CLIENT_SECRET = 'y'
    process.env.ZOHO_REFRESH_TOKEN = 'z'
    process.env.ZOHO_INVENTORY_ORGANIZATION_ID = '1'
  }
  mockModule('../src/services/weeklyReportZohoData', {
    fetchZohoItemRowsForGroupMembers: async () => {
      count += 1
      return { items: sampleRows, reportMeta: { warnings: [] } }
    },
  })
  mockModule('../src/services/itemReportGroupsService', { listMembersOfGroup: async () => [], listGroupKeys: async () => ['slow_moving', 'other_family'] })
  const zoho = freshRequire('../src/services/zohoService')
  const r = await zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07')
  assert.deepEqual(r.items, [])
  assert.ok(r.reportMeta)
  assert.equal(count, 0, 'Zoho data fetch should not run for empty group')

  const r2 = await zoho.getInventoryByGroup('other_family', '2026-01-01', '2026-01-07')
  assert.equal(
    r2.items.length,
    sampleRows.length,
    'other_family with no DB members still fetches (Zoho-only families and labels)'
  )
  assert.equal(count, 1)
})

test('zohoService: intersection (members ∩ Zoho) — mocked data returns only in-group item', async () => {
  const zoho = loadZoho(
    [{ sku: 'A' }],
    { fetchRows: [
      { sku: 'A', item_name: 'A', item_id: '1', family: 'F', opening_stock: 1, purchase_amount: 0, returned_to_wholesale: 0, closing_stock: 1, sales_amount: 0 },
    ] }
  )
  const { items } = await zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07')
  assert.equal(items.length, 1)
  assert.equal(items[0].sku, 'A')
})

test('zohoService: placeholder numbers round-trip for member', async () => {
  const zoho = loadZoho(
    [{ sku: 'B' }],
    { fetchRows: [
      {
        sku: 'B',
        item_name: 'Item B',
        item_id: '101',
        family: 'X',
        opening_stock: 3,
        purchase_amount: 0,
        returned_to_wholesale: 0,
        closing_stock: 3,
        sales_amount: 0,
        _zoho: { from_date: '2026-01-01', to_date: '2026-01-07', family: 'X' },
      },
    ] }
  )
  const { items } = await zoho.getInventoryByGroup('slow_moving', '2026-01-01', '2026-01-07')
  assert.equal(items.length, 1)
  assert.equal(items[0].opening_stock, 3)
  assert.equal(items[0].closing_stock, 3)
  assert.equal(items[0].purchase_amount, 0)
  assert.equal(items[0].sales_amount, 0)
  assert.equal(items[0].family, 'X')
  assert.equal(items[0]._zoho.family, 'X')
  assert.equal(items[0]._zoho.from_date, '2026-01-01')
  assert.equal(items[0]._zoho.to_date, '2026-01-07')
})

test('zohoService: getFamilyWarehouseMatrixByGroup cold block runs before members/matrix (BLOCK=1)', async () => {
  const prevBlock = process.env.BLOCK_COLD_FAMILY_DETAILS_PREFETCH_MISS
  process.env.BLOCK_COLD_FAMILY_DETAILS_PREFETCH_MISS = '1'
  const restorePeek = mockModule('../src/services/weeklyReportPrefetchStash', {
    peekWeeklyReportPrefetchBundle: () => null,
  })
  let listCalls = 0
  mockModule('../src/services/itemReportGroupsService', {
    listMembersOfGroup: async () => {
      listCalls += 1
      return [{ sku: 'A' }]
    },
    listGroupKeys: async () => ['slow_moving'],
  })
  const wrzdResolved = require.resolve('../src/services/weeklyReportZohoData', { paths: [__dirname] })
  delete require.cache[wrzdResolved]
  const { coldBlockedFamilyDetailsMatrixPayload } = require('../src/services/weeklyReportZohoData')
  mockModule('../src/services/weeklyReportZohoData', {
    fetchZohoItemRowsForGroupMembers: async () => ({ items: [], reportMeta: {} }),
    buildFamilyWarehouseMatrixForGroupMembers: async () => {
      throw new Error('buildFamilyWarehouseMatrixForGroupMembers must not run when cold blocked')
    },
    coldBlockedFamilyDetailsMatrixPayload,
  })
  const zoho = freshRequire('../src/services/zohoService')
  const out = await zoho.getFamilyWarehouseMatrixByGroup(
    'slow_moving',
    'LIFEP7S',
    '2026-01-01',
    '2026-01-07',
    [{ warehouse_id: 'w1', warehouse_name: 'W1' }],
    null,
    null
  )
  restorePeek()
  if (prevBlock === undefined) delete process.env.BLOCK_COLD_FAMILY_DETAILS_PREFETCH_MISS
  else process.env.BLOCK_COLD_FAMILY_DETAILS_PREFETCH_MISS = prevBlock
  delete require.cache[require.resolve('../src/services/zohoService', { paths: [__dirname] })]
  delete require.cache[wrzdResolved]
  assert.equal(listCalls, 0)
  assert.equal(out.meta.fallbackReason, 'prefetch_bundle_missing')
  assert.equal(out.meta.usedPrefetch, false)
})

test('zohoService: getFamilyWarehouseMatrixByGroup passes familyMainRows from stash so totals match main report', async (t) => {
  void t
  const prevBlock = process.env.BLOCK_COLD_FAMILY_DETAILS_PREFETCH_MISS
  delete process.env.BLOCK_COLD_FAMILY_DETAILS_PREFETCH_MISS

  const mainFamilyRow = {
    family: 'LIFEP7S',
    opening_stock: 9999,
    closing_stock: 8888,
    opening_qty: 200,
    closing_qty: 180,
    sales_amount: 50000,
    stock_total_source: 'warehouse_matrix',
  }

  const prefetchBundle = {
    raw: [],
    salesR: { lines: [], line_count: 0, list_truncated: false, error: null },
    purchR: { lines: [], line_count: 0, list_truncated: false, error: null },
    vcR:    { lines: [], line_count: 0, list_truncated: false, error: null },
    familyRows: [mainFamilyRow],
  }

  const restorePeek = mockModule('../src/services/weeklyReportPrefetchStash', {
    peekWeeklyReportPrefetchBundle: () => prefetchBundle,
  })

  let capturedOptions = null
  const restoreWrzd = mockModule('../src/services/weeklyReportZohoData', {
    fetchZohoItemRowsForGroupMembers: async () => ({ items: [], reportMeta: {} }),
    buildFamilyWarehouseMatrixForGroupMembers: async (_members, _f, _t, _vc, _g, _fam, _wh, _wid, _exwid, opts) => {
      capturedOptions = opts
      return {
        family: 'LIFEP7S',
        warehouses: [],
        sections: {},
        items: [],
        totals: { openingAmount: 9999, closingAmount: 8888, openingQty: 200, closingQty: 180, salesAmount: 50000, salesQty: 0 },
        meta: { usedPrefetch: true, totalsSource: 'main_report_family_row' },
        reportMeta: { warnings: [] },
      }
    },
    coldBlockedFamilyDetailsMatrixPayload: () => { throw new Error('cold block must not run') },
    _internals: {
      familyRowKeyFromDisplay: (v) => String(v || '').toLowerCase().trim(),
    },
  })

  mockModule('../src/services/itemReportGroupsService', {
    listMembersOfGroup: async () => [{ sku: 'LIFEP7S-24P' }],
    listGroupKeys: async () => ['slow_moving'],
  })

  const zoho = freshRequire('../src/services/zohoService')
  const out = await zoho.getFamilyWarehouseMatrixByGroup(
    'slow_moving',
    'LIFEP7S',
    '2026-01-01',
    '2026-01-07',
    [{ warehouse_id: 'wh1', warehouse_name: 'WH1' }],
    null,
    null
  )

  restorePeek()
  restoreWrzd()
  if (prevBlock === undefined) delete process.env.BLOCK_COLD_FAMILY_DETAILS_PREFETCH_MISS
  else process.env.BLOCK_COLD_FAMILY_DETAILS_PREFETCH_MISS = prevBlock
  delete require.cache[require.resolve('../src/services/zohoService', { paths: [__dirname] })]
  delete require.cache[require.resolve('../src/services/weeklyReportZohoData', { paths: [__dirname] })]

  assert.ok(capturedOptions, 'matrix builder options must have been captured')
  assert.ok(Array.isArray(capturedOptions.familyMainRows), 'familyMainRows must be passed as array')
  assert.equal(capturedOptions.familyMainRows.length, 1)
  assert.equal(capturedOptions.familyMainRows[0].opening_stock, 9999)
  assert.equal(out.totals.openingAmount, 9999, 'totals must match main report family row')
})

test('zohoService: getFamilyWarehouseMatrixByGroup passes skuItemRows (per-SKU rows) from stash', async (t) => {
  void t
  const prevBlock = process.env.BLOCK_COLD_FAMILY_DETAILS_PREFETCH_MISS
  delete process.env.BLOCK_COLD_FAMILY_DETAILS_PREFETCH_MISS

  const perSkuRows = [
    { sku: 'LIFEP7S-24P', item_id: '11', family: 'LIFEP7S', family_display: 'LIFEP7S',
      opening_qty: 50, opening_amount: 2500, closing_qty: 40, closing_amount: 2000, sales_amount: 500 },
    { sku: 'LIFEP7S-12P', item_id: '12', family: 'LIFEP7S', family_display: 'LIFEP7S',
      opening_qty: 20, opening_amount: 1000, closing_qty: 15, closing_amount: 750, sales_amount: 250 },
  ]

  const prefetchBundle = {
    raw: [],
    salesR: { lines: [], line_count: 0, list_truncated: false, error: null },
    purchR: { lines: [], line_count: 0, list_truncated: false, error: null },
    vcR:    { lines: [], line_count: 0, list_truncated: false, error: null },
    itemRows: perSkuRows,
    familyRows: [],
  }

  const restorePeek = mockModule('../src/services/weeklyReportPrefetchStash', {
    peekWeeklyReportPrefetchBundle: () => prefetchBundle,
  })

  let capturedOptions = null
  const restoreWrzd = mockModule('../src/services/weeklyReportZohoData', {
    fetchZohoItemRowsForGroupMembers: async () => ({ items: [], reportMeta: {} }),
    buildFamilyWarehouseMatrixForGroupMembers: async (_m, _f, _t, _vc, _g, _fam, _wh, _wid, _exwid, opts) => {
      capturedOptions = opts
      return { family: 'LIFEP7S', warehouses: [], sections: {}, items: [], totals: {}, meta: {}, reportMeta: { warnings: [] } }
    },
    coldBlockedFamilyDetailsMatrixPayload: () => { throw new Error('should not cold-block') },
    _internals: {
      familyRowKeyFromDisplay: (v) => String(v || '').toLowerCase().trim(),
    },
  })

  mockModule('../src/services/itemReportGroupsService', {
    listMembersOfGroup: async () => [{ sku: 'LIFEP7S-24P' }],
    listGroupKeys: async () => ['slow_moving'],
  })

  const zoho = freshRequire('../src/services/zohoService')
  await zoho.getFamilyWarehouseMatrixByGroup(
    'slow_moving', 'LIFEP7S', '2026-01-01', '2026-01-07',
    [{ warehouse_id: 'wh1', warehouse_name: 'WH1' }], null, null
  )

  restorePeek()
  restoreWrzd()
  if (prevBlock === undefined) delete process.env.BLOCK_COLD_FAMILY_DETAILS_PREFETCH_MISS
  else process.env.BLOCK_COLD_FAMILY_DETAILS_PREFETCH_MISS = prevBlock
  delete require.cache[require.resolve('../src/services/zohoService', { paths: [__dirname] })]
  delete require.cache[require.resolve('../src/services/weeklyReportZohoData', { paths: [__dirname] })]

  assert.ok(capturedOptions, 'options must be captured')
  assert.ok(Array.isArray(capturedOptions.skuItemRows), 'skuItemRows must be an array')
  assert.equal(capturedOptions.skuItemRows.length, 2, 'both per-SKU rows for LIFEP7S must be passed')
  assert.equal(capturedOptions.skuItemRows[0].sku, 'LIFEP7S-24P')
  assert.equal(capturedOptions.skuItemRows[1].sku, 'LIFEP7S-12P')
})
