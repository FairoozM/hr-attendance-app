-- Optional manual migration if startup ensureAiBudgetAndUsageTables did not run.
-- Tables: ai_budget_settings, ai_usage_logs, amazon_listing_generations

CREATE TABLE IF NOT EXISTS ai_budget_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  daily_budget_usd NUMERIC(14,4) NOT NULL DEFAULT 50,
  monthly_budget_usd NUMERIC(14,4) NOT NULL DEFAULT 500,
  alert_threshold_percent NUMERIC(6,2) NOT NULL DEFAULT 80,
  default_model VARCHAR(128) NOT NULL DEFAULT 'gpt-4o-mini',
  max_batch_size INTEGER NOT NULL DEFAULT 10,
  allow_ai_generation BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_budget_settings_singleton CHECK (id = 1),
  CONSTRAINT ai_budget_settings_batch_chk CHECK (max_batch_size >= 1 AND max_batch_size <= 500)
);

INSERT INTO ai_budget_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  module_name VARCHAR(128) NOT NULL,
  action_name VARCHAR(128) NOT NULL,
  model VARCHAR(128) NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(16,8) NOT NULL DEFAULT 0,
  request_status VARCHAR(32) NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at ON ai_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_module ON ai_usage_logs(module_name);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user ON ai_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_status ON ai_usage_logs(request_status);

CREATE TABLE IF NOT EXISTS amazon_listing_generations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_input JSONB NOT NULL DEFAULT '{}',
  listing_result JSONB NOT NULL DEFAULT '{}',
  ai_usage_log_id INTEGER REFERENCES ai_usage_logs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amazon_listing_generations_user ON amazon_listing_generations(user_id);
