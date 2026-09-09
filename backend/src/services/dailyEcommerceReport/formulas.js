'use strict'

/**
 * Channel Costs = Ads + Commission + Shipping (+ Tabby/Tamara for Life Smile)
 * Cost % = Costs / Amount × 100  (0 when amount is 0)
 * Balance = Amount − Costs
 *
 * A null cost means "not available from that marketplace's own data" and is
 * excluded from the calculation — never treated as a known zero.
 * Smile Points / coupons are informational and never included in costs.
 */

const { round2 } = require('./money')

function numericOrNull(value) {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? round2(n) : null
}

function computeChannelFinancials({
  salesAmountAED,
  adSpendAED,
  commissionAED,
  shippingAED,
  tabbyTamaraCommissionAED = 0,
}) {
  const sales = round2(salesAmountAED || 0)
  const ads = numericOrNull(adSpendAED)
  const commission = numericOrNull(commissionAED)
  const shipping = numericOrNull(shippingAED)
  const tabby = numericOrNull(tabbyTamaraCommissionAED)

  let totalIncludedCostsAED = 0
  for (const cost of [ads, commission, shipping, tabby]) {
    if (cost != null) totalIncludedCostsAED = round2(totalIncludedCostsAED + cost)
  }

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
  const adValues = []
  const clickValues = []
  const commissionValues = []
  const shippingValues = []

  for (const s of channels) {
    if (!s) continue
    quantity += Number(s.quantity) || 0
    salesAmountAED += Number(s.salesAmountAED) || 0
    for (const [value, bucket] of [
      [s.adSpendAED, adValues],
      [s.clicks, clickValues],
      [s.commissionAED, commissionValues],
      [s.tabbyTamaraCommissionAED, commissionValues],
      [s.shippingAED, shippingValues],
    ]) {
      if (value != null && Number.isFinite(Number(value))) bucket.push(Number(value))
    }
  }

  const sumOrNull = (values, rounder = round2) =>
    values.length ? rounder(values.reduce((a, b) => a + b, 0)) : null

  const adSpendAED = sumOrNull(adValues)
  const clicks = sumOrNull(clickValues, Math.round)
  const commissionAED = sumOrNull(commissionValues)
  const shippingAED = sumOrNull(shippingValues)

  const general =
    generalEcommerceCostsAED == null || !Number.isFinite(Number(generalEcommerceCostsAED))
      ? null
      : round2(generalEcommerceCostsAED)

  salesAmountAED = round2(salesAmountAED)

  let totalIncludedCostsAED = 0
  for (const cost of [adSpendAED, commissionAED, shippingAED, general]) {
    if (cost != null) totalIncludedCostsAED = round2(totalIncludedCostsAED + cost)
  }

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
