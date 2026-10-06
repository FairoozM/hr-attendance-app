'use strict'

/**
 * Capacity, inventory health, removals, capacity-release and daily actions for one marketplace.
 *
 * Two inventory views are kept apart on purpose:
 *   OPERATIONAL ACTIVE INVENTORY  FBA/MFN stock of ACTIVE Amazon listings only (KPIs, Inventory Health default)
 *   PHYSICAL CAPACITY-CONSUMING   every unit physically in Amazon FCs regardless of listing status (Capacity)
 *
 * Every capacity figure carries source / asOf / confidence; calculated figures are labelled ESTIMATE and
 * never replace the official (Seller Central) numbers.
 */

const { zonedDateString, addDays, daysBetween } = require('./controlTowerTime.ts')
const { LISTING_STATUS, isOperationallyActive, replenishmentEligibility } = require('./listingStatus.ts')
const { resolveUnitVolume, summarizeAge, volumeToCm3, VOLUME_SOURCE_PRIORITY, VOLUME_SOURCE_LABEL } = require('./inventoryReportParsers.ts')
const { calculateCapacityUsage, capacityKpis, toCapacityUnit, usageForStorageType } = require('./capacityCalculator.ts')
const { classifyHealth, capacityReleaseOpportunity, rankReleaseOpportunities, physicalFbaUnits, HEALTH_STATUS } = require('./inventoryHealth.ts')
const { buildActions } = require('./controlTowerActions.ts')
const { isRemovalStuck } = require('./removalReportParser.ts')

const CAPACITY_FORMULA = [
  'Per SKU and bucket: volume = unit volume (cm³) × units in the bucket.',
  'On-hand (physical) = fulfillable + reserved + researching + unfulfillable (FBA Inventory API snapshot; buckets do not overlap).',
  'Inbound = inbound working + inbound shipped + inbound receiving (kept separate from on-hand).',
  'Physical capacity is split into ACTIVE (sellable units of ACTIVE listings), INACTIVE (sellable units of inactive/suppressed/incomplete/closed listings), UNFULFILLABLE (all listings) and OTHER/UNKNOWN (listing status unknown).',
  'Unit volume source order: Amazon planning item volume → Amazon fee-preview package sides → Amazon manage-inventory per-unit volume → Zoho package details → manual. Product (unpackaged) dimensions are never used.',
  'Units without a unit volume are reported as VOLUME DATA MISSING and are not counted as zero; coverage % = units with volume ÷ units, and the calculated total is then a lower bound.',
  'Calculated available = official limit − calculated on-hand − calculated inbound. Official available = official limit − Amazon-reported usage (only when entered).',
  'Capacity required by healthy replenishment and capacity shortfall: NOT CALCULATED YET (no replenishment engine).',
].join('\n')

const MARGIN_NOTE = 'Margin not shown: cost and fee data are not reconciled enough to be trusted yet.'

type Deps = { store: any; chStore: any; now?: () => Date }

function sum(values: (number | null | undefined)[]): number | null {
  const known = values.filter((v) => v != null && Number.isFinite(Number(v))) as number[]
  return known.length ? known.reduce((a, b) => a + Number(b), 0) : null
}

function mappingIndicator(status: string | null): 'MAPPED' | 'UNMAPPED' | 'AMBIGUOUS' {
  if (status === 'CONFIRMED' || status === 'AUTO_MATCHED') return 'MAPPED'
  if (status === 'REVIEW_REQUIRED') return 'AMBIGUOUS'
  return 'UNMAPPED'
}

