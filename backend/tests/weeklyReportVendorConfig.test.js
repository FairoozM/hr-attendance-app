/**
 * @file `weeklyReportVendorConfig` — per-group purchase/credits contact scoping
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getVendorConfigForGroup,
  mergeZohoWithVendorContext,
  _internals: { buildFilterAppliedObject },
} = require('../src/services/weeklyReportVendorConfig')

const BASE = { foo: 1 }

test('getVendorConfigForGroup: flat env defaults purchases unfiltered', () => {
  delete process.env.WEEKLY_REPORT_VENDORS_JSON
  delete process.env.WEEKLY_REPORT_VENDOR_CREDITS_CONTACT_ID
  delete process.env.WEEKLY_REPORT_PURCHASES_MODE
  delete process.env.WEEKLY_REPORT_PURCHASES_CONTACT_ID
  const c = getVendorConfigForGroup('any')
  assert.equal(c.purchases.mode, 'unfiltered')
  assert.equal(c.vendor_credits_contact_id, undefined)
})

test('getVendorConfigForGroup: JSON per group with vendor credits + purchases by contact', () => {
  const prev = process.env.WEEKLY_REPORT_VENDORS_JSON
  process.env.WEEKLY_REPORT_VENDORS_JSON = JSON.stringify({
    slow_moving: {
      vendor_credits_contact_id: '5012345',
      purchases: { mode: 'by_contact_id', contact_id: '909090' },
    },
  })
  const c = getVendorConfigForGroup('slow_moving')
  process.env.WEEKLY_REPORT_VENDORS_JSON = prev
  if (prev === undefined) delete process.env.WEEKLY_REPORT_VENDORS_JSON
  assert.equal(c.vendor_credits_contact_id, '5012345')
  assert.equal(c.purchases.mode, 'by_contact_id')
  assert.equal(c.purchases.contact_id, '909090')
  const fa = buildFilterAppliedObject(c)
  assert.equal(fa.sold, false)
  assert.equal(fa.returned_to_wholesale, true)
  assert.equal(fa.purchases, true)
})

test('mergeZohoWithVendorContext: no vendor_filter_debug in production (unless opt-in env)', () => {
  const prevE = process.env.NODE_ENV
  const prevD = process.env.WEEKLY_REPORT_VENDOR_DEBUG
  process.env.NODE_ENV = 'production'
  delete process.env.WEEKLY_REPORT_VENDOR_DEBUG
  const z = mergeZohoWithVendorContext(BASE, 'slow_moving')
  process.env.NODE_ENV = prevE
  if (prevD === undefined) delete process.env.WEEKLY_REPORT_VENDOR_DEBUG
  else process.env.WEEKLY_REPORT_VENDOR_DEBUG = prevD
  assert.equal(z.foo, 1)
  assert.equal('vendor_filter_debug' in z, false)
})

test('mergeZohoWithVendorContext: non-production includes filter_applied booleans (no contact ids)', () => {
  const prevE = process.env.NODE_ENV
  const prevJ = process.env.WEEKLY_REPORT_VENDORS_JSON
  process.env.NODE_ENV = 'test'
  process.env.WEEKLY_REPORT_VENDORS_JSON = JSON.stringify({
    g1: { vendor_credits_contact_id: '1' },
  })
  const z = mergeZohoWithVendorContext(BASE, 'g1')
  process.env.NODE_ENV = prevE
  if (prevJ === undefined) delete process.env.WEEKLY_REPORT_VENDORS_JSON
  else process.env.WEEKLY_REPORT_VENDORS_JSON = prevJ
  assert.ok(z.vendor_filter_debug)
  assert.equal(z.vendor_filter_debug.filter_applied.sold, false)
  assert.equal(z.vendor_filter_debug.filter_applied.returned_to_wholesale, true)
  assert.equal(z.vendor_filter_debug.filter_applied.purchases, true)
  const dbg = z.vendor_filter_debug
  assert.equal('contact_id' in dbg, false)
  assert.equal('vendor_credits_contact_id' in dbg, false)
})
