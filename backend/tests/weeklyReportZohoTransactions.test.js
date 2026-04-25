/**
 * @file Zoho transaction helpers — vendor filter and adapter contracts
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { mockModule, freshRequire } = require('./_helpers')
const {
  _internals: {
    matchesReportVendor,
    itemTotalNetFromSalesByItemRow,
    resolveWeeklyReportSalesVatRate,
    matchesVendorCreditDocument,
    normalizeVendorCreditLineItem,
  },
} = require('../src/integrations/zoho/weeklyReportZohoTransactions')

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

test('matchesVendorCreditDocument: contact_id matches configured vendor (contact) id', () => {
  const id = '5012000000000999'
  assert.equal(
    matchesVendorCreditDocument(
      { vendor_id: 'x', contact_id: id, customer_id: 'y' },
      id,
      undefined,
    ),
    true,
  )
  assert.equal(
    matchesVendorCreditDocument(
      { vendor_id: 'x', vendor_contact_id: id, customer_id: 'y' },
      id,
      undefined,
    ),
    true,
  )
})

test('normalizeVendorCreditLineItem: reads sku from nested line.item', () => {
  const n = normalizeVendorCreditLineItem({
    quantity: 2,
    item: { item_id: 'A1', sku: 'NESTED-SK', name: 'Nested name' },
  })
  assert.equal(n.sku, 'NESTED-SK')
  assert.equal(n.item_id, 'A1')
  assert.equal(n.quantity, 2)
  assert.equal(n.name, 'Nested name')
})

test('getPurchases: uses Bill line items (unfiltered; mocked fetchAllBillsRaw)', async () => {
  clearZohoTransactionModules()
  mockModule('../src/integrations/zoho/zohoTransactionsCache', {
    fetchAllBillsRaw: async () => [
      {
        bill_id: 'b1',
        date: '2026-01-15',
        status: 'open',
        vendor_id: 'v1',
        line_items: [{ item_id: '1', name: 'I', quantity: 5, item: { sku: 'SK' } }],
      },
      {
        bill_id: 'b2',
        date: '2026-01-20',
        status: 'open',
        vendor_id: 'v2',
        line_items: [{ item_id: '1', name: 'I', quantity: 9, item: { sku: 'SK' } }],
      },
    ],
    fetchAllVendorCreditsRaw: async () => [],
    clearBillsCache: () => {},
    clearVendorCreditsCache: () => {},
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m.getPurchases('2026-01-01', '2026-01-31', VENDOR, {})
  // Both bill lines for item 1 (all vendors in default unfiltered mode).
  assert.equal(r.line_count, 2)
  assert.equal(r.document_count, 2)
  assert.equal(r.lines.reduce((s, l) => s + l.quantity, 0), 14)
  assert.equal(r.lines[0].type, 'bill')
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
  const prevV = process.env.WEEKLY_REPORT_SALES_VAT_RATE
  process.env.WEEKLY_REPORT_SALES_VAT_RATE = '0.15'
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
  // amount from Zoho as-is (pre-tax; no +VAT in code)
  assert.equal(r.lines[0].item_total, 1)
  assert.equal(r.lines[1].item_total, 4)
  if (prevV === undefined) delete process.env.WEEKLY_REPORT_SALES_VAT_RATE
  else process.env.WEEKLY_REPORT_SALES_VAT_RATE = prevV
})

test('itemTotalNetFromSalesByItemRow: ignores tax and gross; uses pre-tax amount', () => {
  assert.equal(itemTotalNetFromSalesByItemRow({ amount: 100, item_tax: 5 }), 100, 'no line tax added')
  assert.equal(itemTotalNetFromSalesByItemRow({ amount: 10, gross_amount: 12.5 }), 10, 'amount over gross_inclusive')
  const prevV = process.env.WEEKLY_REPORT_SALES_VAT_RATE
  process.env.WEEKLY_REPORT_SALES_VAT_RATE = '0'
  assert.equal(resolveWeeklyReportSalesVatRate(), 0)
  assert.equal(itemTotalNetFromSalesByItemRow({ amount: 200 }), 200, 'no env VAT multiplier on amount')
  if (prevV === undefined) delete process.env.WEEKLY_REPORT_SALES_VAT_RATE
  else process.env.WEEKLY_REPORT_SALES_VAT_RATE = prevV
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
