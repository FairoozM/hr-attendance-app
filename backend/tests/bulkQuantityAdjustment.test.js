const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  parseUploadBuffer,
  summarizeRows,
  templateCsvContent,
} = require('../src/services/bulkQuantityAdjustmentService')

test('parseUploadBuffer: parses CSV with required columns', () => {
  const csv = [
    'sku,adjustment_qty,warehouse_name,reason,description,reference_number',
    'SKU-001,5,Main Warehouse,Damaged goods,Test desc,REF-1',
    'SKU-002,-2,Main Warehouse,Stock count,,REF-2',
  ].join('\n')
  const result = parseUploadBuffer(Buffer.from(csv, 'utf8'), 'test.csv')
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0].sku, 'SKU-001')
  assert.equal(result.rows[0].adjustment_qty, 5)
  assert.equal(result.rows[0].warehouse_name, 'Main Warehouse')
  assert.equal(result.rows[0].reason, 'Damaged goods')
  assert.equal(result.rows[1].adjustment_qty, -2)
})

test('parseUploadBuffer: rejects zero quantity at parse time only as number', () => {
  const csv = 'sku,adjustment_qty,warehouse_name,reason\nSKU-001,0,WH,Reason\n'
  const result = parseUploadBuffer(Buffer.from(csv, 'utf8'), 'test.csv')
  assert.equal(result.rows[0].adjustment_qty, 0)
})

test('parseUploadBuffer: missing sku column throws', () => {
  const csv = 'adjustment_qty,warehouse_name,reason\n1,WH,Reason\n'
  assert.throws(
    () => parseUploadBuffer(Buffer.from(csv, 'utf8'), 'test.csv'),
    (err) => err.code === 'UPLOAD_MISSING_COLUMN',
  )
})

test('parseUploadBuffer: missing warehouse column throws', () => {
  const csv = 'sku,adjustment_qty,reason\nSKU-001,1,Reason\n'
  assert.throws(
    () => parseUploadBuffer(Buffer.from(csv, 'utf8'), 'test.csv'),
    (err) => err.code === 'UPLOAD_MISSING_COLUMN',
  )
})

test('summarizeRows: counts validation buckets', () => {
  const summary = summarizeRows([
    { validation_status: 'valid', posting_status: 'ready', valuation_status: 'unknown' },
    { validation_status: 'valid', posting_status: 'posted', valuation_status: 'pending' },
    { validation_status: 'unmatched', posting_status: 'skipped', valuation_status: 'unknown' },
    { validation_status: 'duplicate', posting_status: 'skipped', valuation_status: 'unknown' },
    { validation_status: 'invalid_qty', posting_status: 'skipped', valuation_status: 'unknown' },
  ])
  assert.equal(summary.total_rows, 5)
  assert.equal(summary.valid_rows, 2)
  assert.equal(summary.unmatched_skus, 1)
  assert.equal(summary.duplicate_skus, 1)
  assert.equal(summary.invalid_quantities, 1)
  assert.equal(summary.error_rows, 3)
  assert.equal(summary.ready_to_post, 2)
  assert.equal(summary.posted_successfully, 1)
  assert.equal(summary.pending_valuation, 1)
})

test('templateCsvContent: includes header row', () => {
  const csv = templateCsvContent()
  assert.match(csv, /^sku,adjustment_qty,warehouse_name,reason/)
  assert.match(csv, /EXAMPLE-SKU-001/)
})

test('findItemInLookup: matches normalized SKU variants', () => {
  const { findItemInLookup, cacheRowFromZohoItem } = require('../src/services/bulkQuantityAdjustmentService')
  const lookup = new Map()
  const row = cacheRowFromZohoItem({ item_id: '123', sku: 'TOOL-ECO-6-BLUE', name: 'Tool Blue' })
  lookup.set('TOOL-ECO-6-BLUE', row)
  assert.equal(findItemInLookup('tool-eco-6-blue', lookup)?.item_id, '123')
  assert.equal(findItemInLookup('DOES-NOT-EXIST', lookup), null)
})

test('buildAdjustmentPayload: uses warehouse_id only when no location_id', () => {
  const { buildAdjustmentPayload } = require('../src/integrations/zoho/zohoInventoryAdjustments')
  const payload = buildAdjustmentPayload({
    date: '2026-06-30',
    reason: 'test',
    warehouse_id: '12345',
    line_items: [{ item_id: '999', quantity_adjusted: -1, warehouse_id: '12345' }],
  })
  assert.equal(payload.warehouse_id, '12345')
  assert.equal(payload.location_id, undefined)
  assert.equal(payload.line_items[0].warehouse_id, '12345')
  assert.equal(payload.line_items[0].location_id, undefined)
})

test('buildAdjustmentPayload: uses location_id when resolved from locations API', () => {
  const { buildAdjustmentPayload } = require('../src/integrations/zoho/zohoInventoryAdjustments')
  const payload = buildAdjustmentPayload({
    date: '2026-06-30',
    reason: 'test',
    location_id: '460000000038080',
    line_items: [{ item_id: '999', quantity_adjusted: -1 }],
  })
  assert.equal(payload.location_id, '460000000038080')
  assert.equal(payload.warehouse_id, undefined)
  assert.equal(payload.line_items[0].location_id, '460000000038080')
})

test('chunkLineItems: splits large groups', () => {
  const { chunkLineItems, MAX_LINES_PER_ADJUSTMENT } = require('../src/integrations/zoho/zohoInventoryAdjustments')
  const items = Array.from({ length: 150 }, (_, i) => ({ item_id: String(i), quantity_adjusted: 1 }))
  const chunks = chunkLineItems(items)
  assert.equal(chunks.length, 2)
  assert.equal(chunks[0].length, MAX_LINES_PER_ADJUSTMENT)
  assert.equal(chunks[1].length, 50)
})
