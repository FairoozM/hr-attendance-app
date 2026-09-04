const { resolveNoonOrderIds, parseNoonOrderId } = require('./noonOrderIdHelper')

const ROW_CLASS = Object.freeze({
  SALE_ITEM: 'sale_item',
  PARENT_ORDER_CHARGE: 'parent_order_charge',
  ORDER_ADJUSTMENT: 'order_adjustment',
  RETURN: 'return',
  STATEMENT_FEE: 'statement_fee',
  OTHER: 'other',
})

const NORMALIZED_FEE_TYPE = Object.freeze({
  REFERRAL_COMMISSION: 'REFERRAL_COMMISSION',
  FULFILLMENT: 'FULFILLMENT',
  SHIPPING: 'SHIPPING',
  /** Statement-level Noon advertising expense (no invoice). */
  NOON_ADVERTISING_FEE: 'NOON_ADVERTISING_FEE',
  /** Legacy alias kept for existing mapping rows. */
  ADVERTISING: 'ADVERTISING',
  /** Statement-level storage charges. Each maps to its own Zoho account. */
  STORAGE_FEE: 'STORAGE_FEE',
  MONTHLY_STORAGE_FEE: 'MONTHLY_STORAGE_FEE',
  LONG_TERM_STORAGE_FEE: 'LONG_TERM_STORAGE_FEE',
  STATEMENT_FEE: 'STATEMENT_FEE',
  SUBSIDY: 'SUBSIDY',
  ORDER_ADJUSTMENT: 'ORDER_ADJUSTMENT',
  PARENT_ORDER_CHARGE: 'PARENT_ORDER_CHARGE',
  OTHER: 'OTHER',
})

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function normalizeTransactionType(value) {
  return clean(value).toLowerCase().replace(/[\s-]+/g, '_')
}

function isStatementTransactionType(tx) {
  const t = normalizeTransactionType(tx)
  return t === 'statement' || t === 'statement_fee' || t === 'non_order' || t === 'nonorder'
}

function isAdvertisingTitle(title) {
  return /advertis|ad\s*fee|ads?\s*expense/i.test(clean(title))
}

function isAdvertisingFeeRow(row) {
  // Advertising is identified from Noon title/context — not from amount sign alone.
  return isAdvertisingTitle(row.title)
}

/**
 * Noon bills storage under three separate Zoho accounts, so the variant matters.
 * Long-term is checked first because its title also contains the word "storage".
 */
function storageFeeTypeFromTitle(title) {
  const t = clean(title)
  if (!/storage/i.test(t)) return ''
  if (/long[\s_-]*term/i.test(t)) return NORMALIZED_FEE_TYPE.LONG_TERM_STORAGE_FEE
  if (/month/i.test(t)) return NORMALIZED_FEE_TYPE.MONTHLY_STORAGE_FEE
  return NORMALIZED_FEE_TYPE.STORAGE_FEE
}

function isStorageFeeRow(row) {
  return Boolean(storageFeeTypeFromTitle(row?.title))
}

const FEE_COLUMN_FIELDS = [
  'referralFee',
  'fulfillmentFee',
  'shippingCharges',
  'otherOrderFees',
  'orderSubsidies',
  'orderSubscriptionFees',
  'othersInclVat',
  'nonOrderFees',
  'nonOrderSubsidies',
]

/** Whether the signed fee columns on their own add up to the row Total. */
function feeColumnsExplainTotal(row) {
  const fees = round2(FEE_COLUMN_FIELDS.reduce((sum, field) => sum + num(row[field]), 0))
  return Math.abs(round2(num(row.total) - fees)) < 0.01
}

function hasProductSaleSignal(row) {
  const netProceed = num(row.netProceed)
  const sku = clean(row.sku || row.partnerSku)
  const title = clean(row.title)
  const looksLikeProductTitle =
    title.length > 0 &&
    !/^PG[A-Z0-9]+$/i.test(title) &&
    !/,PG[A-Z0-9]+/i.test(title) &&
    !/fee/i.test(title) &&
    !isAdvertisingTitle(title)
  if (netProceed > 0) return true
  // The SKU/title fallback exists for spreadsheets where Net Proceeds failed to parse. If
  // the fee columns already account for the whole Total then nothing failed to parse and
  // there is no product revenue in the row — it is a fee correction on an order that sold
  // in another week, and it settles through a journal rather than an invoice payment.
  return (
    Boolean(sku) && looksLikeProductTitle && num(row.total) !== 0 && !feeColumnsExplainTotal(row)
  )
}

