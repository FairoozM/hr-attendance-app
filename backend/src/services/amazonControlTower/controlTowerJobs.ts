'use strict'

/**
 * Control Tower refresh job handlers. Read-only toward Amazon and Zoho:
 *   listings        GET_MERCHANT_LISTINGS_DATA report (existing report flow, reuses recent reports)
 *   sales           order flat-file report for the last few local days (existing report flow)
 *   rollup          amazon_order_report_lines → amazon_sku_daily_sales (local DB only)
 *   fba_inventory   GET /fba/inventory/v1/summaries (paged, rate-limited by amazonRateLimitService)
 *   warehouse_stock Zoho Inventory items for the Life Smile warehouse (GET only)
 *   sales_backfill  order report in ≤30-day windows going back ~12 months; restartable, never deletes.
 *                   Stops where the `sales` lookback starts: the recent days belong to the live sync,
 *                   whose stale-row cleanup must not race a non-deleting backfill write.
 *
 * Every handler refuses marketplaces outside `supportedMarketplaces` (KSA only) before any call.
 */

const { zonedDateString, zonedDayStartUtc, addDays, daysBetween, hourBucket } = require('./controlTowerTime.ts')
const { parseFbaInventorySummary } = require('./fbaInventoryParser.ts')
const { parseWarehouseStockItem } = require('./warehouseStockParser.ts')
const { rollupDailySales } = require('./dailySalesRollup.ts')
const { buildZohoMatchIndex, matchAmazonSku } = require('./skuMatcher.ts')
const { MAX_SYNC_RANGE_DAYS } = require('../../config/amazonSpApiGuardrails')

const DEFAULT_SALES_LOOKBACK_DAYS = 3
const DEFAULT_ROLLUP_DAYS = 35
const ROLLUP_CHUNK_DAYS = 31
const MAX_FBA_PAGES = 1000
const REPORT_END_SAFETY_MS = 2 * 60_000
const BACKFILL_DEFAULT_DAYS = 365
const BACKFILL_MAX_DAYS = 730
const BACKFILL_MAX_WINDOW_DAYS = 30
const BACKFILL_REPORT_TIMEOUT_MS = 15 * 60_000
/** Amazon throttles createReport to roughly one per minute. */
const BACKFILL_CREATE_SPACING_MS = 65_000
const BACKFILL_EMPTY_WINDOWS_TO_STOP = 3

type Ctx = {
  run: { id: string }
  marketplaceKey: string
  params: Record<string, any>
  progress: (step: string, current?: number, total?: number) => void
  setRecords: (n: number) => void
}

