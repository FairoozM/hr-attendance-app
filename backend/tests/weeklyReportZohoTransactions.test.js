/**
 * @file Zoho transaction helpers — vendor filter and adapter contracts
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { mockModule, freshRequire } = require('./_helpers')
const { _internals: { matchesReportVendor } } = require('../src/integrations/zoho/weeklyReportZohoTransactions')

function clearZohoTransactionModules() {
  for (const f of [
    path.join(__dirname, '../src/integrations/zoho/weeklyReportZohoTransactions.js'),
    path.join(__dirname, '../src/integrations/zoho/zohoInventoryClient.js'),
    path.join(__dirname, '../src/integrations/zoho/zohoTransactionsCache.js'),
  ]) {
    try {
      const p = require.resolve(f)
      delete require.cache[p]
    } catch {
      // ignore
    }
  }
}

const VENDOR = '4265011000000080014'

test('matchesReportVendor: purchase/credit line only for REPORT_VENDOR_ID', () => {
  assert.equal(matchesReportVendor(VENDOR, VENDOR, 'Any', 'Any'), true)
  assert.equal(matchesReportVendor('999', VENDOR, 'Any', 'Any'), false)
  // Zoho may return vendor_id as a string; JS number loses precision for this id
  assert.equal(matchesReportVendor(String(VENDOR), VENDOR, 'Any', 'Any'), true)
})

test('matchesReportVendor: name when vendor id is empty', () => {
  assert.equal(matchesReportVendor(undefined, '', 'Acme Ltd', 'acme ltd'), true)
  assert.equal(matchesReportVendor(undefined, '', 'Other', 'acme ltd'), false)
})

test('getPurchases: uses Purchases by Item report (all vendors; mocked purchasesbyitem)', async () => {
  clearZohoTransactionModules()
  mockModule('../src/integrations/zoho/zohoInventoryClient', {
    zohoApiRequest: async (p) => {
      if (String(p).includes('purchasesbyitem')) {
        return {
          code: 0,
          page_context: { has_more_page: false },
          purchases_by_item: [
            { purchase: [{ item_id: '1', item_name: 'I', quantity_purchased: 5, amount: 10, item: { sku: 'SK' } }] },
            { purchase: [{ item_id: '1', item_name: 'I', quantity_purchased: 9, item: { sku: 'SK' } }] },
          ],
        }
      }
      throw new Error('unexpected zoho path in getPurchases test: ' + p)
    },
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m.getPurchases('2026-01-01', '2026-01-31', VENDOR, {})
  // Both purchase rows for item 1 are included (purchases are not vendor-sliced in this path).
  assert.equal(r.line_count, 2)
  assert.equal(r.lines.reduce((s, l) => s + l.quantity, 0), 14)
})

test('getVendorCredits: only credits for vendor 4265011000000080014 (mocked list)', async () => {
  clearZohoTransactionModules()
  mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async () => ({
      rows: [
        { vendor_credit_id: 'c1', date: '2026-01-03', status: 'open', vendor_id: VENDOR, line_items: [{ item_id: '1', name: 'I', quantity: 2 }] },
        { vendor_credit_id: 'c2', date: '2026-01-03', status: 'open', vendor_id: 'x', line_items: [{ item_id: '1', name: 'I', quantity: 3 }] },
      ],
      truncated: false,
      pages: 1,
    }),
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m.getVendorCredits('2026-01-01', '2026-01-31', VENDOR, {})
  assert.equal(r.lines.length, 1)
  assert.equal(r.line_count, 1)
  assert.equal(r.lines[0].quantity, 2)
})

test('getVendorCredits: list without line_items fetches GET /vendorcredits/:id', async () => {
  clearZohoTransactionModules()
  mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async () => ({
      rows: [
        { vendor_credit_id: 'c1', date: '2026-01-03', status: 'open', vendor_id: VENDOR, vendor_name: 'V' },
      ],
      truncated: false,
      pages: 1,
    }),
    zohoApiRequest: async (p) => {
      if (String(p).includes('vendorcredits/c1') && !String(p).includes('vendorcredits/c1/')) {
        return {
          code: 0,
          vendor_credit: {
            vendor_credit_id: 'c1',
            line_items: [{ item_id: '99', name: 'I', quantity: 4, sku: 'S-KU' }],
          },
        }
      }
      throw new Error('unexpected zoho path ' + p)
    },
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m.getVendorCredits('2026-01-01', '2026-01-31', VENDOR, {})
  assert.equal(r.line_count, 1)
  assert.equal(r.lines[0].quantity, 4)
  assert.equal(r.lines[0].sku, 'S-KU')
})

test('getSales: Sales by Item report (mocked salesbyitem)', async () => {
  clearZohoTransactionModules()
  mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async () => ({
      rows: [
        { item_id: '1', item_name: 'A', quantity_sold: 1, amount: 1, item: { sku: 'A1' } },
        { item_id: '2', item_name: 'B', quantity_sold: 4, amount: 4, item: { sku: 'B1' } },
      ],
      truncated: false,
      pages: 1,
    }),
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m.getSales('2026-01-01', '2026-01-31', {})
  assert.equal(r.line_count, 2)
  assert.equal(r.lines.reduce((s, l) => s + l.quantity, 0), 5)
})

test('assertReportVendorResolvedIfRequired: throws when vendor missing and not optional', () => {
  const prevO = process.env.WEEKLY_REPORT_VENDOR_OPTIONAL
  const prevV = process.env.REPORT_VENDOR_ID
  const prevJ = process.env.WEEKLY_REPORT_VENDORS_JSON
  const prevC = process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  const prevN = process.env.REPORT_VENDOR_NAME
  delete process.env.WEEKLY_REPORT_VENDOR_OPTIONAL
  delete process.env.REPORT_VENDOR_ID
  delete process.env.WEEKLY_REPORT_VENDORS_JSON
  delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  delete process.env.REPORT_VENDOR_NAME
  const { assertReportVendorResolvedIfRequired } = require('../src/services/weeklyReportReportVendor')
  assert.throws(() => assertReportVendorResolvedIfRequired('g'), (e) => e.code === 'REPORT_VENDOR_NOT_CONFIGURED')
  if (prevO === undefined) delete process.env.WEEKLY_REPORT_VENDOR_OPTIONAL
  else process.env.WEEKLY_REPORT_VENDOR_OPTIONAL = prevO
  if (prevV === undefined) delete process.env.REPORT_VENDOR_ID
  else process.env.REPORT_VENDOR_ID = prevV
  if (prevJ === undefined) delete process.env.WEEKLY_REPORT_VENDORS_JSON
  else process.env.WEEKLY_REPORT_VENDORS_JSON = prevJ
  if (prevC === undefined) delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  else process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID = prevC
  if (prevN === undefined) delete process.env.REPORT_VENDOR_NAME
  else process.env.REPORT_VENDOR_NAME = prevN
})

test('assertReportVendorResolvedIfRequired: no throw when optional', () => {
  const prevO = process.env.WEEKLY_REPORT_VENDOR_OPTIONAL
  process.env.WEEKLY_REPORT_VENDOR_OPTIONAL = '1'
  delete process.env.REPORT_VENDOR_ID
  const { assertReportVendorResolvedIfRequired } = require('../src/services/weeklyReportReportVendor')
  assert.doesNotThrow(() => assertReportVendorResolvedIfRequired('g'))
  if (prevO === undefined) delete process.env.WEEKLY_REPORT_VENDOR_OPTIONAL
  else process.env.WEEKLY_REPORT_VENDOR_OPTIONAL = prevO
})
