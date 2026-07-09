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

const LEGACY_SETTLEMENT_FX_NOTE =
  'Legacy settlement FX difference must be posted manually to Zoho currency exchange gain/loss.'
const LEGACY_INVOICE_PAYMENT_FX_NOTE =
  'Legacy invoice clearing differences are expected after SAR→AED conversion — post payments in Zoho and book rounding to currency exchange gain/loss.'
const SETTLEMENT_MISMATCH_WARNING = 'Settlement total does not match calculated expected deposit.'
const LEGACY_PAYMENT_PREVIEW_TOLERANCE = Number(process.env.AMAZON_KSA_LEGACY_PAYMENT_PREVIEW_TOLERANCE) || 1

function legacyAllowsSettlementReconciliationMismatch(customerName) {
  return isLegacyKsaPaymentClearingCustomer(customerName)
}

function legacyPaymentPreviewTolerance(customerName) {
  return isLegacyKsaPaymentClearingCustomer(customerName) ? LEGACY_PAYMENT_PREVIEW_TOLERANCE : 0.01
}

function resolveClearingCustomerName(source) {
  if (!source || typeof source !== 'object') return ''
  return clean(source.zohoCustomerName || source.batch?.zohoCustomerName)
}

function isLegacyPaymentPlanDifferenceAcceptable(remainingDifference, customerName) {
  return Math.abs(Number(remainingDifference) || 0) <= legacyPaymentPreviewTolerance(customerName)
}

function paymentPlanStatusForCustomer(remainingDifference, customerName, strictTolerance = 0.01) {
  const abs = Math.abs(Number(remainingDifference) || 0)
  if (abs <= strictTolerance) return 'ready'
  if (isLegacyKsaPaymentClearingCustomer(customerName) && abs <= legacyPaymentPreviewTolerance(customerName)) {
    return 'ready_fx_adjustment'
  }
  return 'mismatch'
}

function isSettlementReconciliationAcceptable(reconciliationSummary, customerName, tolerance = 0.01) {
  if (!reconciliationSummary || typeof reconciliationSummary !== 'object') return false
  if (reconciliationSummary.reconciliationStatus === 'reconciled') {
    const diff = Math.abs(Number(reconciliationSummary.reconciliationDifference) || 0)
    return diff <= tolerance
  }
  if (
    reconciliationSummary.reconciliationStatus === 'mismatch' &&
    legacyAllowsSettlementReconciliationMismatch(customerName)
  ) {
    return true
  }
  return false
}

function applyLegacySettlementMismatchTolerance(preview) {
  if (!preview || !legacyAllowsSettlementReconciliationMismatch(preview.zohoCustomerName)) return preview
  if (preview.reconciliationSummary?.reconciliationStatus !== 'mismatch') return preview

  preview.blockingIssues = (preview.blockingIssues || []).filter((issue) => issue.code !== 'SETTLEMENT_MISMATCH')

  const warnings = Array.isArray(preview.warnings) ? [...preview.warnings] : []
  let replacedMismatchWarning = false
  preview.warnings = warnings.map((warning) => {
    if (warning === SETTLEMENT_MISMATCH_WARNING) {
      replacedMismatchWarning = true
      return LEGACY_SETTLEMENT_FX_NOTE
    }
    return warning
  })
  if (!replacedMismatchWarning && !preview.warnings.includes(LEGACY_SETTLEMENT_FX_NOTE)) {
    preview.warnings.push(LEGACY_SETTLEMENT_FX_NOTE)
  }
  return preview
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
  LEGACY_SETTLEMENT_FX_NOTE,
  LEGACY_INVOICE_PAYMENT_FX_NOTE,
  SETTLEMENT_MISMATCH_WARNING,
  LEGACY_PAYMENT_PREVIEW_TOLERANCE,
  legacyAllowsSettlementReconciliationMismatch,
  legacyPaymentPreviewTolerance,
  resolveClearingCustomerName,
  isLegacyPaymentPlanDifferenceAcceptable,
  paymentPlanStatusForCustomer,
  isSettlementReconciliationAcceptable,
  applyLegacySettlementMismatchTolerance,
}
