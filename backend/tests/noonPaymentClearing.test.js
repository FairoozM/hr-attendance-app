const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  parseNoonOrderId,
  resolveNoonOrderIds,
  isParentOnlyMatch,
  isRecognizedNoonItemOrderId,
  isStrictChildOfParent,
} = require('../src/services/noonPaymentClearing/noonOrderIdHelper')
const {
  classifyNoonStatementRow,
  ROW_CLASS,
  NORMALIZED_FEE_TYPE,
  requiresZohoInvoice,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')
const {
  applyParentOrderChargeFallback,
  findDeterministicChildForParent,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingParentChargeFallback')
const {
  parseNoonStatementReport,
  normalizeNoonStatementRow,
} = require('../src/services/noonPaymentClearing/noonStatementParserService')
const { buildNoonOrderHierarchy } = require('../src/services/noonPaymentClearing/noonPaymentClearingHierarchyService')
const {
  matchNoonRowsToInvoices,
  wouldParentMatchChildInvoice,
  mapInvoice,
  deriveInvoiceRange,
  INVOICE_LOOKBACK_DAYS,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingZohoMatcher')
const {
  buildNoonReconciliationSummary,
  isNoonSettlementReconciliationAcceptable,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingReconciliationService')
const { buildPreview, buildFeeJournalPreviewLines } = require('../src/services/noonPaymentClearing/noonPaymentClearingPreviewService')
const { buildPaymentPreviewFromBatch } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
const { resolveNoonFeeJournalSides } = require('../src/services/noonPaymentClearing/noonPaymentClearingJournalDirection')
const {
  splitVatInclusiveAmount,
  resolveVatSplit,
  extractVatFromNoonRow,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingVatService')
const { validateBatchReadyForApproval } = require('../src/services/noonPaymentClearing/noonPaymentClearingService')
const { flattenInvoicePayments, ensureCanPostBatch } = require('../src/services/noonPaymentClearing/noonPaymentClearingPostingService')

/** Amazon-style clearing GLs (codes from Noon CoA). */
const NOON_UNDEPOSITED = {
  accountId: 'undep-1',
  accountName: 'Noon Undeposited Funds',
  accountCode: '1066',
}
const NOON_UNCLEARED_SHIPPING = {
  accountId: 'ship-clear-1',
  accountName: 'Noon Uncleared Shipping Charges',
  accountCode: '1068',
}
const NOON_CUSTOMER = { customerId: 'cust-noon', customerName: 'Noon' }
/** Zoho Input VAT CoA — 1085 */
const NOON_INPUT_VAT = {
  accountId: 'vat-1',
  accountName: 'Input VAT - All Except Basmat Goods WH',
  accountCode: '1085',
  vatRate: 0.05,
}

// Resolve Amazon-parallel Noon accounts by code/id for tests (same roles as KSA 1024/1026/1028).
process.env.NOON_AE_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_ID = NOON_UNDEPOSITED.accountId
process.env.NOON_AE_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_CODE = NOON_UNDEPOSITED.accountCode
process.env.NOON_AE_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_NAME = NOON_UNDEPOSITED.accountName
process.env.NOON_AE_ZOHO_COMMISSION_ACCOUNT_ID = 'comm-clear-1'
process.env.NOON_AE_ZOHO_COMMISSION_ACCOUNT_CODE = '1067'
process.env.NOON_AE_ZOHO_COMMISSION_ACCOUNT_NAME = 'Noon Uncleared Commission 14%'
process.env.NOON_AE_ZOHO_SHIPPING_ACCOUNT_ID = NOON_UNCLEARED_SHIPPING.accountId
process.env.NOON_AE_ZOHO_SHIPPING_ACCOUNT_CODE = NOON_UNCLEARED_SHIPPING.accountCode
process.env.NOON_AE_ZOHO_SHIPPING_ACCOUNT_NAME = NOON_UNCLEARED_SHIPPING.accountName
process.env.NOON_AE_ZOHO_INPUT_VAT_ACCOUNT_ID = NOON_INPUT_VAT.accountId
process.env.NOON_AE_ZOHO_INPUT_VAT_ACCOUNT_CODE = NOON_INPUT_VAT.accountCode
process.env.NOON_AE_ZOHO_INPUT_VAT_ACCOUNT_NAME = NOON_INPUT_VAT.accountName

function csvHeader() {
  return [
    'CONTRACT',
    'Contract Type',
    'Reference Nr',
    'Order Nr',
    'Item Nr',
    'Order Date',
    'Transaction Date',
    'Title',
    'SKUs',
    'Partner SKU',
    'Transaction Type',
    'Currency',
    'Net Proceed',
    'Referral Fee',
    'Fulfillment Fee',
    'Shipping Charges',
    'Other Order Fees',
    'Order Subscription Fees',
    'Non-Order Fees',
    'Non-Order Subscription Fees',
    'Others Incl. VAT',
    'Total',
  ].join(',')
}

function csvRow(values) {
  return values.join(',')
}

describe('noonOrderIdHelper', () => {
  it('parses recognized item IDs without discarding the original', () => {
    const parsed = parseNoonOrderId('NAEI70003640128-4')
    assert.equal(parsed.shape, 'item')
    assert.equal(parsed.parentOrderId, 'NAEI70003640128')
    assert.equal(parsed.itemOrderId, 'NAEI70003640128-4')
    assert.equal(parsed.itemSuffix, '4')
    assert.equal(parsed.original, 'NAEI70003640128-4')
    assert.equal(isRecognizedNoonItemOrderId('NAEI70003640128-4'), true)
  })

  it('does not strip -number from arbitrary references', () => {
    const parsed = parseNoonOrderId('INV-2026-4')
    assert.equal(parsed.recognized, false)
    assert.equal(parsed.shape, 'other')
    assert.equal(parsed.itemOrderId, '')
  })

  it('resolves parent + item from Order Nr / Item Nr', () => {
    const ids = resolveNoonOrderIds({
      orderNr: 'NAEI70003640128',
      itemNr: 'NAEI70003640128-2',
    })
    assert.equal(ids.parentOrderId, 'NAEI70003640128')
    assert.equal(ids.itemOrderId, 'NAEI70003640128-2')
    assert.equal(ids.hasItemLevelId, true)
  })

  it('one parent / one child', () => {
    const ids = resolveNoonOrderIds({
      orderNr: 'NAEI70003640128',
      itemNr: 'NAEI70003640128-1',
    })
    assert.equal(ids.parentOrderId, 'NAEI70003640128')
    assert.equal(ids.itemOrderId, 'NAEI70003640128-1')
  })
})

describe('classification', () => {
  it('classifies statement advertising as statement_fee (no invoice)', () => {
    const row = normalizeNoonStatementRow({
      'reference-nr': 'PS-1',
      'transaction-type': 'statement',
      title: 'Advertising Fee',
      'non-order-fees': '-2009.62',
      total: '-2009.62',
    })
    assert.equal(row.rowClass, ROW_CLASS.STATEMENT_FEE)
    assert.equal(row.normalizedFeeType, NORMALIZED_FEE_TYPE.NOON_ADVERTISING_FEE)
    assert.equal(requiresZohoInvoice(row.rowClass), false)
  })

  it('classifies real Noon export statement_fee + Order Nr NA as advertising', () => {
    const row = normalizeNoonStatementRow({
      contract: 'MPABUKYTZQAE',
      'contract-title': 'NOON-AE',
      'reference-nr': 'PS-11752-AE20260708',
      'order-nr': 'NA',
      'item-nr': '',
      'transaction-date': '2026-07-08',
      title: 'Advertising Fee',
      'transaction-type': 'statement_fee',
      currency: 'AED',
      'non-order-fees-including-vat': '-2009.62',
      total: '-2009.62',
    })
    assert.equal(row.parentOrderId, '')
    assert.equal(row.rowClass, ROW_CLASS.STATEMENT_FEE)
    assert.equal(row.normalizedFeeType, NORMALIZED_FEE_TYPE.NOON_ADVERTISING_FEE)
    assert.equal(requiresZohoInvoice(row.rowClass), false)
  })

  it('maps Fullfilment & Logistics + Order Subsidies headers and preserves positive credits', () => {
    const row = normalizeNoonStatementRow({
      'order-nr': 'NAEI70003640128',
      'item-nr': '',
      'transaction-type': 'order',
      title: 'PGB2706778467A',
      'fullfilment-&-logistics-fees-including-vat': '0',
      'order-subsidies-including-vat': '4.73',
      total: '4.73',
    })
    assert.equal(row.rowClass, ROW_CLASS.PARENT_ORDER_CHARGE)
    assert.equal(row.total, 4.73)
    assert.equal(row.othersInclVat, 4.73)
  })

  it('classifies order_update as adjustment (no invoice)', () => {
    const row = normalizeNoonStatementRow({
      'order-nr': 'NAEI70003640128',
      'item-nr': 'NAEI70003640128',
      'transaction-type': 'order_update',
      'others-incl-vat': '-11.81',
      total: '-11.81',
    })
    assert.equal(row.rowClass, ROW_CLASS.ORDER_ADJUSTMENT)
    assert.equal(requiresZohoInvoice(row.rowClass), false)
  })

  it('classifies parent-level shipping/fulfillment as parent_order_charge', () => {
    const row = normalizeNoonStatementRow({
      'order-nr': 'NAEI70003640128',
      'item-nr': 'NAEI70003640128',
      'transaction-type': 'order',
      title: 'PG84755330813A',
      'fulfillment-fee': '-23.63',
      total: '-23.63',
    })
    assert.equal(row.rowClass, ROW_CLASS.PARENT_ORDER_CHARGE)
    assert.equal(requiresZohoInvoice(row.rowClass), false)
  })

  it('classifies item sale as sale_item requiring invoice', () => {
    const row = normalizeNoonStatementRow({
      'order-nr': 'NAEI70003640128',
      'item-nr': 'NAEI70003640128-1',
      'transaction-type': 'order',
      title: 'SKU A Pot',
      skus: 'SKU-A',
      'net-proceed': '190',
      'referral-fee': '-29.93',
      total: '160.07',
    })
    assert.equal(row.rowClass, ROW_CLASS.SALE_ITEM)
    assert.equal(requiresZohoInvoice(row.rowClass), true)
  })
})

describe('acceptance: NAEI70003640128 parent / children / parent charge', () => {
  const statement = [
    csvHeader(),
    csvRow([
      'MPABUKYYZQAE',
      'NOON-AE',
      'PS-TEST-AE20260708',
      '',
      '',
      '',
      '08/07/2026',
      'Advertising Fee',
      '',
      '',
      'statement',
      'AED',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '-2009.62',
      '0',
      '0',
      '-2009.62',
    ]),
    csvRow([
      'MPABUKYYZQAE',
      'NOON-AE',
      'PS-TEST-AE20260708',
      'NAEI70003640128',
      'NAEI70003640128',
      '01/07/2026',
      '08/07/2026',
      'PGSHIPPING1',
      '',
      '',
      'order',
      'AED',
      '0',
      '0',
      '-15.00',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '-15.00',
    ]),
    csvRow([
      'MPABUKYYZQAE',
      'NOON-AE',
      'PS-TEST-AE20260708',
      'NAEI70003640128',
      'NAEI70003640128-1',
      '01/07/2026',
      '08/07/2026',
      'SKU A Pot',
      'SKU-A',
      'PSKU-A',
      'order',
      'AED',
      '100',
      '-10',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '90',
    ]),
    csvRow([
      'MPABUKYYZQAE',
      'NOON-AE',
      'PS-TEST-AE20260708',
      'NAEI70003640128',
      'NAEI70003640128-2',
      '01/07/2026',
      '08/07/2026',
      'SKU B Pan',
      'SKU-B',
      'PSKU-B',
      'order',
      'AED',
      '200',
      '-20',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '180',
    ]),
    csvRow([
      'MPABUKYYZQAE',
      'NOON-AE',
      'PS-TEST-AE20260708',
      'NAEI70003640128',
      'NAEI70003640128-1',
      '01/07/2026',
      '08/07/2026',
      'PGADJ1',
      '',
      '',
      'order_update',
      'AED',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '-5',
      '-5',
    ]),
  ].join('\n')

  const invoices = [
    {
      invoice_id: 'inv-a',
      invoice_number: 'INV-A',
      reference_number: 'NAEI70003640128-1',
      customer_id: 'cust-1',
      customer_name: 'Noon',
      total: 110,
    },
    {
      invoice_id: 'inv-b',
      invoice_number: 'INV-B',
      reference_number: 'NAEI70003640128-2',
      customer_id: 'cust-1',
      customer_name: 'Noon',
      total: 220,
    },
  ]

  it('parses statement and builds hierarchy with separate children', () => {
    const parsed = parseNoonStatementReport(statement)
    assert.equal(parsed.metadata.referenceNr, 'PS-TEST-AE20260708')
    assert.equal(parsed.rows.length, 5)
    const hierarchy = buildNoonOrderHierarchy(parsed.rows)
    assert.equal(hierarchy.parentGroups.length, 1)
    assert.equal(hierarchy.parentGroups[0].parentOrderId, 'NAEI70003640128')
    assert.equal(hierarchy.parentGroups[0].children.length, 2)
    assert.equal(hierarchy.parentGroups[0].parentCharges.length, 1)
    assert.equal(hierarchy.statementFees.length, 1)
  })

  it('matches child invoices exactly and keeps them separate', () => {
    const parsed = parseNoonStatementReport(statement)
    const match = matchNoonRowsToInvoices(parsed.rows, invoices)
    assert.equal(match.matchedOrders.length, 2)
    const a = match.matchedOrders.find((m) => m.itemOrderId === 'NAEI70003640128-1')
    const b = match.matchedOrders.find((m) => m.itemOrderId === 'NAEI70003640128-2')
    assert.equal(a.zohoInvoiceId, 'inv-a')
    assert.equal(b.zohoInvoiceId, 'inv-b')
    assert.notEqual(a.zohoInvoiceId, b.zohoInvoiceId)
  })

  it('does not flag parent shipping charge as missing invoice', () => {
    const parsed = parseNoonStatementReport(statement)
    const match = matchNoonRowsToInvoices(parsed.rows, invoices)
    const preview = buildPreview({
      rows: parsed.rows,
      metadata: parsed.metadata,
      matchResult: match,
    })
    assert.equal(preview.parentCharges.length, 1)
    assert.equal(preview.parentCharges[0].matchStatus, 'not_applicable')
    assert.ok(!preview.blockingIssues.some((i) => i.code === 'MISSING_INVOICE' && i.parentOrderId === 'NAEI70003640128' && !i.itemOrderId))
    assert.ok(!preview.unmatchedOrders.some((u) => u.itemOrderId === 'NAEI70003640128'))
  })

  it('protects against matching parent order ID to a child invoice', () => {
    assert.equal(
      wouldParentMatchChildInvoice('NAEI70003640128', 'NAEI70003640128-1', 'NAEI70003640128'),
      true
    )
    assert.equal(
      wouldParentMatchChildInvoice('NAEI70003640128', 'NAEI70003640128-1', 'NAEI70003640128-1'),
      false
    )
    assert.equal(
      isParentOnlyMatch({
        candidate: 'NAEI70003640128',
        itemOrderId: 'NAEI70003640128-1',
        parentOrderId: 'NAEI70003640128',
      }),
      true
    )

    const parsed = parseNoonStatementReport(statement)
    // Zoho only has parent PO — must NOT match child sales
    const parentOnlyInvoices = [
      {
        invoice_id: 'inv-parent',
        invoice_number: 'INV-P',
        reference_number: 'NAEI70003640128',
        customer_id: 'cust-1',
        total: 300,
      },
    ]
    const match = matchNoonRowsToInvoices(parsed.rows, parentOnlyInvoices)
    assert.equal(match.matchedOrders.length, 0)
    assert.ok(match.unmatchedOrders.some((u) => u.itemOrderId === 'NAEI70003640128-1'))
    assert.ok(match.unmatchedOrders.some((u) => u.itemOrderId === 'NAEI70003640128-2'))
  })

  it('flags missing one child invoice', () => {
    const parsed = parseNoonStatementReport(statement)
    const match = matchNoonRowsToInvoices(parsed.rows, [invoices[0]])
    assert.equal(match.matchedOrders.length, 1)
    assert.ok(match.unmatchedOrders.some((u) => u.itemOrderId === 'NAEI70003640128-2'))
    const preview = buildPreview({ rows: parsed.rows, metadata: parsed.metadata, matchResult: match })
    assert.throws(() => validateBatchReadyForApproval({
      reconciliationSummary: preview.reconciliationSummary,
      unmatchedOrders: preview.unmatchedOrders,
      multipleMatchItems: preview.multipleMatchItems,
      blockingIssues: preview.blockingIssues,
    }))
  })

  it('detects duplicate child invoice matches', () => {
    const parsed = parseNoonStatementReport(statement)
    const dupInvoices = [
      invoices[0],
      { ...invoices[0], invoice_id: 'inv-a-2', invoice_number: 'INV-A2' },
      invoices[1],
    ]
    const match = matchNoonRowsToInvoices(parsed.rows, dupInvoices)
    assert.ok(match.multipleMatchItems.some((m) => m.itemOrderId === 'NAEI70003640128-1'))
  })

  it('reconciles fully when statement totals tie out', () => {
    const parsed = parseNoonStatementReport(statement)
    const recon = buildNoonReconciliationSummary(parsed.rows, parsed.metadata)
    assert.equal(recon.reconciliationStatus, 'reconciled')
    assert.ok(isNoonSettlementReconciliationAcceptable(recon))
    assert.ok(Math.abs(recon.parentOrderCharges - -15) < 0.001)
    assert.ok(Math.abs(recon.advertisingFees - -2009.62) < 0.001)
  })

  it('blocks approval on reconciliation mismatch', () => {
    const recon = {
      reconciliationStatus: 'mismatch',
      reconciliationDifference: 12.5,
    }
    assert.equal(isNoonSettlementReconciliationAcceptable(recon), false)
    assert.throws(() =>
      validateBatchReadyForApproval({
        reconciliationSummary: recon,
        unmatchedOrders: [],
        multipleMatchItems: [],
        blockingIssues: [],
      })
    )
  })

  it('payment preview separates invoice payments from parent/statement journals and assigns parent fallback once', () => {
    const parsed = parseNoonStatementReport(statement)
    const match = matchNoonRowsToInvoices(parsed.rows, invoices)
    const mappingRules = [
      {
        normalizedFeeType: 'NOON_ADVERTISING_FEE',
        zohoAccountId: 'd1',
        zohoAccountName: 'Advertising Expense',
        debitAccountId: 'd1',
        debitAccountName: 'Advertising Expense',
        isActive: true,
      },
      {
        normalizedFeeType: 'FULFILLMENT',
        zohoAccountId: 'd2',
        zohoAccountName: 'Fulfillment / Logistics Expense',
        debitAccountId: 'd2',
        debitAccountName: 'Fulfillment / Logistics Expense',
        isActive: true,
      },
      {
        normalizedFeeType: 'ORDER_ADJUSTMENT',
        zohoAccountId: 'd3',
        zohoAccountName: 'Marketplace Adjustments',
        debitAccountId: 'd3',
        debitAccountName: 'Marketplace Adjustments',
        isActive: true,
      },
    ]
    const preview = buildPreview({
      rows: parsed.rows,
      metadata: parsed.metadata,
      matchResult: match,
      mappingRules,
      inputVatAccount: NOON_INPUT_VAT,
      zohoCustomerId: NOON_CUSTOMER.customerId,
      zohoCustomerName: NOON_CUSTOMER.customerName,
    })
    const parentCharge = preview.parentCharges[0]
    assert.equal(parentCharge.originalParentOrderId, 'NAEI70003640128')
    assert.equal(parentCharge.assignedItemOrderId, 'NAEI70003640128-1')
    assert.equal(parentCharge.assignmentReason, 'parent_order_fallback')
    assert.equal(parentCharge.itemOrderId, '')
    assert.equal(
      preview.parentCharges.filter((p) => p.assignedItemOrderId === 'NAEI70003640128-1').length,
      1
    )
    const advLine = preview.feeJournalLines.find((l) => l.normalizedFeeType === 'NOON_ADVERTISING_FEE')
    assert.ok(advLine)
    assert.equal(advLine.signedAmount, -2009.62)
    assert.equal(advLine.displayLabel, 'Advertising Fee')
    assert.equal(advLine.mappingStatus, 'mapped')
    assert.equal(advLine.netExpense, -1913.92)
    assert.equal(advLine.inputVatAmount, -95.7)
    assert.equal(advLine.debit.accountName, 'Advertising Expense')
    assert.equal(advLine.credit.accountName, 'Noon Undeposited Funds')
    assert.equal(advLine.credit.accountCode, '1066')
    assert.equal(advLine.accountingPreview.credit, 'Noon Undeposited Funds')
    assert.equal(advLine.accountingPreview.expenseAccount, 'Advertising Expense')
    assert.equal(advLine.accountingPreview.vatAccount, 'Input VAT - All Except Basmat Goods WH')
    assert.equal(advLine.lineItems.length, 3)
    assert.equal(advLine.lineItems[0].amount, 1913.92)
    assert.equal(advLine.lineItems[1].accountName, 'Input VAT - All Except Basmat Goods WH')
    assert.equal(advLine.lineItems[1].amount, 95.7)
    assert.equal(advLine.lineItems[2].accountName, 'Noon Undeposited Funds')
    assert.equal(advLine.lineItems[2].amount, 2009.62)
    // Parent fulfillment is NOT a settlement fee journal — clears via invoice payment to 1068.
    assert.ok(
      !preview.feeJournalLines.some(
        (l) => l.normalizedFeeType === 'FULFILLMENT' || l.rowClass === 'parent_order_charge'
      )
    )
    assert.match(advLine.previewNote, /No invoice required/i)
    assert.ok(!preview.blockingIssues.some((i) => i.code === 'UNEXPLAINED_OTHER'))

    const batch = {
      batchId: 1,
      status: 'approved',
      reconciliationSummary: preview.reconciliationSummary,
      unmatchedOrders: [],
      multipleMatchItems: [],
      matchedOrders: preview.matchedOrders,
      allRows: preview.allRows,
      reportSnapshot: preview.metadata,
      feeJournalLines: preview.feeJournalLines,
    }
    const paymentPreview = buildPaymentPreviewFromBatch(batch, mappingRules, NOON_INPUT_VAT)
    assert.equal(paymentPreview.invoicePayments.length, 2)
    assert.ok(paymentPreview.invoicePayments.every((p) => p.itemOrderId.includes('-')))
    assert.ok(paymentPreview.parentLevelCharges.length >= 1)
    assert.ok(paymentPreview.statementLevelCharges.length >= 1)
    const parentFolded = paymentPreview.parentLevelCharges[0]
    assert.equal(parentFolded.assignedItemOrderId, 'NAEI70003640128-1')
    assert.match(String(parentFolded.previewNote || ''), /Folded into invoice payment/i)
    assert.equal(parentFolded.clearingPath, 'invoice_payment_uncleared')
    // Parent charge must not appear as a fee journal
    assert.equal(
      paymentPreview.feeJournalLines.filter(
        (l) => l.rowNumber === parentCharge.rowNumber && l.rowClass === 'parent_order_charge'
      ).length,
      0
    )
    const child1 = paymentPreview.invoicePayments.find((p) => p.itemOrderId === 'NAEI70003640128-1')
    assert.ok(child1)
    // Parent fulfillment -15 + item order_update -5 → uncleared shipping payment (statement totals)
    assert.equal(child1.fulfillmentPayment.amount, 20)
    assert.equal(child1.parentLogisticsAddOn, 20)
    assert.equal(child1.fulfillmentPayment.depositToAccountCode, '1068')
    assert.equal(child1.commissionPayment.depositToAccountCode, '1067')
    assert.equal(child1.netBalancePayment.depositToAccountCode, '1066')
    // Parent charge must not appear as a fake parent-only invoice payment
    assert.ok(!paymentPreview.invoicePayments.some((p) => p.itemOrderId === 'NAEI70003640128'))
    const flat = flattenInvoicePayments(paymentPreview)
    assert.ok(flat.every((r) => r.itemOrderId === 'NAEI70003640128-1' || r.itemOrderId === 'NAEI70003640128-2'))
  })

  it('dry-run posting gate requires payment preview', async () => {
    await assert.rejects(
      () =>
        ensureCanPostBatch(
          {
            status: 'approved',
            reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
            unmatchedOrders: [],
            feeJournalLines: [],
          },
          false,
          { dryRun: true }
        ),
      /payment preview/i
    )
  })
})

describe('duplicate statement identity', () => {
  it('uses Reference Nr as statement identity in metadata', () => {
    const parsed = parseNoonStatementReport(
      [csvHeader(), csvRow(['X', 'NOON-AE', 'PS-DUP-1', '', '', '', '08/07/2026', 'Advertising Fee', '', '', 'statement', 'AED', '0', '0', '0', '0', '0', '0', '-1', '0', '0', '-1'])].join(
        '\n'
      )
    )
    assert.equal(parsed.metadata.referenceNr, 'PS-DUP-1')
  })
})

describe('Zoho invoice field matching', () => {
  it('matches Zoho Order Number custom field (UI column), not only PO/reference', () => {
    const rows = [
      normalizeNoonStatementRow({
        'order-nr': 'NAEI70003640128',
        'item-nr': 'NAEI70003640128-1',
        'transaction-type': 'order',
        title: 'SKU A Pot',
        skus: 'SKU-A',
        'net-proceed': '100',
        total: '90',
      }, 1),
    ]
    const invoices = [
      {
        invoice_id: 'inv-order-col',
        invoice_number: 'INV-047155',
        reference_number: '',
        customer_id: 'cust-1',
        total: 191,
        custom_fields: [{ label: 'Order Number', value: 'NAEI70003640128-1' }],
      },
    ]
    const match = matchNoonRowsToInvoices(rows, invoices)
    assert.equal(match.matchedOrders.length, 1)
    assert.equal(match.matchedOrders[0].zohoInvoiceId, 'inv-order-col')
    assert.equal(match.matchedOrders[0].matchType, 'order_number')
  })

  it('mapInvoice prefers Order Number custom field into matchKeys', () => {
    const mapped = mapInvoice({
      invoice_id: '1',
      invoice_number: 'INV-1',
      reference_number: 'OTHER',
      custom_fields: [{ label: 'Order Number', value: 'NAR80348578688-1' }],
    })
    assert.ok(mapped.matchKeys.includes('NAR80348578688-1'))
    assert.ok(mapped.matchKeys.includes('OTHER'))
  })

  it('accepts fetchInvoices result shape { rows } without treating it as empty', () => {
    const rows = [
      normalizeNoonStatementRow({
        'order-nr': 'NAEI70003640128',
        'item-nr': 'NAEI70003640128-2',
        'transaction-type': 'order',
        title: 'SKU B',
        skus: 'SKU-B',
        'net-proceed': '200',
        total: '180',
      }, 1),
    ]
    const match = matchNoonRowsToInvoices(rows, {
      rows: [
        {
          invoice_id: 'inv-b',
          invoice_number: 'INV-B',
          reference_number: 'NAEI70003640128-2',
          total: 220,
        },
      ],
      truncated: false,
      pages: 1,
    })
    assert.equal(match.matchedOrders.length, 1)
    assert.equal(match.matchedOrders[0].zohoInvoiceId, 'inv-b')
  })

  it('uses a multi-year invoice lookback so older Noon invoices are still fetched', () => {
    assert.ok(INVOICE_LOOKBACK_DAYS >= 365)
    const range = deriveInvoiceRange([
      { orderDate: '2026-07-01', transactionDate: '2026-07-08' },
    ])
    assert.ok(range.fromDate <= '2024-07-01')
  })
})

describe('classifyNoonStatementRow edge', () => {
  it('does not invent sale_item for fee-only parent rows', () => {
    assert.equal(
      classifyNoonStatementRow({
        transactionType: 'order',
        orderNr: 'NAEI70003640128',
        itemNr: 'NAEI70003640128',
        netProceed: 0,
        fulfillmentFee: -9,
        total: -9,
        title: 'PGCODE',
      }),
      ROW_CLASS.PARENT_ORDER_CHARGE
    )
  })
})

describe('Noon fee journal direction', () => {
  it('debits expense and credits Undeposited Funds for negative advertising', () => {
    const sides = resolveNoonFeeJournalSides({
      feeAccountId: 'exp-1',
      feeAccountName: 'Advertising Expense',
      clearingAccountId: 'undep-1',
      clearingAccountName: 'Noon Undeposited Funds',
      clearingAccountCode: '1066',
      signedAmount: -2009.62,
    })
    assert.equal(sides.direction, 'expense')
    assert.equal(sides.amount, 2009.62)
    assert.equal(sides.debit.accountName, 'Advertising Expense')
    assert.equal(sides.credit.accountName, 'Noon Undeposited Funds')
    assert.equal(sides.credit.accountCode, '1066')
  })

  it('reverses sides for positive shipping credits against Uncleared Shipping', () => {
    const sides = resolveNoonFeeJournalSides({
      feeAccountId: 'ship-1',
      feeAccountName: 'Noon Shipping Exp',
      clearingAccountId: 'ship-clear-1',
      clearingAccountName: 'Noon Uncleared Shipping Charges',
      clearingAccountCode: '1068',
      signedAmount: 4.73,
    })
    assert.equal(sides.direction, 'credit_reversal')
    assert.equal(sides.amount, 4.73)
    assert.equal(sides.debit.accountName, 'Noon Uncleared Shipping Charges')
    assert.equal(sides.credit.accountName, 'Noon Shipping Exp')
  })

  it('marks journal mapped only when fee account and clearing GL exist', () => {
    const rows = [
      {
        rowNumber: 1,
        rowClass: 'statement_fee',
        normalizedFeeType: 'NOON_ADVERTISING_FEE',
        title: 'Advertising Fee',
        total: -2009.62,
      },
    ]
    const unmapped = buildFeeJournalPreviewLines(rows, [], { accountId: '', accountCode: '', accountName: '' })
    assert.equal(unmapped[0].mappingStatus, 'needs_mapping')
    // Row has only total (no VAT-inclusive source column) → no VAT split required.
    const mapped = buildFeeJournalPreviewLines(
      rows,
      [{ normalizedFeeType: 'NOON_ADVERTISING_FEE', zohoAccountId: 'exp-1', zohoAccountName: 'Advertising Expense', isActive: true }],
      { accountId: '', accountCode: '', accountName: '' }
    )
    assert.equal(mapped[0].mappingStatus, 'mapped')
    assert.equal(mapped[0].debit.accountId, 'exp-1')
    assert.equal(mapped[0].credit.accountId, 'undep-1')
    assert.equal(mapped[0].credit.accountName, 'Noon Undeposited Funds')

    const vatRows = [{ ...rows[0], nonOrderFees: -2009.62, total: -2009.62 }]
    const needsVatAccount = buildFeeJournalPreviewLines(
      vatRows,
      [{ normalizedFeeType: 'NOON_ADVERTISING_FEE', zohoAccountId: 'exp-1', zohoAccountName: 'Advertising Expense', isActive: true }],
      { accountId: '', accountCode: '', accountName: '' }
    )
    assert.equal(needsVatAccount[0].mappingStatus, 'needs_mapping')
    const withVatAccount = buildFeeJournalPreviewLines(
      vatRows,
      [{ normalizedFeeType: 'NOON_ADVERTISING_FEE', zohoAccountId: 'exp-1', zohoAccountName: 'Advertising Expense', isActive: true }],
      NOON_INPUT_VAT
    )
    assert.equal(withVatAccount[0].mappingStatus, 'mapped')
    assert.equal(withVatAccount[0].inputVatAccountId, 'vat-1')
    assert.equal(withVatAccount[0].lineItems[2].accountCode, '1066')
  })
})

describe('Noon VAT-inclusive service fees', () => {
  it('splits -42.84 VAT-inclusive fulfillment to net -40.80 and VAT -2.04', () => {
    const split = splitVatInclusiveAmount(-42.84, 0.05)
    assert.equal(split.netAmount, -40.8)
    assert.equal(split.vatAmount, -2.04)
    assert.equal(split.originalGrossAmount, -42.84)
    assert.equal(round2(split.netAmount + split.vatAmount), -42.84)
  })

  it('splits VAT-inclusive referral fee', () => {
    const extracted = extractVatFromNoonRow({
      referralFee: -21,
      total: -21,
      netProceed: 0,
    })
    assert.equal(extracted.vatInclusive, true)
    assert.equal(extracted.netAmount, -20)
    assert.equal(extracted.vatAmount, -1)
    assert.equal(extracted.vatSource, 'calculated')
  })

  it('splits VAT-inclusive shipping fee and positive reversal with sign preserved', () => {
    const ship = extractVatFromNoonRow({ shippingCharges: -10.5, total: -10.5 })
    assert.equal(ship.netAmount, -10)
    assert.equal(ship.vatAmount, -0.5)

    const credit = extractVatFromNoonRow({ shippingCharges: 4.73, total: 4.73 })
    assert.equal(credit.originalGrossAmount, 4.73)
    assert.equal(round2(credit.netAmount + credit.vatAmount), 4.73)
    assert.ok(credit.netAmount > 0)
    assert.ok(credit.vatAmount > 0)

    const sides = resolveNoonFeeJournalSides({
      feeAccountId: 'ship-1',
      feeAccountName: 'Noon Shipping Exp',
      clearingAccountId: 'ship-clear-1',
      clearingAccountName: 'Noon Uncleared Shipping Charges',
      clearingAccountCode: '1068',
      inputVatAccountId: 'vat-1',
      inputVatAccountName: 'Input VAT - All Except Basmat Goods WH',
      inputVatAccountCode: '1085',
      signedAmount: 4.73,
      netAmount: credit.netAmount,
      vatAmount: credit.vatAmount,
      vatInclusive: true,
    })
    assert.equal(sides.direction, 'credit_reversal')
    assert.equal(sides.lineItems.length, 3)
    assert.equal(sides.lineItems[0].debitOrCredit, 'debit')
    assert.equal(sides.lineItems[0].accountName, 'Noon Uncleared Shipping Charges')
    assert.equal(sides.lineItems[0].accountCode, '1068')
    assert.equal(sides.lineItems[0].amount, 4.73)
  })

  it('does not VAT-split product sales proceeds / netProceed', () => {
    const sale = extractVatFromNoonRow({
      netProceed: 100,
      referralFee: 0,
      fulfillmentFee: 0,
      total: 100,
    })
    assert.equal(sale.vatInclusive, false)
    assert.equal(sale.vatAmount, 0)
    assert.equal(sale.netAmount, 100)
    assert.equal(sale.nonVatResidue, 100)
  })

  it('does not invent VAT for unknown fees without including-VAT source fields', () => {
    const unknown = extractVatFromNoonRow({
      total: -12.34,
      netProceed: 0,
      title: 'Mystery',
    })
    assert.equal(unknown.vatInclusive, false)
    assert.equal(unknown.vatAmount, 0)
    assert.equal(unknown.netAmount, -12.34)
  })

  it('prefers explicit Noon VAT over calculated VAT', () => {
    const split = resolveVatSplit({
      grossAmount: -42.84,
      explicitVatAmount: -2.1,
      vatInclusive: true,
      vatRate: 0.05,
    })
    assert.equal(split.vatSource, 'explicit')
    assert.equal(split.vatAmount, -2.1)
    assert.equal(split.netAmount, -40.74)
  })

  it('rounds to AED 0.01 and guarantees net + VAT = gross', () => {
    const awkward = splitVatInclusiveAmount(-1.01, 0.05)
    assert.equal(round2(awkward.netAmount + awkward.vatAmount), -1.01)
    assert.match(awkward.netAmount.toFixed(2), /^\-?\d+\.\d{2}$/)
    assert.match(awkward.vatAmount.toFixed(2), /^\-?\d+\.\d{2}$/)
  })

  it('keeps statement settlement unchanged after VAT decomposition (fixture)', () => {
    const parsed = parseNoonStatementReport(
      [
        csvHeader(),
        csvRow([
          'MPABUKYYZQAE',
          'NOON-AE',
          'PS-VAT-FIX',
          '',
          '',
          '',
          '08/07/2026',
          'Advertising Fee',
          '',
          '',
          'statement',
          'AED',
          '0',
          '0',
          '0',
          '0',
          '0',
          '0',
          '-2009.62',
          '0',
          '0',
          '-2009.62',
        ]),
        csvRow([
          'MPABUKYYZQAE',
          'NOON-AE',
          'PS-VAT-FIX',
          'NAEI1',
          'NAEI1-1',
          '01/07/2026',
          '08/07/2026',
          'Item',
          'SKU',
          '',
          'order',
          'AED',
          '11100.28',
          '0',
          '0',
          '0',
          '0',
          '0',
          '0',
          '0',
          '0',
          '11100.28',
        ]),
      ].join('\n')
    )
    // Force expected settlement metadata like Noon export.
    parsed.metadata.actualSettlementTotal = 9090.66
    // Adjust so calculated = 9090.66: 11100.28 - 2009.62 = 9090.66
    const recon = buildNoonReconciliationSummary(parsed.rows, parsed.metadata)
    assert.equal(recon.calculatedSettlement, 9090.66)
    assert.equal(recon.expectedSettlement, 9090.66)

    const preview = buildPreview({
      rows: parsed.rows,
      metadata: parsed.metadata,
      matchResult: {
        annotatedRows: parsed.rows,
        matchedOrders: [],
        unmatchedOrders: [],
        multipleMatchItems: [],
      },
      mappingRules: [
        {
          normalizedFeeType: 'NOON_ADVERTISING_FEE',
          zohoAccountId: 'd1',
          zohoAccountName: 'Advertising Expense',
          isActive: true,
        },
      ],
      inputVatAccount: NOON_INPUT_VAT,
    })
    assert.equal(preview.reconciliationSummary.calculatedSettlement, 9090.66)
    const adv = preview.feeJournalLines.find((l) => l.normalizedFeeType === 'NOON_ADVERTISING_FEE')
    assert.equal(adv.signedAmount, -2009.62)
    assert.equal(adv.netExpense, -1913.92)
    assert.equal(adv.inputVatAmount, -95.7)
    assert.equal(round2(adv.netExpense + adv.inputVatAmount), -2009.62)
    assert.equal(adv.credit.accountCode, '1066')
  })

  it('does not build settlement fee journals for parent fulfillment (payment → 1068 instead)', () => {
    const lines = buildFeeJournalPreviewLines(
      [
        {
          rowNumber: 1,
          rowClass: 'parent_order_charge',
          normalizedFeeType: 'FULFILLMENT',
          title: 'PGSHIP',
          fulfillmentFee: -42.84,
          total: -42.84,
          assignedItemOrderId: 'NAEI70003640128-1',
        },
      ],
      [
        {
          normalizedFeeType: 'FULFILLMENT',
          zohoAccountId: 'ful-1',
          zohoAccountName: 'Noon Shipping Exp',
          isActive: true,
        },
      ],
      NOON_INPUT_VAT
    )
    assert.equal(lines.length, 0)
  })
})

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

describe('parent-order fallback bounds', () => {
  it('uses strict parent/child comparison and lowest suffix', () => {
    assert.equal(isStrictChildOfParent('NAEI70003640128', 'NAEI70003640128-1'), true)
    assert.equal(isStrictChildOfParent('NAEI70003640128', 'NAEI700036401280-1'), false)
    assert.equal(isStrictChildOfParent('NAEI70003640128', 'NAEI70003640128'), false)

    const child = findDeterministicChildForParent('NAEI70003640128', [
      {
        matchStatus: 'matched',
        itemOrderId: 'NAEI70003640128-2',
        zohoInvoiceId: 'inv-2',
      },
      {
        matchStatus: 'matched',
        itemOrderId: 'NAEI70003640128-1',
        zohoInvoiceId: 'inv-1',
      },
      {
        matchStatus: 'matched',
        itemOrderId: 'NAEI700036401280-1',
        zohoInvoiceId: 'inv-trap',
      },
    ])
    assert.equal(child.itemOrderId, 'NAEI70003640128-1')

    const rows = applyParentOrderChargeFallback(
      [
        {
          rowNumber: 9,
          rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
          parentOrderId: 'NAEI70003640128',
          itemOrderId: '',
          total: -18.9,
          fulfillmentFee: -18.9,
          title: 'PGSHIP',
        },
      ],
      [
        { matchStatus: 'matched', itemOrderId: 'NAEI70003640128-2', zohoInvoiceId: 'inv-2' },
        { matchStatus: 'matched', itemOrderId: 'NAEI70003640128-1', zohoInvoiceId: 'inv-1' },
      ]
    )
    assert.equal(rows[0].assignedItemOrderId, 'NAEI70003640128-1')
    assert.equal(rows[0].originalParentOrderId, 'NAEI70003640128')
    assert.equal(rows[0].itemOrderId, '')
    assert.equal(rows[0].assignmentReason, 'parent_order_fallback')
  })

  it('still flags genuine unexplained other amounts', () => {
    const row = normalizeNoonStatementRow(
      {
        'transaction-type': 'mystery',
        title: 'Unknown blob',
        total: '-12.34',
      },
      99
    )
    assert.equal(row.rowClass, ROW_CLASS.OTHER)
    const preview = buildPreview({
      rows: [row],
      metadata: { actualSettlementTotal: -12.34 },
      matchResult: {
        annotatedRows: [row],
        matchedOrders: [],
        unmatchedOrders: [],
        multipleMatchItems: [],
      },
    })
    assert.ok(preview.blockingIssues.some((i) => i.code === 'UNEXPLAINED_OTHER' && i.rowNumber === 99))
  })
})

describe('parent logistics payment add-ons', () => {
  it('uses statement Total and does not double-count subsidies into shipping (PS-11752 NAEI70000251652)', () => {
    const { collectAssignedUnclearedPaymentAddOns, buildInvoicePaymentPlan } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const { getNoonPaymentClearingMarketplaceConfig } = require('../src/services/noonPaymentClearing/noonPaymentClearingMarketplaceConfig')
    const { applyParentOrderChargeFallback } = require('../src/services/noonPaymentClearing/noonPaymentClearingParentChargeFallback')
    const { ROW_CLASS } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')

    // Real Noon columns: fulfillment -37.8 + subsidy +7.56 = total -30.24
    // Parser merges subsidies into othersInclVat — old code summed both → bogus 22.68.
    const rows = applyParentOrderChargeFallback(
      [
        {
          rowNumber: 26,
          rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
          normalizedFeeType: 'FULFILLMENT',
          parentOrderId: 'NAEI70000251652',
          itemOrderId: '',
          fulfillmentFee: -37.8,
          shippingCharges: 0,
          otherOrderFees: 0,
          orderSubsidies: 7.56,
          othersInclVat: 7.56,
          referralFee: 0,
          total: -30.24,
        },
      ],
      [{ matchStatus: 'matched', itemOrderId: 'NAEI70000251652-1', zohoInvoiceId: 'inv-x' }]
    )
    const addOns = collectAssignedUnclearedPaymentAddOns(rows)
    const forChild = addOns.get('NAEI70000251652-1')
    assert.ok(forChild)
    assert.equal(forChild.fulfillment, 30.24)
    assert.notEqual(forChild.fulfillment, 22.68)

    const plan = buildInvoicePaymentPlan(
      {
        itemOrderId: 'NAEI70000251652-1',
        parentOrderId: 'NAEI70000251652',
        netProceed: 535,
        referralFee: -84.26,
        fulfillmentFee: 0,
        shippingCharges: 0,
        zohoInvoiceId: 'inv-x',
        zohoInvoiceNumber: 'INV-X',
        zohoInvoiceTotal: 535,
      },
      getNoonPaymentClearingMarketplaceConfig().paymentPreviewAccounts,
      forChild
    )
    assert.equal(plan.fulfillmentPayment.amount, 30.24)
    assert.equal(plan.parentLogisticsAddOn, 30.24)
    // 1066 must be residual after fees — never the full Net Proceeds / invoice gross.
    assert.equal(plan.netBalancePayment.amount, 420.5) // 535 - 84.26 - 30.24
    assert.equal(plan.commissionPayment.amount, 84.26)
    assert.equal(plan.totalClearingAmount, 535)
    assert.equal(plan.remainingDifference, 0)
  })

  it('splits PS-11752 cookware sale into 1066 residual + 1067 + 1068 (not full 759 to 1066)', () => {
    const { buildInvoicePaymentPlan } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const { getNoonPaymentClearingMarketplaceConfig } = require('../src/services/noonPaymentClearing/noonPaymentClearingMarketplaceConfig')
    // Real CSV: Net Proceeds 759, Referral -119.54, Fulfillment -33.6, Total 605.86
    const plan = buildInvoicePaymentPlan(
      {
        itemOrderId: 'NAEI60024715688-1',
        netProceed: 759,
        referralFee: -119.54,
        fulfillmentFee: -33.6,
        shippingCharges: 0,
        zohoInvoiceId: 'inv-759',
        zohoInvoiceNumber: 'INV-042276',
        zohoInvoiceTotal: 759,
      },
      getNoonPaymentClearingMarketplaceConfig().paymentPreviewAccounts,
      null
    )
    assert.equal(plan.netBalancePayment.amount, 605.86)
    assert.equal(plan.netBalancePayment.depositToAccountCode, '1066')
    assert.equal(plan.commissionPayment.amount, 119.54)
    assert.equal(plan.commissionPayment.depositToAccountCode, '1067')
    assert.equal(plan.fulfillmentPayment.amount, 33.6)
    assert.equal(plan.fulfillmentPayment.depositToAccountCode, '1068')
    assert.equal(plan.totalClearingAmount, 759)
    assert.notEqual(plan.netBalancePayment.amount, 759)
  })
})

describe('uncleared → expense reclass journals', () => {
  it('builds VAT-split reclass journals from commission and shipping payment totals', () => {
    const { buildUnclearedReclassJournals } = require('../src/services/noonPaymentClearing/noonPaymentClearingUnclearedReclassService')
    const { splitVatInclusiveAmount } = require('../src/services/noonPaymentClearing/noonPaymentClearingVatService')

    const preview = {
      invoicePayments: [
        {
          commissionPayment: { amount: 2322.37 },
          fulfillmentPayment: { amount: 932.12 },
        },
      ],
    }
    const { lines, summary } = buildUnclearedReclassJournals(preview, {
      commissionExpenseAccount: {
        accountId: 'exp-comm',
        accountName: '14% Noon Commission',
        accountCode: '2143',
      },
      shippingExpenseAccount: {
        accountId: 'exp-ship',
        accountName: 'Noon Shipping Exp',
        accountCode: '2162',
      },
      unclearedCommissionAccount: {
        accountId: 'und-comm',
        accountName: 'Noon Uncleared Commission 14%',
        accountCode: '1067',
      },
      unclearedShippingAccount: {
        accountId: 'und-ship',
        accountName: 'Noon Uncleared Shipping Charges',
        accountCode: '1068',
      },
      inputVatAccount: {
        accountId: 'vat-1',
        accountName: 'Input VAT - All Except Basmat Goods WH',
        accountCode: '1085',
      },
      vatRate: 0.05,
    })

    assert.equal(lines.length, 2)
    assert.equal(summary.commissionGross, 2322.37)
    assert.equal(summary.shippingGross, 932.12)

    const comm = lines.find((l) => l.feeType === 'UNCLEARED_COMMISSION_RECLASS')
    const ship = lines.find((l) => l.feeType === 'UNCLEARED_SHIPPING_RECLASS')
    assert.ok(comm)
    assert.ok(ship)
    assert.equal(comm.mappingStatus, 'mapped')
    assert.equal(ship.mappingStatus, 'mapped')

    const expectComm = splitVatInclusiveAmount(-2322.37, 0.05)
    assert.equal(comm.netExpense, expectComm.netAmount)
    assert.equal(comm.inputVatAmount, expectComm.vatAmount)
    assert.equal(comm.credit.accountCode, '1067')
    assert.equal(comm.lineItems.length, 3)
    assert.equal(comm.lineItems[0].accountCode, '2143')
    assert.equal(comm.lineItems[1].accountCode, '1085')
    assert.equal(comm.lineItems[2].accountCode, '1067')

    const expectShip = splitVatInclusiveAmount(-932.12, 0.05)
    assert.equal(ship.netExpense, expectShip.netAmount)
    assert.equal(ship.inputVatAmount, expectShip.vatAmount)
    assert.equal(ship.credit.accountCode, '1068')
    assert.equal(ship.lineItems[0].accountCode, '2162')
  })
})
