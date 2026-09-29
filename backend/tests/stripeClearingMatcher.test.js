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

// Return status alone is operational: only a financial reversal blocks the original payment.

function creditNote(overrides = {}) {
  return {
    creditNoteId: 'cn1',
    creditNoteNumber: '21152',
    status: 'open',
    total: 199,
    balance: 199,
    invoiceId: 'z1',
    invoiceNumber: 'INV-044276',
    salesReturnNumber: 'RMA-1',
    totalRefunded: 0,
    totalCreditsUsed: 0,
    ...overrides,
  }
}

function classifyReturn(orderStatus, creditNotes, input = {}) {
  return classify({ websiteOrders: [order({ orderStatus, ...(input.order || {}) })], returnCreditNotes: creditNotes, ...input })
}

test('partiallyReturned with no financial refund clears with a return-pending warning', () => {
  const r = classifyReturn('partiallyReturned', [creditNote()])
  assert.equal(r.status, MATCH_STATUS.MATCHED_READY_TO_CLEAR)
  assert.equal(r.eligibleForClearing, true)
  assert.equal(r.returnPending.orderStatus, 'partiallyReturned')
  assert.equal(r.returnPending.stripeRefunded, 0)
  assert.deepEqual(r.returnPending.creditNotes.map((n) => n.creditNoteNumber), ['21152'])
})

test('full return with no financial refund clears with a return-pending warning', () => {
  const r = classifyReturn('returned', [creditNote({ total: 664.99, balance: 664.99 })])
  assert.equal(r.status, MATCH_STATUS.MATCHED_READY_TO_CLEAR)
  assert.equal(r.returnPending.orderStatus, 'returned')
})

test('return with no credit note yet clears with a return-pending warning', () => {
  const r = classifyReturn('returned', [])
  assert.equal(r.status, MATCH_STATUS.MATCHED_READY_TO_CLEAR)
  assert.deepEqual(r.returnPending.creditNotes, [])
})

test('open unapplied credit note is clearable; void and draft credit notes do not block', () => {
  assert.equal(classifyReturn('partiallyReturned', [creditNote()]).status, MATCH_STATUS.MATCHED_READY_TO_CLEAR)
  const voided = classifyReturn('partiallyReturned', [creditNote({ status: 'void', totalCreditsUsed: 199, balance: 0 })])
  assert.equal(voided.status, MATCH_STATUS.MATCHED_READY_TO_CLEAR)
  assert.deepEqual(voided.returnPending.creditNotes, [])
  assert.equal(classifyReturn('partiallyReturned', [creditNote({ status: 'draft' })]).status, MATCH_STATUS.MATCHED_READY_TO_CLEAR)
})

test('credit note applied to the invoice → NEEDS_REVIEW', () => {
  const r = classifyReturn('partiallyReturned', [creditNote({ totalCreditsUsed: 199, balance: 0, status: 'closed' })])
  assert.equal(r.status, MATCH_STATUS.NEEDS_REVIEW)
  assert.match(r.reason, /applied as credit/)
  assert.equal(r.returnPending, undefined)
})

test('refunded credit note → NEEDS_REVIEW', () => {
  const r = classifyReturn('returned', [creditNote({ totalRefunded: 199, balance: 0, status: 'closed' })])
  assert.equal(r.status, MATCH_STATUS.NEEDS_REVIEW)
  assert.match(r.reason, /199 refunded/)
})

test('partly used credit note, one linked to another invoice, or credits above the invoice → NEEDS_REVIEW', () => {
  assert.match(classifyReturn('partiallyReturned', [creditNote({ balance: 100 })]).reason, /100 of 199 left/)
  const other = classifyReturn('partiallyReturned', [creditNote({ invoiceId: 'z9', invoiceNumber: 'INV-9' })])
  assert.equal(other.status, MATCH_STATUS.NEEDS_REVIEW)
  assert.match(other.reason, /linked to invoice INV-9/)
  const tooMuch = classifyReturn('returned', [creditNote({ total: 500, balance: 500 }), creditNote({ creditNoteId: 'cn2', creditNoteNumber: '21152-2', total: 200, balance: 200 })])
  assert.equal(tooMuch.status, MATCH_STATUS.NEEDS_REVIEW)
  assert.match(tooMuch.reason, /more than invoice/)
})

