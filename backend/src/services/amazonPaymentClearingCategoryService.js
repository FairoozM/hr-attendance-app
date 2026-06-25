const CATEGORY = Object.freeze({
  PRODUCT_SALES: 'Product Sales',
  PRINCIPAL: 'Principal',
  TAX: 'Tax',
  SHIPPING: 'Shipping',
  SHIPPING_TAX: 'Shipping Tax',
  COMMISSION: 'Commission',
  FBA_FULFILLMENT_FEE: 'FBA / Fulfillment Fee',
  CLOSING_FEE: 'Closing Fee',
  ADVERTISING_FEE: 'Advertising Fee',
  PREMIUM_SERVICES_FEE: 'Premium Services Fee',
  PREMIUM_SERVICES_FEE_TAX: 'Premium Services Fee Tax',
  STORAGE_FEE: 'Storage Fee',
  EASY_SHIP_CHARGES: 'Easy Ship Charges',
  PROMOTION_DISCOUNT: 'Promotion / Discount',
  REFUND: 'Refund',
  RETURN: 'Return',
  REIMBURSEMENT: 'Reimbursement',
  ADJUSTMENT: 'Adjustment',
  MARKETPLACE_WITHHELD_TAX: 'Marketplace Withheld Tax',
  OTHER_AMAZON_FEE: 'Other Amazon Fee',
  OTHER: 'Other',
})

const ROW_CLASS = Object.freeze({
  SALE: 'sale',
  FEE: 'fee',
  NON_ORDER_LINKED_AMAZON_FEE: 'NON_ORDER_LINKED_AMAZON_FEE',
  REFUND: 'refund',
  RETURN: 'return',
  ADJUSTMENT: 'adjustment',
  SHIPPING_FBA: 'shipping/fba',
  UNKNOWN: 'unknown',
})

const CATEGORY_ORDER = [
  CATEGORY.PRODUCT_SALES,
  CATEGORY.PRINCIPAL,
  CATEGORY.TAX,
  CATEGORY.SHIPPING,
  CATEGORY.SHIPPING_TAX,
  CATEGORY.COMMISSION,
  CATEGORY.FBA_FULFILLMENT_FEE,
  CATEGORY.CLOSING_FEE,
  CATEGORY.ADVERTISING_FEE,
  CATEGORY.PREMIUM_SERVICES_FEE,
  CATEGORY.PREMIUM_SERVICES_FEE_TAX,
  CATEGORY.STORAGE_FEE,
  CATEGORY.EASY_SHIP_CHARGES,
  CATEGORY.PROMOTION_DISCOUNT,
  CATEGORY.REFUND,
  CATEGORY.RETURN,
  CATEGORY.REIMBURSEMENT,
  CATEGORY.ADJUSTMENT,
  CATEGORY.MARKETPLACE_WITHHELD_TAX,
  CATEGORY.OTHER_AMAZON_FEE,
  CATEGORY.OTHER,
]

function field(row, key) {
  return String(row?.[key] ?? '').trim()
}

