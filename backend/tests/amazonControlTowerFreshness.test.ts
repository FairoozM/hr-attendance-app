'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { classifyFreshness, laterOf } = require('../src/services/amazonControlTower/freshness.ts')

const NOW = new Date('2026-10-05T12:00:00Z')
const HOUR = 3_600_000
const base = { now: NOW, warnAfterMs: 2 * HOUR, staleAfterMs: 6 * HOUR, lastFailureAt: null, lastError: null }
const ago = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString()

describe('Control Tower freshness', () => {
  it('FRESH / WARNING / STALE by age', () => {
    assert.equal(classifyFreshness({ ...base, lastSuccessAt: ago(1) }).status, 'FRESH')
    assert.equal(classifyFreshness({ ...base, lastSuccessAt: ago(3) }).status, 'WARNING')
    assert.equal(classifyFreshness({ ...base, lastSuccessAt: ago(7) }).status, 'STALE')
    assert.equal(classifyFreshness({ ...base, lastSuccessAt: ago(1) }).ageMs, HOUR)
  })

  it('NEVER_SYNCED without any attempt', () => {
    const r = classifyFreshness({ ...base, lastSuccessAt: null })
    assert.equal(r.status, 'NEVER_SYNCED')
    assert.equal(r.ageMs, null)
  })

  it('ERROR when the latest attempt failed after the last success, with the error', () => {
    const r = classifyFreshness({ ...base, lastSuccessAt: ago(5), lastFailureAt: ago(1), lastError: 'boom' })
    assert.equal(r.status, 'ERROR')
    assert.equal(r.lastError, 'boom')
    const neverOk = classifyFreshness({ ...base, lastSuccessAt: null, lastFailureAt: ago(1), lastError: 'x' })
    assert.equal(neverOk.status, 'ERROR')
  })

  it('an older failure does not mask a newer success', () => {
    const r = classifyFreshness({ ...base, lastSuccessAt: ago(1), lastFailureAt: ago(4), lastError: 'old' })
    assert.equal(r.status, 'FRESH')
    assert.equal(r.lastError, null)
  })

  it('laterOf picks the latest timestamp', () => {
    assert.equal(laterOf(ago(2), ago(1)), ago(1))
    assert.equal(laterOf(null, ago(1)), ago(1))
    assert.equal(laterOf(null, null), null)
  })
})
