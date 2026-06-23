const test = require('node:test')
const assert = require('node:assert/strict')

const { parseAmazonSettlementReport, normalizeSettlementDate } = require('../src/services/amazonSettlementParserService')
const { categorizeSettlementRow, CATEGORY, ROW_CLASS } = require('../src/services/amazonPaymentClearingCategoryService')
const {
  matchSettlementRowsToInvoices,
  matchRefundReturnRowsToCreditNotes,
  deriveInvoiceRange,
} = require('../src/services/amazonPaymentClearingZohoMatcher')
const { buildPreview, orderSummary } = require('../src/services/amazonPaymentClearingPreviewService')
const { buildOrderFeeBreakdown } = require('../src/services/amazonPaymentClearingOrderBreakdownService')
const { buildPaymentPreviewFromBatch } = require('../src/services/amazonPaymentClearingPaymentPreviewService')
const { postApprovedBatch } = require('../src/services/amazonPaymentClearingPostingService')
const {
  buildCustomerPaymentPayload,
  buildCustomerPaymentPayloadPreview,
  CHART_OF_ACCOUNTS_REQUIRED_SCOPE,
  resolveDepositAccount,
  todayLocalDate,
} = require('../src/services/amazonPaymentClearingZohoPaymentService')
const { ZOHO_OAUTH_SCOPES, ZOHO_PAYMENT_CLEARING_GRANULAR_SCOPES } = require('../src/integrations/zoho/zohoOAuth')
const paymentClearingRoutes = require('../src/routes/amazonPaymentClearing.routes')

test('settlement parser normalizes rows and warnings', () => {
  const text = [
    'settlement-id\tsettlement-start-date\tsettlement-end-date\tdeposit-date\tcurrency\ttransaction-type\torder-id\tamount-type\tamount-description\tamount\tsku\tquantity-purchased\tmarketplace-name',
    'SET123\t2026-01-01\t2026-01-07\t2026-01-09\tSAR\tOrder\t701-1\tItemPrice\tPrincipal\t100\tSKU-1\t1\tAmazon.sa',
    'SET123\t2026-01-01\t2026-01-07\t2026-01-09\tSAR\tServiceFee\t\tFee\tCommission\t-15\tSKU-1\t\tAmazon.sa',
  ].join('\n')
  const parsed = parseAmazonSettlementReport(text)
  assert.equal(parsed.rawRowCount, 2)
  assert.equal(parsed.rows[0].settlementId, 'SET123')
  assert.equal(parsed.rows[0].orderId, '701-1')
  assert.equal(parsed.rows[0].amount, 100)
  assert.equal(parsed.rows[0].category, CATEGORY.PRINCIPAL)
  assert.equal(parsed.rows[0].rowClass, ROW_CLASS.SALE)
  assert.equal(parsed.metadata.currency, 'SAR')
  assert.ok(parsed.warnings.some((w) => w.includes('do not include an Amazon order ID')))
})

test('category mapping handles fees refunds and withheld tax', () => {
  assert.equal(
    categorizeSettlementRow({ transactionType: 'Order', amountType: 'ItemPrice', amountDescription: 'Principal', amount: 10 }),
    CATEGORY.PRINCIPAL
  )
  assert.equal(
    categorizeSettlementRow({ transactionType: 'ServiceFee', amountType: 'Fee', amountDescription: 'FBA Fulfillment Fee', amount: -4 }),
    CATEGORY.FBA_FULFILLMENT_FEE
  )
  assert.equal(
    categorizeSettlementRow({ transactionType: 'Refund', amountType: 'ItemPrice', amountDescription: 'Principal', amount: -10 }),
    CATEGORY.REFUND
  )
  assert.equal(
    categorizeSettlementRow({ transactionType: 'Return', amountType: 'ItemPrice', amountDescription: 'Principal', amount: -10 }),
    CATEGORY.RETURN
  )
  assert.equal(
    categorizeSettlementRow({ transactionType: 'Order', amountType: 'MarketplaceWithheldTax', amountDescription: 'Marketplace withheld tax', amount: -2 }),
    CATEGORY.MARKETPLACE_WITHHELD_TAX
  )
})

test('refund return matching reconciles Amazon refund rows to Zoho credit notes', () => {
  const rows = [
    {
      orderId: '701-return',
      transactionType: 'Refund',
      amountType: 'ItemPrice',
      amountDescription: 'Principal',
      amount: -100,
      category: CATEGORY.REFUND,
      rowClass: ROW_CLASS.REFUND,
      originalRawRow: { raw: 'kept' },
    },
  ]
  const invoices = [
    { invoice_id: 'zinv1', invoice_number: 'INV-1', reference_number: '701-return', customer_id: 'cust1', customer_name: 'KSA-Amazon', total: 100 },
  ]
  const creditNotes = [
    { creditnote_id: 'cn1', creditnote_number: 'CN-1', reference_number: '701-return', customer_id: 'cust1', total: 100, status: 'open' },
  ]

  const result = matchRefundReturnRowsToCreditNotes(rows, invoices, creditNotes)

  assert.equal(result.matchedReturns.length, 1)
  assert.equal(result.matchedReturns[0].zohoInvoiceId, 'zinv1')
  assert.equal(result.matchedReturns[0].zohoCreditNoteId, 'cn1')
  assert.equal(result.matchedReturns[0].amazonRefundAmount, 100)
  assert.equal(result.matchedReturns[0].creditNoteAmount, 100)
  assert.equal(result.matchedReturns[0].creditNoteDifference, 0)
  assert.equal(result.matchedReturns[0].status, 'matched')
  assert.deepEqual(result.matchedReturns[0].originalRawRow, { raw: 'kept' })
  assert.equal(result.creditNoteBlockingRows.length, 0)
})

