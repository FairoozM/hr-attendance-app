const test = require('node:test')
const assert = require('node:assert/strict')
const {
  parsePct,
  assertDenominatorValid,
  ValidationError,
  DEFAULT_COMPOSITE_CUSTOM_RATES,
} = require('../src/services/uaeCompositeCustomRatesService')

test('DEFAULT_COMPOSITE_CUSTOM_RATES matches All Prices defaults', () => {
  assert.deepEqual(DEFAULT_COMPOSITE_CUSTOM_RATES, {
    vatPct: 5,
    commissionPct: 15,
    advertisingPct: 15,
    requiredProfitPct: 25,
  })
})

test('parsePct accepts 0 and 100', () => {
  assert.equal(parsePct(0, 'VAT %'), 0)
  assert.equal(parsePct(100, 'Commission %'), 100)
  assert.equal(parsePct('12.5', 'Advertising %'), 12.5)
})

test('parsePct rejects out of range and non-numbers', () => {
  assert.throws(() => parsePct(-0.1, 'VAT %'), ValidationError)
  assert.throws(() => parsePct(100.1, 'Commission %'), ValidationError)
  assert.throws(() => parsePct('nope', 'Profit %'), ValidationError)
})

test('assertDenominatorValid allows defaults and editable commission', () => {
  assert.doesNotThrow(() => assertDenominatorValid(5, 15, 15, 25))
  assert.doesNotThrow(() => assertDenominatorValid(0, 0, 0, 0))
  assert.doesNotThrow(() => assertDenominatorValid(5, 10, 10, 20))
  assert.doesNotThrow(() => assertDenominatorValid(40, 20, 20, 19.9))
})

test('assertDenominatorValid rejects sum >= 100 including editable commission', () => {
  assert.throws(
    () => assertDenominatorValid(40, 30, 15, 15),
    (err) => err instanceof ValidationError && /under 100%/.test(err.message),
  )
  assert.throws(() => assertDenominatorValid(25, 25, 25, 25), ValidationError)
})
