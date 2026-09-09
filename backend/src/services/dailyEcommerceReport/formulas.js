'use strict'

/**
 * Channel Costs = Ads (if numeric) + Commission + Shipping
 *   (+ Tabby/Tamara for Life Smile when numeric)
 * Cost % = Costs / Amount × 100  (0 when amount is 0)
 * Balance = Amount − Costs
 *
 * Null ads are excluded from costs (never treated as a known zero).
 * Smile Points / coupons are informational and never included in costs.
 */

const { round2 } = require('./money')

function computeChannelFinancials({
  salesAmountAED,
  adSpendAED,
  commissionAED,
  shippingAED,
  tabbyTamaraCommissionAED = 0,
}) {
  const sales = round2(salesAmountAED || 0)
  const commission = round2(commissionAED || 0)
  const shipping = round2(shippingAED || 0)
  const tabby = round2(tabbyTamaraCommissionAED || 0)
  const ads = adSpendAED == null || !Number.isFinite(Number(adSpendAED)) ? null : round2(adSpendAED)

  let totalIncludedCostsAED = round2(commission + shipping + tabby)
  if (ads != null) totalIncludedCostsAED = round2(totalIncludedCostsAED + ads)

  let costPercentage = 0
  if (sales > 0) {
    costPercentage = round2((totalIncludedCostsAED / sales) * 100)
  }

  return {
    totalIncludedCostsAED,
    costPercentage,
    balanceAED: round2(sales - totalIncludedCostsAED),
  }
}

function computeOverallTotals(channelSummaries, generalEcommerceCostsAED = null) {
  const channels = Array.isArray(channelSummaries) ? channelSummaries : []
  let quantity = 0
  let salesAmountAED = 0
  let commissionAED = 0
  let shippingAED = 0
  const adValues = []
  const clickValues = []

  for (const s of channels) {
    if (!s) continue
    quantity += Number(s.quantity) || 0
    salesAmountAED += Number(s.salesAmountAED) || 0
    commissionAED += Number(s.commissionAED) || 0
    commissionAED += Number(s.tabbyTamaraCommissionAED) || 0
    shippingAED += Number(s.shippingAED) || 0
    if (s.adSpendAED != null && Number.isFinite(Number(s.adSpendAED))) adValues.push(Number(s.adSpendAED))
    if (s.clicks != null && Number.isFinite(Number(s.clicks))) clickValues.push(Number(s.clicks))
  }

  const adSpendAED = adValues.length
    ? round2(adValues.reduce((a, b) => a + b, 0))
    : null
  const clicks = clickValues.length
    ? Math.round(clickValues.reduce((a, b) => a + b, 0))
    : null

  const general =
    generalEcommerceCostsAED == null || !Number.isFinite(Number(generalEcommerceCostsAED))
      ? null
      : round2(generalEcommerceCostsAED)

  salesAmountAED = round2(salesAmountAED)
  commissionAED = round2(commissionAED)
  shippingAED = round2(shippingAED)

  let totalIncludedCostsAED = round2(commissionAED + shippingAED)
  if (adSpendAED != null) totalIncludedCostsAED = round2(totalIncludedCostsAED + adSpendAED)
  if (general != null) totalIncludedCostsAED = round2(totalIncludedCostsAED + general)

  let costPercentage = 0
  if (salesAmountAED > 0) {
    costPercentage = round2((totalIncludedCostsAED / salesAmountAED) * 100)
  }

  return {
    quantity,
    salesAmountAED,
    adSpendAED,
    clicks,
    commissionAED,
    shippingAED,
    generalEcommerceCostsAED: general,
    generalEcommerceCostsStatus: general == null ? 'not_configured' : 'available',
    costPercentage,
    balanceAED: round2(salesAmountAED - totalIncludedCostsAED),
    totalIncludedCostsAED,
  }
}

module.exports = {
  computeChannelFinancials,
  computeOverallTotals,
}
