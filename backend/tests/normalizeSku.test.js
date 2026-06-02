const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeSku } = require('../src/utils/normalizeSku')

describe('normalizeSku (Amazon/Zoho cache keys)', () => {
  it('maps en-dash and em-dash SKUs to the same key as FBA API hyphen SKUs', () => {
    assert.equal(normalizeSku('2FP17SET–BEIGE'), '2FP17SET-BEIGE')
    assert.equal(normalizeSku('2FP17SET-BEIGE'), '2FP17SET-BEIGE')
    assert.equal(normalizeSku('2FP17SET—BEIGE'), '2FP17SET-BEIGE')
  })

  it('normalizes non-breaking spaces', () => {
    assert.equal(normalizeSku(' ab\u00A0cd — black  '), 'AB CD - BLACK')
  })
})
