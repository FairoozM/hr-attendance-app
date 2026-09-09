'use strict'

/**
 * Channel constants for Daily Ecommerce Report (five sections).
 *
 * Every channel is fed by its own marketplace/website integration:
 *   amazon_uae / amazon_ksa → Amazon SP-API orders cache
 *   noon_uae / noon_ksa     → Noon Partner API orders and finance exports
 *   life_smile              → Life Smile website database (website + app + shop)
 *
 * Accounting systems are never a source for this report.
 *
 * A channel that could not be read carries null money, not zero: a zero would be a claim that
 * nothing was sold, and totals must not absorb a figure the integration never provided.
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

/** Statuses that mean "this integration produced no figures", as opposed to "it produced zero". */
const UNREADABLE_STATUSES = new Set(['not_configured', 'unavailable', 'pending'])

function emptySummary(family = 'amazon', integrationStatus = 'available') {
  const unreadable = UNREADABLE_STATUSES.has(integrationStatus)
  const zeroOrNull = unreadable ? null : 0
  const base = {
    quantity: zeroOrNull,
    salesAmountAED: zeroOrNull,
    adSpendAED: null,
    clicks: null,
    commissionAED: zeroOrNull,
    shippingAED: zeroOrNull,
    costPercentage: zeroOrNull,
    balanceAED: zeroOrNull,
  }
  if (family === 'life_smile') {
    return {
      ...base,
      tabbyTamaraCommissionAED: zeroOrNull,
      smilePointCouponAED: zeroOrNull,
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
    summary: emptySummary(meta.family, integrationStatus),
    adsStatus: 'not_configured',
    adsProvider: null,
    warnings: [],
    ...overrides,
  }
}

module.exports = {
  CHANNELS,
  UNREADABLE_STATUSES,
  channelMeta,
  emptySummary,
  buildChannelShell,
}
