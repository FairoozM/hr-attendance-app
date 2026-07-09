const test = require('node:test')
const assert = require('node:assert/strict')

const { parseAmazonSettlementReport, parseAmazonSettlementReportBuffer, normalizeSettlementDate } = require('../src/services/amazonSettlementParserService')
const { categorizeSettlementRow, CATEGORY, ROW_CLASS } = require('../src/services/amazonPaymentClearingCategoryService')
const {
  matchSettlementRowsToInvoices,
  matchRefundReturnRowsToCreditNotes,
  deriveInvoiceRange,
  resolveKsaZohoCustomerId,
  resolveKsaZohoCustomer,
  LEGACY_KSA_ZOHO_CUSTOMER_NAME,
} = require('../src/services/amazonPaymentClearingZohoMatcher')
const { buildPreview, orderSummary } = require('../src/services/amazonPaymentClearingPreviewService')
const { buildOrderFeeBreakdown, detectNetNegativeOrderRefundRows } = require('../src/services/amazonPaymentClearingOrderBreakdownService')
const { buildPaymentPreviewFromBatch } = require('../src/services/amazonPaymentClearingPaymentPreviewService')
const {
  applyLegacyCurrencyToSettlementRows,
  isLegacyKsaPaymentClearingCustomer,
  sarAmountToAed,
  settlementCurrencyForCustomer,
  applyLegacySettlementMismatchTolerance,
  isSettlementReconciliationAcceptable,
} = require('../src/services/amazonPaymentClearingCurrencyService')
const { postApprovedBatch, ensureCanPostBatch } = require('../src/services/amazonPaymentClearingPostingService')
const {
  buildSettlementReference,
  buildEntryReference,
  referenceNumberFor,
  descriptionFor,
} = require('../src/services/amazonPaymentClearingReferenceService')
const {
  buildCustomerPaymentPayload,
  buildCustomerPaymentPayloadPreview,
  buildManualJournalPayload,
  CHART_OF_ACCOUNTS_REQUIRED_SCOPE,
  resolveDepositAccount,
  todayLocalDate,
} = require('../src/services/amazonPaymentClearingZohoPaymentService')
const { ZOHO_OAUTH_SCOPES, ZOHO_PAYMENT_CLEARING_GRANULAR_SCOPES } = require('../src/integrations/zoho/zohoOAuth')
const {
  buildReturnFeeBreakdown,
  buildReturnFeePlan,
} = require('../src/services/amazonPaymentClearingReturnFeeService')
const {
  buildCreditNoteApplyPlan,
  resolvePlanRowAction,
} = require('../src/services/amazonPaymentClearingCreditNotePostingService')
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
  assert.equal(parsed.rows[1].rowClass, ROW_CLASS.NON_ORDER_LINKED_AMAZON_FEE)
  assert.equal(parsed.metadata.currency, 'SAR')
  assert.ok(parsed.warnings.some((w) => w.includes('account-level Amazon fee row(s) have no order ID expected')))
  assert.ok(!parsed.warnings.some((w) => w.includes('do not include an Amazon order ID')))
})

