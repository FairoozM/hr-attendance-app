const test = require('node:test')
const assert = require('node:assert/strict')
const { runStripeClearingDryRun, parseRange } = require('../src/services/stripeClearing/stripeClearingDryRunService')

const CONFIG = {
  websiteZohoCustomerId: 'WEB',
  shopZohoCustomerId: 'SHOP',
  websiteCurrency: 'AED',
  amountTolerance: 0.01,
  maxRangeDays: 7,
  maxRows: 100,
  defaultRows: 50,
  timezoneOffset: '+04:00',
}

function fakeSources(overrides = {}) {
  const calls = { zohoLookups: [], paymentLookups: [] }
  const sources = {
    stripeAvailable: () => true,
    listStripePaymentIntents: async () => [
      { paymentIntentId: 'pi_a', chargeId: 'ch_a', status: 'succeeded', amountReceived: 100, amountRefunded: 0, currency: 'AED', date: '2026-09-26T10:00:00.000Z' },
      { paymentIntentId: 'pi_b', chargeId: null, status: 'requires_payment_method', amountReceived: 0, amountRefunded: 0, currency: 'AED', date: null },
      { paymentIntentId: 'pi_c', chargeId: 'ch_c', status: 'succeeded', amountReceived: 50, amountRefunded: 0, currency: 'AED', date: null },
    ],
    loadWebsiteOrdersByIntents: async () => [
      { orderId: '1', orderNumber: '500', orderStatus: 'confirmed', paymentStatus: 'completed', finalAmount: 100, refundAmount: 0, stripePaymentIntentId: 'pi_a', deleted: false, sameNumberCount: 0, currency: 'AED' },
    ],
    findZohoInvoicesByReference: async (ref) => {
      calls.zohoLookups.push(ref)
      return [{ invoiceId: 'z1', invoiceNumber: 'INV-1', referenceNumber: ref, customerId: 'WEB', status: 'sent', total: 100, balance: 100, currencyCode: 'AED' }]
    },
    findZohoPaymentsByReference: async (ref) => {
      calls.paymentLookups.push(ref)
      return []
    },
    ...overrides,
  }
  return { sources, calls }
}

const noLocal = async () => new Map()

test('range is limited and uses Dubai days', () => {
  const r = parseRange({ from: '2026-09-26', to: '2026-09-26' }, CONFIG)
  assert.equal(r.start.toISOString(), '2026-09-25T20:00:00.000Z')
  assert.equal(r.days, 1)
  assert.throws(() => parseRange({ from: '2026-09-01', to: '2026-09-20' }, CONFIG), /limited to 7 days/)
})

test('dry run classifies every PaymentIntent and only reads Zoho for eligible ones', async () => {
  const { sources, calls } = fakeSources()
  const out = await runStripeClearingDryRun({ from: '2026-09-26', to: '2026-09-26' }, { sources, config: CONFIG, localClearings: noLocal })
  assert.equal(out.dryRun, true)
  assert.deepEqual(out.rows.map((r) => r.result.status), ['MATCHED_READY_TO_CLEAR', 'STRIPE_NOT_SUCCEEDED', 'NO_WEBSITE_ORDER'])
  assert.deepEqual(calls.zohoLookups, ['500'])
  assert.deepEqual(calls.paymentLookups, ['pi_a'])
  assert.equal(out.counts.MATCHED_READY_TO_CLEAR, 1)
  assert.equal(out.rows[0].zoho.invoiceNumber, 'INV-1')
})

test('an existing Zoho payment referencing the PaymentIntent blocks clearing', async () => {
  const { sources } = fakeSources({
    findZohoPaymentsByReference: async (ref) => [{ paymentId: 'p1', referenceNumber: ref, amount: 100, paymentMode: 'Stripe', invoiceNumbers: 'INV-9' }],
  })
  const out = await runStripeClearingDryRun({ from: '2026-09-26', to: '2026-09-26' }, { sources, config: CONFIG, localClearings: noLocal })
  assert.equal(out.rows[0].result.status, 'ALREADY_CLEARED')
  assert.match(out.rows[0].result.reason, /INV-9/)
  assert.equal(out.rows[0].zohoPaymentsWithIntentReference[0].paymentId, 'p1')
})

test('local clearing records are shown and block re-posting', async () => {
  const { sources } = fakeSources()
  const localClearings = async () => new Map([
    ['pi_a', { status: 'FAILED_NEEDS_REVIEW', zohoPaymentId: null, attemptCount: 1, lastError: 'timeout', postedAt: null }],
  ])
  const out = await runStripeClearingDryRun({ from: '2026-09-26', to: '2026-09-26' }, { sources, config: CONFIG, localClearings })
  assert.equal(out.rows[0].result.status, 'NEEDS_REVIEW')
  assert.equal(out.rows[0].localClearing.status, 'FAILED_NEEDS_REVIEW')
  assert.equal(out.rows[0].canPost, false)
})

test('paid invoices skip the payment lookup', async () => {
  const { sources, calls } = fakeSources({
    findZohoInvoicesByReference: async (ref) => [
      { invoiceId: 'z1', invoiceNumber: 'INV-1', referenceNumber: ref, customerId: 'WEB', status: 'paid', total: 100, balance: 0, currencyCode: 'AED' },
    ],
  })
  const out = await runStripeClearingDryRun({ from: '2026-09-26', to: '2026-09-26' }, { sources, config: CONFIG, localClearings: noLocal })
  assert.equal(out.rows[0].result.status, 'ALREADY_CLEARED')
  assert.deepEqual(calls.paymentLookups, [])
})
