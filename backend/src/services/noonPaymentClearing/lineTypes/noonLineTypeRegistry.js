/**
 * The single place that decides what a Noon statement row *is*.
 *
 * Every row resolves to exactly one line type, and the type carries its own
 * accounting treatment, VAT policy and UI section. Consumers read the resolved
 * type instead of re-deriving it, which is what stops a row from being a return
 * to one service and a payable sale to another.
 *
 * Ordering is significant: `LINE_TYPE_REGISTRY` is evaluated top to bottom and
 * the first match wins. The order deliberately mirrors the precedence the
 * pipeline already used (returns first, then statement fees, then settlement
 * adjustments, then the Record Payment family) so resolution agrees with the
 * routing that predates this registry.
 */
const {
  ROW_CLASS,
  num,
  clean,
  isUnclearedInvoicePaymentBucketRow,
  isAdvertisingFeeRow,
} = require('../noonPaymentClearingCategoryService')
const {
  parentOrderIdForRow,
  itemOrderIdForRow,
  isOrphanParentLogisticsRow,
  hasMarketplaceLogisticsCharge,
  isExcludedRow,
  PAID_INVOICE_SUBSIDY_REASON,
  itemOrderMatchKey,
} = require('../noonPaymentClearingRowPredicates')
const { VAT_POLICY } = require('./noonLineTypeVatPolicy')

/** UI grouping. Ordered as the operator works through a statement. */
const LINE_SECTION = Object.freeze({
  ORDER_PAYMENTS: 'order_payments',
  SALES_RETURNS: 'sales_returns',
  ADVERTISING_AND_FEES: 'advertising_and_fees',
  SETTLEMENT_ADJUSTMENTS: 'settlement_adjustments',
  UNRESOLVED: 'unresolved',
})

const LINE_SECTION_LABEL = Object.freeze({
  [LINE_SECTION.ORDER_PAYMENTS]: 'Order payments',
  [LINE_SECTION.SALES_RETURNS]: 'Sales returns',
  [LINE_SECTION.ADVERTISING_AND_FEES]: 'Advertising & statement fees',
  [LINE_SECTION.SETTLEMENT_ADJUSTMENTS]: 'Settlement adjustments',
  [LINE_SECTION.UNRESOLVED]: 'Unresolved',
})

/** How the amount reaches Zoho. */
const MECHANISM = Object.freeze({
  RECORD_PAYMENT: 'record_payment',
  FEE_JOURNAL: 'fee_journal',
  SETTLEMENT_ADJUSTMENT_JOURNAL: 'settlement_adjustment_journal',
  CREDIT_NOTE_REFUND: 'credit_note_refund',
  RETURN_FEE_JOURNAL: 'return_fee_journal',
  /** Recognised but deliberately carried by another row's plan. */
  FOLDED_INTO_INVOICE_PAYMENT: 'folded_into_invoice_payment',
  /** Nothing posts this today — a gap, surfaced rather than hidden. */
  NONE: 'none',
})

const LINE_TYPE = Object.freeze({
  SALE_ITEM: 'SALE_ITEM',
  PARENT_CHARGE_SAME_WEEK: 'PARENT_CHARGE_SAME_WEEK',
  ORDER_ADJUSTMENT_SAME_WEEK: 'ORDER_ADJUSTMENT_SAME_WEEK',
  ORPHAN_PARENT_LOGISTICS: 'ORPHAN_PARENT_LOGISTICS',
  RETURN_CROSS_WEEK: 'RETURN_CROSS_WEEK',
  RETURN_SAME_WEEK: 'RETURN_SAME_WEEK',
  STATEMENT_FEE_ADVERTISING: 'STATEMENT_FEE_ADVERTISING',
  STATEMENT_FEE_STORAGE: 'STATEMENT_FEE_STORAGE',
  STATEMENT_FEE_OTHER: 'STATEMENT_FEE_OTHER',
  ORDER_ADJUSTMENT_FEE_JOURNAL: 'ORDER_ADJUSTMENT_FEE_JOURNAL',
  CROSS_WEEK_CHARGE: 'CROSS_WEEK_CHARGE',
  ZERO_SALE_CROSS_WEEK_LOGISTICS: 'ZERO_SALE_CROSS_WEEK_LOGISTICS',
  PAID_INVOICE_SUBSIDY: 'PAID_INVOICE_SUBSIDY',
  SAME_WEEK_PARENT_SUBSIDY: 'SAME_WEEK_PARENT_SUBSIDY',
  UNEXPLAINED_OTHER: 'UNEXPLAINED_OTHER',
})

