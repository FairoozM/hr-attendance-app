-- Amazon flat-file bulk listing batches (also applied automatically via ensureAmazonBulkListingTables on boot).

CREATE TABLE IF NOT EXISTS listing_batches (
  id SERIAL PRIMARY KEY,
  batch_name TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  original_filename TEXT NOT NULL,
  original_mime_type TEXT DEFAULT '',
  original_file_ext TEXT DEFAULT '',
  workbook_data BYTEA NOT NULL,
  template_sheet_name TEXT NOT NULL DEFAULT 'Template',
  header_row_number INTEGER NOT NULL DEFAULT 1,
  sku_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  overflow_count INTEGER NOT NULL DEFAULT 0,
  detected_columns JSONB NOT NULL DEFAULT '[]',
  active_columns JSONB NOT NULL DEFAULT '[]',
  valid_values JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(32) NOT NULL DEFAULT 'Imported',
  summary_counts JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exported_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS listing_batch_rows (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES listing_batches(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  sheet_row_number INTEGER NOT NULL,
  sku TEXT NOT NULL,
  item_name TEXT DEFAULT '',
  marketplace TEXT DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'Imported',
  raw_values JSONB NOT NULL DEFAULT '{}',
  current_values JSONB NOT NULL DEFAULT '{}',
  generated_values JSONB NOT NULL DEFAULT '{}',
  source_map JSONB NOT NULL DEFAULT '{}',
  validation JSONB NOT NULL DEFAULT '{"errors":[],"warnings":[]}',
  quality JSONB NOT NULL DEFAULT '{}',
  ai_usage_log_id INTEGER REFERENCES ai_usage_logs(id) ON DELETE SET NULL,
  ai_model VARCHAR(128),
  estimated_cost_usd NUMERIC(16,8) NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  approved_at TIMESTAMPTZ,
  generated_at TIMESTAMPTZ,
  exported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(batch_id, sheet_row_number),
  UNIQUE(batch_id, sku)
);

CREATE TABLE IF NOT EXISTS default_profiles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  marketplace VARCHAR(32) DEFAULT '',
  description TEXT DEFAULT '',
  is_builtin BOOLEAN NOT NULL DEFAULT false,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS default_profile_fields (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES default_profiles(id) ON DELETE CASCADE,
  column_key TEXT NOT NULL,
  column_label TEXT NOT NULL,
  default_value TEXT NOT NULL DEFAULT '',
  apply_mode VARCHAR(32) NOT NULL DEFAULT 'fill_empty',
  enabled BOOLEAN NOT NULL DEFAULT true,
  source VARCHAR(32) NOT NULL DEFAULT 'Fixed Default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listing_batch_events (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES listing_batches(id) ON DELETE CASCADE,
  row_id INTEGER REFERENCES listing_batch_rows(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listing_batches_created ON listing_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_batches_user ON listing_batches(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_listing_batch_rows_batch ON listing_batch_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_listing_batch_rows_status ON listing_batch_rows(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_listing_batch_rows_sku ON listing_batch_rows(sku);
CREATE INDEX IF NOT EXISTS idx_default_profile_fields_profile ON default_profile_fields(profile_id);
