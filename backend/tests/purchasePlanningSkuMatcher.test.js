const test = require('node:test')
const assert = require('node:assert/strict')
const XLSX = require('xlsx')

const {
  normalizeSku,
  extractColor,
  getParentSku,
  expandMatchCandidates,
  matchZohoSkuToVigil,
} = require('../src/utils/purchasePlanningSkuMatcher')
const {
  parseVigilExcel,
  previewLowStockUpload,
  _internals,
} = require('../src/services/purchasePlanningService')

test('normalizes SKU spacing, case, non-breaking spaces, and long dashes', () => {
  assert.equal(normalizeSku(' ab\u00A0cd — black  '), 'AB CD - BLACK')
})

test('extracts color suffix from hyphen or trailing word', () => {
  assert.equal(extractColor('ABC-RED'), 'RED')
  assert.equal(extractColor('ABC blue'), 'BLUE')
  assert.equal(extractColor('ABC-light-blue'), 'LIGHT BLUE')
  assert.equal(extractColor('LIFEP22-8SILVER'), 'SILVER')
  assert.equal(extractColor('ABC-XL'), '')
})

test('returns parent SKU when a color suffix is present', () => {
  assert.equal(getParentSku('ABC-RED'), 'ABC')
  assert.equal(getParentSku('ABC BLUE'), 'ABC')
  assert.equal(getParentSku('LIFEP17-16-BLUE'), 'LIFEP17-16')
  assert.equal(getParentSku('LIFEP22-8SILVER'), 'LIFEP22-8')
  assert.equal(getParentSku('ABC-LIGHT-BLUE'), 'ABC')
})

test('matches Zoho SKU to Vigil by exact code before parent code', () => {
  const rows = [
    { itemCode: 'ABC', availableStock: 4 },
    { itemCode: 'ABC-BLACK', availableStock: 2 },
  ]
  assert.deepEqual(matchZohoSkuToVigil('abc-black', rows), {
    matched: true,
    matchType: 'exact',
    matchedVigilCode: 'ABC-BLACK',
    wholesaleAvailableQty: 2,
  })
})

test('falls back to parent SKU match when exact color code is absent', () => {
  assert.deepEqual(matchZohoSkuToVigil('abc-black', [{ itemCode: 'ABC', availableStock: 7 }]), {
    matched: true,
    matchType: 'parent',
    matchedVigilCode: 'ABC',
    wholesaleAvailableQty: 7,
  })
})

test('matches Zoho color SKU to Vigil parent code without color', () => {
  assert.deepEqual(matchZohoSkuToVigil('LIFEP17-16-BLUE', [{ itemCode: 'LIFEP17-16', availableStock: 12 }]), {
    matched: true,
    matchType: 'parent',
    matchedVigilCode: 'LIFEP17-16',
    wholesaleAvailableQty: 12,
  })
})

test('matches multi-token color suffixes to Vigil parent code', () => {
  assert.deepEqual(matchZohoSkuToVigil('ABC-LIGHT-BLUE', [{ itemCode: 'ABC', availableStock: 3 }]), {
    matched: true,
    matchType: 'parent',
    matchedVigilCode: 'ABC',
    wholesaleAvailableQty: 3,
  })
  assert.deepEqual(matchZohoSkuToVigil('RING-12-ROSE-GOLD', [{ itemCode: 'RING-12', availableStock: 8 }]), {
    matched: true,
    matchType: 'parent',
    matchedVigilCode: 'RING-12',
    wholesaleAvailableQty: 8,
  })
})

test('matches attached color suffixes after numeric size token', () => {
  assert.deepEqual(matchZohoSkuToVigil('LIFEP22-8SILVER', [{ itemCode: 'LIFEP22-8', availableStock: 809 }]), {
    matched: true,
    matchType: 'parent',
    matchedVigilCode: 'LIFEP22-8',
    wholesaleAvailableQty: 809,
  })
})

test('matches separator variants before falling back to parent', () => {
  assert.deepEqual(matchZohoSkuToVigil('life p17_16 blue', [{ itemCode: 'life-p17-16-blue', availableStock: 4 }]), {
    matched: true,
    matchType: 'exact',
    matchedVigilCode: 'LIFE-P17-16-BLUE',
    wholesaleAvailableQty: 4,
  })
  assert.deepEqual(matchZohoSkuToVigil('life p17_16 blue', [{ itemCode: 'life-p17-16', availableStock: 9 }]), {
    matched: true,
    matchType: 'parent',
    matchedVigilCode: 'LIFE-P17-16',
    wholesaleAvailableQty: 9,
  })
})

test('expands exact variants before colorless parent candidates', () => {
  assert.deepEqual(expandMatchCandidates('LIFEP17-16-BLUE').map((candidate) => candidate.matchKind), [
    'exact',
    'parent',
  ])
})

test('enriches low-stock rows with latest Vigil stock matches', () => {
  const rows = _internals.applyVigilMatchesToLowStockRows(
    [
      { sku: 'LIFEP17-16-BLUE', itemName: 'Life pan', currentZohoStock: 1 },
      { sku: 'NO-MATCH-BLACK', itemName: 'Missing', currentZohoStock: 0 },
    ],
    [{ itemCode: 'LIFEP17-16', availableStock: 12 }]
  )

  assert.equal(rows[0].vigilCode, 'LIFEP17-16')
  assert.equal(rows[0].vigilStock, 12)
  assert.equal(rows[0].vigilMatchType, 'parent')
  assert.equal(rows[1].vigilStock, 0)
  assert.equal(rows[1].vigilMatchType, 'not_found')
})

