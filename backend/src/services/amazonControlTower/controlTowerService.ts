'use strict'

/**
 * Control Tower service: freshness, Command Center V0 and the process-wide runner wiring.
 * KSA only for now (UAE modules are untouched).
 */

const { FRESHNESS_SOURCES, classifyFreshness, laterOf } = require('./freshness.ts')
const { zonedDateString, addDays } = require('./controlTowerTime.ts')

const SUPPORTED_MARKETPLACES = ['ksa']
const TABLE_ROW_LIMIT = 200

function isSupportedMarketplace(mk: unknown): boolean {
  return SUPPORTED_MARKETPLACES.includes(String(mk || '').toLowerCase())
}

type ServiceDeps = {
  store: any
  refreshStore: any
  now?: () => Date
}

function createControlTowerService({ store, refreshStore, now = () => new Date() }: ServiceDeps) {
  async function computeFreshness(marketplaceKey: string) {
    const current = now()
    const summaries = await refreshStore.summarizeJobRuns(
      marketplaceKey,
      FRESHNESS_SOURCES.map((s: any) => s.jobType)
    )
    const byJob = new Map<string, any>(summaries.map((s: any) => [s.jobType, s]))
    const orderSync = await store.lastOrderReportSync(marketplaceKey)

    const sources = FRESHNESS_SOURCES.map((def: any) => {
      const s = byJob.get(def.jobType) || { lastSuccessAt: null, lastFailureAt: null, lastError: null, activeRun: null }
      let lastSuccessAt = s.lastSuccessAt
      let lastFailureAt = s.lastFailureAt
      let lastError = s.lastError
      if (def.key === 'orders') {
        // Order lines are also refreshed by other modules (daily ecommerce report) via the same sync log.
        lastSuccessAt = laterOf(lastSuccessAt, orderSync.lastSuccessAt)
        const failure = laterOf(lastFailureAt, orderSync.lastFailureAt)
        if (failure && failure === orderSync.lastFailureAt && failure !== lastFailureAt) lastError = orderSync.lastError
        lastFailureAt = failure
      }
      const result = classifyFreshness({
        lastSuccessAt,
        lastFailureAt,
        lastError,
        now: current,
        warnAfterMs: def.warnAfterMs,
        staleAfterMs: def.staleAfterMs,
      })
      const run = s.activeRun
      return {
        key: def.key,
        label: def.label,
        jobType: def.jobType,
        ...result,
        warnAfterMs: def.warnAfterMs,
        staleAfterMs: def.staleAfterMs,
        currentRun: run
          ? { id: run.id, status: run.status, currentStep: run.currentStep, startedAt: run.startedAt, queuedAt: run.queuedAt }
          : null,
      }
    })
    return { marketplaceKey, generatedAt: current.toISOString(), sources }
  }

  async function getCommandCenter(marketplaceKey: string) {
    const settings = await store.getSettings(marketplaceKey)
    if (!settings) {
      const err: any = new Error(`Control Tower is not configured for "${marketplaceKey}"`)
      err.status = 404
      throw err
    }
    const current = now()
    const today = zonedDateString(current, settings.timezone)
    const yesterday = addDays(today, -1)
    const from7 = addDays(today, -6)
    const from30 = addDays(today, -29)

    const freshness = await computeFreshness(marketplaceKey)
    const rollupEverSucceeded = freshness.sources.some((s: any) => s.key === 'daily_sales' && s.lastSuccessAt)

    const [todayTotals, yesterdayTotals, last7, last30] = await Promise.all([
      store.salesTotals(marketplaceKey, today, today),
      store.salesTotals(marketplaceKey, yesterday, yesterday),
      store.salesTotals(marketplaceKey, from7, today),
      store.salesTotals(marketplaceKey, from30, today),
    ])
    const inventorySnapshotAt = await store.latestInventorySnapshotAt(marketplaceKey)
    const warehouseSnapshotAt = await store.latestWarehouseSnapshotAt()
    const inv = inventorySnapshotAt ? await store.inventoryTotals(marketplaceKey) : null
    const skus = await store.skuStockView(marketplaceKey, { from7, from30, toDate: today })

    const threshold = settings.lowStockUnitsThreshold
    const active = skus.filter((s: any) => s.active)
    const outOfStock = active
      .filter((s: any) => s.hasInventorySnapshot && s.fbaFulfillable === 0)
      .sort((a: any, b: any) => b.units30d - a.units30d || a.sellerSku.localeCompare(b.sellerSku))
    const lowStock = active
      .filter((s: any) => s.fbaFulfillable != null && s.fbaFulfillable > 0 && s.fbaFulfillable <= threshold)
      .sort((a: any, b: any) => a.fbaFulfillable - b.fbaFulfillable || b.units30d - a.units30d)
    const unmapped = active
      .filter((s: any) => s.mappingStatus === 'UNMAPPED' || s.mappingStatus === 'REVIEW_REQUIRED')
      .sort((a: any, b: any) => b.units30d - a.units30d || a.sellerSku.localeCompare(b.sellerSku))
    const activeWithoutFba = active.filter((s: any) => !s.hasInventorySnapshot).length

    const money = (t: any) => (rollupEverSucceeded ? t.netSalesExVat : null)
    const stockRow = (s: any) => ({
      id: s.id,
      sellerSku: s.sellerSku,
      asin: s.asin,
      title: s.title,
      fbaFulfillable: s.fbaFulfillable,
      inbound: s.inbound,
      warehouseAvailable: s.warehouseAvailable,
      mappingStatus: s.mappingStatus,
      units7d: s.units7d,
      units30d: s.units30d,
    })
    const unmappedRow = (s: any) => {
      const top = s.mappingCandidates[0] || null
      return {
        id: s.id,
        sellerSku: s.sellerSku,
        asin: s.asin,
        title: s.title,
        potentialMatch: top ? { zohoItemId: top.zohoItemId, itemCode: top.itemCode, itemName: top.itemName, method: top.method } : null,
        candidateCount: s.mappingCandidates.length,
        confidence: s.mappingConfidence,
        mappingStatus: s.mappingStatus,
        units30d: s.units30d,
      }
    }

    return {
      marketplaceKey,
      currency: marketplaceKey === 'ksa' ? 'SAR' : 'AED',
      timezone: settings.timezone,
      today,
      generatedAt: current.toISOString(),
      settings,
      salesBasis: 'Net item sales excluding VAT (order report item-price minus promotions; shipping excluded).',
      salesProvisional: true,
      salesCaveat:
        'Provisional: order-date basis from the order report (pending prices may be blank, later refunds/returns are not deducted). VAT is removed at the configured rate when the report price includes it; not yet reconciled against settlements.',
      inventorySource: {
        source: 'FBA Inventory API (getInventorySummaries)',
        fulfillmentModel: 'UNVERIFIED',
        caveat:
          'KSA fulfillment model (classic FBA vs Seller Flex) is not verified. For Seller Flex SKUs this API can report 0 fulfillable while stock exists, so zero values may not mean out of stock.',
      },
      kpis: {
        todaySales: money(todayTotals),
        yesterdaySales: money(yesterdayTotals),
        last7DaysSales: money(last7),
        last30DaysSales: money(last30),
        unitsSold30d: rollupEverSucceeded ? last30.units : null,
        activeSkus: active.length,
        fbaFulfillableUnits: inv ? inv.fulfillable : null,
        inboundUnits: inv ? inv.inbound : null,
        reservedUnits: inv ? inv.reserved : null,
        unfulfillableUnits: inv ? inv.unfulfillable : null,
        outOfStockSkus: inventorySnapshotAt ? outOfStock.length : null,
        lowStockSkus: inventorySnapshotAt ? lowStock.length : null,
        unmappedSkus: unmapped.length,
        activeSkusWithoutFbaData: inventorySnapshotAt ? activeWithoutFba : null,
      },
      tables: {
        outOfStock: { total: outOfStock.length, rows: outOfStock.slice(0, TABLE_ROW_LIMIT).map(stockRow) },
        lowStock: { total: lowStock.length, threshold, rows: lowStock.slice(0, TABLE_ROW_LIMIT).map(stockRow) },
        unmapped: { total: unmapped.length, rows: unmapped.slice(0, TABLE_ROW_LIMIT).map(unmappedRow) },
      },
      snapshots: { inventorySnapshotAt, warehouseSnapshotAt },
      coverage: {
        orderLines: await store.orderLineCoverage(marketplaceKey),
        dailySales: await store.dailySalesCoverage(marketplaceKey),
      },
      freshness,
    }
  }

  return { computeFreshness, getCommandCenter }
}

