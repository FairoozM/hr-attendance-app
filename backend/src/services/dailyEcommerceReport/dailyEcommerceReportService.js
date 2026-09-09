'use strict'

/**
 * Daily Ecommerce Report orchestrator — five channels, each from its own
 * marketplace / website integration:
 *
 *   Amazon SP-API   → amazon_orders / amazon_order_items → Amazon UAE, Amazon KSA
 *   Noon statements → noon_payment_clearing_*            → Noon UAE, Noon KSA
 *   Website DB      → orders / cart_items                → Life Smile (web + app + shop)
 *
 * No accounting system (invoices, ledgers, bookkeeping contacts) is read here,
 * and no channel falls back to one. A failing channel never blocks the others.
 */

const { assertYmd, dubaiDayBounds, todayUaeYmd } = require('./dateBounds')
const { getSarToAedRate } = require('./money')
const { computeOverallTotals } = require('./formulas')
const { CHANNELS, channelMeta, buildChannelShell } = require('./channels')
const { loadAmazonChannel } = require('./providers/amazonOrdersProvider')
const { loadNoonChannel } = require('./providers/noonOrdersProvider')
const { loadLifeSmileChannel } = require('./providers/lifeSmileProvider')
const { loadAmazonAds } = require('./providers/amazonAdsProvider')

/** Advertising sources that have no daily API in this application. */
function adsNotConfigured(provider, metricLabel = null) {
  return {
    adsStatus: 'not_configured',
    adsProvider: provider,
    adSpendAED: null,
    clicks: null,
    adsMetricLabel: metricLabel,
  }
}

function channelFailure(key, ads, err) {
  const meta = channelMeta(key)
  const message = err && err.message ? err.message : String(err)
  console.error(`[dailyEcommerceReport] ${meta.label} provider threw:`, err)
  return buildChannelShell(meta, 'unavailable', {
    adsStatus: ads.adsStatus,
    adsProvider: ads.adsProvider,
    warnings: [`${meta.label}: Data Error — ${message}`],
    errorDetail: message,
    summary: {
      ...buildChannelShell(meta, 'unavailable').summary,
      adSpendAED: ads.adSpendAED,
      clicks: ads.clicks,
      commissionAED: null,
      shippingAED: null,
    },
  })
}

async function settleChannel(key, ads, loader) {
  try {
    return await loader()
  } catch (err) {
    return channelFailure(key, ads, err)
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

  const wantLiveAds = opts.includeLiveAds !== false
  const [amazonUaeAds, amazonKsaAds] = await Promise.all(
    ['uae', 'ksa'].map(async (mk) => {
      const fallback = adsNotConfigured('amazon_advertising_reporting_v3')
      if (!wantLiveAds) return fallback
      try {
        const live = await loadAmazonAds(mk, dateYmd, fx)
        if (live.adsStatus !== 'available') {
          return { ...fallback, adsStatus: live.adsStatus === 'unavailable' ? 'unavailable' : 'not_configured' }
        }
        return live
      } catch (err) {
        console.error(`[dailyEcommerceReport] Amazon ${mk} ads lookup failed:`, err)
        return fallback
      }
    }),
  )

  const metaAds = adsNotConfigured('meta_marketing_api', 'link_clicks')
  const noonAds = adsNotConfigured('noon_ads_api')

  const [amazonUae, amazonKsa, noonUae, noonKsa, lifeSmile] = await Promise.all([
    settleChannel('amazon_uae', amazonUaeAds, () =>
      loadAmazonChannel('uae', bounds, fx, amazonUaeAds),
    ),
    settleChannel('amazon_ksa', amazonKsaAds, () =>
      loadAmazonChannel('ksa', bounds, fx, amazonKsaAds),
    ),
    settleChannel('noon_uae', noonAds, () => loadNoonChannel('noon_uae', bounds, fx, noonAds)),
    settleChannel('noon_ksa', noonAds, () => loadNoonChannel('noon_ksa', bounds, fx, noonAds)),
    settleChannel('life_smile', metaAds, () => loadLifeSmileChannel(bounds, metaAds)),
  ])

  const channels = [amazonUae, amazonKsa, noonUae, noonKsa, lifeSmile]

  const amazonAdsExcluded =
    amazonUaeAds.adsStatus !== 'available' || amazonKsaAds.adsStatus !== 'available'
  if (amazonAdsExcluded) {
    warnings.push('Amazon advertising is excluded from costs because it is not integrated.')
  }
  warnings.push(
    'FB/Instagram Ads: Not Configured — this application has no Meta Marketing API integration, so website ad spend and clicks are not available.',
  )
  warnings.push(
    'Noon Ads: Not Configured — Noon exposes advertising only as settlement fee lines, not as a daily spend/clicks API.',
  )

  for (const ch of channels) {
    for (const w of ch.warnings || []) warnings.push(w)
  }

  // Incomplete only when an order source errored — not when ads are missing
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
    channelKeys: CHANNELS.map((c) => c.key),
    channels,
    totals: {
      ...totals,
      generalEcommerceCostsAED: null,
      generalEcommerceCostsStatus: 'not_configured',
    },
    incomplete,
    amazonAdsExcluded,
    warnings: deduped,
    sources: {
      amazon_uae: {
        api: 'Amazon SP-API Orders v0',
        table: 'amazon_orders + amazon_order_items',
        status: amazonUae.integrationStatus,
        lastSyncedAt: amazonUae.lastSyncedAt,
      },
      amazon_ksa: {
        api: 'Amazon SP-API Orders v0',
        table: 'amazon_orders + amazon_order_items',
        status: amazonKsa.integrationStatus,
        lastSyncedAt: amazonKsa.lastSyncedAt,
      },
      noon_uae: {
        api: 'Noon partner settlement statements',
        table: 'noon_payment_clearing_rows + noon_payment_clearing_batches',
        status: noonUae.integrationStatus,
        statementCoverage: noonUae.statementCoverage || null,
      },
      noon_ksa: {
        api: 'Noon partner settlement statements',
        table: 'noon_payment_clearing_rows + noon_payment_clearing_batches',
        status: noonKsa.integrationStatus,
        statementCoverage: noonKsa.statementCoverage || null,
      },
      life_smile: {
        api: 'Life Smile website platform (read-only orders database)',
        table: 'orders + cart_items',
        status: lifeSmile.integrationStatus,
        errorDetail: lifeSmile.errorDetail || null,
      },
      amazon_ads: { uae: amazonUaeAds.adsStatus, ksa: amazonKsaAds.adsStatus },
      meta_ads: metaAds.adsStatus,
      noon_ads: noonAds.adsStatus,
    },
    generatedAt: new Date().toISOString(),
  }
}

module.exports = {
  buildDailyEcommerceReport,
}
