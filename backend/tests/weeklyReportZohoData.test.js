const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire } = require('./_helpers')
const { sumReportGrandTotals } = require('../src/utils/weeklyReportTotals')
const { buildZohoLookupMaps, findZohoItemForMember, aggregateByFamily, scoreZohoNameSkuText, buildWeeklyReportScope, parseWarehouseScopedStockOnHand, buildFamilyWarehouseMatrixForGroupMembers } = require(
  '../src/services/weeklyReportZohoData'
)._internals

const VENDOR = '4265011000000080014'

test('findZohoItemForMember: by sku, then item_id, then name', () => {
  const raw = [
    { sku: 'S1', name: 'N1', item_id: '10' },
    { sku: 'S2', name: 'N2', item_id: '20' },
  ]
  const maps = buildZohoLookupMaps(raw)
  assert.equal(findZohoItemForMember({ sku: 'S1' }, maps), raw[0])
  assert.equal(findZohoItemForMember({ item_id: '20' }, maps), raw[1])
  assert.equal(findZohoItemForMember({ item_name: 'N1' }, maps), raw[0])
  assert.equal(findZohoItemForMember({ item_name: 'no' }, maps), null)
})

test('buildWeeklyReportScope: explicit include beats exclusion and non-damaged excludes only', () => {
  assert.deepEqual(buildWeeklyReportScope(null, 'damaged'), {
    kind: 'all_non_damaged',
    warehouseId: null,
    excludeWarehouseId: 'damaged',
    transactionFilter: { excludeWarehouseId: 'damaged' },
    stockWarehouseId: null,
    subtractStockWarehouseId: 'damaged',
  })
  assert.deepEqual(buildWeeklyReportScope('main', 'damaged'), {
    kind: 'single_warehouse',
    warehouseId: 'main',
    excludeWarehouseId: null,
    transactionFilter: { warehouseId: 'main' },
    stockWarehouseId: 'main',
    subtractStockWarehouseId: null,
  })
})

test('parseWarehouseScopedStockOnHand: reads direct location fields and matching locations[]', () => {
  assert.equal(parseWarehouseScopedStockOnHand({ location_stock_on_hand: '6.5' }, 'loc-1'), 6.5)
  assert.equal(parseWarehouseScopedStockOnHand({
    item_id: '10',
    stock_on_hand: 99,
    locations: [
      { location_id: 'loc-1', location_stock_on_hand: 4 },
      { warehouse_id: 'loc-2', warehouse_stock_on_hand: '8' },
    ],
  }, 'loc-2'), 8)
  assert.equal(parseWarehouseScopedStockOnHand({
    stock_on_hand: 11,
    locations: [{ location_id: 'loc-1', location_stock_on_hand: 4 }],
  }, 'missing'), 11)
})

test('buildFamilyWarehouseMatrixForGroupMembers: splits stock and sales by Zoho locations in one pass', async (t) => {
  const prevN = process.env.NODE_ENV
  const prevR = process.env.REPORT_VENDOR_ID
  const prevO = process.env.WEEKLY_REPORT_VENDOR_OPTIONAL
  process.env.NODE_ENV = 'test'
  process.env.REPORT_VENDOR_ID = VENDOR
  delete process.env.WEEKLY_REPORT_VENDOR_OPTIONAL
  const r1 = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: 'cf1' }),
    orgEnvHint: () => 'ZOHO_ORGANIZATION_ID',
  })
  const r2 = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      {
        sku: 'ZDS-1-6L',
        name: 'ZDS-1-6L',
        item_id: '10',
        status: 'active',
        rate: 75,
        custom_fields: [{ customfield_id: 'cf1', value: 'LIFEP2', label: 'Family' }],
        locations: [
          { location_id: 'life', location_name: 'LIFE SMILE', location_stock_on_hand: 3 },
          { location_id: 'exports', location_name: 'E-COMMERCE EXPORTS', location_stock_on_hand: 22 },
        ],
      },
    ],
  })
  const r3 = mockModule('../src/integrations/zoho/weeklyReportZohoTransactions', {
    getSales: async () => ({
      lines: [{ item_id: '10', sku: 'ZDS-1-6L', name: 'ZDS-1-6L', quantity: 1, item_total: 75, warehouse_id: 'life' }],
      line_count: 1,
      list_truncated: false,
      error: null,
    }),
    getPurchases: async () => ({ lines: [], line_count: 0, list_truncated: false, error: null }),
    getVendorCredits: async () => ({ lines: [], line_count: 0, list_truncated: false, error: null }),
  })
  t.after(() => {
    r1()
    r2()
    r3()
    if (prevN === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevN
    if (prevR === undefined) delete process.env.REPORT_VENDOR_ID
    else process.env.REPORT_VENDOR_ID = prevR
    if (prevO === undefined) delete process.env.WEEKLY_REPORT_VENDOR_OPTIONAL
    else process.env.WEEKLY_REPORT_VENDOR_OPTIONAL = prevO
    const resolved = require.resolve('../src/services/weeklyReportZohoData', { paths: [__dirname] })
    delete require.cache[resolved]
  })
  const m = freshRequire('../src/services/weeklyReportZohoData')
  const matrix = await m.buildFamilyWarehouseMatrixForGroupMembers(
    [{ item_name: 'LIFEP2' }],
    '2026-01-01',
    '2026-01-31',
    null,
    'slow_moving',
    'LIFEP2',
    [
      { warehouse_id: 'life', warehouse_name: 'LIFE SMILE' },
      { warehouse_id: 'exports', warehouse_name: 'E-COMMERCE EXPORTS' },
    ]
  )
  assert.equal(matrix.sections.closing.rows[0].warehouses.life.qty, 3)
  assert.equal(matrix.sections.closing.rows[0].warehouses.exports.qty, 22)
  assert.equal(matrix.sections.sales.rows[0].warehouses.life.qty, 1)
  assert.equal(matrix.sections.sales.rows[0].warehouses.exports.qty, 0)
  assert.equal(matrix.sections.opening.rows[0].warehouses.life.qty, 4)
  assert.equal(matrix.sections.opening.rows[0].warehouses.exports.qty, 22)
})

