'use strict'

/**
 * Daily Ecommerce Report orchestrator — six channels from Zoho Books invoices
 * (Amazon / Noon / Carrefour) + Life Smile website DB (website + shop combined).
 */

const { assertYmd, dubaiDayBounds, todayUaeYmd } = require('./dateBounds')
const { getSarToAedRate } = require('./money')
const { computeOverallTotals } = require('./formulas')
const { CHANNELS, buildChannelShell } = require('./channels')
const { loadZohoInvoicesByChannel } = require('./providers/zohoDailyInvoicesProvider')
const { buildMarketplaceChannel } = require('./providers/marketplaceChannelBuilder')
const { loadLifeSmileChannel } = require('./providers/lifeSmileProvider')
const { loadAmazonAds } = require('./providers/amazonAdsProvider')

function adsStub(label, provider = null) {
  return {
    adsStatus: 'not_configured',
    adsProvider: provider,
    adSpendAED: null,
    clicks: null,
    adsMetricLabel: label === 'Meta' ? 'link_clicks' : null,
    warnings: [],
  }
}

/**
 * @param {{ date?: string, includeLiveAds?: boolean }} opts
 */
async function buildDailyEcommerceReport(opts = {}) {
  const dateYmd = opts.date ? assertYmd(opts.date) : todayUaeYmd()
  const bounds = dubaiDayBounds(dateYmd)
  const fxInfo = getSarToAedRate()
  const fx = { rate: fxInfo.rate }
  const warnings = []
  if (fxInfo.warning) warnings.push(fxInfo.warning)

  // Ads: Amazon may be configured later; Meta/Noon/Carrefour ads have no daily API in this app
  const amazonUaeAds = opts.includeLiveAds !== false
    ? await loadAmazonAds('uae', dateYmd, fx).catch(() => adsStub('Amazon UAE Ads', 'amazon_advertising_reporting_v3'))
    : { ...adsStub('Amazon UAE Ads', 'amazon_advertising_reporting_v3'), adsStatus: 'not_configured' }
  const amazonKsaAds = opts.includeLiveAds !== false
    ? await loadAmazonAds('ksa', dateYmd, fx).catch(() => adsStub('Amazon KSA Ads', 'amazon_advertising_reporting_v3'))
    : { ...adsStub('Amazon KSA Ads', 'amazon_advertising_reporting_v3'), adsStatus: 'not_configured' }

  // Force Amazon ads display semantics: incomplete config → not_configured (null, not 0)
  for (const a of [amazonUaeAds, amazonKsaAds]) {
    if (a.adsStatus === 'not_configured') {
      a.adSpendAED = null
      a.clicks = null
    }
  }

  const metaAds = {
    ...adsStub('Meta', 'meta_marketing_api'),
    adsStatus: 'not_configured',
    adsMetricLabel: 'link_clicks',
  }
  const noonAds = adsStub('Noon Ads', 'noon_statement_fees')
  const carrefourAds = adsStub('Carrefour Ads', null)

  /** @type {Record<string, object[]>} */
  let byChannel = {
    amazon_uae: [],
    amazon_ksa: [],
    noon_uae: [],
    noon_ksa: [],
    carrefour_uae: [],
  }
  let zohoWarnings = []
  let zohoFailed = false
  let zohoErrorMessage = ''

  try {
    const loaded = await loadZohoInvoicesByChannel(dateYmd)
    byChannel = loaded.byChannel
    zohoWarnings = loaded.warnings || []
  } catch (err) {
    zohoFailed = true
    zohoErrorMessage = err && err.message ? err.message : String(err)
    warnings.push(`Zoho Books invoice load failed: ${zohoErrorMessage}`)
  }

  async function marketplace(key, ads) {
    if (zohoFailed) {
      return buildChannelShell(
        CHANNELS.find((c) => c.key === key),
        'unavailable',
        {
          adsStatus: ads.adsStatus,
          adsProvider: ads.adsProvider,
          warnings: [`${CHANNELS.find((c) => c.key === key).label}: Data Error — ${zohoErrorMessage}`],
          summary: {
            ...buildChannelShell(CHANNELS.find((c) => c.key === key), 'unavailable').summary,
            adSpendAED: ads.adSpendAED,
            clicks: ads.clicks,
          },
        },
      )
    }
    try {
      return await buildMarketplaceChannel(key, byChannel[key] || [], fx, ads, zohoWarnings)
    } catch (err) {
      return buildChannelShell(
        CHANNELS.find((c) => c.key === key),
        'unavailable',
        {
          adsStatus: ads.adsStatus,
          adsProvider: ads.adsProvider,
          warnings: [
            `${CHANNELS.find((c) => c.key === key).label}: Data Error — ${err.message || String(err)}`,
          ],
          summary: {
            ...buildChannelShell(CHANNELS.find((c) => c.key === key), 'unavailable').summary,
            adSpendAED: ads.adSpendAED,
            clicks: ads.clicks,
          },
        },
      )
    }
  }

  const [amazonUae, amazonKsa, noonUae, noonKsa, carrefour, lifeSmile] = await Promise.all([
    marketplace('amazon_uae', amazonUaeAds),
    marketplace('amazon_ksa', amazonKsaAds),
    marketplace('noon_uae', noonAds),
    marketplace('noon_ksa', noonAds),
    marketplace('carrefour_uae', carrefourAds),
    loadLifeSmileChannel(bounds, metaAds, {
      websiteInvoices: byChannel.life_smile_website || [],
      shopInvoices: byChannel.life_smile_shop || [],
    }).catch((err) =>
      buildChannelShell(CHANNELS.find((c) => c.key === 'life_smile'), 'unavailable', {
        warnings: [`Life Smile Website: Data Error — ${err.message || String(err)}`],
        adsStatus: metaAds.adsStatus,
        adsProvider: metaAds.adsProvider,
      }),
    ),
  ])

  // Attach ads not_configured footnotes without failing channels
  if (amazonUaeAds.adsStatus === 'not_configured') {
    amazonUae.warnings = [
      ...(amazonUae.warnings || []),
      'Amazon advertising is excluded from costs because it is not integrated.',
    ]
  }
  if (amazonKsaAds.adsStatus === 'not_configured') {
    amazonKsa.warnings = [
      ...(amazonKsa.warnings || []),
      'Amazon advertising is excluded from costs because it is not integrated.',
    ]
  }
  if (metaAds.adsStatus === 'not_configured') {
    lifeSmile.warnings = [
      ...(lifeSmile.warnings || []),
      'FB/Instagram Ads: Not Configured (no Meta Marketing API in this application).',
    ]
  }

  const channels = [amazonUae, amazonKsa, noonUae, noonKsa, lifeSmile, carrefour]

  for (const ch of channels) {
    for (const w of ch.warnings || []) warnings.push(w)
  }

  // Incomplete only when a required order source failed — NOT because Amazon Ads is missing
  const incomplete = channels.some((c) => c.integrationStatus === 'unavailable')
  if (incomplete) {
    warnings.unshift(
      'Report incomplete: one or more order data sources returned a Data Error. Totals use available channels only.',
    )
  }

  const totals = computeOverallTotals(
    channels.map((c) => c.summary),
    null,
  )

  const deduped = []
  const seen = new Set()
  for (const w of warnings) {
    const s = String(w || '').trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    deduped.push(s)
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
      rateDisplay: Number(fxInfo.rate).toFixed(4),
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
    amazonAdsExcluded: amazonUaeAds.adsStatus === 'not_configured' || amazonKsaAds.adsStatus === 'not_configured',
    warnings: deduped,
    sources: {
      zoho_books_invoices: {
        status: zohoFailed ? 'unavailable' : 'available',
        lastSyncedAt: zohoFailed ? null : new Date().toISOString(),
      },
      website_orders_db: {
        status: lifeSmile.integrationStatus,
        lastSyncedAt: lifeSmile.lastSyncedAt,
      },
      amazon_ads: {
        uae: amazonUaeAds.adsStatus,
        ksa: amazonKsaAds.adsStatus,
      },
      meta_ads: metaAds.adsStatus,
      noon_ads: 'not_configured',
    },
    generatedAt: new Date().toISOString(),
  }
}

module.exports = {
  buildDailyEcommerceReport,
}