/**
 * Order-level charge/credit (shipping, logistics, VAT on fees, subsidies, etc.).
 * Uses signed Noon columns — positive totals are valid reversals/credits.
 * Also treats nonzero Total with zero Net Proceed as a charge when fee columns
 * failed to parse (spreadsheet header drift).
 */
function isOrderLevelChargeRow(row) {
  if (num(row.netProceed) !== 0) return false
  if (hasProductSaleSignal(row)) return false
  if (isAdvertisingFeeRow(row)) return false
  return (
    num(row.fulfillmentFee) !== 0 ||
    num(row.shippingCharges) !== 0 ||
    num(row.otherOrderFees) !== 0 ||
    num(row.othersInclVat) !== 0 ||
    num(row.orderSubsidies) !== 0 ||
    num(row.referralFee) !== 0 ||
    num(row.orderSubscriptionFees) !== 0 ||
    (Math.abs(num(row.total)) >= 0.01 && num(row.nonOrderFees) === 0)
  )
}

function isFeeOnlyOrderRow(row) {
  return isOrderLevelChargeRow(row)
}

function classifyNoonStatementRow(row) {
  const tx = normalizeTransactionType(row.transactionType)
  const ids = resolveNoonOrderIds({ orderNr: row.orderNr, itemNr: row.itemNr })

  if (isAdvertisingFeeRow(row) || isStatementTransactionType(tx)) {
    return ROW_CLASS.STATEMENT_FEE
  }

  if (!ids.parentOrderId && !ids.itemOrderId && (num(row.nonOrderFees) !== 0 || isAdvertisingTitle(row.title))) {
    return ROW_CLASS.STATEMENT_FEE
  }

  // Noon reports a sale that settles after its order week as `order_update`. Net Proceeds
  // on an item-level row means goods were sold, so it clears against an invoice like any
  // other sale. This is the positive mirror of the negative `order_update` rows that
  // reclassifyReturnRows turns into returns; without it the row has no accounting
  // destination whenever the rest of its order sold in an earlier statement.
  if (tx === 'order_update' && num(row.netProceed) >= 0.01 && ids.hasItemLevelId) {
    return ROW_CLASS.SALE_ITEM
  }

  if (tx === 'order_update') {
    return ROW_CLASS.ORDER_ADJUSTMENT
  }

  if (tx === 'order' || tx === '') {
    if (hasProductSaleSignal(row) && ids.hasItemLevelId) {
      return ROW_CLASS.SALE_ITEM
    }
    if (hasProductSaleSignal(row) && ids.parentOrderId && !ids.hasItemLevelId) {
      return ROW_CLASS.SALE_ITEM
    }
    if (isOrderLevelChargeRow(row)) {
      if (ids.hasItemLevelId) return ROW_CLASS.ORDER_ADJUSTMENT
      if (ids.parentOrderId) return ROW_CLASS.PARENT_ORDER_CHARGE
      return ROW_CLASS.ORDER_ADJUSTMENT
    }
  }

  if (isOrderLevelChargeRow(row) && ids.parentOrderId && !ids.hasItemLevelId) {
    return ROW_CLASS.PARENT_ORDER_CHARGE
  }

  // Last-chance: nonzero amount with a parent-shaped Noon ID and no sale → parent charge.
  if (
    Math.abs(num(row.total)) >= 0.01 &&
    !hasProductSaleSignal(row) &&
    ids.parentOrderId &&
    !ids.hasItemLevelId
  ) {
    return ROW_CLASS.PARENT_ORDER_CHARGE
  }

  return ROW_CLASS.OTHER
}

function requiresZohoInvoice(rowClass) {
  return rowClass === ROW_CLASS.SALE_ITEM
}

