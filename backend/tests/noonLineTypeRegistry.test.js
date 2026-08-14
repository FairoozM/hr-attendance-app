const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  LINE_TYPE,
  LINE_SECTION,
  MECHANISM,
  LINE_TYPE_REGISTRY,
  resolveLineType,
  annotateRowsWithLineType,
  describeLineSections,
} = require('../src/services/noonPaymentClearing/lineTypes/noonLineTypeRegistry')
const {
  VAT_POLICY,
  applyVatPolicy,
} = require('../src/services/noonPaymentClearing/lineTypes/noonLineTypeVatPolicy')
const { buildRowContext } = require('../src/services/noonPaymentClearing/lineTypes/noonRowContext')
const { ROW_CLASS } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')
const {
  reclassifyReturnRows,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingReturnService')
const {
  isSettlementAdjustmentSourceRow,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingSettlementAdjustmentService')
const {
  buildSaleParentOrderIdSet,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingRowPredicates')
const { GOLDEN_BATCHES } = require('./fixtures/noonClearingBatches')

function contextFor(batch) {
  const saleParentSet = buildSaleParentOrderIdSet(batch.allRows || [])
  const rows = reclassifyReturnRows(batch.allRows || [], saleParentSet)
  return { rows, ctx: buildRowContext(batch, { rows }) }
}

describe('Noon line type registry', () => {
  it('resolves every fixture row to exactly one line type', () => {
    for (const { name, batch } of GOLDEN_BATCHES) {
      const { rows, ctx } = contextFor(batch)
      for (const row of rows) {
        const matches = LINE_TYPE_REGISTRY.filter((e) => e.matches(row, ctx))
        assert.ok(
          matches.length >= 1,
          `${name} row ${row.rowNumber} matched no line type`
        )
        assert.equal(
          resolveLineType(row, ctx).id,
          matches[0].id,
          `${name} row ${row.rowNumber} did not resolve to its highest-priority match`
        )
      }
    }
  })

  it('never leaves a row without a section, mechanism or VAT policy', () => {
    for (const { batch } of GOLDEN_BATCHES) {
      const { rows, ctx } = contextFor(batch)
      for (const row of annotateRowsWithLineType(rows, ctx)) {
        assert.ok(Object.values(LINE_TYPE).includes(row.lineType))
        assert.ok(Object.values(LINE_SECTION).includes(row.lineSection))
        assert.ok(Object.values(MECHANISM).includes(row.lineMechanism))
        assert.ok(Object.values(VAT_POLICY).includes(row.vatPolicy))
      }
    }
  })

  it('agrees with isSettlementAdjustmentSourceRow on which rows are adjustments', () => {
    const adjustmentTypes = new Set([
      LINE_TYPE.PAID_INVOICE_SUBSIDY,
      LINE_TYPE.ZERO_SALE_CROSS_WEEK_LOGISTICS,
      LINE_TYPE.SAME_WEEK_PARENT_SUBSIDY,
      LINE_TYPE.CROSS_WEEK_CHARGE,
    ])
    for (const { name, batch } of GOLDEN_BATCHES) {
      const { rows, ctx } = contextFor(batch)
      for (const row of rows) {
        const viaRegistry = adjustmentTypes.has(resolveLineType(row, ctx).id)
        const viaLegacy = isSettlementAdjustmentSourceRow(row, ctx.planExclusions, ctx.saleParentSet)
        assert.equal(
          viaRegistry,
          viaLegacy,
          `${name} row ${row.rowNumber}: registry says adjustment=${viaRegistry}, legacy says ${viaLegacy}`
        )
      }
    }
  })

  it('classifies the known statement shapes', () => {
    const cases = [
      { batch: 'sales-week', rowNumber: 1, expected: LINE_TYPE.SALE_ITEM },
      { batch: 'sales-week', rowNumber: 3, expected: LINE_TYPE.PARENT_CHARGE_SAME_WEEK },
      { batch: 'sales-week', rowNumber: 4, expected: LINE_TYPE.SAME_WEEK_PARENT_SUBSIDY },
      { batch: 'sales-week', rowNumber: 5, expected: LINE_TYPE.STATEMENT_FEE_ADVERTISING },
      { batch: 'adjustment-week', rowNumber: 10, expected: LINE_TYPE.ZERO_SALE_CROSS_WEEK_LOGISTICS },
      { batch: 'adjustment-week', rowNumber: 11, expected: LINE_TYPE.ZERO_SALE_CROSS_WEEK_LOGISTICS },
      { batch: 'adjustment-week', rowNumber: 12, expected: LINE_TYPE.PAID_INVOICE_SUBSIDY },
      { batch: 'adjustment-week', rowNumber: 13, expected: LINE_TYPE.UNEXPLAINED_OTHER },
      { batch: 'return-week', rowNumber: 20, expected: LINE_TYPE.SALE_ITEM },
      { batch: 'return-week', rowNumber: 21, expected: LINE_TYPE.RETURN_CROSS_WEEK },
      { batch: 'return-week', rowNumber: 22, expected: LINE_TYPE.RETURN_CROSS_WEEK },
    ]
    for (const c of cases) {
      const entry = GOLDEN_BATCHES.find((b) => b.name === c.batch)
      const { rows, ctx } = contextFor(entry.batch)
      const row = rows.find((r) => r.rowNumber === c.rowNumber)
      assert.ok(row, `${c.batch} row ${c.rowNumber} missing from fixture`)
      assert.equal(resolveLineType(row, ctx).id, c.expected, `${c.batch} row ${c.rowNumber}`)
    }
  })

  it('routes a same-week return through the credit note refund path', () => {
    const rows = [
      {
        rowNumber: 1,
        rowClass: ROW_CLASS.SALE_ITEM,
        transactionType: 'order',
        parentOrderId: 'NAEI70012345678',
        itemOrderId: 'NAEI70012345678-1',
        netProceed: 300,
        referralFee: -47.25,
        total: 252.75,
      },
      {
        rowNumber: 2,
        rowClass: ROW_CLASS.ORDER_ADJUSTMENT,
        transactionType: 'order_update',
        parentOrderId: 'NAEI70012345678',
        itemOrderId: 'NAEI70012345678-2',
        netProceed: -90,
        referralFee: 14.18,
        total: -75.82,
      },
    ]
    const batch = { allRows: rows }
    const saleParentSet = buildSaleParentOrderIdSet(rows)
    const classified = reclassifyReturnRows(rows, saleParentSet)
    const ctx = buildRowContext(batch, { rows: classified })

    const sameWeekReturn = classified.find((r) => r.rowNumber === 2)
    assert.equal(sameWeekReturn.rowClass, ROW_CLASS.RETURN)
    assert.equal(sameWeekReturn.returnTiming, 'same_week')
    const entry = resolveLineType(sameWeekReturn, ctx)
    assert.equal(entry.id, LINE_TYPE.RETURN_SAME_WEEK)
    assert.equal(entry.mechanism, MECHANISM.CREDIT_NOTE_REFUND)
    assert.ok(!entry.isGap)
  })

  it('leaves a same-week subsidy shape out of the return path', () => {
    // Negative proceeds with a positive Total is a subsidy, not a refund.
    const rows = [
      {
        rowNumber: 1,
        rowClass: ROW_CLASS.SALE_ITEM,
        transactionType: 'order',
        parentOrderId: 'NAEI70012345678',
        itemOrderId: 'NAEI70012345678-1',
        netProceed: 300,
        referralFee: -47.25,
        total: 252.75,
      },
      {
        rowNumber: 2,
        rowClass: ROW_CLASS.ORDER_ADJUSTMENT,
        transactionType: 'order_update',
        parentOrderId: 'NAEI70012345678',
        itemOrderId: 'NAEI70012345678-2',
        netProceed: -90,
        fulfillmentFee: 12.5,
        total: 12.5,
      },
    ]
    const classified = reclassifyReturnRows(rows, buildSaleParentOrderIdSet(rows))
    const subsidy = classified.find((r) => r.rowNumber === 2)
    assert.notEqual(subsidy.rowClass, ROW_CLASS.RETURN)
  })

  it('exposes ordered section metadata covering every registered type', () => {
    const sections = describeLineSections()
    assert.equal(sections[0].section, LINE_SECTION.ORDER_PAYMENTS)
    assert.equal(sections.at(-1).section, LINE_SECTION.UNRESOLVED)
    const described = sections.flatMap((s) => s.lineTypes.map((t) => t.id))
    for (const entry of LINE_TYPE_REGISTRY) {
      assert.ok(described.includes(entry.id), `${entry.id} missing from section metadata`)
    }
  })
})

describe('Noon line type breakdown for the UI', () => {
  const {
    buildLineTypeBreakdown,
  } = require('../src/services/noonPaymentClearing/noonPaymentClearingPaymentPreviewService')

  function breakdownFor(name) {
    const entry = GOLDEN_BATCHES.find((b) => b.name === name)
    const { rows, ctx } = contextFor(entry.batch)
    return buildLineTypeBreakdown(rows, ctx)
  }

  it('groups a sales week into order payments, fees and adjustments', () => {
    const b = breakdownFor('sales-week')
    const labels = b.sections.map((s) => s.section)
    assert.deepEqual(labels, [
      LINE_SECTION.ORDER_PAYMENTS,
      LINE_SECTION.ADVERTISING_AND_FEES,
      LINE_SECTION.SETTLEMENT_ADJUSTMENTS,
    ])
    const ads = b.sections.find((s) => s.section === LINE_SECTION.ADVERTISING_AND_FEES)
    assert.equal(ads.totalAmount, -2009.62)
    assert.equal(ads.totalVat, -95.7)
  })

  it('shows a negative settlement adjustment with negative VAT', () => {
    const b = breakdownFor('adjustment-week')
    const adj = b.sections.find((s) => s.section === LINE_SECTION.SETTLEMENT_ADJUSTMENTS)
    const zeroSale = adj.lineTypes.find((t) => t.id === LINE_TYPE.ZERO_SALE_CROSS_WEEK_LOGISTICS)
    assert.equal(zeroSale.totalAmount, -40.95)
    assert.ok(zeroSale.totalVat < 0, `expected a negative VAT, got ${zeroSale.totalVat}`)
  })

  it('omits sections with no rows and counts unrouted gap rows', () => {
    const b = breakdownFor('return-week')
    assert.ok(!b.sections.some((s) => s.rowCount === 0))
    assert.equal(b.unroutedRowCount, 0)
  })

  it('every row in the statement lands in exactly one section', () => {
    for (const { name, batch } of GOLDEN_BATCHES) {
      const { rows, ctx } = contextFor(batch)
      const b = buildLineTypeBreakdown(rows, ctx)
      const placed = b.sections.reduce((sum, s) => sum + s.rowCount, 0)
      assert.equal(placed, rows.length, `${name}: ${placed} placed vs ${rows.length} rows`)
    }
  })
})

describe('Noon line type VAT policy', () => {
  it('COMPONENT_SUM splits advertising into net and Input VAT', () => {
    const split = applyVatPolicy(
      { nonOrderFees: -2009.62, total: -2009.62 },
      VAT_POLICY.COMPONENT_SUM
    )
    assert.equal(split.vatInclusive, true)
    assert.equal(split.netAmount, -1913.92)
    assert.equal(split.vatAmount, -95.7)
  })

  it('TOTAL_GROSS splits from Total when components disagree with it', () => {
    const split = applyVatPolicy(
      { fulfillmentFee: -626.82, shippingCharges: -7.61, total: -619.21 },
      VAT_POLICY.TOTAL_GROSS
    )
    assert.equal(split.vatInclusive, true)
    assert.equal(round2(split.netAmount + split.vatAmount), 619.21)
  })

  it('TOTAL_GROSS leaves rows without including-VAT columns alone', () => {
    const split = applyVatPolicy({ netProceed: 100, total: 100 }, VAT_POLICY.TOTAL_GROSS)
    assert.equal(split.vatInclusive, false)
    assert.equal(split.vatAmount, 0)
  })

  it('NONE and DEFERRED_TO_RECLASS never split VAT', () => {
    for (const policy of [VAT_POLICY.NONE, VAT_POLICY.DEFERRED_TO_RECLASS]) {
      const split = applyVatPolicy({ referralFee: -119.54, total: 605.86 }, policy)
      assert.equal(split.vatAmount, 0)
      assert.equal(split.netAmount, 605.86)
      assert.equal(split.policy, policy)
    }
  })

  it('never splits VAT out of product sale proceeds', () => {
    const split = applyVatPolicy({ netProceed: 500, total: 500 }, VAT_POLICY.COMPONENT_SUM)
    assert.equal(split.vatAmount, 0)
    assert.equal(split.nonVatResidue, 500)
  })

  it('declares a policy for every line type, and no order payment splits VAT early', () => {
    for (const entry of LINE_TYPE_REGISTRY) {
      assert.ok(
        Object.values(VAT_POLICY).includes(entry.vatPolicy),
        `${entry.id} has no VAT policy`
      )
      if (entry.section === LINE_SECTION.ORDER_PAYMENTS) {
        assert.equal(
          entry.vatPolicy,
          VAT_POLICY.DEFERRED_TO_RECLASS,
          `${entry.id} would split VAT at payment time and double-count it in the reclass journal`
        )
      }
    }
  })

  it('matches the split the settlement adjustment journal actually applies', () => {
    const {
      resolveSettlementAdjustmentVatSplit,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingSettlementAdjustmentService')
    const rows = [
      { fulfillmentFee: -626.82, shippingCharges: -7.61, total: -619.21 },
      { fulfillmentFee: -13.1, referralFee: -10, total: -23.1 },
      { othersInclVat: 7.56, total: 7.56 },
      { netProceed: 100, total: 100 },
    ]
    for (const row of rows) {
      const journal = resolveSettlementAdjustmentVatSplit(row)
      const policy = applyVatPolicy(row, VAT_POLICY.TOTAL_GROSS)
      assert.equal(journal.vatAmount, round2(policy.vatAmount), JSON.stringify(row))
      assert.equal(journal.netAmount, round2(policy.netAmount), JSON.stringify(row))
    }
  })

  it('matches the split the fee journal actually applies', () => {
    const {
      buildFeeJournalPreviewLines,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingPreviewService')
    const row = {
      rowNumber: 1,
      rowClass: ROW_CLASS.STATEMENT_FEE,
      normalizedFeeType: 'NOON_ADVERTISING_FEE',
      title: 'Advertising',
      nonOrderFees: -2009.62,
      total: -2009.62,
    }
    const [line] = buildFeeJournalPreviewLines([row], [], null, {})
    const policy = applyVatPolicy(row, VAT_POLICY.COMPONENT_SUM)
    assert.equal(line.inputVatAmount, round2(policy.vatAmount))
    assert.equal(line.netExpense, round2(policy.netAmount))
  })

  it('flags an advertising charge that carries no including-VAT column', () => {
    const {
      buildFeeJournalPreviewLines,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingPreviewService')
    const [line] = buildFeeJournalPreviewLines(
      [
        {
          rowNumber: 1,
          rowClass: ROW_CLASS.STATEMENT_FEE,
          title: 'Advertising',
          total: -2009.62,
        },
      ],
      [],
      null,
      {}
    )
    assert.equal(line.inputVatAmount, 0)
    assert.equal(line.vatWarning?.code, 'ADVERTISING_VAT_NOT_SPLIT')
  })

  it('does not flag an advertising charge whose VAT did split', () => {
    const {
      buildFeeJournalPreviewLines,
    } = require('../src/services/noonPaymentClearing/noonPaymentClearingPreviewService')
    const [line] = buildFeeJournalPreviewLines(
      [
        {
          rowNumber: 1,
          rowClass: ROW_CLASS.STATEMENT_FEE,
          title: 'Advertising',
          nonOrderFees: -2009.62,
          total: -2009.62,
        },
      ],
      [],
      null,
      {}
    )
    assert.equal(line.vatWarning, null)
  })
})

describe('Noon storage fee routing', () => {
  const {
    normalizeNoonFeeType,
    displayLabelForFeeRow,
    NORMALIZED_FEE_TYPE,
  } = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')
  const {
    getNoonPaymentClearingMarketplaceConfig,
  } = require('../src/services/noonPaymentClearing/noonPaymentClearingMarketplaceConfig')
  const {
    buildFeeJournalPreviewLines,
  } = require('../src/services/noonPaymentClearing/noonPaymentClearingPreviewService')

  const cases = [
    ['Storage Fee', NORMALIZED_FEE_TYPE.STORAGE_FEE, '1207'],
    ['Monthly Storage Fee', NORMALIZED_FEE_TYPE.MONTHLY_STORAGE_FEE, '1208'],
    ['Long Term Storage Fee', NORMALIZED_FEE_TYPE.LONG_TERM_STORAGE_FEE, '1209'],
  ]

  it('separates the three storage variants by title', () => {
    for (const [title, expected] of cases) {
      const feeType = normalizeNoonFeeType({ rowClass: ROW_CLASS.STATEMENT_FEE, title })
      assert.equal(feeType, expected, title)
      assert.equal(displayLabelForFeeRow({ normalizedFeeType: feeType }), title)
    }
  })

  it('gives each storage variant its own Zoho account instead of advertising', () => {
    const cfg = getNoonPaymentClearingMarketplaceConfig()
    for (const [title, feeType, code] of cases) {
      const suggestion = cfg.feeJournalAccountSuggestions.find(
        (s) => s.normalizedFeeType === feeType
      )
      assert.ok(suggestion, `${feeType} has no fee journal suggestion`)
      assert.equal(suggestion.zohoAccountCode, code)
      assert.notEqual(suggestion.zohoAccountCode, cfg.advertisingExpenseAccount.accountCode)

      const [line] = buildFeeJournalPreviewLines(
        [{ rowNumber: 1, rowClass: ROW_CLASS.STATEMENT_FEE, title, nonOrderFees: -100, total: -100 }],
        [],
        { accountCode: '1085' },
        {}
      )
      assert.equal(line.normalizedFeeType, feeType)
      assert.equal(line.zohoAccountCode, code, title)
      assert.equal(line.clearingAccountCode, cfg.undepositedFundsAccount.accountCode)
    }
  })

  it('leaves a non-storage statement fee on the generic path', () => {
    const feeType = normalizeNoonFeeType({
      rowClass: ROW_CLASS.STATEMENT_FEE,
      title: 'Marketplace penalty',
    })
    assert.equal(feeType, NORMALIZED_FEE_TYPE.STATEMENT_FEE)
  })
})

function round2(v) {
  return Math.round(Number(v) * 100) / 100
}