type JobDeps = {
  store: any
  amazon: {
    fetchActiveAmazonListings: (p: any) => Promise<{ listings: any[]; fetchedAt: string }>
    getAmazonFbaInventorySummaries: (p: any) => Promise<any>
    throwAmazonSpApiIfFailed: (res: any, op: string, mk: string) => void
    marketplaceIdForKey: (mk: string) => string
  }
  orders: {
    syncAmazonOrderReport: (p: any) => Promise<any>
    findSuccessfulReportRunCoveringRange: (mk: string, start: Date, end: Date) => Promise<any>
  }
  zoho: {
    resolveLifeSmileWarehouse: () => Promise<{ warehouseId: string; warehouseName: string }>
    fetchItemsRawForWarehouse: (warehouseId: string) => Promise<any[]>
  }
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  backfillCreateSpacingMs?: number
  supportedMarketplaces?: string[]
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function inventorySummaryList(data: any): any[] {
  const payload = data?.payload || data
  const list = payload?.inventorySummaries || data?.inventorySummaries || []
  return Array.isArray(list) ? list : []
}

function nextTokenFromInventory(data: any): string | null {
  const payload = data?.payload || data
  return payload?.pagination?.nextToken || payload?.nextToken || data?.pagination?.nextToken || null
}

function createControlTowerJobs(deps: JobDeps) {
  const store = deps.store
  const now = deps.now || (() => new Date())
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const createSpacingMs = deps.backfillCreateSpacingMs ?? BACKFILL_CREATE_SPACING_MS
  const supportedMarketplaces = (deps.supportedMarketplaces || ['ksa']).map((m) => m.toLowerCase())

  function onlySupported(handler: (ctx: Ctx) => Promise<any>) {
    return async (ctx: Ctx) => {
      if (!supportedMarketplaces.includes(String(ctx.marketplaceKey || '').toLowerCase())) {
        const err: any = new Error(`Control Tower jobs are not enabled for marketplace "${ctx.marketplaceKey}"`)
        err.code = 'CONTROL_TOWER_UNSUPPORTED_MARKETPLACE'
        throw err
      }
      return handler(ctx)
    }
  }

  async function settingsFor(mk: string) {
    const settings = await store.getSettings(mk)
    if (!settings) {
      const err: any = new Error(`No Control Tower settings row for marketplace "${mk}"`)
      err.code = 'CONTROL_TOWER_SETTINGS_MISSING'
      throw err
    }
    return settings
  }

  /** Re-suggests Zoho items for SKUs without a human decision, using the latest warehouse snapshot. */
  async function runAutoMatch(mk: string) {
    const catalog = await store.latestWarehouseCatalog()
    if (!catalog.length) return { skipped: 'No warehouse stock snapshot yet; run warehouse stock first.' }
    const index = buildZohoMatchIndex(catalog)
    const candidates = await store.listSkusForAutoMatch(mk)
    const counts: Record<string, number> = { AUTO_MATCHED: 0, REVIEW_REQUIRED: 0, UNMAPPED: 0 }
    const updates = candidates.map((row: { id: number; sellerSku: string }) => {
      const m = matchAmazonSku(row.sellerSku, index)
      counts[m.status] += 1
      return {
        id: row.id,
        status: m.status,
        zohoItemId: m.zohoItemId,
        itemCode: m.itemCode,
        itemName: m.itemName,
        method: m.method,
        confidence: m.confidence,
        candidates: m.candidates,
      }
    })
    const changed = await store.applyAutoMatches(mk, updates)
    return { evaluated: updates.length, changed, catalogItems: catalog.length, ...counts }
  }

  async function listings(ctx: Ctx) {
    const mk = ctx.marketplaceKey
    ctx.progress('Downloading active listings report from Amazon')
    const result = await deps.amazon.fetchActiveAmazonListings({
      marketplaceKey: mk,
      sellerFlexOnly: false,
      progress: (p: any) => ctx.progress(p?.step ? `Listings: ${p.step}` : 'Downloading active listings report', p?.current, p?.total),
    })
    const rows = (result.listings || []).filter((l: any) => l && l.sellerSku && l.normalizedSku)
    if (!rows.length) {
      const err: any = new Error('Amazon returned no active listings; SKU master left unchanged.')
      err.code = 'CONTROL_TOWER_EMPTY_LISTINGS'
      throw err
    }
    ctx.progress(`Saving ${rows.length} listings to the SKU master`, 0, rows.length)
    const seenAt = now()
    await store.upsertListings(
      mk,
      rows.map((l: any) => ({
        sellerSku: l.sellerSku,
        normalizedSku: l.normalizedSku,
        asin: l.asin || null,
        title: l.title || null,
        fulfillmentChannel: l.fulfillmentChannel || null,
        listingStatus: l.listingStatus || 'ACTIVE',
      })),
      seenAt
    )
    const deactivated = await store.markListingsNotSeenInactive(mk, seenAt)
    ctx.setRecords(rows.length)
    ctx.progress('Suggesting Zoho matches', rows.length, rows.length)
    const autoMatch = await runAutoMatch(mk)
    return {
      recordsProcessed: rows.length,
      metadata: { activeListings: rows.length, deactivated, listingsFetchedAt: result.fetchedAt, autoMatch },
    }
  }

  async function sales(ctx: Ctx) {
    const mk = ctx.marketplaceKey
    const settings = await settingsFor(mk)
    const lookbackDays = clampInt(ctx.params.lookbackDays, 1, MAX_SYNC_RANGE_DAYS, DEFAULT_SALES_LOOKBACK_DAYS)
    const current = now()
    const today = zonedDateString(current, settings.timezone)
    const start = zonedDayStartUtc(addDays(today, -(lookbackDays - 1)), settings.timezone)
    const end = new Date(current.getTime() - REPORT_END_SAFETY_MS)
    ctx.progress(`Requesting order report ${addDays(today, -(lookbackDays - 1))} → now (${settings.timezone})`)
    const res = await deps.orders.syncAmazonOrderReport({ marketplaceKey: mk, dataStartTime: start, dataEndTime: end })
    ctx.setRecords(res.rowsSaved || 0)
    return {
      recordsProcessed: res.rowsSaved || 0,
      metadata: {
        window: { start: start.toISOString(), end: end.toISOString(), lookbackDays },
        reportId: res.reportId,
        reused: res.reused,
        rowsParsed: res.rowsParsed,
        rowsSaved: res.rowsSaved,
        rowsRemoved: res.rowsRemoved,
        uniqueOrders: res.uniqueOrders,
        linesWithoutMoney: res.linesWithoutMoney,
      },
    }
  }

  async function rebuildRollup(mk: string, fromDate: string, toDate: string, ctx: Ctx | null) {
    const settings = await settingsFor(mk)
    const totalDays = daysBetween(fromDate, toDate) + 1
    let chunkFrom = fromDate
    let rowsWritten = 0
    let linesRead = 0
    let skippedNoSku = 0
    let vatExclusiveLines = 0
    let vatInclusiveLines = 0
    while (daysBetween(chunkFrom, toDate) >= 0) {
      const chunkTo = daysBetween(chunkFrom, toDate) >= ROLLUP_CHUNK_DAYS ? addDays(chunkFrom, ROLLUP_CHUNK_DAYS - 1) : toDate
      ctx?.progress(`Rolling up ${chunkFrom} → ${chunkTo}`, daysBetween(fromDate, chunkFrom), totalDays)
      const lines = await store.selectOrderLinesForRollup(
        mk,
        zonedDayStartUtc(chunkFrom, settings.timezone),
        zonedDayStartUtc(addDays(chunkTo, 1), settings.timezone)
      )
      const out = rollupDailySales(lines, { marketplaceKey: mk, timeZone: settings.timezone, vatRate: settings.vatRate })
      await store.replaceDailySales(mk, chunkFrom, chunkTo, out.rows)
      rowsWritten += out.rows.length
      linesRead += lines.length
      skippedNoSku += out.skippedNoSku
      vatExclusiveLines += out.vatExclusiveLines
      vatInclusiveLines += out.vatInclusiveLines
      ctx?.setRecords(rowsWritten)
      chunkFrom = addDays(chunkTo, 1)
    }
    return { fromDate, toDate, rowsWritten, linesRead, skippedNoSku, vatExclusiveLines, vatInclusiveLines, timezone: settings.timezone, vatRate: settings.vatRate }
  }

  async function rollup(ctx: Ctx) {
    const mk = ctx.marketplaceKey
    const settings = await settingsFor(mk)
    const today = zonedDateString(now(), settings.timezone)
    let fromDate = ctx.params.fromDate
    const toDate = ctx.params.toDate || today
    if (ctx.params.full) {
      const coverage = await store.orderLineCoverage(mk)
      fromDate = coverage.firstPurchaseAt ? zonedDateString(new Date(coverage.firstPurchaseAt), settings.timezone) : today
    }
    if (!fromDate) fromDate = addDays(today, -(clampInt(ctx.params.days, 1, BACKFILL_MAX_DAYS, DEFAULT_ROLLUP_DAYS) - 1))
    if (daysBetween(fromDate, toDate) < 0) {
      const err: any = new Error(`Rollup range ${fromDate} → ${toDate} is empty`)
      err.code = 'CONTROL_TOWER_BAD_RANGE'
      throw err
    }
    const out = await rebuildRollup(mk, fromDate, toDate, ctx)
    return { recordsProcessed: out.rowsWritten, metadata: out }
  }

  async function fbaInventory(ctx: Ctx) {
    const mk = ctx.marketplaceKey
    const settings = await settingsFor(mk)
    const marketplaceId = deps.amazon.marketplaceIdForKey(mk)
    const bySku = new Map<string, any>()
    let duplicates = 0
    let unreadable = 0
    let summaries = 0
    let page = 0
    let nextToken: string | null = null
    do {
      page += 1
      if (page > MAX_FBA_PAGES) throw new Error(`FBA inventory paging exceeded ${MAX_FBA_PAGES} pages`)
      ctx.progress(`Reading FBA inventory (page ${page})`, summaries, 0)
      const res = await deps.amazon.getAmazonFbaInventorySummaries({ marketplaceKey: mk, marketplaceId, nextToken })
      deps.amazon.throwAmazonSpApiIfFailed(res, 'getFbaInventorySummaries', mk)
      for (const summary of inventorySummaryList(res.data)) {
        summaries += 1
        const parsed = parseFbaInventorySummary(summary)
        if (!parsed) {
          unreadable += 1
          continue
        }
        if (bySku.has(parsed.sellerSku)) {
          duplicates += 1
          continue
        }
        bySku.set(parsed.sellerSku, parsed)
      }
      nextToken = nextTokenFromInventory(res.data)
    } while (nextToken)

    const rows = [...bySku.values()]
    if (!rows.length) {
      const err: any = new Error('Amazon returned no FBA inventory summaries; no snapshot written.')
      err.code = 'CONTROL_TOWER_EMPTY_FBA'
      throw err
    }
    const fetchedAt = now()
    const snapshotAt = hourBucket(fetchedAt)
    ctx.progress(`Saving FBA snapshot (${rows.length} SKUs)`, summaries, summaries)
    const written = await store.writeInventorySnapshot(mk, rows, {
      snapshotAt,
      snapshotDate: zonedDateString(fetchedAt, settings.timezone),
      fetchedAt,
      runId: ctx.run.id,
    })
    await store.upsertInventorySkus(mk, rows, fetchedAt)
    ctx.setRecords(rows.length)
    const missing = (field: string) => rows.filter((r) => r[field] == null).length
    return {
      recordsProcessed: rows.length,
      metadata: {
        snapshotAt: snapshotAt.toISOString(),
        pages: page,
        summaries,
        skus: rows.length,
        written,
        duplicates,
        unreadable,
        missingValues: {
          fulfillableQuantity: missing('fulfillableQuantity'),
          reservedQuantity: missing('reservedQuantity'),
          unfulfillableQuantity: missing('unfulfillableQuantity'),
          researchingQuantity: missing('researchingQuantity'),
          totalQuantity: missing('totalQuantity'),
        },
      },
    }
  }

  async function warehouseStock(ctx: Ctx) {
    const mk = ctx.marketplaceKey
    const settings = await settingsFor(mk)
    ctx.progress('Resolving Life Smile warehouse in Zoho')
    const warehouse = await deps.zoho.resolveLifeSmileWarehouse()
    ctx.progress(`Reading Zoho items for ${warehouse.warehouseName}`)
    const items = await deps.zoho.fetchItemsRawForWarehouse(warehouse.warehouseId)
    const byId = new Map<string, any>()
    for (const item of Array.isArray(items) ? items : []) {
      const parsed = parseWarehouseStockItem(item, warehouse.warehouseId)
      if (parsed && !byId.has(parsed.zohoItemId)) byId.set(parsed.zohoItemId, parsed)
    }
    const rows = [...byId.values()]
    if (!rows.length) {
      const err: any = new Error('Zoho returned no items for the Life Smile warehouse; no snapshot written.')
      err.code = 'CONTROL_TOWER_EMPTY_WAREHOUSE'
      throw err
    }
    const fetchedAt = now()
    const snapshotAt = hourBucket(fetchedAt)
    ctx.progress(`Saving warehouse snapshot (${rows.length} items)`, 0, rows.length)
    const written = await store.writeWarehouseSnapshot(rows, {
      snapshotAt,
      snapshotDate: zonedDateString(fetchedAt, settings.timezone),
      warehouseId: warehouse.warehouseId,
      fetchedAt,
      runId: ctx.run.id,
    })
    ctx.setRecords(rows.length)
    ctx.progress('Suggesting Zoho matches for Amazon SKUs', rows.length, rows.length)
    const autoMatch = await runAutoMatch(mk)
    const scope: Record<string, number> = { warehouse: 0, organization: 0, unknown: 0 }
    for (const r of rows) scope[r.stockScope] += 1
    return {
      recordsProcessed: rows.length,
      metadata: {
        snapshotAt: snapshotAt.toISOString(),
        warehouse: { id: warehouse.warehouseId, name: warehouse.warehouseName },
        items: rows.length,
        rawItems: Array.isArray(items) ? items.length : 0,
        written,
        stockScope: scope,
        missingValues: {
          onHand: rows.filter((r) => r.onHand == null).length,
          availableForSale: rows.filter((r) => r.availableForSale == null).length,
          committedStock: rows.filter((r) => r.committedStock == null).length,
        },
        autoMatch,
      },
    }
  }

  async function salesBackfill(ctx: Ctx) {
    const mk = ctx.marketplaceKey
    const settings = await settingsFor(mk)
    const targetDays = clampInt(ctx.params.days, 1, BACKFILL_MAX_DAYS, BACKFILL_DEFAULT_DAYS)
    const windowDays = clampInt(ctx.params.windowDays ?? process.env.AMAZON_CT_BACKFILL_WINDOW_DAYS, 1, BACKFILL_MAX_WINDOW_DAYS, BACKFILL_MAX_WINDOW_DAYS)
    const today = zonedDateString(now(), settings.timezone)
    const oldest = addDays(today, -targetDays)
    const liveSyncStart = addDays(today, -(DEFAULT_SALES_LOOKBACK_DAYS - 1))
    const coverageBefore = await store.orderLineCoverage(mk)

    const windows: { from: string; to: string }[] = []
    let toExclusive = liveSyncStart
    while (daysBetween(oldest, toExclusive) > 0) {
      const from = daysBetween(oldest, toExclusive) > windowDays ? addDays(toExclusive, -windowDays) : oldest
      windows.push({ from, to: toExclusive })
      toExclusive = from
    }

    const results: any[] = []
    let lastCreateAt = 0
    let consecutiveEmpty = 0
    let failures = 0
    let synced = 0
    let linesSaved = 0
    let stoppedReason: string | null = null
    let oldestTouched: string | null = null

    for (let i = 0; i < windows.length; i += 1) {
      const w = windows[i]
      const label = `${w.from} → ${addDays(w.to, -1)}`
      ctx.progress(`Backfill window ${i + 1}/${windows.length}: ${label}`, i, windows.length)
      const start = zonedDayStartUtc(w.from, settings.timezone)
      const end = zonedDayStartUtc(w.to, settings.timezone)
      const covered = await deps.orders.findSuccessfulReportRunCoveringRange(mk, start, end).catch(() => null)
      if (covered) {
        results.push({ window: label, status: 'already_covered' })
        oldestTouched = w.from
        continue
      }
      const wait = lastCreateAt ? createSpacingMs - (now().getTime() - lastCreateAt) : 0
      if (wait > 0) {
        ctx.progress(`Backfill window ${i + 1}/${windows.length}: waiting ${Math.ceil(wait / 1000)}s for Amazon report quota`, i, windows.length)
        await sleep(wait)
      }
      try {
        const res = await deps.orders.syncAmazonOrderReport({
          marketplaceKey: mk,
          dataStartTime: start,
          dataEndTime: end,
          preserveExisting: true,
          reportTimeoutMs: BACKFILL_REPORT_TIMEOUT_MS,
        })
        if (!res.reused) lastCreateAt = now().getTime()
        synced += 1
        linesSaved += res.rowsSaved || 0
        oldestTouched = w.from
        results.push({ window: label, status: 'synced', rowsParsed: res.rowsParsed, rowsSaved: res.rowsSaved, reused: Boolean(res.reused) })
        consecutiveEmpty = (res.rowsParsed || 0) === 0 ? consecutiveEmpty + 1 : 0
        ctx.setRecords(linesSaved)
        if (consecutiveEmpty >= BACKFILL_EMPTY_WINDOWS_TO_STOP) {
          stoppedReason = `Amazon returned no orders for ${BACKFILL_EMPTY_WINDOWS_TO_STOP} consecutive windows (oldest ${w.from}); treating that as the start of available history.`
          break
        }
      } catch (err: any) {
        lastCreateAt = now().getTime()
        failures += 1
        results.push({ window: label, status: 'failed', error: `${err?.code ? `[${err.code}] ` : ''}${err?.message || err}` })
      }
    }

    let rollupResult: any = null
    if (oldestTouched) {
      ctx.progress('Rebuilding daily sales rollup for the backfilled range', windows.length, windows.length)
      rollupResult = await rebuildRollup(mk, oldestTouched, today, null)
    }
    const coverageAfter = await store.orderLineCoverage(mk)
    const metadata = {
      targetDays,
      windowDays,
      requestedFrom: oldest,
      requestedToExclusive: liveSyncStart,
      windows: results,
      synced,
      failures,
      linesSaved,
      stoppedReason,
      coverageBefore,
      coverageAfter,
      rollup: rollupResult,
    }
    if (failures > 0 && synced === 0 && !results.some((r) => r.status === 'already_covered')) {
      const err: any = new Error(`Backfill failed for every window (${failures}). First error: ${results.find((r) => r.error)?.error}`)
      err.code = 'CONTROL_TOWER_BACKFILL_FAILED'
      throw err
    }
    return { recordsProcessed: linesSaved, metadata }
  }

  return {
    handlers: {
      listings: onlySupported(listings),
      sales: onlySupported(sales),
      rollup: onlySupported(rollup),
      fba_inventory: onlySupported(fbaInventory),
      warehouse_stock: onlySupported(warehouseStock),
      sales_backfill: onlySupported(salesBackfill),
    },
    runAutoMatch,
    rebuildRollup,
  }
}

module.exports = { createControlTowerJobs, _internals: { inventorySummaryList, nextTokenFromInventory, clampInt } }
