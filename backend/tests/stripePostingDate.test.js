'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { getDubaiPostingDate, dubaiDateOf, DUBAI_TIME_ZONE } = require('../src/services/stripeClearing/stripePostingDate')

test('getDubaiPostingDate is the Asia/Dubai calendar day of the server clock', () => {
  assert.equal(DUBAI_TIME_ZONE, 'Asia/Dubai')
  assert.equal(getDubaiPostingDate(new Date('2026-10-02T19:59:59.999Z')), '2026-10-02')
  assert.equal(getDubaiPostingDate(new Date('2026-10-02T20:00:00.000Z')), '2026-10-03')
  // UTC is still the previous day; Dubai is not.
  assert.equal(getDubaiPostingDate(new Date('2026-12-31T21:30:00.000Z')), '2027-01-01')
  assert.match(getDubaiPostingDate(), /^\d{4}-\d{2}-\d{2}$/)
  assert.throws(() => getDubaiPostingDate(new Date('nope')))
})

test('the posting date does not depend on the process time zone', () => {
  const saved = process.env.TZ
  try {
    process.env.TZ = 'America/Los_Angeles'
    assert.equal(getDubaiPostingDate(new Date('2026-10-02T20:30:00.000Z')), '2026-10-03')
  } finally {
    if (saved === undefined) delete process.env.TZ
    else process.env.TZ = saved
  }
})

test('dubaiDateOf converts source timestamps (payout arrival) for display and search only', () => {
  assert.equal(dubaiDateOf('2026-09-28T00:00:00.000Z'), '2026-09-28')
  assert.equal(dubaiDateOf('2026-09-26T21:30:00.000Z'), '2026-09-27')
  assert.equal(dubaiDateOf(null), null)
  assert.equal(dubaiDateOf(''), null)
  assert.equal(dubaiDateOf('garbage'), null)
})