test('buildFamilyWarehouseMatrixForGroupMembers: uses per-warehouse items API when list rows omit locations[]', async (t) => {
  const prevN = process.env.NODE_ENV
  const prevR = process.env.REPORT_VENDOR_ID
  process.env.NODE_ENV = 'test'
  process.env.REPORT_VENDOR_ID = VENDOR
  const r1 = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: 'cf1' }),
    orgEnvHint: () => 'ZOHO_ORGANIZATION_ID',
  })
  const r2 = mockModule('../src/integrations/zoho/zohoAdapter', {
    INVENTORY_V1: '/inventory/v1',
    fetchAllItemsRaw: async () => [
      {
        sku: 'NSEL-18',
        name: 'NSEL-18',
        item_id: '18',
        status: 'active',
        rate: 470,
        stock_on_hand: 92,
        custom_fields: [{ customfield_id: 'cf1', value: 'NSEL', label: 'Family' }],
      },
      {
        sku: 'NSEL-20',
        name: 'NSEL-20',
        item_id: '20',
        status: 'active',
        rate: 100,
        stock_on_hand: 10,
        custom_fields: [{ customfield_id: 'cf1', value: 'NSEL', label: 'Family' }],
      },
    ],
    fetchItemsRawForWarehouse: async (wid) => {
      if (wid === 'life') {
        return [{ item_id: '18', warehouse_stock_on_hand: 92 }]
      }
      if (wid === 'exports') {
        return [{ item_id: '20', warehouse_stock_on_hand: 10 }]
      }
      return []
    },
  })
  const r3 = mockModule('../src/integrations/zoho/weeklyReportZohoTransactions', {
    getSales: async () => ({ lines: [], line_count: 0, list_truncated: false, error: null }),
    getPurchases: async () => ({ lines: [], line_count: 0, list_truncated: false, error: null }),
    getVendorCredits: async () => ({ lines: [], line_count: 0, list_truncated: false, error: null }),
  })
  t.after(() => {
    r1()
    r2()
    r3()
    if (prevN === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevN
    if (prevR === undefined) delete process.env.REPORT_VENDOR_ID
    else process.env.REPORT_VENDOR_ID = prevR
    const resolved = require.resolve('../src/services/weeklyReportZohoData', { paths: [__dirname] })
    delete require.cache[resolved]
  })
  const m = freshRequire('../src/services/weeklyReportZohoData')
  const matrix = await m.buildFamilyWarehouseMatrixForGroupMembers(
    [{ item_name: 'NSEL' }],
    '2026-01-01',
    '2026-01-31',
    null,
    'slow_moving',
    'NSEL',
    [
      { warehouse_id: 'life', warehouse_name: 'LIFE SMILE' },
      { warehouse_id: 'exports', warehouse_name: 'E-COMMERCE EXPORTS' },
    ]
  )
  assert.equal(matrix.sections.closing.rows.length, 2)
  assert.equal(matrix.sections.closing.total_amount, 44240)
  assert.equal(matrix.sections.closing.rows.find((r) => r.sku === 'NSEL-18').warehouses.life.qty, 92)
  assert.equal(matrix.sections.closing.rows.find((r) => r.sku === 'NSEL-20').warehouses.exports.qty, 10)
})

