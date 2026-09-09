'use strict'

/**
 * Daily Ecommerce Report orchestrator.
 *
 * Loads each channel independently so one provider failure cannot blank the report.
 * UAE calendar day (Asia/Dubai) is the reporting boundary for all channels.
 */

const { assertYmd, dubaiDayBounds, todayUaeYmd } = require('./dateBounds')
const { getSarToAedRate } = require('./money')
const { computeOverallTotals } = require('./formulas')
const { CHANNELS } = require('./channels')
const { loadAmazonChannel } = require('./providers/amazonOrdersProvider')
const { loadAmazonAds } = require('./providers/amazonAdsProvider')
const { loadWebsiteChannel, loadShopChannel } = require('./providers/websiteOrdersProvider')
const {
  loadNoonChannel,
  loadCarrefourChannel,
  loadMetaAds,
  loadNoonAds,
} = require('./providers/stubProviders')

/**
 * @param {PromiseSettledResult<any>} settled
 * @param {string} label
 * @param {() => object} fallbackFactory
 */
function fromSettled(settled, label, fallbackFactory) {
  if (settled.status === 'fulfilled') return settled.value
  const err = settled.reason
  const channel = fallbackFactory()
  channel.integrationStatus = 'unavailable'
  channel.warnings = [
    ...(channel.warnings || []),
    `${label}: ${err && err.message ? err.message : String(err)}`,
  ]
  return channel
}

/**
 * @param {{ date?: string, includeLiveAds?: boolean }} opts
 */
async function buildDailyEcommerceReport(opts = {}) {
  const dateYmd = opts.date ? assertYmd(opts.date) : todayUaeYmd()
  const bounds = dubaiDayBounds(dateYmd)
  const fxInfo = getSarToAedRate()
  const fx = { rate: fxInfo.rate }
  const includeLiveAds = opts.includeLiveAds !== false

  const warnings = []
  if (fxInfo.warning) warnings.push(fxInfo.warning)

  // Ads providers (isolated)
  const [amazonUaeAdsSettled, amazonKsaAdsSettled, metaAdsSettled, noonAeAdsSettled, noonSaAdsSettled] =
    await Promise.allSettled([
      includeLiveAds
        ? loadAmazonAds('uae', dateYmd, fx)
        : Promise.resolve({
            adsStatus: 'not_configured',
            adsProvider: 'amazon_advertising_reporting_v3',
            adSpendAED: null,
            clicks: null,
            warnings: ['Amazon UAE Ads: skipped'],
            lastSyncedAt: null,
          }),
      includeLiveAds
        ? loadAmazonAds('ksa', dateYmd, fx)
        : Promise.resolve({
            adsStatus: 'not_configured',
            adsProvider: 'amazon_advertising_reporting_v3',
            adSpendAED: null,
            clicks: null,
            warnings: ['Amazon KSA Ads: skipped'],
            lastSyncedAt: null,
          }),
      loadMetaAds(dateYmd),
      loadNoonAds('AE', dateYmd),
      loadNoonAds('SA', dateYmd),
    ])

  const amazonUaeAds =
    amazonUaeAdsSettled.status === 'fulfilled'
      ? amazonUaeAdsSettled.value
      : {
          adsStatus: 'unavailable',
          adsProvider: 'amazon_advertising_reporting_v3',
          adSpendAED: null,
          clicks: null,
          warnings: ['Amazon UAE Ads: failed'],
          lastSyncedAt: null,
        }
  const amazonKsaAds =
    amazonKsaAdsSettled.status === 'fulfilled'
      ? amazonKsaAdsSettled.value
      : {
          adsStatus: 'unavailable',
          adsProvider: 'amazon_advertising_reporting_v3',
          adSpendAED: null,
          clicks: null,
          warnings: ['Amazon KSA Ads: failed'],
          lastSyncedAt: null,
        }
  const metaAds =
    metaAdsSettled.status === 'fulfilled'
      ? metaAdsSettled.value
      : {
          adsStatus: 'unavailable',
          adsProvider: 'meta_marketing_api',
          adSpendAED: null,
          clicks: null,
          adsMetricLabel: 'link_clicks',
          warnings: ['Meta Ads: failed'],
          lastSyncedAt: null,
        }

  void noonAeAdsSettled
  void noonSaAdsSettled

  const [
    amazonUaeSettled,
    amazonKsaSettled,
    websiteSettled,
    shopSettled,
  ] = await Promise.allSettled([
    loadAmazonChannel('uae', bounds, fx, amazonUaeAds),
    loadAmazonChannel('ksa', bounds, fx, amazonKsaAds),
    loadWebsiteChannel(bounds, metaAds),
    loadShopChannel(bounds, {
      adSpendAED: null,
      clicks: null,
      adsStatus: 'not_configured',
      adsProvider: null,
    }),
  ])

  const noonUae = loadNoonChannel('AE')
  const noonKsa = loadNoonChannel('SA')
  const carrefour = loadCarrefourChannel()

  const amazonUae = fromSettled(amazonUaeSettled, 'Amazon UAE', () =>
    loadAmazonChannelFallback('uae', amazonUaeAds),
  )
  const amazonKsa = fromSettled(amazonKsaSettled, 'Amazon KSA', () =>
    loadAmazonChannelFallback('ksa', amazonKsaAds),
  )
  const website = fromSettled(websiteSettled, 'Life Smile Website', () =>
    websiteFallback(metaAds),
  )
  const shop = fromSettled(shopSettled, 'Life Smile Shop', () => shopFallback())

  const channels = [amazonUae, amazonKsa, noonUae, noonKsa, website, shop, carrefour]

  for (const ch of channels) {
    for (const w of ch.warnings || []) warnings.push(w)
  }

  const incomplete =
    channels.some((c) => c.integrationStatus !== 'available') ||
    channels.some((c) => c.adsStatus === 'not_configured' || c.adsStatus === 'unavailable')

  if (incomplete) {
    warnings.unshift(
      'Report is incomplete: one or more channels or advertising integrations are not configured or unavailable. Totals use only available numeric values.',
    )
  }

  const totals = computeOverallTotals(
    channels.map((c) => c.summary),
    null, // General Ecommerce costs category does not exist yet
  )

  const sources = {
    amazon_orders_cache: {
      status: amazonUae.integrationStatus === 'available' || amazonKsa.integrationStatus === 'available'
        ? 'available'
        : amazonUae.integrationStatus,
      lastSyncedAt: maxIso(amazonUae.lastSyncedAt, amazonKsa.lastSyncedAt),
    },
    amazon_ads: {
      uae: { status: amazonUaeAds.adsStatus, lastSyncedAt: amazonUaeAds.lastSyncedAt },
      ksa: { status: amazonKsaAds.adsStatus, lastSyncedAt: amazonKsaAds.lastSyncedAt },
    },
    website_orders_db: {
      status: website.integrationStatus,
      lastSyncedAt: website.lastSyncedAt,
    },
    shop_orders_db: {
      status: shop.integrationStatus,
      lastSyncedAt: shop.lastSyncedAt,
    },
    noon_orders: { status: 'not_configured', lastSyncedAt: null },
    noon_ads: { status: 'not_configured', lastSyncedAt: null },
    meta_ads: { status: metaAds.adsStatus, lastSyncedAt: metaAds.lastSyncedAt },
    carrefour: { status: 'not_configured', lastSyncedAt: null },
  }

  return {
    date: dateYmd,
    timezone: bounds.timezone,
    dayBounds: {
      start: bounds.start.toISOString(),
      end: bounds.end.toISOString(),
    },
    exchangeRate: {
      from: 'SAR',
      to: 'AED',
      rate: fxInfo.rate,
      source: fxInfo.source,
      envVar: fxInfo.envVar,
      configured: fxInfo.configured,
    },
    channels,
    totals: {
      ...totals,
      generalEcommerceCostsAED: null,
      generalEcommerceCostsStatus: 'not_configured',
    },
    incomplete,
    warnings: dedupeWarnings(warnings),
    sources,
    channelOrder: CHANNELS.map((c) => c.key),
    generatedAt: new Date().toISOString(),
  }
}