let singleton: any = null

/** Process-wide wiring with the real DB, Amazon and Zoho modules (lazy so tests never load them). */
function getControlTower() {
  if (singleton) return singleton
  const db = require('../../db')
  const { createPgRefreshStore } = require('./refreshRunStore.ts')
  const { createControlTowerStore } = require('./controlTowerStore.ts')
  const { createRefreshRunner } = require('./refreshRunner.ts')
  const { createControlTowerJobs } = require('./controlTowerJobs.ts')
  const spApi = require('../amazonSpApiService')
  const listingsService = require('../amazonListingsInventoryReadService')
  const orderReport = require('../amazonOrderReportSyncService')
  const warehouseService = require('../zohoLifeSmileWarehouseService')
  const zohoAdapter = require('../../integrations/zoho/zohoAdapter')

  const refreshStore = createPgRefreshStore(db)
  const store = createControlTowerStore(db)
  const service = createControlTowerService({ store, refreshStore })
  const jobs = createControlTowerJobs({
    store,
    amazon: {
      fetchActiveAmazonListings: listingsService.fetchActiveAmazonListings,
      getAmazonFbaInventorySummaries: spApi.getAmazonFbaInventorySummaries,
      throwAmazonSpApiIfFailed: spApi.throwAmazonSpApiIfFailed,
      marketplaceIdForKey: spApi.marketplaceIdForKey,
    },
    orders: {
      syncAmazonOrderReport: orderReport.syncAmazonOrderReport,
      findSuccessfulReportRunCoveringRange: orderReport.findSuccessfulReportRunCoveringRange,
    },
    zoho: {
      resolveLifeSmileWarehouse: warehouseService.resolveLifeSmileWarehouse,
      fetchItemsRawForWarehouse: (warehouseId: string) => zohoAdapter.fetchItemsRawForWarehouse(warehouseId, { skipCache: true }),
    },
  })
  const runner = createRefreshRunner({
    store: refreshStore,
    handlers: jobs.handlers,
    computeFreshness: service.computeFreshness,
  })
  singleton = { db, refreshStore, store, service, jobs, runner }
  return singleton
}

module.exports = {
  SUPPORTED_MARKETPLACES,
  isSupportedMarketplace,
  createControlTowerService,
  getControlTower,
}
