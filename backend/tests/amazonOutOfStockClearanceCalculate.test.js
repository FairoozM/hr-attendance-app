const test = require('node:test')
const assert = require('node:assert/strict')

const {
  calculateClearanceRows,
  exportRowsForKind,
  rowsToExportObjects,
  STATUS,
  MATCH_METHOD,
} = require('../src/services/amazonOutOfStockClearanceCalculateService')
const { updateAmazonStub } = require('../src/services/amazonOutOfStockClearanceService')

const amazonBase = {
  marketplace: 'UAE',
  marketplaceKey: 'uae',
  amazonCurrentQty: 0,
}

test('direct SKU match across Amazon, Zoho, and Vigil', () => {
  const { rows, summary } = calculateClearanceRows({
    amazonRows: [{ ...amazonBase, amazonSku: 'ABC-RED', title: 'Item A' }],
    zohoRows: [{ sku: 'ABC-RED', availableQty: 5, itemName: 'Zoho A' }],
    vigilRows: [{ itemCode: 'ABC-RED', availableStock: 10 }],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, STATUS.READY)
  assert.equal(rows[0].zohoLifeSmileQty, 5)
  assert.equal(rows[0].vigilQty, 10)
  assert.equal(rows[0].totalAvailableQty, 15)
  assert.equal(rows[0].recommendedAmazonUpdateQty, 15)
  assert.equal(rows[0].matchMethod, MATCH_METHOD.DIRECT)
  assert.equal(summary.readyToUpdate, 1)
})

test('Amazon SKU not found in Zoho', () => {
  const { rows } = calculateClearanceRows({
    amazonRows: [{ ...amazonBase, amazonSku: 'MISSING-SKU' }],
    zohoRows: [{ sku: 'OTHER', availableQty: 3 }],
    vigilRows: [{ itemCode: 'MISSING-SKU', availableStock: 2 }],
  })
  assert.equal(rows[0].status, STATUS.ZOHO_NOT_MATCHED)
  assert.equal(rows[0].zohoMatched, false)
})

test('Zoho color variant matches Vigil base via parent match', () => {
  const { rows } = calculateClearanceRows({
    amazonRows: [{ ...amazonBase, amazonSku: 'LIFEP17-16-BLUE' }],
    zohoRows: [{ sku: 'LIFEP17-16-BLUE', availableQty: 2 }],
    vigilRows: [{ itemCode: 'LIFEP17-16', availableStock: 8 }],
  })
  assert.equal(rows[0].vigilMatchedCode, 'LIFEP17-16')
  assert.equal(rows[0].matchMethod, MATCH_METHOD.COLOR_BASE)
  assert.equal(rows[0].status, STATUS.COLOR_BASE)
  assert.equal(rows[0].recommendedAmazonUpdateQty, 10)
})

test('zero stock yields No Stock Available', () => {
  const { rows, summary } = calculateClearanceRows({
    amazonRows: [{ ...amazonBase, amazonSku: 'ZERO-SKU' }],
    zohoRows: [{ sku: 'ZERO-SKU', availableQty: 0 }],
    vigilRows: [{ itemCode: 'ZERO-SKU', availableStock: 0 }],
  })
  assert.equal(rows[0].status, STATUS.NO_STOCK)
  assert.equal(rows[0].recommendedAmazonUpdateQty, 0)
  assert.equal(summary.noStockAvailable, 1)
})

test('recommended quantity respects max cap from body', () => {
  const prev = process.env.AMAZON_OUT_OF_STOCK_MAX_RECOMMENDED_QTY
  delete process.env.AMAZON_OUT_OF_STOCK_MAX_RECOMMENDED_QTY
  const { rows } = calculateClearanceRows({
    amazonRows: [{ ...amazonBase, amazonSku: 'CAP-SKU' }],
    zohoRows: [{ sku: 'CAP-SKU', availableQty: 100 }],
    vigilRows: [{ itemCode: 'CAP-SKU', availableStock: 50 }],
    maxRecommendedQty: 20,
  })
  assert.equal(rows[0].totalAvailableQty, 150)
  assert.equal(rows[0].recommendedAmazonUpdateQty, 20)
  if (prev != null) process.env.AMAZON_OUT_OF_STOCK_MAX_RECOMMENDED_QTY = prev
})

test('recommended quantity respects env cap', () => {
  const prev = process.env.AMAZON_OUT_OF_STOCK_MAX_RECOMMENDED_QTY
  process.env.AMAZON_OUT_OF_STOCK_MAX_RECOMMENDED_QTY = '12'
  const { rows } = calculateClearanceRows({
    amazonRows: [{ ...amazonBase, amazonSku: 'ENV-CAP' }],
    zohoRows: [{ sku: 'ENV-CAP', availableQty: 20 }],
    vigilRows: [{ itemCode: 'ENV-CAP', availableStock: 0 }],
  })
  assert.equal(rows[0].recommendedAmazonUpdateQty, 12)
  if (prev != null) process.env.AMAZON_OUT_OF_STOCK_MAX_RECOMMENDED_QTY = prev
  else delete process.env.AMAZON_OUT_OF_STOCK_MAX_RECOMMENDED_QTY
})

test('Zoho matched but Vigil not matched', () => {
  const { rows } = calculateClearanceRows({
    amazonRows: [{ ...amazonBase, amazonSku: 'ZOHO-ONLY' }],
    zohoRows: [{ sku: 'ZOHO-ONLY', availableQty: 4 }],
    vigilRows: [{ itemCode: 'OTHER', availableStock: 99 }],
  })
  assert.equal(rows[0].status, STATUS.VIGIL_NOT_MATCHED)
})

test('manual override preserved on recalculate', () => {
  const manualMappings = {
    'MANUAL-SKU': {
      locked: true,
      zohoSku: 'MANUAL-SKU',
      vigilCode: 'MANUAL-SKU',
      recommendedQty: 7,
    },
  }
  const first = calculateClearanceRows({
    amazonRows: [{ ...amazonBase, amazonSku: 'MANUAL-SKU' }],
    zohoRows: [{ sku: 'MANUAL-SKU', availableQty: 1 }],
    vigilRows: [{ itemCode: 'MANUAL-SKU', availableStock: 1 }],
    manualMappings,
  })
  const second = calculateClearanceRows({
    amazonRows: [{ ...amazonBase, amazonSku: 'MANUAL-SKU' }],
    zohoRows: [{ sku: 'MANUAL-SKU', availableQty: 100 }],
    vigilRows: [{ itemCode: 'MANUAL-SKU', availableStock: 100 }],
    manualMappings,
    respectManualOverrides: true,
  })
  assert.equal(first.rows[0].recommendedAmazonUpdateQty, 7)
  assert.equal(second.rows[0].recommendedAmazonUpdateQty, 7)
  assert.equal(second.rows[0].manuallyEdited, true)
})

test('manual override overwritten when confirmOverwriteManual', () => {
  const { rows } = calculateClearanceRows({
    amazonRows: [{ ...amazonBase, amazonSku: 'OVER-SKU' }],
    zohoRows: [{ sku: 'OVER-SKU', availableQty: 10 }],
    vigilRows: [{ itemCode: 'OVER-SKU', availableStock: 0 }],
    manualMappings: { 'OVER-SKU': { locked: true, recommendedQty: 3 } },
    confirmOverwriteManual: true,
  })
  assert.equal(rows[0].recommendedAmazonUpdateQty, 10)
  assert.equal(rows[0].manuallyEdited, false)
})

test('duplicate Vigil codes trigger manual review', () => {
  const { rows } = calculateClearanceRows({
    amazonRows: [{ ...amazonBase, amazonSku: 'DUP-SKU' }],
    zohoRows: [{ sku: 'DUP-SKU', availableQty: 1 }],
    vigilRows: [
      { itemCode: 'DUP-SKU', availableStock: 5 },
      { itemCode: 'dup-sku', availableStock: 9 },
    ],
  })
  assert.equal(rows[0].status, STATUS.MANUAL_REVIEW)
})

test('export row shape includes required columns', () => {
  const objects = rowsToExportObjects([
    {
      amazonSku: 'X',
      amazonTitle: 'Title',
      marketplace: 'UAE',
      amazonCurrentQty: 0,
      zohoLifeSmileQty: 1,
      zohoSku: 'X',
      vigilMatchedCode: 'X',
      vigilMatchedName: 'N',
      vigilQty: 2,
      totalAvailableQty: 3,
      recommendedAmazonUpdateQty: 3,
      matchMethod: 'direct',
      status: STATUS.READY,
      notes: '',
      manuallyEdited: false,
    },
  ])
  assert.ok(objects[0]['Amazon SKU'])
  assert.ok(objects[0]['Recommended Update Qty'])
  assert.ok(objects[0].Status)
})

test('exportRowsForKind filters ready rows', () => {
  const rows = [
    { status: STATUS.READY },
    { status: STATUS.NO_STOCK },
    { status: STATUS.MANUAL_REVIEW },
  ]
  assert.equal(exportRowsForKind(rows, 'ready').length, 1)
  assert.equal(exportRowsForKind(rows, 'manualReview').length, 1)
})

test('updateAmazonStub returns 501', () => {
  assert.throws(
    () => updateAmazonStub(),
    (err) => err.code === 'AMAZON_INVENTORY_UPDATE_NOT_ENABLED' && err.status === 501
  )
})