test('fetchZohoItemRowsForGroupMembers: stock columns are monetary, debug + totals = sumReportGrandTotals', async (t) => {
  const prevN = process.env.NODE_ENV
  const prevR = process.env.REPORT_VENDOR_ID
  const prevJ = process.env.WEEKLY_REPORT_VENDORS_JSON
  const prevC = process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  process.env.NODE_ENV = 'test'
  process.env.REPORT_VENDOR_ID = VENDOR
  delete process.env.WEEKLY_REPORT_VENDORS_JSON
  delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  const salesLines = [
    { item_id: '10', name: 'N1', quantity: 3, item_total: 30, document_id: 'i1' },
  ]
  const purchLines = [
    { item_id: '10', name: 'N1', quantity: 2, item_total: 20, document_id: 'b1' },
  ]
  const retLines = [
    { item_id: '10', name: 'N1', quantity: 1, item_total: 5, document_id: 'v1' },
  ]
  const r1 = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: null }),
    orgEnvHint: () => 'ZOHO_ORGANIZATION_ID',
  })
  const r2 = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      { sku: 'S1', name: 'N1', item_id: '10', status: 'active', stock_on_hand: 7, rate: 1 },
    ],
  })
  const r3 = mockModule('../src/integrations/zoho/weeklyReportZohoTransactions', {
    getSales: async () => ({ lines: salesLines, line_count: salesLines.length, list_truncated: false, error: null }),
    getPurchases: async (from, to, vendorId) => {
      assert.equal(String(vendorId), VENDOR)
      return { lines: purchLines, line_count: purchLines.length, list_truncated: false, error: null }
    },
    getVendorCredits: async (from, to, vendorId) => {
      assert.equal(String(vendorId), VENDOR)
      return { lines: retLines, line_count: retLines.length, list_truncated: false, error: null }
    },
  })
  t.after(() => {
    r1()
    r2()
    r3()
    if (prevN === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevN
    if (prevR === undefined) delete process.env.REPORT_VENDOR_ID
    else process.env.REPORT_VENDOR_ID = prevR
    if (prevJ === undefined) delete process.env.WEEKLY_REPORT_VENDORS_JSON
    else process.env.WEEKLY_REPORT_VENDORS_JSON = prevJ
    if (prevC === undefined) delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
    else process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID = prevC
    const resolved = require.resolve('../src/services/weeklyReportZohoData', { paths: [__dirname] })
    delete require.cache[resolved]
  })
  const m = freshRequire('../src/services/weeklyReportZohoData')
  const { items, reportMeta } = await m.fetchZohoItemRowsForGroupMembers(
    [{ sku: 'S1' }],
    '2026-01-01',
    '2026-01-31',
    null,
    'slow_moving'
  )
  assert.equal(items.length, 1)
  const row = items[0]
  // qO = 7 - 2 + 3 + 1 = 9 → opening value 9×1; closing 7×1; purchase $ = qty 2 × item rate 1; returns = VC qty 1 × unit 1
  assert.equal(row.opening_stock, 9)
  assert.equal(row.closing_stock, 7)
  assert.equal(row.sales_amount, 30)
  assert.equal(row.purchase_amount, 2)
  assert.equal(row.returned_to_wholesale, 1)
  const td = reportMeta.transaction_debug
  assert.equal(td.sales_source_count, 1)
  assert.equal(td.purchases_source_count, 1)
  assert.equal(td.credits_source_count, 1)
  assert.equal(td.opening_stock_derived, true)
  const totals = sumReportGrandTotals(items)
  assert.equal(totals.sales_amount, 30)
  assert.equal(totals.purchase_amount, 2)
  assert.equal(totals.returned_to_wholesale, 1)
  assert.equal(totals.opening_stock, 9)
  assert.equal(totals.closing_stock, 7)
})

test('fetchZohoItemRowsForGroupMembers: all_non_damaged scope filters every metric consistently', async (t) => {
  const prevN = process.env.NODE_ENV
  const prevR = process.env.REPORT_VENDOR_ID
  const prevJ = process.env.WEEKLY_REPORT_VENDORS_JSON
  const prevC = process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  process.env.NODE_ENV = 'test'
  process.env.REPORT_VENDOR_ID = VENDOR
  delete process.env.WEEKLY_REPORT_VENDORS_JSON
  delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  const calls = { sales: null, purchases: null, credits: null }
  const r1 = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: 'cf1' }),
    orgEnvHint: () => 'ZOHO_ORGANIZATION_ID',
  })
  const r2 = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      {
        sku: 'S1',
        name: 'N1',
        item_id: '10',
        status: 'active',
        stock_on_hand: 10,
        rate: 2,
        custom_fields: [{ customfield_id: 'cf1', value: 'Fam', label: 'Family' }],
      },
    ],
    fetchItemsRawForWarehouse: async (warehouseId) => {
      assert.equal(warehouseId, 'damaged')
      return [{ sku: 'S1', name: 'N1', item_id: '10', status: 'active', warehouse_stock_on_hand: 4 }]
    },
  })
  const r3 = mockModule('../src/integrations/zoho/weeklyReportZohoTransactions', {
    getSales: async (from, to, opts) => {
      calls.sales = opts
      return { lines: [{ item_id: '10', name: 'N1', quantity: 3, item_total: 30 }], line_count: 1, list_truncated: false, error: null }
    },
    getPurchases: async (from, to, vendorId, opts) => {
      assert.equal(String(vendorId), VENDOR)
      calls.purchases = opts
      return { lines: [{ item_id: '10', name: 'N1', quantity: 2, item_total: 20 }], line_count: 1, list_truncated: false, error: null }
    },
    getVendorCredits: async (from, to, vendorId, opts) => {
      assert.equal(String(vendorId), VENDOR)
      calls.credits = opts
      return { lines: [{ item_id: '10', name: 'N1', quantity: 1, item_total: 10 }], line_count: 1, list_truncated: false, error: null }
    },
  })
  t.after(() => {
    r1()
    r2()
    r3()
    if (prevN === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevN
    if (prevR === undefined) delete process.env.REPORT_VENDOR_ID
    else process.env.REPORT_VENDOR_ID = prevR
    if (prevJ === undefined) delete process.env.WEEKLY_REPORT_VENDORS_JSON
    else process.env.WEEKLY_REPORT_VENDORS_JSON = prevJ
    if (prevC === undefined) delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
    else process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID = prevC
    const resolved = require.resolve('../src/services/weeklyReportZohoData', { paths: [__dirname] })
    delete require.cache[resolved]
  })
  const m = freshRequire('../src/services/weeklyReportZohoData')
  const { items, reportMeta } = await m.fetchZohoItemRowsForGroupMembers(
    [{ sku: 'S1' }],
    '2026-01-01',
    '2026-01-31',
    null,
    'slow_moving',
    null,
    'damaged'
  )
  assert.equal(calls.sales.excludeWarehouseId, 'damaged')
  assert.equal(calls.purchases.excludeWarehouseId, 'damaged')
  assert.equal(calls.credits.excludeWarehouseId, 'damaged')
  const row = items[0]
  // closing qty = global 10 - damaged 4 = 6; opening qty = 6 - purchases 2 + sold 3 + returns 1 = 8; unit = 2
  assert.equal(row.closing_stock, 12)
  assert.equal(row.opening_stock, 16)
  assert.equal(row.purchase_amount, 4)
  assert.equal(row.returned_to_wholesale, 2)
  assert.equal(row.sales_amount, 30)
  assert.equal(reportMeta.transaction_debug.report_scope.kind, 'all_non_damaged')
})

