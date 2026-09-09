'use strict'

/**
 * Partial provider failure: one channel throwing must not blank the whole report.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

test('Promise.allSettled keeps sibling channels when one rejects', async () => {
  const results = await Promise.allSettled([
    Promise.resolve({ channel: 'ok', orders: [1] }),
    Promise.reject(new Error('provider down')),
    Promise.resolve({ channel: 'also_ok', orders: [] }),
  ])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.equal(results[2].status, 'fulfilled')
  assert.equal(results[0].value.orders.length, 1)
})