test('parses Vigil Excel stock sheets', () => {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Item Code', 'Available Stock'],
    ['abc-black', 5],
    ['', 3],
  ])
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock')
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const parsed = parseVigilExcel(buffer)

  assert.equal(parsed.summary.validRows, 1)
  assert.equal(parsed.summary.invalidRows, 1)
  assert.equal(parsed.rows[0].normalizedItemCode, 'ABC-BLACK')
  assert.equal(parsed.rows[0].availableStock, 5)
})

test('parses low-stock SKU upload without a header row', () => {
  const parsed = previewLowStockUpload(Buffer.from('abc-black\nabc-blue\n'), 'low-stock.csv')

  assert.equal(parsed.summary.validRows, 2)
  assert.equal(parsed.rows[0].normalizedSku, 'ABC-BLACK')
  assert.equal(parsed.rows[1].normalizedSku, 'ABC-BLUE')
})

test('purchase planning item index matches Zoho item names and prefers warehouse available stock', () => {
  const index = _internals.buildZohoItemIndex([
    {
      item_id: 'z1',
      name: 'DSH-14',
      sku: '6291109111320',
      warehouse_available_for_sale_stock: '2',
      warehouse_actual_available_for_sale_stock: '-1',
      warehouse_actual_available_stock: '0',
      available_stock: '2',
      stock_on_hand: '9',
    },
  ])

  assert.deepEqual(index.get('DSH-14'), {
    sku: '6291109111320',
    itemName: 'DSH-14',
    zohoItemId: 'z1',
    currentZohoStock: 2,
  })
})

test('purchase planning composite usage rolls sold kits down to component quantities', async () => {
  const usage = await _internals.buildCompositeUsageAggregate(
    [
      { item_id: 'kit-1', sku: 'KIT-1-SET', name: 'KIT-1-SET', quantity: 3 },
      { item_id: 'regular-1', sku: 'REGULAR-1', quantity: 5 },
    ],
    async (itemId) => itemId === 'kit-1'
      ? [
        { item_id: 'component-a', sku: 'COMP-A', quantity: 2 },
        { item_id: 'component-b', sku: 'COMP-B', quantity: 1 },
      ]
      : []
  )

  assert.equal(_internals.bundleUsageQtyForItem(usage, { sku: 'COMP-A', zoho_item_id: 'component-a' }), 6)
  assert.equal(_internals.bundleUsageQtyForItem(usage, { sku: 'COMP-B', zoho_item_id: 'component-b' }), 3)
  assert.equal(_internals.bundleUsageQtyForItem(usage, { sku: 'REGULAR-1', zoho_item_id: 'regular-1' }), 0)
})

test('purchase planning quantities use sales plus bundle usage and cap final qty by Vigil stock', () => {
  assert.deepEqual(_internals.calculatePlanQuantities({
    totalSales: 12,
    totalBundle: 8,
    vigilAvailable: 100,
  }), {
    suggestedQty: 20,
    finalQty: 20,
    remainingVigilQty: 80,
    wasAdjustedForVigil: false,
  })

  assert.deepEqual(_internals.calculatePlanQuantities({
    totalSales: 12,
    totalBundle: 8,
    vigilAvailable: 15,
  }), {
    suggestedQty: 20,
    finalQty: 15,
    remainingVigilQty: 0,
    wasAdjustedForVigil: true,
  })
})

test('purchase planning PO vendor falls back to weekly report vendor config', () => {
  const originalPurchaseVendor = process.env.ZOHO_PURCHASE_VENDOR_ID
  const originalReportVendor = process.env.REPORT_VENDOR_ID
  const originalVendorsJson = process.env.WEEKLY_REPORT_VENDORS_JSON
  try {
    delete process.env.ZOHO_PURCHASE_VENDOR_ID
    delete process.env.REPORT_VENDOR_ID
    process.env.WEEKLY_REPORT_VENDORS_JSON = JSON.stringify({
      default: { vendor_credits_contact_id: 'weekly-vendor-1' },
    })

    assert.deepEqual(_internals.resolvePurchaseOrderVendor(), {
      vendorId: 'weekly-vendor-1',
      source: 'WEEKLY_REPORT_VENDORS_JSON',
    })
  } finally {
    if (originalPurchaseVendor == null) delete process.env.ZOHO_PURCHASE_VENDOR_ID
    else process.env.ZOHO_PURCHASE_VENDOR_ID = originalPurchaseVendor
    if (originalReportVendor == null) delete process.env.REPORT_VENDOR_ID
    else process.env.REPORT_VENDOR_ID = originalReportVendor
    if (originalVendorsJson == null) delete process.env.WEEKLY_REPORT_VENDORS_JSON
    else process.env.WEEKLY_REPORT_VENDORS_JSON = originalVendorsJson
  }
})

test('purchase planning generates unique Zoho PO numbers per send attempt', () => {
  const first = _internals.nextZohoPurchaseOrderNumber('PP-202605081234-ABCD')
  const second = _internals.nextZohoPurchaseOrderNumber('PP-202605081234-ABCD')

  assert.match(first, /^PP-202605081234-ABCD-\d{12}-[A-Z0-9]{6}$/)
  assert.match(second, /^PP-202605081234-ABCD-\d{12}-[A-Z0-9]{6}$/)
  assert.notEqual(first, second)
})