test('fetchZohoItemRowsForGroupMembers: purchase_rate used when selling rate absent; returns = qty × unit (not raw VC line total)', async (t) => {
  const prevN = process.env.NODE_ENV
  const prevR = process.env.REPORT_VENDOR_ID
  const prevJ = process.env.WEEKLY_REPORT_VENDORS_JSON
  const prevC = process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  process.env.NODE_ENV = 'test'
  process.env.REPORT_VENDOR_ID = VENDOR
  delete process.env.WEEKLY_REPORT_VENDORS_JSON
  delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  const salesLines = [
    { item_id: '10', name: 'N1', quantity: 1, item_total: 10, document_id: 'i1' },
  ]
  const purchLines = [{ item_id: '10', name: 'N1', quantity: 0, item_total: 0, document_id: 'b0' }]
  const retLines = [
    { item_id: '10', name: 'N1', quantity: 1, item_total: 4.5, document_id: 'v1' },
  ]
  const r1 = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: null }),
    orgEnvHint: () => 'ZOHO_ORGANIZATION_ID',
  })
  const r2 = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      { sku: 'S1', name: 'N1', item_id: '10', status: 'active', stock_on_hand: 5, purchase_rate: 99 },
    ],
  })
  const r3 = mockModule('../src/integrations/zoho/weeklyReportZohoTransactions', {
    getSales: async () => ({ lines: salesLines, line_count: salesLines.length, list_truncated: false, error: null }),
    getPurchases: async (from, to, vendorId) => {
      assert.equal(String(vendorId), VENDOR)
      return { lines: purchLines, line_count: purchLines.length, list_truncated: false, error: null }
    },
    getVendorCredits: async (from, to, vendorId) => {
      assert.equal(String(vendorId), VENDOR)
      return { lines: retLines, line_count: retLines.length, list_truncated: false, error: null }
    },
  })
  t.after(() => {
    r1()
    r2()
    r3()
    if (prevN === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevN
    if (prevR === undefined) delete process.env.REPORT_VENDOR_ID
    else process.env.REPORT_VENDOR_ID = prevR
    if (prevJ === undefined) delete process.env.WEEKLY_REPORT_VENDORS_JSON
    else process.env.WEEKLY_REPORT_VENDORS_JSON = prevJ
    if (prevC === undefined) delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
    else process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID = prevC
    const resolved = require.resolve('../src/services/weeklyReportZohoData', { paths: [__dirname] })
    delete require.cache[resolved]
  })
  const m = freshRequire('../src/services/weeklyReportZohoData')
  const { items } = await m.fetchZohoItemRowsForGroupMembers(
    [{ sku: 'S1' }],
    '2026-01-01',
    '2026-01-31',
    null,
    'slow_moving'
  )
  assert.equal(items.length, 1)
  const row = items[0]
  // qO = 5 - 0 + 1 + 1 = 7 qty; unit = purchase_rate 99; returns = 1 × 99 (not VC line 4.5)
  assert.equal(row.opening_stock, 693)
  assert.equal(row.closing_stock, 495)
  assert.equal(row.returned_to_wholesale, 99)
  const totals = sumReportGrandTotals(items)
  assert.equal(totals.opening_stock, 693)
  assert.equal(totals.closing_stock, 495)
  assert.equal(totals.returned_to_wholesale, 99)
})

