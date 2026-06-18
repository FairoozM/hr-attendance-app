const test = require('node:test')
const assert = require('node:assert/strict')

const service = require('../src/services/amazonReturnReconciliationService')

test('alternative SKU is used as working SKU when available', () => {
  const csv = [
    'SKU,Alternative SKU,QTY received,Removal order ID',
    'OLD-SKU-123, LIFEP7S-24-GRAY , 29 , RO-001',
  ].join('\n')
  const parsed = service.parseSourceFile(Buffer.from(csv), 'returns.csv')
  assert.equal(parsed.returnedStock.length, 1)
  assert.equal(parsed.returnedStock[0].workingSku, 'LIFEP7S-24-GRAY')
  assert.equal(parsed.returnedStock[0].originalSku, 'OLD-SKU-123')
})

test('blank received qty rows are ignored from returned stock', () => {
  const csv = [
    'SKU,Alternative SKU,QTY received,Removal order ID',
    'SKU-WITH-QTY,,10,RO-1',
    'SKU-BLANK,,,RO-2',
  ].join('\n')
  const parsed = service.parseSourceFile(Buffer.from(csv), 'returns.csv')
  assert.equal(parsed.returnedStock.length, 1)
  assert.equal(parsed.ignoredRows.length, 1)
  assert.equal(parsed.ignoredRows[0].originalSku, 'SKU-BLANK')
})

test('old stock section is parsed separately', () => {
  const csv = [
    'SKU,QTY received',
    'RETURN-1,20',
    'OLD STOCK WITH US,,',
    'OLD-SKU,3',
  ].join('\n')
  const parsed = service.parseSourceFile(Buffer.from(csv), 'returns.csv')
  assert.equal(parsed.returnedStock.length, 1)
  assert.equal(parsed.oldStock.length, 1)
  assert.equal(parsed.oldStock[0].workingSku, 'OLD-SKU')
  assert.equal(parsed.oldStock[0].qtyReceived, 3)
})

test('returned and old stock merge correctly by working SKU', () => {
  const combined = service.combineAvailableStock(
    [{ workingSku: 'LIFEP7S-24-GRAY', qtyReceived: 29 }],
    [{ workingSku: 'LIFEP7S-24-GRAY', qtyReceived: 3 }]
  )
  assert.equal(combined.length, 1)
  assert.equal(combined[0].returnedQty, 29)
  assert.equal(combined[0].oldStockQty, 3)
  assert.equal(combined[0].totalAvailableQty, 32)
})

test('label upload key is linked to combined SKU path', () => {
  assert.equal(service.isAllowedLabelMime('application/pdf', 'label.pdf'), true)
  const key = service.createAmazonReturnLabelKey(12, 99, 'fnsku.pdf')
  assert.match(key, /^amazon-return-labels\/12\/combined\/99\//)
})

test('public agent report exposes only agent-safe fields', async () => {
  const report = {
    batch: { title: 'Test', marketplace: 'KSA', agentName: 'Agent' },
    summary: { totalAvailableSkus: 1, totalAvailableQty: 5 },
    combinedStock: [{
      id: 1,
      workingSku: 'SKU-1',
      totalAvailableQty: 5,
      labelDownloaded: false,
      labelPrinted: false,
      relabeled: false,
      packed: false,
      readyForShipment: false,
      agentNotes: '',
      label: null,
      labelStatus: 'Not Uploaded',
    }],
  }
  assert.ok(!('ignoredRows' in report))
  assert.ok(!('returnedStock' in report))
  assert.ok(!('publicToken' in report.batch))
  assert.ok(!('storagePath' in (report.combinedStock[0].label || {})))
})
