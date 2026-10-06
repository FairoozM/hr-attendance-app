'use strict'

/**
 * Postgres access for Control Tower data (settings, SKU master, snapshots, daily sales).
 * Only our own tables are written; nothing here talks to Amazon or Zoho.
 */

type QueryResult = { rows: any[]; rowCount?: number | null }
type Queryable = { query: (text: string, params?: unknown[]) => Promise<QueryResult> }
type DbLike = Queryable & { pool?: { connect: () => Promise<Queryable & { release: () => void }> } }

const BATCH_SIZE = 1000

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

function numOrNull(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function chunks<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Migration 062 defaults, used when a column is not present yet. */
const HEALTH_SETTING_DEFAULTS = {
  healthAgedMinDays: 181,
  healthExcessCoverDays: 180,
  healthLowCoverDays: 14,
  healthSlowUnitsPer30d: 3,
  healthVeryLowUnitsPer30d: 1,
  removalStuckDays: 14,
  capacityWarnPct: 80,
  capacityHighPct: 90,
  capacityCriticalPct: 100,
  usageCoverageMinPct: 95,
}

function numberOr(value: unknown, fallback: number): number {
  if (value == null) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function mapSettings(row: any) {
  if (!row) return null
  const d = HEALTH_SETTING_DEFAULTS
  return {
    marketplaceKey: row.marketplace_key,
    timezone: row.timezone,
    vatRate: Number(row.vat_rate),
    lowStockUnitsThreshold: Number(row.low_stock_units_threshold),
    targetCoverDays: Number(row.target_cover_days),
    maxCoverDays: Number(row.max_cover_days),
    defaultLeadTimeDays: Number(row.default_lead_time_days),
    defaultCartonQuantity: row.default_carton_quantity == null ? null : Number(row.default_carton_quantity),
    schedulerEnabled: Boolean(row.scheduler_enabled),
    healthAgedMinDays: numberOr(row.health_aged_min_days, d.healthAgedMinDays),
    healthExcessCoverDays: numberOr(row.health_excess_cover_days, d.healthExcessCoverDays),
    healthLowCoverDays: numberOr(row.health_low_cover_days, d.healthLowCoverDays),
    healthSlowUnitsPer30d: numberOr(row.health_slow_units_per_30d, d.healthSlowUnitsPer30d),
    healthVeryLowUnitsPer30d: numberOr(row.health_very_low_units_per_30d, d.healthVeryLowUnitsPer30d),
    removalStuckDays: numberOr(row.removal_stuck_days, d.removalStuckDays),
    capacityWarnPct: numberOr(row.capacity_warn_pct, d.capacityWarnPct),
    capacityHighPct: numberOr(row.capacity_high_pct, d.capacityHighPct),
    capacityCriticalPct: numberOr(row.capacity_critical_pct, d.capacityCriticalPct),
    usageCoverageMinPct: numberOr(row.usage_coverage_min_pct, d.usageCoverageMinPct),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function mapSkuMaster(row: any) {
  return {
    id: Number(row.id),
    marketplaceKey: row.marketplace_key,
    sellerSku: row.seller_sku,
    normalizedSku: row.normalized_sku,
    asin: row.asin,
    fnsku: row.fnsku,
    amazonTitle: row.amazon_title,
    fulfillmentChannel: row.fulfillment_channel,
    listingStatus: row.listing_status,
    amazonListingStatus: row.amazon_listing_status ?? null,
    amazonListingStatusRaw: row.amazon_listing_status_raw ?? null,
    amazonListingStatusReason: row.amazon_listing_status_reason ?? null,
    amazonListingStatusAt: iso(row.amazon_listing_status_at),
    searchSuppressed: row.search_suppressed == null ? null : Boolean(row.search_suppressed),
    zohoItemId: row.zoho_item_id,
    zohoItemCode: row.zoho_item_code,
    zohoItemName: row.zoho_item_name,
    mappingStatus: row.mapping_status,
    mappingMethod: row.mapping_method,
    mappingConfidence: numOrNull(row.mapping_confidence),
    mappingCandidates: Array.isArray(row.mapping_candidates) ? row.mapping_candidates : [],
    confirmedBy: row.confirmed_by,
    confirmedAt: iso(row.confirmed_at),
    packMultiplier: numOrNull(row.pack_multiplier),
    cartonQuantity: numOrNull(row.carton_quantity),
    minimumShipQuantity: numOrNull(row.minimum_ship_quantity),
    leadTimeDays: numOrNull(row.lead_time_days),
    targetCoverDays: numOrNull(row.target_cover_days),
    maxCoverDays: numOrNull(row.max_cover_days),
    strategicFlag: Boolean(row.strategic_flag),
    replenishmentEnabled: Boolean(row.replenishment_enabled),
    active: Boolean(row.active),
    lastSeenInListingsAt: iso(row.last_seen_in_listings_at),
    lastSeenInInventoryAt: iso(row.last_seen_in_inventory_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

const SETTINGS_COLUMNS: Record<string, string> = {
  lowStockUnitsThreshold: 'low_stock_units_threshold',
  targetCoverDays: 'target_cover_days',
  maxCoverDays: 'max_cover_days',
  defaultLeadTimeDays: 'default_lead_time_days',
  defaultCartonQuantity: 'default_carton_quantity',
  vatRate: 'vat_rate',
  healthAgedMinDays: 'health_aged_min_days',
  healthExcessCoverDays: 'health_excess_cover_days',
  healthLowCoverDays: 'health_low_cover_days',
  healthSlowUnitsPer30d: 'health_slow_units_per_30d',
  healthVeryLowUnitsPer30d: 'health_very_low_units_per_30d',
  removalStuckDays: 'removal_stuck_days',
  capacityWarnPct: 'capacity_warn_pct',
  capacityHighPct: 'capacity_high_pct',
  capacityCriticalPct: 'capacity_critical_pct',
  usageCoverageMinPct: 'usage_coverage_min_pct',
}

function createControlTowerStore(db: DbLike) {
  const q = (text: string, params: unknown[] = []) => db.query(text, params)

  async function withTransaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
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

  // ---------- settings ----------

  async function getSettings(marketplaceKey: string) {
    const r = await q(`SELECT * FROM amazon_marketplace_settings WHERE marketplace_key = $1`, [marketplaceKey])
    return mapSettings(r.rows[0])
  }

  async function updateSettings(marketplaceKey: string, patch: Record<string, unknown>) {
    const sets: string[] = []
    const params: unknown[] = [marketplaceKey]
    for (const [key, column] of Object.entries(SETTINGS_COLUMNS)) {
      if (!(key in patch)) continue
      params.push(patch[key])
      sets.push(`${column} = $${params.length}`)
    }
    if (!sets.length) return getSettings(marketplaceKey)
    const r = await q(
      `UPDATE amazon_marketplace_settings SET ${sets.join(', ')}, updated_at = NOW()
       WHERE marketplace_key = $1 RETURNING *`,
      params
    )
    return mapSettings(r.rows[0])
  }

  // ---------- SKU master ----------

  type ListingInput = {
    sellerSku: string
    normalizedSku: string
    asin: string | null
    title: string | null
    fulfillmentChannel: string | null
    listingStatus: string | null
  }

  async function upsertListings(marketplaceKey: string, listings: ListingInput[], seenAt: Date) {
    let affected = 0
    for (const batch of chunks(listings)) {
      const r = await q(
        `INSERT INTO amazon_sku_master (
           marketplace_key, seller_sku, normalized_sku, asin, amazon_title, fulfillment_channel, listing_status,
           active, last_seen_in_listings_at
         )
         SELECT $1, x.seller_sku, x.normalized_sku, x.asin, x.title, x.fulfillment_channel, x.listing_status, TRUE, $3
         FROM jsonb_to_recordset($2::jsonb) AS x(
           seller_sku text, normalized_sku text, asin text, title text, fulfillment_channel text, listing_status text
         )
         ON CONFLICT (marketplace_key, seller_sku) DO UPDATE SET
           normalized_sku = EXCLUDED.normalized_sku,
           asin = COALESCE(EXCLUDED.asin, amazon_sku_master.asin),
           amazon_title = COALESCE(EXCLUDED.amazon_title, amazon_sku_master.amazon_title),
           fulfillment_channel = COALESCE(EXCLUDED.fulfillment_channel, amazon_sku_master.fulfillment_channel),
           listing_status = EXCLUDED.listing_status,
           active = TRUE,
           last_seen_in_listings_at = EXCLUDED.last_seen_in_listings_at,
           updated_at = NOW()`,
        [
          marketplaceKey,
          JSON.stringify(
            batch.map((l) => ({
              seller_sku: l.sellerSku,
              normalized_sku: l.normalizedSku,
              asin: l.asin || null,
              title: l.title || null,
              fulfillment_channel: l.fulfillmentChannel || null,
              listing_status: l.listingStatus || 'ACTIVE',
            }))
          ),
          seenAt,
        ]
      )
      affected += r.rowCount || 0
    }
    return affected
  }

  /** SKUs absent from a successful, non-empty active-listings report are no longer active. */
  async function markListingsNotSeenInactive(marketplaceKey: string, seenAt: Date) {
    const r = await q(
      `UPDATE amazon_sku_master
       SET active = FALSE, listing_status = 'NOT_IN_ACTIVE_LISTINGS', updated_at = NOW()
       WHERE marketplace_key = $1 AND active = TRUE
         AND (last_seen_in_listings_at IS NULL OR last_seen_in_listings_at < $2)`,
      [marketplaceKey, seenAt]
    )
    return r.rowCount || 0
  }

  type InventorySkuInput = { sellerSku: string; normalizedSku: string; asin: string | null; fnsku: string | null; productName: string | null }

  /** FBA inventory fills ASIN/FNSKU/title and adds SKUs never seen in listings (inactive until listed). */
  async function upsertInventorySkus(marketplaceKey: string, skus: InventorySkuInput[], seenAt: Date) {
    let affected = 0
    for (const batch of chunks(skus)) {
      const r = await q(
        `INSERT INTO amazon_sku_master (
           marketplace_key, seller_sku, normalized_sku, asin, fnsku, amazon_title, active, last_seen_in_inventory_at
         )
         SELECT $1, x.seller_sku, x.normalized_sku, x.asin, x.fnsku, x.product_name, FALSE, $3
         FROM jsonb_to_recordset($2::jsonb) AS x(seller_sku text, normalized_sku text, asin text, fnsku text, product_name text)
         ON CONFLICT (marketplace_key, seller_sku) DO UPDATE SET
           asin = COALESCE(amazon_sku_master.asin, EXCLUDED.asin),
           fnsku = COALESCE(EXCLUDED.fnsku, amazon_sku_master.fnsku),
           amazon_title = COALESCE(amazon_sku_master.amazon_title, EXCLUDED.amazon_title),
           last_seen_in_inventory_at = EXCLUDED.last_seen_in_inventory_at,
           updated_at = NOW()`,
        [
          marketplaceKey,
          JSON.stringify(
            batch.map((s) => ({
              seller_sku: s.sellerSku,
              normalized_sku: s.normalizedSku,
              asin: s.asin,
              fnsku: s.fnsku,
              product_name: s.productName,
            }))
          ),
          seenAt,
        ]
      )
      affected += r.rowCount || 0
    }
    return affected
  }

  /** Rows the auto-matcher may (re)suggest for: no human decision recorded. */
  async function listSkusForAutoMatch(marketplaceKey: string) {
    const r = await q(
      `SELECT id, seller_sku FROM amazon_sku_master
       WHERE marketplace_key = $1 AND confirmed_by IS NULL AND mapping_status <> 'CONFIRMED'`,
      [marketplaceKey]
    )
    return r.rows.map((row) => ({ id: Number(row.id), sellerSku: String(row.seller_sku) }))
  }

  type MatchUpdate = {
    id: number
    status: string
    zohoItemId: string | null
    itemCode: string | null
    itemName: string | null
    method: string | null
    confidence: number | null
    candidates: unknown[]
  }

  async function applyAutoMatches(marketplaceKey: string, updates: MatchUpdate[]) {
    let changed = 0
    for (const batch of chunks(updates)) {
      const r = await q(
        `UPDATE amazon_sku_master m SET
           mapping_status = x.status,
           zoho_item_id = x.zoho_item_id,
           zoho_item_code = x.item_code,
           zoho_item_name = x.item_name,
           mapping_method = x.method,
           mapping_confidence = x.confidence,
           mapping_candidates = COALESCE(x.candidates, '[]'::jsonb),
           updated_at = NOW()
         FROM jsonb_to_recordset($2::jsonb) AS x(
           id bigint, status text, zoho_item_id text, item_code text, item_name text, method text,
           confidence numeric, candidates jsonb
         )
         WHERE m.id = x.id AND m.marketplace_key = $1
           AND m.confirmed_by IS NULL AND m.mapping_status <> 'CONFIRMED'
           AND (m.mapping_status IS DISTINCT FROM x.status
             OR m.zoho_item_id IS DISTINCT FROM x.zoho_item_id
             OR m.mapping_method IS DISTINCT FROM x.method
             OR m.mapping_confidence IS DISTINCT FROM x.confidence
             OR m.mapping_candidates IS DISTINCT FROM COALESCE(x.candidates, '[]'::jsonb))`,
        [
          marketplaceKey,
          JSON.stringify(
            batch.map((u) => ({
              id: u.id,
              status: u.status,
              zoho_item_id: u.zohoItemId,
              item_code: u.itemCode,
              item_name: u.itemName,
              method: u.method,
              confidence: u.confidence,
              candidates: u.candidates || [],
            }))
          ),
        ]
      )
      changed += r.rowCount || 0
    }
    return changed
  }

  async function listSkuMaster(
    marketplaceKey: string,
    { status, search, activeOnly, limit = 200, offset = 0 }: { status?: string; search?: string; activeOnly?: boolean; limit?: number; offset?: number } = {}
  ) {
    const where = ['marketplace_key = $1']
    const params: unknown[] = [marketplaceKey]
    if (status) {
      params.push(status)
      where.push(`mapping_status = $${params.length}`)
    }
    if (activeOnly) where.push('active = TRUE')
    if (search) {
      params.push(`%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
      const p = `$${params.length}`
      where.push(`(seller_sku ILIKE ${p} OR asin ILIKE ${p} OR amazon_title ILIKE ${p} OR zoho_item_code ILIKE ${p} OR zoho_item_name ILIKE ${p})`)
    }
    const whereSql = where.join(' AND ')
    const total = await q(`SELECT COUNT(*)::int AS n FROM amazon_sku_master WHERE ${whereSql}`, params)
    const lim = Math.min(Math.max(1, Number(limit) || 200), 1000)
    const off = Math.max(0, Number(offset) || 0)
    const rows = await q(
      `SELECT * FROM amazon_sku_master WHERE ${whereSql}
       ORDER BY CASE mapping_status WHEN 'REVIEW_REQUIRED' THEN 0 WHEN 'UNMAPPED' THEN 1 WHEN 'AUTO_MATCHED' THEN 2 ELSE 3 END,
                active DESC, seller_sku
       LIMIT ${lim} OFFSET ${off}`,
      params
    )
    const counts = await q(
      `SELECT mapping_status, COUNT(*)::int AS n FROM amazon_sku_master
       WHERE marketplace_key = $1 GROUP BY mapping_status`,
      [marketplaceKey]
    )
    const statusCounts: Record<string, number> = { CONFIRMED: 0, AUTO_MATCHED: 0, REVIEW_REQUIRED: 0, UNMAPPED: 0 }
    for (const row of counts.rows) statusCounts[row.mapping_status] = Number(row.n)
    return { rows: rows.rows.map(mapSkuMaster), total: Number(total.rows[0]?.n || 0), statusCounts }
  }

  async function getSkuMasterRow(marketplaceKey: string, id: number) {
    const r = await q(`SELECT * FROM amazon_sku_master WHERE marketplace_key = $1 AND id = $2`, [marketplaceKey, id])
    return r.rows[0] ? mapSkuMaster(r.rows[0]) : null
  }

  async function confirmMapping(
    marketplaceKey: string,
    id: number,
    target: { zohoItemId: string; itemCode: string | null; itemName: string | null; method: string },
    actor: string
  ) {
    const r = await q(
      `UPDATE amazon_sku_master SET
         zoho_item_id = $3, zoho_item_code = $4, zoho_item_name = $5,
         mapping_status = 'CONFIRMED', mapping_method = $6, mapping_confidence = 1,
         confirmed_by = $7, confirmed_at = NOW(), updated_at = NOW()
       WHERE marketplace_key = $1 AND id = $2
       RETURNING *`,
      [marketplaceKey, id, target.zohoItemId, target.itemCode, target.itemName, target.method, actor]
    )
    return r.rows[0] ? mapSkuMaster(r.rows[0]) : null
  }

  async function markUnmapped(marketplaceKey: string, id: number, actor: string) {
    const r = await q(
      `UPDATE amazon_sku_master SET
         zoho_item_id = NULL, zoho_item_code = NULL, zoho_item_name = NULL,
         mapping_status = 'UNMAPPED', mapping_method = 'MANUAL_UNMAPPED', mapping_confidence = NULL,
         confirmed_by = $3, confirmed_at = NOW(), updated_at = NOW()
       WHERE marketplace_key = $1 AND id = $2
       RETURNING *`,
      [marketplaceKey, id, actor]
    )
    return r.rows[0] ? mapSkuMaster(r.rows[0]) : null
  }

  async function updateSkuParameters(
    marketplaceKey: string,
    id: number,
    patch: { packMultiplier?: number; cartonQuantity?: number | null }
  ) {
    const sets: string[] = []
    const params: unknown[] = [marketplaceKey, id]
    if (patch.packMultiplier !== undefined) {
      params.push(patch.packMultiplier)
      sets.push(`pack_multiplier = $${params.length}`)
    }
    if (patch.cartonQuantity !== undefined) {
      params.push(patch.cartonQuantity)
      sets.push(`carton_quantity = $${params.length}`)
    }
    if (!sets.length) return getSkuMasterRow(marketplaceKey, id)
    const r = await q(
      `UPDATE amazon_sku_master SET ${sets.join(', ')}, updated_at = NOW()
       WHERE marketplace_key = $1 AND id = $2 RETURNING *`,
      params
    )
    return r.rows[0] ? mapSkuMaster(r.rows[0]) : null
  }

  // ---------- warehouse snapshots ----------

  async function latestWarehouseSnapshotAt(): Promise<string | null> {
    const r = await q(`SELECT MAX(snapshot_at) AS t FROM amazon_warehouse_stock_snapshots`)
    return iso(r.rows[0]?.t)
  }

  async function latestWarehouseCatalog() {
    const r = await q(
      `SELECT zoho_item_id, item_code, item_name FROM amazon_warehouse_stock_snapshots
       WHERE snapshot_at = (SELECT MAX(snapshot_at) FROM amazon_warehouse_stock_snapshots)`
    )
    return r.rows.map((row) => ({ zohoItemId: String(row.zoho_item_id), itemCode: row.item_code, itemName: row.item_name }))
  }

  async function findWarehouseItem(zohoItemId: string) {
    const r = await q(
      `SELECT zoho_item_id, item_code, item_name FROM amazon_warehouse_stock_snapshots
       WHERE zoho_item_id = $1 ORDER BY snapshot_at DESC LIMIT 1`,
      [zohoItemId]
    )
    const row = r.rows[0]
    return row ? { zohoItemId: String(row.zoho_item_id), itemCode: row.item_code, itemName: row.item_name } : null
  }

  async function searchWarehouseItems(search: string, limit = 25) {
    const term = `%${String(search || '').replace(/[%_\\]/g, (c) => `\\${c}`)}%`
    const r = await q(
      `SELECT zoho_item_id, item_code, item_name, on_hand, available_for_sale, committed_stock
       FROM amazon_warehouse_stock_snapshots
       WHERE snapshot_at = (SELECT MAX(snapshot_at) FROM amazon_warehouse_stock_snapshots)
         AND (item_code ILIKE $1 OR item_name ILIKE $1 OR zoho_item_id = $2)
       ORDER BY item_name NULLS LAST
       LIMIT $3`,
      [term, String(search || '').trim(), Math.min(Math.max(1, limit), 100)]
    )
    return r.rows.map((row) => ({
      zohoItemId: String(row.zoho_item_id),
      itemCode: row.item_code,
      itemName: row.item_name,
      onHand: numOrNull(row.on_hand),
      availableForSale: numOrNull(row.available_for_sale),
      committedStock: numOrNull(row.committed_stock),
    }))
  }

  type WarehouseRow = {
    zohoItemId: string
    itemCode: string | null
    itemName: string | null
    itemStatus: string | null
    onHand: number | null
    availableForSale: number | null
    committedStock: number | null
    stockScope: string
  }

  async function writeWarehouseSnapshot(
    rows: WarehouseRow[],
    meta: { snapshotAt: Date; snapshotDate: string; warehouseId: string; fetchedAt: Date; runId: string | null }
  ) {
    return withTransaction(async (client) => {
      let written = 0
      for (const batch of chunks(rows)) {
        const r = await client.query(
          `INSERT INTO amazon_warehouse_stock_snapshots (
             zoho_item_id, item_code, item_name, item_status, snapshot_at, snapshot_date,
             on_hand, available_for_sale, committed_stock, stock_scope, source_warehouse_id, run_id, fetched_at
           )
           SELECT x.zoho_item_id, x.item_code, x.item_name, x.item_status, $2, $3::date,
                  x.on_hand, x.available_for_sale, x.committed_stock, x.stock_scope, $4, $5, $6
           FROM jsonb_to_recordset($1::jsonb) AS x(
             zoho_item_id text, item_code text, item_name text, item_status text,
             on_hand numeric, available_for_sale numeric, committed_stock numeric, stock_scope text
           )
           ON CONFLICT (source_warehouse_id, zoho_item_id, snapshot_at) DO UPDATE SET
             item_code = EXCLUDED.item_code, item_name = EXCLUDED.item_name, item_status = EXCLUDED.item_status,
             on_hand = EXCLUDED.on_hand, available_for_sale = EXCLUDED.available_for_sale,
             committed_stock = EXCLUDED.committed_stock, stock_scope = EXCLUDED.stock_scope,
             run_id = EXCLUDED.run_id, fetched_at = EXCLUDED.fetched_at`,
          [
            JSON.stringify(
              batch.map((w) => ({
                zoho_item_id: w.zohoItemId,
                item_code: w.itemCode,
                item_name: w.itemName,
                item_status: w.itemStatus,
                on_hand: w.onHand,
                available_for_sale: w.availableForSale,
                committed_stock: w.committedStock,
                stock_scope: w.stockScope,
              }))
            ),
            meta.snapshotAt,
            meta.snapshotDate,
            meta.warehouseId,
            meta.runId,
            meta.fetchedAt,
          ]
        )
        written += r.rowCount || 0
      }
      return written
    })
  }

  // ---------- FBA inventory snapshots ----------

  async function writeInventorySnapshot(
    marketplaceKey: string,
    rows: any[],
    meta: { snapshotAt: Date; snapshotDate: string; fetchedAt: Date; runId: string | null }
  ) {
    return withTransaction(async (client) => {
      let written = 0
      for (const batch of chunks(rows)) {
        const r = await client.query(
          `INSERT INTO amazon_inventory_snapshots (
             marketplace_key, seller_sku, normalized_sku, asin, fnsku, snapshot_at, snapshot_date,
             fulfillable_quantity, inbound_working_quantity, inbound_shipped_quantity, inbound_receiving_quantity,
             reserved_quantity, reserved_customer_orders, reserved_fc_transfer, reserved_fc_processing,
             unfulfillable_quantity, researching_quantity, total_quantity, amazon_last_updated_at,
             source, run_id, fetched_at
           )
           SELECT $1, x.seller_sku, x.normalized_sku, x.asin, x.fnsku, $3, $4::date,
                  x.fulfillable_quantity, x.inbound_working_quantity, x.inbound_shipped_quantity, x.inbound_receiving_quantity,
                  x.reserved_quantity, x.reserved_customer_orders, x.reserved_fc_transfer, x.reserved_fc_processing,
                  x.unfulfillable_quantity, x.researching_quantity, x.total_quantity, x.amazon_last_updated_at,
                  'fba_inventory_api', $5, $6
           FROM jsonb_to_recordset($2::jsonb) AS x(
             seller_sku text, normalized_sku text, asin text, fnsku text,
             fulfillable_quantity int, inbound_working_quantity int, inbound_shipped_quantity int, inbound_receiving_quantity int,
             reserved_quantity int, reserved_customer_orders int, reserved_fc_transfer int, reserved_fc_processing int,
             unfulfillable_quantity int, researching_quantity int, total_quantity int, amazon_last_updated_at timestamptz
           )
           ON CONFLICT (marketplace_key, seller_sku, snapshot_at) DO UPDATE SET
             normalized_sku = EXCLUDED.normalized_sku, asin = EXCLUDED.asin, fnsku = EXCLUDED.fnsku,
             fulfillable_quantity = EXCLUDED.fulfillable_quantity,
             inbound_working_quantity = EXCLUDED.inbound_working_quantity,
             inbound_shipped_quantity = EXCLUDED.inbound_shipped_quantity,
             inbound_receiving_quantity = EXCLUDED.inbound_receiving_quantity,
             reserved_quantity = EXCLUDED.reserved_quantity,
             reserved_customer_orders = EXCLUDED.reserved_customer_orders,
             reserved_fc_transfer = EXCLUDED.reserved_fc_transfer,
             reserved_fc_processing = EXCLUDED.reserved_fc_processing,
             unfulfillable_quantity = EXCLUDED.unfulfillable_quantity,
             researching_quantity = EXCLUDED.researching_quantity,
             total_quantity = EXCLUDED.total_quantity,
             amazon_last_updated_at = EXCLUDED.amazon_last_updated_at,
             run_id = EXCLUDED.run_id, fetched_at = EXCLUDED.fetched_at`,
          [
            marketplaceKey,
            JSON.stringify(
              batch.map((d) => ({
                seller_sku: d.sellerSku,
                normalized_sku: d.normalizedSku,
                asin: d.asin,
                fnsku: d.fnsku,
                fulfillable_quantity: d.fulfillableQuantity,
                inbound_working_quantity: d.inboundWorkingQuantity,
                inbound_shipped_quantity: d.inboundShippedQuantity,
                inbound_receiving_quantity: d.inboundReceivingQuantity,
                reserved_quantity: d.reservedQuantity,
                reserved_customer_orders: d.reservedCustomerOrders,
                reserved_fc_transfer: d.reservedFcTransfer,
                reserved_fc_processing: d.reservedFcProcessing,
                unfulfillable_quantity: d.unfulfillableQuantity,
                researching_quantity: d.researchingQuantity,
                total_quantity: d.totalQuantity,
                amazon_last_updated_at: d.amazonLastUpdatedAt,
              }))
            ),
            meta.snapshotAt,
            meta.snapshotDate,
            meta.runId,
            meta.fetchedAt,
          ]
        )
        written += r.rowCount || 0
      }
      return written
    })
  }

  // ---------- order lines / daily sales ----------

  async function selectOrderLinesForRollup(marketplaceKey: string, start: Date, end: Date) {
    const r = await q(
      `SELECT amazon_order_id, order_item_id, purchase_date, order_status, item_status, seller_sku, asin,
              quantity, currency, item_price, item_tax, item_promotion_discount
       FROM amazon_order_report_lines
       WHERE marketplace_key = $1 AND purchase_date >= $2::timestamptz AND purchase_date < $3::timestamptz`,
      [marketplaceKey, start, end]
    )
    return r.rows
  }

  /** Rebuilds [fromDate, toDate] for a marketplace. Derived data only; source lines are untouched. */
  async function replaceDailySales(marketplaceKey: string, fromDate: string, toDate: string, rows: any[]) {
    return withTransaction(async (client) => {
      const del = await client.query(
        `DELETE FROM amazon_sku_daily_sales WHERE marketplace_key = $1 AND sales_date BETWEEN $2::date AND $3::date`,
        [marketplaceKey, fromDate, toDate]
      )
      let written = 0
      for (const batch of chunks(rows)) {
        const r = await client.query(
          `INSERT INTO amazon_sku_daily_sales (
             marketplace_key, sales_date, seller_sku, asin, units_ordered, units_cancelled, order_count,
             cancelled_order_count, gross_item_sales, item_tax, promotions, net_sales_ex_vat,
             lines_without_price, currency, updated_at
           )
           SELECT $1, x.sales_date, x.seller_sku, x.asin, x.units_ordered, x.units_cancelled, x.order_count,
                  x.cancelled_order_count, x.gross_item_sales, x.item_tax, x.promotions, x.net_sales_ex_vat,
                  x.lines_without_price, x.currency, NOW()
           FROM jsonb_to_recordset($2::jsonb) AS x(
             sales_date date, seller_sku text, asin text, units_ordered int, units_cancelled int, order_count int,
             cancelled_order_count int, gross_item_sales numeric, item_tax numeric, promotions numeric,
             net_sales_ex_vat numeric, lines_without_price int, currency text
           )`,
          [
            marketplaceKey,
            JSON.stringify(
              batch.map((row) => ({
                sales_date: row.salesDate,
                seller_sku: row.sellerSku,
                asin: row.asin,
                units_ordered: row.unitsOrdered,
                units_cancelled: row.unitsCancelled,
                order_count: row.orderCount,
                cancelled_order_count: row.cancelledOrderCount,
                gross_item_sales: row.grossItemSales,
                item_tax: row.itemTax,
                promotions: row.promotions,
                net_sales_ex_vat: row.netSalesExVat,
                lines_without_price: row.linesWithoutPrice,
                currency: row.currency,
              }))
            ),
          ]
        )
        written += r.rowCount || 0
      }
      return { deleted: del.rowCount || 0, written }
    })
  }

  async function orderLineCoverage(marketplaceKey: string) {
    const r = await q(
      `SELECT MIN(purchase_date) AS first_at, MAX(purchase_date) AS last_at, COUNT(*)::int AS lines
       FROM amazon_order_report_lines WHERE marketplace_key = $1`,
      [marketplaceKey]
    )
    const row = r.rows[0] || {}
    return { firstPurchaseAt: iso(row.first_at), lastPurchaseAt: iso(row.last_at), lineCount: Number(row.lines || 0) }
  }

  async function dailySalesCoverage(marketplaceKey: string) {
    const r = await q(
      `SELECT MIN(sales_date) AS first_date, MAX(sales_date) AS last_date, COUNT(DISTINCT sales_date)::int AS days
       FROM amazon_sku_daily_sales WHERE marketplace_key = $1`,
      [marketplaceKey]
    )
    const row = r.rows[0] || {}
    return { firstDate: dateOnly(row.first_date), lastDate: dateOnly(row.last_date), daysWithSales: Number(row.days || 0) }
  }

  /** Latest successful `orders_report` sync for this marketplace (shared with other modules). */
  async function lastOrderReportSync(marketplaceKey: string) {
    const r = await q(
      `SELECT
         (SELECT MAX(finished_at) FROM amazon_sync_log WHERE marketplace_key = $1 AND sync_type = 'orders_report' AND status = 'success') AS last_success_at,
         f.finished_at AS last_failure_at, f.error_message AS last_error
       FROM (SELECT 1) one
       LEFT JOIN LATERAL (
         SELECT finished_at, error_message FROM amazon_sync_log
         WHERE marketplace_key = $1 AND sync_type = 'orders_report' AND status = 'failed'
         ORDER BY finished_at DESC NULLS LAST LIMIT 1
       ) f ON TRUE`,
      [marketplaceKey]
    )
    const row = r.rows[0] || {}
    return { lastSuccessAt: iso(row.last_success_at), lastFailureAt: iso(row.last_failure_at), lastError: row.last_error ?? null }
  }

  // ---------- command center ----------

  async function salesTotals(marketplaceKey: string, fromDate: string, toDate: string) {
    const r = await q(
      `SELECT COALESCE(SUM(net_sales_ex_vat), 0) AS net, COALESCE(SUM(gross_item_sales), 0) AS gross,
              COALESCE(SUM(units_ordered), 0)::int AS units, COUNT(*)::int AS rows
       FROM amazon_sku_daily_sales
       WHERE marketplace_key = $1 AND sales_date BETWEEN $2::date AND $3::date`,
      [marketplaceKey, fromDate, toDate]
    )
    const row = r.rows[0] || {}
    return { netSalesExVat: Number(row.net || 0), grossItemSales: Number(row.gross || 0), units: Number(row.units || 0), rows: Number(row.rows || 0) }
  }

  async function latestInventorySnapshotAt(marketplaceKey: string): Promise<string | null> {
    const r = await q(`SELECT MAX(snapshot_at) AS t FROM amazon_inventory_snapshots WHERE marketplace_key = $1`, [marketplaceKey])
    return iso(r.rows[0]?.t)
  }

  async function inventoryTotals(marketplaceKey: string) {
    const r = await q(
      `SELECT COUNT(*)::int AS skus,
              SUM(fulfillable_quantity)::bigint AS fulfillable,
              SUM(COALESCE(inbound_working_quantity, 0) + COALESCE(inbound_shipped_quantity, 0) + COALESCE(inbound_receiving_quantity, 0))::bigint AS inbound,
              SUM(reserved_quantity)::bigint AS reserved,
              SUM(unfulfillable_quantity)::bigint AS unfulfillable,
              SUM(researching_quantity)::bigint AS researching
       FROM amazon_inventory_snapshots
       WHERE marketplace_key = $1
         AND snapshot_at = (SELECT MAX(snapshot_at) FROM amazon_inventory_snapshots WHERE marketplace_key = $1)`,
      [marketplaceKey]
    )
    const row = r.rows[0] || {}
    return {
      skus: Number(row.skus || 0),
      fulfillable: numOrNull(row.fulfillable),
      inbound: numOrNull(row.inbound),
      reserved: numOrNull(row.reserved),
      unfulfillable: numOrNull(row.unfulfillable),
      researching: numOrNull(row.researching),
    }
  }

  /** One row per SKU-master entry with latest FBA, mapped warehouse stock and 7D/30D units. */
  async function skuStockView(marketplaceKey: string, { from7, from30, toDate }: { from7: string; from30: string; toDate: string }) {
    const r = await q(
      `WITH inv AS (
         SELECT DISTINCT ON (normalized_sku) *
         FROM amazon_inventory_snapshots
         WHERE marketplace_key = $1
           AND snapshot_at = (SELECT MAX(snapshot_at) FROM amazon_inventory_snapshots WHERE marketplace_key = $1)
         ORDER BY normalized_sku, fulfillable_quantity DESC NULLS LAST
       ),
       wh AS (
         SELECT DISTINCT ON (zoho_item_id) zoho_item_id, on_hand, available_for_sale, committed_stock
         FROM amazon_warehouse_stock_snapshots
         WHERE snapshot_at = (SELECT MAX(snapshot_at) FROM amazon_warehouse_stock_snapshots)
         ORDER BY zoho_item_id
       ),
       sales AS (
         SELECT seller_sku,
                COALESCE(SUM(units_ordered) FILTER (WHERE sales_date >= $2::date), 0)::int AS units_7d,
                COALESCE(SUM(units_ordered), 0)::int AS units_30d
         FROM amazon_sku_daily_sales
         WHERE marketplace_key = $1 AND sales_date BETWEEN $3::date AND $4::date
         GROUP BY seller_sku
       )
       SELECT m.id, m.seller_sku, m.normalized_sku, m.asin, m.amazon_title, m.active,
              m.amazon_listing_status, m.fulfillment_channel,
              m.mapping_status, m.mapping_method, m.mapping_confidence, m.mapping_candidates,
              m.zoho_item_id, m.zoho_item_code, m.zoho_item_name, m.pack_multiplier,
              inv.snapshot_at AS inventory_snapshot_at,
              inv.fulfillable_quantity,
              inv.inbound_working_quantity, inv.inbound_shipped_quantity, inv.inbound_receiving_quantity,
              inv.reserved_quantity, inv.unfulfillable_quantity, inv.total_quantity,
              wh.available_for_sale AS warehouse_available_for_sale, wh.on_hand AS warehouse_on_hand,
              COALESCE(sales.units_7d, 0) AS units_7d, COALESCE(sales.units_30d, 0) AS units_30d
       FROM amazon_sku_master m
       LEFT JOIN inv ON inv.normalized_sku = m.normalized_sku
       LEFT JOIN wh ON wh.zoho_item_id = m.zoho_item_id AND m.mapping_status IN ('CONFIRMED', 'AUTO_MATCHED')
       LEFT JOIN sales ON sales.seller_sku = m.normalized_sku
       WHERE m.marketplace_key = $1`,
      [marketplaceKey, from7, from30, toDate]
    )
    return r.rows.map((row) => {
      const inboundParts = [row.inbound_working_quantity, row.inbound_shipped_quantity, row.inbound_receiving_quantity].filter((v) => v != null)
      return {
        id: Number(row.id),
        sellerSku: row.seller_sku,
        normalizedSku: row.normalized_sku,
        asin: row.asin,
        title: row.amazon_title,
        active: Boolean(row.active),
        amazonListingStatus: row.amazon_listing_status ?? null,
        fulfillmentChannel: row.fulfillment_channel ?? null,
        mappingStatus: row.mapping_status,
        mappingMethod: row.mapping_method,
        mappingConfidence: numOrNull(row.mapping_confidence),
        mappingCandidates: Array.isArray(row.mapping_candidates) ? row.mapping_candidates : [],
        zohoItemId: row.zoho_item_id,
        zohoItemCode: row.zoho_item_code,
        zohoItemName: row.zoho_item_name,
        packMultiplier: numOrNull(row.pack_multiplier),
        hasInventorySnapshot: row.inventory_snapshot_at != null,
        fbaFulfillable: numOrNull(row.fulfillable_quantity),
        inbound: inboundParts.length ? inboundParts.reduce((a: number, b: any) => a + Number(b), 0) : null,
        reserved: numOrNull(row.reserved_quantity),
        unfulfillable: numOrNull(row.unfulfillable_quantity),
        totalQuantity: numOrNull(row.total_quantity),
        warehouseAvailable: numOrNull(row.warehouse_available_for_sale),
        warehouseOnHand: numOrNull(row.warehouse_on_hand),
        units7d: Number(row.units_7d || 0),
        units30d: Number(row.units_30d || 0),
      }
    })
  }

  return {
    withTransaction,
    getSettings,
    updateSettings,
    upsertListings,
    markListingsNotSeenInactive,
    upsertInventorySkus,
    listSkusForAutoMatch,
    applyAutoMatches,
    listSkuMaster,
    getSkuMasterRow,
    confirmMapping,
    markUnmapped,
    updateSkuParameters,
    latestWarehouseSnapshotAt,
    latestWarehouseCatalog,
    findWarehouseItem,
    searchWarehouseItems,
    writeWarehouseSnapshot,
    writeInventorySnapshot,
    selectOrderLinesForRollup,
    replaceDailySales,
    orderLineCoverage,
    dailySalesCoverage,
    lastOrderReportSync,
    salesTotals,
    latestInventorySnapshotAt,
    inventoryTotals,
    skuStockView,
  }
}

module.exports = { createControlTowerStore, HEALTH_SETTING_DEFAULTS, _internals: { mapSkuMaster, mapSettings, dateOnly } }
