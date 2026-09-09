'use strict'

/**
 * Amazon Advertising provider for Daily Ecommerce Report.
 *
 * Reuses `amazonAdsConfigService` + `amazonAdvertisingService`.
 * When Ads credentials/profile are incomplete → status `not_configured`
 * (adSpend/clicks remain null — never a misleading zero).
 */

const { getAmazonAdsConfig } = require('../../amazonAdsConfigService')
const { fetchSponsoredProductsSpendSummary } = require('../../amazonAdvertisingService')
const { round2, toAed } = require('../money')

/**
 * @param {'uae'|'ksa'} marketplaceKey
 * @param {string} dateYmd
 * @param {{ rate: number }} fx
 * @returns {Promise<{
 *   adsStatus: 'available'|'not_configured'|'unavailable'|'pending',
 *   adsProvider: string|null,
 *   adSpendAED: number|null,
 *   clicks: number|null,
 *   warnings: string[],
 *   lastSyncedAt: string|null,
 * }>}
 */
async function loadAmazonAds(marketplaceKey, dateYmd, fx) {
  const label = marketplaceKey === 'ksa' ? 'Amazon KSA Ads' : 'Amazon UAE Ads'
  try {
    getAmazonAdsConfig(marketplaceKey, { requireProfile: true })
  } catch (err) {
    if (err && err.code === 'AMAZON_ADS_CONFIG_INCOMPLETE') {
      return {
        adsStatus: 'not_configured',
        adsProvider: 'amazon_advertising_reporting_v3',
        adSpendAED: null,
        clicks: null,
        warnings: [`${label}: Not Configured`],
        lastSyncedAt: null,
      }
    }
    return {
      adsStatus: 'unavailable',
      adsProvider: 'amazon_advertising_reporting_v3',
      adSpendAED: null,
      clicks: null,
      warnings: [`${label}: ${err.message || String(err)}`],
      lastSyncedAt: null,
    }
  }

  try {
    const result = await fetchSponsoredProductsSpendSummary(marketplaceKey, dateYmd, dateYmd)
    // Ads API returns marketplace currency (AED for UAE, SAR for KSA typically)
    const currency = marketplaceKey === 'ksa' ? 'SAR' : 'AED'
    return {
      adsStatus: 'available',
      adsProvider: 'amazon_advertising_reporting_v3',
      adSpendAED: toAed(result.cost, currency, fx),
      clicks: Math.round(Number(result.clicks) || 0),
      warnings: [],
      lastSyncedAt: new Date().toISOString(),
    }
  } catch (err) {
    return {
      adsStatus: 'unavailable',
      adsProvider: 'amazon_advertising_reporting_v3',
      adSpendAED: null,
      clicks: null,
      warnings: [`${label}: retrieval failed — ${err.message || String(err)}`],
      lastSyncedAt: null,
    }
  }
}

/**
 * Pure helper for tests / Excel: display label for ads cell.
 * @param {'available'|'not_configured'|'unavailable'|'pending'} status
 * @param {number|null} value
 * @param {'money'|'int'} kind
 */
function formatAdsDisplay(status, value, kind = 'money') {
  if (status === 'not_configured') return 'Not Configured'
  if (status === 'unavailable') return 'Unavailable'
  if (status === 'pending') return 'Pending'
  if (value == null) return 'Unavailable'
  if (kind === 'int') return String(Math.round(value))
  return round2(value)
}

module.exports = {
  loadAmazonAds,
  formatAdsDisplay,
}
