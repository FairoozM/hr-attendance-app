-- Manual HTTPS image URLs per SKU/ASIN when Amazon catalog cache has no image.
-- Idempotent DDL. Prefer: cd backend && npm run db:amazon-cache:ensure

CREATE TABLE IF NOT EXISTS amazon_sku_image_overrides (
  id BIGSERIAL PRIMARY KEY,
  marketplace_key TEXT NULL,
  seller_sku TEXT NOT NULL,
  asin TEXT NULL,
  image_url TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT amazon_sku_image_overrides_mk_chk CHECK (
    marketplace_key IS NULL OR marketplace_key IN ('uae', 'ksa')
  )
);

CREATE INDEX IF NOT EXISTS idx_amazon_sku_img_ov_seller_sku ON amazon_sku_image_overrides (seller_sku);
CREATE INDEX IF NOT EXISTS idx_amazon_sku_img_ov_mk_seller ON amazon_sku_image_overrides (marketplace_key, seller_sku);
CREATE INDEX IF NOT EXISTS idx_amazon_sku_img_ov_asin ON amazon_sku_image_overrides (asin);
CREATE INDEX IF NOT EXISTS idx_amazon_sku_img_ov_mk_asin ON amazon_sku_image_overrides (marketplace_key, asin);