function isNegativeNetProceed(row) {
  return num(row?.netProceed) <= -0.01
}

function isItemLevelId(row) {
  const id = itemOrderIdForRow(row)
  return Boolean(id && id.includes('-'))
}

function isOrderChargeClass(row) {
  return (
    row?.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE || row?.rowClass === ROW_CLASS.ORDER_ADJUSTMENT
  )
}

/** Mirrors isPaidInvoiceSubsidyAdjustmentRow, expressed against the shared context. */
function matchesPaidInvoiceSubsidy(row, ctx) {
  if (num(row.total) < 0.01) return false
  if (!isUnclearedInvoicePaymentBucketRow(row)) return false
  const assignedItem = clean(row.assignedItemOrderId) || clean(row.itemOrderId)
  const assignedInv = clean(row.assignedZohoInvoiceId || row.zohoInvoiceId)
  if (!assignedItem && !assignedInv) return false
  if (row.paidInvoiceSubsidy) return true
  if (row.excludeFromPaymentClearing) return true
  if (clean(row.excludeReason) === PAID_INVOICE_SUBSIDY_REASON) return true
  if (assignedInv && ctx.excludedInvoiceIds?.has(assignedInv)) return true
  if (assignedItem && ctx.excludedItemOrderIds?.has(itemOrderMatchKey(assignedItem))) return true
  return false
}

/** Mirrors isZeroSaleCrossWeekLogisticsSettlementRow. */
function matchesZeroSaleCrossWeekLogistics(row, ctx) {
  if (row.excludeFromPaymentClearing) return false
  if (num(row.netProceed) <= -0.01) return false
  if (num(row.netProceed) >= 0.01) return false
  if (!hasMarketplaceLogisticsCharge(row)) return false
  if (row.rowClass === ROW_CLASS.SALE_ITEM && num(row.total) > 0.01) return false
  const parent = parentOrderIdForRow(row)
  if (!parent) return false
  return !ctx.saleParentSet.has(parent)
}

/** Mirrors isSameWeekPositiveParentSubsidyRow. */
function matchesSameWeekParentSubsidy(row, ctx) {
  if (num(row.total) < 0.01) return false
  if (!isUnclearedInvoicePaymentBucketRow(row)) return false
  if (!isOrderChargeClass(row)) return false
  const parent = parentOrderIdForRow(row)
  return Boolean(parent && ctx.saleParentSet.has(parent))
}

/** Mirrors isCrossWeekSettlementAdjustmentRow. */
function matchesCrossWeekCharge(row, ctx) {
  if (!isUnclearedInvoicePaymentBucketRow(row)) return false
  if (!isOrderChargeClass(row)) return false
  const parent = parentOrderIdForRow(row)
  if (!parent) return false
  return !ctx.saleParentSet.has(parent)
}

