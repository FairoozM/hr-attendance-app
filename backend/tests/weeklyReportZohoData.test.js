const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire } = require('./_helpers')
const { sumReportGrandTotals } = require('../src/utils/weeklyReportTotals')
const { buildZohoLookupMaps, findZohoItemForMember } = require('../src/services/weeklyReportZohoData')._internals

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

test('fetchZohoItemRowsForGroupMembers: TEMP opening = closing, debug + totals = sumReportGrandTotals (Phase 4)', async (t) => {
  const prevN = process.env.NODE_ENV
  const prevR = process.env.REPORT_VENDOR_ID
  const prevJ = process.env.WEEKLY_REPORT_VENDORS_JSON
  const prevC = process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  process.env.NODE_ENV = 'test'
  process.env.REPORT_VENDOR_ID = VENDOR
  delete process.env.WEEKLY_REPORT_VENDORS_JSON
  delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  const salesLines = [
    { item_id: '10', name: 'N1', quantity: 3, document_id: 'i1' },
  ]
  const purchLines = [{ item_id: '10', name: 'N1', quantity: 2, document_id: 'b1' }]
  const retLines = [{ item_id: '10', name: 'N1', quantity: 1, document_id: 'v1' }]
  const r1 = mockModule('../src/integrations/zoho/zohoConfig', {
    readZohoConfig: () => ({ code: 'ok', familyCustomFieldId: null }),
    orgEnvHint: () => 'ZOHO_ORGANIZATION_ID',
  })
  const r2 = mockModule('../src/integrations/zoho/zohoAdapter', {
    fetchAllItemsRaw: async () => [
      { sku: 'S1', name: 'N1', item_id: '10', status: 'active', stock_on_hand: 7 },
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
  assert.equal(row.opening_stock, 7)
  assert.equal(row.closing_stock, 7)
  assert.equal(row.sold, 3)
  assert.equal(row.purchases, 2)
  assert.equal(row.returned_to_wholesale, 1)
  const td = reportMeta.transaction_debug
  assert.equal(td.sales_source_count, 1)
  assert.equal(td.purchases_source_count, 1)
  assert.equal(td.credits_source_count, 1)
  assert.equal(td.opening_stock_is_temporary_fallback, true)
  const totals = sumReportGrandTotals(items)
  assert.equal(totals.sold, 3)
  assert.equal(totals.purchases, 2)
  assert.equal(totals.returned_to_wholesale, 1)
  assert.equal(totals.opening_stock, 7)
  assert.equal(totals.closing_stock, 7)
})
