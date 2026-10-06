'use strict'

/**
 * Capacity / inventory-health refresh jobs. Amazon access is report generation + GET only:
 *   listing_status     GET_MERCHANT_LISTINGS_ALL_DATA (status of every listing) + GET_MERCHANTS_LISTINGS_FYP_REPORT (search suppressed)
 *   inventory_reports  GET_FBA_INVENTORY_PLANNING_DATA (age buckets, units shipped, item volume, storage type)
 *                      GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA (measured package sides)
 *                      GET_FBA_MYI_ALL_INVENTORY_DATA (per-unit volume fallback)
 *                      → age snapshot, unit volumes per source, calculated usage snapshot, daily actions
 *   removal_orders     GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA (read-only; never creates removals)
 *
 * Nothing is deleted: SKUs missing from the all-listings report become UNKNOWN (history kept).
 */

const { parseAllListingsRow, parseSuppressedRow, classifyListingStatus, LISTING_STATUS_SOURCE } = require('./listingStatus.ts')
const { parsePlanningRow, parseFeePreviewRow, parseMyiAllRow } = require('./inventoryReportParsers.ts')
const { parseRemovalDetailRow, aggregateRemovalOrders } = require('./removalReportParser.ts')

const REPORT = Object.freeze({
  ALL_LISTINGS: 'GET_MERCHANT_LISTINGS_ALL_DATA',
  SUPPRESSED: 'GET_MERCHANTS_LISTINGS_FYP_REPORT',
  PLANNING: 'GET_FBA_INVENTORY_PLANNING_DATA',
  FEES: 'GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA',
  MYI_ALL: 'GET_FBA_MYI_ALL_INVENTORY_DATA',
  REMOVAL_DETAIL: 'GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA',
})

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const REMOVAL_LOOKBACK_MONTHS = 18
const REPORT_END_SAFETY_MS = 5 * MINUTE

type Ctx = {
  run: { id: string }
  marketplaceKey: string
  params: Record<string, any>
  progress: (step: string, current?: number, total?: number) => void
  setRecords: (n: number) => void
}

type Deps = {
  chStore: any
  capacityHealth: any
  fetcher: { fetchReports: (mk: string, specs: any[], progress?: (s: string) => void) => Promise<Record<string, any>> }
  now?: () => Date
  supportedMarketplaces?: string[]
}

function outcomeSummary(o: any) {
  if (!o) return null
  return { reportType: o.reportType, status: o.status, rows: o.rows.length, reportId: o.reportId, reused: o.reused, amazonRequestId: o.amazonRequestId, error: o.error }
}

function failure(code: string, message: string, metadata?: any) {
  const err: any = new Error(message)
  err.code = code
  if (metadata) err.metadata = metadata
  return err
}

/** Keeps the first row per key (Amazon occasionally repeats a SKU, e.g. per condition). */
function dedupe<T>(rows: (T | null)[], keyOf: (r: T) => string): T[] {
  const seen = new Map<string, T>()
  for (const r of rows) if (r && !seen.has(keyOf(r))) seen.set(keyOf(r), r)
  return [...seen.values()]
}

function monthsBefore(d: Date, months: number): Date {
  const out = new Date(d.getTime())
  out.setUTCMonth(out.getUTCMonth() - months)
  return out
}

