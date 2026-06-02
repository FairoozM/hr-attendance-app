CREATE TABLE IF NOT EXISTS amazon_zoho_stock_refresh_job (
  id UUID PRIMARY KEY,
  marketplace VARCHAR(16) NOT NULL DEFAULT 'all',
  status VARCHAR(24) NOT NULL DEFAULT 'queued',
  progress_step TEXT,
  progress_current INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  total_rows INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amz_zoho_refresh_job_status
  ON amazon_zoho_stock_refresh_job (status, started_at DESC);