function createCapacityHealthService({ store, chStore, now = () => new Date() }: Deps) {
  async function context(mk: string) {
    const settings = await store.getSettings(mk)
    if (!settings) {
      const err: any = new Error(`Control Tower is not configured for "${mk}"`)
      err.status = 404
      throw err
    }
    const current = now()
    const today = zonedDateString(current, settings.timezone)
    const windows = { from7: addDays(today, -6), from30: addDays(today, -29), from90: addDays(today, -89), toDate: today }
    const [base, ages, dims, coverage] = await Promise.all([
      chStore.healthBaseRows(mk, windows),
      chStore.latestAgeSnapshot(mk),
      chStore.listDimensions(mk),
      store.orderLineCoverage(mk),
    ])
    const salesHistoryDays = coverage.firstPurchaseAt
      ? Math.max(0, daysBetween(zonedDateString(new Date(coverage.firstPurchaseAt), settings.timezone), today) + 1)
      : 0
    const ageBySku = new Map<string, any>(ages.map((a: any) => [a.normalizedSku, a]))
    const dimsBySku = new Map<string, any[]>()
    for (const d of dims) {
      const list = dimsBySku.get(d.normalizedSku) || []
      list.push(d)
      dimsBySku.set(d.normalizedSku, list)
    }
    const thresholds = {
      agedMinDays: settings.healthAgedMinDays,
      excessCoverDays: settings.healthExcessCoverDays,
      lowCoverDays: settings.healthLowCoverDays,
      maxCoverDays: settings.maxCoverDays,
      slowUnitsPer30d: settings.healthSlowUnitsPer30d,
      veryLowUnitsPer30d: settings.healthVeryLowUnitsPer30d,
    }
    let inventorySnapshotAt: string | null = null
    let listingStatusAt: string | null = null
    const skus = base.map((b: any) => {
      if (b.inventorySnapshotAt && (!inventorySnapshotAt || b.inventorySnapshotAt > inventorySnapshotAt)) inventorySnapshotAt = b.inventorySnapshotAt
      if (b.listingStatusAt && (!listingStatusAt || b.listingStatusAt > listingStatusAt)) listingStatusAt = b.listingStatusAt
      const age = ageBySku.get(b.normalizedSku) || null
      const vol = resolveUnitVolume(dimsBySku.get(b.normalizedSku) || [])
      const ageSummary = age ? summarizeAge(age.ages, settings.healthAgedMinDays) : null
      const inbound = sum([b.inboundWorking, b.inboundShipped, b.inboundReceiving])
      const input = {
        sellerSku: b.sellerSku,
        listingStatus: b.listingStatus,
        hasInventorySnapshot: b.hasInventorySnapshot,
        fulfillable: b.fulfillable,
        reserved: b.reserved,
        researching: b.researching,
        unfulfillable: b.unfulfillable,
        inbound,
        units7d: b.units7d,
        units30d: b.units30d,
        units90d: b.units90d,
        salesHistoryDays,
        amazonUnitsShippedT30: age ? age.unitsShippedT30 : null,
        amazonUnitsShippedT90: age ? age.unitsShippedT90 : null,
        age: ageSummary,
        unitVolumeCm3: vol ? vol.unitVolumeCm3 : null,
      }
      const health = classifyHealth(input, thresholds)
      return {
        ...b,
        inbound,
        age: ageSummary,
        ageSnapshotDate: age ? age.inventoryAgeSnapshotDate || age.snapshotDate : null,
        storageType: age ? age.storageType : null,
        amazonRecommendedAction: age ? age.recommendedAction : null,
        amazonUnitsShippedT30: input.amazonUnitsShippedT30,
        amazonUnitsShippedT90: input.amazonUnitsShippedT90,
        unitVolumeCm3: vol ? vol.unitVolumeCm3 : null,
        volumeSource: vol ? vol.source : null,
        health,
      }
    })
    return { settings, today, thresholds, skus, salesHistoryDays, inventorySnapshotAt, listingStatusAt, ages, coverage }
  }

  type Ctx = Awaited<ReturnType<typeof context>>

  function usageOf(ctx: Ctx) {
    return calculateCapacityUsage(
      ctx.skus.map((s: any) => ({
        sellerSku: s.sellerSku,
        listingStatus: s.listingStatus,
        storageType: s.storageType,
        unitVolumeCm3: s.unitVolumeCm3,
        volumeSource: s.volumeSource,
        fulfillable: s.fulfillable,
        reserved: s.reserved,
        researching: s.researching,
        unfulfillable: s.unfulfillable,
        inboundWorking: s.inboundWorking,
        inboundShipped: s.inboundShipped,
        inboundReceiving: s.inboundReceiving,
      }))
    )
  }

  function planningStorageVolume(ctx: Ctx) {
    let cm3 = 0
    let rows = 0
    let snapshotDate: string | null = null
    for (const a of ctx.ages) {
      snapshotDate = snapshotDate || a.snapshotDate
      const v = volumeToCm3(a.storageVolume, a.volumeUnit)
      if (v != null) {
        cm3 += v
        rows += 1
      }
    }
    if (!rows) return null
    return {
      volumeCm3: cm3,
      skuCount: rows,
      source: 'AMAZON_REPORT',
      sourceLabel: 'Amazon FBA inventory planning report — storage volume (sellable units on hand)',
      asOf: snapshotDate,
      confidence: 'AMAZON_REPORTED',
      note: 'Amazon’s own per-SKU storage volume. It is not the Seller Central capacity-monitor usage figure.',
    }
  }

  function skuRow(s: any) {
    const physical = physicalFbaUnits(s)
    return {
      id: s.id,
      sellerSku: s.sellerSku,
      asin: s.asin,
      fnsku: s.fnsku,
      title: s.title,
      fulfillmentChannel: s.fulfillmentChannel,
      listingStatus: s.listingStatus,
      listingStatusRaw: s.listingStatusRaw,
      listingStatusReason: s.listingStatusReason,
      searchSuppressed: s.searchSuppressed,
      fulfillable: s.fulfillable,
      reserved: s.reserved,
      inbound: s.inbound,
      unfulfillable: s.unfulfillable,
      researching: s.researching,
      units7d: s.health.units7d,
      units30d: s.health.units30d,
      units90d: s.health.units90d,
      sales30Source: s.health.sales30Source,
      sales90Source: s.health.sales90Source,
      velocity7d: s.health.velocity7d,
      velocity30d: s.health.velocity30d,
      daysOfCover: s.health.daysOfCover,
      oldestAgeBucket: s.age ? s.age.oldestBucket : null,
      agedUnits: s.age ? s.age.agedUnits : null,
      ageSnapshotDate: s.ageSnapshotDate,
      lastSaleDate: s.lastSaleDate,
      warehouseAvailable: s.warehouseAvailable,
      mappingStatus: s.mappingStatus,
      mappingIndicator: mappingIndicator(s.mappingStatus),
      physicalFbaUnits: physical,
      unitVolumeCm3: s.unitVolumeCm3,
      volumeSource: s.volumeSource,
      storageType: s.storageType,
      capacityUsedCm3: s.unitVolumeCm3 != null ? physical * s.unitVolumeCm3 : null,
      healthStatus: s.health.status,
      healthReason: s.health.reason,
      flags: s.health.flags,
      recommendedAction: s.health.recommendedAction,
      amazonRecommendedAction: s.amazonRecommendedAction,
      margin: null,
      replenishment: replenishmentEligibility({ listingStatus: s.listingStatus }),
    }
  }

  const HEALTH_ORDER = [
    HEALTH_STATUS.ZERO_SALES, HEALTH_STATUS.AGED, HEALTH_STATUS.EXCESS, HEALTH_STATUS.OUT_ZERO_FBA,
    HEALTH_STATUS.SLOW, HEALTH_STATUS.WATCH, HEALTH_STATUS.DATA_INCOMPLETE, HEALTH_STATUS.HEALTHY,
  ]

  function hasFbaStock(s: any): boolean {
    return physicalFbaUnits(s) + (Number(s.inbound) || 0) > 0
  }

  const FILTERS: Record<string, (s: any) => boolean> = {
    active: (s) => isOperationallyActive(s.listingStatus),
    inactive_with_stock: (s) => !isOperationallyActive(s.listingStatus) && hasFbaStock(s),
    suppressed: (s) => s.listingStatus === LISTING_STATUS.SUPPRESSED,
    all: () => true,
  }

  async function getInventoryHealth(mk: string, opts: { filter?: string; healthStatus?: string; search?: string; limit?: number } = {}) {
    const ctx = await context(mk)
    const filter = opts.filter && FILTERS[opts.filter] ? opts.filter : 'active'
    let rows = ctx.skus.filter(FILTERS[filter])
    const counts: Record<string, number> = Object.fromEntries(HEALTH_ORDER.map((h) => [h, 0]))
    for (const s of rows) counts[s.health.status] += 1
    if (opts.healthStatus) rows = rows.filter((s: any) => s.health.status === opts.healthStatus)
    if (opts.search) {
      const needle = opts.search.toLowerCase()
      rows = rows.filter((s: any) => [s.sellerSku, s.asin, s.title].some((v) => v && String(v).toLowerCase().includes(needle)))
    }
    rows.sort(
      (a: any, b: any) =>
        HEALTH_ORDER.indexOf(a.health.status) - HEALTH_ORDER.indexOf(b.health.status) ||
        physicalFbaUnits(b) - physicalFbaUnits(a) ||
        a.sellerSku.localeCompare(b.sellerSku)
    )
    const limit = Math.min(Math.max(1, Number(opts.limit) || 500), 5000)
    const listingCounts: Record<string, number> = {}
    for (const s of ctx.skus) listingCounts[s.listingStatus || 'NOT_REFRESHED'] = (listingCounts[s.listingStatus || 'NOT_REFRESHED'] || 0) + 1
    return {
      marketplaceKey: mk,
      filter,
      today: ctx.today,
      thresholds: ctx.thresholds,
      healthCounts: counts,
      listingStatusCounts: listingCounts,
      listingStatusRefreshedAt: ctx.listingStatusAt,
      inventorySnapshotAt: ctx.inventorySnapshotAt,
      salesHistoryDays: ctx.salesHistoryDays,
      salesHistoryNote:
        ctx.salesHistoryDays < 90
          ? `App sales history covers ${ctx.salesHistoryDays} days (<90). 90-day figures use Amazon's planning-report units shipped where available; otherwise the SKU is DATA INCOMPLETE. The 12-month backfill has not been run.`
          : null,
      marginNote: MARGIN_NOTE,
      total: rows.length,
      rows: rows.slice(0, limit).map(skuRow),
    }
  }

  async function getInactiveWithStock(mk: string) {
    const ctx = await context(mk)
    const rows = ctx.skus.filter(FILTERS.inactive_with_stock).map((s: any) => {
      const row = skuRow(s)
      const inferred =
        s.listingStatus === LISTING_STATUS.INACTIVE && !(Number(s.fulfillable) > 0)
          ? 'Inferred: no fulfillable FBA units — Amazon shows FBA listings without sellable units as Inactive.'
          : null
      return { ...row, inferredReason: inferred }
    })
    rows.sort((a: any, b: any) => (b.capacityUsedCm3 ?? -1) - (a.capacityUsedCm3 ?? -1) || b.physicalFbaUnits - a.physicalFbaUnits)
    const units = rows.reduce((a: number, r: any) => a + r.physicalFbaUnits + (Number(r.inbound) || 0), 0)
    const withVolume = rows.filter((r: any) => r.capacityUsedCm3 != null)
    const unitsWithVolume = withVolume.reduce((a: number, r: any) => a + r.physicalFbaUnits, 0)
    const physicalUnits = rows.reduce((a: number, r: any) => a + r.physicalFbaUnits, 0)
    return {
      marketplaceKey: mk,
      listingStatusRefreshedAt: ctx.listingStatusAt,
      inventorySnapshotAt: ctx.inventorySnapshotAt,
      summary: {
        skus: rows.length,
        units,
        estimatedCapacityCm3: withVolume.length ? withVolume.reduce((a: number, r: any) => a + r.capacityUsedCm3, 0) : null,
        coveragePct: physicalUnits > 0 ? (unitsWithVolume / physicalUnits) * 100 : null,
        source: 'CALCULATED',
        confidence: 'ESTIMATE',
      },
      rows,
    }
  }

  async function getCapacityRelease(mk: string) {
    const ctx = await context(mk)
    const out: any[] = []
    for (const s of ctx.skus) {
      if (physicalFbaUnits(s) <= 0) continue
      const opp = capacityReleaseOpportunity({ ...s, health: s.health }, ctx.thresholds)
      if (!opp) continue
      const row = skuRow(s)
      out.push({
        ...opp,
        sellerSku: row.sellerSku,
        asin: row.asin,
        title: row.title,
        listingStatus: row.listingStatus,
        fbaUnits: row.physicalFbaUnits,
        units30d: row.units30d,
        units90d: row.units90d,
        sales90Source: row.sales90Source,
        daysOfCover: row.daysOfCover,
        oldestAgeBucket: row.oldestAgeBucket,
        volumeSource: row.volumeSource,
        mappingIndicator: row.mappingIndicator,
      })
    }
    const ranked = rankReleaseOpportunities(out)
    const known = ranked.filter((r) => r.potentialCapacityReleasedCm3 != null)
    return {
      marketplaceKey: mk,
      inventorySnapshotAt: ctx.inventorySnapshotAt,
      note: 'Recommendations only. Potential capacity released is shown, not allocated to replenishment; removals are created by a person in Seller Central.',
      summary: {
        opportunities: ranked.length,
        potentialRemovalQty: ranked.reduce((a, r) => a + r.potentialRemovalQty, 0),
        potentialCapacityReleasedCm3: known.length ? known.reduce((a, r) => a + r.potentialCapacityReleasedCm3, 0) : null,
        volumeMissing: ranked.length - known.length,
        source: 'CALCULATED',
        confidence: 'ESTIMATE',
      },
      rows: ranked,
    }
  }

  function storageTypesWithStock(usage: any): string[] {
    return Object.entries(usage.byStorageType)
      .filter(([, v]: any) => v.onHand.units + v.inbound.units > 0)
      .map(([k]) => k)
  }

  async function getCapacity(mk: string) {
    const ctx = await context(mk)
    const usage = usageOf(ctx)
    const [periods, history, snapshots, events] = await Promise.all([
      chStore.currentCapacityPeriods(mk, ctx.today),
      chStore.listCapacityPeriods(mk),
      chStore.listUsageSnapshots(mk),
      chStore.listCapacityEvents(mk),
    ])
    const meta = { inventorySnapshotAt: ctx.inventorySnapshotAt }
    const kpis = periods.length
      ? periods.map((p: any) => ({ storageType: p.storageType, period: p, ...capacityKpis(p, usage, meta) }))
      : [{ storageType: 'ALL', period: null, ...capacityKpis(null, usage, meta) }]
    const titles = new Map<string, string | null>(ctx.skus.map((s: any) => [s.sellerSku, s.title]))
    const historyRows = history.map((p: any) => {
      const end = new Date(`${p.periodEnd}T23:59:59Z`).getTime()
      const start = new Date(`${p.periodStart}T00:00:00Z`).getTime()
      const snap = snapshots.find((s: any) => {
        const t = new Date(s.computedAt).getTime()
        return t >= start && t <= end
      })
      let calculated: number | null = null
      if (snap) {
        const slice =
          p.storageType === 'ALL'
            ? {
                volumeCm3: (snap.onHandVolumeCm3 || 0) + (snap.inboundWorkingVolumeCm3 || 0) + (snap.inboundShippedVolumeCm3 || 0) + (snap.inboundReceivingVolumeCm3 || 0),
                units: (snap.onHandUnits || 0) + (Number(snap.breakdown?.inboundUnits) || 0),
              }
            : snap.breakdown?.byStorageType?.[p.storageType]
        if (slice) calculated = toCapacityUnit(slice.volumeCm3 ?? null, slice.units ?? null, p.capacityUnit)
      }
      const officialPct = p.capacityLimit && p.amazonReportedUsage != null ? (p.amazonReportedUsage / p.capacityLimit) * 100 : null
      const calcPct = p.capacityLimit && calculated != null ? (calculated / p.capacityLimit) * 100 : null
      return {
        ...p,
        calculatedUsageInPeriod: calculated,
        calculatedAt: snap ? snap.computedAt : null,
        calculatedCoveragePct: snap ? snap.coveragePct : null,
        officialAvailable: p.capacityLimit != null && p.amazonReportedUsage != null ? p.capacityLimit - p.amazonReportedUsage : null,
        calculatedAvailable: p.capacityLimit != null && calculated != null ? p.capacityLimit - calculated : null,
        officialUtilizationPct: officialPct,
        calculatedUtilizationPct: calcPct,
      }
    })
    return {
      marketplaceKey: mk,
      today: ctx.today,
      inventorySnapshotAt: ctx.inventorySnapshotAt,
      listingStatusRefreshedAt: ctx.listingStatusAt,
      thresholds: {
        warnPct: ctx.settings.capacityWarnPct,
        highPct: ctx.settings.capacityHighPct,
        criticalPct: ctx.settings.capacityCriticalPct,
        coverageMinPct: ctx.settings.usageCoverageMinPct,
      },
      officialCapacityApi: {
        status: 'NOT_EXPOSED',
        note: 'Amazon SP-API exposes no capacity-limit or capacity-usage endpoint for this account; enter the limit from Seller Central.',
      },
      currentPeriods: periods,
      kpis,
      usage: {
        source: 'CALCULATED',
        asOf: ctx.inventorySnapshotAt,
        onHand: usage.onHand,
        inbound: usage.inbound,
        total: usage.total,
        buckets: usage.buckets,
        byListingClass: usage.byListingClass,
        byStorageType: usage.byStorageType,
        coveragePct: usage.coveragePct,
        volumeSources: usage.volumeSources,
        missingVolume: usage.missingVolume.map((m: any) => ({ ...m, title: titles.get(m.sellerSku) || null })),
      },
      amazonPlanningStorageVolume: planningStorageVolume(ctx),
      volumeSourcePriority: VOLUME_SOURCE_PRIORITY.map((s: string) => ({ source: s, label: VOLUME_SOURCE_LABEL[s] })),
      storageTypesWithStock: storageTypesWithStock(usage),
      formula: CAPACITY_FORMULA,
      history: historyRows,
      usageHistory: snapshots.slice(0, 120),
      events,
    }
  }

  async function recordUsageSnapshot(mk: string, runId: string | null = null) {
    const ctx = await context(mk)
    return insertSnapshot(mk, ctx, usageOf(ctx), runId)
  }

  async function insertSnapshot(mk: string, ctx: Ctx, usage: ReturnType<typeof usageOf>, runId: string | null) {
    const planning = planningStorageVolume(ctx)
    const byStorageType: Record<string, { volumeCm3: number; units: number; onHandCm3: number; inboundCm3: number }> = {}
    for (const [k, v] of Object.entries(usage.byStorageType) as any) {
      byStorageType[k] = { volumeCm3: v.onHand.volumeCm3 + v.inbound.volumeCm3, units: v.onHand.units + v.inbound.units, onHandCm3: v.onHand.volumeCm3, inboundCm3: v.inbound.volumeCm3 }
    }
    return chStore.insertUsageSnapshot(mk, {
      computedAt: now(),
      inventorySnapshotAt: ctx.inventorySnapshotAt,
      onHandUnits: usage.onHand.units,
      onHandUnitsWithVolume: usage.onHand.unitsWithVolume,
      onHandVolumeCm3: Math.round(usage.onHand.volumeCm3 * 100) / 100,
      inboundWorkingVolumeCm3: Math.round(usage.buckets.inboundWorking.volumeCm3 * 100) / 100,
      inboundShippedVolumeCm3: Math.round(usage.buckets.inboundShipped.volumeCm3 * 100) / 100,
      inboundReceivingVolumeCm3: Math.round(usage.buckets.inboundReceiving.volumeCm3 * 100) / 100,
      coveragePct: usage.coveragePct == null ? null : Math.round(usage.coveragePct * 100) / 100,
      amazonPlanningStorageVolumeM3: planning ? planning.volumeCm3 / 1_000_000 : null,
      breakdown: {
        inboundUnits: usage.inbound.units,
        inboundUnitsWithVolume: usage.inbound.unitsWithVolume,
        byStorageType,
        byListingClass: Object.fromEntries(Object.entries(usage.byListingClass).map(([k, v]: any) => [k, { units: v.units, volumeCm3: v.volumeCm3, unitsWithVolume: v.unitsWithVolume }])),
        missingVolumeSkus: usage.missingVolume.length,
      },
      runId,
    })
  }

  /** Calculated-at-entry figures stored on a period row (labelled as such in the UI). */
  async function calculationForPeriod(mk: string, input: { storageType: string; capacityUnit: string; capacityLimit: number | null }) {
    const ctx = await context(mk)
    const usage = usageOf(ctx)
    const snap = await insertSnapshot(mk, ctx, usage, null)
    const slice = usageForStorageType(usage, input.storageType)
    const onHand = slice ? toCapacityUnit(slice.onHand.volumeCm3, slice.onHand.units, input.capacityUnit) : null
    const inbound = slice ? toCapacityUnit(slice.inbound.volumeCm3, slice.inbound.units, input.capacityUnit) : null
    const round = (v: number | null) => (v == null ? null : Math.round(v * 10000) / 10000)
    return {
      calculatedUsage: round(onHand),
      inboundUsage: round(inbound),
      committedUsage: null,
      availableCapacity: input.capacityLimit != null && onHand != null && inbound != null ? round(input.capacityLimit - onHand - inbound) : null,
      calculationSnapshotId: snap ? snap.id : null,
    }
  }

  async function createCapacityPeriod(mk: string, input: Record<string, any>, actor: string) {
    const calc = await calculationForPeriod(mk, input as any)
    const period = await chStore.insertCapacityPeriod(mk, { ...input, ...calc }, actor)
    await refreshActions(mk).catch((err: any) => console.error('[control-tower] actions refresh failed:', err?.message))
    return period
  }

  async function reviseCapacityPeriod(mk: string, id: number, patch: Record<string, any>, actor: string) {
    const existing = await chStore.getCapacityPeriod(mk, id)
    if (!existing) return { error: 'NOT_FOUND' }
    const merged = { ...existing, ...patch }
    const calc = await calculationForPeriod(mk, { storageType: merged.storageType, capacityUnit: merged.capacityUnit, capacityLimit: merged.capacityLimit })
    const result = await chStore.reviseCapacityPeriod(mk, id, { ...patch, ...calc }, actor)
    if (!result.error) await refreshActions(mk).catch((err: any) => console.error('[control-tower] actions refresh failed:', err?.message))
    return result
  }

  async function verifyCapacityPeriod(mk: string, id: number, actor: string) {
    return chStore.verifyCapacityPeriod(mk, id, actor)
  }

  async function getRemovalOrders(mk: string, status: string | null) {
    const [rows, counts] = await Promise.all([chStore.listRemovalItems(mk, status), chStore.removalCounts(mk)])
    return {
      marketplaceKey: mk,
      status: status || 'ALL',
      counts,
      source: 'GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA (read-only)',
      completedFormula: 'Completed = shipped + disposed (the report has no completed column).',
      rows,
    }
  }

  async function refreshActions(mk: string) {
    const ctx = await context(mk)
    const usage = usageOf(ctx)
    const periods = await chStore.currentCapacityPeriods(mk, ctx.today)
    const capacity = periods.map((p: any) => {
      const k = capacityKpis(p, usage, { inventorySnapshotAt: ctx.inventorySnapshotAt })
      const official = k.utilizationPct?.official?.value ?? null
      const calc = k.utilizationPct?.calculated?.value ?? null
      return { periodId: p.id, storageType: p.storageType, utilizationPct: official ?? calc, basis: official != null ? 'OFFICIAL' : 'CALCULATED' }
    })
    const open = await chStore.listOpenRemovalOrders(mk)
    const current = now()
    const actions = buildActions({
      marketplaceKey: mk,
      thresholds: {
        warnPct: ctx.settings.capacityWarnPct,
        highPct: ctx.settings.capacityHighPct,
        criticalPct: ctx.settings.capacityCriticalPct,
        coverageMinPct: ctx.settings.usageCoverageMinPct,
      },
      capacity,
      storageTypesWithStock: storageTypesWithStock(usage),
      coveragePct: usage.coveragePct,
      missingVolume: usage.missingVolume,
      health: ctx.skus
        .filter((s: any) => physicalFbaUnits(s) + (Number(s.inbound) || 0) > 0)
        .map((s: any) => ({
          sellerSku: s.sellerSku,
          status: s.health.status,
          flags: s.health.flags,
          agedUnits: s.age ? s.age.agedUnits : null,
          daysOfCover: s.health.daysOfCover,
          unfulfillable: Number(s.unfulfillable) || 0,
          listingStatus: s.listingStatus,
          physicalFbaUnits: physicalFbaUnits(s),
        })),
      stuckRemovals: open.filter((o: any) => isRemovalStuck(o, current, ctx.settings.removalStuckDays)),
    })
    const synced = await chStore.syncActions(mk, actions, current)
    return { actions: actions.length, ...synced }
  }

  async function getActions(mk: string, status: 'OPEN' | 'RESOLVED' | null) {
    return { marketplaceKey: mk, status: status || 'ALL', actions: await chStore.listActions(mk, status) }
  }

  /** Operational ACTIVE inventory KPIs + inactive-with-stock warnings for the Command Center. */
  async function activeInventorySummary(mk: string) {
    const ctx = await context(mk)
    const refreshed = ctx.skus.some((s: any) => s.listingStatus)
    const active = ctx.skus.filter((s: any) => isOperationallyActive(s.listingStatus))
    const inactiveWithStock = ctx.skus.filter(FILTERS.inactive_with_stock)
    const total = (rows: any[], f: (s: any) => number | null) => (refreshed ? rows.reduce((a, s) => a + (Number(f(s)) || 0), 0) : null)
    const wasted = inactiveWithStock.filter((s: any) => s.unitVolumeCm3 != null)
    const wastedUnits = inactiveWithStock.reduce((a: number, s: any) => a + physicalFbaUnits(s), 0)
    const wastedUnitsKnown = wasted.reduce((a: number, s: any) => a + physicalFbaUnits(s), 0)
    const statusCounts: Record<string, number> = {}
    for (const s of ctx.skus) statusCounts[s.listingStatus || 'NOT_REFRESHED'] = (statusCounts[s.listingStatus || 'NOT_REFRESHED'] || 0) + 1
    return {
      listingStatusRefreshed: refreshed,
      listingStatusRefreshedAt: ctx.listingStatusAt,
      listingStatusSource: 'Amazon all-listings report status + search-suppressed (FYP) report',
      statusCounts,
      activeSkus: refreshed ? active.length : null,
      activeFbaSkus: refreshed ? active.filter((s: any) => s.fulfillmentChannel === 'AMAZON').length : null,
      activeMfnSkus: refreshed ? active.filter((s: any) => s.fulfillmentChannel === 'DEFAULT').length : null,
      activeFbaFulfillable: total(active, (s) => s.fulfillable),
      activeFbaInbound: total(active, (s) => s.inbound),
      activeFbaReserved: total(active, (s) => s.reserved),
      activeFbaUnfulfillable: total(active, (s) => s.unfulfillable),
      inactiveSkusWithFbaStock: refreshed ? inactiveWithStock.length : null,
      unitsInInactiveSkus: refreshed ? inactiveWithStock.reduce((a: number, s: any) => a + physicalFbaUnits(s) + (Number(s.inbound) || 0), 0) : null,
      estimatedCapacityWastedByInactive: refreshed
        ? {
            volumeCm3: wasted.reduce((a: number, s: any) => a + physicalFbaUnits(s) * s.unitVolumeCm3, 0),
            coveragePct: wastedUnits > 0 ? (wastedUnitsKnown / wastedUnits) * 100 : null,
            source: 'CALCULATED',
            confidence: 'ESTIMATE',
            asOf: ctx.inventorySnapshotAt,
          }
        : null,
    }
  }

  return {
    context,
    getInventoryHealth,
    getInactiveWithStock,
    getCapacityRelease,
    getCapacity,
    recordUsageSnapshot,
    createCapacityPeriod,
    reviseCapacityPeriod,
    verifyCapacityPeriod,
    getRemovalOrders,
    refreshActions,
    getActions,
    activeInventorySummary,
  }
}

module.exports = { createCapacityHealthService, CAPACITY_FORMULA, mappingIndicator }
