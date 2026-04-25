const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire } = require('./_helpers')
const { sumReportGrandTotals } = require('../src/utils/weeklyReportTotals')
const { buildZohoLookupMaps, findZohoItemForMember, aggregateByFamily } = require(
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
  // qO = 7 - 2 + 3 + 1 = 9 → opening value 9×1; closing 7×1; purchase $ = qty 2 × item rate 1; returns use VC line total 5
  assert.equal(row.opening_stock, 9)
  assert.equal(row.closing_stock, 7)
  assert.equal(row.sales_amount, 30)
  assert.equal(row.purchase_amount, 2)
  assert.equal(row.returned_to_wholesale, 5)
  const td = reportMeta.transaction_debug
  assert.equal(td.sales_source_count, 1)
  assert.equal(td.purchases_source_count, 1)
  assert.equal(td.credits_source_count, 1)
  assert.equal(td.opening_stock_derived, true)
  const totals = sumReportGrandTotals(items)
  assert.equal(totals.sales_amount, 30)
  assert.equal(totals.purchase_amount, 2)
  assert.equal(totals.returned_to_wholesale, 5)
  assert.equal(totals.opening_stock, 9)
  assert.equal(totals.closing_stock, 7)
})

test('fetchZohoItemRowsForGroupMembers: purchase_rate used when selling rate absent; VC line amount for returns', async (t) => {
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
  // qO = 5 - 0 + 1 + 1 = 7 qty; unit = purchase_rate 99
  assert.equal(row.opening_stock, 693)
  assert.equal(row.closing_stock, 495)
  assert.equal(row.returned_to_wholesale, 4.5)
  const totals = sumReportGrandTotals(items)
  assert.equal(totals.opening_stock, 693)
  assert.equal(totals.closing_stock, 495)
  assert.equal(totals.returned_to_wholesale, 4.5)
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
