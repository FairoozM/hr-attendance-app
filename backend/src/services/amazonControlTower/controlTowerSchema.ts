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

async function ensureAmazonControlTowerTables(query: QueryFn): Promise<void> {
  for (const sql of CONTROL_TOWER_DDL) {
    await query(sql)
  }
}

module.exports = { ensureAmazonControlTowerTables, CONTROL_TOWER_DDL }
