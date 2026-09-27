const test = require('node:test')
const assert = require('node:assert/strict')
const { MATCH_STATUS, classifyStripePayment } = require('../src/services/stripeClearing/stripeClearingMatcher')

const CONFIG = { websiteZohoCustomerId: 'WEB', shopZohoCustomerId: 'SHOP', websiteCurrency: 'AED', amountTolerance: 0.01 }
const PI = 'pi_test_1'

function stripe(overrides = {}) {
  return { paymentIntentId: PI, status: 'succeeded', amountReceived: 664.99, amountRefunded: 0, currency: 'AED', ...overrides }
}

function order(overrides = {}) {
  return {
    orderId: '10765',
    orderNumber: '21152',
    orderStatus: 'confirmed',
    paymentStatus: 'completed',
    finalAmount: 664.99,
    refundAmount: 0,
    stripePaymentIntentId: PI,
    shopOrder: false,
    deleted: false,
    sameNumberCount: 0,
    ...overrides,
  }
}

function invoice(overrides = {}) {
  return {
    invoiceId: 'z1',
    invoiceNumber: 'INV-044276',
    referenceNumber: '21152',
    customerId: 'WEB',
    status: 'sent',
    total: 664.99,
    balance: 664.99,
    currencyCode: 'AED',
    ...overrides,
  }
}

function classify(input) {
  return classifyStripePayment({ stripe: stripe(), websiteOrders: [order()], zohoInvoices: [invoice()], config: CONFIG, ...input })
}

test('exact PaymentIntent, order number and amounts → ready to clear', () => {
  const r = classify({})
  assert.equal(r.status, MATCH_STATUS.MATCHED_READY_TO_CLEAR)
  assert.equal(r.eligibleForClearing, true)
})

test('shop orders must sit under the shop customer, online orders under Website', () => {
  const shopOrder = order({ shopOrder: true })
  assert.equal(classify({ websiteOrders: [shopOrder], zohoInvoices: [invoice({ customerId: 'SHOP' })] }).status, MATCH_STATUS.MATCHED_READY_TO_CLEAR)
  assert.equal(classify({ websiteOrders: [shopOrder], zohoInvoices: [invoice({ customerId: 'WEB' })] }).status, MATCH_STATUS.NEEDS_REVIEW)
  assert.equal(classify({ zohoInvoices: [invoice({ customerId: 'SHOP' })] }).status, MATCH_STATUS.NEEDS_REVIEW)
})

test('only MATCHED_READY_TO_CLEAR is eligible', () => {
  const r = classify({ zohoInvoices: [] })
  assert.equal(r.status, MATCH_STATUS.NO_ZOHO_INVOICE)
  assert.equal(r.eligibleForClearing, false)
})

test('Stripe states', () => {
  assert.equal(classify({ stripe: stripe({ status: 'requires_payment_method' }) }).status, MATCH_STATUS.STRIPE_NOT_SUCCEEDED)
  assert.equal(classify({ stripe: stripe({ amountRefunded: 664.99 }) }).status, MATCH_STATUS.REFUNDED)
  assert.equal(classify({ stripe: stripe({ amountRefunded: 100 }) }).status, MATCH_STATUS.PARTIALLY_REFUNDED)
  assert.equal(classify({ stripe: stripe({ currency: 'USD' }) }).status, MATCH_STATUS.CURRENCY_MISMATCH)
})

test('website states', () => {
  assert.equal(classify({ websiteOrders: [] }).status, MATCH_STATUS.NO_WEBSITE_ORDER)
  assert.equal(classify({ websiteOrders: [order(), order({ orderId: '2' })] }).status, MATCH_STATUS.NEEDS_REVIEW)
  assert.equal(classify({ websiteOrders: [order({ orderStatus: 'cancelled' })] }).status, MATCH_STATUS.NEEDS_REVIEW)
  assert.equal(classify({ websiteOrders: [order({ paymentStatus: 'pending' })] }).status, MATCH_STATUS.NEEDS_REVIEW)
  assert.equal(classify({ websiteOrders: [order({ sameNumberCount: 1 })] }).status, MATCH_STATUS.NEEDS_REVIEW)
  assert.equal(classify({ websiteOrders: [order({ orderStatus: 'returned' })] }).status, MATCH_STATUS.REFUNDED)
  assert.equal(classify({ websiteOrders: [order({ refundAmount: 50 })] }).status, MATCH_STATUS.PARTIALLY_REFUNDED)
  assert.equal(classify({ websiteOrders: [order({ stripePaymentIntentId: 'pi_other' })] }).status, MATCH_STATUS.NEEDS_REVIEW)
})

test('Stripe amount must equal website total', () => {
  const r = classify({ stripe: stripe({ amountReceived: 600 }) })
  assert.equal(r.status, MATCH_STATUS.AMOUNT_MISMATCH)
  assert.equal(r.amountDifference.stripeMinusWebsite, -64.99)
})

test('Zoho states', () => {
  assert.equal(classify({ zohoInvoices: [invoice({ status: 'void' })] }).status, MATCH_STATUS.NO_ZOHO_INVOICE)
  assert.equal(classify({ zohoInvoices: [invoice(), invoice({ invoiceId: 'z2', invoiceNumber: 'INV-2' })] }).status, MATCH_STATUS.MULTIPLE_ZOHO_INVOICES)
  assert.equal(classify({ zohoInvoices: [invoice({ referenceNumber: '121152' })] }).status, MATCH_STATUS.NO_ZOHO_INVOICE)
  assert.equal(classify({ zohoInvoices: [invoice({ customerId: 'OTHER' })] }).status, MATCH_STATUS.NEEDS_REVIEW)
  assert.equal(classify({ zohoInvoices: [invoice({ currencyCode: 'SAR' })] }).status, MATCH_STATUS.CURRENCY_MISMATCH)
  assert.equal(classify({ zohoInvoices: [invoice({ total: 700, balance: 700 })] }).status, MATCH_STATUS.AMOUNT_MISMATCH)
  assert.equal(classify({ zohoInvoices: [invoice({ balance: 300 })] }).status, MATCH_STATUS.ZOHO_BALANCE_MISMATCH)
})

test('already cleared: zero balance, PaymentIntent reference, or local record', () => {
  assert.equal(classify({ zohoInvoices: [invoice({ status: 'paid', balance: 0 })] }).status, MATCH_STATUS.ALREADY_CLEARED)
  const byRef = classify({ zohoIntentPayments: [{ referenceNumber: PI, amount: 664.99, invoiceNumbers: 'INV-044276' }] })
  assert.equal(byRef.status, MATCH_STATUS.ALREADY_CLEARED)
  assert.match(byRef.reason, /INV-044276/)
  const otherRef = classify({ zohoIntentPayments: [{ referenceNumber: 'Stripe funds received po_1', amount: 664.99 }] })
  assert.equal(otherRef.status, MATCH_STATUS.MATCHED_READY_TO_CLEAR)
  assert.equal(classify({ locallyCleared: true }).status, MATCH_STATUS.ALREADY_CLEARED)
})

test('without Stripe data an agreeing pair is STRIPE_NOT_VERIFIED, never ready', () => {
  const r = classify({ stripe: null })
  assert.equal(r.status, MATCH_STATUS.STRIPE_NOT_VERIFIED)
  assert.equal(r.eligibleForClearing, false)
})
