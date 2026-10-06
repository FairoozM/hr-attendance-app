'use strict'

/**
 * Amazon Control Tower tables (mirrored by migrations/061_amazon_control_tower_foundation.sql).
 *
 * Everything here is our own data: refresh job state, the per-marketplace SKU master and its Zoho
 * mapping decisions, FBA inventory and warehouse stock history, and the daily sales rollup built
 * from `amazon_order_report_lines`. Nothing in these tables is ever pushed to Amazon or Zoho.
 */

type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>

const MARKETPLACE_CHECK = "CHECK (marketplace_key IN ('uae', 'ksa'))"

const CONTROL_TOWER_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS amazon_marketplace_settings (
    marketplace_key TEXT PRIMARY KEY ${MARKETPLACE_CHECK},
    timezone TEXT NOT NULL,
    vat_rate NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0 AND vat_rate < 1),
    low_stock_units_threshold INTEGER NOT NULL DEFAULT 10 CHECK (low_stock_units_threshold >= 0),
    target_cover_days INTEGER NOT NULL DEFAULT 45 CHECK (target_cover_days > 0),
    max_cover_days INTEGER NOT NULL DEFAULT 90 CHECK (max_cover_days > 0),
    default_lead_time_days INTEGER NOT NULL DEFAULT 14 CHECK (default_lead_time_days >= 0),
    default_carton_quantity INTEGER CHECK (default_carton_quantity IS NULL OR default_carton_quantity > 0),
    scheduler_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `INSERT INTO amazon_marketplace_settings (marketplace_key, timezone, vat_rate)
   VALUES ('ksa', 'Asia/Riyadh', 0.15)
   ON CONFLICT (marketplace_key) DO NOTHING`,

  `CREATE TABLE IF NOT EXISTS amazon_refresh_runs (
    id UUID PRIMARY KEY,
    marketplace_key TEXT NOT NULL ${MARKETPLACE_CHECK},
    job_type TEXT NOT NULL,
    trigger_source TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_source IN ('manual', 'scheduler', 'parent')),
    parent_run_id UUID REFERENCES amazon_refresh_runs(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped', 'interrupted')),
    current_step TEXT,
    progress_current INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER NOT NULL DEFAULT 0,
    records_processed INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    requested_by TEXT,
    process_tag TEXT,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    heartbeat_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // At most one queued/running run per (marketplace, job type) across every instance.
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_amazon_refresh_runs_active
     ON amazon_refresh_runs (marketplace_key, job_type)
     WHERE status IN ('queued', 'running')`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_refresh_runs_type_time
     ON amazon_refresh_runs (marketplace_key, job_type, queued_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_refresh_runs_parent
     ON amazon_refresh_runs (parent_run_id) WHERE parent_run_id IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS amazon_refresh_schedules (
    id BIGSERIAL PRIMARY KEY,
    marketplace_key TEXT NOT NULL ${MARKETPLACE_CHECK},
    job_type TEXT NOT NULL,
    interval_minutes INTEGER NOT NULL CHECK (interval_minutes >= 15),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    next_run_at TIMESTAMPTZ,
    last_run_id UUID,
    last_run_at TIMESTAMPTZ,
    last_status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (marketplace_key, job_type)
  )`,
  `INSERT INTO amazon_refresh_schedules (marketplace_key, job_type, interval_minutes, enabled)
   VALUES ('ksa', 'listings', 1440, FALSE),
          ('ksa', 'sales', 60, FALSE),
          ('ksa', 'fba_inventory', 60, FALSE),
          ('ksa', 'warehouse_stock', 180, FALSE)
   ON CONFLICT (marketplace_key, job_type) DO NOTHING`,

  `CREATE TABLE IF NOT EXISTS amazon_sku_master (
    id BIGSERIAL PRIMARY KEY,
    marketplace_key TEXT NOT NULL ${MARKETPLACE_CHECK},
    seller_sku TEXT NOT NULL,
    normalized_sku TEXT NOT NULL,
    asin TEXT,
    fnsku TEXT,
    amazon_title TEXT,
    fulfillment_channel TEXT,
    listing_status TEXT,
    zoho_item_id TEXT,
    zoho_item_code TEXT,
    zoho_item_name TEXT,
    mapping_status TEXT NOT NULL DEFAULT 'UNMAPPED'
      CHECK (mapping_status IN ('CONFIRMED', 'AUTO_MATCHED', 'REVIEW_REQUIRED', 'UNMAPPED')),
    mapping_method TEXT,
    mapping_confidence NUMERIC(4, 3)
      CHECK (mapping_confidence IS NULL OR (mapping_confidence >= 0 AND mapping_confidence <= 1)),
    mapping_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
    confirmed_by TEXT,
    confirmed_at TIMESTAMPTZ,
    pack_multiplier NUMERIC(12, 4) NOT NULL DEFAULT 1 CHECK (pack_multiplier > 0),
    carton_quantity INTEGER CHECK (carton_quantity IS NULL OR carton_quantity > 0),
    minimum_ship_quantity INTEGER CHECK (minimum_ship_quantity IS NULL OR minimum_ship_quantity > 0),
    lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
    target_cover_days INTEGER CHECK (target_cover_days IS NULL OR target_cover_days > 0),
    max_cover_days INTEGER CHECK (max_cover_days IS NULL OR max_cover_days > 0),
    launch_velocity NUMERIC(12, 4) CHECK (launch_velocity IS NULL OR launch_velocity >= 0),
    launch_quantity INTEGER CHECK (launch_quantity IS NULL OR launch_quantity >= 0),
    strategic_flag BOOLEAN NOT NULL DEFAULT FALSE,
    replenishment_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_in_listings_at TIMESTAMPTZ,
    last_seen_in_inventory_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (marketplace_key, seller_sku)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_sku_master_normalized
     ON amazon_sku_master (marketplace_key, normalized_sku)`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_sku_master_status
     ON amazon_sku_master (marketplace_key, mapping_status)`,

  `CREATE TABLE IF NOT EXISTS amazon_inventory_snapshots (
    id BIGSERIAL PRIMARY KEY,
    marketplace_key TEXT NOT NULL ${MARKETPLACE_CHECK},
    seller_sku TEXT NOT NULL,
    normalized_sku TEXT NOT NULL,
    asin TEXT,
    fnsku TEXT,
    snapshot_at TIMESTAMPTZ NOT NULL,
    snapshot_date DATE NOT NULL,
    fulfillable_quantity INTEGER,
    inbound_working_quantity INTEGER,
    inbound_shipped_quantity INTEGER,
    inbound_receiving_quantity INTEGER,
    reserved_quantity INTEGER,
    reserved_customer_orders INTEGER,
    reserved_fc_transfer INTEGER,
    reserved_fc_processing INTEGER,
    unfulfillable_quantity INTEGER,
    researching_quantity INTEGER,
    total_quantity INTEGER,
    amazon_last_updated_at TIMESTAMPTZ,
    source TEXT NOT NULL DEFAULT 'fba_inventory_api',
    run_id UUID,
    fetched_at TIMESTAMPTZ NOT NULL,
    UNIQUE (marketplace_key, seller_sku, snapshot_at)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_inventory_snapshots_time
     ON amazon_inventory_snapshots (marketplace_key, snapshot_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_inventory_snapshots_sku
     ON amazon_inventory_snapshots (marketplace_key, normalized_sku, snapshot_at DESC)`,

  `CREATE TABLE IF NOT EXISTS amazon_sku_daily_sales (
    marketplace_key TEXT NOT NULL ${MARKETPLACE_CHECK},
    sales_date DATE NOT NULL,
    seller_sku TEXT NOT NULL,
    asin TEXT,
    units_ordered INTEGER NOT NULL DEFAULT 0,
    units_cancelled INTEGER NOT NULL DEFAULT 0,
    order_count INTEGER NOT NULL DEFAULT 0,
    cancelled_order_count INTEGER NOT NULL DEFAULT 0,
    gross_item_sales NUMERIC(16, 4),
    item_tax NUMERIC(16, 4),
    promotions NUMERIC(16, 4),
    net_sales_ex_vat NUMERIC(16, 4),
    lines_without_price INTEGER NOT NULL DEFAULT 0,
    currency TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (marketplace_key, sales_date, seller_sku)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_sku_daily_sales_date
     ON amazon_sku_daily_sales (marketplace_key, sales_date)`,

  `CREATE TABLE IF NOT EXISTS amazon_warehouse_stock_snapshots (
    id BIGSERIAL PRIMARY KEY,
    zoho_item_id TEXT NOT NULL,
    item_code TEXT,
    item_name TEXT,
    item_status TEXT,
    snapshot_at TIMESTAMPTZ NOT NULL,
    snapshot_date DATE NOT NULL,
    on_hand NUMERIC(16, 4),
    available_for_sale NUMERIC(16, 4),
    committed_stock NUMERIC(16, 4),
    stock_scope TEXT NOT NULL DEFAULT 'warehouse' CHECK (stock_scope IN ('warehouse', 'organization', 'unknown')),
    source_warehouse_id TEXT NOT NULL,
    run_id UUID,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_warehouse_id, zoho_item_id, snapshot_at)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_warehouse_stock_snapshots_time
     ON amazon_warehouse_stock_snapshots (snapshot_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_warehouse_stock_snapshots_item
     ON amazon_warehouse_stock_snapshots (zoho_item_id, snapshot_at DESC)`,
]

/**
 * Capacity, inventory health and removals (mirrored by migrations/062_amazon_control_tower_capacity_health.sql).
 * Amazon listing status, capacity periods (append-only with an event trail), calculated usage snapshots,
 * inventory age, unit volumes and removal orders are copies of Amazon reports or manual entries.
 * Nothing here is sent to Amazon or Zoho.
 */
const CAPACITY_HEALTH_DDL: string[] = [
  `ALTER TABLE amazon_sku_master ADD COLUMN IF NOT EXISTS amazon_listing_status TEXT
     CHECK (amazon_listing_status IS NULL OR amazon_listing_status IN ('ACTIVE', 'INACTIVE', 'SUPPRESSED', 'INCOMPLETE', 'CLOSED', 'UNKNOWN'))`,
  `ALTER TABLE amazon_sku_master ADD COLUMN IF NOT EXISTS amazon_listing_status_raw TEXT`,
  `ALTER TABLE amazon_sku_master ADD COLUMN IF NOT EXISTS amazon_listing_status_reason TEXT`,
  `ALTER TABLE amazon_sku_master ADD COLUMN IF NOT EXISTS amazon_listing_status_source TEXT`,
  `ALTER TABLE amazon_sku_master ADD COLUMN IF NOT EXISTS amazon_listing_status_at TIMESTAMPTZ`,
  `ALTER TABLE amazon_sku_master ADD COLUMN IF NOT EXISTS amazon_fulfillment_channel_raw TEXT`,
  `ALTER TABLE amazon_sku_master ADD COLUMN IF NOT EXISTS search_suppressed BOOLEAN`,
  `ALTER TABLE amazon_sku_master ADD COLUMN IF NOT EXISTS last_seen_in_all_listings_at TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_sku_master_listing_status
     ON amazon_sku_master (marketplace_key, amazon_listing_status)`,

  `CREATE TABLE IF NOT EXISTS amazon_listing_status_history (
    id BIGSERIAL PRIMARY KEY,
    marketplace_key TEXT NOT NULL ${MARKETPLACE_CHECK},
    seller_sku TEXT NOT NULL,
    listing_status TEXT NOT NULL,
    raw_status TEXT,
    reason TEXT,
    source TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    run_id UUID
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_listing_status_history_sku
     ON amazon_listing_status_history (marketplace_key, seller_sku, observed_at DESC)`,

  `ALTER TABLE amazon_marketplace_settings ADD COLUMN IF NOT EXISTS health_aged_min_days INTEGER NOT NULL DEFAULT 181
     CHECK (health_aged_min_days IN (91, 181, 271, 366))`,
  `ALTER TABLE amazon_marketplace_settings ADD COLUMN IF NOT EXISTS health_excess_cover_days INTEGER NOT NULL DEFAULT 180
     CHECK (health_excess_cover_days > 0)`,
  `ALTER TABLE amazon_marketplace_settings ADD COLUMN IF NOT EXISTS health_low_cover_days INTEGER NOT NULL DEFAULT 14
     CHECK (health_low_cover_days >= 0)`,
  `ALTER TABLE amazon_marketplace_settings ADD COLUMN IF NOT EXISTS health_slow_units_per_30d NUMERIC(10, 2) NOT NULL DEFAULT 3
     CHECK (health_slow_units_per_30d >= 0)`,
  `ALTER TABLE amazon_marketplace_settings ADD COLUMN IF NOT EXISTS health_very_low_units_per_30d NUMERIC(10, 2) NOT NULL DEFAULT 1
     CHECK (health_very_low_units_per_30d >= 0)`,
  `ALTER TABLE amazon_marketplace_settings ADD COLUMN IF NOT EXISTS removal_stuck_days INTEGER NOT NULL DEFAULT 14
     CHECK (removal_stuck_days > 0)`,
  `ALTER TABLE amazon_marketplace_settings ADD COLUMN IF NOT EXISTS capacity_warn_pct NUMERIC(6, 2) NOT NULL DEFAULT 80
     CHECK (capacity_warn_pct > 0)`,
  `ALTER TABLE amazon_marketplace_settings ADD COLUMN IF NOT EXISTS capacity_high_pct NUMERIC(6, 2) NOT NULL DEFAULT 90
     CHECK (capacity_high_pct > 0)`,
  `ALTER TABLE amazon_marketplace_settings ADD COLUMN IF NOT EXISTS capacity_critical_pct NUMERIC(6, 2) NOT NULL DEFAULT 100
     CHECK (capacity_critical_pct > 0)`,
  `ALTER TABLE amazon_marketplace_settings ADD COLUMN IF NOT EXISTS usage_coverage_min_pct NUMERIC(6, 2) NOT NULL DEFAULT 95
     CHECK (usage_coverage_min_pct >= 0 AND usage_coverage_min_pct <= 100)`,

  `CREATE TABLE IF NOT EXISTS amazon_capacity_periods (
    id BIGSERIAL PRIMARY KEY,
    marketplace_key TEXT NOT NULL ${MARKETPLACE_CHECK},
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    storage_type TEXT NOT NULL CHECK (storage_type IN ('ALL', 'STANDARD', 'OVERSIZE', 'APPAREL', 'FOOTWEAR', 'OTHER')),
    storage_type_label TEXT,
    capacity_limit NUMERIC(18, 4) CHECK (capacity_limit IS NULL OR capacity_limit > 0),
    capacity_unit TEXT NOT NULL CHECK (capacity_unit IN ('CUBIC_FEET', 'CUBIC_METERS', 'UNITS', 'OTHER')),
    capacity_unit_label TEXT,
    amazon_reported_usage NUMERIC(18, 4) CHECK (amazon_reported_usage IS NULL OR amazon_reported_usage >= 0),
    calculated_usage NUMERIC(18, 4),
    inbound_usage NUMERIC(18, 4),
    committed_usage NUMERIC(18, 4),
    available_capacity NUMERIC(18, 4),
    calculation_snapshot_id BIGINT,
    source TEXT NOT NULL CHECK (source IN ('AMAZON_API', 'SELLER_CENTRAL_MANUAL', 'CALCULATED', 'IMPORT')),
    source_reference TEXT,
    entered_by TEXT,
    entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    verified_by TEXT,
    notes TEXT,
    supersedes_id BIGINT REFERENCES amazon_capacity_periods(id),
    superseded_by_id BIGINT REFERENCES amazon_capacity_periods(id),
    superseded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (period_end >= period_start)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_capacity_periods_current
     ON amazon_capacity_periods (marketplace_key, storage_type, period_start DESC)
     WHERE superseded_at IS NULL`,

  `CREATE TABLE IF NOT EXISTS amazon_capacity_period_events (
    id BIGSERIAL PRIMARY KEY,
    marketplace_key TEXT NOT NULL ${MARKETPLACE_CHECK},
    period_id BIGINT NOT NULL REFERENCES amazon_capacity_periods(id),
    previous_period_id BIGINT REFERENCES amazon_capacity_periods(id),
    action TEXT NOT NULL CHECK (action IN ('CREATED', 'REVISED', 'VERIFIED')),
    changes JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_capacity_period_events_period
     ON amazon_capacity_period_events (period_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS amazon_capacity_usage_snapshots (
    id BIGSERIAL PRIMARY KEY,
    marketplace_key TEXT NOT NULL ${MARKETPLACE_CHECK},
    computed_at TIMESTAMPTZ NOT NULL,
    inventory_snapshot_at TIMESTAMPTZ,
    on_hand_units INTEGER NOT NULL,
    on_hand_units_with_volume INTEGER NOT NULL,
    on_hand_volume_cm3 NUMERIC(20, 2) NOT NULL,
    inbound_working_volume_cm3 NUMERIC(20, 2) NOT NULL,
    inbound_shipped_volume_cm3 NUMERIC(20, 2) NOT NULL,
    inbound_receiving_volume_cm3 NUMERIC(20, 2) NOT NULL,
    coverage_pct NUMERIC(6, 2),
    amazon_planning_storage_volume_m3 NUMERIC(18, 6),
    breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    run_id UUID,
    UNIQUE (marketplace_key, computed_at)
  )`,

  `CREATE TABLE IF NOT EXISTS amazon_inventory_age_snapshots (
    id BIGSERIAL PRIMARY KEY,
    marketplace_key TEXT NOT NULL ${MARKETPLACE_CHECK},
    snapshot_date DATE NOT NULL,
    inventory_age_snapshot_date DATE,
    seller_sku TEXT NOT NULL,
    normalized_sku TEXT NOT NULL,
    fnsku TEXT,
    asin TEXT,
    product_name TEXT,
    condition TEXT,
    available INTEGER,
    inventory_supply_at_fba INTEGER,
    pending_removal_quantity INTEGER,
    inv_age_0_to_30_days INTEGER,
    inv_age_31_to_60_days INTEGER,
    inv_age_61_to_90_days INTEGER,
    inv_age_0_to_90_days INTEGER,
    inv_age_91_to_180_days INTEGER,
    inv_age_181_to_270_days INTEGER,
    inv_age_181_to_330_days INTEGER,
    inv_age_271_to_365_days INTEGER,
    inv_age_331_to_365_days INTEGER,
    inv_age_365_plus_days INTEGER,
    units_shipped_t7 INTEGER,
    units_shipped_t30 INTEGER,
    units_shipped_t60 INTEGER,
    units_shipped_t90 INTEGER,
    item_volume NUMERIC(18, 6),
    volume_unit TEXT,
    storage_type TEXT,
    storage_volume NUMERIC(18, 6),
    days_of_supply INTEGER,
    weeks_of_cover_t30 NUMERIC(12, 2),
    weeks_of_cover_t90 NUMERIC(12, 2),
    estimated_excess_quantity INTEGER,
    recommended_action TEXT,
    alert TEXT,
    sell_through NUMERIC(12, 4),
    inbound_quantity INTEGER,
    reserved_quantity INTEGER,
    unfulfillable_quantity INTEGER,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    report_id TEXT,
    run_id UUID,
    fetched_at TIMESTAMPTZ NOT NULL,
    UNIQUE (marketplace_key, seller_sku, snapshot_date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_inventory_age_snapshots_date
     ON amazon_inventory_age_snapshots (marketplace_key, snapshot_date DESC)`,

  `CREATE TABLE IF NOT EXISTS amazon_sku_dimensions (
    marketplace_key TEXT NOT NULL ${MARKETPLACE_CHECK},
    seller_sku TEXT NOT NULL,
    normalized_sku TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN (
      'AMAZON_PLANNING_ITEM_VOLUME', 'AMAZON_FEE_PREVIEW_PACKAGE', 'AMAZON_MYI_PER_UNIT_VOLUME', 'ZOHO_PACKAGE_DETAILS', 'MANUAL'
    )),
    dimension_kind TEXT NOT NULL CHECK (dimension_kind IN ('PACKAGE', 'STORAGE_UNIT_VOLUME', 'PRODUCT', 'UNKNOWN')),
    longest_side NUMERIC(12, 3),
    median_side NUMERIC(12, 3),
    shortest_side NUMERIC(12, 3),
    dimension_unit TEXT,
    raw_volume NUMERIC(20, 6),
    raw_volume_unit TEXT,
    unit_volume_cm3 NUMERIC(20, 3) CHECK (unit_volume_cm3 IS NULL OR unit_volume_cm3 > 0),
    observed_at TIMESTAMPTZ NOT NULL,
    report_id TEXT,
    run_id UUID,
    PRIMARY KEY (marketplace_key, seller_sku, source)
  )`,

  `CREATE TABLE IF NOT EXISTS amazon_removal_orders (
    id BIGSERIAL PRIMARY KEY,
    marketplace_key TEXT NOT NULL ${MARKETPLACE_CHECK},
    removal_order_id TEXT NOT NULL,
    request_date TIMESTAMPTZ,
    order_source TEXT,
    order_type TEXT,
    service_speed TEXT,
    order_status TEXT,
    status_group TEXT NOT NULL CHECK (status_group IN ('OPEN', 'COMPLETED', 'CANCELLED', 'UNKNOWN')),
    last_updated_at TIMESTAMPTZ,
    line_count INTEGER NOT NULL DEFAULT 0,
    requested_quantity INTEGER,
    shipped_quantity INTEGER,
    cancelled_quantity INTEGER,
    disposed_quantity INTEGER,
    in_process_quantity INTEGER,
    completed_quantity INTEGER,
    removal_fee NUMERIC(14, 2),
    currency TEXT,
    raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    report_id TEXT,
    run_id UUID,
    UNIQUE (marketplace_key, removal_order_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_removal_orders_status
     ON amazon_removal_orders (marketplace_key, status_group, request_date DESC)`,

  `CREATE TABLE IF NOT EXISTS amazon_removal_order_items (
    id BIGSERIAL PRIMARY KEY,
    marketplace_key TEXT NOT NULL ${MARKETPLACE_CHECK},
    removal_order_id TEXT NOT NULL,
    seller_sku TEXT NOT NULL,
    normalized_sku TEXT NOT NULL,
    fnsku TEXT NOT NULL DEFAULT '',
    asin TEXT,
    disposition TEXT NOT NULL DEFAULT '',
    order_status TEXT,
    status_group TEXT NOT NULL CHECK (status_group IN ('OPEN', 'COMPLETED', 'CANCELLED', 'UNKNOWN')),
    request_date TIMESTAMPTZ,
    last_updated_at TIMESTAMPTZ,
    requested_quantity INTEGER,
    shipped_quantity INTEGER,
    cancelled_quantity INTEGER,
    disposed_quantity INTEGER,
    in_process_quantity INTEGER,
    completed_quantity INTEGER,
    removal_fee NUMERIC(14, 2),
    currency TEXT,
    raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    report_id TEXT,
    run_id UUID,
    UNIQUE (marketplace_key, removal_order_id, seller_sku, fnsku, disposition)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_removal_order_items_sku
     ON amazon_removal_order_items (marketplace_key, normalized_sku)`,

  `CREATE TABLE IF NOT EXISTS amazon_control_tower_actions (
    id BIGSERIAL PRIMARY KEY,
    marketplace_key TEXT NOT NULL ${MARKETPLACE_CHECK},
    action_key TEXT NOT NULL UNIQUE,
    action_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    title TEXT NOT NULL,
    detail TEXT,
    entity_type TEXT,
    entity_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amazon_control_tower_actions_open
     ON amazon_control_tower_actions (marketplace_key, status, severity)`,
]

async function ensureAmazonControlTowerTables(query: QueryFn): Promise<void> {
  for (const sql of CONTROL_TOWER_DDL) {
    await query(sql)
  }
  for (const sql of CAPACITY_HEALTH_DDL) {
    await query(sql)
  }
}

module.exports = { ensureAmazonControlTowerTables, CONTROL_TOWER_DDL, CAPACITY_HEALTH_DDL }
