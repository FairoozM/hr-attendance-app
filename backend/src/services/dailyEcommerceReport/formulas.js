'use strict'

/**
 * Financial formulas for Daily Ecommerce Report channel + overall totals.
 *
 * Included Costs = Ads + Commission + Shipping + Payment Fees + Other Included Costs
 *   (+ General Ecommerce Costs at overall level only)
 * Cost % = Included Costs / Sales × 100  (null when sales is 0 — never #DIV/0!)
 * Balance = Sales − Included Costs
 *
 * Null advertising values (not_configured / unavailable) are excluded from sums,
 * not treated as zero.
 */

const { round2, sumAvailable } = require('./money')

/**
 * @param {{
 *   salesAmountAED: number,
 *   adSpendAED: number|null,
 *   commissionAED: number,
 *   shippingAED: number,
 *   paymentFeesAED: number,
 *   otherIncludedCostsAED: number,
 * }} input
 */
function computeChannelFinancials(input) {
  const sales = round2(input.salesAmountAED || 0)
  const commission = round2(input.commissionAED || 0)
  const shipping = round2(input.shippingAED || 0)
  const paymentFees = round2(input.paymentFeesAED || 0)
  const other = round2(input.otherIncludedCostsAED || 0)
  const ads = input.adSpendAED == null ? null : round2(input.adSpendAED)

  const includedParts = [ads, commission, shipping, paymentFees, other]
  const { total: totalIncludedCostsAED } = sumAvailable(includedParts)

  let costPercentage = null
  if (sales > 0) {
    costPercentage = round2((totalIncludedCostsAED / sales) * 100)
  } else if (sales === 0) {
    costPercentage = totalIncludedCostsAED === 0 ? 0 : null
  }

  return {
    totalIncludedCostsAED,
    costPercentage,
    balanceAED: round2(sales - totalIncludedCostsAED),
  }
}

/**
 * @param {object[]} channelSummaries - channel.summary objects
 * @param {number|null} generalEcommerceCostsAED
 */
function computeOverallTotals(channelSummaries, generalEcommerceCostsAED = null) {
  const channels = Array.isArray(channelSummaries) ? channelSummaries : []

  let quantity = 0
  let orderCount = 0
  let salesAmountAED = 0
  let commissionAED = 0
  let shippingAED = 0
  let paymentFeesAED = 0
  let otherIncludedCostsAED = 0
  let couponDiscountAED = 0
  let smilePointsAED = 0

  const adSpendValues = []
  const clickValues = []

  for (const s of channels) {
    if (!s) continue
    quantity += Number(s.quantity) || 0
    orderCount += Number(s.orderCount) || 0
    salesAmountAED += Number(s.salesAmountAED) || 0
    commissionAED += Number(s.commissionAED) || 0
    shippingAED += Number(s.shippingAED) || 0
    paymentFeesAED += Number(s.paymentFeesAED) || 0
    otherIncludedCostsAED += Number(s.otherIncludedCostsAED) || 0
    couponDiscountAED += Number(s.couponDiscountAED) || 0
    smilePointsAED += Number(s.smilePointsAED) || 0
    if (s.adSpendAED != null && Number.isFinite(Number(s.adSpendAED))) {
      adSpendValues.push(Number(s.adSpendAED))
    }
    if (s.clicks != null && Number.isFinite(Number(s.clicks))) {
      clickValues.push(Number(s.clicks))
    }
  }

  const adsSum = sumAvailable(adSpendValues)
  const clicksSum = sumAvailable(clickValues)
  const general =
    generalEcommerceCostsAED == null || !Number.isFinite(Number(generalEcommerceCostsAED))
      ? null
      : round2(generalEcommerceCostsAED)

  const includedParts = [
    adsSum.used ? adsSum.total : null,
    commissionAED,
    shippingAED,
    paymentFeesAED,
    otherIncludedCostsAED,
    general,
  ]
  void includedParts

  const totalIncludedCostsAED = round2(
    (adsSum.used ? adsSum.total : 0) +
      commissionAED +
      shippingAED +
      paymentFeesAED +
      otherIncludedCostsAED +
      (general == null ? 0 : general),
  )

  salesAmountAED = round2(salesAmountAED)
  let costPercentage = null
  if (salesAmountAED > 0) {
    costPercentage = round2((totalIncludedCostsAED / salesAmountAED) * 100)
  } else {
    costPercentage = totalIncludedCostsAED === 0 ? 0 : null
  }

  return {
    orderCount,
    quantity,
    salesAmountAED,
    adSpendAED: adsSum.used ? adsSum.total : null,
    clicks: clicksSum.used ? Math.round(clicksSum.total) : null,
    commissionAED: round2(commissionAED),
    shippingAED: round2(shippingAED),
    paymentFeesAED: round2(paymentFeesAED),
    otherIncludedCostsAED: round2(otherIncludedCostsAED),
    couponDiscountAED: round2(couponDiscountAED),
    smilePointsAED: round2(smilePointsAED),
    generalEcommerceCostsAED: general,
    totalIncludedCostsAED,
    costPercentage,
    balanceAED: round2(salesAmountAED - totalIncludedCostsAED),
  }
}

module.exports = {
  computeChannelFinancials,
  computeOverallTotals,
}