const LINE_TYPE_REGISTRY = Object.freeze([
  {
    id: LINE_TYPE.RETURN_CROSS_WEEK,
    label: 'Sales return',
    description: 'Cross-week product return cleared by credit note refund and fee reversal journals.',
    section: LINE_SECTION.SALES_RETURNS,
    mechanism: MECHANISM.CREDIT_NOTE_REFUND,
    vatPolicy: VAT_POLICY.COMPONENT_SUM,
    glAccounts: ['1066', '1067', '1068', '1085'],
    matches: (row) => row.rowClass === ROW_CLASS.RETURN,
  },
  {
    id: LINE_TYPE.RETURN_SAME_WEEK,
    label: 'Same-week sales return',
    description:
      'Negative proceeds whose parent also sold in this statement. No posting path exists today.',
    section: LINE_SECTION.SALES_RETURNS,
    mechanism: MECHANISM.NONE,
    vatPolicy: VAT_POLICY.NONE,
    glAccounts: [],
    isGap: true,
    matches: (row, ctx) =>
      isNegativeNetProceed(row) &&
      isItemLevelId(row) &&
      ctx.saleParentSet.has(parentOrderIdForRow(row)),
  },
  {
    id: LINE_TYPE.STATEMENT_FEE_ADVERTISING,
    label: 'Advertising fee',
    description: 'Statement-level advertising. Dr advertising expense + Input VAT / Cr Undeposited.',
    section: LINE_SECTION.ADVERTISING_AND_FEES,
    mechanism: MECHANISM.FEE_JOURNAL,
    vatPolicy: VAT_POLICY.COMPONENT_SUM,
    glAccounts: ['2053', '1085', '1066'],
    matches: (row) => row.rowClass === ROW_CLASS.STATEMENT_FEE && isAdvertisingFeeRow(row),
  },
  {
    id: LINE_TYPE.STATEMENT_FEE_OTHER,
    label: 'Other statement fee',
    description: 'Statement-level fee needing an expense mapping before it can post.',
    section: LINE_SECTION.ADVERTISING_AND_FEES,
    mechanism: MECHANISM.FEE_JOURNAL,
    vatPolicy: VAT_POLICY.COMPONENT_SUM,
    glAccounts: ['1085', '1066'],
    matches: (row) => row.rowClass === ROW_CLASS.STATEMENT_FEE,
  },
  {
    id: LINE_TYPE.PAID_INVOICE_SUBSIDY,
    label: 'Paid-invoice subsidy',
    description:
      'Positive adjustment on an already-paid invoice. Cr expense + Cr Input VAT / Dr Undeposited.',
    section: LINE_SECTION.SETTLEMENT_ADJUSTMENTS,
    mechanism: MECHANISM.SETTLEMENT_ADJUSTMENT_JOURNAL,
    vatPolicy: VAT_POLICY.TOTAL_GROSS,
    glAccounts: ['1066', '2143', '2162', '1085'],
    matches: matchesPaidInvoiceSubsidy,
  },
  {
    id: LINE_TYPE.ZERO_SALE_CROSS_WEEK_LOGISTICS,
    label: 'Zero-sale cross-week logistics',
    description:
      'Logistics on an order with no sale in this statement. Journal only — never Record Payment.',
    section: LINE_SECTION.SETTLEMENT_ADJUSTMENTS,
    mechanism: MECHANISM.SETTLEMENT_ADJUSTMENT_JOURNAL,
    vatPolicy: VAT_POLICY.TOTAL_GROSS,
    glAccounts: ['2162', '1085', '1066'],
    matches: matchesZeroSaleCrossWeekLogistics,
  },
  {
    id: LINE_TYPE.SAME_WEEK_PARENT_SUBSIDY,
    label: 'Same-week parent subsidy',
    description: 'Positive parent subsidy where the sale is in this statement. Journal, not payment.',
    section: LINE_SECTION.SETTLEMENT_ADJUSTMENTS,
    mechanism: MECHANISM.SETTLEMENT_ADJUSTMENT_JOURNAL,
    vatPolicy: VAT_POLICY.TOTAL_GROSS,
    glAccounts: ['1066', '2143', '2162', '1085'],
    matches: matchesSameWeekParentSubsidy,
  },
  {
    id: LINE_TYPE.CROSS_WEEK_CHARGE,
    label: 'Cross-week charge',
    description: 'Commission or logistics for an order that sold in an earlier statement.',
    section: LINE_SECTION.SETTLEMENT_ADJUSTMENTS,
    mechanism: MECHANISM.SETTLEMENT_ADJUSTMENT_JOURNAL,
    vatPolicy: VAT_POLICY.TOTAL_GROSS,
    glAccounts: ['2143', '2162', '1085', '1066'],
    matches: (row, ctx) => !isExcludedRow(row) && matchesCrossWeekCharge(row, ctx),
  },
  {
    id: LINE_TYPE.SALE_ITEM,
    label: 'Item sale',
    description: 'Product sale cleared by Record Payment across Undeposited, commission and shipping.',
    section: LINE_SECTION.ORDER_PAYMENTS,
    mechanism: MECHANISM.RECORD_PAYMENT,
    vatPolicy: VAT_POLICY.DEFERRED_TO_RECLASS,
    glAccounts: ['1066', '1067', '1068'],
    matches: (row) => row.rowClass === ROW_CLASS.SALE_ITEM && num(row.netProceed) >= 0.01,
  },
  {
    id: LINE_TYPE.ORPHAN_PARENT_LOGISTICS,
    label: 'Orphan parent logistics',
    description:
      'Parent logistics matched to a Zoho invoice whose sale is not in this statement. Clears via 1068.',
    section: LINE_SECTION.ORDER_PAYMENTS,
    mechanism: MECHANISM.RECORD_PAYMENT,
    vatPolicy: VAT_POLICY.DEFERRED_TO_RECLASS,
    glAccounts: ['1068'],
    matches: (row) => isOrphanParentLogisticsRow(row),
  },
  {
    id: LINE_TYPE.PARENT_CHARGE_SAME_WEEK,
    label: 'Parent logistics',
    description: 'Parent-level logistics folded into the matched child invoice payment.',
    section: LINE_SECTION.ORDER_PAYMENTS,
    mechanism: MECHANISM.FOLDED_INTO_INVOICE_PAYMENT,
    vatPolicy: VAT_POLICY.DEFERRED_TO_RECLASS,
    glAccounts: ['1067', '1068'],
    matches: (row) => row.rowClass === ROW_CLASS.PARENT_ORDER_CHARGE,
  },
  {
    id: LINE_TYPE.ORDER_ADJUSTMENT_SAME_WEEK,
    label: 'Order adjustment',
    description: 'Item-level logistics or commission adjustment folded into the invoice payment.',
    section: LINE_SECTION.ORDER_PAYMENTS,
    mechanism: MECHANISM.FOLDED_INTO_INVOICE_PAYMENT,
    vatPolicy: VAT_POLICY.DEFERRED_TO_RECLASS,
    glAccounts: ['1067', '1068'],
    matches: (row) =>
      row.rowClass === ROW_CLASS.ORDER_ADJUSTMENT && isUnclearedInvoicePaymentBucketRow(row),
  },
  {
    id: LINE_TYPE.ORDER_ADJUSTMENT_FEE_JOURNAL,
    label: 'Non-logistics order adjustment',
    description: 'Order adjustment with no logistics component — posts as a fee journal.',
    section: LINE_SECTION.ADVERTISING_AND_FEES,
    mechanism: MECHANISM.FEE_JOURNAL,
    vatPolicy: VAT_POLICY.COMPONENT_SUM,
    glAccounts: ['1085', '1066'],
    matches: (row) =>
      row.rowClass === ROW_CLASS.ORDER_ADJUSTMENT && Math.abs(num(row.total)) >= 0.01,
  },
  {
    id: LINE_TYPE.UNEXPLAINED_OTHER,
    label: 'Unexplained',
    description: 'No treatment could be derived. Blocks approval until resolved.',
    section: LINE_SECTION.UNRESOLVED,
    mechanism: MECHANISM.NONE,
    vatPolicy: VAT_POLICY.NONE,
    glAccounts: [],
    matches: () => true,
  },
])