test('preview separates sales from refunds and blocks missing credit notes', () => {
  const rows = [
    { orderId: '701-sale', amount: 100, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    { orderId: '701-sale', amount: -12, category: CATEGORY.COMMISSION, rowClass: ROW_CLASS.FEE, amountType: 'ItemFees', amountDescription: 'Commission', transactionType: 'Order' },
    { orderId: '701-return', amount: -50, category: CATEGORY.REFUND, rowClass: ROW_CLASS.REFUND, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Refund' },
  ]
  const invoices = [
    { invoice_id: 'zsale', invoice_number: 'INV-SALE', reference_number: '701-sale', customer_name: 'KSA-Amazon', total: 100 },
    { invoice_id: 'zreturn', invoice_number: 'INV-RETURN', reference_number: '701-return', customer_name: 'KSA-Amazon', total: 50 },
  ]
  const creditNoteMatch = matchRefundReturnRowsToCreditNotes([rows[2]], invoices, [])
  const preview = buildPreview({
    rows,
    invoices,
    matchedReturns: creditNoteMatch.matchedReturns,
    missingCreditNotes: creditNoteMatch.missingCreditNotes,
    creditNoteBlockingRows: creditNoteMatch.creditNoteBlockingRows,
    report: { reportDocumentId: 'doc1', currency: 'SAR' },
  })

  assert.equal(preview.matchedOrders.length, 1)
  assert.equal(preview.matchedOrders[0].orderId, '701-sale')
  assert.equal(preview.totals.refundReturnTotal, -50)
  assert.equal(preview.reconciliationSummary.refundReturnImpact, -50)
  assert.equal(preview.reconciliationSummary.expectedAmazonDeposit, 38)
  assert.equal(preview.reconciliationSummary.actualAmazonSettlement, 38)
  assert.equal(preview.missingCreditNotes.length, 1)
  assert.equal(preview.creditNoteBlockingRows.length, 1)
  assert.match(preview.creditNoteBlockingRows[0].blockingReason, /Missing Credit Note/)
  assert.ok(preview.warnings.some((warning) => warning.includes('refund/return row')))
})

test('category mapping classifies settlement-level Amazon fee rows', () => {
  assert.equal(
    categorizeSettlementRow({
      transactionType: 'ServiceFee',
      amountType: 'Cost of Advertising',
      amountDescription: 'TransactionTotalAmount',
      amount: -2281.81,
    }),
    CATEGORY.ADVERTISING_FEE
  )
  assert.equal(
    categorizeSettlementRow({
      transactionType: 'AmazonFees',
      amountType: 'Premium Services Fee',
      amountDescription: 'Base fee',
      amount: -2544.98,
    }),
    CATEGORY.PREMIUM_SERVICES_FEE
  )
  assert.equal(
    categorizeSettlementRow({
      transactionType: 'AmazonFees',
      amountType: 'Premium Services Fee',
      amountDescription: 'Tax on fee',
      amount: -127.25,
    }),
    CATEGORY.PREMIUM_SERVICES_FEE_TAX
  )
  assert.equal(
    categorizeSettlementRow({
      transactionType: 'other-transaction',
      amountType: 'other-transaction',
      amountDescription: 'Storage Fee',
      amount: -4.15,
    }),
    CATEGORY.STORAGE_FEE
  )
  assert.equal(
    categorizeSettlementRow({
      transactionType: 'other-transaction',
      amountType: 'other-transaction',
      amountDescription: 'StorageRenewalBilling',
      amount: -187.62,
    }),
    CATEGORY.STORAGE_FEE
  )
  assert.equal(
    categorizeSettlementRow({
      transactionType: 'other-transaction',
      amountType: 'other-transaction',
      amountDescription: 'Amazon Easy Ship Charges',
      amount: -24.68,
    }),
    CATEGORY.EASY_SHIP_CHARGES
  )
})

test('settlement-level fee rows are excluded from order breakdown and included in settlementLevelFees', () => {
  const rows = [
    {
      orderId: '701-1',
      transactionType: 'Order',
      amountType: 'ItemPrice',
      amountDescription: 'Principal',
      amount: 100,
      category: CATEGORY.PRINCIPAL,
    },
    {
      orderId: '701-1',
      transactionType: 'Order',
      amountType: 'ItemFees',
      amountDescription: 'Commission',
      amount: -12,
      category: CATEGORY.COMMISSION,
    },
    {
      orderId: '',
      transactionType: 'ServiceFee',
      amountType: 'Cost of Advertising',
      amountDescription: 'TransactionTotalAmount',
      amount: -2281.81,
      category: CATEGORY.ADVERTISING_FEE,
    },
    {
      orderId: '',
      transactionType: 'AmazonFees',
      amountType: 'Premium Services Fee',
      amountDescription: 'Base fee',
      amount: -2544.98,
      category: CATEGORY.PREMIUM_SERVICES_FEE,
    },
    {
      orderId: '',
      transactionType: 'other-transaction',
      amountType: 'other-transaction',
      amountDescription: 'StorageRenewalBilling',
      amount: -187.62,
      category: CATEGORY.STORAGE_FEE,
    },
    {
      orderId: '',
      transactionType: '',
      amountType: '',
      amountDescription: '',
      amount: 0,
      category: CATEGORY.OTHER,
    },
  ]
  const invoices = [{ invoice_id: 'z1', invoice_number: 'INV-1', reference_number: '701-1', customer_name: 'KSA-Amazon', total: 100 }]
  const preview = buildPreview({ rows, invoices, report: { reportDocumentId: 'doc1', currency: 'SAR' } })

  assert.equal(preview.matchedOrders.length, 1)
  assert.equal(preview.matchedOrders[0].principalTotal, 100)
  assert.equal(preview.matchedOrders[0].commissionTotal, -12)
  assert.equal(preview.matchedOrders[0].netSettlementAmount, 88)

  assert.equal(preview.settlementLevelFees.length, 3)
  assert.deepEqual(
    preview.settlementLevelFees.map((row) => row.category),
    [CATEGORY.ADVERTISING_FEE, CATEGORY.PREMIUM_SERVICES_FEE, CATEGORY.STORAGE_FEE]
  )
  assert.equal(preview.totals.orderLevelFeesTotal, -12)
  assert.equal(preview.totals.settlementLevelFeesTotal, -5014.41)
  assert.equal(preview.totals.feesTotal, -5026.41)

  const advertising = preview.settlementLevelFees.find((row) => row.category === CATEGORY.ADVERTISING_FEE)
  assert.equal(advertising.count, 1)
  assert.equal(advertising.total, -2281.81)
})

test('reconciliation summary calculates expected deposit and reconciled status', () => {
  const rows = [
    {
      orderId: '701-1',
      transactionType: 'Order',
      amountType: 'ItemPrice',
      amountDescription: 'Principal',
      amount: 1000,
      category: CATEGORY.PRINCIPAL,
    },
    {
      orderId: '701-1',
      transactionType: 'Order',
      amountType: 'ItemFees',
      amountDescription: 'Commission',
      amount: -100,
      category: CATEGORY.COMMISSION,
    },
    {
      orderId: '701-2',
      transactionType: 'Order',
      amountType: 'ItemPrice',
      amountDescription: 'Principal',
      amount: 500,
      category: CATEGORY.PRINCIPAL,
    },
    {
      orderId: '701-2',
      transactionType: 'Order',
      amountType: 'ItemFees',
      amountDescription: 'FBAPerUnitFulfillmentFee',
      amount: -50,
      category: CATEGORY.FBA_FULFILLMENT_FEE,
    },
    {
      orderId: '',
      transactionType: 'ServiceFee',
      amountType: 'Cost of Advertising',
      amountDescription: 'TransactionTotalAmount',
      amount: -200,
      category: CATEGORY.ADVERTISING_FEE,
    },
    {
      orderId: '',
      transactionType: 'AmazonFees',
      amountType: 'Premium Services Fee',
      amountDescription: 'Base fee',
      amount: -75,
      category: CATEGORY.PREMIUM_SERVICES_FEE,
    },
    {
      orderId: '',
      transactionType: 'AmazonFees',
      amountType: 'Premium Services Fee',
      amountDescription: 'Tax on fee',
      amount: -3.75,
      category: CATEGORY.PREMIUM_SERVICES_FEE_TAX,
    },
    {
      orderId: '',
      transactionType: 'other-transaction',
      amountType: 'other-transaction',
      amountDescription: 'StorageRenewalBilling',
      amount: -10,
      category: CATEGORY.STORAGE_FEE,
    },
    {
      orderId: '',
      transactionType: 'other-transaction',
      amountType: 'other-transaction',
      amountDescription: 'Amazon Easy Ship Charges',
      amount: -5,
      category: CATEGORY.EASY_SHIP_CHARGES,
    },
    {
      orderId: '',
      transactionType: 'other-transaction',
      amountType: 'other-transaction',
      amountDescription: 'Manual Other Charge',
      amount: -6.25,
      category: CATEGORY.OTHER_AMAZON_FEE,
    },
  ]
  const invoices = [
    { invoice_id: 'z1', invoice_number: 'INV-1', reference_number: '701-1', customer_name: 'KSA-Amazon', total: 1000 },
    { invoice_id: 'z2', invoice_number: 'INV-2', reference_number: '701-2', customer_name: 'KSA-Amazon', total: 500 },
  ]
  const preview = buildPreview({ rows, invoices, report: { reportDocumentId: 'doc1', currency: 'SAR' } })
  const summary = preview.reconciliationSummary

  assert.equal(summary.orderLevelNetBalance, 1350)
  assert.equal(summary.settlementLevelDeductions, -300)
  assert.equal(summary.advertisingFeeTotal, -200)
  assert.equal(summary.premiumServiceFeeTotal, -75)
  assert.equal(summary.premiumServiceFeeTaxTotal, -3.75)
  assert.equal(summary.storageFeeTotal, -10)
  assert.equal(summary.easyShipChargesTotal, -5)
  assert.equal(summary.otherSettlementFeeTotal, -6.25)
  assert.equal(summary.expectedAmazonDeposit, 1050)
  assert.equal(summary.actualAmazonSettlement, 1050)
  assert.equal(summary.reconciliationDifference, 0)
  assert.equal(summary.reconciliationStatus, 'reconciled')
})

test('reconciliation summary reports mismatch status and warning when settlement does not tie out', () => {
  const rows = [
    {
      orderId: '701-1',
      transactionType: 'Order',
      amountType: 'ItemPrice',
      amountDescription: 'Principal',
      amount: 100,
      category: CATEGORY.PRINCIPAL,
    },
    {
      orderId: '701-1',
      transactionType: 'Order',
      amountType: 'ItemFees',
      amountDescription: 'Commission',
      amount: -10,
      category: CATEGORY.COMMISSION,
    },
    {
      orderId: '',
      transactionType: 'ServiceFee',
      amountType: 'Cost of Advertising',
      amountDescription: 'TransactionTotalAmount',
      amount: -20,
      category: CATEGORY.ADVERTISING_FEE,
    },
    {
      orderId: 'unmatched-order',
      transactionType: 'Order',
      amountType: 'ItemPrice',
      amountDescription: 'Principal',
      amount: 1,
      category: CATEGORY.PRINCIPAL,
    },
  ]
  const invoices = [{ invoice_id: 'z1', invoice_number: 'INV-1', reference_number: '701-1', customer_name: 'KSA-Amazon', total: 100 }]
  const preview = buildPreview({ rows, invoices, report: { reportDocumentId: 'doc1', currency: 'SAR' } })

  assert.equal(preview.reconciliationSummary.orderLevelNetBalance, 90)
  assert.equal(preview.reconciliationSummary.settlementLevelDeductions, -20)
  assert.equal(preview.reconciliationSummary.expectedAmazonDeposit, 70)
  assert.equal(preview.reconciliationSummary.actualAmazonSettlement, 71)
  assert.equal(preview.reconciliationSummary.reconciliationDifference, 1)
  assert.equal(preview.reconciliationSummary.reconciliationStatus, 'mismatch')
  assert.ok(preview.warnings.includes('Settlement total does not match calculated expected deposit.'))
})

test('normalizeSettlementDate parses Amazon DD.MM.YYYY timestamps to ISO', () => {
  assert.equal(normalizeSettlementDate('07.05.2026 00:00:00 UTC'), '2026-05-07')
  assert.equal(normalizeSettlementDate('13.05.2026 00:00:00 UTC'), '2026-05-13')
  assert.equal(normalizeSettlementDate('2026-05-07'), '2026-05-07')
})

test('deriveInvoiceRange handles Amazon settlement date format', () => {
  const range = deriveInvoiceRange([
    {
      settlementStartDate: '07.05.2026 00:00:00 UTC',
      settlementEndDate: '13.05.2026 00:00:00 UTC',
      depositDate: '15.05.2026 00:00:00 UTC',
      postedDate: '10.05.2026 00:00:00 UTC',
      orderId: '171-2114106-6893157',
    },
  ])
  assert.equal(range.settlementFromDate, '2026-05-07')
  assert.equal(range.settlementToDate, '2026-05-15')
  assert.equal(range.fromDate, '2026-01-07')
  assert.equal(range.toDate, '2026-05-15')
})

test('deriveInvoiceRange pads Zoho fetch window backward from settlement dates', () => {
  const range = deriveInvoiceRange([
    { settlementStartDate: '2026-05-01', settlementEndDate: '2026-05-15', depositDate: '2026-05-20', postedDate: '2026-05-10' },
  ])
  assert.equal(range.settlementFromDate, '2026-05-01')
  assert.equal(range.settlementToDate, '2026-05-20')
  assert.equal(range.fromDate, '2026-01-01')
  assert.equal(range.toDate, '2026-05-20')
})

test('Zoho matcher matches Amazon order ID to Zoho PO number first', () => {
  const rows = [{ orderId: ' 171-2114106-6893157 ', amount: 100 }]
  const invoices = [
    {
      invoice_id: 'z1',
      invoice_number: 'INV-039462',
      reference_number: '171-2114106-6893157',
      customer_name: 'KSA-Amazon',
      total: 100,
    },
  ]
  const result = matchSettlementRowsToInvoices(rows, invoices)
  assert.equal(result.matchedRows.length, 1)
  assert.equal(result.matchedRows[0].matchType, 'po_number')
  assert.equal(result.matchedRows[0].zohoInvoice.zohoPoNumber, '171-2114106-6893157')
  assert.equal(result.unmatchedRows.length, 0)
})

test('Zoho matcher falls back to invoice_number when PO number does not match', () => {
  const rows = [{ orderId: '701-1', amount: 100 }]
  const invoices = [
    { invoice_id: 'z1', invoice_number: '701-1', reference_number: 'PO-OTHER', customer_name: 'KSA-Amazon', total: 100 },
  ]
  const result = matchSettlementRowsToInvoices(rows, invoices)
  assert.equal(result.matchedRows.length, 1)
  assert.equal(result.matchedRows[0].matchType, 'invoice_number_fallback')
})

test('Zoho matcher reports duplicate PO and invoice numbers plus missing order rows', () => {
  const rows = [
    { orderId: '701-1', amount: 100 },
    { orderId: '701-2', amount: 50 },
    { orderId: '', amount: -5 },
  ]
  const invoices = [
    { invoice_id: 'z1', invoice_number: 'INV-1', reference_number: '701-1', customer_name: 'KSA-Amazon', total: 100 },
    { invoice_id: 'z2', invoice_number: 'INV-1', reference_number: '701-1', customer_name: 'KSA-Amazon', total: 100 },
  ]
  const result = matchSettlementRowsToInvoices(rows, invoices)
  assert.equal(result.matchedRows.length, 1)
  assert.equal(result.unmatchedRows.length, 2)
  assert.deepEqual(result.unmatchedOrderIds, ['701-2'])
  assert.deepEqual(result.duplicateZohoInvoiceNumbers, ['INV-1'])
  assert.deepEqual(result.duplicateZohoPoNumbers, ['701-1'])
  assert.equal(result.missingOrderIdRows.length, 1)
})

test('Zoho matcher leaves order unmatched when neither PO nor invoice number matches', () => {
  const result = matchSettlementRowsToInvoices(
    [{ orderId: '701-9', amount: 100 }],
    [{ invoice_id: 'z1', invoice_number: 'INV-9', reference_number: 'PO-9', total: 100 }]
  )
  assert.equal(result.matchedRows.length, 0)
  assert.equal(result.unmatchedRows.length, 1)
  assert.deepEqual(result.unmatchedOrderIds, ['701-9'])
})

test('order fee breakdown uses exact Amazon settlement row rules', () => {
  const orderId = '171-5240962-0353145'
  const rows = [
    { orderId, transactionType: 'Order', amountType: 'ItemPrice', amountDescription: 'Principal', amount: 350 },
    { orderId, transactionType: 'Order', amountType: 'ItemPrice', amountDescription: 'Shipping', amount: 0 },
    { orderId, transactionType: 'Order', amountType: 'ItemFees', amountDescription: 'Commission', amount: -21 },
    { orderId, transactionType: 'Order', amountType: 'ItemFees', amountDescription: 'FBAPerUnitFulfillmentFee', amount: -189.6 },
    { orderId, transactionType: 'Order', amountType: 'ItemFees', amountDescription: 'VariableClosingFee', amount: -5 },
    { orderId, transactionType: 'Order', amountType: 'Promotion', amountDescription: 'Shipping', amount: -25 },
  ]
  const breakdown = buildOrderFeeBreakdown(rows)
  assert.equal(breakdown.principalTotal, 350)
  assert.equal(breakdown.shippingCollectedTotal, 0)
  assert.equal(breakdown.amazonOrderTotal, 350)
  assert.equal(breakdown.grossAmazonTotal, 350)
  assert.equal(breakdown.commissionTotal, -21)
  assert.equal(breakdown.fulfillmentFeeTotal, -189.6)
  assert.equal(breakdown.closingFeeTotal, -5)
  assert.equal(breakdown.shippingPromotionTotal, -25)
  assert.equal(breakdown.otherAmazonFeeTotal, 0)
  assert.equal(breakdown.totalFees, -240.6)
  assert.equal(breakdown.netSettlementAmount, 109.4)
})

test('order fee breakdown routes refund rows and other negative fees separately', () => {
  const orderId = '701-refund'
  const rows = [
    { orderId, transactionType: 'Refund', amountType: 'ItemPrice', amountDescription: 'Principal', amount: -100 },
    { orderId, transactionType: 'Order', amountType: 'ItemPrice', amountDescription: 'Principal', amount: 150 },
    { orderId, transactionType: 'Order', amountType: 'ItemFees', amountDescription: 'Commission', amount: -9 },
    { orderId, transactionType: 'Order', amountType: 'ItemFees', amountDescription: 'Digital Services Fee', amount: -2.5 },
  ]
  const breakdown = buildOrderFeeBreakdown(rows)
  assert.equal(breakdown.refundTotal, -100)
  assert.equal(breakdown.principalTotal, 150)
  assert.equal(breakdown.commissionTotal, -9)
  assert.equal(breakdown.otherAmazonFeeTotal, -2.5)
  assert.equal(breakdown.totalFees, -11.5)
  assert.equal(breakdown.netSettlementAmount, 38.5)
})

test('preview totals matched and unmatched orders', () => {
  const rows = [
    { orderId: '701-1', amount: 100, category: CATEGORY.PRINCIPAL, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    { orderId: '701-1', amount: -12, category: CATEGORY.COMMISSION, amountType: 'ItemFees', amountDescription: 'Commission', transactionType: 'Order' },
    { orderId: '701-2', amount: 50, category: CATEGORY.PRINCIPAL, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    { orderId: '701-2', amount: -6, category: CATEGORY.FBA_FULFILLMENT_FEE, amountType: 'ItemFees', amountDescription: 'FBAPerUnitFulfillmentFee', transactionType: 'Order' },
  ]
  const invoices = [{ invoice_id: 'z1', invoice_number: 'INV-1', reference_number: '701-1', customer_name: 'KSA-Amazon', total: 100 }]
  const preview = buildPreview({ rows, invoices, report: { reportDocumentId: 'doc1', currency: 'SAR' } })
  assert.equal(preview.totals.amazonSettlementTotal, 132)
  assert.equal(preview.totals.productSalesTotal, 150)
  assert.equal(preview.totals.feesTotal, -18)
  assert.equal(preview.totals.matchedInvoiceTotal, 100)
  assert.equal(preview.totals.unmatchedOrderTotal, 50)
  assert.equal(preview.matchedOrders.length, 1)
  assert.equal(preview.matchedOrders[0].principalTotal, 100)
  assert.equal(preview.matchedOrders[0].commissionTotal, -12)
  assert.equal(preview.matchedOrders[0].netSettlementAmount, 88)
  assert.equal(preview.unmatchedOrders.length, 1)
  assert.equal(preview.unmatchedOrders[0].netSettlementAmount, 44)
})

test('orderSummary exposes full fee breakdown on matched orders', () => {
  const rows = [
    { orderId: '171-5240962-0353145', transactionType: 'Order', amountType: 'ItemPrice', amountDescription: 'Principal', amount: 350 },
    { orderId: '171-5240962-0353145', transactionType: 'Order', amountType: 'ItemFees', amountDescription: 'Commission', amount: -21 },
    { orderId: '171-5240962-0353145', transactionType: 'Order', amountType: 'ItemFees', amountDescription: 'FBAPerUnitFulfillmentFee', amount: -189.6 },
    { orderId: '171-5240962-0353145', transactionType: 'Order', amountType: 'ItemFees', amountDescription: 'VariableClosingFee', amount: -5 },
    { orderId: '171-5240962-0353145', transactionType: 'Order', amountType: 'Promotion', amountDescription: 'Shipping', amount: -25 },
  ]
  const summary = orderSummary('171-5240962-0353145', rows, {
    zohoInvoiceId: 'z1',
    zohoInvoiceNumber: 'INV-100',
    zohoPoNumber: '171-5240962-0353145',
    zohoCustomerName: 'KSA-Amazon',
    zohoInvoiceTotal: 350,
    matchType: 'po_number',
  })
  assert.equal(summary.netSettlementAmount, 109.4)
  assert.equal(summary.netAmount, 109.4)
  assert.equal(summary.grossAmazonTotal, 350)
})

test('payment preview splits invoice into net, commission, and shipping/FBA payments', () => {
  const batch = {
    batchId: 10,
    status: 'approved',
    reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
    unmatchedOrders: [],
    matchedOrders: [
      {
        orderId: '171-1',
        zohoInvoiceId: 'z1',
        zohoInvoiceNumber: 'INV-1',
        zohoPoNumber: '171-1',
        zohoCustomerName: 'KSA-Amazon',
        zohoInvoiceTotal: 2329,
        principalTotal: 2329,
        commissionTotal: -342.36,
        fulfillmentFeeTotal: -54.05,
        closingFeeTotal: 0,
        shippingPromotionTotal: 0,
        otherAmazonFeeTotal: 0,
      },
    ],
    settlementLevelFees: [
      { category: CATEGORY.ADVERTISING_FEE, total: -4224.85 },
      { category: CATEGORY.STORAGE_FEE, total: -187.62 },
    ],
  }
  const preview = buildPaymentPreviewFromBatch(batch)
  const row = preview.payments[0]

  assert.equal(row.netBalancePayment.amount, 1932.59)
  assert.equal(row.netBalancePayment.depositToAccountCode, '1024')
  assert.equal(row.commissionPayment.amount, 342.36)
  assert.equal(row.commissionPayment.depositToAccountCode, '1026')
  assert.equal(row.shippingFbaPayment.amount, 54.05)
  assert.equal(row.shippingFbaPayment.depositToAccountCode, '1028')
  assert.equal(row.totalClearingAmount, 2329)
  assert.equal(row.remainingDifference, 0)
  assert.equal(row.status, 'ready')
  assert.equal(preview.paymentPlanSummary.invoiceCount, 1)
  assert.equal(preview.paymentPlanSummary.paymentEntryCount, 3)
  assert.equal(preview.paymentPlanSummary.totalPaymentAmount, 2329)
  assert.equal(preview.paymentPlanSummary.zohoInvoiceTotal, 2329)
  assert.equal(preview.paymentPlanSummary.difference, 0)
})

test('payment preview converts negative order fees to positive payment amounts and excludes settlement-level fees', () => {
  const preview = buildPaymentPreviewFromBatch({
    batchId: 11,
    status: 'approved',
    reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
    unmatchedOrders: [],
    matchedOrders: [
      {
        orderId: '171-2',
        zohoInvoiceTotal: 500,
        principalTotal: 500,
        commissionTotal: -50,
        fulfillmentFeeTotal: -20,
        closingFeeTotal: -10,
        shippingPromotionTotal: -5,
        otherAmazonFeeTotal: -15,
      },
    ],
    settlementLevelFees: [{ category: CATEGORY.PREMIUM_SERVICES_FEE, total: -999 }],
  })
  const row = preview.payments[0]

  assert.equal(row.commissionPayment.amount, 50)
  assert.equal(row.shippingFbaPayment.amount, 50)
  assert.equal(row.totalClearingAmount, 500)
  assert.equal(preview.paymentPlanSummary.shippingFbaClearingTotal, 50)
})

test('payment preview uses zero shipping offset when shipping collected fully offsets promotion', () => {
  const preview = buildPaymentPreviewFromBatch({
    batchId: 14,
    status: 'approved',
    reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
    unmatchedOrders: [],
    matchedOrders: [
      {
        orderId: '171-shipping-offset',
        zohoInvoiceTotal: 1065,
        principalTotal: 1065,
        shippingCollectedTotal: 7,
        shippingPromotionTotal: -7,
        commissionTotal: -156.56,
        fulfillmentFeeTotal: -32.2,
        closingFeeTotal: 0,
        otherAmazonFeeTotal: 0,
      },
    ],
  })
  const row = preview.payments[0]

  assert.equal(row.shippingOffsetTotal, 0)
  assert.equal(row.invoiceClearingNetBalance, 876.24)
  assert.equal(row.netBalancePayment.amount, 876.24)
  assert.equal(row.commissionPayment.amount, 156.56)
  assert.equal(row.shippingFbaPayment.amount, 32.2)
  assert.equal(row.totalClearingAmount, 1065)
  assert.equal(row.remainingDifference, 0)
  assert.equal(row.status, 'ready')
})

test('payment preview uses negative shipping offset when promotion has no collected shipping', () => {
  const preview = buildPaymentPreviewFromBatch({
    batchId: 15,
    status: 'approved',
    reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
    unmatchedOrders: [],
    matchedOrders: [
      {
        orderId: '171-shipping-promo-only',
        zohoInvoiceTotal: 1065,
        principalTotal: 1065,
        grossAmazonTotal: 999999,
        shippingCollectedTotal: 0,
        shippingPromotionTotal: -7,
        commissionTotal: -156.56,
        fulfillmentFeeTotal: -32.2,
        closingFeeTotal: 0,
        otherAmazonFeeTotal: 0,
      },
    ],
  })
  const row = preview.payments[0]

  assert.equal(row.shippingOffsetTotal, -7)
  assert.equal(row.invoiceClearingNetBalance, 869.24)
  assert.equal(row.netBalancePayment.amount, 869.24)
  assert.equal(row.commissionPayment.amount, 156.56)
  assert.equal(row.shippingFbaPayment.amount, 39.2)
  assert.equal(row.totalClearingAmount, 1065)
  assert.equal(row.remainingDifference, 0)
  assert.equal(row.status, 'ready')
})

test('payment preview calculates remaining difference and mismatch invoice status', () => {
  const preview = buildPaymentPreviewFromBatch({
    batchId: 12,
    status: 'approved',
    reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
    unmatchedOrders: [],
    matchedOrders: [
      {
        orderId: '171-3',
        zohoInvoiceTotal: 105,
        principalTotal: 100,
        commissionTotal: -10,
        fulfillmentFeeTotal: -5,
        closingFeeTotal: 0,
        shippingPromotionTotal: 0,
        otherAmazonFeeTotal: 0,
      },
    ],
  })

  assert.equal(preview.payments[0].totalClearingAmount, 100)
  assert.equal(preview.payments[0].remainingDifference, 5)
  assert.equal(preview.payments[0].status, 'mismatch')
  assert.equal(preview.paymentPlanSummary.difference, 5)
  assert.equal(preview.warnings.length, 1)
})

test('payment preview rejects unapproved, unreconciled, and unmatched batches', () => {
  assert.throws(
    () => buildPaymentPreviewFromBatch({ status: 'previewed', reconciliationSummary: {}, unmatchedOrders: [], matchedOrders: [] }),
    /approved settlement batch/
  )
  assert.throws(
    () => buildPaymentPreviewFromBatch({
      status: 'approved',
      reconciliationSummary: { reconciliationStatus: 'mismatch', reconciliationDifference: 1 },
      unmatchedOrders: [],
      matchedOrders: [],
    }),
    /reconciled settlement batch/
  )
  assert.throws(
    () => buildPaymentPreviewFromBatch({
      status: 'approved',
      reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
      unmatchedOrders: [{ orderId: 'unmatched' }],
      matchedOrders: [],
    }),
    /zero unmatched orders/
  )
  assert.throws(
    () => buildPaymentPreviewFromBatch({
      status: 'approved',
      reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
      unmatchedOrders: [],
      creditNoteBlockingRows: [{ orderId: 'return-1', blockingReason: 'Missing Credit Note' }],
      matchedOrders: [],
    }),
    /refund\/return rows/
  )
})

function postingBatch(overrides = {}) {
  return {
    batchId: 90,
    status: 'approved',
    reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
    unmatchedOrders: [],
    matchedOrders: [
      {
        orderId: '171-1',
        zohoInvoiceId: 'zinv1',
        zohoInvoiceNumber: 'INV-1',
        zohoCustomerId: 'cust1',
        zohoInvoiceTotal: 100,
        principalTotal: 100,
        commissionTotal: -10,
        fulfillmentFeeTotal: -5,
        closingFeeTotal: 0,
        shippingCollectedTotal: 0,
        shippingPromotionTotal: 0,
        otherAmazonFeeTotal: 0,
      },
    ],
    ...overrides,
  }
}

function fakePostingStore(existing = [], previewBatch = postingBatch()) {
  const postings = [...existing]
  return {
    postedBy: null,
    async getLatestPaymentPreviewForBatch(batchId) {
      return buildPaymentPreviewFromBatch({ ...previewBatch, batchId })
    },
    async findPosting(batchId, invoiceId, paymentType) {
      return postings.find((row) => row.batchId === batchId && row.invoiceId === invoiceId && row.paymentType === paymentType) || null
    },
    async findGroupedPosting(batchId, paymentType) {
      return postings.find((row) => row.batchId === batchId && row.paymentType === paymentType && row.postingGroupKey) || null
    },
    async insertPosting(row) {
      const existingRow = await this.findPosting(row.batchId, row.invoiceId, row.paymentType)
      if (existingRow) return existingRow
      const next = { id: postings.length + 1, ...row }
      postings.push(next)
      return next
    },
    async markBatchPosted(_batchId, postedBy) {
      this.postedBy = postedBy
      return postingBatch({ status: 'posted', postedBy })
    },
    postings,
  }
}

function fakePayloadPreview(payment) {
  return {
    customer_id: payment.customerId,
    invoice_id: payment.invoiceId || payment.invoices?.[0]?.invoiceId || '',
    invoices: (payment.invoices || []).map((invoice) => ({
      invoice_id: invoice.invoiceId,
      amount_applied: invoice.amountApplied,
    })),
    amount: payment.amount,
    payment_date: payment.paymentDate,
    account_id: `acct-${payment.depositToAccountCode}`,
    account_name: payment.depositToAccountName,
    reference_number: payment.referenceNumber,
  }
}

function postingBatchWithInvoiceCount(count, overrides = {}) {
  const matchedOrders = Array.from({ length: count }, (_, i) => ({
    orderId: `171-${i + 1}`,
    zohoInvoiceId: `zinv${i + 1}`,
    zohoInvoiceNumber: `INV-${i + 1}`,
    zohoCustomerId: 'cust1',
    zohoInvoiceTotal: 100,
    principalTotal: 100,
    commissionTotal: -10,
    fulfillmentFeeTotal: -5,
    closingFeeTotal: 0,
    shippingCollectedTotal: 0,
    shippingPromotionTotal: 0,
    otherAmazonFeeTotal: 0,
  }))
  return postingBatch({ matchedOrders, ...overrides })
}

test('payment posting dry run validates without creating Zoho payments or posting rows', async () => {
  const store = fakePostingStore()
  let calls = 0
  const result = await postApprovedBatch({
    batch: postingBatch(),
    store,
    dryRun: true,
    createPayment: async () => {
      calls += 1
      return { zohoPaymentId: 'should-not-run' }
    },
    buildPayloadPreview: fakePayloadPreview,
  })

  assert.equal(result.dryRun, true)
  assert.equal(result.payments.length, 3)
  assert.equal(result.summary.paymentsCreated, 0)
  assert.equal(result.summary.paymentsSkipped, 0)
  assert.equal(store.postings.length, 0)
  assert.equal(calls, 0)
  assert.deepEqual(
    result.payments.map((payment) => payment.zohoPayloadPreview.payment_date),
    [todayLocalDate(), todayLocalDate(), todayLocalDate()]
  )
  assert.deepEqual(
    result.payments.map((payment) => payment.zohoPayloadPreview.account_id),
    ['acct-1024', 'acct-1026', 'acct-1028']
  )
})

test('payment posting prevents duplicates by batch invoice and payment type', async () => {
  const store = fakePostingStore([
    { batchId: 90, paymentType: 'net_balance', postingGroupKey: 'APC-90-net_balance', zohoPaymentId: 'pay-existing' },
  ])
  const created = []
  const result = await postApprovedBatch({
    batch: postingBatch(),
    store,
    dryRun: false,
    postedBy: 7,
    createPayment: async (payment) => {
      created.push(payment)
      return { zohoPaymentId: `pay-${created.length}` }
    },
    buildPayloadPreview: fakePayloadPreview,
  })

  assert.equal(result.summary.paymentsSkipped, 1)
  assert.equal(result.summary.paymentsCreated, 2)
  assert.equal(created.length, 2)
  assert.equal(store.postings.length, 3)
  assert.equal(store.postedBy, 7)
})

test('grouped posting creates three payments with eleven invoice allocations each', async () => {
  const batch = postingBatchWithInvoiceCount(11)
  const store = fakePostingStore([], batch)
  const created = []
  const result = await postApprovedBatch({
    batch,
    store,
    dryRun: false,
    createPayment: async (payment) => {
      created.push(payment)
      return { zohoPaymentId: `pay-${payment.depositToAccountCode}` }
    },
    buildPayloadPreview: fakePayloadPreview,
  })

  assert.equal(result.payments.length, 3)
  assert.equal(result.summary.invoicesPosted, 11)
  assert.equal(result.summary.paymentsCreated, 3)
  for (const payment of created) {
    assert.equal(payment.invoices.length, 11)
    const total = payment.invoices.reduce((sum, row) => sum + row.amountApplied, 0)
    assert.equal(payment.amount, total)
  }
  assert.equal(created.find((p) => p.referenceNumber.endsWith('net_balance')).amount, 935)
  assert.equal(created.find((p) => p.referenceNumber.endsWith('commission')).amount, 110)
  assert.equal(created.find((p) => p.referenceNumber.endsWith('shipping_fba')).amount, 55)
})

test('grouped posting rejects multiple customer ids', async () => {
  const batch = postingBatchWithInvoiceCount(2)
  batch.matchedOrders[1].zohoCustomerId = 'cust2'
  await assert.rejects(
    () => postApprovedBatch({
      batch,
      store: fakePostingStore([], batch),
      dryRun: true,
      buildPayloadPreview: fakePayloadPreview,
    }),
    /same customer/
  )
})

test('payment posting applies the same server-local date to all three Zoho payments', async () => {
  const store = fakePostingStore()
  const created = []
  await postApprovedBatch({
    batch: postingBatch(),
    store,
    dryRun: false,
    createPayment: async (payment) => {
      created.push(payment)
      return { zohoPaymentId: `pay-${created.length}` }
    },
    buildPayloadPreview: fakePayloadPreview,
  })

  assert.equal(created.length, 3)
  assert.deepEqual([...new Set(created.map((payment) => payment.paymentDate))], [todayLocalDate()])
})

test('Zoho customer payment payload uses explicit posting date', () => {
  const payload = buildCustomerPaymentPayload({
    invoiceId: 'zinv1',
    customerId: 'cust1',
    amount: 123.45,
    paymentDate: '2026-06-15',
    depositToAccountId: 'acct1024',
  })

  assert.equal(payload.date, '2026-06-15')
  assert.equal(payload.account_id, 'acct1024')
  assert.equal(payload.invoices[0].amount_applied, 123.45)
})

test('Zoho payment account resolution uses configured account id without chart lookup', async () => {
  const previous = process.env.AMAZON_KSA_ZOHO_PAYMENT_ACCOUNT_MAP
  process.env.AMAZON_KSA_ZOHO_PAYMENT_ACCOUNT_MAP = JSON.stringify({
    1024: {
      account_id: 'acct-static-1024',
      account_name: 'KSA-Amazon Undeposited Funds',
    },
  })
  try {
    const account = await resolveDepositAccount({
      depositToAccountCode: '1024',
      depositToAccountName: 'KSA-Amazon Undeposited Funds',
    })
    assert.equal(account.accountId, 'acct-static-1024')
    assert.equal(account.accountName, 'KSA-Amazon Undeposited Funds')
    assert.equal(account.source, 'AMAZON_KSA_ZOHO_PAYMENT_ACCOUNT_MAP')
  } finally {
    if (previous == null) delete process.env.AMAZON_KSA_ZOHO_PAYMENT_ACCOUNT_MAP
    else process.env.AMAZON_KSA_ZOHO_PAYMENT_ACCOUNT_MAP = previous
  }
})

test('Zoho OAuth scopes include accountant read for chart of accounts', () => {
  assert.equal(CHART_OF_ACCOUNTS_REQUIRED_SCOPE, 'ZohoBooks.accountants.READ')
  assert.ok(ZOHO_OAUTH_SCOPES.includes('ZohoBooks.fullaccess.all'))
  assert.ok(ZOHO_PAYMENT_CLEARING_GRANULAR_SCOPES.includes('ZohoBooks.accountants.READ'))
})

test('Zoho OAuth scopes include customer payment create for posting', () => {
  assert.ok(ZOHO_OAUTH_SCOPES.includes('ZohoBooks.fullaccess.all'))
  assert.ok(ZOHO_PAYMENT_CLEARING_GRANULAR_SCOPES.includes('ZohoBooks.customerpayments.CREATE'))
  assert.ok(ZOHO_PAYMENT_CLEARING_GRANULAR_SCOPES.includes('ZohoBooks.customerpayments.READ'))
  assert.ok(ZOHO_PAYMENT_CLEARING_GRANULAR_SCOPES.includes('ZohoBooks.customerpayments.UPDATE'))
})

test('payment posting supports partial rerun recovery', async () => {
  const store = fakePostingStore([
    { batchId: 90, paymentType: 'net_balance', postingGroupKey: 'APC-90-net_balance', zohoPaymentId: 'pay-net' },
    { batchId: 90, paymentType: 'commission', postingGroupKey: 'APC-90-commission', zohoPaymentId: 'pay-commission' },
  ])
  const result = await postApprovedBatch({
    batch: postingBatch(),
    store,
    dryRun: false,
    createPayment: async () => ({ zohoPaymentId: 'pay-shipping' }),
    buildPayloadPreview: fakePayloadPreview,
  })

  assert.equal(result.summary.paymentsSkipped, 2)
  assert.equal(result.summary.paymentsCreated, 1)
  assert.equal(store.postings.length, 3)
})

test('payment posting rejects already posted settlement', async () => {
  await assert.rejects(
    () => postApprovedBatch({
      batch: postingBatch({ status: 'posted' }),
      store: fakePostingStore(),
      dryRun: true,
      buildPayloadPreview: fakePayloadPreview,
    }),
    /already been posted/
  )
})

test('payment posting rejects missing or mismatched credit notes', async () => {
  await assert.rejects(
    () => postApprovedBatch({
      batch: postingBatch({
        creditNoteBlockingRows: [{ orderId: 'return-1', blockingReason: 'Missing Credit Note' }],
      }),
      store: fakePostingStore(),
      dryRun: true,
      buildPayloadPreview: fakePayloadPreview,
    }),
    /refund\/return rows/
  )
})

test('payment posting reports Zoho API failures without marking batch posted', async () => {
  const store = fakePostingStore()
  const result = await postApprovedBatch({
    batch: postingBatch(),
    store,
    dryRun: false,
    createPayment: async (payment) => {
      if (payment.depositToAccountCode === '1026') {
        const err = new Error('Zoho rejected commission payment')
        err.code = 'ZOHO_API_ERROR'
        throw err
      }
      return { zohoPaymentId: `pay-${payment.depositToAccountCode}` }
    },
    buildPayloadPreview: fakePayloadPreview,
  })

  assert.equal(result.summary.paymentsCreated, 2)
  assert.equal(result.summary.errors, 1)
  assert.equal(store.postedBy, null)
  assert.equal(store.postings.length, 2)
  assert.ok(result.errors[0].error.includes('Zoho rejected commission payment'))
})

test('payment clearing route is admin protected', () => {
  const stack = paymentClearingRoutes.stack.filter((layer) => layer.name !== 'query' && layer.name !== 'expressInit')
  assert.equal(stack[0].handle.name, 'requireAuth')
  assert.equal(stack[1].handle.name, 'requireAdmin')
})

test('payment clearing route exposes saved batch and approve endpoints', () => {
  const routes = paymentClearingRoutes.stack
    .map((layer) => layer.route)
    .filter(Boolean)
    .map((route) => ({
      path: route.path,
      methods: Object.keys(route.methods).sort(),
    }))

  assert.ok(routes.some((route) => route.path === '/ksa/batches/:id' && route.methods.includes('get')))
  assert.ok(routes.some((route) => route.path === '/zoho/account-diagnostics' && route.methods.includes('get')))
  assert.ok(routes.some((route) => route.path === '/zoho/oauth/authorize-url' && route.methods.includes('get')))
  assert.ok(routes.some((route) => route.path === '/zoho/oauth/callback' && route.methods.includes('get')))
  assert.ok(routes.some((route) => route.path === '/zoho/oauth/exchange' && route.methods.includes('post')))
  assert.ok(routes.some((route) => route.path === '/ksa/batches/:id/approve' && route.methods.includes('post')))
  assert.ok(routes.some((route) => route.path === '/ksa/batches/:id/payment-preview' && route.methods.includes('post')))
  assert.ok(routes.some((route) => route.path === '/ksa/batches/:id/post-to-zoho' && route.methods.includes('post')))
})
