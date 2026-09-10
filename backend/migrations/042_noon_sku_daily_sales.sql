-- Noon's own per-SKU, per-day sales figures, from the Noon Partner API Impex export
-- `noon_catalog_reports_productviewsandsalesdata`.
--
-- Why this table exists: the Noon OMS orders export carries no money at all, and Noon's item-level
-- finance report lists an order only once it has settled it, 1 to 8 days after the order was placed.
-- Summing only the settled orders reported a fraction of a day as if it were the whole day — on
-- 2026-09-08 that was AED 590 of a Noon UAE day worth AED 2,329. This report is the only Noon feed
-- that prices a recent day, and where an order has since settled its unit price matches the settled
-- net proceeds exactly.
--
-- Only the aggregate columns are stored. Nothing here identifies a buyer.

CREATE TABLE IF NOT EXISTS noon_sku_daily_sales (
  id BIGSERIAL PRIMARY KEY,
  country_code TEXT NOT NULL,
  sales_date DATE NOT NULL,
  noon_sku TEXT NOT NULL,
  partner_sku TEXT,
  currency TEXT,
  gross_units NUMERIC(14,4),
  shipped_units NUMERIC(14,4),
  cancelled_units NUMERIC(14,4),
  revenue_shipped NUMERIC(14,4),
  raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (country_code, sales_date, noon_sku)
);

CREATE INDEX IF NOT EXISTS idx_noon_sku_daily_sales_date
  ON noon_sku_daily_sales (country_code, sales_date);
