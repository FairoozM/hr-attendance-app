/**
 * Golden fingerprint of the Noon clearing accounting pipeline.
 *
 * These assertions exist to catch silent movement during refactors: any change
 * in classification, journal composition or payment splitting shows up as a
 * diff here. Regenerate deliberately with:
 *
 *   UPDATE_NOON_GOLDEN=1 node --test tests/noonClearingGolden.test.js
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  buildNoonClearingFingerprint,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingFingerprint')
const { GOLDEN_BATCHES } = require('./fixtures/noonClearingBatches')

const GOLDEN_DIR = path.join(__dirname, 'golden')
const shouldUpdate = process.env.UPDATE_NOON_GOLDEN === '1'

describe('Noon clearing golden fingerprints', () => {
  for (const { name, batch } of GOLDEN_BATCHES) {
    it(`${name} fingerprint is unchanged`, () => {
      const actual = buildNoonClearingFingerprint(batch)
      const file = path.join(GOLDEN_DIR, `${name}.json`)

      if (shouldUpdate) {
        fs.mkdirSync(GOLDEN_DIR, { recursive: true })
        fs.writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`)
        return
      }

      assert.ok(
        fs.existsSync(file),
        `Missing golden file ${file}. Run with UPDATE_NOON_GOLDEN=1 to create it.`
      )
      const expected = JSON.parse(fs.readFileSync(file, 'utf8'))
      assert.deepEqual(actual, expected)
    })
  }

  it('fingerprint is stable across repeated runs', () => {
    for (const { batch } of GOLDEN_BATCHES) {
      const first = buildNoonClearingFingerprint(batch)
      const second = buildNoonClearingFingerprint(batch)
      assert.deepEqual(first, second)
    }
  })

  it('covers every row class the fixtures are meant to exercise', () => {
    const seen = new Set()
    for (const { batch } of GOLDEN_BATCHES) {
      const fp = buildNoonClearingFingerprint(batch)
      for (const rowClass of Object.keys(fp.rowClassCounts)) seen.add(rowClass)
    }
    for (const expected of ['sale_item', 'parent_order_charge', 'order_adjustment', 'return', 'statement_fee', 'other']) {
      assert.ok(seen.has(expected), `No fixture row is classified as ${expected}`)
    }
  })
})