test('settlement parser accepts Seller Central buffer uploads with DD.MM.YYYY dates', () => {
  const text = [
    'settlement-id\tsettlement-start-date\tsettlement-end-date\tdeposit-date\ttotal-amount\tcurrency\ttransaction-type\torder-id\tamount-type\tamount-description\tamount\tmarketplace-name',
    '25101876372\t09.07.2025\t23.07.2025\t24.07.2025\t4427.15\tSAR\tOrder\t408-7440628-8909134\tItemPrice\tPrincipal\t219\tAmazon.sa',
  ].join('\n')
  const parsed = parseAmazonSettlementReportBuffer(Buffer.from(text, 'utf8'), 'legacy-settlement.tsv')
  assert.equal(parsed.metadata.settlementId, '25101876372')
  assert.equal(parsed.metadata.settlementStartDate, '2025-07-09')
  assert.equal(parsed.metadata.settlementEndDate, '2025-07-23')
  assert.equal(parsed.rows[0].amount, 219)
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

test('preview treats net-negative order rows as returns and excludes them from sales clearing', () => {
  const orderId = '406-2446480-5429962'
  const rows = [
    { orderId: '701-sale', amount: 100, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    { orderId: '701-sale', amount: -12, category: CATEGORY.COMMISSION, rowClass: ROW_CLASS.FEE, amountType: 'ItemFees', amountDescription: 'Commission', transactionType: 'Order' },
    { orderId, amount: -1132.51, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    { orderId, amount: 37.95, category: CATEGORY.COMMISSION, rowClass: ROW_CLASS.FEE, amountType: 'ItemFees', amountDescription: 'Commission', transactionType: 'Order' },
  ]
  const invoices = [
    { invoice_id: 'zsale', invoice_number: 'INV-SALE', reference_number: '701-sale', customer_name: 'KSA-Amazon', total: 100 },
    { invoice_id: 'zreturn', invoice_number: 'INV-041390', reference_number: orderId, customer_name: 'KSA-Amazon', total: 1132.51 },
  ]
  const syntheticRows = detectNetNegativeOrderRefundRows(rows)
  const creditNoteMatch = matchRefundReturnRowsToCreditNotes(syntheticRows, invoices, [])
  const preview = buildPreview({
    rows,
    invoices,
    matchedReturns: creditNoteMatch.matchedReturns,
    missingCreditNotes: creditNoteMatch.missingCreditNotes,
    creditNoteBlockingRows: creditNoteMatch.creditNoteBlockingRows,
    syntheticRefundRows: syntheticRows,
    netNegativeReturnOrderIds: syntheticRows.map((row) => row.orderId),
  })

  assert.equal(preview.matchedOrders.length, 1)
  assert.equal(preview.matchedOrders[0].orderId, '701-sale')
  assert.equal(preview.netNegativeReturnOrders.length, 1)
  assert.equal(preview.netNegativeReturnOrders[0].orderId, orderId)
  assert.ok(preview.netNegativeReturnOrders[0].principalTotal < 0)
  assert.equal(preview.creditNoteBlockingRows.length, 0)
  const readyReturn = (preview.matchedReturns || []).find((row) => row.orderId === orderId)
  assert.equal(readyReturn?.status, 'ready_to_create')
  assert.equal(readyReturn?.creditNoteAction, 'ready_to_create')

  const paymentPreview = buildPaymentPreviewFromBatch({
    status: 'approved',
    batchId: 1,
    matchedOrders: preview.matchedOrders,
    unmatchedOrders: [],
    matchedReturns: preview.matchedReturns,
    creditNoteBlockingRows: [],
    reconciliationSummary: { ...preview.reconciliationSummary, reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
    nonOrderLinkedAmazonFeeMappings: [],
  })
  assert.equal(paymentPreview.payments.length, 1)
  assert.equal(paymentPreview.payments[0].orderId, '701-sale')
})

test('payment preview excludes stale matched orders when settlement rows are net-negative', () => {
  const orderId = '406-2446480-5429962'
  const allRows = [
    { orderId: '701-sale', amount: 100, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    { orderId, amount: -1132.51, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    { orderId, amount: 37.95, category: CATEGORY.COMMISSION, rowClass: ROW_CLASS.FEE, amountType: 'ItemFees', amountDescription: 'Commission', transactionType: 'Order' },
  ]
  const paymentPreview = buildPaymentPreviewFromBatch({
    status: 'approved',
    batchId: 1,
    allRows,
    matchedOrders: [
      { orderId: '701-sale', principalTotal: 100, netSettlementAmount: 100, zohoInvoiceTotal: 100 },
      {
        orderId,
        principalTotal: 1132.51,
        netSettlementAmount: 1094.56,
        zohoInvoiceTotal: 1132.51,
        zohoInvoiceNumber: 'INV-041390',
      },
    ],
    reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
    nonOrderLinkedAmazonFeeMappings: [],
  })
  assert.equal(paymentPreview.payments.length, 1)
  assert.equal(paymentPreview.payments[0].orderId, '701-sale')
  assert.ok(!paymentPreview.payments.some((row) => row.orderId === orderId))
})

test('payment preview excludes orders with explicit Amazon refund rows', () => {
  const orderId = '406-2446480-5429962'
  const allRows = [
    { orderId, amount: -1132.51, category: CATEGORY.REFUND, rowClass: ROW_CLASS.REFUND, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Refund' },
    { orderId, amount: 166.48, category: CATEGORY.REFUND, rowClass: ROW_CLASS.REFUND, amountType: 'ItemFees', amountDescription: 'Commission', transactionType: 'Refund' },
  ]
  const paymentPreview = buildPaymentPreviewFromBatch({
    status: 'approved',
    batchId: 1,
    allRows,
    matchedOrders: [
      {
        orderId,
        principalTotal: 1132.51,
        netSettlementAmount: -966.03,
        zohoInvoiceTotal: 1132.51,
        zohoInvoiceNumber: 'INV-041390',
      },
    ],
    matchedReturns: [
      {
        orderId,
        zohoCreditNoteId: 'cn-1',
        status: 'matched',
        amazonRefundAmount: 1132.51,
        creditNoteAmount: 1132.51,
      },
    ],
    reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
    nonOrderLinkedAmazonFeeMappings: [],
  })
  assert.equal(paymentPreview.payments.length, 0)
})

test('payment preview excludes refunds detected by category when rowClass is missing', () => {
  const orderId = '406-2446480-5429962'
  const allRows = [
    {
      orderId,
      amount: -1132.51,
      category: 'Refund',
      rowClass: '',
      amountType: 'ItemPrice',
      amountDescription: 'Principal',
      transactionType: 'Refund',
    },
    {
      orderId,
      amount: 166.48,
      category: 'Refund',
      rowClass: '',
      amountType: 'ItemFees',
      amountDescription: 'Commission',
      transactionType: 'Refund',
    },
  ]
  const paymentPreview = buildPaymentPreviewFromBatch({
    status: 'approved',
    batchId: 1,
    allRows,
    matchedOrders: [
      {
        orderId,
        principalTotal: 1132.51,
        netSettlementAmount: -966.03,
        zohoInvoiceTotal: 1132.51,
        zohoInvoiceNumber: 'INV-041380',
      },
    ],
    reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
    nonOrderLinkedAmazonFeeMappings: [],
  })
  assert.equal(paymentPreview.payments.length, 0)
})

test('payment preview keeps sale clearing when order has both sale and refund rows', () => {
  const orderId = '406-2446480-5429962'
  const allRows = [
    { orderId, amount: 1132.51, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    { orderId, amount: -37.95, category: CATEGORY.FBA_FULFILLMENT_FEE, rowClass: ROW_CLASS.FEE, amountType: 'ItemFees', amountDescription: 'FBAPerUnitFulfillmentFee', transactionType: 'Order' },
    { orderId, amount: -166.48, category: CATEGORY.COMMISSION, rowClass: ROW_CLASS.FEE, amountType: 'ItemFees', amountDescription: 'Commission', transactionType: 'Order' },
    { orderId, amount: -1132.51, category: CATEGORY.REFUND, rowClass: ROW_CLASS.REFUND, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Refund' },
    { orderId, amount: 166.48, category: CATEGORY.REFUND, rowClass: ROW_CLASS.REFUND, amountType: 'ItemFees', amountDescription: 'Commission', transactionType: 'Refund' },
  ]
  const paymentPreview = buildPaymentPreviewFromBatch({
    status: 'approved',
    batchId: 1,
    allRows,
    matchedOrders: [
      {
        orderId,
        principalTotal: 1132.51,
        netSettlementAmount: 928.08,
        zohoInvoiceTotal: 1132.51,
        zohoInvoiceNumber: 'INV-041380',
      },
    ],
    matchedReturns: [
      {
        orderId,
        zohoCreditNoteId: 'cn-1',
        status: 'matched',
        amazonRefundAmount: 1132.51,
        creditNoteAmount: 1132.51,
      },
    ],
    reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
    nonOrderLinkedAmazonFeeMappings: [],
  })
  assert.equal(paymentPreview.payments.length, 1)
  assert.equal(paymentPreview.payments[0].orderId, orderId)
})

test('preview separates sales from refunds and marks missing credit notes ready to create', () => {
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
  assert.equal(preview.missingCreditNotes.length, 0)
  assert.equal(preview.creditNoteBlockingRows.length, 0)
  const readyReturn = (preview.matchedReturns || []).find((row) => row.orderId === '701-return')
  assert.equal(readyReturn?.status, 'ready_to_create')
  assert.equal(readyReturn?.creditNoteAction, 'ready_to_create')
})

test('preview builds row-level allRows, blockingIssues, and amount differences', () => {
  const rows = [
    { orderId: '701-sale', amount: 100, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    { orderId: '701-unmatched', amount: 40, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    { orderId: '', amount: -5, category: CATEGORY.ADVERTISING_FEE, rowClass: ROW_CLASS.FEE, amountType: 'Cost of Advertising', amountDescription: 'TransactionTotalAmount', transactionType: 'ServiceFee' },
    { orderId: '701-return', amount: -50, category: CATEGORY.REFUND, rowClass: ROW_CLASS.REFUND, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Refund' },
  ]
  const invoices = [
    { invoice_id: 'zsale', invoice_number: 'INV-SALE', reference_number: '701-sale', customer_name: 'KSA-Amazon', total: 120 },
    { invoice_id: 'zreturn', invoice_number: 'INV-RETURN', reference_number: '701-return', customer_name: 'KSA-Amazon', total: 50 },
  ]
  const creditNoteMatch = matchRefundReturnRowsToCreditNotes([rows[3]], invoices, [])
  const preview = buildPreview({
    rows,
    invoices,
    matchedReturns: creditNoteMatch.matchedReturns,
    missingCreditNotes: creditNoteMatch.missingCreditNotes,
    creditNoteBlockingRows: creditNoteMatch.creditNoteBlockingRows,
    report: { reportDocumentId: 'doc1', currency: 'SAR' },
  })

  assert.equal(preview.allRows.length, 4)
  assert.deepEqual(preview.allRows.map((row) => row.rowNumber), [1, 2, 3, 4])
  const unmatchedRow = preview.allRows.find((row) => row.orderId === '701-unmatched')
  assert.equal(unmatchedRow.status, 'unmatched')
  const returnRow = preview.allRows.find((row) => row.orderId === '701-return')
  assert.equal(returnRow.status, 'ready_to_create')

  const codes = preview.blockingIssues.map((issue) => issue.code)
  assert.ok(codes.includes('UNMATCHED_SALES'))
  assert.ok(!codes.includes('MISSING_CREDIT_NOTE'))

  const amountDiff = preview.amountDifferences.find((row) => row.orderId === '701-sale')
  assert.ok(amountDiff)
  assert.equal(amountDiff.difference, -20)
})

test('preview flags missing order ID rows and settlement mismatch blocking issues', () => {
  const rows = [
    { orderId: '701-1', amount: 100, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    { orderId: '701-1', amount: -10, category: CATEGORY.COMMISSION, rowClass: ROW_CLASS.FEE, amountType: 'ItemFees', amountDescription: 'Commission', transactionType: 'Order' },
    { orderId: '', amount: 5, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
  ]
  const invoices = [{ invoice_id: 'z1', invoice_number: 'INV-1', reference_number: '701-1', customer_name: 'KSA-Amazon', total: 100 }]
  const preview = buildPreview({ rows, invoices, report: { reportDocumentId: 'doc1', currency: 'SAR' } })

  const missingOrderRow = preview.allRows.find((row) => row.rowNumber === 3)
  assert.equal(missingOrderRow.status, 'missing_order_id')
  const codes = preview.blockingIssues.map((issue) => issue.code)
  assert.ok(codes.includes('MISSING_ORDER_ID'))
})

test('preview treats account-level Amazon fees without order ID as journal-mapped fees', () => {
  const rows = [
    { orderId: '701-1', amount: 100, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    { orderId: '', amount: -25, category: CATEGORY.STORAGE_FEE, rowClass: ROW_CLASS.NON_ORDER_LINKED_AMAZON_FEE, amountType: 'other-transaction', amountDescription: 'Storage Fee', transactionType: 'other-transaction' },
  ]
  const invoices = [{ invoice_id: 'z1', invoice_number: 'INV-1', reference_number: '701-1', customer_name: 'KSA-Amazon', total: 100 }]
  const preview = buildPreview({
    rows,
    invoices,
    report: {
      reportDocumentId: 'doc1',
      settlementStartDate: '2026-04-15',
      settlementEndDate: '2026-04-29',
      currency: 'SAR',
    },
  })

  const feeRow = preview.allRows.find((row) => row.rowNumber === 2)
  assert.equal(feeRow.status, 'account_level_fee')
  assert.equal(feeRow.blockingReason, 'Order ID not required for this Amazon fee.')
  assert.equal(preview.missingOrderIdRows.length, 0)
  assert.equal(preview.unmatchedOrders.length, 0)
  assert.ok(!preview.blockingIssues.map((issue) => issue.code).includes('MISSING_ORDER_ID'))
  assert.equal(preview.nonOrderLinkedAmazonFeeMappings.length, 1)
  assert.equal(preview.nonOrderLinkedAmazonFeeMappings[0].classification, ROW_CLASS.NON_ORDER_LINKED_AMAZON_FEE)
  assert.equal(preview.nonOrderLinkedAmazonFeeMappings[0].journalPreview.referenceNumber, '15-Apr-2026 to 29-Apr-2026 Storage Fee')
})

test('preview treats AMPS Core pseudo order IDs as account-level fees', () => {
  const rows = [
    { orderId: '701-1', amount: 100, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    {
      orderId: 'AMPSCoreSA_352991477012_SA_2026_02_01',
      amount: -2370.1,
      rowClass: ROW_CLASS.FEE,
      amountType: 'other-transaction',
      amountDescription: 'Paid Services Fee',
      transactionType: 'other-transaction',
    },
  ]
  const invoices = [{ invoice_id: 'z1', invoice_number: 'INV-1', reference_number: '701-1', customer_name: 'KSA-Amazon', total: 100 }]
  const preview = buildPreview({
    rows,
    invoices,
    report: {
      reportDocumentId: 'doc1',
      settlementStartDate: '2026-02-01',
      settlementEndDate: '2026-02-15',
      currency: 'SAR',
    },
  })

  const feeRow = preview.allRows.find((row) => row.rowNumber === 2)
  assert.equal(feeRow.status, 'account_level_fee')
  assert.equal(feeRow.blockingReason, 'Order ID not required for this Amazon fee.')
  assert.equal(preview.unmatchedOrders.length, 0)
  assert.ok(!preview.blockingIssues.map((issue) => issue.code).includes('SETTLEMENT_MISMATCH'))
  assert.equal(preview.reconciliationSummary.premiumServiceFeeTotal, -2370.1)
  assert.equal(preview.reconciliationSummary.reconciliationStatus, 'reconciled')
  assert.ok(preview.nonOrderLinkedAmazonFeeMappings.some((row) => row.normalizedFeeType === 'PREMIUM_SERVICES'))
})

test('preview treats Amazon advertising credits as mappable account-level fee journals', () => {
  const rows = [
    { orderId: '701-1', amount: 100, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    { orderId: '', amount: -10, category: CATEGORY.COMMISSION, rowClass: ROW_CLASS.FEE, amountType: 'ItemFees', amountDescription: 'Commission', transactionType: 'Order' },
    {
      orderId: '',
      amount: 1.32,
      amountType: 'Refund for Advertiser',
      amountDescription: 'TransactionTotalAmount',
      transactionType: 'ServiceFee',
    },
  ]
  const invoices = [{ invoice_id: 'z1', invoice_number: 'INV-1', reference_number: '701-1', customer_name: 'KSA-Amazon', total: 100 }]
  const preview = buildPreview({
    rows,
    invoices,
    report: {
      reportDocumentId: 'doc1',
      settlementStartDate: '2026-02-01',
      settlementEndDate: '2026-02-15',
      currency: 'SAR',
    },
  })

  const creditRow = preview.allRows.find((row) => row.rowNumber === 3)
  assert.equal(creditRow.status, 'account_level_fee')
  assert.equal(creditRow.blockingReason, 'Order ID not required for this Amazon fee.')
  assert.equal(preview.refundReturnRows.length, 0)
  const mapping = preview.nonOrderLinkedAmazonFeeMappings.find((row) => row.normalizedFeeType === 'ADVERTISING_CREDIT')
  assert.ok(mapping)
  assert.equal(mapping.totalAmount, 1.32)
  assert.equal(mapping.mappingStatus, 'needs_mapping')
  assert.equal(mapping.journalPreview.debit.accountName, 'KSA-Amazon Undeposited Funds')
  assert.equal(mapping.journalPreview.credit.accountName, 'KSA-Amazon Advertising Exp')
  assert.equal(preview.reconciliationSummary.reconciliationStatus, 'reconciled')
  assert.equal(preview.reconciliationSummary.refundReturnImpact, 0)
  assert.equal(preview.reconciliationSummary.advertisingFeeTotal, 1.32)
  assert.equal(preview.creditNoteBlockingRows.length, 0)
})

test('sanitizeCreditNotePreview drops stale no-order credit note blockers for advertising credits', () => {
  const { sanitizeCreditNotePreview } = require('../src/services/amazonPaymentClearingPreviewService')
  const preview = sanitizeCreditNotePreview({
    allRows: [],
    unmatchedOrders: [],
    reconciliationSummary: { reconciliationStatus: 'reconciled' },
    refundReturnRows: [{
      orderId: '',
      amountType: 'Refund for Advertiser',
      amountDescription: 'TransactionTotalAmount',
      transactionType: 'ServiceFee',
      amount: 1.32,
      rowClass: 'refund',
    }],
    creditNoteBlockingRows: [{
      orderId: '',
      creditNoteAction: 'blocked',
      blockingReason: 'Amazon refund/return row is missing order ID.',
    }],
    matchedReturns: [],
    missingCreditNotes: [],
  }, [{
    orderId: '',
    amount: 1.32,
    amountType: 'Refund for Advertiser',
    amountDescription: 'TransactionTotalAmount',
    transactionType: 'ServiceFee',
  }])

  assert.equal(preview.refundReturnRows.length, 0)
  assert.equal(preview.creditNoteBlockingRows.length, 0)
  assert.equal(preview.reconciliationSummary.refundReturnImpact, 0)
  assert.equal(preview.reconciliationSummary.reconciliationStatus, 'reconciled')
})

test('preview treats no-order Other settlement rows as account-level journal rows', () => {
  const rows = [
    { orderId: '701-1', amount: 100, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE, amountType: 'ItemPrice', amountDescription: 'Principal', transactionType: 'Order' },
    { orderId: '', amount: 0, category: CATEGORY.OTHER, rowClass: ROW_CLASS.UNKNOWN, amountType: '', amountDescription: '', transactionType: '' },
    { orderId: '', amount: -5, category: CATEGORY.OTHER, rowClass: ROW_CLASS.UNKNOWN, amountType: 'other-transaction', amountDescription: 'Other adjustment', transactionType: 'other-transaction' },
  ]
  const invoices = [{ invoice_id: 'z1', invoice_number: 'INV-1', reference_number: '701-1', customer_name: 'KSA-Amazon', total: 100 }]
  const preview = buildPreview({ rows, invoices, report: { reportDocumentId: 'doc1', currency: 'SAR' } })

  assert.equal(preview.allRows[1].status, 'account_level_fee')
  assert.equal(preview.allRows[2].status, 'account_level_fee')
  assert.equal(preview.missingOrderIdRows.length, 0)
  assert.ok(!preview.blockingIssues.map((issue) => issue.code).includes('MISSING_ORDER_ID'))
  const zeroMapping = preview.nonOrderLinkedAmazonFeeMappings.find((row) => row.totalAmount === 0)
  const nonzeroMapping = preview.nonOrderLinkedAmazonFeeMappings.find((row) => row.totalAmount === -5)
  assert.equal(zeroMapping.mappingStatus, 'not_required')
  assert.equal(nonzeroMapping.mappingStatus, 'needs_mapping')
})

test('fee journal mapping rules map account-level fees by normalized type', () => {
  const rows = [
    { orderId: '', amount: -25, category: CATEGORY.STORAGE_FEE, rowClass: ROW_CLASS.NON_ORDER_LINKED_AMAZON_FEE, amountType: 'other-transaction', amountDescription: 'Storage Fee', transactionType: 'other-transaction' },
  ]
  const preview = buildPreview({
    rows,
    invoices: [],
    report: {
      marketplace: 'KSA',
      reportDocumentId: 'doc1',
      settlementStartDate: '2026-04-29',
      settlementEndDate: '2026-05-13',
      currency: 'SAR',
    },
    feeJournalMappingRules: [{
      id: 7,
      marketplace: 'KSA',
      normalizedFeeType: 'STORAGE',
      rawTransactionType: 'other-transaction',
      descriptionPattern: 'Storage Fee',
      debitAccountName: 'KSA Amazon Storage Exp',
      debitAccountId: 'debit-storage',
      creditAccountName: 'KSA-Amazon Undeposited Funds',
      creditAccountId: 'credit-clearing',
      isActive: true,
      priority: 100,
      lastUsedAt: null,
    }],
  })

  const mapping = preview.nonOrderLinkedAmazonFeeMappings[0]
  assert.equal(mapping.normalizedFeeType, 'STORAGE')
  assert.equal(mapping.mappingStatus, 'mapped')
  assert.equal(mapping.mappingRuleId, 7)
  assert.equal(mapping.journalPreview.referenceNumber, '29-Apr-2026 to 13-May-2026 Storage Fee')
  assert.ok(!preview.blockingIssues.map((issue) => issue.code).includes('MISSING_ORDER_ID'))
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
  assert.ok(preview.blockingIssues.some((issue) => issue.code === 'SETTLEMENT_MISMATCH'))
})

test('legacy Life Smile settlement mismatch does not block clearance', () => {
  const preview = {
    zohoCustomerName: LEGACY_KSA_ZOHO_CUSTOMER_NAME,
    reconciliationSummary: {
      reconciliationStatus: 'mismatch',
      reconciliationDifference: -306.46,
    },
    blockingIssues: [{ code: 'SETTLEMENT_MISMATCH', label: 'Settlement mismatch', count: 1 }],
    warnings: ['Settlement total does not match calculated expected deposit.'],
  }
  applyLegacySettlementMismatchTolerance(preview)
  assert.ok(!preview.blockingIssues.some((issue) => issue.code === 'SETTLEMENT_MISMATCH'))
  assert.ok(preview.warnings.some((warning) => /currency exchange gain\/loss/i.test(warning)))
  assert.equal(
    isSettlementReconciliationAcceptable(preview.reconciliationSummary, LEGACY_KSA_ZOHO_CUSTOMER_NAME),
    true
  )
})

test('legacy Life Smile settlement mismatch allows payment preview and posting checks', () => {
  const batch = postingBatch({
    zohoCustomerName: LEGACY_KSA_ZOHO_CUSTOMER_NAME,
    reconciliationSummary: { reconciliationStatus: 'mismatch', reconciliationDifference: -306.46 },
  })
  assert.doesNotThrow(() => buildPaymentPreviewFromBatch(batch))
  assert.doesNotThrow(() => ensureCanPostBatch(batch, true))
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
  assert.equal(range.toDate >= '2026-05-15', true)
})

test('deriveInvoiceRange caps Zoho fetch for historical settlements older than 90 days', () => {
  const range = deriveInvoiceRange([
    { settlementStartDate: '2025-07-09', settlementEndDate: '2025-07-23', depositDate: '2025-07-25' },
  ])
  assert.equal(range.settlementFromDate, '2025-07-09')
  assert.equal(range.settlementToDate, '2025-07-25')
  assert.equal(range.fromDate, '2025-03-11')
  assert.equal(range.toDate, '2025-10-23')
  assert.notEqual(range.toDate, new Date().toISOString().slice(0, 10))
})

test('deriveInvoiceRange extends Zoho fetch through today for late invoices', () => {
  const range = deriveInvoiceRange([
    { settlementStartDate: '2026-05-01', settlementEndDate: '2026-05-15', depositDate: '2026-05-20', postedDate: '2026-05-10' },
  ])
  const today = new Date().toISOString().slice(0, 10)
  assert.equal(range.settlementFromDate, '2026-05-01')
  assert.equal(range.settlementToDate, '2026-05-20')
  assert.equal(range.fromDate, '2026-01-01')
  assert.equal(range.toDate, today)
})

test('deriveInvoiceRange pads Zoho fetch window backward from settlement dates', () => {
  const range = deriveInvoiceRange([
    { settlementStartDate: '2099-05-01', settlementEndDate: '2099-05-15', depositDate: '2099-05-20', postedDate: '2099-05-10' },
  ])
  assert.equal(range.settlementFromDate, '2099-05-01')
  assert.equal(range.settlementToDate, '2099-05-20')
  assert.equal(range.fromDate, '2099-01-01')
  assert.equal(range.toDate, '2099-05-20')
})

test('resolveKsaZohoCustomer preserves explicit customer id and name', async () => {
  const resolved = await resolveKsaZohoCustomer({
    customerId: 'zoho-contact-legacy',
    customerName: LEGACY_KSA_ZOHO_CUSTOMER_NAME,
  })
  assert.equal(resolved.customerId, 'zoho-contact-legacy')
  assert.equal(resolved.customerName, LEGACY_KSA_ZOHO_CUSTOMER_NAME)
})

test('resolveKsaZohoCustomerId returns explicit customer id without Zoho lookup', async () => {
  const id = await resolveKsaZohoCustomerId({ customerId: 'explicit-id-123' })
  assert.equal(id, 'explicit-id-123')
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
    { orderId: '', amount: -5, category: CATEGORY.PRINCIPAL, rowClass: ROW_CLASS.SALE },
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

test('legacy Life Smile settlement currency converts SAR amounts to AED', () => {
  assert.equal(isLegacyKsaPaymentClearingCustomer(LEGACY_KSA_ZOHO_CUSTOMER_NAME), true)
  assert.equal(isLegacyKsaPaymentClearingCustomer('KSA-Amazon'), false)
  assert.equal(settlementCurrencyForCustomer(LEGACY_KSA_ZOHO_CUSTOMER_NAME, 'SAR'), 'AED')
  assert.equal(settlementCurrencyForCustomer('KSA-Amazon', 'SAR'), 'SAR')
  const rows = applyLegacyCurrencyToSettlementRows(
    [{ amount: 955, currency: 'SAR', orderId: '171-1' }],
    LEGACY_KSA_ZOHO_CUSTOMER_NAME
  )
  assert.equal(rows[0].currency, 'AED')
  assert.equal(rows[0].amount, sarAmountToAed(955))
})

test('legacy payment preview clears when Zoho invoice is AED and Amazon rows were converted from SAR', () => {
  const principalAed = sarAmountToAed(955)
  const commissionAed = sarAmountToAed(-130.36)
  const fulfillmentAed = sarAmountToAed(-27.6)
  const preview = buildPaymentPreviewFromBatch({
    batchId: 20,
    status: 'approved',
    zohoCustomerName: LEGACY_KSA_ZOHO_CUSTOMER_NAME,
    report: { currency: 'AED' },
    reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
    unmatchedOrders: [],
    matchedOrders: [
      {
        orderId: '171-0034579-1023563',
        zohoInvoiceId: 'z1',
        zohoInvoiceNumber: 'INV-LEGACY',
        zohoPoNumber: '171-0034579-1023563',
        zohoCustomerName: LEGACY_KSA_ZOHO_CUSTOMER_NAME,
        zohoInvoiceTotal: principalAed,
        principalTotal: principalAed,
        commissionTotal: commissionAed,
        fulfillmentFeeTotal: fulfillmentAed,
        closingFeeTotal: 0,
        shippingPromotionTotal: 0,
        otherAmazonFeeTotal: 0,
      },
    ],
  })
  assert.equal(preview.payments[0].status, 'ready')
  assert.equal(preview.payments[0].remainingDifference, 0)
})

test('legacy payment preview converts stored SAR matched orders for old batches', () => {
  const preview = buildPaymentPreviewFromBatch({
    batchId: 21,
    status: 'approved',
    zohoCustomerName: LEGACY_KSA_ZOHO_CUSTOMER_NAME,
    report: { currency: 'SAR' },
    reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
    unmatchedOrders: [],
    matchedOrders: [
      {
        orderId: '171-1',
        zohoInvoiceTotal: sarAmountToAed(2329),
        principalTotal: 2329,
        commissionTotal: -342.36,
        fulfillmentFeeTotal: -54.05,
        closingFeeTotal: 0,
        shippingPromotionTotal: 0,
        otherAmazonFeeTotal: 0,
      },
    ],
  })
  assert.equal(preview.payments[0].status, 'ready')
  assert.equal(preview.payments[0].totalClearingAmount, sarAmountToAed(2329))
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
  assert.doesNotThrow(() => buildPaymentPreviewFromBatch(postingBatch({
    zohoCustomerName: LEGACY_KSA_ZOHO_CUSTOMER_NAME,
    reconciliationSummary: { reconciliationStatus: 'mismatch', reconciliationDifference: -306.46 },
  })))
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

test('payment preview can be generated for an already posted settlement', () => {
  const preview = buildPaymentPreviewFromBatch(postingBatch({ status: 'posted' }))
  assert.equal(preview.status, 'previewed')
  assert.equal(preview.paymentPlanSummary.invoiceCount, 1)
})

test('payment preview includes mapped account-level fee journals on posted settlements', () => {
  const preview = buildPaymentPreviewFromBatch(postingBatch({
    status: 'posted',
    nonOrderLinkedAmazonFeeMappings: [{
      key: 'KSA|STORAGE|other-transaction|Storage Fee',
      classification: 'NON_ORDER_LINKED_AMAZON_FEE',
      marketplace: 'KSA',
      feeType: 'Storage Fee',
      normalizedFeeType: 'STORAGE',
      rawTransactionType: 'other-transaction',
      description: 'Storage Fee',
      rowCount: 1,
      totalAmount: -25,
      rowNumbers: [9],
      mappingStatus: 'mapped',
      mappingRuleId: 44,
      journalPreview: {
        referenceNumber: '29-Apr-2026 to 13-May-2026',
        notes: 'Transferring Amazon KSA payment from 29-Apr-2026 to 13-May-2026 to Expenses accounts',
        debit: { accountId: 'debit-storage', accountName: 'KSA Amazon Storage Exp', amount: 25 },
        credit: { accountId: 'credit-clearing', accountName: 'KSA-Amazon Undeposited Funds', amount: 25 },
      },
    }],
  }))
  assert.equal(preview.amazonFeeJournalLines.length, 1)
  assert.equal(preview.amazonFeeJournalLines[0].mappingStatus, 'mapped')
  assert.equal(preview.paymentPlanSummary.amazonFeeJournalTotal, 25)
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
    async markFeeJournalMappingsUsed(ids) {
      this.usedMappingIds = ids
      return Array.isArray(ids) ? ids.length : 0
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
    description: payment.description,
  }
}

function fakeJournalPayloadPreview(journal) {
  return {
    journal_date: journal.date,
    reference_number: journal.referenceNumber,
    notes: journal.notes,
    journal_type: 'both',
    line_items: [
      {
        account_id: journal.debit.accountId,
        account_name: journal.debit.accountName,
        debit_or_credit: 'debit',
        amount: journal.amount,
      },
      {
        account_id: journal.credit.accountId,
        account_name: journal.credit.accountName,
        debit_or_credit: 'credit',
        amount: journal.amount,
      },
    ],
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

test('mergeInvoiceAllocations sums duplicate invoice rows', () => {
  const { mergeInvoiceAllocations } = require('../src/services/amazonPaymentClearingPostingService')
  const merged = mergeInvoiceAllocations([
    { invoiceId: 'z1', invoiceNumber: 'INV-1', orderId: 'o1', amountApplied: 100 },
    { invoiceId: 'z1', invoiceNumber: 'INV-1', orderId: 'o2', amountApplied: 50 },
  ])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].amountApplied, 150)
})

test('payment posting blocks when Zoho invoice balance is below clearing plan', async () => {
  const batch = postingBatchWithInvoiceCount(2)
  const store = fakePostingStore([], batch)
  let calls = 0
  const result = await postApprovedBatch({
    batch,
    store,
    dryRun: true,
    fetchInvoicesByIds: async (ids) => {
      const map = new Map()
      for (const id of ids) {
        map.set(id, { invoice_id: id, invoice_number: `INV-${id}`, balance: 1 })
      }
      return map
    },
    createPayment: async () => {
      calls += 1
      return { zohoPaymentId: 'should-not-run' }
    },
    buildPayloadPreview: fakePayloadPreview,
  })
  assert.equal(calls, 0)
  assert.equal(result.summary.errors, 3)
  assert.ok(result.payments.every((payment) => payment.code === 'ZOHO_INVOICE_BALANCE_INSUFFICIENT'))
})

test('grouped posting creates three payments with eleven invoice allocations each', async () => {
  const batch = postingBatchWithInvoiceCount(11)
  const store = fakePostingStore([], batch)
  const created = []
  const result = await postApprovedBatch({
    batch,
    store,
    dryRun: false,
    fetchInvoicesByIds: async (ids) => {
      const map = new Map()
      for (const id of ids) {
        map.set(id, { invoice_id: id, invoice_number: `INV-${id}`, balance: 100000 })
      }
      return map
    },
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
  assert.equal(created.find((p) => p.referenceNumber.includes('Net Undeposited')).amount, 935)
  assert.equal(created.find((p) => p.referenceNumber.includes('Commission Undeposited')).amount, 110)
  assert.equal(created.find((p) => p.referenceNumber.includes('Shipping Undeposited')).amount, 55)
})

test('settlement reference builds period-based reference number and traceable description', () => {
  const reference = buildSettlementReference({
    batchId: 90,
    marketplace: 'KSA',
    report: {
      settlementId: '12345678901',
      reportId: 'RPT-XYZ',
      settlementStartDate: '2026-06-01',
      settlementEndDate: '2026-06-15',
    },
  })
  assert.equal(reference.referenceBase, 'AMZ-KSA-20260601-20260615')
  assert.equal(reference.periodText, '01 Jun 2026 - 15 Jun 2026')
  assert.equal(reference.zohoReferenceNumber, '01-Jun-2026 to 15-Jun-2026')

  const net = buildEntryReference(reference, 'net_balance')
  assert.equal(net.referenceNumber, '01-Jun-2026 to 15-Jun-2026 Net Undeposited')
  assert.equal(referenceNumberFor(reference, 'commission'), '01-Jun-2026 to 15-Jun-2026 Commission Undeposited')

  const description = descriptionFor(reference, net.entryLabel)
  assert.ok(description.includes('Amazon KSA Settlement'))
  assert.ok(description.includes('Period: 01 Jun 2026 - 15 Jun 2026'))
  assert.ok(description.includes('Settlement ID: 12345678901'))
  assert.ok(description.includes('Report ID: RPT-XYZ'))
  assert.ok(description.includes('Batch: #90'))
})

test('settlement reference falls back to settlement id, then batch id, when dates missing', () => {
  assert.equal(
    buildSettlementReference({ batchId: 5, marketplace: 'KSA', report: { settlementId: 'S-1' } }).referenceBase,
    'AMZ-KSA-SETTLEMENT-S-1'
  )
  assert.equal(
    buildSettlementReference({ batchId: 5, marketplace: 'KSA', report: {} }).referenceBase,
    'AMZ-KSA-BATCH-5'
  )
})

test('payment preview exposes settlement reference and posting references for the admin', () => {
  const preview = buildPaymentPreviewFromBatch({
    ...postingBatch(),
    marketplace: 'KSA',
    report: {
      settlementId: 'S-7',
      reportId: 'RPT-7',
      settlementStartDate: '2026-06-01',
      settlementEndDate: '2026-06-15',
    },
  })
  assert.equal(preview.settlementReference.referenceBase, 'AMZ-KSA-20260601-20260615')
  assert.ok(Array.isArray(preview.postingReferences))
  const net = preview.postingReferences.find((row) => row.paymentType === 'net_balance')
  assert.equal(net.referenceNumber, '01-Jun-2026 to 15-Jun-2026 Net Undeposited')
  assert.ok(net.amount > 0)
  assert.ok(net.description.includes('Period: 01 Jun 2026 - 15 Jun 2026'))
})

test('posting carries settlement-period reference and description to Zoho payload', async () => {
  const batch = {
    ...postingBatch(),
    marketplace: 'KSA',
    report: {
      settlementId: 'S-9',
      reportId: 'RPT-9',
      settlementStartDate: '2026-06-01',
      settlementEndDate: '2026-06-15',
    },
  }
  const store = fakePostingStore([], batch)
  const created = []
  const result = await postApprovedBatch({
    batch,
    store,
    dryRun: false,
    postedBy: 3,
    createPayment: async (payment) => {
      created.push(payment)
      return { zohoPaymentId: `pay-${payment.depositToAccountCode}` }
    },
    buildPayloadPreview: fakePayloadPreview,
  })

  assert.equal(result.settlementReference.referenceBase, 'AMZ-KSA-20260601-20260615')
  for (const payment of created) {
    assert.ok(payment.referenceNumber.includes('01-Jun-2026 to 15-Jun-2026'))
    assert.ok(
      payment.referenceNumber.includes('Net Undeposited') ||
        payment.referenceNumber.includes('Commission Undeposited') ||
        payment.referenceNumber.includes('Shipping Undeposited')
    )
    assert.ok(payment.description.includes('Settlement ID: S-9'))
    assert.ok(payment.description.includes('Report ID: RPT-9'))
  }
  for (const posting of store.postings) {
    assert.ok(posting.referenceNumber.includes('01-Jun-2026 to 15-Jun-2026'))
    assert.ok(posting.description.includes('Period: 01 Jun 2026 - 15 Jun 2026'))
  }
  for (const row of result.payments) {
    assert.ok(row.zohoPayloadPreview.reference_number.includes('01-Jun-2026 to 15-Jun-2026'))
    assert.ok(row.zohoPayloadPreview.description.includes('Amazon KSA Settlement'))
  }
})

test('non-order-linked fee without mapping blocks real Zoho posting', async () => {
  const batch = postingBatch({
    nonOrderLinkedAmazonFeeMappings: [
      {
        key: 'KSA|STORAGE|other-transaction|Storage Fee',
        feeType: 'Storage Fee',
        normalizedFeeType: 'STORAGE',
        mappingStatus: 'needs_mapping',
        totalAmount: -25,
      },
    ],
  })
  await assert.rejects(
    () => postApprovedBatch({
      batch,
      store: fakePostingStore([], batch),
      dryRun: false,
      buildPayloadPreview: fakePayloadPreview,
      buildJournalPayloadPreview: fakeJournalPayloadPreview,
    }),
    /Posting requires all Amazon fee journal mappings to be mapped/
  )
})

test('mapped non-order-linked fee posts as manual journal with mapping snapshot', async () => {
  const batch = postingBatch({
    matchedOrders: [],
    report: {
      settlementStartDate: '2026-04-29',
      settlementEndDate: '2026-05-13',
      currency: 'SAR',
    },
    nonOrderLinkedAmazonFeeMappings: [
      {
        key: 'KSA|ADVERTISING|ServiceFee|Cost of Advertising',
        classification: 'NON_ORDER_LINKED_AMAZON_FEE',
        marketplace: 'KSA',
        feeType: 'Advertising Fee',
        normalizedFeeType: 'ADVERTISING',
        rawTransactionType: 'ServiceFee',
        description: 'Cost of Advertising',
        rowCount: 2,
        totalAmount: -80,
        rowNumbers: [4, 5],
        debitAccountName: 'KSA-Amazon Advertising Exp',
        debitAccountId: 'debit-ad',
        creditAccountName: 'KSA-Amazon Undeposited Funds',
        creditAccountId: 'credit-clearing',
        mappingStatus: 'mapped',
        mappingRuleId: 12,
        mappingRuleUsed: {
          id: 12,
          marketplace: 'KSA',
          normalizedFeeType: 'ADVERTISING',
          rawTransactionType: 'ServiceFee',
          descriptionPattern: 'Cost of Advertising',
          debitAccountName: 'KSA-Amazon Advertising Exp',
          debitAccountId: 'debit-ad',
          creditAccountName: 'KSA-Amazon Undeposited Funds',
          creditAccountId: 'credit-clearing',
          isActive: true,
          priority: 100,
        },
        journalPreview: {
          referenceNumber: '29-Apr-2026 to 13-May-2026',
          notes: 'Transferring Amazon KSA payment from 29-Apr-2026 to 13-May-2026 to Expenses accounts',
          debit: { accountId: 'debit-ad', accountName: 'KSA-Amazon Advertising Exp', amount: 80 },
          credit: { accountId: 'credit-clearing', accountName: 'KSA-Amazon Undeposited Funds', amount: 80 },
        },
      },
    ],
  })
  const store = fakePostingStore([], batch)
  const result = await postApprovedBatch({
    batch,
    store,
    dryRun: false,
    postedBy: 7,
    createManualJournal: async (journal) => {
      assert.equal(journal.referenceNumber, '29-Apr-2026 to 13-May-2026')
      return { zohoJournalId: 'journal-1', zohoJournalNumber: 'JN-1' }
    },
    buildPayloadPreview: fakePayloadPreview,
    buildJournalPayloadPreview: fakeJournalPayloadPreview,
  })

  assert.equal(result.summary.journalsCreated, 1)
  assert.equal(result.journals[0].zohoJournalNumber, 'JN-1')
  assert.equal(result.journals[0].mappingSnapshot.mappingRuleId, 12)
  assert.deepEqual(store.usedMappingIds, [12])
  assert.equal(store.postings[0].referenceNumber, '29-Apr-2026 to 13-May-2026')
  assert.equal(store.postings[0].mappingSnapshot.normalizedFeeType, 'ADVERTISING')
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

test('Zoho manual journal payload uses journal_date for Books API', () => {
  const payload = buildManualJournalPayload({
    amount: 858.38,
    date: '2026-06-30',
    referenceNumber: '29-Apr-2026 to 13-May-2026',
    notes: 'Transferring Amazon KSA payment',
    debitAccountId: 'debit-ad',
    creditAccountId: 'credit-clearing',
    feeType: 'Advertising Fee',
  })

  assert.equal(payload.journal_date, '2026-06-30')
  assert.equal(payload.date, undefined)
  assert.equal(payload.reference_number, '29-Apr-2026 to 13-May-2026')
  assert.equal(payload.line_items.length, 2)
  assert.equal(payload.line_items[0].debit_or_credit, 'debit')
  assert.equal(payload.line_items[1].debit_or_credit, 'credit')
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

test('payment posting rejects a real post to an already posted settlement', async () => {
  await assert.rejects(
    () => postApprovedBatch({
      batch: postingBatch({ status: 'posted' }),
      store: fakePostingStore(),
      dryRun: false,
      buildPayloadPreview: fakePayloadPreview,
    }),
    /already been posted/
  )
})

test('payment posting allows a dry run on an already posted settlement', async () => {
  const store = fakePostingStore()
  const result = await postApprovedBatch({
    batch: postingBatch({ status: 'posted' }),
    store,
    dryRun: true,
    buildPayloadPreview: fakePayloadPreview,
  })
  assert.equal(result.dryRun, true)
  assert.equal(result.summary.paymentsCreated, 0)
  assert.equal(store.postings.length, 0)
})

test('force repost mode allows a real post to an already posted settlement', async () => {
  const store = fakePostingStore()
  const created = []
  const result = await postApprovedBatch({
    batch: postingBatch({ status: 'posted' }),
    store,
    dryRun: false,
    allowPosted: true,
    postedBy: 9,
    createPayment: async (payment) => {
      created.push(payment)
      return { zohoPaymentId: `pay-${created.length}` }
    },
    buildPayloadPreview: fakePayloadPreview,
  })
  assert.equal(result.summary.paymentsCreated, 3)
  assert.equal(store.postedBy, 9)
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

test('return fee breakdown splits commission reversal and retained shipping on refund rows', () => {
  const orderId = '406-2446480-5429962'
  const rows = [
    { orderId, transactionType: 'Refund', amountType: 'ItemPrice', amountDescription: 'Principal', amount: -1132.51 },
    { orderId, transactionType: 'Refund', amountType: 'ItemFees', amountDescription: 'Commission', amount: 166.48 },
    { orderId, transactionType: 'Refund', amountType: 'ItemFees', amountDescription: 'FBAPerUnitFulfillmentFee', amount: -37.95 },
  ]
  const breakdown = buildReturnFeeBreakdown(rows)
  assert.equal(breakdown.customerRefundAmount, -1132.51)
  assert.equal(breakdown.commissionReversal, 166.48)
  assert.equal(breakdown.shippingFbaRetained, -37.95)
  assert.ok(breakdown.netReturnSettlement < 0)
})

test('credit note apply plan marks missing credit note as create_and_refund', async () => {
  const batch = {
    batchId: 9,
    marketplace: 'KSA',
    report: { settlementId: 'SET1', settlementStartDate: '2026-05-01', settlementEndDate: '2026-05-15' },
    matchedReturns: [
      {
        orderId: '701-return',
        amazonRefundAmount: 50,
        zohoInvoiceId: 'zinv',
        zohoInvoiceNumber: 'INV-RETURN',
        creditNoteAction: 'ready_to_create',
        status: 'ready_to_create',
      },
    ],
    creditNoteBlockingRows: [],
  }
  const row = await resolvePlanRowAction(batch.matchedReturns[0], batch, {
    listRefunds: async () => [],
    resolveDepositAccount: async () => ({ accountId: 'acct-undep', accountName: 'KSA-Amazon Undeposited Funds' }),
    customerId: 'cust1',
    paymentDate: '2026-05-20',
  })
  assert.equal(row.action, 'create_and_refund')
  assert.equal(row.refundAmount, 50)
})

test('credit note apply plan skips already refunded credit notes', async () => {
  const batch = {
    batchId: 10,
    marketplace: 'KSA',
    report: { settlementId: 'SET1', settlementStartDate: '2026-05-01', settlementEndDate: '2026-05-15' },
    matchedReturns: [
      {
        orderId: '701-return',
        amazonRefundAmount: 50,
        creditNoteAmount: 50,
        zohoInvoiceId: 'zinv',
        zohoInvoiceNumber: 'INV-RETURN',
        zohoCreditNoteId: 'cn1',
        zohoCreditNoteNumber: 'CN-1',
        creditNoteAction: 'matched_existing',
        status: 'matched',
      },
    ],
    creditNoteBlockingRows: [],
  }
  const row = await resolvePlanRowAction(batch.matchedReturns[0], batch, {
    listRefunds: async () => [{ amount: 50 }],
    resolveDepositAccount: async () => ({ accountId: 'acct-undep', accountName: 'KSA-Amazon Undeposited Funds' }),
    paymentDate: '2026-05-20',
  })
  assert.equal(row.action, 'skipped_already_refunded')
})

test('return fee plan aggregates journals for settlement posting', () => {
  const batch = {
    batchId: 11,
    marketplace: 'KSA',
    report: { settlementId: 'SET1', settlementStartDate: '2026-05-01', settlementEndDate: '2026-05-15' },
    matchedReturns: [{ orderId: '701-return' }],
    creditNoteBlockingRows: [],
  }
  const allRows = [
    { orderId: '701-return', transactionType: 'Refund', amountType: 'ItemPrice', amountDescription: 'Principal', amount: -100 },
    { orderId: '701-return', transactionType: 'Refund', amountType: 'ItemFees', amountDescription: 'Commission', amount: 12 },
    { orderId: '701-return', transactionType: 'Refund', amountType: 'ItemFees', amountDescription: 'FBAPerUnitFulfillmentFee', amount: -8 },
  ]
  const plan = buildReturnFeePlan(batch, allRows)
  assert.equal(plan.breakdowns.length, 1)
  assert.ok(plan.journalLines.length >= 2)
  assert.equal(plan.summary.commissionReversalTotal, 12)
  assert.equal(plan.summary.shippingRetainedTotal, 8)
})

test('collectReturnRowsForApply includes refundReturnRows from saved batch', () => {
  const { collectReturnRowsForApply } = require('../src/services/amazonPaymentClearingCreditNotePostingService')
  const rows = collectReturnRowsForApply({
    matchedReturns: [],
    refundReturnRows: [
      { orderId: '701-return', amount: -50, transactionType: 'Refund' },
    ],
    allRows: [],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].orderId, '701-return')
  assert.equal(rows[0].amazonRefundAmount, 50)
})

test('collectReturnRowsForApply uses principal refund not last fee line per order', () => {
  const { collectReturnRowsForApply } = require('../src/services/amazonPaymentClearingCreditNotePostingService')
  const orderId = '407-5302986-4161132'
  const rows = collectReturnRowsForApply({
    matchedReturns: [],
    allRows: [
      { orderId, transactionType: 'Refund', amountType: 'ItemPrice', amountDescription: 'Principal', amount: -1065, transactionType: 'Refund' },
      { orderId, transactionType: 'Refund', amountType: 'ItemFees', amountDescription: 'Commission', amount: 6, transactionType: 'Refund' },
      { orderId, transactionType: 'Refund', amountType: 'ItemFees', amountDescription: 'FBAPerUnitFulfillmentFee', amount: -12, transactionType: 'Refund' },
    ],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].amazonRefundAmount, 1065)
})

test('credit note matching links warehouse credit note number to Amazon order id', () => {
  const rows = [
    {
      orderId: '407-5302986-4161132',
      transactionType: 'Refund',
      amountType: 'ItemPrice',
      amountDescription: 'Principal',
      amount: -1065,
      category: CATEGORY.REFUND,
      rowClass: ROW_CLASS.REFUND,
    },
    {
      orderId: '407-5302986-4161132',
      transactionType: 'Refund',
      amountType: 'ItemFees',
      amountDescription: 'Commission',
      amount: 6,
      category: CATEGORY.REFUND,
      rowClass: ROW_CLASS.REFUND,
    },
  ]
  const invoices = [
    {
      invoice_id: 'zinv1',
      invoice_number: 'INV-041580',
      reference_number: '407-5302986-4161132',
      customer_id: 'cust1',
      customer_name: 'KSA-Amazon',
      total: 1065,
    },
  ]
  const creditNotes = [
    {
      creditnote_id: 'cn1',
      creditnote_number: '407-5302986-4161132',
      reference_number: 'Grade A - Brand New',
      invoice_id: 'zinv1',
      customer_id: 'cust1',
      total: 1065,
      status: 'open',
    },
  ]
  const result = matchRefundReturnRowsToCreditNotes(rows, invoices, creditNotes)
  assert.equal(result.matchedReturns.length, 1)
  assert.equal(result.matchedReturns[0].amazonRefundAmount, 1065)
  assert.equal(result.matchedReturns[0].zohoCreditNoteId, 'cn1')
  assert.equal(result.matchedReturns[0].status, 'matched')
})

test('credit note matching ignores offset promotion lines on partial multi-item invoice return', () => {
  const orderId = '404-8863387-3332314'
  const rows = [
    {
      orderId,
      transactionType: 'Refund',
      amountType: 'ItemPrice',
      amountDescription: 'Principal',
      amount: -1065,
      category: CATEGORY.REFUND,
      rowClass: ROW_CLASS.REFUND,
    },
    {
      orderId,
      transactionType: 'Refund',
      amountType: 'ItemPrice',
      amountDescription: 'Shipping',
      amount: -6,
      category: CATEGORY.REFUND,
      rowClass: ROW_CLASS.REFUND,
    },
    {
      orderId,
      transactionType: 'Refund',
      amountType: 'Promotion',
      amountDescription: 'Principal',
      amount: 6,
      category: CATEGORY.PROMOTION_DISCOUNT,
      rowClass: ROW_CLASS.REFUND,
    },
    {
      orderId,
      transactionType: 'Refund',
      amountType: 'Promotion',
      amountDescription: 'Principal',
      amount: -6,
      category: CATEGORY.PROMOTION_DISCOUNT,
      rowClass: ROW_CLASS.REFUND,
    },
  ]
  const invoices = [
    {
      invoice_id: 'zinv1',
      invoice_number: 'INV-040055',
      reference_number: orderId,
      customer_id: 'cust1',
      customer_name: 'KSA-Amazon',
      total: 2835,
    },
  ]
  const creditNotes = [
    {
      creditnote_id: 'cn1',
      creditnote_number: orderId,
      reference_number: 'Grade A - Brand New',
      invoice_id: 'zinv1',
      customer_id: 'cust1',
      total: 1065,
      status: 'open',
    },
  ]
  const result = matchRefundReturnRowsToCreditNotes(rows, invoices, creditNotes)
  assert.equal(result.matchedReturns.length, 1)
  assert.equal(result.matchedReturns[0].amazonRefundAmount, 1065)
  assert.equal(result.matchedReturns[0].creditNoteAmount, 1065)
  assert.equal(result.matchedReturns[0].status, 'matched')
  assert.equal(result.creditNoteBlockingRows.length, 0)
})

test('saved batch credit note rematch clears stale amount-differ blockers from stored rows', () => {
  const { rematchCreditNotesFromSettlementRows } = require('../src/services/amazonPaymentClearingService')._internals
  const orderId = '404-8863387-3332314'
  const settlementRows = [
    { orderId, transactionType: 'Refund', amountType: 'ItemPrice', amountDescription: 'Principal', amount: -1065, rowClass: ROW_CLASS.REFUND },
    { orderId, transactionType: 'Refund', amountType: 'ItemPrice', amountDescription: 'Shipping', amount: -6, rowClass: ROW_CLASS.REFUND },
    { orderId, transactionType: 'Refund', amountType: 'Promotion', amountDescription: 'Principal', amount: 6, rowClass: ROW_CLASS.REFUND },
    { orderId, transactionType: 'Refund', amountType: 'Promotion', amountDescription: 'Principal', amount: -6, rowClass: ROW_CLASS.REFUND },
  ]
  const preview = {
    matchedOrders: [
      {
        orderId,
        zohoInvoiceId: 'zinv1',
        zohoInvoiceNumber: 'INV-040055',
        zohoPoNumber: orderId,
        zohoInvoiceTotal: 2835,
      },
    ],
    matchedReturns: [],
    creditNoteBlockingRows: [
      {
        orderId,
        amazonRefundAmount: 1071,
        creditNoteAmount: 1065,
        zohoInvoiceId: 'zinv1',
        zohoInvoiceNumber: 'INV-040055',
        zohoCreditNoteId: 'cn1',
        zohoCreditNoteNumber: orderId,
        status: 'blocked',
        creditNoteAction: 'blocked',
        blockingReason: 'Credit note amount differs from Amazon refund/return amount by more than 0.01.',
      },
    ],
    missingCreditNotes: [],
  }
  rematchCreditNotesFromSettlementRows(preview, settlementRows)
  assert.equal(preview.creditNoteBlockingRows.length, 0)
  assert.equal(preview.matchedReturns.length, 1)
  assert.equal(preview.matchedReturns[0].amazonRefundAmount, 1065)
  assert.equal(preview.matchedReturns[0].status, 'matched')
})

test('collectReturnRowsForApply prefers matchedReturns over stale blockers', () => {
  const { collectReturnRowsForApply } = require('../src/services/amazonPaymentClearingCreditNotePostingService')
  const rows = collectReturnRowsForApply({
    creditNoteBlockingRows: [
      {
        orderId: '407-5302986-4161132',
        status: 'blocked',
        blockingReason: 'Credit note amount differs from Amazon refund/return amount by more than 0.01.',
        zohoInvoiceId: 'zinv',
        zohoInvoiceNumber: 'INV-041580',
        amazonRefundAmount: 6,
      },
    ],
    matchedReturns: [
      {
        orderId: '407-5302986-4161132',
        status: 'matched',
        zohoInvoiceId: 'zinv',
        zohoInvoiceNumber: 'INV-041580',
        zohoCreditNoteId: 'cn1',
        zohoCreditNoteNumber: '407-5302986-4161132',
        creditNoteAmount: 1065,
        amazonRefundAmount: 1065,
        creditNoteAction: 'matched_existing',
      },
    ],
    allRows: [],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].zohoCreditNoteId, 'cn1')
  assert.equal(rows[0].status, 'matched')
  assert.equal(rows[0].amazonRefundAmount, 1065)
})

test('credit note apply plan applies existing credit note even when legacy status was blocked', async () => {
  const batch = {
    batchId: 13,
    marketplace: 'KSA',
    report: { settlementId: 'SET1', settlementStartDate: '2026-05-01', settlementEndDate: '2026-05-15' },
  }
  const row = await resolvePlanRowAction(
    {
      orderId: '407-5302986-4161132',
      amazonRefundAmount: 1065,
      creditNoteAmount: 1065,
      zohoInvoiceId: 'zinv',
      zohoInvoiceNumber: 'INV-041580',
      zohoCreditNoteId: 'cn1',
      zohoCreditNoteNumber: '407-5302986-4161132',
      creditNoteAction: 'blocked',
      status: 'blocked',
      blockingReason: 'Credit note amount differs from Amazon refund/return amount by more than 0.01.',
    },
    batch,
    {
      listRefunds: async () => [],
      resolveDepositAccount: async () => ({ accountId: 'acct-undep', accountName: 'KSA-Amazon Undeposited Funds' }),
    }
  )
  assert.equal(row.action, 'refund_existing')
  assert.equal(row.applyAmount, 1065)
})

test('credit note apply plan applies full existing credit note amount', async () => {
  const batch = {
    batchId: 12,
    marketplace: 'KSA',
    report: { settlementId: 'SET1', settlementStartDate: '2026-05-01', settlementEndDate: '2026-05-15' },
    matchedReturns: [
      {
        orderId: '407-5302986-4161132',
        amazonRefundAmount: 1065,
        creditNoteAmount: 1065,
        zohoInvoiceId: 'zinv',
        zohoInvoiceNumber: 'INV-041580',
        zohoCreditNoteId: 'cn1',
        zohoCreditNoteNumber: '407-5302986-4161132',
        creditNoteAction: 'matched_existing',
        status: 'matched',
      },
    ],
    creditNoteBlockingRows: [],
  }
  const row = await resolvePlanRowAction(batch.matchedReturns[0], batch, {
    listRefunds: async () => [],
    resolveDepositAccount: async () => ({ accountId: 'acct-undep', accountName: 'KSA-Amazon Undeposited Funds' }),
    paymentDate: '2026-06-17',
  })
  assert.equal(row.action, 'refund_existing')
  assert.equal(row.applyAmount, 1065)
  assert.equal(row.refundAmount, 1065)
  assert.equal(row.refundAccountName, 'KSA-Amazon Undeposited Funds')
})

test('credit note plan row completion includes skipped posted refunds', () => {
  const { isCreditNotePlanRowComplete } = require('../src/services/amazonPaymentClearingCreditNotePostingService')
  assert.equal(isCreditNotePlanRowComplete({ action: 'skipped_already_posted', status: 'completed' }), true)
  assert.equal(isCreditNotePlanRowComplete({ action: 'skipped_already_refunded', status: 'completed' }), true)
  assert.equal(isCreditNotePlanRowComplete({ action: 'refund_existing', status: 'ready' }), false)
})

test('settlement report list clamps createdSince to Amazon 90-day API limit', () => {
  const { clampSettlementListDaysBack, resolveSettlementListCreatedSince } =
    require('../src/services/amazonPaymentClearingService')._internals
  assert.equal(clampSettlementListDaysBack(365), 90)
  assert.equal(clampSettlementListDaysBack(60), 60)
  const resolved = resolveSettlementListCreatedSince({ daysBack: 365 })
  assert.equal(resolved.daysBack, 90)
  assert.ok(resolved.createdSince >= new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString())
})

test('settlement report list sorts by settlement end date newest first', () => {
  const { settlementReportSortTime } = require('../src/services/amazonPaymentClearingService')._internals
  const reports = [
    { reportId: 'older', dataEndTime: '2026-04-01T00:00:00Z' },
    { reportId: 'target', dataEndTime: '2026-04-15T00:00:00Z' },
    { reportId: 'newer', dataEndTime: '2026-06-24T00:00:00Z' },
  ].sort((a, b) => settlementReportSortTime(b).localeCompare(settlementReportSortTime(a)))
  assert.deepEqual(reports.map((row) => row.reportId), ['newer', 'target', 'older'])
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
  assert.ok(routes.some((route) => route.path === '/ksa/batches' && route.methods.includes('get')))
  assert.ok(routes.some((route) => route.path === '/ksa/preview' && route.methods.includes('post')))
  assert.ok(routes.some((route) => route.path === '/ksa/preview-upload' && route.methods.includes('post')))
  assert.ok(routes.some((route) => route.path === '/ksa/zoho-customers' && route.methods.includes('get')))
  assert.ok(routes.some((route) => route.path === '/ksa/batches/:id/force-repost' && route.methods.includes('post')))
  assert.ok(routes.some((route) => route.path === '/zoho/account-diagnostics' && route.methods.includes('get')))
  assert.ok(routes.some((route) => route.path === '/zoho/oauth/authorize-url' && route.methods.includes('get')))
  assert.ok(routes.some((route) => route.path === '/zoho/oauth/callback' && route.methods.includes('get')))
  assert.ok(routes.some((route) => route.path === '/zoho/oauth/exchange' && route.methods.includes('post')))
  assert.ok(routes.some((route) => route.path === '/ksa/batches/:id/approve' && route.methods.includes('post')))
  assert.ok(routes.some((route) => route.path === '/ksa/batches/:id/payment-preview' && route.methods.includes('post')))
  assert.ok(routes.some((route) => route.path === '/ksa/batches/:id/credit-note-apply-plan' && route.methods.includes('get')))
  assert.ok(routes.some((route) => route.path === '/ksa/batches/:id/apply-credit-notes' && route.methods.includes('post')))
  assert.ok(routes.some((route) => route.path === '/ksa/batches/:id/return-fee-plan' && route.methods.includes('get')))
  assert.ok(routes.some((route) => route.path === '/ksa/batches/:id/post-to-zoho' && route.methods.includes('post')))
  assert.ok(routes.some((route) => route.path === '/ksa/batches/:id/post-return-fee-journals' && route.methods.includes('post')))
})