test('fetchZohoItemRowsForGroupMembers: implied unit from sales when Zoho has no item rate or purchase_rate', async (t) => {
  const prevN = process.env.NODE_ENV
  const prevR = process.env.REPORT_VENDOR_ID
  const prevJ = process.env.WEEKLY_REPORT_VENDORS_JSON
  const prevC = process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  process.env.NODE_ENV = 'test'
  process.env.REPORT_VENDOR_ID = VENDOR
  delete process.env.WEEKLY_REPORT_VENDORS_JSON
  delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  const salesLines = [
    { item_id: '10', name: 'N1', quantity: 2, item_total: 13300.63, document_id: 'i1' },
  ]
  const r1 = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: null }),
    orgEnvHint: () => 'ZOHO_ORGANIZATION_ID',
  })
  const r2 = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      {
        sku: 'S1',
        name: 'N1',
        item_id: '10',
        status: 'active',
        stock_on_hand: 3,
        // no rate, no purchase_rate -> implied 13300.63 / 2
      },
    ],
  })
  const r3 = mockModule('../src/integrations/zoho/weeklyReportZohoTransactions', {
    getSales: async () => ({ lines: salesLines, line_count: salesLines.length, list_truncated: false, error: null }),
    getPurchases: async () => ({ lines: [], line_count: 0, list_truncated: false, error: null }),
    getVendorCredits: async () => ({ lines: [], line_count: 0, list_truncated: false, error: null }),
  })
  t.after(() => {
    r1()
    r2()
    r3()
    if (prevN === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevN
    if (prevR === undefined) delete process.env.REPORT_VENDOR_ID
    else process.env.REPORT_VENDOR_ID = prevR
    if (prevJ === undefined) delete process.env.WEEKLY_REPORT_VENDORS_JSON
    else process.env.WEEKLY_REPORT_VENDORS_JSON = prevJ
    if (prevC === undefined) delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
    else process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID = prevC
    const resolved = require.resolve('../src/services/weeklyReportZohoData', { paths: [__dirname] })
    delete require.cache[resolved]
  })
  const m = freshRequire('../src/services/weeklyReportZohoData')
  const { items } = await m.fetchZohoItemRowsForGroupMembers(
    [{ sku: 'S1' }],
    '2026-01-01',
    '2026-01-31',
    null,
    'slow_moving'
  )
  const row = items[0]
  const unit = 13300.63 / 2
  assert.equal(row.sales_amount, 13300.63)
  assert.equal(row.closing_stock, 3 * unit)
  // qO = 3 - 0 + 2 + 0 = 5
  assert.equal(row.opening_stock, 5 * unit)
  assert.notEqual(row.opening_stock, null)
  assert.notEqual(row.closing_stock, null)
})

test('fetchZohoItemRowsForGroupMembers: other_family adds Zoho families not in item_report_groups with label', async (t) => {
  const prevN = process.env.NODE_ENV
  const prevR = process.env.REPORT_VENDOR_ID
  const prevJ = process.env.WEEKLY_REPORT_VENDORS_JSON
  const prevC = process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  process.env.NODE_ENV = 'test'
  process.env.REPORT_VENDOR_ID = VENDOR
  delete process.env.WEEKLY_REPORT_VENDORS_JSON
  delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  const salesLines = [
    { item_id: '1', name: 'A', quantity: 0, item_total: 0, document_id: 'i0' },
    { item_id: '2', name: 'B', quantity: 0, item_total: 0, document_id: 'i0' },
  ]
  const noLines = []
  const r1 = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: 'cf1' }),
    orgEnvHint: () => 'ZOHO_ORGANIZATION_ID',
  })
  const r2 = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      {
        sku: 'S1',
        name: 'A',
        item_id: '1',
        status: 'active',
        stock_on_hand: 3,
        rate: 1,
        custom_fields: [{ customfield_id: 'cf1', value: 'MappedFam', label: 'Family' }],
      },
      {
        sku: 'S2',
        name: 'B',
        item_id: '2',
        status: 'active',
        stock_on_hand: 2,
        rate: 1,
        custom_fields: [{ customfield_id: 'cf1', value: 'OrphanFam', label: 'Family' }],
      },
    ],
  })
  const r3 = mockModule('../src/integrations/zoho/weeklyReportZohoTransactions', {
    getSales: async () => ({ lines: salesLines, line_count: salesLines.length, list_truncated: false, error: null }),
    getPurchases: async () => ({ lines: noLines, line_count: 0, list_truncated: false, error: null }),
    getVendorCredits: async () => ({ lines: noLines, line_count: 0, list_truncated: false, error: null }),
  })
  const r4 = mockModule('../src/services/itemReportGroupsService', {
    listAllActiveMemberRows: async () => [
      { id: 1, sku: '', item_id: '', item_name: 'mappedfam', report_group: 'other_family', active: true, notes: '' },
    ],
  })
  t.after(() => {
    r1()
    r2()
    r3()
    r4()
    if (prevN === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevN
    if (prevR === undefined) delete process.env.REPORT_VENDOR_ID
    else process.env.REPORT_VENDOR_ID = prevR
    if (prevJ === undefined) delete process.env.WEEKLY_REPORT_VENDORS_JSON
    else process.env.WEEKLY_REPORT_VENDORS_JSON = prevJ
    if (prevC === undefined) delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
    else process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID = prevC
    const resolved = require.resolve('../src/services/weeklyReportZohoData', { paths: [__dirname] })
    delete require.cache[resolved]
  })
  const m = freshRequire('../src/services/weeklyReportZohoData')
  const { items } = await m.fetchZohoItemRowsForGroupMembers(
    [{ item_name: 'mappedfam' }],
    '2026-01-01',
    '2026-01-31',
    null,
    'other_family'
  )
  const names = items.map((r) => r.family).sort()
  assert.equal(items.length, 2)
  assert.ok(names.includes('MappedFam'), 'DB-mapped family appears as its Zoho name')
  assert.ok(
    names.some((n) => n === 'OrphanFam (not found in groups)'),
    'Zoho-only family includes suffix from NOT_FOUND_IN_GROUPS'
  )
})

