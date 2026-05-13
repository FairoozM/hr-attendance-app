-- Amazon SP-API orders cache, sync audit, and API call guardrails (PII-safe columns only).
-- Idempotent DDL only (IF NOT EXISTS). Same objects are created on API boot via ensureAmazonOrdersCacheTables().
-- Preferred: cd backend && npm run db:amazon-cache:ensure
-- Manual psql: load DATABASE_URL (e.g. from backend/.env) then psql "$DATABASE_URL" -f backend/migrations/019_add_amazon_orders_cache.sql

CREATE TABLE IF NOT EXISTS amazon_orders (
  id BIGSERIAL PRIMARY KEY,
  marketplace_key VARCHAR(8) NOT NULL CHECK (marketplace_key IN ('uae', 'ksa')),
  marketplace_id VARCHAR(32),
  amazon_order_id VARCHAR(64) NOT NULL,
  purchase_date TIMESTAMPTZ,
  order_status VARCHAR(64),
  fulfillment_channel VARCHAR(32),
  sales_channel TEXT,
  currency_code VARCHAR(8),
  order_amount NUMERIC(16, 4),
  number_of_items_shipped INTEGER,
  number_of_items_unshipped INTEGER,
  items_sync_pending BOOLEAN NOT NULL DEFAULT false,
  raw_safe_json JSONB,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (marketplace_key, amazon_order_id)
);

CREATE INDEX IF NOT EXISTS idx_amazon_orders_mk_purchase ON amazon_orders (marketplace_key, purchase_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_amazon_orders_pending ON amazon_orders (marketplace_key, items_sync_pending) WHERE items_sync_pending = true;

CREATE TABLE IF NOT EXISTS amazon_order_items (
  id BIGSERIAL PRIMARY KEY,
  marketplace_key VARCHAR(8) NOT NULL CHECK (marketplace_key IN ('uae', 'ksa')),
  amazon_order_id VARCHAR(64) NOT NULL,
  amazon_order_item_id VARCHAR(64) NOT NULL DEFAULT '',
  asin VARCHAR(32),
  seller_sku VARCHAR(512),
  title TEXT,
  quantity_ordered INTEGER,
  quantity_shipped INTEGER,
  item_currency_code VARCHAR(8),
  item_amount NUMERIC(16, 4),
  raw_safe_json JSONB,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (marketplace_key, amazon_order_id, amazon_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_amazon_order_items_order ON amazon_order_items (marketplace_key, amazon_order_id);
CREATE INDEX IF NOT EXISTS idx_amazon_order_items_sku ON amazon_order_items (seller_sku);
CREATE INDEX IF NOT EXISTS idx_amazon_order_items_asin ON amazon_order_items (asin);

CREATE TABLE IF NOT EXISTS amazon_sync_log (
  id BIGSERIAL PRIMARY KEY,
  sync_type VARCHAR(32) NOT NULL,
  marketplace_key VARCHAR(8) NOT NULL CHECK (marketplace_key IN ('uae', 'ksa')),
  status VARCHAR(32) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_after TIMESTAMPTZ,
  created_before TIMESTAMPTZ,
  orders_fetched INTEGER NOT NULL DEFAULT 0,
  order_items_fetched INTEGER NOT NULL DEFAULT 0,
  api_calls_made INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_amazon_sync_log_mk_started ON amazon_sync_log (marketplace_key, started_at DESC);

CREATE TABLE IF NOT EXISTS amazon_api_call_log (
  id BIGSERIAL PRIMARY KEY,
  operation VARCHAR(64) NOT NULL,
  marketplace_key VARCHAR(8) NOT NULL,
  called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_code INTEGER,
  rate_limit_header VARCHAR(512),
  success BOOLEAN NOT NULL DEFAULT false,
  safe_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_amazon_api_call_log_op_mk ON amazon_api_call_log (operation, marketplace_key, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_amazon_api_call_log_orderitems ON amazon_api_call_log (operation, called_at DESC);
