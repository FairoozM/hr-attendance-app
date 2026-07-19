const test = require('node:test')
const assert = require('node:assert/strict')
const {
  FIXED_COMMISSION_PCT,
  parsePct,
  assertDenominatorValid,
  ValidationError,
} = require('../src/services/uaePricesCustomService')

test('FIXED_COMMISSION_PCT is 15', () => {
  assert.equal(FIXED_COMMISSION_PCT, 15)
})

test('parsePct accepts 0 and 100', () => {
  assert.equal(parsePct(0, 'VAT %'), 0)
  assert.equal(parsePct(100, 'VAT %'), 100)
  assert.equal(parsePct('12.5', 'Advertising %'), 12.5)
})

test('parsePct rejects out of range and non-numbers', () => {
  assert.throws(() => parsePct(-0.1, 'VAT %'), ValidationError)
  assert.throws(() => parsePct(100.1, 'VAT %'), ValidationError)
  assert.throws(() => parsePct('nope', 'Profit %'), ValidationError)
})

test('assertDenominatorValid allows defaults and zero rates', () => {
  assert.doesNotThrow(() => assertDenominatorValid(5, 15, 25))
  assert.doesNotThrow(() => assertDenominatorValid(0, 0, 0))
  assert.doesNotThrow(() => assertDenominatorValid(40, 20, 24.9))
})

test('assertDenominatorValid rejects sum >= 100 including commission', () => {
  assert.throws(
    () => assertDenominatorValid(40, 30, 15),
    (err) => err instanceof ValidationError && /under 100%/.test(err.message),
  )
  assert.throws(
    () => assertDenominatorValid(50, 20, 15),
    ValidationError,
  )
})