test('fetchZohoItemRowsForGroupMembers: other_family skips unmapped if family is only in another report group (e.g. slow_moving)', async (t) => {
  const prevN = process.env.NODE_ENV
  const prevR = process.env.REPORT_VENDOR_ID
  const prevJ = process.env.WEEKLY_REPORT_VENDORS_JSON
  const prevC = process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  process.env.NODE_ENV = 'test'
  process.env.REPORT_VENDOR_ID = VENDOR
  delete process.env.WEEKLY_REPORT_VENDORS_JSON
  delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  const salesLines = [
    { item_id: '1', name: 'A', quantity: 0, item_total: 0, document_id: 'i0' },
    { item_id: '2', name: 'B', quantity: 0, item_total: 0, document_id: 'i0' },
    { item_id: '3', name: 'C', quantity: 0, item_total: 0, document_id: 'i0' },
  ]
  const noLines = []
  const r1 = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: 'cf1' }),
    orgEnvHint: () => 'ZOHO_ORGANIZATION_ID',
  })
  const r2 = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      {
        sku: 'S1',
        name: 'A',
        item_id: '1',
        status: 'active',
        stock_on_hand: 1,
        rate: 1,
        custom_fields: [{ customfield_id: 'cf1', value: 'InOther', label: 'Family' }],
      },
      {
        sku: 'S2',
        name: 'B',
        item_id: '2',
        status: 'active',
        stock_on_hand: 1,
        rate: 1,
        custom_fields: [{ customfield_id: 'cf1', value: 'InSlow', label: 'Family' }],
      },
      {
        sku: 'S3',
        name: 'C',
        item_id: '3',
        status: 'active',
        stock_on_hand: 1,
        rate: 1,
        custom_fields: [{ customfield_id: 'cf1', value: 'ZohoOnly', label: 'Family' }],
      },
    ],
  })
  const r3 = mockModule('../src/integrations/zoho/weeklyReportZohoTransactions', {
    getSales: async () => ({ lines: salesLines, line_count: salesLines.length, list_truncated: false, error: null }),
    getPurchases: async () => ({ lines: noLines, line_count: 0, list_truncated: false, error: null }),
    getVendorCredits: async () => ({ lines: noLines, line_count: 0, list_truncated: false, error: null }),
  })
  const r4 = mockModule('../src/services/itemReportGroupsService', {
    listAllActiveMemberRows: async () => [
      { id: 1, sku: '', item_id: '', item_name: 'inother', report_group: 'other_family', active: true, notes: '' },
      { id: 2, sku: '', item_id: '', item_name: 'inslow', report_group: 'slow_moving', active: true, notes: '' },
    ],
  })
  t.after(() => {
    r1()
    r2()
    r3()
    r4()
    if (prevN === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevN
    if (prevR === undefined) delete process.env.REPORT_VENDOR_ID
    else process.env.REPORT_VENDOR_ID = prevR
    if (prevJ === undefined) delete process.env.WEEKLY_REPORT_VENDORS_JSON
    else process.env.WEEKLY_REPORT_VENDORS_JSON = prevJ
    if (prevC === undefined) delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
    else process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID = prevC
    const resolved = require.resolve('../src/services/weeklyReportZohoData', { paths: [__dirname] })
    delete require.cache[resolved]
  })
  const m = freshRequire('../src/services/weeklyReportZohoData')
  const { items } = await m.fetchZohoItemRowsForGroupMembers(
    [{ item_name: 'inother' }],
    '2026-01-01',
    '2026-01-31',
    null,
    'other_family'
  )
  const names = items.map((r) => r.family)
  assert.equal(items.length, 2, 'InOther + ZohoOnly; InSlow is claimed by slow_moving and must not appear as unmapped')
  assert.ok(names.includes('InOther'))
  assert.ok(names.includes('ZohoOnly (not found in groups)'))
  assert.ok(!names.some((n) => n.includes('InSlow') && n.includes('not found in groups')), 'InSlow in slow_moving must not be labeled (not found in groups)')
})

test('aggregateByFamily: zoho_representative_item_id prefers first item with has_image in family', () => {
  const rows = [
    { family: 'Fam1', item_id: '10', sales_amount: 0, _zoho: { has_image: false } },
    { family: 'Fam1', item_id: '20', sales_amount: 1, _zoho: { has_image: true } },
  ]
  const [one] = aggregateByFamily(rows)
  assert.equal(one.zoho_representative_item_id, '20')
})

test('aggregateByFamily: zoho_representative_item_id falls back to first item_id', () => {
  const rows = [
    { family: 'F', item_id: '99', sales_amount: 0, _zoho: { has_image: false } },
  ]
  const [one] = aggregateByFamily(rows)
  assert.equal(one.zoho_representative_item_id, '99')
})

test('aggregateByFamily: thumbnail prefers stock pot / casserole over frying pan when both have images', () => {
  const rows = [
    { family: 'F', item_id: '1', item_name: 'Frying pan set 3pcs', sales_amount: 0, _zoho: { has_image: true } },
    { family: 'F', item_id: '2', item_name: 'Stock pot set 4pcs', sales_amount: 1, _zoho: { has_image: true } },
  ]
  const [one] = aggregateByFamily(rows)
  assert.equal(one.zoho_representative_item_id, '2')
})

