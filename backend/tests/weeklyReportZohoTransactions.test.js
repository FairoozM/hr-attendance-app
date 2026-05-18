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
    makeWarehouseLineFilter,
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

test('makeWarehouseLineFilter: includes or excludes by line warehouse_id', () => {
  const normal = makeWarehouseLineFilter({ excludeWarehouseId: 'damaged' })
  assert.equal(normal({ warehouse_id: 'main' }, {}), true)
  assert.equal(normal({ warehouse_id: 'damaged' }, {}), false)
  assert.equal(normal({}, {}), false)

  const damagedOnly = makeWarehouseLineFilter({ warehouseId: 'damaged' })
  assert.equal(damagedOnly({ warehouse_id: 'damaged' }, {}), true)
  assert.equal(damagedOnly({ warehouse_id: 'main' }, {}), false)
})

test('makeWarehouseLineFilter: includes or excludes by Zoho location_id', () => {
  const normal = makeWarehouseLineFilter({ excludeWarehouseId: 'damaged' })
  assert.equal(normal({ location_id: 'main' }, {}), true)
  assert.equal(normal({ location: { location_id: 'damaged' } }, {}), false)
  assert.equal(normal({}, { location_id: 'main' }), true)

  const mainOnly = makeWarehouseLineFilter({ warehouseId: 'main' })
  assert.equal(mainOnly({ location_id: 'main' }, {}), true)
  assert.equal(mainOnly({ warehouse_id: 'damaged', location_id: 'main' }, {}), false)
  assert.equal(mainOnly({}, { location: { location_id: 'main' } }), true)
})

