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
  REIMBURSEMENT: 'Reimbursement',
  ADJUSTMENT: 'Adjustment',
  MARKETPLACE_WITHHELD_TAX: 'Marketplace Withheld Tax',
  OTHER_AMAZON_FEE: 'Other Amazon Fee',
  OTHER: 'Other',
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
  if (
    transactionType === 'AmazonFees' &&
    amountType === 'Premium Services Fee' &&
    amountDescription === 'Base fee'
  ) {
    return CATEGORY.PREMIUM_SERVICES_FEE
  }
  if (
    transactionType === 'AmazonFees' &&
    amountType === 'Premium Services Fee' &&
    amountDescription === 'Tax on fee'
  ) {
    return CATEGORY.PREMIUM_SERVICES_FEE_TAX
  }
  if (amountDescription === 'Storage Fee' || amountDescription === 'StorageRenewalBilling') {
    return CATEGORY.STORAGE_FEE
  }
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

module.exports = {
  CATEGORY,
  CATEGORY_ORDER,
  categorizeSettlementRow,
  isFeeCategory,
  isSalesCategory,
  hasOrderId,
}
