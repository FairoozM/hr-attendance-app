const test = require('node:test')
const assert = require('node:assert/strict')
const {
  statusForRow,
  STATUS_READY,
  STATUS_MISSING_FNSKU,
  STATUS_INVALID_QTY,
} = require('../src/services/amazonKsaRtoLabelingService')

test('Amazon KSA RTO labeling status: ready when product, FNSKU, and positive quantity exist', () => {
  assert.equal(
    statusForRow({ product_code: 'LIFEP12', fnsku_no: 'X001ABC', quantity: 24 }),
    STATUS_READY
  )
})

test('Amazon KSA RTO labeling status: missing FNSKU is warning only', () => {
  assert.equal(
    statusForRow({ product_code: 'LIFEP12', fnsku_no: '', quantity: 24 }),
    STATUS_MISSING_FNSKU
  )
})

test('Amazon KSA RTO labeling status: missing product or invalid quantity is invalid', () => {
  assert.equal(
    statusForRow({ product_code: '', fnsku_no: 'X001ABC', quantity: 24 }),
    STATUS_INVALID_QTY
  )
  assert.equal(
    statusForRow({ product_code: 'LIFEP12', fnsku_no: 'X001ABC', quantity: 0 }),
    STATUS_INVALID_QTY
  )
})