const LINE_TYPE_BY_ID = Object.freeze(
  LINE_TYPE_REGISTRY.reduce((acc, entry) => {
    acc[entry.id] = entry
    return acc
  }, {})
)

/**
 * Resolve the single line type for a row.
 * @param {object} row reclassified statement row (run `reclassifyReturnRows` first)
 * @param {object} ctx from `buildRowContext`
 * @returns {object} the matching registry entry
 */
function resolveLineType(row, ctx) {
  if (!row) return LINE_TYPE_BY_ID[LINE_TYPE.UNEXPLAINED_OTHER]
  for (const entry of LINE_TYPE_REGISTRY) {
    if (entry.matches(row, ctx)) return entry
  }
  return LINE_TYPE_BY_ID[LINE_TYPE.UNEXPLAINED_OTHER]
}

/** Attach `lineType` / `lineSection` / `vatPolicy` to each row without mutating the input. */
function annotateRowsWithLineType(rows, ctx) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const entry = resolveLineType(row, ctx)
    return {
      ...row,
      lineType: entry.id,
      lineSection: entry.section,
      lineMechanism: entry.mechanism,
      vatPolicy: entry.vatPolicy,
    }
  })
}

/** Section metadata for the UI, in display order, with the types each contains. */
function describeLineSections() {
  const order = [
    LINE_SECTION.ORDER_PAYMENTS,
    LINE_SECTION.SALES_RETURNS,
    LINE_SECTION.ADVERTISING_AND_FEES,
    LINE_SECTION.SETTLEMENT_ADJUSTMENTS,
    LINE_SECTION.UNRESOLVED,
  ]
  return order.map((section) => ({
    section,
    label: LINE_SECTION_LABEL[section],
    lineTypes: LINE_TYPE_REGISTRY.filter((e) => e.section === section).map((e) => ({
      id: e.id,
      label: e.label,
      description: e.description,
      mechanism: e.mechanism,
      vatPolicy: e.vatPolicy,
      glAccounts: e.glAccounts,
      isGap: Boolean(e.isGap),
    })),
  }))
}

module.exports = {
  LINE_TYPE,
  LINE_SECTION,
  LINE_SECTION_LABEL,
  MECHANISM,
  LINE_TYPE_REGISTRY,
  LINE_TYPE_BY_ID,
  resolveLineType,
  annotateRowsWithLineType,
  describeLineSections,
}
