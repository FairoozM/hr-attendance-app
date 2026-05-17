const {
  DEFAULT_RATES,
  buildPurchasePriceMap,
  findPurchaseMatchForComponent,
  computeEcommercePriceRow,
  expandMatchCandidates,
  resolveCompositeComponentPricing,
} = require('../../../shared/compositeComponentPricingResolver.cjs')

function toDec(pct) {
  const n = Number(pct)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n)) / 100
}

function computeBundleEconomics(totalPurchaseCost, bundleShipping, rates = DEFAULT_RATES) {
  const vat = toDec(rates.vatPct)
  const commission = toDec(rates.commissionPct)
  const advertising = toDec(rates.advertisingPct)
  const requiredProfit = toDec(rates.requiredProfitPct)
  const denominator = 1 - vat - commission - advertising - requiredProfit
  if (denominator <= 0 || denominator >= 1) {
    return { ok: false, error: 'VAT + commission + advertising + required profit must stay below 100%.' }
  }
  const purchase = Number(totalPurchaseCost) || 0
  const shipping = Number(bundleShipping) || 0
  const rawSales = (purchase + shipping) / denominator
  let salesPrice = Math.ceil(rawSales - 1e-12)
  if (!Number.isFinite(salesPrice) || salesPrice < 0) salesPrice = 0

  for (let guard = 0; guard < 500000; guard += 1) {
    const vatAmount = salesPrice * vat
    const commissionAmount = salesPrice * commission
    const advertisingAmount = salesPrice * advertising
    const totalCost = purchase + vatAmount + commissionAmount + advertisingAmount + shipping
    const profit = salesPrice - totalCost
    const profitPct = salesPrice > 0 ? (profit / salesPrice) * 100 : profit >= 0 ? 100 : 0
    if (profitPct + 1e-9 >= (Number(rates.requiredProfitPct) || DEFAULT_RATES.requiredProfitPct)) {
      return {
        ok: true,
        salesPrice,
        vatAmount,
        commissionAmount,
        advertisingAmount,
        shipping,
        totalCost,
        profit,
        profitPct,
      }
    }
    salesPrice += 1
  }
  return { ok: false, error: 'Could not reach minimum profit % — check amounts and rates.' }
}

module.exports = {
  DEFAULT_RATES,
  buildPurchasePriceMap,
  findPurchaseMatchForComponent,
  computeBundleEconomics,
  computeAllPricesRowEconomics: computeEcommercePriceRow,
  computeEcommercePriceRow,
  expandMatchCandidates,
  resolveCompositeComponentPricing,
}
