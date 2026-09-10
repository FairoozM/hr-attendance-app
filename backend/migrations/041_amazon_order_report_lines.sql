-- Amazon flat-file order report lines (PII-safe columns only).
--
-- Why: while an order is Pending, the SP-API Orders endpoint omits OrderTotal AND every item money
-- field, so a same-day Daily Ecommerce Report built only from the Orders API under-reports Amazon.
-- GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL publishes those orders' item-price straight
-- away, and its line composition matches OrderTotal exactly wherever Amazon does publish OrderTotal.
--
-- Buyer-identifying report columns (ship-city, ship-state, ship-postal-code, ship-country,
-- product-name) are deliberately not stored.
--
-- Idempotent DDL only (IF NOT EXISTS). Same objects are created on API boot via
-- ensureAmazonOrdersCacheTables().
-- Preferred: cd backend && npm run db:amazon-cache:ensure
-- Manual psql: load DATABASE_URL (e.g. from backend/.env) then
--   psql "$DATABASE_URL" -f backend/migrations/041_amazon_order_report_lines.sql

CREATE TABLE IF NOT EXISTS amazon_order_report_lines (
  id BIGSERIAL PRIMARY KEY,
  marketplace_key VARCHAR(8) NOT NULL CHECK (marketplace_key IN ('uae', 'ksa')),
  amazon_order_id VARCHAR(64) NOT NULL,
  order_item_id VARCHAR(64) NOT NULL DEFAULT '',
  purchase_date TIMESTAMPTZ,
  order_status VARCHAR(64),
  item_status VARCHAR(64),
  seller_sku VARCHAR(512),
  asin VARCHAR(32),
  quantity INTEGER,
  currency VARCHAR(8),
  item_price NUMERIC(16, 4),
  item_tax NUMERIC(16, 4),
  shipping_price NUMERIC(16, 4),
  shipping_tax NUMERIC(16, 4),
  gift_wrap_price NUMERIC(16, 4),
  gift_wrap_tax NUMERIC(16, 4),
  item_promotion_discount NUMERIC(16, 4),
  ship_promotion_discount NUMERIC(16, 4),
  line_amount NUMERIC(16, 4),
  report_id VARCHAR(64),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (marketplace_key, amazon_order_id, order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_amazon_order_report_lines_mk_purchase
  ON amazon_order_report_lines (marketplace_key, purchase_date);
CREATE INDEX IF NOT EXISTS idx_amazon_order_report_lines_order
  ON amazon_order_report_lines (marketplace_key, amazon_order_id);
