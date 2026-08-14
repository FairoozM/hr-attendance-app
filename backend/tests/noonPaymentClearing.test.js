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

    // DB-saved mappings often have credit name but empty id — still must resolve via marketplace 1066.
    const fromDbStyle = buildFeeJournalPreviewLines(
      rows,
      [
        {
          normalizedFeeType: 'NOON_ADVERTISING_FEE',
          zohoAccountId: 'exp-1',
          zohoAccountName: 'Advertising Expense',
          creditAccountName: 'Noon Undeposited Funds',
          creditAccountId: '',
          isActive: true,
        },
      ],
      NOON_INPUT_VAT
    )
    assert.equal(fromDbStyle[0].mappingStatus, 'mapped')
    assert.equal(fromDbStyle[0].credit.accountCode, '1066')
  })

  it('maps STATEMENT_FEE lines using saved NOON_ADVERTISING_FEE mapping alias', () => {
    const lines = buildFeeJournalPreviewLines(
      [
        {
          rowNumber: 2,
          rowClass: 'statement_fee',
          title: 'Statement Fee',
          total: -10,
        },
      ],
      [
        {
          normalizedFeeType: 'NOON_ADVERTISING_FEE',
          zohoAccountId: 'exp-1',
          zohoAccountName: 'Advertising Expense',
          isActive: true,
        },
      ],
      NOON_INPUT_VAT,
      { clearingAccount: { accountId: 'undep-1', accountCode: '1066', accountName: 'Noon Undeposited Funds' } }
    )
    assert.equal(lines[0].mappingStatus, 'mapped')
    assert.equal(lines[0].normalizedFeeType, 'STATEMENT_FEE')
  })

  it('maps advertising when Input VAT is saved and marketplace default expense code exists', () => {
    const lines = buildFeeJournalPreviewLines(
      [
        {
          rowNumber: 1,
          rowClass: 'statement_fee',
          normalizedFeeType: 'NOON_ADVERTISING_FEE',
          title: 'Advertising Fee',
          nonOrderFees: -2009.62,
          total: -2009.62,
        },
      ],
      [],
      NOON_INPUT_VAT,
      { clearingAccount: { accountId: 'undep-1', accountCode: '1066', accountName: 'Noon Undeposited Funds' } }
    )
    assert.equal(lines[0].mappingStatus, 'mapped')
    assert.equal(lines[0].zohoAccountCode, '2053')
  })

  it('does not treat cross-week return row 16 as a fee journal line needing expense mapping', () => {
    const lines = buildFeeJournalPreviewLines(
      [
        {
          rowNumber: 16,
          parentOrderId: 'NAEI70013425039',
          itemOrderId: 'NAEI70013425039-4',
          transactionType: 'order_update',
          rowClass: 'order_adjustment',
          netProceed: -84,
          referralFee: 13.23,
          total: -70.77,
        },
        {
          rowNumber: 1,
          rowClass: 'statement_fee',
          normalizedFeeType: 'NOON_ADVERTISING_FEE',
          title: 'Advertising Fee',
          nonOrderFees: -948.71,
          total: -948.71,
        },
      ],
      [],
      NOON_INPUT_VAT,
      { clearingAccount: { accountId: 'undep-1', accountCode: '1066', accountName: 'Noon Undeposited Funds' } }
    )
    assert.equal(lines.length, 1)
    assert.equal(lines[0].mappingStatus, 'mapped')
    assert.equal(lines[0].rowNumber, 1)
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
    const allRows = [
      {
        rowNumber: 10,
        rowClass: ROW_CLASS.SALE_ITEM,
        parentOrderId: 'NAEI70000251652',
        itemOrderId: 'NAEI70000251652-1',
        netProceed: 535,
        total: 504.76,
      },
      ...rows,
    ]
    const addOns = collectAssignedUnclearedPaymentAddOns(allRows)
    const forChild = addOns.get('NAEI70000251652-1')
    assert.ok(forChild)
    assert.equal(forChild.fulfillment, -30.24)
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

  it('flags and blocks when fees exceed invoice (parent logistics over-allocation)', () => {
    const {
      buildInvoicePaymentPlan,
      collectInvoiceOverpayments,
      assertNoInvoiceOverpayments,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const { getNoonPaymentClearingMarketplaceConfig } = require('../src/services/noonPaymentClearing/noonPaymentClearingMarketplaceConfig')
    const plan = buildInvoicePaymentPlan(
      {
        itemOrderId: 'NAEI-1',
        netProceed: 100,
        referralFee: -20,
        fulfillmentFee: -10,
        shippingCharges: 0,
        zohoInvoiceId: 'inv-1',
        zohoInvoiceNumber: 'INV-1',
        zohoInvoiceTotal: 100,
      },
      getNoonPaymentClearingMarketplaceConfig().paymentPreviewAccounts,
      { commission: 0, fulfillment: -90 }
    )
    // 100 - 20 - 100 = 0 residual; commission 20 + shipping 100 = 120 > invoice 100
    assert.equal(plan.fulfillmentPayment.amount, 100)
    assert.equal(plan.totalClearingAmount, 120)
    assert.equal(plan.exceedsInvoiceTotal, true)
    const over = collectInvoiceOverpayments([plan])
    assert.equal(over.length, 1)
    assert.equal(over[0].overBy, 20)
    assert.throws(
      () => assertNoInvoiceOverpayments({ invoicePayments: [plan], invoiceOverpayments: over }),
      (err) => err && err.code === 'NOON_PAYMENT_CLEARING_INVOICE_OVERPAYMENT'
    )
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

describe('stale Zoho payment skip handling', () => {
  it('clears DB posting and retries when Zoho payment was deleted', async () => {
    const { resolveExistingPaymentSkip } = require('../src/services/noonPaymentClearing/noonPaymentClearingPostingService')
    let cleared = false
    const decision = await resolveExistingPaymentSkip({
      batchId: 99,
      row: { paymentType: 'net_balance', amount: 605.86 },
      findPosting: async () => ({ status: 'posted', zohoPaymentId: '5559', amount: 12000 }),
      getPayment: async () => null,
      clearPosting: async () => {
        cleared = true
      },
    })
    assert.equal(decision.skip, false)
    assert.equal(cleared, true)
    assert.equal(decision.cleared, 'zoho_payment_missing')
  })

  it('skips only when Zoho payment still exists with matching amount', async () => {
    const { resolveExistingPaymentSkip } = require('../src/services/noonPaymentClearing/noonPaymentClearingPostingService')
    const decision = await resolveExistingPaymentSkip({
      batchId: 99,
      row: { paymentType: 'commission', amount: 2322.37 },
      findPosting: async () => ({ status: 'posted', zohoPaymentId: '5560', amount: 2322.37 }),
      getPayment: async () => ({ amount: 2322.37 }),
      clearPosting: async () => {
        throw new Error('should not clear')
      },
    })
    assert.equal(decision.skip, true)
    assert.equal(decision.zohoPaymentId, '5560')
  })

  it('errors when Zoho payment still exists with wrong amount', async () => {
    const { resolveExistingPaymentSkip } = require('../src/services/noonPaymentClearing/noonPaymentClearingPostingService')
    const decision = await resolveExistingPaymentSkip({
      batchId: 99,
      row: { paymentType: 'net_balance', amount: 605.86 },
      findPosting: async () => ({ status: 'posted', zohoPaymentId: '5559', amount: 12000 }),
      getPayment: async () => ({ amount: 12000 }),
      clearPosting: async () => {
        throw new Error('should not clear while Zoho payment exists')
      },
    })
    assert.equal(decision.skip, false)
    assert.match(String(decision.error || ''), /void that payment/i)
  })
})

describe('Zoho payment reference length', () => {
  it('keeps fulfillment_shipping reference under 50 characters', () => {
    const {
      buildEntryReference,
      ZOHO_REFERENCE_MAX_LEN,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingReferenceService')
    const ref = buildEntryReference(
      { statementStartDate: '2026-06-26', statementEndDate: '2026-07-08' },
      'fulfillment_shipping'
    )
    assert.ok(ref.length <= ZOHO_REFERENCE_MAX_LEN, ref)
    assert.match(ref, /ship$/i)
  })
})

describe('shipping payment posting helpers', () => {
  it('posts commission and shipping before net_balance', () => {
    const { sortPaymentPostingRows, PAYMENT_TYPES } = require('../src/services/noonPaymentClearing/noonPaymentClearingPostingService')
    const sorted = sortPaymentPostingRows([
      { paymentType: PAYMENT_TYPES.NET_BALANCE, amount: 1 },
      { paymentType: PAYMENT_TYPES.FULFILLMENT_SHIPPING, amount: 2 },
      { paymentType: PAYMENT_TYPES.COMMISSION, amount: 3 },
    ])
    assert.deepEqual(
      sorted.map((r) => r.paymentType),
      ['commission', 'fulfillment_shipping', 'net_balance']
    )
  })

  it('drops zero-balance invoices from shipping payment instead of failing the whole group', async () => {
    const { trimPaymentRowToLiveBalances } = require('../src/services/noonPaymentClearing/noonPaymentClearingPostingService')
    const { row, dropped } = await trimPaymentRowToLiveBalances(
      {
        paymentType: 'fulfillment_shipping',
        amount: 50,
        invoiceAllocations: [
          { invoiceId: 'open', invoiceNumber: 'INV-1', amountApplied: 30 },
          { invoiceId: 'paid', invoiceNumber: 'INV-2', amountApplied: 20 },
        ],
        zohoPaymentRequest: { amount: 50, invoices: [] },
      },
      {
        fetchInvoicesByIds: async () =>
          new Map([
            ['open', { invoice_id: 'open', balance: 30 }],
            ['paid', { invoice_id: 'paid', balance: 0 }],
          ]),
      }
    )
    assert.equal(row.amount, 30)
    assert.equal(row.invoiceAllocations.length, 1)
    assert.equal(row.invoiceAllocations[0].invoiceId, 'open')
    assert.equal(dropped.length, 1)
    assert.equal(dropped[0].invoiceId, 'paid')
  })

  it('caps duplicate allocations to the same invoice against remaining open balance', async () => {
    const { trimPaymentRowToLiveBalances } = require('../src/services/noonPaymentClearing/noonPaymentClearingPostingService')
    const { row, warnings } = await trimPaymentRowToLiveBalances(
      {
        paymentType: 'fulfillment_shipping',
        amount: 80,
        invoiceAllocations: [
          { invoiceId: 'inv-1', invoiceNumber: 'INV-1', amountApplied: 50 },
          { invoiceId: 'inv-1', invoiceNumber: 'INV-1', amountApplied: 30 },
        ],
        zohoPaymentRequest: { amount: 80, invoices: [] },
      },
      {
        fetchInvoicesByIds: async () => new Map([['inv-1', { invoice_id: 'inv-1', balance: 60 }]]),
      }
    )
    assert.equal(row.amount, 60)
    assert.equal(row.invoiceAllocations.length, 1)
    assert.equal(row.invoiceAllocations[0].amountApplied, 60)
    assert.ok(warnings.length >= 1)
  })
})

describe('live Zoho balance gate on payment preview', () => {
  it('blocks generate when clearing exceeds open balance', () => {
    const {
      annotateInvoicePaymentsWithLiveBalances,
      assertNoInvoiceOverpayments,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const { invoicePayments, invoiceBalanceShortfalls } = annotateInvoicePaymentsWithLiveBalances(
      [
        {
          itemOrderId: 'NAEI-1',
          zohoInvoiceId: 'inv-1',
          zohoInvoiceNumber: 'INV-1',
          invoiceTotal: 190,
          totalClearingAmount: 21.42,
          fulfillmentPayment: { amount: 21.42 },
          commissionPayment: { amount: 0 },
          netBalancePayment: { amount: 0 },
        },
      ],
      new Map([['inv-1', { invoice_id: 'inv-1', balance: 0 }]])
    )
    assert.equal(invoicePayments[0].exceedsOpenBalance, true)
    assert.equal(invoiceBalanceShortfalls.length, 1)
    assert.throws(
      () =>
        assertNoInvoiceOverpayments({
          invoicePayments,
          invoiceOverpayments: [],
          invoiceBalanceShortfalls,
        }),
      (err) => err && err.code === 'NOON_PAYMENT_CLEARING_INVOICE_BALANCE_SHORT'
    )
  })

  it('skips excluded logistics when building payment plans', () => {
    const {
      buildInvoicePaymentPlansFromBatch,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const { getNoonPaymentClearingMarketplaceConfig } = require('../src/services/noonPaymentClearing/noonPaymentClearingMarketplaceConfig')
    const { ROW_CLASS } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')
    const plans = buildInvoicePaymentPlansFromBatch(
      {
        matchedOrders: [
          {
            itemOrderId: 'NAEI-1',
            zohoInvoiceId: 'inv-paid',
            zohoInvoiceNumber: 'INV-042327',
            zohoInvoiceTotal: 100,
            netProceed: 0,
            referralFee: 0,
            fulfillmentFee: 0,
            shippingCharges: 0,
            logisticsOnly: true,
            excludeFromPaymentClearing: true,
          },
          {
            itemOrderId: 'NAEI-2',
            zohoInvoiceId: 'inv-open',
            zohoInvoiceNumber: 'INV-OK',
            zohoInvoiceTotal: 100,
            netProceed: 100,
            referralFee: -10,
            fulfillmentFee: -5,
            shippingCharges: 0,
          },
        ],
        allRows: [
          {
            rowNumber: 1,
            rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
            assignedItemOrderId: 'NAEI-1',
            total: -1.68,
            excludeFromPaymentClearing: true,
          },
        ],
        reconciliationSummary: { expectedSettlement: 0 },
        status: 'approved',
        unmatchedOrders: [],
        multipleMatchItems: [],
      },
      { paymentPreviewAccounts: getNoonPaymentClearingMarketplaceConfig().paymentPreviewAccounts }
    )
    assert.equal(plans.length, 1)
    assert.equal(plans[0].zohoInvoiceNumber, 'INV-OK')
    assert.equal(plans[0].totalClearingAmount, 100)
  })

  it('skips plans for item order ids excluded in the open balance reconcile', () => {
    const {
      buildInvoicePaymentPlansFromBatch,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const { getNoonPaymentClearingMarketplaceConfig } = require('../src/services/noonPaymentClearing/noonPaymentClearingMarketplaceConfig')
    const plans = buildInvoicePaymentPlansFromBatch(
      {
        matchedOrders: [
          {
            // Same row still flagged only in the snapshot (rematch dropped the row flag).
            itemOrderId: 'NAEI78009406690-1',
            zohoInvoiceId: 'inv-paid',
            zohoInvoiceNumber: 'INV-042333',
            zohoInvoiceTotal: 100,
            netProceed: 0,
            referralFee: 0,
            fulfillmentFee: -7.56,
            shippingCharges: 0,
          },
          {
            itemOrderId: 'NAEI-2',
            zohoInvoiceId: 'inv-open',
            zohoInvoiceNumber: 'INV-OK',
            zohoInvoiceTotal: 100,
            netProceed: 100,
            referralFee: -10,
            fulfillmentFee: -5,
            shippingCharges: 0,
          },
        ],
        allRows: [],
        reportSnapshot: {
          openBalanceReconcile: { excludedItemOrderIds: ['naei78009406690-1'] },
        },
        reconciliationSummary: { expectedSettlement: 0 },
        status: 'approved',
        unmatchedOrders: [],
        multipleMatchItems: [],
      },
      { paymentPreviewAccounts: getNoonPaymentClearingMarketplaceConfig().paymentPreviewAccounts }
    )
    assert.equal(plans.length, 1)
    assert.equal(plans[0].zohoInvoiceNumber, 'INV-OK')
  })
})

describe('orphan parent logistics → Zoho invoice', () => {
  it('assigns parent charge to Zoho child invoice when sale is not in this statement', () => {
    const {
      applyParentOrderChargeFallbackWithSynthetics,
      ASSIGNMENT_REASON_ZOHO,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingParentChargeFallback')
    const { ROW_CLASS } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')

    const result = applyParentOrderChargeFallbackWithSynthetics(
      [
        {
          rowNumber: 2,
          rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
          parentOrderId: 'NAEI60012472440',
          itemOrderId: '',
          total: -21.42,
          fulfillmentFee: -26.78,
          orderSubsidies: 5.36,
          title: 'PGB6199827833A',
        },
      ],
      [], // no sales in this statement
      [
        {
          zohoInvoiceId: 'inv-orphan',
          zohoInvoiceNumber: 'INV-041000',
          zohoOrderNumber: 'NAEI60012472440-1',
          zohoPoNumber: 'NAEI60012472440-1',
          matchKeys: ['NAEI60012472440-1'],
          zohoInvoiceTotal: 190,
        },
      ]
    )
    assert.equal(result.rows[0].assignedItemOrderId, 'NAEI60012472440-1')
    assert.equal(result.rows[0].assignedZohoInvoiceNumber, 'INV-041000')
    assert.equal(result.rows[0].assignmentReason, ASSIGNMENT_REASON_ZOHO)
    assert.equal(result.rows[0].parentFallbackStatus, 'assigned_zoho_orphan')
    assert.equal(result.syntheticMatchedOrders.length, 1)
    assert.equal(result.syntheticMatchedOrders[0].zohoInvoiceId, 'inv-orphan')
    assert.equal(result.syntheticMatchedOrders[0].logisticsOnly, true)
  })

  it('routes cross-week orphan parent logistics to settlement adjustment journal, not Record Payment', () => {
    const {
      applyParentOrderChargeFallbackWithSynthetics,
      ASSIGNMENT_REASON_ZOHO,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingParentChargeFallback')
    const {
      buildPaymentPreviewFromBatch,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const { ROW_CLASS } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')

    const parentAssign = applyParentOrderChargeFallbackWithSynthetics(
      [
        {
          rowNumber: 2,
          rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
          parentOrderId: 'NAEI60012472440',
          itemOrderId: '',
          total: -21.42,
          fulfillmentFee: -21.42,
          title: 'PGB6199827833A',
        },
      ],
      [],
      [
        {
          zohoInvoiceId: 'inv-orphan',
          zohoInvoiceNumber: 'INV-041000',
          zohoOrderNumber: 'NAEI60012472440-1',
          matchKeys: ['NAEI60012472440-1'],
          zohoInvoiceTotal: 190,
        },
      ]
    )
    assert.equal(parentAssign.rows[0].assignmentReason, ASSIGNMENT_REASON_ZOHO)
    const batch = {
      status: 'approved',
      reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
      unmatchedOrders: [],
      multipleMatchItems: [],
      matchedOrders: parentAssign.syntheticMatchedOrders,
      allRows: parentAssign.rows,
      reportSnapshot: { referenceNr: 'PS-TEST-ORPHAN' },
    }
    const preview = buildPaymentPreviewFromBatch(batch, [])
    assert.equal(preview.invoicePayments.length, 0)
    assert.ok(preview.settlementAdjustmentJournal)
    assert.equal(preview.settlementAdjustmentJournal.amount, 21.42)
    assert.equal(preview.summary.undepositedSettlementBridgeAmount, 0)
    assert.equal(preview.summary.settlementAdjustmentLineCount, 1)
  })

  it('uses statement Total for 1066 when subsidies reduce the sale line (PS-11752)', () => {
    const { buildInvoicePaymentPlan } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const { getNoonPaymentClearingMarketplaceConfig } = require('../src/services/noonPaymentClearing/noonPaymentClearingMarketplaceConfig')
    const plan = buildInvoicePaymentPlan(
      {
        itemOrderId: 'NAEI60012098831-1',
        netProceed: 160.07,
        referralFee: 0,
        fulfillmentFee: 0,
        shippingCharges: 0,
        total: 151.02,
        zohoInvoiceId: 'inv-subsidy',
        zohoInvoiceNumber: 'INV-SUB',
        zohoInvoiceTotal: 160.07,
      },
      getNoonPaymentClearingMarketplaceConfig().paymentPreviewAccounts,
      null
    )
    assert.equal(plan.netBalancePayment.amount, 151.02)
    assert.notEqual(plan.netBalancePayment.amount, 160.07)
  })

  it('does not build settlement bridge when cross-week charges use adjustment journal (PS-11752 shape)', () => {
    const {
      buildPaymentPreviewFromBatch,
      buildInvoicePaymentPlan,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const { getNoonPaymentClearingMarketplaceConfig } = require('../src/services/noonPaymentClearing/noonPaymentClearingMarketplaceConfig')
    const { ROW_CLASS } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')
    const cfg = getNoonPaymentClearingMarketplaceConfig()
    const salePlan = buildInvoicePaymentPlan(
      {
        itemOrderId: 'NAEI60024715688-1',
        netProceed: 759,
        referralFee: -119.54,
        fulfillmentFee: -33.6,
        total: 605.86,
        zohoInvoiceId: 'inv-759',
        zohoInvoiceNumber: 'INV-042276',
        zohoInvoiceTotal: 759,
      },
      cfg.paymentPreviewAccounts,
      null
    )
    assert.equal(salePlan.netBalancePayment.amount, 605.86)
    const batch = {
      status: 'approved',
      reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0, expectedSettlement: 584.44 },
      unmatchedOrders: [],
      multipleMatchItems: [],
      matchedOrders: [
        {
          itemOrderId: 'NAEI60024715688-1',
          parentOrderId: 'NAEI60024715688',
          netProceed: 759,
          referralFee: -119.54,
          fulfillmentFee: -33.6,
          total: 605.86,
          zohoInvoiceId: 'inv-759',
          zohoInvoiceNumber: 'INV-042276',
          zohoInvoiceTotal: 759,
        },
      ],
      allRows: [
        { rowClass: ROW_CLASS.SALE_ITEM, parentOrderId: 'NAEI60024715688', itemOrderId: 'NAEI60024715688-1', total: 605.86 },
        {
          rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
          parentOrderId: 'NAEI60012472440',
          total: -21.42,
          fulfillmentFee: -21.42,
        },
        { rowClass: ROW_CLASS.STATEMENT_FEE, total: -2009.62 },
      ],
      reportSnapshot: { referenceNr: 'PS-11752-AE20260708' },
    }
    const preview = buildPaymentPreviewFromBatch(batch, [])
    assert.equal(preview.summary.undepositedSettlementBridgeAmount, 0)
    assert.ok(!preview.undepositedSettlementBridgeJournal)
    assert.ok(preview.settlementAdjustmentJournal)
    assert.equal(preview.settlementAdjustmentJournal.amount, 21.42)
    assert.equal(preview.summary.recordPayment1066, 605.86)
    assert.equal(preview.summary.settlementAdjustment1066, -21.42)
  })

  it('routes paid-invoice subsidies into settlement adjustment journal (not Record Payment)', () => {
    const {
      buildPaymentPreviewFromBatch,
      collectPaidInvoiceSubsidyLines,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const { buildSettlementAdjustmentJournal } = require('../src/services/noonPaymentClearing/noonPaymentClearingSettlementAdjustmentService')
    const { ROW_CLASS } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')

    const allRows = [
      {
        rowNumber: 28,
        rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
        parentOrderId: 'NAEI70009406690',
        assignedItemOrderId: 'NAEI70009406690-1',
        assignedZohoInvoiceId: 'inv-paid',
        assignedZohoInvoiceNumber: 'INV-042333',
        total: 7.56,
        fulfillmentFee: 7.56,
        excludeFromPaymentClearing: true,
        excludeReason: 'open_balance_short_already_paid',
        paidInvoiceSubsidy: true,
      },
      {
        rowNumber: 29,
        rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
        parentOrderId: 'NAEI70023851199',
        assignedItemOrderId: 'NAEI70023851199-1',
        assignedZohoInvoiceId: 'inv-paid2',
        assignedZohoInvoiceNumber: 'INV-042300',
        total: 7.56,
        fulfillmentFee: 7.56,
        excludeFromPaymentClearing: true,
        excludeReason: 'open_balance_short_already_paid',
        paidInvoiceSubsidy: true,
      },
    ]
    const lines = collectPaidInvoiceSubsidyLines(allRows, {
      excludedInvoiceIds: new Set(['inv-paid', 'inv-paid2']),
      excludedItemOrderIds: new Set(),
    })
    assert.equal(lines.length, 2)
    const journal = buildSettlementAdjustmentJournal(allRows, { referenceNr: 'PS-TEST-SUB' }, {}, {
      excludedInvoiceIds: new Set(['inv-paid', 'inv-paid2']),
      excludedItemOrderIds: new Set(),
    })
    assert.ok(journal)
    assert.equal(journal.summary.grossPositiveAdjustments, 15.12)
    assert.equal(journal.summary.netUndepositedImpact, 15.12)

    const batch = {
      status: 'approved',
      reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0 },
      unmatchedOrders: [],
      multipleMatchItems: [],
      matchedOrders: [
        {
          itemOrderId: 'NAEI70009406690-1',
          zohoInvoiceId: 'inv-paid',
          logisticsOnly: true,
          excludeFromPaymentClearing: true,
          netProceed: 0,
          referralFee: 0,
          fulfillmentFee: 0,
        },
      ],
      allRows,
      reportSnapshot: {
        referenceNr: 'PS-TEST-SUB',
        openBalanceReconcile: {
          excludedInvoiceIds: ['inv-paid', 'inv-paid2'],
        },
      },
    }
    const preview = buildPaymentPreviewFromBatch(batch, [])
    assert.equal(preview.summary.paidInvoiceSubsidy1066, 15.12)
    assert.equal(preview.summary.settlementAdjustmentGrossPositive, 15.12)
    assert.equal(preview.invoicePayments.length, 0)
  })

  it('nets same-week parent subsidies with signed totals so undeposited planning is zero (PS-11752 +28.80)', () => {
    const {
      collectAssignedUnclearedPaymentAddOns,
      buildPaymentPreviewFromBatch,
      buildUndepositedReconciliation,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const { ROW_CLASS } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')

    const allRows = [
      {
        rowNumber: 62,
        rowClass: ROW_CLASS.SALE_ITEM,
        parentOrderId: 'NAEI70003640128',
        itemOrderId: 'NAEI70003640128-4',
        netProceed: 134.28,
        total: 139.01,
      },
      {
        rowNumber: 27,
        rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
        parentOrderId: 'NAEI70003640128',
        assignedItemOrderId: 'NAEI70003640128-4',
        total: 4.73,
        orderSubsidies: 4.73,
      },
      {
        rowNumber: 69,
        rowClass: ROW_CLASS.SALE_ITEM,
        parentOrderId: 'NAEI70043650752',
        itemOrderId: 'NAEI70043650752-1',
        netProceed: 151.46,
        total: 156.19,
      },
      {
        rowNumber: 32,
        rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
        parentOrderId: 'NAEI70043650752',
        assignedItemOrderId: 'NAEI70043650752-1',
        total: 4.73,
        orderSubsidies: 4.73,
      },
      {
        rowNumber: 77,
        rowClass: ROW_CLASS.SALE_ITEM,
        parentOrderId: 'NAEI70049423935',
        itemOrderId: 'NAEI70049423935-1',
        netProceed: 131.66,
        total: 136.6,
      },
      {
        rowNumber: 36,
        rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
        parentOrderId: 'NAEI70049423935',
        assignedItemOrderId: 'NAEI70049423935-1',
        total: 4.94,
        orderSubsidies: 4.94,
      },
    ]
    const matchedOrders = allRows
      .filter((r) => r.rowClass === ROW_CLASS.SALE_ITEM)
      .map((r) => ({
        itemOrderId: r.itemOrderId,
        parentOrderId: r.parentOrderId,
        netProceed: r.netProceed,
        total: r.total,
        referralFee: 0,
        fulfillmentFee: 0,
        zohoInvoiceId: `inv-${r.itemOrderId}`,
        zohoInvoiceTotal: r.netProceed,
      }))
    const addOns = collectAssignedUnclearedPaymentAddOns(allRows)
    assert.equal(addOns.get('NAEI70003640128-4')?.fulfillment || 0, 0)
    assert.equal(addOns.get('NAEI70043650752-1')?.fulfillment || 0, 0)
    assert.equal(addOns.get('NAEI70049423935-1')?.fulfillment || 0, 0)

    const batch = {
      status: 'approved',
      reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0, expectedSettlement: 431.8 },
      unmatchedOrders: [],
      multipleMatchItems: [],
      matchedOrders,
      allRows,
      reportSnapshot: { referenceNr: 'PS-11752-SUBSIDY-NET' },
    }
    const preview = buildPaymentPreviewFromBatch(batch, [])
    assert.equal(preview.summary.undepositedPlanningDifference, 0)
    assert.equal(preview.summary.plannedUndeposited1066, preview.summary.targetUndeposited1066)
    assert.equal(preview.settlementAdjustmentJournal?.sourceLineCount, 3)
    assert.equal(preview.summary.settlementAdjustmentGrossPositive, 14.4)
    const recon = buildUndepositedReconciliation(batch, preview, null)
    assert.equal(recon.difference, 0)
    assert.equal(recon.nonZeroDeltas.length, 0)
  })

  it('falls back to parent-level Zoho order id when child id is not on the invoice', () => {
    const { findZohoInvoiceForOrphanParent } = require('../src/services/noonPaymentClearing/noonPaymentClearingParentChargeFallback')
    const hit = findZohoInvoiceForOrphanParent('NAEI60028701639', [
      {
        zohoInvoiceId: 'inv-parent',
        zohoInvoiceNumber: 'INV-041001',
        matchKeys: ['NAEI60028701639'],
        zohoInvoiceTotal: 100,
      },
    ])
    assert.ok(hit)
    assert.equal(hit.zohoInvoiceId, 'inv-parent')
    assert.equal(hit.itemOrderId, 'NAEI60028701639')
  })
})

describe('open balance reconcile', () => {
  it('aggregates clearing per invoice before comparing to open balance', () => {
    const {
      aggregatePaymentPlansByInvoice,
      annotateInvoicePaymentsWithLiveBalances,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const aggregated = aggregatePaymentPlansByInvoice([
      {
        itemOrderId: 'NAEI-1',
        zohoInvoiceId: 'inv-1',
        zohoInvoiceNumber: 'INV-1',
        invoiceTotal: 100,
        totalClearingAmount: 20,
      },
      {
        itemOrderId: 'NAEI-2',
        zohoInvoiceId: 'inv-1',
        zohoInvoiceNumber: 'INV-1',
        invoiceTotal: 100,
        totalClearingAmount: 20,
      },
    ])
    assert.equal(aggregated.length, 1)
    assert.equal(aggregated[0].totalClearingAmount, 40)
    const { invoiceBalanceShortfalls } = annotateInvoicePaymentsWithLiveBalances(
      aggregated,
      new Map([['inv-1', { invoice_id: 'inv-1', balance: 30 }]])
    )
    assert.equal(invoiceBalanceShortfalls.length, 1)
    assert.equal(invoiceBalanceShortfalls[0].overBy, 10)
  })

  it('does not treat a missing Zoho invoice as a zero-balance shortfall', () => {
    const { annotateInvoicePaymentsWithLiveBalances } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const { invoiceBalanceShortfalls } = annotateInvoicePaymentsWithLiveBalances(
      [
        {
          itemOrderId: 'NAEI-1',
          zohoInvoiceId: 'inv-missing',
          zohoInvoiceNumber: 'INV-042200',
          invoiceTotal: 190,
          totalClearingAmount: 190,
        },
      ],
      new Map()
    )
    assert.equal(invoiceBalanceShortfalls.length, 0)
  })

  it('zero-net excluded logistics are not Record Payment plans (settlement adjustment only)', () => {
    const {
      aggregatePaymentPlansByInvoice,
      buildInvoicePaymentPlansFromBatch,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const batch = {
      matchedOrders: [
        {
          itemOrderId: 'NAEI70009406690-1',
          zohoInvoiceId: 'inv-paid',
          zohoInvoiceNumber: 'INV-042333',
          zohoInvoiceTotal: 100,
          netProceed: 0,
          referralFee: 0,
          fulfillmentFee: -7.56,
          shippingCharges: 0,
          logisticsOnly: true,
          excludeFromPaymentClearing: true,
        },
      ],
      allRows: [],
      reportSnapshot: {
        openBalanceReconcile: {
          excludedInvoiceIds: ['inv-paid'],
          excludedItemOrderIds: ['naei70009406690-1'],
        },
      },
    }
    const fullPlans = aggregatePaymentPlansByInvoice(
      buildInvoicePaymentPlansFromBatch(batch, {}, { ignoreExclusions: true })
    )
    assert.equal(fullPlans.length, 0)
  })

  it('settlement adjustment Zoho journal payload keeps per-order line descriptions (not journal title)', () => {
    const {
      buildSettlementAdjustmentJournal,
      buildAdjustmentLineDescription,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingSettlementAdjustmentService')
    const { buildManualJournalPayload } = require('../src/services/amazonPaymentClearingZohoPaymentService')
    const { ROW_CLASS } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')
    const { ASSIGNMENT_REASON_ZOHO } = require('../src/services/noonPaymentClearing/noonPaymentClearingParentChargeFallback')

    const ref = 'PS-11752-AE20260708'
    const metadata = { referenceNr: ref, zohoCustomerId: 'noon-customer-123' }

    assert.match(
      buildAdjustmentLineDescription(
        { parentOrderId: 'NAEI70062331436', total: -42.84, fulfillmentFee: -42.84 },
        metadata,
        'expense'
      ),
      /Noon shipping \| NAEI70062331436 \| PS-11752-AE20260708 \| Gross 42\.84/
    )
    assert.match(
      buildAdjustmentLineDescription(
        { parentOrderId: 'NAEI70062331436', total: -42.84, fulfillmentFee: -42.84 },
        metadata,
        'vat'
      ),
      /Noon VAT \| NAEI70062331436 \| PS-11752-AE20260708 \| Gross 42\.84/
    )
    assert.match(
      buildAdjustmentLineDescription(
        {
          parentOrderId: 'NAEI70003640128',
          assignedItemOrderId: 'NAEI70003640128-4',
          total: 4.73,
          orderSubsidies: 4.73,
        },
        metadata,
        'expense'
      ),
      /Noon subsidy \| NAEI70003640128-4 \| PS-11752-AE20260708 \| Gross \+4\.73/
    )
    assert.match(
      buildAdjustmentLineDescription(
        {
          parentOrderId: 'NAEI60012472440',
          assignedItemOrderId: 'NAEI60012472440-1',
          assignmentReason: ASSIGNMENT_REASON_ZOHO,
          parentFallbackStatus: 'assigned_zoho_orphan',
          total: -21.42,
          fulfillmentFee: -21.42,
        },
        metadata,
        'expense'
      ),
      /Parent NAEI60012472440 \| Child NAEI60012472440-1/
    )

    const allRows = [
      {
        rowNumber: 1,
        rowClass: ROW_CLASS.SALE_ITEM,
        parentOrderId: 'NAEI60024715688',
        itemOrderId: 'NAEI60024715688-1',
        total: 605.86,
      },
      {
        rowNumber: 2,
        rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
        parentOrderId: 'NAEI70062331436',
        total: -42.84,
        fulfillmentFee: -42.84,
      },
      {
        rowNumber: 27,
        rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
        parentOrderId: 'NAEI70003640128',
        assignedItemOrderId: 'NAEI70003640128-4',
        total: 4.73,
        orderSubsidies: 4.73,
      },
      {
        rowNumber: 3,
        rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
        parentOrderId: 'NAEI60012472440',
        assignedItemOrderId: 'NAEI60012472440-1',
        assignmentReason: ASSIGNMENT_REASON_ZOHO,
        parentFallbackStatus: 'assigned_zoho_orphan',
        total: -21.42,
        fulfillmentFee: -21.42,
      },
    ]

    const journal = buildSettlementAdjustmentJournal(allRows, metadata, {}, null)
    assert.ok(journal)
    assert.equal(journal.referenceNumber, ref)

    const enrichedLineItems = journal.lineItems.map((item) => ({
      accountId: item.accountId || `acc-${item.accountCode || 'x'}`,
      accountName: item.accountName,
      accountCode: item.accountCode,
      debitOrCredit: item.debitOrCredit,
      amount: item.amount,
      description: item.description,
      ...(item.customerId ? { customerId: item.customerId } : {}),
    }))

    const payload = buildManualJournalPayload({
      feeType: journal.feeType,
      notes: journal.displayLabel,
      referenceNumber: journal.referenceNumber,
      lineItems: enrichedLineItems,
    })

    assert.equal(payload.reference_number, ref)
    assert.ok(Array.isArray(payload.line_items))
    assert.ok(payload.line_items.length >= 4)
    assert.equal(payload.notes, 'Noon Settlement Adjustments Journal')

    const genericTitle = 'Noon Settlement Adjustments Journal'
    for (const line of payload.line_items) {
      assert.notEqual(line.description, genericTitle)
    }

    const expenseShipping = payload.line_items.find(
      (l) => l.description.includes('NAEI70062331436') && l.description.startsWith('Noon shipping')
    )
    assert.ok(expenseShipping)
    assert.match(expenseShipping.description, /Gross 42\.84/)
    assert.equal(expenseShipping.customer_id, 'noon-customer-123')

    const vatShipping = payload.line_items.find(
      (l) => l.description.startsWith('Noon VAT') && l.description.includes('NAEI70062331436')
    )
    assert.ok(vatShipping)
    assert.match(vatShipping.description, /Gross 42\.84/)
    assert.equal(vatShipping.customer_id, 'noon-customer-123')

    const subsidyLine = payload.line_items.find(
      (l) => l.description.startsWith('Noon subsidy') && l.description.includes('NAEI70003640128-4')
    )
    assert.ok(subsidyLine)
    assert.match(subsidyLine.description, /Gross \+4\.73/)

    const parentFallbackLine = payload.line_items.find((l) =>
      l.description.includes('Parent NAEI60012472440')
    )
    assert.ok(parentFallbackLine)

    const balancing1066 = payload.line_items.filter((l) =>
      l.description.startsWith('Noon settlement adjustments |')
    )
    assert.ok(balancing1066.length >= 1)
    assert.ok(balancing1066.every((l) => !l.description.includes('NAEI70062331436')))
    assert.equal(balancing1066[0].customer_id, undefined)

    assert.equal(journal.summary.grossNegativeAdjustments, 64.26)
    assert.equal(journal.summary.grossPositiveAdjustments, 4.73)
    assert.equal(journal.summary.netUndepositedImpact, -59.53)

    const {
      assertBalancedZohoJournalPayload,
      sumZohoJournalPayload,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingJournalBalanceService')
    const payloadTotals = sumZohoJournalPayload(payload)
    assert.equal(payloadTotals.difference, 0)
    assertBalancedZohoJournalPayload(payload, {
      journalType: 'settlement_adjustment',
      reference: ref,
    })
    assert.equal(journal.journalAudit.balanced, true)
    assert.equal(journal.journalAudit.positiveExpenseVatMatchesGross, true)
    assert.equal(journal.journalAudit.negativeExpenseVatMatchesGross, true)
  })
})

describe('Settlement adjustment journal balance (PS-11752-AE20260729 shape)', () => {
  const {
    buildSettlementAdjustmentJournal,
    auditSettlementAdjustmentJournal,
    detectDuplicateSettlementAdjustmentSources,
    resolveSettlementAdjustmentVatSplit,
  } = require('../src/services/noonPaymentClearing/noonPaymentClearingSettlementAdjustmentService')
  const { buildManualJournalPayload } = require('../src/services/amazonPaymentClearingZohoPaymentService')
  const {
    assertBalancedZohoJournalPayload,
    sumZohoJournalPayload,
    sumJournalLineItems,
  } = require('../src/services/noonPaymentClearing/noonPaymentClearingJournalBalanceService')
  const { ROW_CLASS } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')
  const { ASSIGNMENT_REASON_ZOHO } = require('../src/services/noonPaymentClearing/noonPaymentClearingParentChargeFallback')

  const ref = 'PS-11752-AE20260729'
  const metadata = { referenceNr: ref, zohoCustomerId: 'noon-customer-123' }

  const sourceRows = [
    {
      rowNumber: 8,
      rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
      parentOrderId: 'NAEI70062331436',
      total: -33.6,
      fulfillmentFee: -33.6,
    },
    {
      rowNumber: 9,
      rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
      parentOrderId: 'NAEI70062331437',
      total: -42.84,
      fulfillmentFee: -42.84,
    },
    {
      rowNumber: 10,
      rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
      parentOrderId: 'NAEI60012472440',
      assignedItemOrderId: 'NAEI60012472440-1',
      assignmentReason: ASSIGNMENT_REASON_ZOHO,
      parentFallbackStatus: 'assigned_zoho_orphan',
      total: -21.42,
      fulfillmentFee: -21.42,
    },
    {
      rowNumber: 11,
      rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
      parentOrderId: 'NAEI70062331438',
      total: -43.89,
      fulfillmentFee: -43.89,
    },
    {
      rowNumber: 28,
      rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
      parentOrderId: 'NAEI70009406690',
      assignedItemOrderId: 'NAEI70009406690-1',
      total: 14.82,
      orderSubsidies: 14.82,
    },
    {
      rowNumber: 29,
      rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
      parentOrderId: 'NAEI70023851199',
      assignedItemOrderId: 'NAEI70023851199-1',
      total: 619.21,
      fulfillmentFee: 626.82,
      orderSubsidies: -7.61,
    },
  ]

  it('orderSubsidies split VAT from row.total (14.82 → 14.11 + 0.71)', () => {
    const split = resolveSettlementAdjustmentVatSplit(
      { total: 14.82, orderSubsidies: 14.82 },
      0.05
    )
    assert.equal(split.netAmount, 14.11)
    assert.equal(split.vatAmount, 0.71)
    assert.equal(split.sourceGrossCheck, true)
  })

  it('0729-shaped journal summary totals match statement adjustment audit', () => {
    const journal = buildSettlementAdjustmentJournal(sourceRows, metadata, {}, null)
    assert.ok(journal)
    assert.equal(journal.blocked, false)
    assert.equal(journal.summary.grossNegativeAdjustments, 141.75)
    assert.equal(journal.summary.grossPositiveAdjustments, 634.03)
    assert.equal(journal.summary.netUndepositedImpact, 492.28)
  })

  it('final Zoho payload debits equal credits for settlement adjustment journal', () => {
    const journal = buildSettlementAdjustmentJournal(sourceRows, metadata, {}, null)
    const payload = buildManualJournalPayload({
      feeType: journal.feeType,
      notes: journal.displayLabel,
      referenceNumber: journal.referenceNumber,
      lineItems: journal.lineItems.map((item) => ({
        ...item,
        accountId: item.accountId || `acc-${item.accountCode || 'x'}`,
      })),
    })
    const totals = sumZohoJournalPayload(payload)
    assert.equal(totals.totalDebits, totals.totalCredits)
    assert.equal(totals.difference, 0)
    assertBalancedZohoJournalPayload(payload, {
      journalType: 'settlement_adjustment',
      reference: ref,
    })
    assert.equal(journal.journalAudit.balanced, true)
    assert.equal(journal.journalAudit.positiveExpenseVatMatchesGross, true)
    assert.equal(journal.journalAudit.negativeExpenseVatMatchesGross, true)
  })

  it('positive expense/VAT components total gross positive; negative total gross negative', () => {
    const journal = buildSettlementAdjustmentJournal(sourceRows, metadata, {}, null)
    const audit = auditSettlementAdjustmentJournal(journal, metadata, sourceRows)
    assert.equal(audit.positiveExpenseVatTotal, audit.grossPositiveAdjustments)
    assert.equal(audit.negativeExpenseVatTotal, audit.grossNegativeAdjustments)
    assert.equal(audit.nonZeroDeltas.length, 0)
  })

  it('blocks duplicate settlement adjustment source rows', () => {
    const row = {
      rowNumber: 5,
      rowClass: ROW_CLASS.PARENT_ORDER_CHARGE,
      parentOrderId: 'P1',
      total: -10,
      fulfillmentFee: -10,
    }
    const dupes = detectDuplicateSettlementAdjustmentSources([row, row], metadata)
    assert.equal(dupes.length, 1)
    const journal = buildSettlementAdjustmentJournal([row, row], metadata, {}, null)
    assert.equal(journal.blockCode, 'DUPLICATE_SETTLEMENT_ADJUSTMENT_SOURCE')
  })

  it('fee component fields 626.82 + 7.61 must not be confused with journal credits — payload uses row.total split', () => {
    const row = sourceRows.find((r) => r.rowNumber === 29)
    const journal = buildSettlementAdjustmentJournal([row], metadata, {}, null)
    const lineTotals = sumJournalLineItems(journal.lineItems)
    assert.equal(lineTotals.difference, 0)
    const expenseCredits = journal.lineItems.filter(
      (line) => line.debitOrCredit === 'credit' && line.accountCode === '2162'
    )
    const vatCredits = journal.lineItems.filter(
      (line) => line.debitOrCredit === 'credit' && line.accountCode === '1085'
    )
    assert.notEqual(round2(expenseCredits[0].amount + vatCredits[0].amount), 634.43)
    assert.equal(round2(expenseCredits[0].amount + vatCredits[0].amount), 619.21)
  })
})

describe('zero-sale cross-week item logistics (PS-11752-AE20260624 row 41)', () => {
  const {
    isZeroSaleCrossWeekLogisticsSettlementRow,
    buildSettlementAdjustmentJournal,
    buildAdjustmentLineDescription,
    isSettlementAdjustmentSourceRow,
  } = require('../src/services/noonPaymentClearing/noonPaymentClearingSettlementAdjustmentService')
  const {
    buildPaymentPreviewFromBatch,
    buildInvoicePaymentPlan,
  } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
  const {
    classifyRowAccounting,
    expected1066Contribution,
    buildUndepositedReconciliation,
  } = require('../src/services/noonPaymentClearing/noonPaymentClearingUndepositedReconciliationService')
  const { getNoonPaymentClearingMarketplaceConfig } = require('../src/services/noonPaymentClearing/noonPaymentClearingMarketplaceConfig')
  const { ROW_CLASS } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')

  const zeroSaleRow = {
    rowNumber: 41,
    rowClass: ROW_CLASS.SALE_ITEM,
    transactionType: 'order',
    parentOrderId: 'NAEI60054137318',
    itemOrderId: 'NAEI60054137318-3',
    originalParentOrderId: 'NAEI60054137318',
    netProceed: 0,
    referralFee: 0,
    fulfillmentFee: -17.85,
    shippingCharges: 0,
    total: -17.85,
    zohoInvoiceId: 'inv-041977',
    zohoInvoiceNumber: 'INV-041977',
    zohoInvoiceTotal: 229,
    zohoCustomerId: 'noon-cust',
    matchStatus: 'matched',
  }

  it('classifies zero-sale item logistics as settlement adjustment when parent has no sale-bearing row', () => {
    const allRows = [zeroSaleRow]
    assert.ok(isZeroSaleCrossWeekLogisticsSettlementRow(zeroSaleRow, new Set()))
    assert.ok(isSettlementAdjustmentSourceRow(zeroSaleRow, null, new Set()))
  })

  it('excludes zero-sale matched invoice from Record Payment and routes to settlement adjustment journal', () => {
    const ref = 'PS-11752-AE20260624'
    const allRows = [zeroSaleRow]
    const batch = {
      status: 'approved',
      zohoCustomerId: 'noon-cust',
      reconciliationSummary: { reconciliationStatus: 'reconciled', reconciliationDifference: 0, expectedSettlement: -17.85 },
      unmatchedOrders: [],
      multipleMatchItems: [],
      matchedOrders: [
        {
          itemOrderId: 'NAEI60054137318-3',
          parentOrderId: 'NAEI60054137318',
          netProceed: 0,
          referralFee: 0,
          fulfillmentFee: -17.85,
          shippingCharges: 0,
          total: -17.85,
          zohoInvoiceId: 'inv-041977',
          zohoInvoiceNumber: 'INV-041977',
          zohoInvoiceTotal: 229,
          zohoCustomerId: 'noon-cust',
        },
      ],
      allRows,
      reportSnapshot: { referenceNr: ref },
    }
    const preview = buildPaymentPreviewFromBatch(batch, [])
    assert.equal(preview.invoicePayments.length, 0)
    assert.ok(preview.settlementAdjustmentJournal)
    assert.equal(preview.summary.settlementAdjustment1066, -17.85)
    assert.equal(preview.summary.undepositedPlanningDifference, 0)
    assert.equal(preview.summary.targetUndeposited1066, -17.85)
    assert.equal(preview.summary.plannedUndeposited1066, -17.85)

    const journal = preview.settlementAdjustmentJournal
    assert.equal(journal.summary.grossNegativeAdjustments, 17.85)
    assert.match(
      buildAdjustmentLineDescription(zeroSaleRow, { referenceNr: ref }, 'expense'),
      /Noon shipping \| NAEI60054137318-3 \| PS-11752-AE20260624 \| Gross 17\.85/
    )
    const expenseLine = journal.lineItems.find((l) => l.description.includes('Noon shipping'))
    const vatLine = journal.lineItems.find((l) => l.description.startsWith('Noon VAT'))
    assert.ok(expenseLine)
    assert.ok(vatLine)
    assert.equal(expenseLine.amount, 17)
    assert.equal(vatLine.amount, 0.85)
    assert.equal(preview.undepositedReconciliation.nonZeroDeltas.length, 0)
    assert.equal(preview.undepositedReconciliation.deltaSum, 0)
    assert.equal(preview.undepositedReconciliation.difference, 0)
  })

  it('reconciliation audit flags ZERO_SALE_LOGISTICS_ROUTED_TO_1068 when misrouted to Record Payment', () => {
    const plan = buildInvoicePaymentPlan(
      {
        itemOrderId: 'NAEI60054137318-3',
        netProceed: 0,
        referralFee: 0,
        fulfillmentFee: -17.85,
        total: -17.85,
        zohoInvoiceTotal: 229,
      },
      getNoonPaymentClearingMarketplaceConfig().paymentPreviewAccounts,
      null
    )
    assert.equal(plan.netBalancePayment.amount, 0)
    assert.equal(plan.fulfillmentPayment.amount, 17.85)

    const ctx = {
      saleParentSet: new Set(),
      planExclusions: null,
      adjSourceByRow: new Map(),
      invoicePaymentByItem: new Map([['NAEI60054137318-3', plan]]),
    }
    const cls = classifyRowAccounting(zeroSaleRow, ctx)
    assert.equal(cls.reason, 'ZERO_SALE_LOGISTICS_ROUTED_TO_1068')
    assert.equal(expected1066Contribution(zeroSaleRow, ctx), -17.85)
    assert.equal(cls.recordPayment1066 + cls.settlementAdjustment1066, 0)
    assert.equal(round2(expected1066Contribution(zeroSaleRow, ctx) - (cls.recordPayment1066 + cls.settlementAdjustment1066)), -17.85)
  })
})

describe('Noon cross-week product returns (PS-11752-AE20260729 row 16)', () => {
  const {
    reclassifyReturnRows,
    collectReturnRows,
    buildNoonReturnFeeBreakdown,
    isNoonCrossWeekReturnRow,
    RETURN_BLOCK_CODES,
  } = require('../src/services/noonPaymentClearing/noonPaymentClearingReturnService')
  const {
    matchNoonReturnRowsToCreditNotes,
  } = require('../src/services/noonPaymentClearing/noonPaymentClearingReturnMatchingService')
  const { isSettlementFeeJournalRow } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')
  const {
    isSettlementAdjustmentSourceRow,
  } = require('../src/services/noonPaymentClearing/noonPaymentClearingSettlementAdjustmentService')
  const { buildReturnFeePlan, proveUnclearedCommission1067NetsToZero, proveUnclearedShipping1068NetsToZero, proveUnclearedReturnAccountsNetToZero } = require('../src/services/noonPaymentClearing/noonPaymentClearingReturnFeeService')
  const { buildInvoicePaymentPlan } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
  const { getNoonPaymentClearingMarketplaceConfig } = require('../src/services/noonPaymentClearing/noonPaymentClearingMarketplaceConfig')
  const { buildCreditNoteApplyPlan } = require('../src/services/noonPaymentClearing/noonPaymentClearingCreditNotePostingService')
  const {
    buildUndepositedReconciliation,
  } = require('../src/services/noonPaymentClearing/noonPaymentClearingUndepositedReconciliationService')

  const returnRow = {
    rowNumber: 16,
    parentOrderId: 'NAEI70013425039',
    itemOrderId: 'NAEI70013425039-4',
    transactionType: 'order_update',
    rowClass: ROW_CLASS.ORDER_ADJUSTMENT,
    netProceed: -84,
    referralFee: 13.23,
    fulfillmentFee: 0,
    shippingCharges: 0,
    total: -70.77,
  }

  it('classifies row 16 as RETURN — not fee journal or settlement adjustment', () => {
    const rows = reclassifyReturnRows([returnRow])
    const row = rows[0]
    assert.equal(row.rowClass, ROW_CLASS.RETURN)
    assert.ok(isNoonCrossWeekReturnRow(row, new Set()))
    assert.equal(isSettlementFeeJournalRow(row), false)
    assert.equal(isSettlementAdjustmentSourceRow(row, null, new Set()), false)
  })

  it('decomposes product refund 84, commission reversal 13.23, net settlement -70.77', () => {
    const [row] = reclassifyReturnRows([returnRow])
    const b = buildNoonReturnFeeBreakdown(row)
    assert.equal(b.productRefundAmount, 84)
    assert.equal(b.commissionReversalGross, 13.23)
    assert.equal(b.commissionReversalNet, 12.6)
    assert.equal(b.commissionReversalVat, 0.63)
    assert.equal(b.netSettlementEffect, -70.77)
  })

  it('blocks with RETURN_CREDIT_NOTE_MISSING when invoice exists but no CN', () => {
    const [row] = reclassifyReturnRows([returnRow])
    const invoices = [
      mapInvoice({
        invoice_id: 'inv-ret',
        invoice_number: 'INV-RET-1',
        customer_id: 'cust-noon',
        customer_name: 'Noon',
        total: 84,
        custom_fields: [{ label: 'Order Number', value: 'NAEI70013425039-4' }],
      }),
    ]
    const result = matchNoonReturnRowsToCreditNotes([row], invoices, [])
    assert.equal(result.creditNoteBlockingRows.length, 1)
    assert.equal(result.creditNoteBlockingRows[0].blockCode, RETURN_BLOCK_CODES.RETURN_CREDIT_NOTE_MISSING)
    assert.equal(result.matchedReturns[0].status, 'blocked')
  })

  it('matches CN numbered as item order id when sale invoice is outside paginated invoice list', () => {
    const [row] = reclassifyReturnRows([returnRow])
    const creditNotes = [
      {
        creditnote_id: 'cn-ret',
        creditnote_number: 'NAEI70013425039-4',
        invoice_id: 'inv-042491',
        invoice_number: 'INV-042491',
        customer_id: 'cust-noon',
        total: 84,
        balance: 84,
        status: 'open',
      },
    ]
    const result = matchNoonReturnRowsToCreditNotes([row], [], creditNotes)
    assert.equal(result.matchedReturns[0].status, 'matched')
    assert.equal(result.matchedReturns[0].zohoCreditNoteNumber, 'NAEI70013425039-4')
    assert.equal(result.matchedReturns[0].zohoInvoiceId, 'inv-042491')
    assert.equal(result.matchedReturns[0].zohoInvoiceNumber, 'INV-042491')
    assert.equal(result.matchedReturns[0].productRefundAmount, 84)
  })

  it('matches CN and builds refund plan for 84 when CN amount aligns', async () => {
    const [row] = reclassifyReturnRows([returnRow])
    const invoices = [
      mapInvoice({
        invoice_id: 'inv-ret',
        invoice_number: 'INV-RET-1',
        customer_id: 'cust-noon',
        customer_name: 'Noon',
        total: 84,
        custom_fields: [{ label: 'Order Number', value: 'NAEI70013425039-4' }],
      }),
    ]
    const creditNotes = [
      {
        creditnote_id: 'cn-ret',
        creditnote_number: 'NAEI70013425039-4',
        invoice_id: 'inv-ret',
        customer_id: 'cust-noon',
        total: 84,
        balance: 84,
        status: 'open',
      },
    ]
    const result = matchNoonReturnRowsToCreditNotes([row], invoices, creditNotes)
    assert.equal(result.matchedReturns[0].status, 'matched')
    assert.equal(result.matchedReturns[0].productRefundAmount, 84)
    const batch = {
      batchId: 99,
      matchedReturns: result.matchedReturns,
      reportSnapshot: { referenceNr: 'PS-11752-AE20260729' },
      zohoCustomerId: 'cust-noon',
    }
    const plan = await buildCreditNoteApplyPlan(batch, {
      listRefunds: async () => [],
    })
    assert.equal(plan.planRows[0].action, 'refund_existing')
    assert.equal(plan.planRows[0].refundAmount, 84)
  })

  it('payment preview reconciles return principal and commission reversal on 1066', () => {
    const [row] = reclassifyReturnRows([returnRow])
    const batch = {
      batchId: 1,
      status: 'approved',
      allRows: [row],
      matchedOrders: [],
      unmatchedOrders: [],
      multipleMatchItems: [],
      reconciliationSummary: { expectedSettlement: -70.77, reconciliationStatus: 'matched' },
      reportSnapshot: { referenceNr: 'PS-11752-AE20260729' },
      matchedReturns: [
        {
          itemOrderId: 'NAEI70013425039-4',
          productRefundAmount: 84,
          status: 'matched',
          zohoCreditNoteId: 'cn-ret',
          zohoInvoiceId: 'inv-ret',
        },
      ],
      creditNoteBlockingRows: [],
    }
    const preview = buildPaymentPreviewFromBatch(batch, [], NOON_INPUT_VAT)
    assert.equal(preview.summary.returnPrincipal1066, -84)
    assert.equal(preview.summary.returnFeeReversal1066, 13.23)
    assert.equal(preview.summary.plannedUndeposited1066, -70.77)
    assert.equal(preview.summary.targetUndeposited1066, -70.77)
    assert.equal(preview.summary.undepositedPlanningDifference, 0)
    assert.equal(preview.summary.returnBlocked, false)
    assert.equal(preview.undepositedReconciliation.nonZeroDeltas.length, 0)
  })

  it('undeposited recon classifies stored ORDER_ADJUSTMENT return rows without pre-reclassification', () => {
    const batch = {
      batchId: 1,
      status: 'approved',
      allRows: [{ ...returnRow, rowClass: ROW_CLASS.ORDER_ADJUSTMENT }],
      matchedOrders: [],
      unmatchedOrders: [],
      multipleMatchItems: [],
      reconciliationSummary: { expectedSettlement: -70.77, reconciliationStatus: 'matched' },
      reportSnapshot: { referenceNr: 'PS-11752-AE20260729' },
      matchedReturns: [
        {
          itemOrderId: 'NAEI70013425039-4',
          status: 'matched',
          zohoCreditNoteId: 'cn-ret',
          zohoInvoiceId: 'inv-ret',
        },
      ],
      creditNoteBlockingRows: [],
    }
    const preview = buildPaymentPreviewFromBatch(batch, [], NOON_INPUT_VAT)
    const row16 = preview.undepositedReconciliation.candidateRows.find((row) => row.rowNumber === 16)
    assert.equal(row16.classification, 'return_settlement')
    assert.equal(row16.planned1066Contribution, -70.77)
    assert.equal(row16.delta, 0)
    assert.equal(preview.summary.returnPrincipal1066, -84)
    assert.equal(preview.undepositedReconciliation.difference, 0)
    assert.equal(preview.undepositedReconciliation.nonZeroDeltas.length, 0)
  })

  it('buildReturnFeePlan produces settlement + expense-reversal pair for commission (1067 → 0)', () => {
    const [row] = reclassifyReturnRows([returnRow])
    const batch = {
      matchedReturns: [{ itemOrderId: 'NAEI70013425039-4', status: 'matched' }],
      reportSnapshot: { referenceNr: 'PS-11752-AE20260729' },
    }
    const plan = buildReturnFeePlan(batch, [row])
    assert.equal(plan.summary.totalJournalCount, 2)
    assert.equal(plan.summary.settlementJournalCount, 1)
    assert.equal(plan.summary.expenseReversalJournalCount, 1)
    assert.equal(plan.totalUndepositedImpact, 13.23)

    const settlement = plan.settlementJournalLines[0]
    assert.equal(settlement.phase, 'settlement')
    assert.equal(settlement.debit.amount, 13.23)
    assert.equal(settlement.creditCommission.amount, 13.23)
    assert.equal(settlement.creditVat, null)

    const expense = plan.expenseReversalJournalLines[0]
    assert.equal(expense.phase, 'expense_reversal')
    assert.equal(expense.debitUncleared.amount, 13.23)
    assert.equal(expense.creditExpense.amount, 12.6)
    assert.equal(expense.creditVat.amount, 0.63)
    assert.equal(expense.undepositedImpact, 0)
  })

  it('buildReturnFeePlan produces parallel 1068 settlement + expense reversal for fulfillment returns', () => {
    const fulfillmentReturnRow = {
      rowNumber: 20,
      parentOrderId: 'NAEI70013425039',
      itemOrderId: 'NAEI70013425039-5',
      transactionType: 'order_update',
      rowClass: ROW_CLASS.ORDER_ADJUSTMENT,
      netProceed: -10,
      referralFee: 0,
      fulfillmentFee: -5.25,
      shippingCharges: 0,
      total: -5.25,
    }
    const [row] = reclassifyReturnRows([fulfillmentReturnRow])
    const batch = {
      matchedReturns: [{ itemOrderId: 'NAEI70013425039-5', status: 'matched' }],
      reportSnapshot: { referenceNr: 'PS-11752-AE20260729' },
    }
    const plan = buildReturnFeePlan(batch, [row])
    assert.equal(plan.summary.totalJournalCount, 2)
    const settlement = plan.settlementJournalLines[0]
    assert.equal(settlement.creditShipping.amount, 5.25)
    const expense = plan.expenseReversalJournalLines[0]
    assert.equal(expense.debitUncleared.accountCode, '1068')
    assert.equal(expense.creditExpense.accountCode, '2162')
    assert.equal(round2(expense.creditExpense.amount + expense.creditVat.amount), 5.25)
  })

  it('return commission reversal nets 1067 to zero against original sale commission (13.23 gross)', () => {
    const [returnClassified] = reclassifyReturnRows([returnRow])
    const saleReferralFee = -13.23
    const cfg = getNoonPaymentClearingMarketplaceConfig()
    const salePlan = buildInvoicePaymentPlan(
      {
        itemOrderId: 'NAEI70013425039-4',
        parentOrderId: 'NAEI70013425039',
        netProceed: 84,
        referralFee: saleReferralFee,
        fulfillmentFee: 0,
        shippingCharges: 0,
        total: 70.77,
        zohoInvoiceTotal: 84,
        zohoInvoiceId: 'inv-ret',
        zohoInvoiceNumber: 'INV-RET-1',
      },
      cfg.paymentPreviewAccounts,
      null
    )
    assert.equal(salePlan.commissionPayment.amount, 13.23)

    const proof = proveUnclearedCommission1067NetsToZero(saleReferralFee, returnClassified, {
      matchedReturns: [{ itemOrderId: 'NAEI70013425039-4', status: 'matched' }],
      reportSnapshot: { referenceNr: 'PS-11752-AE20260729' },
    })
    assert.equal(proof.saleCommission1067, 13.23)
    assert.equal(proof.returnCredit1067, 13.23)
    assert.equal(proof.expenseDebit1067, 13.23)
    assert.equal(proof.expenseCredit2143, 12.6)
    assert.equal(proof.expenseCredit1085, 0.63)
    assert.equal(proof.returnCreditMatchesSaleCommission, true)
    assert.equal(proof.startingBalance1067, 0)
    assert.equal(proof.balanceAfterSettlement, -13.23)
    assert.equal(proof.balance1067AfterReturn, 0)
    assert.equal(proof.netsToZero, true)
  })

  it('full sale-week + return-week 1067 ledger ends at zero after both Phase 3 journals', () => {
    const [returnClassified] = reclassifyReturnRows([returnRow])
    const saleCommission1067 = 13.23
    const saleReclassCredit1067 = 13.23
    const proof = proveUnclearedCommission1067NetsToZero(-13.23, returnClassified, {
      matchedReturns: [{ itemOrderId: 'NAEI70013425039-4', status: 'matched' }],
      reportSnapshot: { referenceNr: 'PS-11752-AE20260729' },
    })
    let balance1067 = round2(saleCommission1067 - saleReclassCredit1067)
    assert.equal(balance1067, 0, '1067 after sale reclass')
    balance1067 = round2(balance1067 - proof.returnCredit1067)
    assert.equal(balance1067, -13.23, '1067 after settlement reversal')
    balance1067 = round2(balance1067 + proof.expenseDebit1067)
    assert.equal(balance1067, 0, '1067 after automatic expense/VAT reversal')
    assert.equal(proof.netsToZero, true)
  })

  it('return fulfillment reversal nets 1068 to zero after both Phase 3 journals (5.25 gross)', () => {
    const fulfillmentReturnRow = {
      rowNumber: 20,
      parentOrderId: 'NAEI70013425039',
      itemOrderId: 'NAEI70013425039-5',
      transactionType: 'order_update',
      rowClass: ROW_CLASS.ORDER_ADJUSTMENT,
      netProceed: -10,
      referralFee: 0,
      fulfillmentFee: -5.25,
      shippingCharges: 0,
      total: -5.25,
    }
    const [returnClassified] = reclassifyReturnRows([fulfillmentReturnRow])
    const batchCtx = {
      matchedReturns: [{ itemOrderId: 'NAEI70013425039-5', status: 'matched' }],
      reportSnapshot: { referenceNr: 'PS-11752-AE20260729' },
    }
    const proof = proveUnclearedShipping1068NetsToZero(-5.25, returnClassified, batchCtx)
    assert.equal(proof.saleShipping1068, 5.25)
    assert.equal(proof.returnCredit1068, 5.25)
    assert.equal(proof.expenseDebit1068, 5.25)
    assert.equal(proof.expenseCredit2162, 5)
    assert.equal(proof.expenseCredit1085, 0.25)
    assert.equal(proof.startingBalance1068, 0)
    assert.equal(proof.balanceAfterSettlement, -5.25)
    assert.equal(proof.balance1068AfterReturn, 0)
    assert.equal(proof.netsToZero, true)
  })

  it('proveUnclearedReturnAccountsNetToZero: row 16 clears 1067; 1068 unaffected', () => {
    const [row] = reclassifyReturnRows([returnRow])
    const batch = {
      matchedReturns: [{ itemOrderId: 'NAEI70013425039-4', status: 'matched' }],
      reportSnapshot: { referenceNr: 'PS-11752-AE20260729' },
    }
    const proof = proveUnclearedReturnAccountsNetToZero(batch, [row])
    assert.equal(proof.allUnclearedAccountsNetToZero, true)
    assert.equal(proof.commission1067.affectedItemCount, 1)
    assert.equal(proof.commission1067.allNetToZero, true)
    assert.equal(proof.commission1067.proofs[0].balance1067AfterReturn, 0)
    assert.equal(proof.shipping1068.affectedItemCount, 0)
    assert.equal(proof.shipping1068.allNetToZero, true)
  })

  it('proveUnclearedReturnAccountsNetToZero: fulfillment return clears 1068', () => {
    const fulfillmentReturnRow = {
      rowNumber: 20,
      parentOrderId: 'NAEI70013425039',
      itemOrderId: 'NAEI70013425039-5',
      transactionType: 'order_update',
      rowClass: ROW_CLASS.ORDER_ADJUSTMENT,
      netProceed: -10,
      referralFee: 0,
      fulfillmentFee: -5.25,
      shippingCharges: 0,
      total: -5.25,
    }
    const [row] = reclassifyReturnRows([fulfillmentReturnRow])
    const batch = {
      matchedReturns: [{ itemOrderId: 'NAEI70013425039-5', status: 'matched' }],
      reportSnapshot: { referenceNr: 'PS-11752-AE20260729' },
    }
    const proof = proveUnclearedReturnAccountsNetToZero(batch, [row])
    assert.equal(proof.allUnclearedAccountsNetToZero, true)
    assert.equal(proof.commission1067.affectedItemCount, 0)
    assert.equal(proof.shipping1068.affectedItemCount, 1)
    assert.equal(proof.shipping1068.proofs[0].balance1068AfterReturn, 0)
  })

  it('proveUnclearedReturnAccountsNetToZero matches buildReturnFeePlan journal pairs', () => {
    const [row] = reclassifyReturnRows([returnRow])
    const batch = {
      matchedReturns: [{ itemOrderId: 'NAEI70013425039-4', status: 'matched' }],
      reportSnapshot: { referenceNr: 'PS-11752-AE20260729' },
    }
    const plan = buildReturnFeePlan(batch, [row])
    const proof = proveUnclearedReturnAccountsNetToZero(batch, [row])
    assert.equal(plan.summary.totalJournalCount, 2)
    assert.equal(proof.allUnclearedAccountsNetToZero, true)
    assert.equal(proof.commission1067.proofs[0].netsToZero, true)
  })

  it('Phase 3 dry-run posts settlement + expense reversal with stable postingGroupKey', async () => {
    const { postReturnFeeJournalsForBatch } = require('../src/services/noonPaymentClearing/noonPaymentClearingPostingService')
    const [row] = reclassifyReturnRows([returnRow])
    const batch = {
      batchId: 42,
      status: 'posted',
      postedToZoho: true,
      allRows: [row],
      matchedReturns: [{ itemOrderId: 'NAEI70013425039-4', status: 'matched' }],
      reportSnapshot: { referenceNr: 'PS-11752-AE20260729' },
    }
    const result = await postReturnFeeJournalsForBatch({
      batch,
      dryRun: true,
      buildJournalPayloadPreview: async () => ({ line_items: [] }),
    })
    assert.equal(result.summary.journalsCreated, 2)
    assert.equal(result.summary.settlementJournalsCreated, 1)
    assert.equal(result.summary.expenseReversalJournalsCreated, 1)
    assert.deepEqual(
      result.journals.map((journal) => journal.postingGroupKey),
      [
        'return_fee_settlement:commission:NAEI70013425039-4',
        'return_fee_expense_reversal:commission:NAEI70013425039-4',
      ]
    )
  })
})

describe('Noon return matching refresh and approval gates', () => {
  const { validateBatchReadyForApproval, refreshReturnMatchingForBatch } = require('../src/services/noonPaymentClearing/noonPaymentClearingService')
  const { RETURN_BLOCK_CODES } = require('../src/services/noonPaymentClearing/noonPaymentClearingReturnService')

  it('blocks approval when RETURN_CREDIT_NOTE_MISSING is in blockingIssues', () => {
    assert.throws(
      () =>
        validateBatchReadyForApproval({
          reconciliationSummary: { reconciliationStatus: 'reconciled' },
          unmatchedOrders: [],
          multipleMatchItems: [],
          blockingIssues: [
            {
              code: RETURN_BLOCK_CODES.RETURN_CREDIT_NOTE_MISSING,
              message: 'No Zoho Credit Note found.',
            },
          ],
          reportSnapshot: { openBalanceReconcile: { checkedAt: '2026-01-01' } },
        }),
      (err) => err.code === RETURN_BLOCK_CODES.RETURN_CREDIT_NOTE_MISSING
    )
  })

  it('refreshReturnMatchingForBatch rejects unknown batch id', async () => {
    await assert.rejects(
      () => refreshReturnMatchingForBatch(2147483640),
      (err) => err.code === 'NOON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    )
  })

  it('excludes sales return item orders from payment plans even with ignoreExclusions', () => {
    const { buildInvoicePaymentPlansFromBatch } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const { ROW_CLASS } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')
    const returnRow = {
      rowNumber: 10,
      itemOrderId: 'NAEI50031648956-1',
      parentOrderId: 'NAEI50031648956',
      netProceed: -133,
      referralFee: 20.95,
      fulfillmentFee: -26.25,
      shippingCharges: 0,
      total: -112.05,
      transactionType: 'order_update',
      rowClass: ROW_CLASS.ORDER_ADJUSTMENT,
    }
    const batch = {
      matchedOrders: [
        {
          itemOrderId: 'NAEI50031648956-1',
          zohoInvoiceId: 'inv-041408',
          zohoInvoiceNumber: 'INV-041408',
          zohoInvoiceTotal: 133,
          netProceed: -133,
          referralFee: 20.95,
          fulfillmentFee: -26.25,
          shippingCharges: 0,
        },
      ],
      allRows: [returnRow],
      matchedReturns: [{ itemOrderId: 'NAEI50031648956-1', status: 'matched' }],
    }
    const plans = buildInvoicePaymentPlansFromBatch(batch, {}, { ignoreExclusions: true })
    assert.equal(plans.length, 0)
  })

  it('excludes zero-net logistics from open-balance plans even with ignoreExclusions', () => {
    const { buildInvoicePaymentPlansFromBatch } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
    const { ROW_CLASS } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')
    const batch = {
      matchedOrders: [
        {
          itemOrderId: 'NAEI50032993351-1',
          parentOrderId: 'NAEI50032993351',
          zohoInvoiceId: 'inv-041410',
          zohoInvoiceNumber: 'INV-041410',
          zohoInvoiceTotal: 100,
          netProceed: 0,
          referralFee: -10,
          fulfillmentFee: -13.1,
          shippingCharges: 0,
        },
      ],
      allRows: [
        {
          rowNumber: 20,
          rowClass: ROW_CLASS.ORDER_ADJUSTMENT,
          itemOrderId: 'NAEI50032993351-1',
          parentOrderId: 'NAEI50032993351',
          netProceed: 0,
          referralFee: -10,
          fulfillmentFee: -13.1,
          shippingCharges: 0,
          total: -23.1,
        },
      ],
    }
    const plans = buildInvoicePaymentPlansFromBatch(batch, {}, { ignoreExclusions: true })
    assert.equal(plans.length, 0)
  })
})