test('aggregateByFamily: LIFEP7S SKU in item row preferred over LIFEP7 fry-style name in same family', () => {
  const rows = [
    { family: 'F', item_id: '1', sku: 'LIFEP7', item_name: 'Frying pan 3pcs', sales_amount: 0, _zoho: { has_image: true } },
    { family: 'F', item_id: '2', sku: 'LIFEP7S', item_name: 'Cookware set 5', sales_amount: 0, _zoho: { has_image: true } },
  ]
  const [one] = aggregateByFamily(rows)
  assert.equal(one.zoho_representative_item_id, '2')
})

test('aggregateByFamily: Zoho Family LIFEP7S (not SKU) + barcodes picks non-fry line for thumb', () => {
  const rows = [
    { family: 'LIFEP7S', item_id: '1', sku: 'Z-100', item_name: 'Frying pan 3pcs', sales_amount: 0, _zoho: { has_image: true } },
    { family: 'LIFEP7S', item_id: '2', sku: 'Z-200', item_name: 'Saucepan 2pc', sales_amount: 0, _zoho: { has_image: true } },
  ]
  const [one] = aggregateByFamily(rows)
  assert.equal(one.zoho_representative_item_id, '2')
})

test('aggregateByFamily: Zoho Family LIFEP7 + barcodes picks stock pot line for thumb', () => {
  const rows = [
    { family: 'LIFEP7', item_id: '1', sku: 'A-1', item_name: 'Fry pan 2', sales_amount: 0, _zoho: { has_image: true } },
    { family: 'LIFEP7', item_id: '2', sku: 'A-2', item_name: 'Stock pot 6L', sales_amount: 0, _zoho: { has_image: true } },
  ]
  const [one] = aggregateByFamily(rows)
  assert.equal(one.zoho_representative_item_id, '2')
})

test('aggregateByFamily: thumbnail with only frying-style items keeps first (same score)', () => {
  const rows = [
    { family: 'F', item_id: '1', item_name: 'Frying pan 28', sales_amount: 0, _zoho: { has_image: true } },
    { family: 'F', item_id: '2', item_name: 'Skillet 20cm', sales_amount: 0, _zoho: { has_image: true } },
  ]
  const [one] = aggregateByFamily(rows)
  assert.equal(one.zoho_representative_item_id, '1')
})

test('aggregateByFamily: LIFEP7 + FRY in every SKU: tie-break picks text with stock/soup over pure fry', () => {
  const rows = [
    { family: 'LIFEP7', item_id: 'a', sku: 'X-FRY-1', item_name: 'Fry pan 2pc', sales_amount: 0, _zoho: { has_image: true } },
    { family: 'LIFEP7', item_id: 'b', sku: 'X-FRY-2', item_name: 'Stock pot 5L + glass lid', sales_amount: 0, _zoho: { has_image: true } },
  ]
  const [one] = aggregateByFamily(rows)
  assert.equal(one.zoho_representative_item_id, 'b')
})

test('aggregateByFamily: LIFEP7 + soup pot in item_name wins over fry (soup image score first)', () => {
  const rows = [
    { family: 'LIFEP7', item_id: '1', sku: 'Z-1', item_name: '2pc fry pan black', sales_amount: 0, _zoho: { has_image: true } },
    { family: 'LIFEP7', item_id: '2', sku: 'Z-2', item_name: 'Soup pot 6L with glass lid', sales_amount: 0, _zoho: { has_image: true } },
  ]
  const [one] = aggregateByFamily(rows)
  assert.equal(one.zoho_representative_item_id, '2')
})

test('aggregateByFamily: LIFEP17-40-BLUE (soup pot variant) preferred over FP fry SKU in same family', () => {
  const rows = [
    { family: 'LIFEP17', item_id: '1', sku: 'LIFEP17-FP-1', item_name: 'Fry 2', sales_amount: 0, _zoho: { has_image: true } },
    { family: 'LIFEP17', item_id: '2', sku: 'LIFEP17-40-BLUE', item_name: 'Stock', sales_amount: 0, _zoho: { has_image: true } },
  ]
  const [one] = aggregateByFamily(rows)
  assert.equal(one.zoho_representative_item_id, '2')
})

test('aggregateByFamily: Zoho soup SKU in same Family (not in report rows) still wins over fry line', () => {
  const rows = [
    { family: 'LIFEP17', item_id: '1', sku: 'LIFEP17-FP-1', item_name: 'Fry 2', sales_amount: 0, _zoho: { has_image: true } },
  ]
  const byFamily = new Map([
    [
      'lifep17',
      [
        {
          item_id: '2',
          sku: 'LIFEP17-40-BLUE',
          name: 'Stock pot 40',
          image_document_id: 'zimg2',
          status: 'active',
          cf_family: 'LIFEP17',
        },
      ],
    ],
  ])
  const [one] = aggregateByFamily(rows, {
    byFamily,
    familyFieldId: null,
    fromDate: '2026-01-01',
    toDate: '2026-01-31',
  })
  assert.equal(one.zoho_representative_item_id, '2')
})

