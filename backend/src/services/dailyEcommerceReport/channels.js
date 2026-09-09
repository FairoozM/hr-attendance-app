'use strict'

/**
 * Channel constants for Daily Ecommerce Report (five sections).
 *
 * Every channel is fed by its own marketplace/website integration:
 *   amazon_uae / amazon_ksa → Amazon SP-API orders cache
 *   noon_uae / noon_ksa     → Noon partner settlement data
 *   life_smile              → Life Smile website database (website + app + shop)
 *
 * Accounting systems are never a source for this report.
 */

const CHANNELS = [
  { key: 'amazon_uae', label: 'Amazon UAE', country: 'AE', currency: 'AED', family: 'amazon' },
  { key: 'amazon_ksa', label: 'Amazon KSA', country: 'SA', currency: 'SAR', family: 'amazon' },
  { key: 'noon_uae', label: 'Noon UAE', country: 'AE', currency: 'AED', family: 'noon' },
  { key: 'noon_ksa', label: 'Noon KSA', country: 'SA', currency: 'SAR', family: 'noon' },
  { key: 'life_smile', label: 'Life Smile Website', country: 'AE', currency: 'AED', family: 'life_smile' },
]

function channelMeta(key) {
  return CHANNELS.find((c) => c.key === key)
}

function emptySummary(family = 'amazon') {
  const base = {
    quantity: 0,
    salesAmountAED: 0,
    adSpendAED: null,
    clicks: null,
    commissionAED: 0,
    shippingAED: 0,
    costPercentage: 0,
    balanceAED: 0,
  }
  if (family === 'life_smile') {
    return {
      ...base,
      tabbyTamaraCommissionAED: 0,
      smilePointCouponAED: 0,
    }
  }
  return base
}

function buildChannelShell(meta, integrationStatus, overrides = {}) {
  return {
    channel: meta.key,
    label: meta.label,
    country: meta.country,
    currency: meta.currency,
    family: meta.family,
    integrationStatus,
    lastSyncedAt: null,
    orders: [],
    summary: emptySummary(meta.family),
    adsStatus: 'not_configured',
    adsProvider: null,
    warnings: [],
    ...overrides,
  }
}

module.exports = {
  CHANNELS,
  channelMeta,
  emptySummary,
  buildChannelShell,
}