function loadAmazonChannelFallback(marketplaceKey, ads) {
  const { buildChannelShell, CHANNELS: CH } = require('./channels')
  const meta = CH.find((c) => c.key === (marketplaceKey === 'ksa' ? 'amazon_ksa' : 'amazon_uae'))
  return buildChannelShell(meta, 'unavailable', {
    adsStatus: ads.adsStatus,
    adsProvider: ads.adsProvider,
    summary: {
      ...buildChannelShell(meta, 'unavailable').summary,
      adSpendAED: ads.adSpendAED,
      clicks: ads.clicks,
    },
  })
}

function websiteFallback(ads) {
  const { buildChannelShell, CHANNELS: CH } = require('./channels')
  const meta = CH.find((c) => c.key === 'website')
  return buildChannelShell(meta, 'unavailable', {
    adsStatus: ads.adsStatus,
    adsProvider: ads.adsProvider,
    summary: {
      ...buildChannelShell(meta, 'unavailable').summary,
      adSpendAED: ads.adSpendAED,
      clicks: ads.clicks,
    },
  })
}

function shopFallback() {
  const { buildChannelShell, CHANNELS: CH } = require('./channels')
  const meta = CH.find((c) => c.key === 'shop')
  return buildChannelShell(meta, 'unavailable')
}

function maxIso(a, b) {
  if (!a) return b || null
  if (!b) return a
  return Date.parse(a) >= Date.parse(b) ? a : b
}

function dedupeWarnings(list) {
  const seen = new Set()
  const out = []
  for (const w of list) {
    const s = String(w || '').trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

module.exports = {
  buildDailyEcommerceReport,
}