test('normalizeVendorCreditLineItem: exposes warehouse fields from Zoho location fields', () => {
  const n = normalizeVendorCreditLineItem({
    item_id: 'A1',
    name: 'Item',
    quantity: 2,
    location_id: 'loc-1',
    location_name: 'Riyadh Warehouse',
  })
  assert.equal(n.warehouse_id, 'loc-1')
  assert.equal(n.warehouse_name, 'Riyadh Warehouse')
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

test('getSales: invoice detail lines filtered by warehouse', async () => {
  const prevV = process.env.WEEKLY_REPORT_SALES_VAT_RATE
  process.env.WEEKLY_REPORT_SALES_VAT_RATE = '0.15'
  clearZohoTransactionModules()
  mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async (url, key) => {
      assert.ok(String(url).includes('/invoices'))
      assert.equal(key, 'invoices')
      return {
        rows: [
          { invoice_id: 'inv1', date: '2026-01-03', status: 'sent' },
        ],
        truncated: false,
        pages: 1,
      }
    },
    zohoApiRequest: async (p) => {
      assert.ok(String(p).includes('/invoices/inv1'))
      return {
        invoice: {
          invoice_id: 'inv1',
          date: '2026-01-03',
          status: 'sent',
          line_items: [
            { item_id: '1', name: 'A', sku: 'A1', quantity: 1, item_total: 10, warehouse_id: 'main' },
            { item_id: '2', name: 'B', sku: 'B1', quantity: 4, item_total: 40, warehouse_id: 'damaged' },
          ],
        },
      }
    },
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m.getSales('2026-01-01', '2026-01-31', { excludeWarehouseId: 'damaged' })
  assert.equal(r.line_count, 1)
  assert.equal(r.lines[0].quantity, 1)
  assert.equal(r.lines[0].item_total, 10)
  assert.equal(r.lines[0].warehouse_id, 'main')
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

test('itemTotalWithTaxFromSalesByItemRow: prefers inclusive fields then amount+tax', () => {
  const { itemTotalWithTaxFromSalesByItemRow } = require('../src/integrations/zoho/weeklyReportZohoTransactions')._internals
  assert.equal(itemTotalWithTaxFromSalesByItemRow({ amount_inclusive_of_tax: 115 }), 115)
  assert.equal(itemTotalWithTaxFromSalesByItemRow({ gross_amount: 99.5 }), 99.5)
  assert.equal(itemTotalWithTaxFromSalesByItemRow({ amount: 100, item_tax: 5 }), 105)
  assert.equal(itemTotalWithTaxFromSalesByItemRow({ amount: 100 }), 100)
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

test('getInventoryAdjustments: client-side date filter, void excluded, warehouse scope', async (t) => {
  clearZohoTransactionModules()
  const prevP = process.env.WEEKLY_REPORT_INVENTORY_ADJUSTMENT_MAX_PAGES
  delete process.env.WEEKLY_REPORT_INVENTORY_ADJUSTMENT_MAX_PAGES
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async (url, key) => {
      assert.ok(String(url).includes('/inventoryadjustments'))
      assert.equal(key, 'inventory_adjustments')
      return {
        rows: [
          {
            inventory_adjustment_id: 'adj1',
            date: '2026-01-05',
            status: 'adjusted',
            item_id: '10',
            sku: 'S1',
            name: 'N1',
            quantity_adjusted: 2,
            warehouse_id: 'main',
            warehouse_name: 'Main',
            adjustment_type: 'quantity',
          },
          {
            inventory_adjustment_id: 'adj2',
            date: '2026-02-01',
            status: 'adjusted',
            item_id: '11',
            quantity_adjusted: -1,
            warehouse_id: 'main',
          },
          {
            inventory_adjustment_id: 'adj3',
            date: '2026-01-10',
            status: 'void',
            item_id: '12',
            quantity_adjusted: 5,
            warehouse_id: 'main',
          },
          {
            inventory_adjustment_id: 'adj4',
            date: '2026-01-12',
            status: 'adjusted',
            item_id: '13',
            quantity_adjusted: 0,
            warehouse_id: 'damaged',
          },
        ],
        truncated: false,
        pages: 1,
      }
    },
  })
  t.after(() => {
    r1()
    clearZohoTransactionModules()
    if (prevP === undefined) delete process.env.WEEKLY_REPORT_INVENTORY_ADJUSTMENT_MAX_PAGES
    else process.env.WEEKLY_REPORT_INVENTORY_ADJUSTMENT_MAX_PAGES = prevP
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m.getInventoryAdjustments('2026-01-01', '2026-01-31', {
    excludeWarehouseId: 'damaged',
  })
  assert.equal(r.line_count, 1)
  assert.equal(r.document_count, 1)
  assert.equal(r.date_filter_mode, 'client_side')
  assert.equal(r.lines[0].document_id, 'adj1')
  assert.equal(r.lines[0].item_id, '10')
  assert.equal(r.lines[0].quantity_adjusted, 2)
  assert.equal(r.lines[0].warehouse_id, 'main')
  assert.equal(r.lines[0].adjustment_type, 'quantity')
  assert.equal(r.lines[0].status, 'adjusted')
})

test('getInventoryAdjustments: expands nested line_items on list row', async (t) => {
  clearZohoTransactionModules()
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async () => ({
      rows: [
        {
          inventory_adjustment_id: 'adj5',
          date: '2026-01-08',
          status: 'adjusted',
          adjustment_type: 'quantity',
          line_items: [
            { item_id: '20', sku: 'S2', name: 'N2', quantity_adjusted: -3, warehouse_id: 'main' },
            { item_id: '21', sku: 'S3', name: 'N3', quantity_adjusted: 1, warehouse_id: 'main' },
          ],
        },
      ],
      truncated: false,
      pages: 1,
    }),
  })
  t.after(() => {
    r1()
    clearZohoTransactionModules()
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m.getInventoryAdjustments('2026-01-01', '2026-01-31', {})
  assert.equal(r.line_count, 2)
  assert.equal(r.document_count, 1)
  assert.equal(r.lines[0].quantity_adjusted, -3)
  assert.equal(r.lines[1].quantity_adjusted, 1)
})

test('filterToDatedMovementLines: drops rows without document_date', () => {
  const { filterToDatedMovementLines } = require('../src/integrations/zoho/weeklyReportZohoTransactions')._internals
  const out = filterToDatedMovementLines([
    { document_date: '', quantity: 3, type: 'sales_by_item' },
    { document_date: '2026-01-15', quantity: 2, type: 'invoice' },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].quantity, 2)
})

test('getStockReconstruction: requireDatedSalesLines uses invoice detail not salesbyitem', async (t) => {
  clearZohoTransactionModules()
  let salesByItemCalled = false
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async (url, key) => {
      if (String(url).includes('/reports/salesbyitem')) {
        salesByItemCalled = true
        return { rows: [], truncated: false, pages: 0 }
      }
      if (String(url).includes('/invoices')) {
        return {
          rows: [{ invoice_id: 'inv1', date: '2026-01-15', status: 'sent' }],
          truncated: false,
          pages: 1,
        }
      }
      if (String(url).includes('/vendorcredits')) {
        return { rows: [], truncated: false, pages: 0 }
      }
      return { rows: [], truncated: false, pages: 0 }
    },
    zohoApiRequest: async (p) => {
      if (String(p).includes('/invoices/inv1')) {
        return {
          invoice: {
            invoice_id: 'inv1',
            date: '2026-01-15',
            line_items: [{ item_id: '10', name: 'N1', quantity: 4, rate: 10 }],
          },
        }
      }
      throw new Error('unexpected ' + p)
    },
  })
  const r2 = mockModule('../src/integrations/zoho/zohoTransactionsCache', {
    fetchAllBillsRaw: async () => [],
    fetchAllVendorCreditsRaw: async () => [],
    clearBillsCache: () => {},
    clearVendorCreditsCache: () => {},
  })
  t.after(() => {
    r1()
    r2()
    clearZohoTransactionModules()
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const bundle = await m.getStockReconstruction('2026-01-01', '2026-01-31', {
    requireDatedSalesLines: true,
  })
  assert.equal(salesByItemCalled, false)
  assert.equal(bundle.require_dated_sales_lines, true)
  assert.equal(bundle.salesR.source, 'zoho_inventory_invoices_for_reconstruction')
  assert.equal(bundle.salesR.dated_lines_for_reconstruction, true)
  assert.equal(bundle.salesR.line_count, 1)
  assert.equal(bundle.salesR.lines[0].document_date, '2026-01-15')
  assert.equal(bundle.salesR.lines[0].quantity, 4)
  assert.equal(bundle.salesR.lines[0].type, 'invoice')
})

test('invoiceListRowHasUsableLineItems: requires identifier and positive qty', () => {
  const { invoiceListRowHasUsableLineItems } =
    require('../src/integrations/zoho/weeklyReportZohoTransactions')._internals
  assert.equal(
    invoiceListRowHasUsableLineItems({
      line_items: [{ item_id: '10', name: 'N1', quantity: 2 }],
    }),
    true,
  )
  assert.equal(invoiceListRowHasUsableLineItems({ line_items: [] }), false)
  assert.equal(invoiceListRowHasUsableLineItems({ line_items: [{ quantity: 2 }] }), false)
  assert.equal(
    invoiceListRowHasUsableLineItems({
      line_items: [{ sku: 'S1', quantity: 0 }],
    }),
    false,
  )
})

test('getSalesFromInvoicesSlow: list line_items skips invoice detail fetch', async (t) => {
  clearZohoTransactionModules()
  let detailApiCalls = 0
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async () => ({
      rows: [
        {
          invoice_id: 'inv_list_1',
          date: '2026-01-15',
          status: 'sent',
          line_items: [{ item_id: '10', name: 'N1', sku: 'S1', quantity: 3, rate: 10 }],
        },
      ],
      truncated: false,
      pages: 1,
    }),
    zohoApiRequest: async (p) => {
      if (String(p).includes('/invoices/')) detailApiCalls += 1
      throw new Error('unexpected detail ' + p)
    },
  })
  t.after(() => {
    r1()
    clearZohoTransactionModules()
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m._internals.getSalesFromInvoicesSlow('2026-01-01', '2026-01-31')
  assert.equal(detailApiCalls, 0)
  assert.equal(r.invoice_list_with_usable_line_items, 1)
  assert.equal(r.invoice_detail_fetches, 0)
  assert.equal(r.invoice_detail_fetch_truncated, false)
  assert.equal(r.sales_reconstruction_partial, false)
  assert.equal(r.line_count, 1)
  assert.equal(r.lines[0].quantity, 3)
})

test('getSalesFromInvoicesSlow: missing list line_items uses detail fetch', async (t) => {
  clearZohoTransactionModules()
  let detailApiCalls = 0
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async () => ({
      rows: [{ invoice_id: 'inv_detail_1', date: '2026-01-15', status: 'sent' }],
      truncated: false,
      pages: 1,
    }),
    zohoApiRequest: async (p) => {
      if (String(p).includes('/invoices/inv_detail_1')) {
        detailApiCalls += 1
        return {
          invoice: {
            invoice_id: 'inv_detail_1',
            date: '2026-01-15',
            line_items: [{ item_id: '10', name: 'N1', quantity: 5, rate: 10 }],
          },
        }
      }
      throw new Error('unexpected ' + p)
    },
  })
  t.after(() => {
    r1()
    clearZohoTransactionModules()
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m._internals.getSalesFromInvoicesSlow('2026-01-01', '2026-01-31')
  assert.equal(detailApiCalls, 1)
  assert.equal(r.invoice_list_with_usable_line_items, 0)
  assert.equal(r.invoice_detail_fetches, 1)
  assert.equal(r.line_count, 1)
  assert.equal(r.lines[0].quantity, 5)
})

test('getSalesFromInvoicesSlow: sends sort_column=date sort_order=A by default and exposes metadata', async (t) => {
  clearZohoTransactionModules()
  let listParams = null
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async (_url, _key, _pages, extraParams) => {
      listParams = extraParams ? Object.fromEntries(extraParams.entries()) : {}
      return {
        rows: [
          { invoice_id: 'inv_a', date: '2026-04-01', status: 'sent', line_items: [{ item_id: '10', quantity: 1 }] },
          { invoice_id: 'inv_b', date: '2026-04-30', status: 'sent', line_items: [{ item_id: '10', quantity: 2 }] },
        ],
        truncated: false,
        pages: 1,
      }
    },
    zohoApiRequest: async () => {
      throw new Error('should not call detail when list line_items are usable')
    },
  })
  t.after(() => {
    r1()
    clearZohoTransactionModules()
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m._internals.getSalesFromInvoicesSlow('2026-04-01', '2026-05-18')
  assert.equal(listParams && listParams.sort_column, 'date')
  assert.equal(listParams && listParams.sort_order, 'A')
  assert.equal(listParams && listParams.date_start, '2026-04-01')
  assert.equal(listParams && listParams.date_end, '2026-05-18')
  assert.equal(r.invoice_sort_column, 'date')
  assert.equal(r.invoice_sort_order, 'A')
  assert.equal(r.invoice_date_start, '2026-04-01')
  assert.equal(r.invoice_date_end, '2026-05-18')
  assert.equal(r.first_invoice_date, '2026-04-01')
  assert.equal(r.last_invoice_date, '2026-04-30')
  assert.equal(r.sales_reconstruction_partial, false)
})

test('getSalesFromInvoicesSlow: opts can disable sort params (null)', async (t) => {
  clearZohoTransactionModules()
  let listParams = null
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async (_url, _key, _pages, extraParams) => {
      listParams = extraParams ? Object.fromEntries(extraParams.entries()) : {}
      return { rows: [], truncated: false, pages: 1 }
    },
    zohoApiRequest: async () => ({ invoice: {} }),
  })
  t.after(() => {
    r1()
    clearZohoTransactionModules()
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  await m._internals.getSalesFromInvoicesSlow('2026-04-01', '2026-05-18', {
    invoiceSortColumn: null,
    invoiceSortOrder: null,
  })
  assert.equal(listParams && listParams.sort_column, undefined)
  assert.equal(listParams && listParams.sort_order, undefined)
})

test('getSalesFromInvoicesSlow: prefilter not possible when invoice list lacks item fields', async (t) => {
  clearZohoTransactionModules()
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async () => ({
      rows: [
        {
          invoice_id: 'inv_hdr',
          date: '2026-01-15',
          status: 'sent',
          customer_name: 'Acme',
          invoice_number: 'INV-1',
          total: 100,
        },
      ],
      truncated: false,
      pages: 1,
    }),
    zohoApiRequest: async (p) => {
      if (String(p).includes('/invoices/inv_hdr')) {
        return {
          invoice: {
            invoice_id: 'inv_hdr',
            date: '2026-01-15',
            line_items: [{ item_id: '99', name: 'Other', quantity: 1 }],
          },
        }
      }
      throw new Error('unexpected ' + p)
    },
  })
  t.after(() => {
    r1()
    clearZohoTransactionModules()
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const target = m._internals.buildTargetReconItemSets([{ item_id: '10', sku: 'S1', name: 'N1' }])
  const r = await m._internals.getSalesFromInvoicesSlow('2026-01-01', '2026-01-31', {
    reconTargetItems: [{ item_id: '10', sku: 'S1', name: 'N1' }],
  })
  assert.equal(r.prefilter.enabled, true)
  assert.equal(r.prefilter.strategy, 'not_possible_invoice_list_has_no_item_fields')
  assert.equal(r.prefilter.invoices_skipped_by_prefilter, 0)
  assert.equal(r.invoice_detail_fetches, 1)
  assert.ok(r.prefilter.list_row_sample_keys.includes('customer_name'))
})

test('getSalesFromInvoicesSlow: stop after enough target matching lines in window', async (t) => {
  clearZohoTransactionModules()
  let detailCalls = 0
  const rows = []
  for (let i = 0; i < 5; i += 1) {
    rows.push({ invoice_id: `inv_${i}`, date: '2026-01-15', status: 'sent' })
  }
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async () => ({ rows, truncated: false, pages: 1 }),
    zohoApiRequest: async (p) => {
      detailCalls += 1
      const path = String(p)
      const match = path.includes('/inv_0') || path.includes('/inv_1')
      const id = path.split('/').pop()
      return {
        invoice: {
          invoice_id: id,
          date: '2026-01-15',
          line_items: match
            ? [{ item_id: '10', name: 'N1', sku: 'S1', quantity: 2 }]
            : [{ item_id: '99', name: 'Other', quantity: 5 }],
        },
      }
    },
  })
  t.after(() => {
    r1()
    clearZohoTransactionModules()
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const prevCap = process.env.WEEKLY_REPORT_RECON_INVOICE_DETAIL_LIMIT
  delete process.env.WEEKLY_REPORT_RECON_INVOICE_DETAIL_LIMIT
  const r = await m._internals.getSalesFromInvoicesSlow('2026-01-01', '2026-01-31', {
    reconTargetItems: [{ item_id: '10', sku: 'S1', name: 'N1' }],
    stopAfterMatchingSalesLines: 2,
    reconMatchFromDate: '2026-01-01',
    reconMatchToDate: '2026-01-31',
    maxInvoiceDetailLimit: 50,
  })
  if (prevCap === undefined) delete process.env.WEEKLY_REPORT_RECON_INVOICE_DETAIL_LIMIT
  else process.env.WEEKLY_REPORT_RECON_INVOICE_DETAIL_LIMIT = prevCap
  assert.equal(r.prefilter.targeted_recon_complete, true)
  assert.equal(r.prefilter.matching_sales_lines_in_window, 2)
  assert.equal(r.sales_reconstruction_partial, false)
  assert.equal(detailCalls, 2)
  assert.equal(r.prefilter.invoices_skipped_by_early_stop, 3)
})

test('getSalesFromInvoicesSlow: detail cap marks reconstruction partial', async (t) => {
  clearZohoTransactionModules()
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async () => ({
      rows: [
        {
          invoice_id: 'inv_ok',
          date: '2026-01-10',
          status: 'sent',
          line_items: [{ item_id: '10', quantity: 1 }],
        },
        { invoice_id: 'inv_miss', date: '2026-01-12', status: 'sent' },
        { invoice_id: 'inv_miss2', date: '2026-01-14', status: 'sent' },
      ],
      truncated: false,
      pages: 1,
    }),
    zohoApiRequest: async () => {
      throw new Error('detail fetch should not run when cap is 0')
    },
  })
  t.after(() => {
    r1()
    clearZohoTransactionModules()
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m._internals.getSalesFromInvoicesSlow('2026-01-01', '2026-01-31', {
    maxInvoiceDetailLimit: 0,
  })
  assert.equal(r.invoice_detail_fetches, 0)
  assert.equal(r.invoice_detail_fetch_truncated, true)
  assert.equal(r.sales_reconstruction_partial, true)
  assert.equal(r.line_count, 1)
})

test('addOneDayIsoDate: adds one calendar day in UTC', () => {
  const { addOneDayIsoDate } =
    require('../src/integrations/zoho/weeklyReportZohoTransactions')._internals
  assert.equal(addOneDayIsoDate('2026-01-31'), '2026-02-01')
  assert.equal(addOneDayIsoDate('2026-02-28'), '2026-03-01')
  assert.equal(addOneDayIsoDate('2025-12-31'), '2026-01-01')
  assert.equal(addOneDayIsoDate(''), '')
})

test('getSalesByItemWindowedForRecon: two Sales-by-Item calls tagged with synthetic dates', async (t) => {
  clearZohoTransactionModules()
  const calls = []
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async (url, _key, _max, params) => {
      const u = String(url)
      const from = params && params.get ? params.get('from_date') || '' : ''
      const to = params && params.get ? params.get('to_date') || '' : ''
      const wh = params && params.get ? params.get('warehouse_id') || '' : ''
      calls.push({ url: u, from, to, warehouse_id: wh })
      if (u.includes('/reports/salesbyitem')) {
        if (from === '2026-04-01' && to === '2026-04-30') {
          return {
            rows: [
              { item_id: '10', item_name: 'N1', sku: 'S1', quantity_sold: '6', item_amount: '60' },
            ],
            truncated: false,
            pages: 1,
          }
        }
        if (from === '2026-05-01' && to === '2026-05-18') {
          return {
            rows: [
              { item_id: '10', item_name: 'N1', sku: 'S1', quantity_sold: '2', item_amount: '20' },
            ],
            truncated: false,
            pages: 1,
          }
        }
      }
      return { rows: [], truncated: false, pages: 0 }
    },
    zohoApiRequest: async () => {
      throw new Error('windowed sales reconstruction must not call /invoices')
    },
  })
  t.after(() => {
    r1()
    clearZohoTransactionModules()
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m._internals.getSalesByItemWindowedForRecon('2026-04-01', '2026-04-30', '2026-05-18')
  assert.equal(r.source, 'zoho_inventory_reports_salesbyitem_windowed')
  assert.equal(r.sales_reconstruction_partial, false)
  assert.equal(r.requires_document_dates, false)
  assert.equal(r.line_count, 2)
  assert.equal(r.lines[0].document_date, '2026-04-30')
  assert.equal(r.lines[0].quantity, 6)
  assert.equal(r.lines[0]._window, 'opening')
  assert.equal(r.lines[1].document_date, '2026-05-18')
  assert.equal(r.lines[1].quantity, 2)
  assert.equal(r.lines[1]._window, 'closing')
  assert.equal(r.in_window.from_date, '2026-04-01')
  assert.equal(r.in_window.to_date, '2026-04-30')
  assert.equal(r.in_window.line_count, 1)
  assert.equal(r.after_window.from_date, '2026-05-01')
  assert.equal(r.after_window.to_date, '2026-05-18')
  assert.equal(r.after_window.line_count, 1)
  assert.equal(r.windowed_split_date, '2026-04-30')
  assert.equal(r.windowed_through_date, '2026-05-18')
  const salesByItemCalls = calls.filter((c) => c.url.includes('/reports/salesbyitem'))
  assert.equal(salesByItemCalls.length, 2)
  assert.equal(salesByItemCalls[0].from, '2026-04-01')
  assert.equal(salesByItemCalls[0].to, '2026-04-30')
  assert.equal(salesByItemCalls[1].from, '2026-05-01')
  assert.equal(salesByItemCalls[1].to, '2026-05-18')
})

test('getSalesByItemWindowedForRecon: through == split skips after-window call', async (t) => {
  clearZohoTransactionModules()
  let calls = 0
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async () => {
      calls += 1
      return { rows: [], truncated: false, pages: 1 }
    },
    zohoApiRequest: async () => {
      throw new Error('should not call /invoices')
    },
  })
  t.after(() => {
    r1()
    clearZohoTransactionModules()
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m._internals.getSalesByItemWindowedForRecon('2026-05-01', '2026-05-18', '2026-05-18')
  assert.equal(calls, 1)
  assert.equal(r.after_window.skipped, true)
  assert.equal(r.after_window.line_count, 0)
})

test('getSalesByItemWindowedForRecon: list_truncated propagates and marks partial', async (t) => {
  clearZohoTransactionModules()
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async (_url, _key, _max, params) => {
      const from = params && params.get ? params.get('from_date') || '' : ''
      const truncated = from === '2026-04-01'
      return { rows: [], truncated, pages: truncated ? 3 : 1 }
    },
    zohoApiRequest: async () => {
      throw new Error('should not call /invoices')
    },
  })
  t.after(() => {
    r1()
    clearZohoTransactionModules()
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const r = await m._internals.getSalesByItemWindowedForRecon('2026-04-01', '2026-04-30', '2026-05-18')
  assert.equal(r.list_truncated, true)
  assert.equal(r.sales_reconstruction_partial, true)
  assert.equal(r.in_window.list_truncated, true)
  assert.equal(r.after_window.list_truncated, false)
})

test('getStockReconstruction: useSalesByItemWindowed avoids /invoices entirely', async (t) => {
  clearZohoTransactionModules()
  let invoiceListHits = 0
  let invoiceDetailHits = 0
  const r1 = mockModule('../src/integrations/zoho/zohoInventoryClient', {
    fetchListPaginated: async (url, _key, _max, params) => {
      const u = String(url)
      if (u.includes('/invoices')) {
        invoiceListHits += 1
        return { rows: [], truncated: false, pages: 0 }
      }
      if (u.includes('/reports/salesbyitem')) {
        const from = params && params.get ? params.get('from_date') || '' : ''
        if (from === '2026-04-01') {
          return {
            rows: [
              { item_id: '10', item_name: 'N1', sku: 'S1', quantity_sold: '4', item_amount: '40' },
            ],
            truncated: false,
            pages: 1,
          }
        }
        return {
          rows: [
            { item_id: '10', item_name: 'N1', sku: 'S1', quantity_sold: '1', item_amount: '10' },
          ],
          truncated: false,
          pages: 1,
        }
      }
      if (u.includes('/vendorcredits')) return { rows: [], truncated: false, pages: 0 }
      return { rows: [], truncated: false, pages: 0 }
    },
    zohoApiRequest: async (p) => {
      if (String(p).includes('/invoices')) {
        invoiceDetailHits += 1
        throw new Error('windowed path must not fetch /invoices/:id')
      }
      throw new Error('unexpected ' + p)
    },
  })
  const r2 = mockModule('../src/integrations/zoho/zohoTransactionsCache', {
    fetchAllBillsRaw: async () => [],
    fetchAllVendorCreditsRaw: async () => [],
    clearBillsCache: () => {},
    clearVendorCreditsCache: () => {},
  })
  t.after(() => {
    r1()
    r2()
    clearZohoTransactionModules()
  })
  const m = freshRequire('../src/integrations/zoho/weeklyReportZohoTransactions')
  const bundle = await m.getStockReconstruction('2026-04-01', '2026-05-18', {
    useSalesByItemWindowed: true,
    salesReconSplitDate: '2026-04-30',
  })
  assert.equal(invoiceListHits, 0)
  assert.equal(invoiceDetailHits, 0)
  assert.equal(bundle.sales_reconstruction_mode, 'salesbyitem_windowed')
  assert.equal(bundle.salesR.source, 'zoho_inventory_reports_salesbyitem_windowed')
  assert.equal(bundle.salesR.line_count, 2)
  const dates = bundle.salesR.lines.map((l) => l.document_date).sort()
  assert.deepEqual(dates, ['2026-04-30', '2026-05-18'])
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
