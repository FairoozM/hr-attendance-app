-- PII-safe cache for Search Catalog Items by ASIN (dashboard thumbnails).
-- Idempotent DDL. Prefer: cd backend && npm run db:amazon-cache:ensure
-- Manual: psql "$DATABASE_URL" -f backend/migrations/020_amazon_catalog_item_cache.sql

CREATE TABLE IF NOT EXISTS amazon_catalog_item_cache (
  id BIGSERIAL PRIMARY KEY,
  marketplace_key VARCHAR(8) NOT NULL CHECK (marketplace_key IN ('uae', 'ksa')),
  asin VARCHAR(32) NOT NULL,
  seller_sku VARCHAR(512),
  title TEXT,
  image_url TEXT,
  brand VARCHAR(512),
  raw_safe_json JSONB,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (marketplace_key, asin)
);

CREATE INDEX IF NOT EXISTS idx_amazon_catalog_item_cache_mk_synced
  ON amazon_catalog_item_cache (marketplace_key, last_synced_at DESC);
