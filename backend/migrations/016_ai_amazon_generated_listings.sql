-- Patches for AI module v2 (also applied automatically via ensureAiBudgetAndUsageTables on boot).

ALTER TABLE ai_budget_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS request_duration_ms INTEGER;

CREATE TABLE IF NOT EXISTS amazon_generated_listings (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(255) NOT NULL,
  product_name TEXT NOT NULL,
  generated_title TEXT NOT NULL DEFAULT '',
  generated_bullets JSONB NOT NULL DEFAULT '[]',
  generated_description TEXT NOT NULL DEFAULT '',
  generated_search_terms JSONB NOT NULL DEFAULT '[]',
  marketplace VARCHAR(16) NOT NULL,
  language VARCHAR(8) NOT NULL,
  ai_model VARCHAR(128) NOT NULL,
  estimated_cost NUMERIC(16,8) NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ai_usage_log_id INTEGER REFERENCES ai_usage_logs(id) ON DELETE SET NULL,
  arabic_title TEXT NOT NULL DEFAULT '',
  arabic_bullets JSONB NOT NULL DEFAULT '[]',
  suggested_attributes JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amazon_generated_listings_sku ON amazon_generated_listings(sku);
CREATE INDEX IF NOT EXISTS idx_amazon_generated_listings_created ON amazon_generated_listings(created_at);
