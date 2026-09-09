'use strict'

/**
 * Stub / interface providers for channels and ads not yet integrated.
 *
 * - Noon UAE/KSA orders: no order feed in HR app (only settlement clearing + catalog snapshots)
 * - Noon Ads API: not integrated (advertising appears only as settlement statement fee lines)
 * - Meta/Facebook/Instagram Ads API: not integrated (Weekly Ads uses manual entry)
 * - Carrefour UAE: not integrated
 *
 * Each returns `not_configured` with null ads metrics so the report stays honest.
 */

const { buildChannelShell, CHANNELS, emptySummary } = require('../channels')

function notConfiguredAds(providerName, label) {
  return {
    adsStatus: 'not_configured',
    adsProvider: providerName,
    adSpendAED: null,
    clicks: null,
    adsMetricLabel: null,
    warnings: [`${label}: Not Configured`],
    lastSyncedAt: null,
  }
}

async function loadNoonAds(_marketplace /* 'AE' | 'SA' */, _dateYmd) {
  return notConfiguredAds('noon_ads_api', 'Noon Ads')
}

async function loadMetaAds(_dateYmd) {
  return {
    ...notConfiguredAds('meta_marketing_api', 'Meta Ads'),
    adsMetricLabel: 'link_clicks', // intended metric name when wired
  }
}

function loadNoonChannel(country /* 'AE' | 'SA' */) {
  const key = country === 'SA' ? 'noon_ksa' : 'noon_uae'
  const meta = CHANNELS.find((c) => c.key === key)
  return buildChannelShell(meta, 'not_configured', {
    adsStatus: 'not_configured',
    adsProvider: 'noon_ads_api',
    warnings: [
      `${meta.label}: order feed not integrated (Noon payment clearing is settlement-based, not a daily order source)`,
      `${meta.label} Ads: Not Configured`,
    ],
    summary: {
      ...emptySummary(),
      adSpendAED: null,
      clicks: null,
      costPercentage: 0,
      balanceAED: 0,
    },
  })
}

function loadCarrefourChannel() {
  const meta = CHANNELS.find((c) => c.key === 'carrefour_uae')
  return buildChannelShell(meta, 'not_configured', {
    adsStatus: 'not_configured',
    adsProvider: null,
    warnings: [`${meta.label}: Not Configured`],
    summary: {
      ...emptySummary(),
      adSpendAED: null,
      clicks: null,
    },
  })
}

module.exports = {
  loadNoonAds,
  loadMetaAds,
  loadNoonChannel,
  loadCarrefourChannel,
  notConfiguredAds,
}
