'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { getStripeClearingConfig } = require('../src/config/stripeClearing')
const { previewPayout, listPayoutSummaries, GROUP_STATUS, LINE_STATE } = require('../src/services/stripeClearing/stripePayoutPreviewService')

const config = getStripeClearingConfig()
const WEBSITE = config.websiteZohoCustomerId
const SHOP = config.shopZohoCustomerId
const PAYOUT = 'po_TESTPAYOUT00001'
const NET_REF = `Stripe funds received ${PAYOUT}`
const FEE_REF = `Stripe processing fee ${PAYOUT}`

function charge(n, gross, fee, extra = {}) {
  return {
    balanceTransactionId: `txn_CHARGE0000${n}`,
    type: 'charge',
    currency: 'AED',
    exchangeRate: null,
    amountMinor: gross,
    feeMinor: fee,
    netMinor: gross - fee,
    chargeId: `ch_CHARGE0000${n}`,
    paymentIntentId: `pi_INTENT0000${n}`,
    chargeRefundedMinor: 0,
    chargeDisputed: false,
    ...extra,
  }
}

function order(n, orderNumber, total, shopOrder = false) {
  return {
    orderId: String(n),
    orderNumber,
    orderStatus: 'delivered',
    paymentStatus: 'completed',
    stripePaymentIntentId: `pi_INTENT0000${n}`,
    shopOrder,
    finalAmount: total,
    refundAmount: 0,
    walletRedeemed: 0,
    deleted: false,
    sameNumberCount: 0,
  }
}

function invoice(id, number, ref, customerId, total, balance = total) {
  return { invoiceId: id, invoiceNumber: number, referenceNumber: ref, customerId, status: balance > 0 ? 'sent' : 'paid', total, balance, currencyCode: 'AED' }
}

function fixture(overrides = {}) {
  const txns = overrides.txns || [
    charge(1, 55900, 1721),
    charge(2, 50500, 1565),
    charge(3, 27540, 899),
    { balanceTransactionId: 'txn_REFUND00001', type: 'refund', currency: 'AED', amountMinor: -10000, feeMinor: 0, netMinor: -10000, sourceId: 're_1', chargeId: 'ch_OLD', paymentIntentId: 'pi_OLD' },
    { balanceTransactionId: 'txn_PAYOUT00001', type: 'payout', currency: 'AED', amountMinor: -119755, feeMinor: 0, netMinor: -119755 },
  ]
  const orders = overrides.orders || [order(1, '20820', 559), order(2, '20842', 505), order(3, '20824', 275.4, true)]
  const invoices = overrides.invoices || {
    20820: [invoice('INV1', 'INV-043410', '20820', WEBSITE, 559)],
    20842: [invoice('INV2', 'INV-043444', '20842', WEBSITE, 505)],
    20824: [invoice('INV3', 'INV-043368', '20824', SHOP, 275.4)],
  }
  const refPayments = overrides.refPayments || {}
  const paymentDetails = overrides.paymentDetails || {}
  const writes = []
  const sources = {
    retrieveStripePayout: async (id) => (id === PAYOUT ? { payoutId: PAYOUT, status: overrides.payoutStatus || 'paid', amountMinor: overrides.payoutAmount ?? 119755, currency: 'AED', arrivalDate: '2026-09-06T20:30:00.000Z', createdAt: '2026-09-04T00:00:00.000Z' } : null),
    listStripePayouts: async () => [{ payoutId: PAYOUT, status: 'paid', amountMinor: 119755, currency: 'AED', arrivalDate: '2026-09-06T20:30:00.000Z' }],
    listPayoutBalanceTransactions: async () => txns,
    loadWebsiteOrdersByIntents: async (ids) => orders.filter((o) => ids.includes(o.stripePaymentIntentId)),
    findZohoInvoicesByReference: async (ref) => invoices[ref] || [],
    findZohoPaymentsByReference: async (ref) => refPayments[ref] || [],
  }
  const zohoPayments = {
    listZohoChartAccounts: async () => overrides.accounts || [
      { accountId: 'A1019', accountName: 'Stripe Undeposited Funds', accountCode: '1019', accountType: 'cash', isActive: true },
      { accountId: 'A1013', accountName: 'Stripe Processing Chg Un-Cleared', accountCode: '1013', accountType: 'cash', isActive: true },
      { accountId: 'A2270', accountName: 'Stripe Fees', accountCode: '2270', accountType: 'expense', isActive: true },
    ],
    getZohoCustomerPayment: async (id) => paymentDetails[id] || null,
    createZohoCustomerPayment: async () => { writes.push('createZohoCustomerPayment'); throw new Error('write attempted') },
    createZohoJournal: async () => { writes.push('createZohoJournal'); throw new Error('write attempted') },
  }
  return { deps: { config, sources, zohoPayments }, writes }
}

function group(result, customerId) {
  return result.groups.find((g) => g.customerId === customerId)
}