function normalizeNoonFeeType(row) {
  const rowClass = row.rowClass || classifyNoonStatementRow(row)
  if (rowClass === ROW_CLASS.STATEMENT_FEE || isAdvertisingFeeRow(row)) {
    if (isAdvertisingFeeRow(row) || isAdvertisingTitle(row.title)) {
      return NORMALIZED_FEE_TYPE.NOON_ADVERTISING_FEE
    }
    const storageType = storageFeeTypeFromTitle(row.title)
    if (storageType) return storageType
    return NORMALIZED_FEE_TYPE.STATEMENT_FEE
  }
  if (rowClass === ROW_CLASS.PARENT_ORDER_CHARGE || rowClass === ROW_CLASS.ORDER_ADJUSTMENT) {
    if (num(row.fulfillmentFee) !== 0) return NORMALIZED_FEE_TYPE.FULFILLMENT
    if (num(row.shippingCharges) !== 0) return NORMALIZED_FEE_TYPE.SHIPPING
    if (
      num(row.othersInclVat) !== 0 ||
      num(row.otherOrderFees) !== 0 ||
      num(row.orderSubsidies) !== 0
    ) {
      return NORMALIZED_FEE_TYPE.SHIPPING
    }
    if (rowClass === ROW_CLASS.ORDER_ADJUSTMENT) return NORMALIZED_FEE_TYPE.ORDER_ADJUSTMENT
    return NORMALIZED_FEE_TYPE.PARENT_ORDER_CHARGE
  }
  if (num(row.referralFee) !== 0 && num(row.netProceed) === 0) return NORMALIZED_FEE_TYPE.REFERRAL_COMMISSION
  return NORMALIZED_FEE_TYPE.OTHER
}

function displayLabelForFeeRow(row) {
  const feeType = row.normalizedFeeType || normalizeNoonFeeType(row)
  if (
    feeType === NORMALIZED_FEE_TYPE.NOON_ADVERTISING_FEE ||
    feeType === NORMALIZED_FEE_TYPE.ADVERTISING
  ) {
    return 'Advertising Fee'
  }
  if (feeType === NORMALIZED_FEE_TYPE.LONG_TERM_STORAGE_FEE) return 'Long Term Storage Fee'
  if (feeType === NORMALIZED_FEE_TYPE.MONTHLY_STORAGE_FEE) return 'Monthly Storage Fee'
  if (feeType === NORMALIZED_FEE_TYPE.STORAGE_FEE) return 'Storage Fee'
  if (feeType === NORMALIZED_FEE_TYPE.FULFILLMENT) return 'Fulfillment / Logistics'
  if (feeType === NORMALIZED_FEE_TYPE.SHIPPING) return 'Shipping / Logistics'
  if (feeType === NORMALIZED_FEE_TYPE.PARENT_ORDER_CHARGE) return 'Parent Order Charge'
  if (feeType === NORMALIZED_FEE_TYPE.ORDER_ADJUSTMENT) return 'Order Adjustment'
  if (feeType === NORMALIZED_FEE_TYPE.STATEMENT_FEE) return 'Statement Fee'
  return clean(row.title) || 'Other'
}

function accountingTreatmentForFeeRow(row) {
  const feeType = row.normalizedFeeType || normalizeNoonFeeType(row)
  if (
    feeType === NORMALIZED_FEE_TYPE.NOON_ADVERTISING_FEE ||
    feeType === NORMALIZED_FEE_TYPE.ADVERTISING
  ) {
    return 'Noon Advertising Expense'
  }
  if (
    feeType === NORMALIZED_FEE_TYPE.STORAGE_FEE ||
    feeType === NORMALIZED_FEE_TYPE.MONTHLY_STORAGE_FEE ||
    feeType === NORMALIZED_FEE_TYPE.LONG_TERM_STORAGE_FEE
  ) {
    return 'Noon Storage Fees'
  }
  if (feeType === NORMALIZED_FEE_TYPE.FULFILLMENT || feeType === NORMALIZED_FEE_TYPE.SHIPPING) {
    return 'Noon Uncleared Fulfillment Exp'
  }
  if (feeType === NORMALIZED_FEE_TYPE.PARENT_ORDER_CHARGE) return 'Noon Uncleared Fulfillment Exp'
  if (feeType === NORMALIZED_FEE_TYPE.ORDER_ADJUSTMENT) return 'Noon Marketplace Adjustments'
  if (feeType === NORMALIZED_FEE_TYPE.STATEMENT_FEE) return 'Noon Marketplace Fees'
  return 'Noon Marketplace Fees'
}

function invoiceMatchKeyForRow(row) {
  const ids = resolveNoonOrderIds({ orderNr: row.orderNr, itemNr: row.itemNr })
  if (ids.itemOrderId) return ids.itemOrderId
  if (row.rowClass === ROW_CLASS.SALE_ITEM || classifyNoonStatementRow(row) === ROW_CLASS.SALE_ITEM) {
    return ids.parentOrderId
  }
  return ''
}

