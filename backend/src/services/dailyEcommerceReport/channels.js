'use strict'

/**
 * Channel constants and empty channel factory for Daily Ecommerce Report.
 */

/** @typedef {'available'|'not_configured'|'unavailable'|'pending'} IntegrationStatus */

const CHANNELS = [
  {
    key: 'amazon_uae',
    label: 'Amazon UAE',
    country: 'AE',
    currency: 'AED',
  },
  {
    key: 'amazon_ksa',
    label: 'Amazon KSA',
    country: 'SA',
    currency: 'SAR',
  },
  {
    key: 'noon_uae',
    label: 'Noon UAE',
    country: 'AE',
    currency: 'AED',
  },
  {
    key: 'noon_ksa',
    label: 'Noon KSA',
    country: 'SA',
    currency: 'SAR',
  },
  {
    key: 'website',
    label: 'Life Smile Website',
    country: 'AE',
    currency: 'AED',
  },
  {
    key: 'shop',
    label: 'Life Smile Shop',
    country: 'AE',
    currency: 'AED',
  },
  {
    key: 'carrefour_uae',
    label: 'Carrefour UAE',
    country: 'AE',
    currency: 'AED',
  },
]

function emptySummary() {
  return {
    orderCount: 0,
    quantity: 0,
    salesAmountAED: 0,
    adSpendAED: null,
    clicks: null,
    commissionAED: 0,
    shippingAED: 0,
    paymentFeesAED: 0,
    otherIncludedCostsAED: 0,
    couponDiscountAED: 0,
    smilePointsAED: 0,
    totalIncludedCostsAED: 0,
    costPercentage: 0,
    balanceAED: 0,
  }
}

/**
 * @param {typeof CHANNELS[number]} meta
 * @param {IntegrationStatus} integrationStatus
 * @param {object} [overrides]
 */
function buildChannelShell(meta, integrationStatus, overrides = {}) {
  return {
    channel: meta.key,
    label: meta.label,
    country: meta.country,
    currency: meta.currency,
    integrationStatus,
    lastSyncedAt: null,
    orders: [],
    summary: emptySummary(),
    adsStatus: 'not_configured',
    adsProvider: null,
    warnings: [],
    ...overrides,
  }
}

module.exports = {
  CHANNELS,
  emptySummary,
  buildChannelShell,
}