test('aggregateByFamily: picks largest single soup pot over sauce and smaller sizes', () => {
  const rows = [
    {
      family: 'LIFEP7S',
      item_id: 'A',
      sku: 'LIFEP7S-24P-GREEN',
      item_name: 'Soup Pot 24 cm',
      sales_amount: 0,
      _zoho: { has_image: true, is_active: true },
    },
    {
      family: 'LIFEP7S',
      item_id: 'B',
      sku: 'LIFEP7S-40P-BLACK',
      item_name: 'Soup Pot 40 cm',
      sales_amount: 0,
      _zoho: { has_image: true, is_active: true },
    },
    {
      family: 'LIFEP7S',
      item_id: 'C',
      sku: 'LIFEP7SSAU16-GREEN',
      item_name: 'Sauce Pot 16 cm',
      sales_amount: 0,
      _zoho: { has_image: true, is_active: true },
    },
  ]
  const [one] = aggregateByFamily(rows)
  assert.equal(one.zoho_representative_item_id, 'B')
  assert.equal(String(one.zoho_representative_sku || ''), 'LIFEP7S-40P-BLACK')
})

test('aggregateByFamily: LIFEP soup SKUs pick largest numeric size even without cm token', () => {
  const rows = [
    { family: 'LIFEP7S', item_id: '24', sku: '6294021002608', item_name: 'LIFEP7S-24P-GREEN', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
    { family: 'LIFEP7S', item_id: '40', sku: '6294021002721', item_name: 'LIFEP7S-40P-GREEN', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
  ]
  const [one] = aggregateByFamily(rows)
  assert.equal(one.zoho_representative_item_id, '40')
  assert.equal(String(one.zoho_representative_sku || ''), '6294021002721')
})


test('aggregateByFamily: falls back to cookware set when no soup pot exists', () => {
  const rows = [
    { family: 'F', item_id: 'SET', sku: 'COOK-10PCS', item_name: 'Cookware set 10pcs', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
    { family: 'F', item_id: 'SAU', sku: 'SAU-16', item_name: 'Sauce pan 16', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
    { family: 'F', item_id: 'FRY', sku: 'FRY-28', item_name: 'Frying pan 28', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
  ]
  const [one] = aggregateByFamily(rows)
  assert.equal(one.zoho_representative_item_id, 'SET')
})

test('aggregateByFamily: families with unrelated subtypes fall back deterministically', () => {
  const rows = [
    { family: 'R Trolley', item_id: '2', sku: 'TROLLEY-B', item_name: 'R Trolley Black', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
    { family: 'R Trolley', item_id: '1', sku: 'TROLLEY-A', item_name: 'R Trolley Silver', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
  ]
  const [one] = aggregateByFamily(rows)
  assert.equal(one.zoho_representative_item_id, '1')
})

// ----- <size>P suffix = single soup pot -----

test('aggregateByFamily: <size>P suffix items (SPF-16P, STA-24P) are classified as primary_pot', () => {
  // SPF family: mix of <size>P pots, plain items, and a frying set
  const rows = [
    { family: 'SPF', item_id: 'FSET', sku: 'SPF2FSET-GRAY', item_name: 'SPF2FSET-GRAY', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
    { family: 'SPF', item_id: 'P16', sku: 'SPF-16P-GRAY', item_name: 'SPF-16P-GRAY', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
    { family: 'SPF', item_id: 'P24', sku: 'SPF-24P-GREEN', item_name: 'SPF-24P-GREEN', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
  ]
  const [one] = aggregateByFamily(rows)
  // 24P beats 16P (larger size); both beat the non-P frying set
  assert.equal(one.zoho_representative_item_id, 'P24')
  assert.equal(String(one.zoho_representative_sku || ''), 'SPF-24P-GREEN')
})

test('aggregateByFamily: SPHM-S <size>P pot beats sauce pan (SAU)', () => {
  const rows = [
    { family: 'SPHM-S', item_id: 'SAU', sku: 'SPHM-S-SAU-16-BLACK', item_name: 'SPHM-S-SAU-16-BLACK', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
    { family: 'SPHM-S', item_id: 'P16', sku: 'SPHM-S-16P-BEIGE', item_name: 'SPHM-S-16P-BEIGE', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
    { family: 'SPHM-S', item_id: 'P28', sku: 'SPHM-S-28P-BLACK', item_name: 'SPHM-S-28P-BLACK', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
  ]
  const [one] = aggregateByFamily(rows)
  // Largest pot (28P) must win over the sauce pan
  assert.equal(one.zoho_representative_item_id, 'P28')
})

test('aggregateByFamily: STA <size>P pot beats inactive cookware set', () => {
  const rows = [
    { family: 'STA', item_id: 'CSET', sku: 'COOKWARE SET', item_name: 'STA-6-3-PEACH', sales_amount: 0, _zoho: { has_image: true, is_active: false } },
    { family: 'STA', item_id: 'P20', sku: 'STA-20P-LIGHTGRAY', item_name: 'STA-20P-LIGHTGRAY', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
    { family: 'STA', item_id: 'P28', sku: 'STA-28P-DARKGRAY', item_name: 'STA-28P-DARKGRAY', sales_amount: 0, _zoho: { has_image: true, is_active: true } },
  ]
  const [one] = aggregateByFamily(rows)
  // Largest pot (28P) must win; the cookware set is inactive and lower priority anyway
  assert.equal(one.zoho_representative_item_id, 'P28')
})
