const { resolveNoonOrderIds } = require('./noonOrderIdHelper')

const ROW_CLASS = Object.freeze({
  SALE_ITEM: 'sale_item',
  PARENT_ORDER_CHARGE: 'parent_order_charge',
  ORDER_ADJUSTMENT: 'order_adjustment',
  STATEMENT_FEE: 'statement_fee',
  OTHER: 'other',
})

const NORMALIZED_FEE_TYPE = Object.freeze({
  REFERRAL_COMMISSION: 'REFERRAL_COMMISSION',
  FULFILLMENT: 'FULFILLMENT',
  SHIPPING: 'SHIPPING',
  ADVERTISING: 'ADVERTISING',
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

function hasProductSaleSignal(row) {
  const netProceed = num(row.netProceed)
  const sku = clean(row.sku || row.partnerSku)
  const title = clean(row.title)
  const looksLikeProductTitle =
    title.length > 0 &&
    !/^PG[A-Z0-9]+$/i.test(title) &&
    !/fee/i.test(title) &&
    title.toLowerCase() !== 'advertising fee'
  return netProceed > 0 || (Boolean(sku) && looksLikeProductTitle && num(row.total) !== 0)
}

function isFeeOnlyOrderRow(row) {
  const netProceed = num(row.netProceed)
  const referral = num(row.referralFee)
  const fulfillment = num(row.fulfillmentFee)
  const shipping = num(row.shippingCharges)
  const otherOrder = num(row.otherOrderFees)
  const othersVat = num(row.othersInclVat)
  const nonOrder = num(row.nonOrderFees)
  return (
    netProceed === 0 &&
    (fulfillment !== 0 || shipping !== 0 || otherOrder !== 0 || othersVat !== 0 || referral !== 0 || nonOrder !== 0)
  )
}

function classifyNoonStatementRow(row) {
  const tx = clean(row.transactionType).toLowerCase()
  const ids = resolveNoonOrderIds({ orderNr: row.orderNr, itemNr: row.itemNr })
  const title = clean(row.title)

  if (tx === 'statement' || (!ids.parentOrderId && !ids.itemOrderId && (num(row.nonOrderFees) !== 0 || /advertising/i.test(title)))) {
    return ROW_CLASS.STATEMENT_FEE
  }

  if (tx === 'order_update') {
    return ROW_CLASS.ORDER_ADJUSTMENT
  }

  if (tx === 'order' || tx === '') {
    if (hasProductSaleSignal(row) && ids.hasItemLevelId) {
      return ROW_CLASS.SALE_ITEM
    }
    if (hasProductSaleSignal(row) && ids.parentOrderId && !ids.hasItemLevelId) {
      // Sale proceeds on a parent-shaped ID with no distinct item nr — still require invoice
      // against the best available item key (parent used as item only when no child exists).
      return ROW_CLASS.SALE_ITEM
    }
    if (isFeeOnlyOrderRow(row)) {
      if (ids.hasItemLevelId) return ROW_CLASS.ORDER_ADJUSTMENT
      if (ids.parentOrderId) return ROW_CLASS.PARENT_ORDER_CHARGE
      return ROW_CLASS.ORDER_ADJUSTMENT
    }
  }

  if (isFeeOnlyOrderRow(row) && ids.parentOrderId && !ids.hasItemLevelId) {
    return ROW_CLASS.PARENT_ORDER_CHARGE
  }

  return ROW_CLASS.OTHER
}

function requiresZohoInvoice(rowClass) {
  return rowClass === ROW_CLASS.SALE_ITEM
}

function normalizeNoonFeeType(row) {
  const rowClass = row.rowClass || classifyNoonStatementRow(row)
  const title = clean(row.title).toLowerCase()
  if (rowClass === ROW_CLASS.STATEMENT_FEE) {
    if (title.includes('advertising')) return NORMALIZED_FEE_TYPE.ADVERTISING
    return NORMALIZED_FEE_TYPE.STATEMENT_FEE
  }
  if (rowClass === ROW_CLASS.PARENT_ORDER_CHARGE) {
    if (num(row.fulfillmentFee) !== 0) return NORMALIZED_FEE_TYPE.FULFILLMENT
    if (num(row.shippingCharges) !== 0) return NORMALIZED_FEE_TYPE.SHIPPING
    return NORMALIZED_FEE_TYPE.PARENT_ORDER_CHARGE
  }
  if (rowClass === ROW_CLASS.ORDER_ADJUSTMENT) return NORMALIZED_FEE_TYPE.ORDER_ADJUSTMENT
  if (num(row.referralFee) !== 0 && num(row.netProceed) === 0) return NORMALIZED_FEE_TYPE.REFERRAL_COMMISSION
  return NORMALIZED_FEE_TYPE.OTHER
}

function invoiceMatchKeyForRow(row) {
  const ids = resolveNoonOrderIds({ orderNr: row.orderNr, itemNr: row.itemNr })
  if (ids.itemOrderId) return ids.itemOrderId
  // Only for sale rows with no distinct item: use parent as last-resort match key.
  // Caller must still never match a different child invoice via parent.
  if (row.rowClass === ROW_CLASS.SALE_ITEM || classifyNoonStatementRow(row) === ROW_CLASS.SALE_ITEM) {
    return ids.parentOrderId
  }
  return ''
}

module.exports = {
  ROW_CLASS,
  NORMALIZED_FEE_TYPE,
  classifyNoonStatementRow,
  requiresZohoInvoice,
  normalizeNoonFeeType,
  hasProductSaleSignal,
  isFeeOnlyOrderRow,
  invoiceMatchKeyForRow,
  round2,
  num,
  clean,
}