function createCapacityHealthJobs(deps: Deps) {
  const now = deps.now || (() => new Date())
  const supported = (deps.supportedMarketplaces || ['ksa']).map((m) => m.toLowerCase())

  function onlySupported(handler: (ctx: Ctx) => Promise<any>) {
    return async (ctx: Ctx) => {
      if (!supported.includes(String(ctx.marketplaceKey || '').toLowerCase())) {
        throw failure('CONTROL_TOWER_UNSUPPORTED_MARKETPLACE', `Control Tower jobs are not enabled for marketplace "${ctx.marketplaceKey}"`)
      }
      return handler(ctx)
    }
  }

  async function listingStatus(ctx: Ctx) {
    const mk = ctx.marketplaceKey
    ctx.progress('Requesting Amazon all-listings and search-suppressed reports')
    const out = await deps.fetcher.fetchReports(
      mk,
      [
        { key: 'all', reportType: REPORT.ALL_LISTINGS, reuseMaxAgeMs: 30 * MINUTE },
        { key: 'suppressed', reportType: REPORT.SUPPRESSED, reuseMaxAgeMs: 30 * MINUTE },
      ],
      (s) => ctx.progress(s)
    )
    const reports = { all: outcomeSummary(out.all), suppressed: outcomeSummary(out.suppressed) }
    if (!out.all || out.all.status !== 'DONE' || !out.all.rows.length) {
      throw failure('CONTROL_TOWER_LISTING_STATUS_UNAVAILABLE', `All-listings report not usable (${out.all?.status || 'missing'}: ${out.all?.error || 'no rows'}); statuses left unchanged.`, { reports })
    }
    if (!out.suppressed || ['ERROR', 'FATAL', 'TIMEOUT'].includes(out.suppressed.status)) {
      throw failure('CONTROL_TOWER_SUPPRESSED_UNAVAILABLE', `Search-suppressed report not usable (${out.suppressed?.status || 'missing'}: ${out.suppressed?.error || ''}); statuses left unchanged so suppressed listings are not shown as ACTIVE.`, { reports })
    }
    const listings = dedupe(out.all.rows.map(parseAllListingsRow), (r: any) => r.sellerSku)
    const suppressedBySku = new Map<string, any>()
    for (const s of out.suppressed.rows.map(parseSuppressedRow)) if (s && !suppressedBySku.has(s.normalizedSku)) suppressedBySku.set(s.normalizedSku, s)
    const counts: Record<string, number> = {}
    const rows = listings.map((l: any) => {
      const suppressed = suppressedBySku.get(l.normalizedSku) || null
      const c = classifyListingStatus({ listing: l, suppressed })
      counts[c.status] = (counts[c.status] || 0) + 1
      return {
        sellerSku: l.sellerSku,
        normalizedSku: l.normalizedSku,
        asin: l.asin,
        title: l.title,
        fulfillmentChannel: l.fulfillmentChannel === 'UNKNOWN' ? null : l.fulfillmentChannel,
        fulfillmentChannelRaw: l.fulfillmentChannelRaw,
        status: c.status,
        rawStatus: c.rawStatus,
        reason: c.reason,
        suppressed: Boolean(suppressed),
      }
    })
    ctx.progress(`Saving ${rows.length} listing statuses`, 0, rows.length)
    const applied = await deps.chStore.applyListingStatuses(mk, rows, { observedAt: now(), runId: ctx.run.id, source: LISTING_STATUS_SOURCE })
    ctx.setRecords(rows.length)
    await deps.capacityHealth.refreshActions(mk).catch((err: any) => console.error('[control-tower] actions refresh failed:', err?.message))
    return {
      recordsProcessed: rows.length,
      metadata: { reports, statusCounts: counts, suppressedRows: suppressedBySku.size, ...applied },
    }
  }

  async function inventoryReports(ctx: Ctx) {
    const mk = ctx.marketplaceKey
    ctx.progress('Requesting Amazon inventory planning, fee preview and inventory reports')
    const out = await deps.fetcher.fetchReports(
      mk,
      [
        { key: 'planning', reportType: REPORT.PLANNING, reuseMaxAgeMs: 12 * HOUR },
        { key: 'fees', reportType: REPORT.FEES, reuseMaxAgeMs: 24 * HOUR },
        { key: 'myi', reportType: REPORT.MYI_ALL, reuseMaxAgeMs: 1 * HOUR },
      ],
      (s) => ctx.progress(s)
    )
    const reports = { planning: outcomeSummary(out.planning), fees: outcomeSummary(out.fees), myi: outcomeSummary(out.myi) }
    const usable = (o: any) => o && o.status === 'DONE' && o.rows.length > 0
    if (!usable(out.planning) && !usable(out.fees) && !usable(out.myi)) {
      throw failure('CONTROL_TOWER_INVENTORY_REPORTS_UNAVAILABLE', 'No inventory report was usable; nothing written.', { reports })
    }
    const observedAt = now()
    const dims: any[] = []
    let ageRows = 0
    if (usable(out.planning)) {
      const planning = dedupe(out.planning.rows.map(parsePlanningRow), (r: any) => `${r.sellerSku}|${r.snapshotDate}`)
      ctx.progress(`Saving ${planning.length} inventory age rows`)
      ageRows = await deps.chStore.writeAgeSnapshot(mk, planning, { fetchedAt: observedAt, runId: ctx.run.id, reportId: out.planning.reportId })
      for (const p of planning as any[]) {
        dims.push({
          sellerSku: p.sellerSku,
          normalizedSku: p.normalizedSku,
          source: 'AMAZON_PLANNING_ITEM_VOLUME',
          dimensionKind: 'STORAGE_UNIT_VOLUME',
          rawVolume: p.itemVolume,
          rawVolumeUnit: p.volumeUnit,
          unitVolumeCm3: p.itemVolumeCm3,
        })
      }
    }
    if (usable(out.fees)) {
      for (const f of dedupe(out.fees.rows.map(parseFeePreviewRow), (r: any) => r.sellerSku) as any[]) {
        dims.push({
          sellerSku: f.sellerSku,
          normalizedSku: f.normalizedSku,
          source: 'AMAZON_FEE_PREVIEW_PACKAGE',
          dimensionKind: 'PACKAGE',
          longestSide: f.longestSide,
          medianSide: f.medianSide,
          shortestSide: f.shortestSide,
          dimensionUnit: f.dimensionUnit,
          unitVolumeCm3: f.packageVolumeCm3,
        })
      }
    }
    if (usable(out.myi)) {
      for (const m of dedupe(out.myi.rows.map(parseMyiAllRow), (r: any) => r.sellerSku) as any[]) {
        dims.push({
          sellerSku: m.sellerSku,
          normalizedSku: m.normalizedSku,
          source: 'AMAZON_MYI_PER_UNIT_VOLUME',
          dimensionKind: 'STORAGE_UNIT_VOLUME',
          rawVolume: m.perUnitVolumeCm3,
          rawVolumeUnit: 'cubic centimeters',
          unitVolumeCm3: m.perUnitVolumeCm3,
        })
      }
    }
    ctx.progress(`Saving ${dims.length} unit-volume records`)
    const dimensionsWritten = dims.length
      ? await deps.chStore.upsertDimensions(mk, dims, { observedAt, runId: ctx.run.id, reportId: out.planning?.reportId || out.fees?.reportId || out.myi?.reportId || null })
      : 0
    ctx.progress('Calculating capacity usage snapshot')
    const usage = await deps.capacityHealth.recordUsageSnapshot(mk, ctx.run.id)
    const actions = await deps.capacityHealth.refreshActions(mk)
    ctx.setRecords(ageRows + dimensionsWritten)
    return {
      recordsProcessed: ageRows + dimensionsWritten,
      metadata: {
        reports,
        ageRows,
        dimensionsWritten,
        dimensionsWithVolume: dims.filter((d) => d.unitVolumeCm3 != null).length,
        usageSnapshotId: usage ? usage.id : null,
        usageCoveragePct: usage ? usage.coveragePct : null,
        actions,
      },
    }
  }

  async function removalOrders(ctx: Ctx) {
    const mk = ctx.marketplaceKey
    const current = now()
    const start = monthsBefore(current, REMOVAL_LOOKBACK_MONTHS)
    const end = new Date(current.getTime() - REPORT_END_SAFETY_MS)
    ctx.progress(`Requesting removal order detail ${start.toISOString().slice(0, 10)} → now`)
    const out = await deps.fetcher.fetchReports(mk, [{ key: 'detail', reportType: REPORT.REMOVAL_DETAIL, dataStartTime: start, dataEndTime: end }], (s) => ctx.progress(s))
    const o = out.detail
    const reports = { detail: outcomeSummary(o) }
    if (!o || !['DONE', 'CANCELLED'].includes(o.status)) {
      throw failure('CONTROL_TOWER_REMOVALS_UNAVAILABLE', `Removal order report not usable (${o?.status || 'missing'}: ${o?.error || ''}); nothing written.`, { reports })
    }
    const lines = dedupe(o.rows.map(parseRemovalDetailRow), (l: any) => `${l.removalOrderId}|${l.sellerSku}|${l.fnsku}|${l.disposition}`)
    const orders = aggregateRemovalOrders(lines as any[])
    const written = lines.length
      ? await deps.chStore.upsertRemovals(mk, orders, lines, { seenAt: current, runId: ctx.run.id, reportId: o.reportId })
      : { ordersWritten: 0, linesWritten: 0 }
    const groups: Record<string, number> = {}
    for (const ord of orders) groups[ord.statusGroup] = (groups[ord.statusGroup] || 0) + 1
    ctx.setRecords(lines.length)
    const actions = await deps.capacityHealth.refreshActions(mk).catch((err: any) => ({ error: err?.message }))
    return {
      recordsProcessed: lines.length,
      metadata: {
        reports,
        window: { start: start.toISOString(), end: end.toISOString() },
        noData: o.status === 'CANCELLED',
        orders: orders.length,
        lines: lines.length,
        statusGroups: groups,
        ...written,
        actions,
      },
    }
  }

  return {
    handlers: {
      listing_status: onlySupported(listingStatus),
      inventory_reports: onlySupported(inventoryReports),
      removal_orders: onlySupported(removalOrders),
    },
  }
}

module.exports = { createCapacityHealthJobs, REPORT }
