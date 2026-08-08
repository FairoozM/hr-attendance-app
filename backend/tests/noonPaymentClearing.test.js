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
const { buildPreview } = require('../src/services/noonPaymentClearing/noonPaymentClearingPreviewService')
const { buildPaymentPreviewFromBatch } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')
const { validateBatchReadyForApproval } = require('../src/services/noonPaymentClearing/noonPaymentClearingService')
const { flattenInvoicePayments, ensureCanPostBatch } = require('../src/services/noonPaymentClearing/noonPaymentClearingPostingService')

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
    const preview = buildPreview({
      rows: parsed.rows,
      metadata: parsed.metadata,
      matchResult: match,
      mappingRules: [
        {
          normalizedFeeType: 'NOON_ADVERTISING_FEE',
          debitAccountId: 'd1',
          creditAccountId: 'c1',
          debitAccountName: 'Adv',
          creditAccountName: 'Undep',
          isActive: true,
        },
        {
          normalizedFeeType: 'PARENT_ORDER_CHARGE',
          debitAccountId: 'd2',
          creditAccountId: 'c2',
          debitAccountName: 'Ship',
          creditAccountName: 'Undep',
          isActive: true,
        },
        {
          normalizedFeeType: 'FULFILLMENT',
          debitAccountId: 'd2',
          creditAccountId: 'c2',
          debitAccountName: 'Ship',
          creditAccountName: 'Undep',
          isActive: true,
        },
        {
          normalizedFeeType: 'ORDER_ADJUSTMENT',
          debitAccountId: 'd3',
          creditAccountId: 'c3',
          debitAccountName: 'Adj',
          creditAccountName: 'Undep',
          isActive: true,
        },
      ],
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
    const paymentPreview = buildPaymentPreviewFromBatch(batch, [
      {
        normalizedFeeType: 'NOON_ADVERTISING_FEE',
        debitAccountId: 'd1',
        creditAccountId: 'c1',
        isActive: true,
      },
      {
        normalizedFeeType: 'FULFILLMENT',
        debitAccountId: 'd2',
        creditAccountId: 'c2',
        isActive: true,
      },
      {
        normalizedFeeType: 'PARENT_ORDER_CHARGE',
        debitAccountId: 'd2',
        creditAccountId: 'c2',
        isActive: true,
      },
      {
        normalizedFeeType: 'ORDER_ADJUSTMENT',
        debitAccountId: 'd3',
        creditAccountId: 'c3',
        isActive: true,
      },
    ])
    assert.equal(paymentPreview.invoicePayments.length, 2)
    assert.ok(paymentPreview.invoicePayments.every((p) => p.itemOrderId.includes('-')))
    assert.ok(paymentPreview.parentLevelCharges.length >= 1)
    assert.ok(paymentPreview.statementLevelCharges.length >= 1)
    const parentJournal = paymentPreview.parentLevelCharges[0]
    assert.equal(parentJournal.assignedItemOrderId, 'NAEI70003640128-1')
    assert.match(String(parentJournal.previewNote || ''), /Cleared via: NAEI70003640128-1/)
    // Parent charge must not appear as an invoice payment allocation / must not be duplicated
    assert.ok(!paymentPreview.invoicePayments.some((p) => p.itemOrderId === 'NAEI70003640128'))
    assert.equal(
      paymentPreview.feeJournalLines.filter(
        (l) => l.rowNumber === parentCharge.rowNumber && l.rowClass === 'parent_order_charge'
      ).length,
      1
    )
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