test('website refundAmount > 0 still blocks a returned order even with credit notes', () => {
  const r = classifyReturn('partiallyReturned', [creditNote()], { order: { refundAmount: 199 } })
  assert.equal(r.status, MATCH_STATUS.PARTIALLY_REFUNDED)
  assert.equal(r.eligibleForClearing, false)
  assert.equal(classifyReturn('returned', [creditNote()], { order: { paymentStatus: 'refunded' } }).status, MATCH_STATUS.REFUNDED)
})

test('Stripe refund on a returned order still blocks unless refunds are cleared separately', () => {
  assert.equal(classifyReturn('partiallyReturned', [creditNote()], { stripe: stripe({ amountRefunded: 199 }) }).status, MATCH_STATUS.PARTIALLY_REFUNDED)
  const separate = classifyReturn('partiallyReturned', undefined, { stripe: stripe({ amountRefunded: 199 }), refundsClearedSeparately: true })
  assert.equal(separate.status, MATCH_STATUS.MATCHED_READY_TO_CLEAR)
  assert.equal(separate.returnPending, undefined)
})

test('invoice balance reduced on a returned order is not ready to clear', () => {
  const r = classifyReturn('partiallyReturned', [creditNote()], { zohoInvoices: [invoice({ balance: 465.99 })] })
  assert.equal(r.status, MATCH_STATUS.ZOHO_BALANCE_MISMATCH)
  assert.equal(r.eligibleForClearing, false)
})

test('disputed returned order → NEEDS_REVIEW', () => {
  const r = classifyReturn('partiallyReturned', [creditNote()], { stripe: stripe({ disputed: true }) })
  assert.equal(r.status, MATCH_STATUS.NEEDS_REVIEW)
  assert.equal(r.eligibleForClearing, false)
})

test('without credit notes or Stripe data a return status still blocks', () => {
  assert.equal(classifyReturn('partiallyReturned', undefined).status, MATCH_STATUS.PARTIALLY_REFUNDED)
  assert.equal(classifyReturn('returned', undefined).status, MATCH_STATUS.REFUNDED)
  assert.equal(classifyReturn('returned', [creditNote()], { stripe: null }).status, MATCH_STATUS.REFUNDED)
})

test('order 20942: partially returned, credit note 20942 open for 199, no refund → ready to clear', () => {
  const r = classifyStripePayment({
    stripe: { paymentIntentId: 'pi_3UCEOJDJogiiRoKP1K5jv6nl', status: 'succeeded', amountReceived: 251.66, amountRefunded: 0, disputed: false, currency: 'AED' },
    websiteOrders: [order({ orderNumber: '20942', orderStatus: 'partiallyReturned', finalAmount: 251.66, stripePaymentIntentId: 'pi_3UCEOJDJogiiRoKP1K5jv6nl' })],
    zohoInvoices: [invoice({ invoiceId: '4265011000042119561', invoiceNumber: 'INV-043652', referenceNumber: '20942', total: 251.66, balance: 251.66 })],
    returnCreditNotes: [creditNote({
      creditNoteId: '4265011000042497823',
      creditNoteNumber: '20942',
      invoiceId: '4265011000042119561',
      invoiceNumber: 'INV-043652',
      salesReturnNumber: 'RMA-04331',
    })],
    config: CONFIG,
  })
  assert.equal(r.status, MATCH_STATUS.MATCHED_READY_TO_CLEAR)
  assert.equal(r.eligibleForClearing, true)
  assert.equal(r.returnPending.orderNumber, '20942')
  assert.equal(r.returnPending.creditNotes[0].salesReturnNumber, 'RMA-04331')
})