test('groups one payout into NET and FEE per customer without mixing customers', async () => {
  const { deps, writes } = fixture()
  const result = await previewPayout(PAYOUT, deps)
  assert.deepEqual(result.customersPresent, ['Website', 'Burjman Shop - Web & App'])
  const web = group(result, WEBSITE)
  const shop = group(result, SHOP)
  assert.equal(web.invoiceCount, 2)
  assert.equal(web.gross, 1064)
  assert.equal(web.net.amount, 1031.14)
  assert.equal(web.fee.amount, 32.86)
  assert.equal(web.net.account.accountId, 'A1019')
  assert.equal(web.fee.account.accountId, 'A1013')
  assert.equal(web.net.reference, NET_REF)
  assert.equal(web.fee.reference, FEE_REF)
  assert.deepEqual(web.net.allocations.map((a) => [a.invoiceNumber, a.amount]), [['INV-043410', 541.79], ['INV-043444', 489.35]])
  assert.deepEqual(web.fee.allocations.map((a) => [a.invoiceNumber, a.amount]), [['INV-043410', 17.21], ['INV-043444', 15.65]])
  assert.deepEqual(shop.net.allocations.map((a) => [a.invoiceNumber, a.amount]), [['INV-043368', 266.41]])
  assert.deepEqual(shop.fee.allocations.map((a) => [a.invoiceNumber, a.amount]), [['INV-043368', 8.99]])
  assert.ok(!web.net.allocations.some((a) => a.invoiceId === 'INV3'))
  assert.ok(web.netPlusFeeEqualsGross && shop.netPlusFeeEqualsGross && web.everyInvoiceBalances && shop.everyInvoiceBalances)
  assert.equal(web.status, GROUP_STATUS.READY)
  assert.equal(shop.status, GROUP_STATUS.READY)
  assert.equal(result.readiness, GROUP_STATUS.READY)
  assert.equal(result.proposedPaymentDate, '2026-09-07')
  assert.deepEqual(writes, [])
})

test('reconciles the payout and lists non-charge balance transactions separately', async () => {
  const { deps } = fixture()
  const result = await previewPayout(PAYOUT, deps)
  assert.equal(result.reconciliation.matchedGross, 1339.4)
  assert.equal(result.reconciliation.netAllocations, 1297.55)
  assert.equal(result.reconciliation.feeAllocations, 41.85)
  assert.equal(result.reconciliation.netPlusFeeEqualsGross, true)
  assert.equal(result.composition.chargeNet, 1297.55)
  assert.equal(result.composition.otherNet, -100)
  assert.equal(result.composition.reconciles, true)
  assert.deepEqual(result.otherTransactions.map((t) => t.type), ['refund'])
  assert.ok(result.warnings.some((w) => w.includes('non-charge')))
})

test('existing matching NET and FEE payments are ALREADY_EXISTS, filtered by customer', async () => {
  const paid = {
    20820: [invoice('INV1', 'INV-043410', '20820', WEBSITE, 559, 0)],
    20842: [invoice('INV2', 'INV-043444', '20842', WEBSITE, 505, 0)],
    20824: [invoice('INV3', 'INV-043368', '20824', SHOP, 275.4)],
  }
  const { deps } = fixture({
    invoices: paid,
    refPayments: {
      [NET_REF]: [
        { paymentId: 'P-NET-WEB', customerId: WEBSITE, amount: 1031.14, referenceNumber: NET_REF },
        { paymentId: 'P-NET-OTHER', customerId: 'SOMEONE_ELSE', amount: 5, referenceNumber: NET_REF },
      ],
      [FEE_REF]: [{ paymentId: 'P-FEE-WEB', customerId: WEBSITE, amount: 32.86, referenceNumber: FEE_REF }],
    },
    paymentDetails: {
      'P-NET-WEB': { amount: 1031.14, account_id: 'A1019', date: '2026-09-07', invoices: [{ invoice_id: 'INV1', amount_applied: 541.79 }, { invoice_id: 'INV2', amount_applied: 489.35 }] },
      'P-FEE-WEB': { amount: 32.86, account_id: 'A1013', date: '2026-09-07', invoices: [{ invoice_id: 'INV1', amount_applied: 17.21 }, { invoice_id: 'INV2', amount_applied: 15.65 }] },
    },
  })
  const result = await previewPayout(PAYOUT, deps)
  const web = group(result, WEBSITE)
  assert.equal(web.status, GROUP_STATUS.ALREADY_EXISTS)
  assert.equal(web.net.existing.count, 1)
  assert.equal(web.net.existing.comparison.matchesProposal, true)
  assert.ok(web.lines.every((l) => l.state === LINE_STATE.CLEARED))
  assert.equal(group(result, SHOP).status, GROUP_STATUS.READY)
  assert.equal(result.readiness, GROUP_STATUS.NEEDS_REVIEW)
})