/**
 * Reclassify rows that landed as OTHER but are known Noon charge patterns.
 * Does not invent sale_item matches.
 */
function reclassifyExplainableOtherRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (row.rowClass !== ROW_CLASS.OTHER) return row
    const nextClass = classifyNoonStatementRow(row)
    if (nextClass === ROW_CLASS.OTHER) return row
    return {
      ...row,
      rowClass: nextClass,
      normalizedFeeType: normalizeNoonFeeType({ ...row, rowClass: nextClass }),
      reclassifiedFrom: 'other',
    }
  })
}

function feeMappingTypeCandidates(feeType) {
  const t = clean(feeType)
  const advertisingGroup = [
    NORMALIZED_FEE_TYPE.NOON_ADVERTISING_FEE,
    NORMALIZED_FEE_TYPE.ADVERTISING,
    NORMALIZED_FEE_TYPE.STATEMENT_FEE,
  ]
  if (advertisingGroup.includes(t)) {
    return advertisingGroup
  }
  return [t]
}

/**
 * Order-linked commission / shipping / fulfillment clear via invoice Record Payments
 * to uncleared GLs (Amazon KSA parallel) — not via settlement fee journals.
 */
function isUnclearedInvoicePaymentBucketRow(row) {
  if (!row) return false
  const rowClass = row.rowClass || classifyNoonStatementRow(row)
  if (rowClass === ROW_CLASS.RETURN) return false
  if (rowClass !== ROW_CLASS.PARENT_ORDER_CHARGE && rowClass !== ROW_CLASS.ORDER_ADJUSTMENT) {
    return false
  }
  const feeType = clean(row.normalizedFeeType || normalizeNoonFeeType(row))
  if (
    feeType === NORMALIZED_FEE_TYPE.FULFILLMENT ||
    feeType === NORMALIZED_FEE_TYPE.SHIPPING ||
    feeType === NORMALIZED_FEE_TYPE.REFERRAL_COMMISSION ||
    feeType === NORMALIZED_FEE_TYPE.PARENT_ORDER_CHARGE
  ) {
    return true
  }
  return (
    num(row.fulfillmentFee) !== 0 ||
    num(row.shippingCharges) !== 0 ||
    num(row.otherOrderFees) !== 0 ||
    num(row.othersInclVat) !== 0 ||
    num(row.orderSubsidies) !== 0 ||
    (num(row.referralFee) !== 0 && num(row.netProceed) === 0)
  )
}

/** Settlement fee journals = statement-level / advertising-style only (Amazon parallel). */
function isSettlementFeeJournalRow(row) {
  if (!row) return false
  const rowClass = row.rowClass || classifyNoonStatementRow(row)
  if (rowClass === ROW_CLASS.RETURN) return false
  const itemOrderId = clean(row.itemOrderId)
  if (itemOrderId && itemOrderId.includes('-') && num(row.netProceed) <= -0.01) {
    return false
  }
  if (rowClass === ROW_CLASS.STATEMENT_FEE) return true
  if (rowClass === ROW_CLASS.PARENT_ORDER_CHARGE) return false
  if (rowClass === ROW_CLASS.ORDER_ADJUSTMENT) {
    if (isUnclearedInvoicePaymentBucketRow(row)) return false
    return Math.abs(num(row.total)) >= 0.01
  }
  return false
}

module.exports = {
  ROW_CLASS,
  NORMALIZED_FEE_TYPE,
  classifyNoonStatementRow,
  requiresZohoInvoice,
  normalizeNoonFeeType,
  normalizeTransactionType,
  displayLabelForFeeRow,
  accountingTreatmentForFeeRow,
  hasProductSaleSignal,
  isFeeOnlyOrderRow,
  isOrderLevelChargeRow,
  isAdvertisingFeeRow,
  isStorageFeeRow,
  storageFeeTypeFromTitle,
  isStatementTransactionType,
  invoiceMatchKeyForRow,
  reclassifyExplainableOtherRows,
  feeMappingTypeCandidates,
  isUnclearedInvoicePaymentBucketRow,
  isSettlementFeeJournalRow,
  round2,
  num,
  clean,
  parseNoonOrderId,
}