function text(row) {
  return [
    row?.transactionType,
    row?.amountType,
    row?.amountDescription,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function categorizeSettlementRow(row) {
  const transactionType = field(row, 'transactionType')
  const amountType = field(row, 'amountType')
  const amountDescription = field(row, 'amountDescription')
  const hay = text(row)
  const tx = transactionType.toLowerCase()
  const amount = Number(row?.amount) || 0

  if (tx.includes('return') || hay.includes('return')) return CATEGORY.RETURN
  if (tx.includes('refund') || hay.includes('refund')) return CATEGORY.REFUND
  if (hay.includes('reimbursement')) return CATEGORY.REIMBURSEMENT
  if (tx.includes('adjustment') || hay.includes('adjustment')) return CATEGORY.ADJUSTMENT
  if (hay.includes('marketplacewithheldtax') || hay.includes('marketplace withheld tax') || hay.includes('withheld tax')) {
    return CATEGORY.MARKETPLACE_WITHHELD_TAX
  }

  if (
    transactionType === 'ServiceFee' &&
    amountType === 'Cost of Advertising' &&
    amountDescription === 'TransactionTotalAmount'
  ) {
    return CATEGORY.ADVERTISING_FEE
  }
  if (hay.includes('advertising')) return CATEGORY.ADVERTISING_FEE
  if (
    transactionType === 'AmazonFees' &&
    amountType === 'Premium Services Fee' &&
    amountDescription === 'Tax on fee'
  ) {
    return CATEGORY.PREMIUM_SERVICES_FEE_TAX
  }
  if (
    transactionType === 'AmazonFees' &&
    amountType === 'Premium Services Fee' &&
    amountDescription === 'Base fee'
  ) {
    return CATEGORY.PREMIUM_SERVICES_FEE
  }
  if (hay.includes('premium services fee')) return CATEGORY.PREMIUM_SERVICES_FEE
  if (amountDescription === 'Storage Fee' || amountDescription === 'StorageRenewalBilling') {
    return CATEGORY.STORAGE_FEE
  }
  if (hay.includes('storage fee') || hay.includes('storagerenewalbilling')) return CATEGORY.STORAGE_FEE
  if (amountDescription === 'Amazon Easy Ship Charges') return CATEGORY.EASY_SHIP_CHARGES

  if (hay.includes('promotion') || hay.includes('promo') || hay.includes('discount') || hay.includes('coupon')) {
    return CATEGORY.PROMOTION_DISCOUNT
  }
  if (hay.includes('shipping tax') || hay.includes('shippingtax')) return CATEGORY.SHIPPING_TAX
  if (hay.includes('shipping')) return CATEGORY.SHIPPING
  if (hay.includes('principal')) return CATEGORY.PRINCIPAL
  if (hay.includes('tax')) return CATEGORY.TAX
  if (hay.includes('commission')) return CATEGORY.COMMISSION
  if (
    hay.includes('fba') ||
    hay.includes('fulfillment') ||
    hay.includes('fulfilment') ||
    hay.includes('pick') ||
    hay.includes('pack') ||
    hay.includes('weight handling')
  ) {
    return CATEGORY.FBA_FULFILLMENT_FEE
  }
  if (hay.includes('closing')) return CATEGORY.CLOSING_FEE

  if (hay.includes('fee') || hay.includes('charge')) return CATEGORY.OTHER_AMAZON_FEE
  if (tx.includes('order') && amount >= 0) return CATEGORY.PRODUCT_SALES
  return CATEGORY.OTHER
}

function isCustomerRefundOrReturnRow(row) {
  const hay = text(row)
  const tx = field(row, 'transactionType').toLowerCase()
  const amountType = field(row, 'amountType').toLowerCase()
  const amountDescription = field(row, 'amountDescription').toLowerCase()

  if (!(tx.includes('refund') || tx.includes('return') || hay.includes('refund') || hay.includes('return'))) {
    return false
  }

  // Amazon refund reports also include fee reversals. Credit notes should only
  // be required for customer-facing refund/return amounts.
  if (
    amountType.includes('itemprice') ||
    amountType.includes('item price') ||
    ['principal', 'tax', 'shipping', 'shipping tax'].includes(amountDescription)
  ) {
    return true
  }

  return !isFeeCategory(categorizeSettlementRow(row))
}

function classifySettlementRow(row) {
  const category = row?.category || categorizeSettlementRow(row)
  const hay = text(row)
  const tx = field(row, 'transactionType').toLowerCase()

  if (!hasOrderId(row) && (isFeeCategory(category) || category === CATEGORY.OTHER)) return ROW_CLASS.NON_ORDER_LINKED_AMAZON_FEE
  if (isCustomerRefundOrReturnRow(row)) {
    return tx.includes('return') || hay.includes('return') || category === CATEGORY.RETURN
      ? ROW_CLASS.RETURN
      : ROW_CLASS.REFUND
  }
  if (category === CATEGORY.ADJUSTMENT) return ROW_CLASS.ADJUSTMENT
  if (
    category === CATEGORY.SHIPPING ||
    category === CATEGORY.SHIPPING_TAX ||
    category === CATEGORY.FBA_FULFILLMENT_FEE ||
    category === CATEGORY.CLOSING_FEE ||
    category === CATEGORY.EASY_SHIP_CHARGES
  ) {
    return ROW_CLASS.SHIPPING_FBA
  }
  if (isFeeCategory(category)) return ROW_CLASS.FEE
  if (isSalesCategory(category)) return ROW_CLASS.SALE
  return ROW_CLASS.UNKNOWN
}

function isFeeCategory(category) {
  return [
    CATEGORY.COMMISSION,
    CATEGORY.FBA_FULFILLMENT_FEE,
    CATEGORY.CLOSING_FEE,
    CATEGORY.ADVERTISING_FEE,
    CATEGORY.PREMIUM_SERVICES_FEE,
    CATEGORY.PREMIUM_SERVICES_FEE_TAX,
    CATEGORY.STORAGE_FEE,
    CATEGORY.EASY_SHIP_CHARGES,
    CATEGORY.OTHER_AMAZON_FEE,
    CATEGORY.MARKETPLACE_WITHHELD_TAX,
  ].includes(category)
}

function isSalesCategory(category) {
  return [
    CATEGORY.PRODUCT_SALES,
    CATEGORY.PRINCIPAL,
    CATEGORY.TAX,
    CATEGORY.SHIPPING,
    CATEGORY.SHIPPING_TAX,
  ].includes(category)
}

function hasOrderId(row) {
  return Boolean(field(row, 'orderId'))
}

function isNonOrderLinkedAmazonFee(row) {
  const category = row?.category || categorizeSettlementRow(row)
  return !hasOrderId(row) && (isFeeCategory(category) || category === CATEGORY.OTHER)
}

module.exports = {
  CATEGORY,
  ROW_CLASS,
  CATEGORY_ORDER,
  categorizeSettlementRow,
  classifySettlementRow,
  isCustomerRefundOrReturnRow,
  isFeeCategory,
  isSalesCategory,
  hasOrderId,
  isNonOrderLinkedAmazonFee,
}