test('two payments with the same reference for one customer are MULTIPLE_MATCHES', async () => {
  const { deps } = fixture({
    refPayments: { [NET_REF]: [{ paymentId: 'P1', customerId: SHOP, amount: 1 }, { paymentId: 'P2', customerId: SHOP, amount: 1 }] },
  })
  const result = await previewPayout(PAYOUT, deps)
  assert.equal(group(result, SHOP).status, GROUP_STATUS.MULTIPLE_MATCHES)
  assert.equal(group(result, WEBSITE).status, GROUP_STATUS.READY)
})

test('only one component existing needs review', async () => {
  const { deps } = fixture({
    refPayments: { [NET_REF]: [{ paymentId: 'P1', customerId: SHOP, amount: 266.41 }] },
    paymentDetails: { P1: { amount: 266.41, account_id: 'A1019', invoices: [{ invoice_id: 'INV3', amount_applied: 266.41 }] } },
  })
  const shop = group(await previewPayout(PAYOUT, deps), SHOP)
  assert.equal(shop.status, GROUP_STATUS.NEEDS_REVIEW)
  assert.match(shop.reasons[0], /Only the NET payment/)
})

test('existing payments that differ from the proposal need review', async () => {
  const { deps } = fixture({
    refPayments: {
      [NET_REF]: [{ paymentId: 'P1', customerId: SHOP, amount: 266.41 }],
      [FEE_REF]: [{ paymentId: 'P2', customerId: SHOP, amount: 9.5 }],
    },
    paymentDetails: {
      P1: { amount: 266.41, account_id: 'A1019', invoices: [{ invoice_id: 'INV3', amount_applied: 266.41 }] },
      P2: { amount: 9.5, account_id: 'A2270', invoices: [{ invoice_id: 'INV3', amount_applied: 9.5 }] },
    },
  })
  const shop = group(await previewPayout(PAYOUT, deps), SHOP)
  assert.equal(shop.status, GROUP_STATUS.NEEDS_REVIEW)
  assert.ok(shop.reasons.some((r) => r.includes('Amount 9.5')))
  assert.ok(shop.reasons.some((r) => r.includes('Deposited to')))
})

test('an invoice total that differs from Stripe gross is excluded and needs review', async () => {
  const { deps } = fixture({
    invoices: {
      20820: [invoice('INV1', 'INV-043410', '20820', WEBSITE, 560)],
      20842: [invoice('INV2', 'INV-043444', '20842', WEBSITE, 505)],
      20824: [invoice('INV3', 'INV-043368', '20824', SHOP, 275.4)],
    },
  })
  const web = group(await previewPayout(PAYOUT, deps), WEBSITE)
  assert.equal(web.status, GROUP_STATUS.NEEDS_REVIEW)
  assert.equal(web.invoiceCount, 1)
  assert.deepEqual(web.net.allocations.map((a) => a.invoiceNumber), ['INV-043444'])
})

test('a charge without a website order is unassigned and blocks readiness', async () => {
  const txns = [charge(1, 55900, 1721), charge(9, 10000, 300)]
  const { deps } = fixture({ txns, payoutAmount: 54179 + 9700 })
  const result = await previewPayout(PAYOUT, deps)
  assert.equal(result.unassigned.length, 1)
  assert.equal(result.unassigned[0].paymentIntentId, 'pi_INTENT00009')
  assert.equal(result.readiness, GROUP_STATUS.NEEDS_REVIEW)
})

test('a payout that is not paid yet, or a missing 1013 account, needs review', async () => {
  const notPaid = await previewPayout(PAYOUT, fixture({ payoutStatus: 'in_transit' }).deps)
  assert.ok(notPaid.groups.every((g) => g.status === GROUP_STATUS.NEEDS_REVIEW))

  const noFeeAccount = fixture({
    accounts: [
      { accountId: 'A1019', accountName: 'Stripe Undeposited Funds', accountCode: '1019', accountType: 'cash', isActive: true },
      { accountId: 'A2270', accountName: 'Stripe Fees', accountCode: '2270', accountType: 'expense', isActive: true },
    ],
  })
  const result = await previewPayout(PAYOUT, noFeeAccount.deps)
  assert.equal(result.accounts.fee, null)
  assert.ok(result.groups.every((g) => g.status === GROUP_STATUS.NEEDS_REVIEW))
})

test('rejects anything that is not a payout ID', async () => {
  await assert.rejects(previewPayout('pi_123456789', fixture().deps), (err) => err.code === 'INVALID_PAYOUT_ID' && err.status === 400)
  await assert.rejects(previewPayout('po_DOESNOTEXIST1', fixture().deps), (err) => err.status === 404)
})

test('payout summaries show Stripe composition without Zoho calls', async () => {
  const { deps } = fixture()
  deps.sources.findZohoInvoicesByReference = async () => { throw new Error('Zoho must not be called') }
  const { rows } = await listPayoutSummaries({ limit: 5 }, deps)
  assert.equal(rows[0].composition.chargeCount, 3)
  assert.equal(rows[0].composition.chargeFee, 41.85)
  assert.equal(rows[0].composition.otherCount, 1)
  assert.equal(rows[0].composition.reconciles, true)
})
