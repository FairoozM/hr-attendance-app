const test = require('node:test')
const assert = require('node:assert/strict')
const {
  computeStatus,
  getDaysLeft,
  formatDaysRemaining,
  monthlyCost,
  addBillingPeriod,
} = require('../src/services/subscriptionUtils')

function isoDaysFromToday(offset) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

test('computeStatus returns Expired when past expiry', () => {
  assert.equal(computeStatus(isoDaysFromToday(-4)), 'Expired')
})

test('computeStatus returns Expiring Soon for 0-15 days', () => {
  assert.equal(computeStatus(isoDaysFromToday(0)), 'Expiring Soon')
  assert.equal(computeStatus(isoDaysFromToday(7)), 'Expiring Soon')
  assert.equal(computeStatus(isoDaysFromToday(15)), 'Expiring Soon')
})

test('computeStatus returns Upcoming for 16-30 days', () => {
  assert.equal(computeStatus(isoDaysFromToday(16)), 'Upcoming')
  assert.equal(computeStatus(isoDaysFromToday(30)), 'Upcoming')
})

test('computeStatus returns Active for more than 30 days', () => {
  assert.equal(computeStatus(isoDaysFromToday(160)), 'Active')
})

test('formatDaysRemaining labels', () => {
  assert.match(formatDaysRemaining(isoDaysFromToday(-4)), /^Expired \d+ days? ago$/)
  assert.equal(formatDaysRemaining(isoDaysFromToday(0)), 'Expires today')
  assert.equal(formatDaysRemaining(isoDaysFromToday(7)), '7 days left')
  assert.equal(formatDaysRemaining(isoDaysFromToday(160)), '160 days left')
})

test('monthlyCost normalizes billing cycles', () => {
  assert.equal(monthlyCost(1200, 'Yearly'), 100)
  assert.equal(monthlyCost(300, 'Quarterly'), 100)
  assert.equal(monthlyCost(50, 'Monthly'), 50)
  assert.equal(monthlyCost(500, 'One-Time'), 0)
})

test('addBillingPeriod extends monthly subscription', () => {
  const next = addBillingPeriod('2026-06-30', 'Monthly')
  assert.equal(next, '2026-07-30')
})

test('subscription notification trigger keys are stable', () => {
  const { buildExpiryTriggerKey, buildInvoiceMissingKey } = require('../src/services/subscriptionNotificationsService')
  assert.equal(buildExpiryTriggerKey(5, 30, '2026-12-01'), 'subscription_expiry:5:30:2026-12-01')
  assert.equal(buildInvoiceMissingKey(5, '2026-12-01'), 'subscription_invoice_missing:5:2026-12-01')
})
