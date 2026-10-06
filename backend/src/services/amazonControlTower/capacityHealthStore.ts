'use strict'

/**
 * Postgres access for capacity, inventory health, removals and daily actions (our tables only).
 * Capacity periods are append-only: a revision inserts a new row and marks the previous one superseded;
 * values of an existing period are never overwritten. Listing statuses are never deleted; changes are
 * appended to amazon_listing_status_history.
 */

type QueryResult = { rows: any[]; rowCount?: number | null }
type Queryable = { query: (text: string, params?: unknown[]) => Promise<QueryResult> }
type DbLike = Queryable & { pool?: { connect: () => Promise<Queryable & { release: () => void }> } }

const BATCH = 1000

function iso(value: unknown): string | null {
  if (value == null) return null
  const d = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function dateOnly(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const text = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null
}

function num(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function chunks<T>(items: T[], size = BATCH): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function mapPeriod(row: any) {
  return {
    id: Number(row.id),
    marketplaceKey: row.marketplace_key,
    periodStart: dateOnly(row.period_start),
    periodEnd: dateOnly(row.period_end),
    storageType: row.storage_type,
    storageTypeLabel: row.storage_type_label,
    capacityLimit: num(row.capacity_limit),
    capacityUnit: row.capacity_unit,
    capacityUnitLabel: row.capacity_unit_label,
    amazonReportedUsage: num(row.amazon_reported_usage),
    calculatedUsage: num(row.calculated_usage),
    inboundUsage: num(row.inbound_usage),
    committedUsage: num(row.committed_usage),
    availableCapacity: num(row.available_capacity),
    calculationSnapshotId: row.calculation_snapshot_id == null ? null : Number(row.calculation_snapshot_id),
    source: row.source,
    sourceReference: row.source_reference,
    enteredBy: row.entered_by,
    enteredAt: iso(row.entered_at),
    verifiedAt: iso(row.verified_at),
    verifiedBy: row.verified_by,
    notes: row.notes,
    supersedesId: row.supersedes_id == null ? null : Number(row.supersedes_id),
    supersededById: row.superseded_by_id == null ? null : Number(row.superseded_by_id),
    supersededAt: iso(row.superseded_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function mapUsageSnapshot(row: any) {
  return {
    id: Number(row.id),
    computedAt: iso(row.computed_at),
    inventorySnapshotAt: iso(row.inventory_snapshot_at),
    onHandUnits: Number(row.on_hand_units),
    onHandUnitsWithVolume: Number(row.on_hand_units_with_volume),
    onHandVolumeCm3: Number(row.on_hand_volume_cm3),
    inboundWorkingVolumeCm3: Number(row.inbound_working_volume_cm3),
    inboundShippedVolumeCm3: Number(row.inbound_shipped_volume_cm3),
    inboundReceivingVolumeCm3: Number(row.inbound_receiving_volume_cm3),
    coveragePct: num(row.coverage_pct),
    amazonPlanningStorageVolumeM3: num(row.amazon_planning_storage_volume_m3),
    breakdown: row.breakdown || {},
  }
}

function mapAction(row: any) {
  return {
    id: Number(row.id),
    actionKey: row.action_key,
    actionType: row.action_type,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: row.metadata || {},
    status: row.status,
    firstSeenAt: iso(row.first_seen_at),
    lastSeenAt: iso(row.last_seen_at),
    resolvedAt: iso(row.resolved_at),
  }
}

const PERIOD_FIELDS: Record<string, string> = {
  periodStart: 'period_start',
  periodEnd: 'period_end',
  storageType: 'storage_type',
  storageTypeLabel: 'storage_type_label',
  capacityLimit: 'capacity_limit',
  capacityUnit: 'capacity_unit',
  capacityUnitLabel: 'capacity_unit_label',
  amazonReportedUsage: 'amazon_reported_usage',
  calculatedUsage: 'calculated_usage',
  inboundUsage: 'inbound_usage',
  committedUsage: 'committed_usage',
  availableCapacity: 'available_capacity',
  calculationSnapshotId: 'calculation_snapshot_id',
  source: 'source',
  sourceReference: 'source_reference',
  notes: 'notes',
}

/** Fields a person enters; the calculated-at-entry figures are refreshed on every revision and are not audited as edits. */
const EDITABLE_PERIOD_FIELDS = [
  'periodStart', 'periodEnd', 'storageType', 'storageTypeLabel', 'capacityLimit', 'capacityUnit', 'capacityUnitLabel',
  'amazonReportedUsage', 'source', 'sourceReference', 'notes',
]

function createCapacityHealthStore(db: DbLike) {
  const q = (text: string, params: unknown[] = []) => db.query(text, params)

  async function tx<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    if (!db.pool) return fn(db)
    const client = await db.pool.connect()
    try {
      await client.query('BEGIN')
      const out = await fn(client)
      await client.query('COMMIT')
      return out
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  // ---------- listing status ----------

  type ListingStatusInput = {
    sellerSku: string
    normalizedSku: string
    asin: string | null
    title: string | null
    fulfillmentChannel: string | null
    fulfillmentChannelRaw: string | null
    status: string
    rawStatus: string | null
    reason: string | null
    suppressed: boolean
  }

  /**
   * Applies statuses from a complete all-listings report. New SKUs are added (active = FALSE: `active`
   * still means "present in the open-listings report"); SKUs missing from the report become UNKNOWN.
   * Status changes are appended to the history table. Nothing is deleted.
   */
  async function applyListingStatuses(mk: string, rows: ListingStatusInput[], meta: { observedAt: Date; runId: string | null; source: string }) {
    return tx(async (client) => {
      let historyRows = 0
      let upserted = 0
      for (const batch of chunks(rows)) {
        const payload = JSON.stringify(
          batch.map((r) => ({
            seller_sku: r.sellerSku,
            normalized_sku: r.normalizedSku,
            asin: r.asin,
            title: r.title,
            channel: r.fulfillmentChannel,
            channel_raw: r.fulfillmentChannelRaw,
            status: r.status,
            raw_status: r.rawStatus,
            reason: r.reason,
            suppressed: r.suppressed,
          }))
        )
        const h = await client.query(
          `INSERT INTO amazon_listing_status_history (marketplace_key, seller_sku, listing_status, raw_status, reason, source, observed_at, run_id)
           SELECT $1, x.seller_sku, x.status, x.raw_status, x.reason, $3, $4, $5
           FROM jsonb_to_recordset($2::jsonb) AS x(seller_sku text, status text, raw_status text, reason text)
           LEFT JOIN amazon_sku_master m ON m.marketplace_key = $1 AND m.seller_sku = x.seller_sku
           WHERE m.id IS NULL OR m.amazon_listing_status IS DISTINCT FROM x.status
              OR m.amazon_listing_status_raw IS DISTINCT FROM x.raw_status`,
          [mk, payload, meta.source, meta.observedAt, meta.runId]
        )
        historyRows += h.rowCount || 0
        const u = await client.query(
          `INSERT INTO amazon_sku_master (
             marketplace_key, seller_sku, normalized_sku, asin, amazon_title, fulfillment_channel, active,
             amazon_listing_status, amazon_listing_status_raw, amazon_listing_status_reason, amazon_listing_status_source,
             amazon_listing_status_at, amazon_fulfillment_channel_raw, search_suppressed, last_seen_in_all_listings_at
           )
           SELECT $1, x.seller_sku, x.normalized_sku, x.asin, x.title, NULLIF(x.channel, 'UNKNOWN'), FALSE,
                  x.status, x.raw_status, x.reason, $3, $4, x.channel_raw, x.suppressed, $4
           FROM jsonb_to_recordset($2::jsonb) AS x(
             seller_sku text, normalized_sku text, asin text, title text, channel text, channel_raw text,
             status text, raw_status text, reason text, suppressed boolean
           )
           ON CONFLICT (marketplace_key, seller_sku) DO UPDATE SET
             asin = COALESCE(EXCLUDED.asin, amazon_sku_master.asin),
             amazon_title = COALESCE(EXCLUDED.amazon_title, amazon_sku_master.amazon_title),
             fulfillment_channel = COALESCE(EXCLUDED.fulfillment_channel, amazon_sku_master.fulfillment_channel),
             amazon_listing_status = EXCLUDED.amazon_listing_status,
             amazon_listing_status_raw = EXCLUDED.amazon_listing_status_raw,
             amazon_listing_status_reason = EXCLUDED.amazon_listing_status_reason,
             amazon_listing_status_source = EXCLUDED.amazon_listing_status_source,
             amazon_listing_status_at = EXCLUDED.amazon_listing_status_at,
             amazon_fulfillment_channel_raw = EXCLUDED.amazon_fulfillment_channel_raw,
             search_suppressed = EXCLUDED.search_suppressed,
             last_seen_in_all_listings_at = EXCLUDED.last_seen_in_all_listings_at,
             updated_at = NOW()`,
          [mk, payload, meta.source, meta.observedAt]
        )
        upserted += u.rowCount || 0
      }
      const missingReason = 'Not present in the Amazon all-listings report'
      const mh = await client.query(
        `INSERT INTO amazon_listing_status_history (marketplace_key, seller_sku, listing_status, raw_status, reason, source, observed_at, run_id)
         SELECT marketplace_key, seller_sku, 'UNKNOWN', NULL, $3, $4, $2, $5
         FROM amazon_sku_master
         WHERE marketplace_key = $1 AND (last_seen_in_all_listings_at IS NULL OR last_seen_in_all_listings_at < $2)
           AND amazon_listing_status IS DISTINCT FROM 'UNKNOWN'`,
        [mk, meta.observedAt, missingReason, meta.source, meta.runId]
      )
      historyRows += mh.rowCount || 0
      const missing = await client.query(
        `UPDATE amazon_sku_master SET amazon_listing_status = 'UNKNOWN', amazon_listing_status_raw = NULL,
           amazon_listing_status_reason = $3, amazon_listing_status_source = $4, amazon_listing_status_at = $2,
           search_suppressed = NULL, updated_at = NOW()
         WHERE marketplace_key = $1 AND (last_seen_in_all_listings_at IS NULL OR last_seen_in_all_listings_at < $2)`,
        [mk, meta.observedAt, missingReason, meta.source]
      )
      return { upserted, notInReport: missing.rowCount || 0, historyRows }
    })
  }

  // ---------- inventory age / dimensions / usage ----------

  const AGE_COLS = [
    'inv_age_0_to_30_days', 'inv_age_31_to_60_days', 'inv_age_61_to_90_days', 'inv_age_0_to_90_days',
    'inv_age_91_to_180_days', 'inv_age_181_to_270_days', 'inv_age_181_to_330_days', 'inv_age_271_to_365_days',
    'inv_age_331_to_365_days', 'inv_age_365_plus_days',
  ]

  async function writeAgeSnapshot(mk: string, rows: any[], meta: { fetchedAt: Date; runId: string | null; reportId: string | null }) {
    return tx(async (client) => {
      let written = 0
      for (const batch of chunks(rows)) {
        const r = await client.query(
          `INSERT INTO amazon_inventory_age_snapshots (
             marketplace_key, snapshot_date, inventory_age_snapshot_date, seller_sku, normalized_sku, fnsku, asin, product_name,
             condition, available, inventory_supply_at_fba, pending_removal_quantity, ${AGE_COLS.join(', ')},
             units_shipped_t7, units_shipped_t30, units_shipped_t60, units_shipped_t90, item_volume, volume_unit,
             storage_type, storage_volume, days_of_supply, weeks_of_cover_t30, weeks_of_cover_t90, estimated_excess_quantity,
             recommended_action, alert, sell_through, inbound_quantity, reserved_quantity, unfulfillable_quantity,
             raw, report_id, run_id, fetched_at
           )
           SELECT $1, x.snapshot_date, x.inventory_age_snapshot_date, x.seller_sku, x.normalized_sku, x.fnsku, x.asin, x.product_name,
                  x.condition, x.available, x.inventory_supply_at_fba, x.pending_removal_quantity, ${AGE_COLS.map((c) => `x.${c}`).join(', ')},
                  x.units_shipped_t7, x.units_shipped_t30, x.units_shipped_t60, x.units_shipped_t90, x.item_volume, x.volume_unit,
                  x.storage_type, x.storage_volume, x.days_of_supply, x.weeks_of_cover_t30, x.weeks_of_cover_t90, x.estimated_excess_quantity,
                  x.recommended_action, x.alert, x.sell_through, x.inbound_quantity, x.reserved_quantity, x.unfulfillable_quantity,
                  COALESCE(x.raw, '{}'::jsonb), $3, $4, $5
           FROM jsonb_to_recordset($2::jsonb) AS x(
             snapshot_date date, inventory_age_snapshot_date date, seller_sku text, normalized_sku text, fnsku text, asin text,
             product_name text, condition text, available int, inventory_supply_at_fba int, pending_removal_quantity int,
             ${AGE_COLS.map((c) => `${c} int`).join(', ')},
             units_shipped_t7 int, units_shipped_t30 int, units_shipped_t60 int, units_shipped_t90 int, item_volume numeric,
             volume_unit text, storage_type text, storage_volume numeric, days_of_supply int, weeks_of_cover_t30 numeric,
             weeks_of_cover_t90 numeric, estimated_excess_quantity int, recommended_action text, alert text, sell_through numeric,
             inbound_quantity int, reserved_quantity int, unfulfillable_quantity int, raw jsonb
           )
           ON CONFLICT (marketplace_key, seller_sku, snapshot_date) DO UPDATE SET
             inventory_age_snapshot_date = EXCLUDED.inventory_age_snapshot_date, normalized_sku = EXCLUDED.normalized_sku,
             fnsku = EXCLUDED.fnsku, asin = EXCLUDED.asin, product_name = EXCLUDED.product_name, condition = EXCLUDED.condition,
             available = EXCLUDED.available, inventory_supply_at_fba = EXCLUDED.inventory_supply_at_fba,
             pending_removal_quantity = EXCLUDED.pending_removal_quantity,
             ${AGE_COLS.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
             units_shipped_t7 = EXCLUDED.units_shipped_t7, units_shipped_t30 = EXCLUDED.units_shipped_t30,
             units_shipped_t60 = EXCLUDED.units_shipped_t60, units_shipped_t90 = EXCLUDED.units_shipped_t90,
             item_volume = EXCLUDED.item_volume, volume_unit = EXCLUDED.volume_unit, storage_type = EXCLUDED.storage_type,
             storage_volume = EXCLUDED.storage_volume, days_of_supply = EXCLUDED.days_of_supply,
             weeks_of_cover_t30 = EXCLUDED.weeks_of_cover_t30, weeks_of_cover_t90 = EXCLUDED.weeks_of_cover_t90,
             estimated_excess_quantity = EXCLUDED.estimated_excess_quantity, recommended_action = EXCLUDED.recommended_action,
             alert = EXCLUDED.alert, sell_through = EXCLUDED.sell_through, inbound_quantity = EXCLUDED.inbound_quantity,
             reserved_quantity = EXCLUDED.reserved_quantity, unfulfillable_quantity = EXCLUDED.unfulfillable_quantity,
             raw = EXCLUDED.raw, report_id = EXCLUDED.report_id, run_id = EXCLUDED.run_id, fetched_at = EXCLUDED.fetched_at`,
          [
            mk,
            JSON.stringify(
              batch.map((p) => ({
                snapshot_date: p.snapshotDate,
                inventory_age_snapshot_date: p.inventoryAgeSnapshotDate,
                seller_sku: p.sellerSku,
                normalized_sku: p.normalizedSku,
                fnsku: p.fnsku,
                asin: p.asin,
                product_name: p.productName,
                condition: p.condition,
                available: p.available,
                inventory_supply_at_fba: p.inventorySupplyAtFba,
                pending_removal_quantity: p.pendingRemovalQuantity,
                ...Object.fromEntries(AGE_COLS.map((c) => [c, p[c] ?? null])),
                units_shipped_t7: p.unitsShippedT7,
                units_shipped_t30: p.unitsShippedT30,
                units_shipped_t60: p.unitsShippedT60,
                units_shipped_t90: p.unitsShippedT90,
                item_volume: p.itemVolume,
                volume_unit: p.volumeUnit,
                storage_type: p.storageType,
                storage_volume: p.storageVolume,
                days_of_supply: p.daysOfSupply,
                weeks_of_cover_t30: p.weeksOfCoverT30,
                weeks_of_cover_t90: p.weeksOfCoverT90,
                estimated_excess_quantity: p.estimatedExcessQuantity,
                recommended_action: p.recommendedAction,
                alert: p.alert,
                sell_through: p.sellThrough,
                inbound_quantity: p.inboundQuantity,
                reserved_quantity: p.reservedQuantity,
                unfulfillable_quantity: p.unfulfillableQuantity,
                raw: p.raw || {},
              }))
            ),
            meta.reportId,
            meta.runId,
            meta.fetchedAt,
          ]
        )
        written += r.rowCount || 0
      }
      return written
    })
  }

  /** Latest planning snapshot (age buckets, Amazon units shipped, storage type) keyed by normalized SKU. */
  async function latestAgeSnapshot(mk: string) {
    const r = await q(
      `SELECT * FROM amazon_inventory_age_snapshots
       WHERE marketplace_key = $1
         AND snapshot_date = (SELECT MAX(snapshot_date) FROM amazon_inventory_age_snapshots WHERE marketplace_key = $1)`,
      [mk]
    )
    return r.rows.map((row) => ({
      snapshotDate: dateOnly(row.snapshot_date),
      inventoryAgeSnapshotDate: dateOnly(row.inventory_age_snapshot_date),
      sellerSku: row.seller_sku,
      normalizedSku: row.normalized_sku,
      ages: Object.fromEntries(AGE_COLS.map((c) => [c, row[c] == null ? null : Number(row[c])])),
      unitsShippedT7: num(row.units_shipped_t7),
      unitsShippedT30: num(row.units_shipped_t30),
      unitsShippedT90: num(row.units_shipped_t90),
      storageType: row.storage_type,
      storageVolume: num(row.storage_volume),
      volumeUnit: row.volume_unit,
      recommendedAction: row.recommended_action,
      alert: row.alert,
      pendingRemovalQuantity: num(row.pending_removal_quantity),
    }))
  }

  type DimensionInput = {
    sellerSku: string
    normalizedSku: string
    source: string
    dimensionKind: string
    longestSide?: number | null
    medianSide?: number | null
    shortestSide?: number | null
    dimensionUnit?: string | null
    rawVolume?: number | null
    rawVolumeUnit?: string | null
    unitVolumeCm3: number | null
  }

  async function upsertDimensions(mk: string, rows: DimensionInput[], meta: { observedAt: Date; runId: string | null; reportId: string | null }) {
    let written = 0
    for (const batch of chunks(rows)) {
      const r = await q(
        `INSERT INTO amazon_sku_dimensions (
           marketplace_key, seller_sku, normalized_sku, source, dimension_kind, longest_side, median_side, shortest_side,
           dimension_unit, raw_volume, raw_volume_unit, unit_volume_cm3, observed_at, report_id, run_id
         )
         SELECT $1, x.seller_sku, x.normalized_sku, x.source, x.dimension_kind, x.longest_side, x.median_side, x.shortest_side,
                x.dimension_unit, x.raw_volume, x.raw_volume_unit, x.unit_volume_cm3, $3, $4, $5
         FROM jsonb_to_recordset($2::jsonb) AS x(
           seller_sku text, normalized_sku text, source text, dimension_kind text, longest_side numeric, median_side numeric,
           shortest_side numeric, dimension_unit text, raw_volume numeric, raw_volume_unit text, unit_volume_cm3 numeric
         )
         ON CONFLICT (marketplace_key, seller_sku, source) DO UPDATE SET
           normalized_sku = EXCLUDED.normalized_sku, dimension_kind = EXCLUDED.dimension_kind,
           longest_side = EXCLUDED.longest_side, median_side = EXCLUDED.median_side, shortest_side = EXCLUDED.shortest_side,
           dimension_unit = EXCLUDED.dimension_unit, raw_volume = EXCLUDED.raw_volume, raw_volume_unit = EXCLUDED.raw_volume_unit,
           unit_volume_cm3 = EXCLUDED.unit_volume_cm3, observed_at = EXCLUDED.observed_at,
           report_id = EXCLUDED.report_id, run_id = EXCLUDED.run_id`,
        [
          mk,
          JSON.stringify(
            batch.map((d) => ({
              seller_sku: d.sellerSku,
              normalized_sku: d.normalizedSku,
              source: d.source,
              dimension_kind: d.dimensionKind,
              longest_side: d.longestSide ?? null,
              median_side: d.medianSide ?? null,
              shortest_side: d.shortestSide ?? null,
              dimension_unit: d.dimensionUnit ?? null,
              raw_volume: d.rawVolume ?? null,
              raw_volume_unit: d.rawVolumeUnit ?? null,
              unit_volume_cm3: d.unitVolumeCm3 != null && d.unitVolumeCm3 > 0 ? Math.round(d.unitVolumeCm3 * 1000) / 1000 : null,
            }))
          ),
          meta.observedAt,
          meta.reportId,
          meta.runId,
        ]
      )
      written += r.rowCount || 0
    }
    return written
  }

  async function listDimensions(mk: string) {
    const r = await q(`SELECT normalized_sku, seller_sku, source, unit_volume_cm3, observed_at FROM amazon_sku_dimensions WHERE marketplace_key = $1`, [mk])
    return r.rows.map((row) => ({
      normalizedSku: row.normalized_sku,
      sellerSku: row.seller_sku,
      source: row.source,
      unitVolumeCm3: num(row.unit_volume_cm3),
      observedAt: iso(row.observed_at),
    }))
  }

  async function insertUsageSnapshot(mk: string, s: any) {
    const r = await q(
      `INSERT INTO amazon_capacity_usage_snapshots (
         marketplace_key, computed_at, inventory_snapshot_at, on_hand_units, on_hand_units_with_volume, on_hand_volume_cm3,
         inbound_working_volume_cm3, inbound_shipped_volume_cm3, inbound_receiving_volume_cm3, coverage_pct,
         amazon_planning_storage_volume_m3, breakdown, run_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
       ON CONFLICT (marketplace_key, computed_at) DO NOTHING
       RETURNING *`,
      [
        mk,
        s.computedAt,
        s.inventorySnapshotAt,
        s.onHandUnits,
        s.onHandUnitsWithVolume,
        s.onHandVolumeCm3,
        s.inboundWorkingVolumeCm3,
        s.inboundShippedVolumeCm3,
        s.inboundReceivingVolumeCm3,
        s.coveragePct,
        s.amazonPlanningStorageVolumeM3,
        JSON.stringify(s.breakdown || {}),
        s.runId || null,
      ]
    )
    return r.rows[0] ? mapUsageSnapshot(r.rows[0]) : null
  }

  async function listUsageSnapshots(mk: string, limit = 400) {
    const r = await q(
      `SELECT * FROM amazon_capacity_usage_snapshots WHERE marketplace_key = $1 ORDER BY computed_at DESC LIMIT $2`,
      [mk, Math.min(Math.max(1, limit), 2000)]
    )
    return r.rows.map(mapUsageSnapshot)
  }

  // ---------- health base rows ----------

  /** One row per SKU-master entry with Amazon listing status, latest FBA buckets, mapped warehouse stock and sales windows. */
  async function healthBaseRows(mk: string, w: { from7: string; from30: string; from90: string; toDate: string }) {
    const r = await q(
      `WITH inv AS (
         SELECT DISTINCT ON (normalized_sku) *
         FROM amazon_inventory_snapshots
         WHERE marketplace_key = $1
           AND snapshot_at = (SELECT MAX(snapshot_at) FROM amazon_inventory_snapshots WHERE marketplace_key = $1)
         ORDER BY normalized_sku, fulfillable_quantity DESC NULLS LAST
       ),
       wh AS (
         SELECT DISTINCT ON (zoho_item_id) zoho_item_id, available_for_sale
         FROM amazon_warehouse_stock_snapshots
         WHERE snapshot_at = (SELECT MAX(snapshot_at) FROM amazon_warehouse_stock_snapshots)
         ORDER BY zoho_item_id
       ),
       sales AS (
         SELECT seller_sku,
                COALESCE(SUM(units_ordered) FILTER (WHERE sales_date >= $2::date), 0)::int AS units_7d,
                COALESCE(SUM(units_ordered) FILTER (WHERE sales_date >= $3::date), 0)::int AS units_30d,
                COALESCE(SUM(units_ordered), 0)::int AS units_90d
         FROM amazon_sku_daily_sales
         WHERE marketplace_key = $1 AND sales_date BETWEEN $4::date AND $5::date
         GROUP BY seller_sku
       ),
       last_sale AS (
         SELECT seller_sku, MAX(sales_date) AS last_sale_date
         FROM amazon_sku_daily_sales
         WHERE marketplace_key = $1 AND units_ordered > 0
         GROUP BY seller_sku
       )
       SELECT m.id, m.seller_sku, m.normalized_sku, m.asin, m.fnsku, m.amazon_title, m.fulfillment_channel, m.active,
              m.amazon_listing_status, m.amazon_listing_status_raw, m.amazon_listing_status_reason, m.amazon_listing_status_at,
              m.search_suppressed, m.mapping_status, m.zoho_item_id, m.zoho_item_code,
              inv.snapshot_at AS inventory_snapshot_at, inv.fulfillable_quantity, inv.reserved_quantity, inv.researching_quantity,
              inv.unfulfillable_quantity, inv.inbound_working_quantity, inv.inbound_shipped_quantity, inv.inbound_receiving_quantity,
              inv.total_quantity,
              CASE WHEN m.mapping_status IN ('CONFIRMED', 'AUTO_MATCHED') THEN wh.available_for_sale END AS warehouse_available,
              COALESCE(sales.units_7d, 0) AS units_7d, COALESCE(sales.units_30d, 0) AS units_30d, COALESCE(sales.units_90d, 0) AS units_90d,
              last_sale.last_sale_date
       FROM amazon_sku_master m
       LEFT JOIN inv ON inv.normalized_sku = m.normalized_sku
       LEFT JOIN wh ON wh.zoho_item_id = m.zoho_item_id
       LEFT JOIN sales ON sales.seller_sku = m.normalized_sku
       LEFT JOIN last_sale ON last_sale.seller_sku = m.normalized_sku
       WHERE m.marketplace_key = $1`,
      [mk, w.from7, w.from30, w.from90, w.toDate]
    )
    return r.rows.map((row) => ({
      id: Number(row.id),
      sellerSku: row.seller_sku,
      normalizedSku: row.normalized_sku,
      asin: row.asin,
      fnsku: row.fnsku,
      title: row.amazon_title,
      fulfillmentChannel: row.fulfillment_channel,
      inOpenListingsReport: Boolean(row.active),
      listingStatus: row.amazon_listing_status,
      listingStatusRaw: row.amazon_listing_status_raw,
      listingStatusReason: row.amazon_listing_status_reason,
      listingStatusAt: iso(row.amazon_listing_status_at),
      searchSuppressed: row.search_suppressed == null ? null : Boolean(row.search_suppressed),
      mappingStatus: row.mapping_status,
      zohoItemId: row.zoho_item_id,
      zohoItemCode: row.zoho_item_code,
      hasInventorySnapshot: row.inventory_snapshot_at != null,
      inventorySnapshotAt: iso(row.inventory_snapshot_at),
      fulfillable: num(row.fulfillable_quantity),
      reserved: num(row.reserved_quantity),
      researching: num(row.researching_quantity),
      unfulfillable: num(row.unfulfillable_quantity),
      inboundWorking: num(row.inbound_working_quantity),
      inboundShipped: num(row.inbound_shipped_quantity),
      inboundReceiving: num(row.inbound_receiving_quantity),
      totalQuantity: num(row.total_quantity),
      warehouseAvailable: num(row.warehouse_available),
      units7d: Number(row.units_7d || 0),
      units30d: Number(row.units_30d || 0),
      units90d: Number(row.units_90d || 0),
      lastSaleDate: dateOnly(row.last_sale_date),
    }))
  }

  // ---------- removal orders ----------

  async function upsertRemovals(mk: string, orders: any[], lines: any[], meta: { seenAt: Date; runId: string | null; reportId: string | null }) {
    return tx(async (client) => {
      let ordersWritten = 0
      let linesWritten = 0
      for (const batch of chunks(orders)) {
        const r = await client.query(
          `INSERT INTO amazon_removal_orders (
             marketplace_key, removal_order_id, request_date, order_source, order_type, service_speed, order_status, status_group,
             last_updated_at, line_count, requested_quantity, shipped_quantity, cancelled_quantity, disposed_quantity,
             in_process_quantity, completed_quantity, removal_fee, currency, raw_metadata, first_seen_at, last_seen_at, report_id, run_id
           )
           SELECT $1, x.removal_order_id, x.request_date, x.order_source, x.order_type, x.service_speed, x.order_status, x.status_group,
                  x.last_updated_at, x.line_count, x.requested_quantity, x.shipped_quantity, x.cancelled_quantity, x.disposed_quantity,
                  x.in_process_quantity, x.completed_quantity, x.removal_fee, x.currency, COALESCE(x.raw_metadata, '{}'::jsonb), $3, $3, $4, $5
           FROM jsonb_to_recordset($2::jsonb) AS x(
             removal_order_id text, request_date timestamptz, order_source text, order_type text, service_speed text, order_status text,
             status_group text, last_updated_at timestamptz, line_count int, requested_quantity int, shipped_quantity int,
             cancelled_quantity int, disposed_quantity int, in_process_quantity int, completed_quantity int, removal_fee numeric,
             currency text, raw_metadata jsonb
           )
           ON CONFLICT (marketplace_key, removal_order_id) DO UPDATE SET
             request_date = EXCLUDED.request_date, order_source = EXCLUDED.order_source, order_type = EXCLUDED.order_type,
             service_speed = EXCLUDED.service_speed, order_status = EXCLUDED.order_status, status_group = EXCLUDED.status_group,
             last_updated_at = EXCLUDED.last_updated_at, line_count = EXCLUDED.line_count,
             requested_quantity = EXCLUDED.requested_quantity, shipped_quantity = EXCLUDED.shipped_quantity,
             cancelled_quantity = EXCLUDED.cancelled_quantity, disposed_quantity = EXCLUDED.disposed_quantity,
             in_process_quantity = EXCLUDED.in_process_quantity, completed_quantity = EXCLUDED.completed_quantity,
             removal_fee = EXCLUDED.removal_fee, currency = EXCLUDED.currency, raw_metadata = EXCLUDED.raw_metadata,
             last_seen_at = EXCLUDED.last_seen_at, report_id = EXCLUDED.report_id, run_id = EXCLUDED.run_id`,
          [
            mk,
            JSON.stringify(
              batch.map((o) => ({
                removal_order_id: o.removalOrderId,
                request_date: o.requestDate,
                order_source: o.orderSource,
                order_type: o.orderType,
                service_speed: o.serviceSpeed,
                order_status: o.orderStatus,
                status_group: o.statusGroup,
                last_updated_at: o.lastUpdatedAt,
                line_count: o.lineCount,
                requested_quantity: o.requestedQuantity,
                shipped_quantity: o.shippedQuantity,
                cancelled_quantity: o.cancelledQuantity,
                disposed_quantity: o.disposedQuantity,
                in_process_quantity: o.inProcessQuantity,
                completed_quantity: o.completedQuantity,
                removal_fee: o.removalFee,
                currency: o.currency,
                raw_metadata: o.raw || {},
              }))
            ),
            meta.seenAt,
            meta.reportId,
            meta.runId,
          ]
        )
        ordersWritten += r.rowCount || 0
      }
      for (const batch of chunks(lines)) {
        const r = await client.query(
          `INSERT INTO amazon_removal_order_items (
             marketplace_key, removal_order_id, seller_sku, normalized_sku, fnsku, asin, disposition, order_status, status_group,
             request_date, last_updated_at, requested_quantity, shipped_quantity, cancelled_quantity, disposed_quantity,
             in_process_quantity, completed_quantity, removal_fee, currency, raw_metadata, first_seen_at, last_seen_at, report_id, run_id
           )
           SELECT $1, x.removal_order_id, x.seller_sku, x.normalized_sku, COALESCE(x.fnsku, ''),
                  (SELECT m.asin FROM amazon_sku_master m WHERE m.marketplace_key = $1 AND m.normalized_sku = x.normalized_sku AND m.asin IS NOT NULL LIMIT 1),
                  COALESCE(x.disposition, ''), x.order_status, x.status_group, x.request_date, x.last_updated_at,
                  x.requested_quantity, x.shipped_quantity, x.cancelled_quantity, x.disposed_quantity, x.in_process_quantity,
                  x.completed_quantity, x.removal_fee, x.currency, COALESCE(x.raw_metadata, '{}'::jsonb), $3, $3, $4, $5
           FROM jsonb_to_recordset($2::jsonb) AS x(
             removal_order_id text, seller_sku text, normalized_sku text, fnsku text, disposition text, order_status text,
             status_group text, request_date timestamptz, last_updated_at timestamptz, requested_quantity int, shipped_quantity int,
             cancelled_quantity int, disposed_quantity int, in_process_quantity int, completed_quantity int, removal_fee numeric,
             currency text, raw_metadata jsonb
           )
           ON CONFLICT (marketplace_key, removal_order_id, seller_sku, fnsku, disposition) DO UPDATE SET
             normalized_sku = EXCLUDED.normalized_sku, asin = COALESCE(EXCLUDED.asin, amazon_removal_order_items.asin),
             order_status = EXCLUDED.order_status, status_group = EXCLUDED.status_group, request_date = EXCLUDED.request_date,
             last_updated_at = EXCLUDED.last_updated_at, requested_quantity = EXCLUDED.requested_quantity,
             shipped_quantity = EXCLUDED.shipped_quantity, cancelled_quantity = EXCLUDED.cancelled_quantity,
             disposed_quantity = EXCLUDED.disposed_quantity, in_process_quantity = EXCLUDED.in_process_quantity,
             completed_quantity = EXCLUDED.completed_quantity, removal_fee = EXCLUDED.removal_fee, currency = EXCLUDED.currency,
             raw_metadata = EXCLUDED.raw_metadata, last_seen_at = EXCLUDED.last_seen_at, report_id = EXCLUDED.report_id,
             run_id = EXCLUDED.run_id`,
          [
            mk,
            JSON.stringify(
              batch.map((l) => ({
                removal_order_id: l.removalOrderId,
                seller_sku: l.sellerSku,
                normalized_sku: l.normalizedSku,
                fnsku: l.fnsku,
                disposition: l.disposition,
                order_status: l.orderStatus,
                status_group: l.statusGroup,
                request_date: l.requestDate,
                last_updated_at: l.lastUpdatedAt,
                requested_quantity: l.requestedQuantity,
                shipped_quantity: l.shippedQuantity,
                cancelled_quantity: l.cancelledQuantity,
                disposed_quantity: l.disposedQuantity,
                in_process_quantity: l.inProcessQuantity,
                completed_quantity: l.completedQuantity,
                removal_fee: l.removalFee,
                currency: l.currency,
                raw_metadata: l.raw || {},
              }))
            ),
            meta.seenAt,
            meta.reportId,
            meta.runId,
          ]
        )
        linesWritten += r.rowCount || 0
      }
      return { ordersWritten, linesWritten }
    })
  }

  async function listRemovalItems(mk: string, statusGroup: string | null, limit = 1000) {
    const params: unknown[] = [mk, Math.min(Math.max(1, limit), 5000)]
    let where = 'i.marketplace_key = $1'
    if (statusGroup) {
      params.push(statusGroup)
      where += ` AND i.status_group = $${params.length}`
    }
    const r = await q(
      `SELECT i.*, o.order_type, o.order_source, o.status_group AS order_status_group,
              m.amazon_title, COALESCE(i.asin, m.asin) AS resolved_asin
       FROM amazon_removal_order_items i
       JOIN amazon_removal_orders o ON o.marketplace_key = i.marketplace_key AND o.removal_order_id = i.removal_order_id
       LEFT JOIN LATERAL (
         SELECT amazon_title, asin FROM amazon_sku_master s
         WHERE s.marketplace_key = i.marketplace_key AND s.normalized_sku = i.normalized_sku
         ORDER BY s.amazon_title IS NULL, s.id LIMIT 1
       ) m ON TRUE
       WHERE ${where}
       ORDER BY i.request_date DESC NULLS LAST, i.removal_order_id, i.seller_sku
       LIMIT $2`,
      params
    )
    return r.rows.map((row) => ({
      id: Number(row.id),
      removalOrderId: row.removal_order_id,
      requestDate: iso(row.request_date),
      lastUpdatedAt: iso(row.last_updated_at),
      sellerSku: row.seller_sku,
      fnsku: row.fnsku || null,
      asin: row.resolved_asin || null,
      title: row.amazon_title || null,
      disposition: row.disposition || null,
      orderType: row.order_type,
      orderSource: row.order_source,
      orderStatus: row.order_status,
      statusGroup: row.status_group,
      orderStatusGroup: row.order_status_group,
      requestedQuantity: num(row.requested_quantity),
      shippedQuantity: num(row.shipped_quantity),
      cancelledQuantity: num(row.cancelled_quantity),
      disposedQuantity: num(row.disposed_quantity),
      inProcessQuantity: num(row.in_process_quantity),
      completedQuantity: num(row.completed_quantity),
      removalFee: num(row.removal_fee),
      currency: row.currency,
      firstSeenAt: iso(row.first_seen_at),
      lastSeenAt: iso(row.last_seen_at),
    }))
  }

  async function removalCounts(mk: string) {
    const r = await q(
      `SELECT status_group, COUNT(*)::int AS n FROM amazon_removal_order_items WHERE marketplace_key = $1 GROUP BY status_group`,
      [mk]
    )
    const out: Record<string, number> = { OPEN: 0, COMPLETED: 0, CANCELLED: 0, UNKNOWN: 0 }
    for (const row of r.rows) out[row.status_group] = Number(row.n)
    return out
  }

  async function listOpenRemovalOrders(mk: string) {
    const r = await q(
      `SELECT removal_order_id, order_status, status_group, request_date, last_updated_at FROM amazon_removal_orders
       WHERE marketplace_key = $1 AND status_group = 'OPEN'`,
      [mk]
    )
    return r.rows.map((row) => ({
      removalOrderId: row.removal_order_id,
      orderStatus: row.order_status,
      statusGroup: row.status_group,
      requestDate: iso(row.request_date),
      lastUpdatedAt: iso(row.last_updated_at),
    }))
  }

  // ---------- capacity periods ----------

  async function insertCapacityPeriod(mk: string, p: Record<string, any>, actor: string) {
    return tx(async (client) => {
      const cols = Object.keys(PERIOD_FIELDS).filter((k) => p[k] !== undefined)
      const params: unknown[] = [mk, actor]
      const values = cols.map((k) => {
        params.push(p[k])
        return `$${params.length}`
      })
      const r = await client.query(
        `INSERT INTO amazon_capacity_periods (marketplace_key, entered_by, ${cols.map((k) => PERIOD_FIELDS[k]).join(', ')})
         VALUES ($1, $2, ${values.join(', ')}) RETURNING *`,
        params
      )
      const period = mapPeriod(r.rows[0])
      await client.query(
        `INSERT INTO amazon_capacity_period_events (marketplace_key, period_id, action, changes, actor) VALUES ($1, $2, 'CREATED', $3::jsonb, $4)`,
        [mk, period.id, JSON.stringify(Object.fromEntries(cols.map((k) => [k, p[k]]))), actor]
      )
      return period
    })
  }

  /** New version of a current period; the previous row keeps its values and is marked superseded. */
  async function reviseCapacityPeriod(mk: string, id: number, patch: Record<string, any>, actor: string) {
    return tx(async (client) => {
      const cur = await client.query(`SELECT * FROM amazon_capacity_periods WHERE marketplace_key = $1 AND id = $2 FOR UPDATE`, [mk, id])
      if (!cur.rows[0]) return { error: 'NOT_FOUND' as const }
      const old = mapPeriod(cur.rows[0])
      if (old.supersededAt) return { error: 'SUPERSEDED' as const, supersededById: old.supersededById }
      const next: Record<string, any> = {}
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      for (const k of Object.keys(PERIOD_FIELDS)) {
        const before = (old as any)[k]
        const after = patch[k] !== undefined ? patch[k] : before
        next[k] = after
        if (EDITABLE_PERIOD_FIELDS.includes(k) && patch[k] !== undefined && String(before ?? '') !== String(after ?? '')) changes[k] = { from: before, to: after }
      }
      if (!Object.keys(changes).length) return { error: 'NO_CHANGES' as const }
      const cols = Object.keys(PERIOD_FIELDS)
      const params: unknown[] = [mk, actor, old.id]
      const values = cols.map((k) => {
        params.push(next[k] ?? null)
        return `$${params.length}`
      })
      const ins = await client.query(
        `INSERT INTO amazon_capacity_periods (marketplace_key, entered_by, supersedes_id, ${cols.map((k) => PERIOD_FIELDS[k]).join(', ')})
         VALUES ($1, $2, $3, ${values.join(', ')}) RETURNING *`,
        params
      )
      const period = mapPeriod(ins.rows[0])
      await client.query(
        `UPDATE amazon_capacity_periods SET superseded_by_id = $3, superseded_at = NOW(), updated_at = NOW()
         WHERE marketplace_key = $1 AND id = $2`,
        [mk, old.id, period.id]
      )
      await client.query(
        `INSERT INTO amazon_capacity_period_events (marketplace_key, period_id, previous_period_id, action, changes, actor)
         VALUES ($1, $2, $3, 'REVISED', $4::jsonb, $5)`,
        [mk, period.id, old.id, JSON.stringify(changes), actor]
      )
      return { period, previous: { ...old, supersededById: period.id }, changes }
    })
  }

  async function verifyCapacityPeriod(mk: string, id: number, actor: string) {
    return tx(async (client) => {
      const r = await client.query(
        `UPDATE amazon_capacity_periods SET verified_at = NOW(), verified_by = $3, updated_at = NOW()
         WHERE marketplace_key = $1 AND id = $2 AND superseded_at IS NULL RETURNING *`,
        [mk, id, actor]
      )
      if (!r.rows[0]) return null
      await client.query(
        `INSERT INTO amazon_capacity_period_events (marketplace_key, period_id, action, changes, actor) VALUES ($1, $2, 'VERIFIED', '{}'::jsonb, $3)`,
        [mk, id, actor]
      )
      return mapPeriod(r.rows[0])
    })
  }

  async function getCapacityPeriod(mk: string, id: number) {
    const r = await q(`SELECT * FROM amazon_capacity_periods WHERE marketplace_key = $1 AND id = $2`, [mk, id])
    return r.rows[0] ? mapPeriod(r.rows[0]) : null
  }

  async function listCapacityPeriods(mk: string) {
    const r = await q(`SELECT * FROM amazon_capacity_periods WHERE marketplace_key = $1 ORDER BY period_start DESC, entered_at DESC, id DESC`, [mk])
    return r.rows.map(mapPeriod)
  }

  /** Current (non-superseded) period covering `today` per storage type; latest entry wins when entries overlap. */
  async function currentCapacityPeriods(mk: string, today: string) {
    const r = await q(
      `SELECT DISTINCT ON (storage_type) * FROM amazon_capacity_periods
       WHERE marketplace_key = $1 AND superseded_at IS NULL AND period_start <= $2::date AND period_end >= $2::date
       ORDER BY storage_type, entered_at DESC, id DESC`,
      [mk, today]
    )
    return r.rows.map(mapPeriod)
  }

  async function listCapacityEvents(mk: string) {
    const r = await q(`SELECT * FROM amazon_capacity_period_events WHERE marketplace_key = $1 ORDER BY created_at DESC, id DESC LIMIT 500`, [mk])
    return r.rows.map((row) => ({
      id: Number(row.id),
      periodId: Number(row.period_id),
      previousPeriodId: row.previous_period_id == null ? null : Number(row.previous_period_id),
      action: row.action,
      changes: row.changes || {},
      actor: row.actor,
      createdAt: iso(row.created_at),
    }))
  }

  // ---------- actions ----------

  /** Upserts the current action set (re-opening resolved keys) and resolves open actions no longer raised. */
  async function syncActions(mk: string, actions: any[], at: Date) {
    return tx(async (client) => {
      let upserted = 0
      for (const batch of chunks(actions)) {
        const r = await client.query(
          `INSERT INTO amazon_control_tower_actions (
             marketplace_key, action_key, action_type, severity, title, detail, entity_type, entity_id, metadata,
             status, first_seen_at, last_seen_at
           )
           SELECT $1, x.action_key, x.action_type, x.severity, x.title, x.detail, x.entity_type, x.entity_id,
                  COALESCE(x.metadata, '{}'::jsonb), 'OPEN', $3, $3
           FROM jsonb_to_recordset($2::jsonb) AS x(
             action_key text, action_type text, severity text, title text, detail text, entity_type text, entity_id text, metadata jsonb
           )
           ON CONFLICT (action_key) DO UPDATE SET
             severity = EXCLUDED.severity, title = EXCLUDED.title, detail = EXCLUDED.detail, metadata = EXCLUDED.metadata,
             status = 'OPEN', resolved_at = NULL, last_seen_at = EXCLUDED.last_seen_at,
             first_seen_at = CASE WHEN amazon_control_tower_actions.status = 'RESOLVED' THEN EXCLUDED.first_seen_at ELSE amazon_control_tower_actions.first_seen_at END,
             updated_at = NOW()`,
          [
            mk,
            JSON.stringify(
              batch.map((a) => ({
                action_key: a.actionKey,
                action_type: a.actionType,
                severity: a.severity,
                title: a.title,
                detail: a.detail,
                entity_type: a.entityType,
                entity_id: a.entityId,
                metadata: a.metadata || {},
              }))
            ),
            at,
          ]
        )
        upserted += r.rowCount || 0
      }
      const resolved = await client.query(
        `UPDATE amazon_control_tower_actions SET status = 'RESOLVED', resolved_at = $3, updated_at = NOW()
         WHERE marketplace_key = $1 AND status = 'OPEN' AND NOT (action_key = ANY($2::text[]))`,
        [mk, actions.map((a) => a.actionKey), at]
      )
      return { upserted, resolved: resolved.rowCount || 0 }
    })
  }

  async function listActions(mk: string, status: 'OPEN' | 'RESOLVED' | null = 'OPEN') {
    const params: unknown[] = [mk]
    let where = 'marketplace_key = $1'
    if (status) {
      params.push(status)
      where += ` AND status = $2`
    }
    const r = await q(
      `SELECT * FROM amazon_control_tower_actions WHERE ${where}
       ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, last_seen_at DESC, action_key
       LIMIT 1000`,
      params
    )
    return r.rows.map(mapAction)
  }

  return {
    applyListingStatuses,
    writeAgeSnapshot,
    latestAgeSnapshot,
    upsertDimensions,
    listDimensions,
    insertUsageSnapshot,
    listUsageSnapshots,
    healthBaseRows,
    upsertRemovals,
    listRemovalItems,
    removalCounts,
    listOpenRemovalOrders,
    insertCapacityPeriod,
    reviseCapacityPeriod,
    verifyCapacityPeriod,
    getCapacityPeriod,
    listCapacityPeriods,
    currentCapacityPeriods,
    listCapacityEvents,
    syncActions,
    listActions,
  }
}

module.exports = { createCapacityHealthStore, _internals: { mapPeriod, PERIOD_FIELDS } }
