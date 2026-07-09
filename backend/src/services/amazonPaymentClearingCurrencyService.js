const { LEGACY_KSA_ZOHO_CUSTOMER_NAME } = require('./amazonPaymentClearingZohoMatcher')

/** Amazon.sa legacy settlements are labeled SAR; Life Smile Business Zoho invoices are AED. */
const LEGACY_SETTLEMENT_SOURCE_CURRENCY = 'SAR'
const LEGACY_SETTLEMENT_DISPLAY_CURRENCY = 'AED'
const SAR_TO_AED_RATE = Number(process.env.AMAZON_KSA_LEGACY_SAR_TO_AED) || 3.67 / 3.75

const ORDER_AMOUNT_FIELDS = [
  'principalTotal',
  'shippingCollectedTotal',
  'commissionTotal',
  'fulfillmentFeeTotal',
  'closingFeeTotal',
  'shippingPromotionTotal',
  'refundTotal',
  'otherAmazonFeeTotal',
  'amazonOrderTotal',
  'grossAmazonTotal',
  'totalFees',
  'netSettlementAmount',
  'feesTotal',
  'netAmount',
  'invoiceClearingNetBalance',
  'shippingOffsetTotal',
  'amazonRefundAmount',
]

function round2(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function clean(value) {
  return String(value == null ? '' : value).trim()
}

function isLegacyKsaPaymentClearingCustomer(customerName) {
  return clean(customerName) === LEGACY_KSA_ZOHO_CUSTOMER_NAME
}

function sarAmountToAed(amount) {
  return round2((Number(amount) || 0) * SAR_TO_AED_RATE)
}

function settlementCurrencyForCustomer(customerName, parsedCurrency = 'SAR') {
  if (isLegacyKsaPaymentClearingCustomer(customerName)) return LEGACY_SETTLEMENT_DISPLAY_CURRENCY
  return clean(parsedCurrency) || 'SAR'
}

function convertLegacySettlementAmount(amount, customerName) {
  if (!isLegacyKsaPaymentClearingCustomer(customerName)) return round2(Number(amount) || 0)
  return sarAmountToAed(amount)
}

function applyLegacyCurrencyToSettlementRows(rows, customerName) {
  if (!isLegacyKsaPaymentClearingCustomer(customerName)) {
    return Array.isArray(rows) ? rows : []
  }
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    currency: LEGACY_SETTLEMENT_DISPLAY_CURRENCY,
    amount: sarAmountToAed(row?.amount),
    totalAmount: row?.totalAmount == null ? row?.totalAmount : sarAmountToAed(row.totalAmount),
  }))
}

function convertLegacyOrderSummary(order, customerName) {
  if (!order || !isLegacyKsaPaymentClearingCustomer(customerName)) return order
  const out = { ...order }
  for (const key of ORDER_AMOUNT_FIELDS) {
    if (out[key] != null && Number.isFinite(Number(out[key]))) {
      out[key] = sarAmountToAed(out[key])
    }
  }
  return out
}

function legacyCurrencyParserWarning(customerName) {
  if (!isLegacyKsaPaymentClearingCustomer(customerName)) return ''
  return (
    `Legacy Life Smile settlement amounts are converted from ${LEGACY_SETTLEMENT_SOURCE_CURRENCY} to ` +
    `${LEGACY_SETTLEMENT_DISPLAY_CURRENCY} at ${SAR_TO_AED_RATE.toFixed(6)} for Zoho matching and payment preview.`
  )
}

module.exports = {
  LEGACY_SETTLEMENT_SOURCE_CURRENCY,
  LEGACY_SETTLEMENT_DISPLAY_CURRENCY,
  SAR_TO_AED_RATE,
  isLegacyKsaPaymentClearingCustomer,
  sarAmountToAed,
  settlementCurrencyForCustomer,
  convertLegacySettlementAmount,
  applyLegacyCurrencyToSettlementRows,
  convertLegacyOrderSummary,
  legacyCurrencyParserWarning,
}
