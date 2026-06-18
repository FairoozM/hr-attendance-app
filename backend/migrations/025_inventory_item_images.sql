-- Persistent cache for Zoho inventory item images (inventory health dashboard).
-- Idempotent DDL. Applied on server boot via inventoryItemImageStore.ensureInventoryItemImageTables().
-- Manual: psql "$DATABASE_URL" -f backend/migrations/025_inventory_item_images.sql

CREATE TABLE IF NOT EXISTS inventory_item_images (
  id BIGSERIAL PRIMARY KEY,
  item_id VARCHAR(64),
  sku VARCHAR(512),
  item_name TEXT,
  image_url TEXT,
  image_source VARCHAR(64),
  image_cached_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  missing_reason TEXT,
  content_type VARCHAR(128),
  file_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_item_images_item_id
  ON inventory_item_images (item_id)
  WHERE item_id IS NOT NULL AND item_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_item_images_sku_fallback
  ON inventory_item_images (LOWER(sku))
  WHERE (item_id IS NULL OR item_id = '') AND sku IS NOT NULL AND sku <> '';

CREATE INDEX IF NOT EXISTS idx_inventory_item_images_last_checked
  ON inventory_item_images (last_checked_at DESC);
